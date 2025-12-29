(function () {
  'use strict';

  function createBlockBreakerTrainer() {
    return {
      id: 'blockbreaker',
      name: 'Block Breaker',
      async start(ctx) {
        const THREE = window.THREE;
        const Base = window.WebXRBase;

        let scene, camera, renderer;
        let boardGroup;

        const hudState = { hudLastText: '', hudLastBg: '' };
        let hudPanel;
        let hudLastUpdateAtMs = 0;

        // Board placement
        let boardDistance = 2.2;
        let boardHeight = 1.55;
        let boardScale = 1.0;

        // Controls
        const PULSE_PERIODS = [0.6, 1.0, 1.6, 2.4];
        let pulseEnabled = false;
        let pulsePeriodIndex = 1;

        const VIS_PRESETS = [
          {
            name: 'Ball=L  Paddle=R  Prizes=Both  Blocks=Alt',
            ball: 'left',
            paddle: 'right',
            prizes: 'both',
            blocks: 'alt',
          },
          {
            name: 'Ball=Both  Paddle=Both  Prizes=Both  Blocks=Alt',
            ball: 'both',
            paddle: 'both',
            prizes: 'both',
            blocks: 'alt',
          },
          {
            name: 'Ball=Alt  Paddle=Alt  Prizes=Both  Blocks=Alt',
            ball: 'alt',
            paddle: 'alt',
            prizes: 'both',
            blocks: 'alt',
          },
          {
            name: 'Everything=Both  Blocks=StaticMix',
            ball: 'both',
            paddle: 'both',
            prizes: 'both',
            blocks: 'staticMix',
          },
        ];
        let presetIndex = 0;

        const BLOCK_PROGRAMS = [
          { id: 'alt', name: 'Alt (plateau + fade)', period: 2.8 },
          { id: 'cross', name: 'Crossfade', period: 2.2 },
          { id: 'staticMix', name: 'Static mix', period: 1.0 },
        ];
        let blockProgramIndex = 0;

        // Game state
        const BOARD_W = 1.4;
        const BOARD_H = 0.9;

        let paddle;
        let paddleW = 0.42;
        const paddleH = 0.06;
        const paddleY = -BOARD_H / 2 + 0.10;
        let paddleX = 0;

        let ball;
        const ballR = 0.035;
        let ballX = 0;
        let ballY = paddleY + 0.12;
        let ballVX = 0.45;
        let ballVY = 0.65;
        let ballStuck = true;

        let blocks = [];
        let powerups = [];

        let score = 0;
        let lives = 3;
        let lastTimeMs = 0;
        let lastServeAtMs = -1e9;

        let widenUntilMs = -1e9;

        function pulsePeriodSeconds() {
          return PULSE_PERIODS[pulsePeriodIndex] || 1.0;
        }

        function clamp01(v) {
          return Math.max(0, Math.min(1, v));
        }

        function setOpacity(mesh, opacity) {
          if (!mesh || !mesh.material) return;
          const o = clamp01(opacity);
          mesh.material.opacity = o;
          mesh.material.transparent = o < 0.999;
          mesh.visible = o > 0.001;
          mesh.material.needsUpdate = true;
        }

        function makeDualMesh(geom, matParams) {
          const leftMat = new THREE.MeshStandardMaterial({
            ...matParams,
            transparent: true,
            opacity: 1.0,
          });
          const rightMat = new THREE.MeshStandardMaterial({
            ...matParams,
            transparent: true,
            opacity: 1.0,
          });

          const left = new THREE.Mesh(geom, leftMat);
          const right = new THREE.Mesh(geom, rightMat);
          left.layers.set(1);
          right.layers.set(2);

          return { left, right };
        }

        function addDualObjectToGroup(dual) {
          boardGroup.add(dual.left);
          boardGroup.add(dual.right);
        }

        function currentPreset() {
          return VIS_PRESETS[presetIndex] || VIS_PRESETS[0];
        }

        function currentBlockProgramId() {
          const p = BLOCK_PROGRAMS[blockProgramIndex] || BLOCK_PROGRAMS[0];
          return p.id;
        }

        function eyeOpacitiesFromMode(mode, tSec, phase = 0) {
          if (mode === 'left') return { l: 1, r: 0 };
          if (mode === 'right') return { l: 0, r: 1 };
          if (mode === 'both') return { l: 1, r: 1 };

          // 'alt' program: plateau at 1, then fade one eye to 0, restore, fade the other.
          const period = 2.6;
          const p = ((tSec + phase) / period) % 1;

          if (p < 0.25) return { l: 1, r: 1 };
          if (p < 0.5) {
            const u = (p - 0.25) / 0.25;
            return { l: 1 - Base.easeOutCubic(u), r: 1 };
          }
          if (p < 0.75) return { l: 1, r: 1 };

          const u = (p - 0.75) / 0.25;
          return { l: 1, r: 1 - Base.easeOutCubic(u) };
        }

        function eyeOpacitiesForBlock(block, tSec) {
          const programId = currentPreset().blocks === 'staticMix' ? 'staticMix' : currentBlockProgramId();

          if (programId === 'staticMix') {
            if (block.eye === 'left') return { l: 1, r: 0 };
            if (block.eye === 'right') return { l: 0, r: 1 };
            return { l: 1, r: 1 };
          }

          if (programId === 'cross') {
            const period = (BLOCK_PROGRAMS[blockProgramIndex] || BLOCK_PROGRAMS[0]).period || 2.2;
            const p = ((tSec + block.phase) / period) % 1;
            const l = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(p * Math.PI * 2));
            const r = 0.15 + 0.85 * (1 - (0.5 + 0.5 * Math.sin(p * Math.PI * 2)));
            return { l, r };
          }

          // Default: plateau+fade alternation
          const period = (BLOCK_PROGRAMS[blockProgramIndex] || BLOCK_PROGRAMS[0]).period || 2.8;
          const p = ((tSec + block.phase) / period) % 1;

          if (p < 0.25) return { l: 1, r: 1 };
          if (p < 0.5) {
            const u = (p - 0.25) / 0.25;
            return { l: 1 - Base.easeOutCubic(u), r: 1 };
          }
          if (p < 0.75) return { l: 1, r: 1 };

          const u = (p - 0.75) / 0.25;
          return { l: 1, r: 1 - Base.easeOutCubic(u) };
        }

        function globalPulseOpacities(tSec) {
          if (!pulseEnabled) return { l: 1, r: 1 };

          const period = pulsePeriodSeconds();
          const half = period / 2;
          const phaseIndex = Math.floor(tSec / half) % 2;
          const localT = (tSec % half) / half;
          const pulseAlpha = 0.05 + 0.95 * Base.easeOutCubic(localT);

          return {
            l: phaseIndex === 0 ? pulseAlpha : 1,
            r: phaseIndex === 1 ? pulseAlpha : 1,
          };
        }

        function resetBall(stickToPaddle = true) {
          ballStuck = stickToPaddle;
          ballX = paddleX;
          ballY = paddleY + 0.12;

          // Slight random angle upward
          const angle = (Math.random() * 0.6 - 0.3) + Math.PI / 2;
          const speed = 0.82;
          ballVX = Math.cos(angle) * speed;
          ballVY = Math.sin(angle) * speed;
        }

        function buildBlocks() {
          // Clear old blocks
          for (const b of blocks) {
            if (b.mesh?.left) boardGroup.remove(b.mesh.left);
            if (b.mesh?.right) boardGroup.remove(b.mesh.right);
          }
          blocks = [];

          const cols = 9;
          const rows = 4;
          const padding = 0.02;
          const totalW = BOARD_W * 0.92;
          const blockW = (totalW - padding * (cols - 1)) / cols;
          const blockH = 0.08;

          const startX = -totalW / 2 + blockW / 2;
          const startY = BOARD_H / 2 - 0.16;

          const colors = [0x4dd2ff, 0xffc04d, 0x7dff4d, 0xff4dd2];

          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const x = startX + c * (blockW + padding);
              const y = startY - r * (blockH + 0.03);

              const color = colors[r % colors.length];
              const geom = new THREE.BoxGeometry(blockW, blockH, 0.05);
              const dual = makeDualMesh(geom, { color, emissive: color, emissiveIntensity: 0.15 });
              addDualObjectToGroup(dual);
              dual.left.position.set(x, y, 0);
              dual.right.position.set(x, y, 0);

              const eyeRand = Math.random();
              const eye = eyeRand < 0.34 ? 'left' : eyeRand < 0.67 ? 'right' : 'both';

              blocks.push({
                x,
                y,
                w: blockW,
                h: blockH,
                alive: true,
                mesh: dual,
                phase: Math.random() * 10,
                eye,
              });
            }
          }
        }

        function initThreeJS() {
          ctx.log('🔧 Инициализация Three.js...');

          scene = new THREE.Scene();
          scene.background = new THREE.Color(0x0a0a0a);

          camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
          camera.position.set(0, 1.6, 0);

          renderer = new THREE.WebGLRenderer({ canvas: ctx.canvas, antialias: true, alpha: false });
          renderer.setPixelRatio(window.devicePixelRatio);
          renderer.setSize(window.innerWidth, window.innerHeight);
          renderer.xr.enabled = true;

          scene.add(new THREE.AmbientLight(0xffffff, 0.85));
          const light1 = new THREE.DirectionalLight(0xffffff, 0.75);
          light1.position.set(2, 3, 1);
          scene.add(light1);

          // Ground / reference
          const floorGeom = new THREE.PlaneGeometry(10, 10);
          const floorMat = new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide });
          const floor = new THREE.Mesh(floorGeom, floorMat);
          floor.rotation.x = -Math.PI / 2;
          floor.position.y = 0;
          scene.add(floor);

          const grid = new THREE.GridHelper(10, 20, 0x666666, 0x444444);
          grid.position.y = 0.01;
          scene.add(grid);

          boardGroup = new THREE.Group();
          boardGroup.position.set(0, boardHeight, -boardDistance);
          scene.add(boardGroup);

          // Board frame (shared)
          const frameMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
          const framePts = [
            new THREE.Vector3(-BOARD_W / 2, -BOARD_H / 2, 0),
            new THREE.Vector3(BOARD_W / 2, -BOARD_H / 2, 0),
            new THREE.Vector3(BOARD_W / 2, BOARD_H / 2, 0),
            new THREE.Vector3(-BOARD_W / 2, BOARD_H / 2, 0),
            new THREE.Vector3(-BOARD_W / 2, -BOARD_H / 2, 0),
          ];
          const frameGeom = new THREE.BufferGeometry().setFromPoints(framePts);
          const frame = new THREE.Line(frameGeom, frameMat);
          frame.layers.set(0);
          boardGroup.add(frame);

          // Paddle (dual)
          const paddleGeom = new THREE.BoxGeometry(paddleW, paddleH, 0.06);
          const paddleDual = makeDualMesh(paddleGeom, { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.1 });
          addDualObjectToGroup(paddleDual);
          paddle = { mesh: paddleDual, geom: paddleGeom };

          // Ball (dual)
          const ballGeom = new THREE.SphereGeometry(ballR, 20, 16);
          const ballDual = makeDualMesh(ballGeom, { color: 0xff4d4d, emissive: 0xff0000, emissiveIntensity: 0.2 });
          addDualObjectToGroup(ballDual);
          ball = { mesh: ballDual };

          buildBlocks();
          resetBall(true);

          hudPanel = Base.createHudPanel(THREE, '...', '#222222');
          hudPanel.position.set(0, 2.45, -2.85);
          hudPanel.rotation.x = 0.25;
          scene.add(hudPanel);

          // Controllers: trigger serve; A/B pulse; X preset; Y block program
          const controller0 = renderer.xr.getController(0);
          const controller1 = renderer.xr.getController(1);

          const onSelect = () => {
            const now = performance.now();
            if (now - lastServeAtMs < 250) return;
            lastServeAtMs = now;

            if (lives <= 0) {
              // Restart
              score = 0;
              lives = 3;
              powerups = [];
              widenUntilMs = -1e9;
              buildBlocks();
              resetBall(true);
              return;
            }

            if (ballStuck) {
              ballStuck = false;
            }
          };

          controller0.addEventListener('selectstart', onSelect);
          controller1.addEventListener('selectstart', onSelect);
          scene.add(controller0);
          scene.add(controller1);

          ctx.log('✅ Three.js готов');
        }

        function updatePaddleMeshWidth() {
          // Rebuild paddle geometry when width changes
          const isWiden = performance.now() < widenUntilMs;
          const targetW = isWiden ? 0.65 : 0.42;
          if (Math.abs(targetW - paddleW) < 0.001) return;

          paddleW = targetW;
          const newGeom = new THREE.BoxGeometry(paddleW, paddleH, 0.06);
          paddle.mesh.left.geometry.dispose();
          paddle.mesh.right.geometry.dispose();
          paddle.mesh.left.geometry = newGeom;
          paddle.mesh.right.geometry = newGeom;
        }

        function collideBallWithAabb(ballX0, ballY0, r, boxX, boxY, boxW, boxH) {
          const dx = ballX0 - boxX;
          const px = boxW / 2 + r - Math.abs(dx);
          if (px <= 0) return null;

          const dy = ballY0 - boxY;
          const py = boxH / 2 + r - Math.abs(dy);
          if (py <= 0) return null;

          // Collision: resolve on minimum penetration axis
          if (px < py) {
            return { axis: 'x', sign: Math.sign(dx) || 1 };
          }
          return { axis: 'y', sign: Math.sign(dy) || 1 };
        }

        function maybeSpawnPowerup(x, y) {
          if (Math.random() > 0.28) return;

          const geom = new THREE.BoxGeometry(0.06, 0.06, 0.06);
          const dual = makeDualMesh(geom, { color: 0xffc04d, emissive: 0xffc04d, emissiveIntensity: 0.15 });
          addDualObjectToGroup(dual);
          dual.left.position.set(x, y, 0);
          dual.right.position.set(x, y, 0);

          powerups.push({ x, y, vy: -0.35, mesh: dual, type: 'widen' });
        }

        function cleanupPowerups() {
          for (const p of powerups) {
            if (p.mesh?.left) boardGroup.remove(p.mesh.left);
            if (p.mesh?.right) boardGroup.remove(p.mesh.right);
          }
          powerups = [];
        }

        function animate(timeMs) {
          const dt = lastTimeMs ? (timeMs - lastTimeMs) / 1000 : 0;
          lastTimeMs = timeMs;

          const tSec = timeMs / 1000;
          const pulse = globalPulseOpacities(tSec);

          // Input
          const session = renderer.xr.getSession();
          if (session && dt > 0) {
            const gpL = Base.getGamepad(session, 'left');
            const gpR = Base.getGamepad(session, 'right');

            if (!animate._prev) animate._prev = { a: false, b: false, x: false, y: false };

            if (gpL) {
              const axes = gpL.axes || [];
              let stickX = 0;
              let stickY = 0;
              if (axes.length >= 4) {
                stickX = axes[2];
                stickY = axes[3];
              } else if (axes.length >= 2) {
                stickX = axes[0];
                stickY = axes[1];
              }

              stickX = Base.deadzone(stickX, 0.12);
              stickY = Base.deadzone(stickY, 0.12);

              paddleX = Base.clamp(paddleX + stickX * 1.2 * dt, -BOARD_W / 2 + paddleW / 2, BOARD_W / 2 - paddleW / 2);
              boardHeight = Base.clamp(boardHeight - stickY * 0.9 * dt, 0.7, 2.2);

              const pressedX = Base.buttonPressed(gpL, 4);
              const pressedY = Base.buttonPressed(gpL, 5);
              if (pressedX && !animate._prev.x) presetIndex = (presetIndex + 1) % VIS_PRESETS.length;
              if (pressedY && !animate._prev.y) blockProgramIndex = (blockProgramIndex + 1) % BLOCK_PROGRAMS.length;
              animate._prev.x = pressedX;
              animate._prev.y = pressedY;
            }

            if (gpR) {
              const axes = gpR.axes || [];
              let stickX = 0;
              let stickY = 0;
              if (axes.length >= 4) {
                stickX = axes[2];
                stickY = axes[3];
              } else if (axes.length >= 2) {
                stickX = axes[0];
                stickY = axes[1];
              }
              stickX = Base.deadzone(stickX, 0.12);
              stickY = Base.deadzone(stickY, 0.12);

              boardDistance = Base.clamp(boardDistance - stickY * 0.9 * dt, 0.9, 4.0);
              boardScale = Base.clamp(boardScale + stickX * 0.9 * dt, 0.6, 2.2);

              const pressedA = Base.buttonPressed(gpR, 4);
              const pressedB = Base.buttonPressed(gpR, 5);
              if (pressedA && !animate._prev.a) pulseEnabled = !pulseEnabled;
              if (pressedB && !animate._prev.b) pulsePeriodIndex = (pulsePeriodIndex + 1) % PULSE_PERIODS.length;
              animate._prev.a = pressedA;
              animate._prev.b = pressedB;
            }
          }

          updatePaddleMeshWidth();

          // Update board placement
          if (boardGroup) {
            boardGroup.position.set(0, boardHeight, -boardDistance);
            boardGroup.scale.setScalar(boardScale);
          }

          // Paddle meshes
          if (paddle?.mesh) {
            paddle.mesh.left.position.set(paddleX, paddleY, 0);
            paddle.mesh.right.position.set(paddleX, paddleY, 0);
          }

          // Ball movement
          if (dt > 0) {
            if (ballStuck) {
              ballX = paddleX;
              ballY = paddleY + 0.12;
            } else {
              ballX += ballVX * dt;
              ballY += ballVY * dt;

              const minX = -BOARD_W / 2 + ballR;
              const maxX = BOARD_W / 2 - ballR;
              const minY = -BOARD_H / 2 - 0.2; // below bottom = loss
              const maxY = BOARD_H / 2 - ballR;

              if (ballX < minX) {
                ballX = minX;
                ballVX *= -1;
              }
              if (ballX > maxX) {
                ballX = maxX;
                ballVX *= -1;
              }
              if (ballY > maxY) {
                ballY = maxY;
                ballVY *= -1;
              }

              // Paddle collision
              const hitPaddle = collideBallWithAabb(ballX, ballY, ballR, paddleX, paddleY, paddleW, paddleH);
              if (hitPaddle && ballVY < 0 && hitPaddle.axis === 'y') {
                ballY = paddleY + paddleH / 2 + ballR;

                const hit = Base.clamp((ballX - paddleX) / (paddleW / 2), -1, 1);
                const angle = (Math.PI / 2) + hit * (Math.PI / 3);
                const speed = 0.92;
                ballVX = Math.cos(angle) * speed;
                ballVY = Math.sin(angle) * speed;
              }

              // Block collisions
              for (const b of blocks) {
                if (!b.alive) continue;
                const hit = collideBallWithAabb(ballX, ballY, ballR, b.x, b.y, b.w, b.h);
                if (!hit) continue;

                b.alive = false;
                score += 10;

                if (b.mesh?.left) boardGroup.remove(b.mesh.left);
                if (b.mesh?.right) boardGroup.remove(b.mesh.right);

                maybeSpawnPowerup(b.x, b.y);

                if (hit.axis === 'x') ballVX *= -1;
                else ballVY *= -1;

                break;
              }

              // Win condition: all blocks cleared
              if (blocks.length > 0 && blocks.every((b) => !b.alive)) {
                buildBlocks();
                resetBall(true);
              }

              // Loss
              if (ballY < minY) {
                lives--;
                if (lives <= 0) {
                  cleanupPowerups();
                  resetBall(true);
                } else {
                  resetBall(true);
                }
              }
            }
          }

          // Ball meshes
          if (ball?.mesh) {
            ball.mesh.left.position.set(ballX, ballY, 0);
            ball.mesh.right.position.set(ballX, ballY, 0);
          }

          // Powerups
          for (let i = powerups.length - 1; i >= 0; i--) {
            const p = powerups[i];
            p.y += p.vy * dt;
            p.mesh.left.position.set(p.x, p.y, 0);
            p.mesh.right.position.set(p.x, p.y, 0);

            // Catch
            const caught = Math.abs(p.x - paddleX) < paddleW / 2 + 0.04 && Math.abs(p.y - paddleY) < paddleH / 2 + 0.05;
            if (caught) {
              widenUntilMs = performance.now() + 10000;
              score += 25;
              boardGroup.remove(p.mesh.left);
              boardGroup.remove(p.mesh.right);
              powerups.splice(i, 1);
              continue;
            }

            // Miss
            if (p.y < -BOARD_H / 2 - 0.25) {
              boardGroup.remove(p.mesh.left);
              boardGroup.remove(p.mesh.right);
              powerups.splice(i, 1);
            }
          }

          // Apply dichoptic visibility
          const preset = currentPreset();

          const ballEye = eyeOpacitiesFromMode(preset.ball, tSec, 0.0);
          const paddleEye = eyeOpacitiesFromMode(preset.paddle, tSec, 0.35);
          const prizeEye = eyeOpacitiesFromMode(preset.prizes, tSec, 0.7);

          setOpacity(ball.mesh.left, ballEye.l * pulse.l);
          setOpacity(ball.mesh.right, ballEye.r * pulse.r);

          setOpacity(paddle.mesh.left, paddleEye.l * pulse.l);
          setOpacity(paddle.mesh.right, paddleEye.r * pulse.r);

          for (const b of blocks) {
            if (!b.alive) continue;
            const o = eyeOpacitiesForBlock(b, tSec);
            setOpacity(b.mesh.left, o.l * pulse.l);
            setOpacity(b.mesh.right, o.r * pulse.r);
          }

          for (const p of powerups) {
            setOpacity(p.mesh.left, prizeEye.l * pulse.l);
            setOpacity(p.mesh.right, prizeEye.r * pulse.r);
          }

          // HUD
          const nowMs = performance.now();
          if (hudPanel && nowMs - hudLastUpdateAtMs > 250) {
            const pulseTxt = pulseEnabled ? `ON (${pulsePeriodSeconds().toFixed(1)}s)` : 'OFF';
            const widenTxt = nowMs < widenUntilMs ? 'WIDE ✅' : '—';
            const prog = BLOCK_PROGRAMS[blockProgramIndex] || BLOCK_PROGRAMS[0];

            const hintServe = lives <= 0 ? 'Триггер: рестарт' : ballStuck ? 'Триггер: подача' : 'Триггер: (в игре)';

            const txt =
              `Тренажёр: Block Breaker\n` +
              `Preset: ${preset.name}  (X)\n` +
              `Blocks: ${prog.name}  (Y)\n` +
              `Пульсация: ${pulseTxt} (A/B)\n` +
              `Левый стик: бита + высота\n` +
              `Правый стик: дистанция + масштаб (Scale: ${boardScale.toFixed(2)})\n` +
              `${hintServe}\n` +
              `Score: ${score}   Lives: ${lives}   Power: ${widenTxt}`;

            Base.updateHudPanel(THREE, hudState, hudPanel, txt, lives <= 0 ? '#7a1f1f' : '#222222');
            hudLastUpdateAtMs = nowMs;
          }

          // Layers per eye
          const xrCamera = renderer.xr.getCamera(camera);
          if (xrCamera && xrCamera.isArrayCamera && xrCamera.cameras && xrCamera.cameras.length >= 2) {
            xrCamera.cameras[0].layers.enable(0);
            xrCamera.cameras[0].layers.enable(1);
            xrCamera.cameras[0].layers.disable(2);

            xrCamera.cameras[1].layers.enable(0);
            xrCamera.cameras[1].layers.enable(2);
            xrCamera.cameras[1].layers.disable(1);
          }

          renderer.render(scene, camera);
        }

        initThreeJS();

        const session = await Base.requestAndStartXRSession({
          renderer,
          container: ctx.container,
          log: ctx.log,
          requiredFeatures: ['local-floor'],
        });

        session.addEventListener('end', () => {
          ctx.log('VR завершён');
          ctx.container.style.display = 'block';
          ctx.startBtn.disabled = false;
        });

        renderer.setAnimationLoop(animate);
      },
    };
  }

  window.WebXRTrainers = window.WebXRTrainers || {};
  window.WebXRTrainers.blockbreaker = createBlockBreakerTrainer;
})();
