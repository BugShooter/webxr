(function () {
  'use strict';

  function createBlockBreakerTrainer() {
    const ID = 'blockbreaker';

    // Game constants
    const BOARD_W = 1.4;
    const BOARD_H = 0.9;
    const paddleH = 0.06;
    const paddleY = -BOARD_H / 2 + 0.10;
    const ballR = 0.035;

    // This trainer is intentionally simplified:
    // - Uses the global 4-phase ALT fade profile (ON / OUT / OFF / IN)
    // - Applies it in a fixed chain across elements:
    //   Paddle L, Paddle R, Ball L, Ball R, Paddle+Ball L, Paddle+Ball R, Blocks L, Blocks R, repeat.

    // Runtime state
    let THREE;
    let Base;
    let scene;

    let boardGroup;
    let hudPanel;
    const hudState = { hudLastText: '', hudLastBg: '' };
    let hudLastUpdateAtMs = 0;

    // Game state
    let paddleW = 0.42;
    let paddleX = 0;

    let ballX = 0;
    let ballY = paddleY + 0.12;
    let ballVX = 0.45;
    let ballVY = 0.65;
    let ballStuck = true;

    // Diagnostics
    let frameId = 0;
    let lastErr = '';
    let lastErrAtMs = -1e9;

    let blocks = [];
    let powerups = [];

    let score = 0;
    let lives = 3;
    let lastServeAtMs = -1e9;
    let widenUntilMs = -1e9;

    // Mesh handles
    let paddle;
    let ball;

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
      const leftMat = new THREE.MeshStandardMaterial({ ...matParams, transparent: true, opacity: 1.0 });
      const rightMat = new THREE.MeshStandardMaterial({ ...matParams, transparent: true, opacity: 1.0 });

      const left = new THREE.Mesh(geom, leftMat);
      const right = new THREE.Mesh(geom, rightMat);
      left.layers.set(1);
      right.layers.set(2);
      return { left, right };
    }

    function addDual(dual) {
      boardGroup.add(dual.left);
      boardGroup.add(dual.right);
    }

    function currentFadeProfile(settings) {
      const arr = settings?.fadeProfiles;
      const idx = settings?.fadeProfileIndex || 0;
      if (!Array.isArray(arr) || arr.length === 0) return null;
      return arr[idx] || arr[0];
    }

    function envelopeFromProfile(p, tInStage) {
      if (!p) return 1;
      const on = Math.max(0.0001, (p.onMs || 0) / 1000);
      const out = Math.max(0, (p.fadeOutMs || 0) / 1000);
      const off = Math.max(0, (p.offMs || 0) / 1000);
      const inn = Math.max(0, (p.fadeInMs || 0) / 1000);

      if (tInStage < on) return 1;
      const t1 = tInStage - on;
      if (t1 < out && out > 1e-6) {
        const k = t1 / out;
        return 1 - Base.easeOutCubic(k);
      }
      const t2 = t1 - out;
      if (t2 < off) return 0;
      const t3 = t2 - off;
      if (t3 < inn && inn > 1e-6) {
        const k = t3 / inn;
        return Base.easeOutCubic(k);
      }
      return 1;
    }

    function chainFade(settings, tSec) {
      if (!settings?.altFadeEnabled) return { stage: 0, l: 1, r: 1, label: 'OFF', stageLen: 0 };

      const p = currentFadeProfile(settings);
      const on = Math.max(0.0001, (p?.onMs || 0) / 1000);
      const out = Math.max(0, (p?.fadeOutMs || 0) / 1000);
      const off = Math.max(0, (p?.offMs || 0) / 1000);
      const inn = Math.max(0, (p?.fadeInMs || 0) / 1000);
      const stageLen = on + out + off + inn;
      if (!isFinite(stageLen) || stageLen <= 0.0002) return { stage: 0, l: 1, r: 1, label: 'ON', stageLen: 0 };

      const stage = Math.floor(tSec / stageLen) % 8;
      const u = ((tSec % stageLen) + stageLen) % stageLen;
      const env = 0.05 + 0.95 * envelopeFromProfile(p, u);

      const isLeftEyeStage = stage % 2 === 0;
      const l = isLeftEyeStage ? env : 1;
      const r = isLeftEyeStage ? 1 : env;

      const labels = [
        'Paddle L',
        'Paddle R',
        'Ball L',
        'Ball R',
        'Paddle+Ball L',
        'Paddle+Ball R',
        'Blocks L',
        'Blocks R',
      ];
      return { stage, l, r, label: labels[stage] || '—', stageLen };
    }

    function resetBall(stickToPaddle = true) {
      ballStuck = stickToPaddle;
      ballX = paddleX;
      ballY = paddleY + 0.12;

      const angle = (Math.random() * 0.6 - 0.3) + Math.PI / 2;
      const speed = 0.82;
      ballVX = Math.cos(angle) * speed;
      ballVY = Math.sin(angle) * speed;
    }

    function buildBlocks() {
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
          addDual(dual);
          dual.left.position.set(x, y, 0);
          dual.right.position.set(x, y, 0);

          const eyeRand = Math.random();
          const eye = eyeRand < 0.34 ? 'left' : eyeRand < 0.67 ? 'right' : 'both';

          blocks.push({ x, y, w: blockW, h: blockH, alive: true, mesh: dual, eye });
        }
      }
    }

    function updatePaddleMeshWidth() {
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

      if (px < py) return { axis: 'x', sign: Math.sign(dx) || 1 };
      return { axis: 'y', sign: Math.sign(dy) || 1 };
    }

    function maybeSpawnPowerup(x, y) {
      if (Math.random() > 0.28) return;

      const geom = new THREE.BoxGeometry(0.06, 0.06, 0.06);
      const dual = makeDualMesh(geom, { color: 0xffc04d, emissive: 0xffc04d, emissiveIntensity: 0.15 });
      addDual(dual);
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

    function disposeMesh(mesh) {
      if (!mesh) return;
      if (mesh.geometry) mesh.geometry.dispose?.();
      if (mesh.material) {
        if (mesh.material.map) mesh.material.map.dispose?.();
        mesh.material.dispose?.();
      }
    }

    function disposeDual(dual) {
      if (!dual) return;
      disposeMesh(dual.left);
      disposeMesh(dual.right);
    }

    return {
      id: ID,
      name: 'Block Breaker',

      init({ runtime, THREE: THREE0, Base: Base0, scene: scene0 }) {
        THREE = THREE0;
        Base = Base0;
        scene = scene0;

        boardGroup = new THREE.Group();
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

        // Paddle
        const paddleGeom = new THREE.BoxGeometry(paddleW, paddleH, 0.06);
        const paddleDual = makeDualMesh(paddleGeom, { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.1 });
        addDual(paddleDual);
        paddle = { mesh: paddleDual };

        // Ball
        const ballGeom = new THREE.SphereGeometry(ballR, 20, 16);
        const ballDual = makeDualMesh(ballGeom, { color: 0xff4d4d, emissive: 0xff0000, emissiveIntensity: 0.2 });
        addDual(ballDual);
        ball = { mesh: ballDual };

        buildBlocks();
        resetBall(true);

        hudPanel = Base.createHudPanel(THREE, '...', '#222222');
        hudPanel.position.set(0, 2.45, -2.85);
        hudPanel.rotation.x = 0.25;
        scene.add(hudPanel);

        // reset game
        score = 0;
        lives = 3;
        powerups = [];
        widenUntilMs = -1e9;
        lastServeAtMs = -1e9;

        // ensure menu exists
        void runtime;
      },

      update({ t, dt, input, settings, fade }) {
        if (!boardGroup) return;

        frameId++;
        const tSec = t;
        const nowMs = performance.now();

        // Serve/restart
        // Primary: Right trigger (edge) and/or WebXR select (trigger). Fallback: A.
        if (input?.justTriggerR || input?.justSelect || input?.justA) {
          if (nowMs - lastServeAtMs > 250) {
            lastServeAtMs = nowMs;
            if (lives <= 0) {
              score = 0;
              lives = 3;
              cleanupPowerups();
              widenUntilMs = -1e9;
              buildBlocks();
              resetBall(true);
            } else if (ballStuck) {
              // Reinitialize velocity on every serve to avoid rare zero/NaN velocity states.
              resetBall(false);
            }
          }
        }

        // No extra modes: keep this trainer focused.

        // Paddle movement
        const stickX = input?.axesR?.x || 0;
        paddleX = Base.clamp(paddleX + stickX * 1.2 * dt, -BOARD_W / 2 + paddleW / 2, BOARD_W / 2 - paddleW / 2);

        updatePaddleMeshWidth();

        // Board placement from global settings
        boardGroup.position.set(0, settings.height, -settings.distance);
        boardGroup.scale.setScalar(settings.scale);

        // Paddle meshes
        paddle.mesh.left.position.set(paddleX, paddleY, 0);
        paddle.mesh.right.position.set(paddleX, paddleY, 0);

        let chain = null;
        try {

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
            const minY = -BOARD_H / 2 - 0.2;
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
                boardGroup.remove(b.mesh.left);
                boardGroup.remove(b.mesh.right);
                disposeDual(b.mesh);
                maybeSpawnPowerup(b.x, b.y);
                if (hit.axis === 'x') ballVX *= -1;
                else ballVY *= -1;
                break;
              }

              if (blocks.length > 0 && blocks.every((b) => !b.alive)) {
                buildBlocks();
                resetBall(true);
              }

              if (ballY < minY) {
                lives--;
                if (lives <= 0) {
                  cleanupPowerups();
                }
                resetBall(true);
              }
            }
          }

          ball.mesh.left.position.set(ballX, ballY, 0);
          ball.mesh.right.position.set(ballX, ballY, 0);

          // Powerups
          for (let i = powerups.length - 1; i >= 0; i--) {
            const p = powerups[i];
            p.y += p.vy * dt;
            p.mesh.left.position.set(p.x, p.y, 0);
            p.mesh.right.position.set(p.x, p.y, 0);

            const caught =
              Math.abs(p.x - paddleX) < paddleW / 2 + 0.04 && Math.abs(p.y - paddleY) < paddleH / 2 + 0.05;
            if (caught) {
              widenUntilMs = nowMs + 10000;
              score += 25;
              boardGroup.remove(p.mesh.left);
              boardGroup.remove(p.mesh.right);
              disposeDual(p.mesh);
              powerups.splice(i, 1);
              continue;
            }

            if (p.y < -BOARD_H / 2 - 0.25) {
              boardGroup.remove(p.mesh.left);
              boardGroup.remove(p.mesh.right);
              disposeDual(p.mesh);
              powerups.splice(i, 1);
            }
          }

          // Apply the requested fade chain (4-phase profile, staged across elements)
          chain = chainFade(settings, tSec);
          const stage = chain.stage;

        const applyToPaddle = stage === 0 || stage === 1 || stage === 4 || stage === 5;
        const applyToBall = stage === 2 || stage === 3 || stage === 4 || stage === 5;
        const applyToBlocks = stage === 6 || stage === 7;

        const paddleL = applyToPaddle ? chain.l : 1;
        const paddleR = applyToPaddle ? chain.r : 1;
        const ballL = applyToBall ? chain.l : 1;
        const ballR = applyToBall ? chain.r : 1;
        const blocksL = applyToBlocks ? chain.l : 1;
        const blocksR = applyToBlocks ? chain.r : 1;

        setOpacity(ball.mesh.left, ballL);
        setOpacity(ball.mesh.right, ballR);

        setOpacity(paddle.mesh.left, paddleL);
        setOpacity(paddle.mesh.right, paddleR);

        for (const b of blocks) {
          if (!b.alive) continue;
          setOpacity(b.mesh.left, blocksL);
          setOpacity(b.mesh.right, blocksR);
        }

          for (const p of powerups) {
            setOpacity(p.mesh.left, blocksL);
            setOpacity(p.mesh.right, blocksR);
          }
        } catch (e) {
          const msg = e?.stack || e?.message || String(e);
          lastErr = String(msg).slice(0, 260);
          lastErrAtMs = nowMs;
        }

        // HUD
        if (hudPanel && nowMs - hudLastUpdateAtMs > 250) {
          const widenTxt = nowMs < widenUntilMs ? 'WIDE ✅' : '—';

          const hintServe = lives <= 0 ? 'Trigger/A: restart' : ballStuck ? 'Trigger/A: serve' : 'Trigger/A: —';
          const ballTxt = ballStuck ? 'READY (stuck)' : 'MOVING';

          const prof = currentFadeProfile(settings);
          const stageLabel = chain?.label || '—';
          const fadeTxt = settings?.altFadeEnabled ? `${prof?.name || 'profile'}  |  Stage: ${stageLabel}` : 'OFF';

          const inputsTxt = `input jTr:${!!input?.justTriggerR} jSel:${!!input?.justSelect} jA:${!!input?.justA}`;
          const stateTxt = `f:${frameId} dt:${(dt || 0).toFixed(4)} stuck:${ballStuck} serveAge:${Math.max(0, nowMs - lastServeAtMs).toFixed(0)}ms`;
          const posTxt = `paddleX:${paddleX.toFixed(3)} ballX:${ballX.toFixed(3)} ballY:${ballY.toFixed(3)}`;
          const velTxt = `vx:${(ballVX || 0).toFixed(3)} vy:${(ballVY || 0).toFixed(3)}`;
          const errTxt = nowMs - lastErrAtMs < 5000 ? `ERR: ${lastErr}` : 'ERR: —';

          const txt =
            `Тренажёр: Block Breaker\n` +
            `ALT fade (global): ${fadeTxt}\n` +
            `Move paddle: Right stick X\n` +
            `Menu: Left grip\n` +
            `${hintServe}   |   Ball: ${ballTxt}\n` +
            `${inputsTxt}\n` +
            `${stateTxt}\n` +
            `${posTxt}\n` +
            `${velTxt}\n` +
            `${errTxt}\n` +
            `Score: ${score}   Lives: ${lives}   Power: ${widenTxt}`;

          Base.updateHudPanel(THREE, hudState, hudPanel, txt, lives <= 0 ? '#7a1f1f' : '#222222');
          hudLastUpdateAtMs = nowMs;
        }
      },

      dispose() {
        if (!scene) return;
        if (hudPanel) {
          scene.remove(hudPanel);
          const map = hudPanel.material?.map;
          if (map) map.dispose();
          disposeMesh(hudPanel);
          hudPanel = null;
        }

        try {
          for (const b of blocks) {
            if (b.mesh) {
              boardGroup.remove(b.mesh.left);
              boardGroup.remove(b.mesh.right);
              disposeDual(b.mesh);
            }
          }
          for (const p of powerups) {
            boardGroup.remove(p.mesh.left);
            boardGroup.remove(p.mesh.right);
            disposeDual(p.mesh);
          }
        } catch (_) {
          // ignore
        }

        if (paddle?.mesh) disposeDual(paddle.mesh);
        if (ball?.mesh) disposeDual(ball.mesh);

        if (boardGroup) {
          scene.remove(boardGroup);
          boardGroup.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose?.();
            if (obj.material) {
              if (obj.material.map) obj.material.map.dispose?.();
              obj.material.dispose?.();
            }
          });
          boardGroup = null;
        }

        blocks = [];
        powerups = [];
      },
    };
  }

  window.WebXRTrainers = window.WebXRTrainers || {};
  window.WebXRTrainers.blockbreaker = createBlockBreakerTrainer;
})();
