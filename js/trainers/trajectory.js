(function () {
  'use strict';

  function createTrajectoryTrainer() {
    return {
      id: 'trajectory',
      name: 'Trajectory',
      async start(ctx) {
        const THREE = window.THREE;
        const Base = window.WebXRBase;

        let scene, camera, renderer;
        let group;

        const hudState = { hudLastText: '', hudLastBg: '' };
        let hudPanel;
        let hudLastUpdateAtMs = 0;

        let targetDistance = 2.2;
        let targetHeight = 1.55;
        let targetScale = 1.0;

        // Dot
        let dotLeft;
        let dotRight;

        // Orientation grid (shared)
        let orientationGrid;

        // Trail (shared)
        let trailEnabled = false;
        const trail = [];
        let lastTrailX = 1e9;
        let lastTrailY = 1e9;
        const TRAIL_R = 0.018;
        const TRAIL_DIAMETER = TRAIL_R * 2;
        const TRAIL_FADE_SEC = 1.3;

        // Per-eye fade
        const PULSE_PERIODS = [0.6, 1.0, 1.6, 2.4];
        let pulsePeriodIndex = 2;
        let altFadeEnabled = true;

        const PATHS = [
          { id: 'circle', name: 'Круг' },
          { id: 'eight', name: 'Восьмёрка' },
          { id: 'square', name: 'Квадрат' },
          { id: 'square_diag', name: 'Квадрат + диагонали' },
          { id: 'cross', name: 'Крест' },
          { id: 'rabitsa', name: 'Сетка рабица' },
        ];
        let pathIndex = 0;

        let lastTimeMs = 0;

        function currentPath() {
          return PATHS[pathIndex] || PATHS[0];
        }

        function pulsePeriodSeconds() {
          return PULSE_PERIODS[pulsePeriodIndex] || 1.6;
        }

        function makeGridLines() {
          const size = 1.2;
          const steps = 12;
          const verts = [];
          for (let i = 0; i <= steps; i++) {
            const t = -size / 2 + (size * i) / steps;
            // vertical
            verts.push(t, -size / 2, 0, t, size / 2, 0);
            // horizontal
            verts.push(-size / 2, t, 0, size / 2, t, 0);
          }

          const geom = new THREE.BufferGeometry();
          geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
          const mat = new THREE.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.25 });
          const lines = new THREE.LineSegments(geom, mat);
          lines.layers.set(0);
          return lines;
        }

        function makeDotMesh(layer, color, radius) {
          const geom = new THREE.CircleGeometry(radius, 36);
          const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1.0, side: THREE.DoubleSide });
          const mesh = new THREE.Mesh(geom, mat);
          mesh.layers.set(layer);
          return mesh;
        }

        function setOpacity(mesh, opacity) {
          if (!mesh || !mesh.material) return;
          const o = Base.clamp(opacity, 0, 1);
          mesh.material.opacity = o;
          mesh.material.transparent = o < 0.999;
          mesh.visible = o > 0.001;
          mesh.material.needsUpdate = true;
        }

        function altFadeOpacities(tSec) {
          if (!altFadeEnabled) return { l: 1, r: 1 };

          const segment = pulsePeriodSeconds();
          const phaseIndex = Math.floor(tSec / segment) % 2; // 0=left fades, 1=right fades
          const u = (tSec % segment) / segment; // 0..1

          // 1 -> 0 -> 1
          const env = 1 - (0.5 - 0.5 * Math.cos(u * Math.PI * 2));
          const active = 0.05 + 0.95 * env;

          return phaseIndex === 0 ? { l: active, r: 1 } : { l: 1, r: active };
        }

        function polylinePoint(points, t) {
          // points: [{x,y}], closed expected
          if (!points || points.length < 2) return { x: 0, y: 0 };

          let total = 0;
          const segLen = [];
          for (let i = 0; i < points.length - 1; i++) {
            const dx = points[i + 1].x - points[i].x;
            const dy = points[i + 1].y - points[i].y;
            const l = Math.hypot(dx, dy);
            segLen.push(l);
            total += l;
          }

          const dist = (t % 1) * total;
          let acc = 0;
          for (let i = 0; i < segLen.length; i++) {
            const l = segLen[i];
            if (acc + l >= dist) {
              const u = l > 1e-6 ? (dist - acc) / l : 0;
              return {
                x: points[i].x + (points[i + 1].x - points[i].x) * u,
                y: points[i].y + (points[i + 1].y - points[i].y) * u,
              };
            }
            acc += l;
          }

          return { x: points[0].x, y: points[0].y };
        }

        function pathPosition(tSec) {
          const id = currentPath().id;
          const R = 0.45;

          // Speed chosen to keep motion comfortable
          const speed = 0.22; // cycles/sec
          const tt = tSec * speed;

          if (id === 'circle') {
            const a = tt * Math.PI * 2;
            return { x: R * Math.cos(a), y: R * Math.sin(a) };
          }

          if (id === 'eight') {
            const a = tt * Math.PI * 2;
            return { x: R * Math.sin(a), y: R * Math.sin(a) * Math.cos(a) };
          }

          if (id === 'square') {
            const pts = [
              { x: -R, y: -R },
              { x: R, y: -R },
              { x: R, y: R },
              { x: -R, y: R },
              { x: -R, y: -R },
            ];
            return polylinePoint(pts, tt);
          }

          if (id === 'square_diag') {
            const pts = [
              { x: -R, y: -R },
              { x: R, y: -R },
              { x: R, y: R },
              { x: -R, y: R },
              { x: -R, y: -R },
              { x: R, y: R },
              { x: 0, y: 0 },
              { x: -R, y: R },
              { x: R, y: -R },
              { x: 0, y: 0 },
              { x: -R, y: -R },
            ];
            return polylinePoint(pts, tt);
          }

          if (id === 'cross') {
            const pts = [
              { x: 0, y: R },
              { x: 0, y: -R },
              { x: 0, y: 0 },
              { x: -R, y: 0 },
              { x: R, y: 0 },
              { x: 0, y: 0 },
              { x: 0, y: R },
            ];
            return polylinePoint(pts, tt);
          }

          // rabitsa: diamond-like loop
          const d = R;
          const pts = [
            { x: -d, y: 0 },
            { x: -d / 2, y: d / 2 },
            { x: 0, y: 0 },
            { x: d / 2, y: d / 2 },
            { x: d, y: 0 },
            { x: d / 2, y: -d / 2 },
            { x: 0, y: 0 },
            { x: -d / 2, y: -d / 2 },
            { x: -d, y: 0 },
          ];
          return polylinePoint(pts, tt);
        }

        function maybeAddTrailDot(x, y, nowSec) {
          if (!trailEnabled) return;

          const dx = x - lastTrailX;
          const dy = y - lastTrailY;
          if (Math.hypot(dx, dy) < TRAIL_DIAMETER) return;

          lastTrailX = x;
          lastTrailY = y;

          const mesh = makeDotMesh(0, 0xaaaaaa, TRAIL_R);
          mesh.material.opacity = 0.35;
          mesh.position.set(x, y, 0);
          group.add(mesh);
          trail.push({ mesh, bornAt: nowSec });
        }

        function updateTrail(nowSec) {
          for (let i = trail.length - 1; i >= 0; i--) {
            const t = trail[i];
            const age = nowSec - t.bornAt;
            const k = 1 - Base.clamp(age / TRAIL_FADE_SEC, 0, 1);
            setOpacity(t.mesh, 0.35 * k);
            if (age >= TRAIL_FADE_SEC) {
              group.remove(t.mesh);
              if (t.mesh.geometry) t.mesh.geometry.dispose();
              if (t.mesh.material) t.mesh.material.dispose();
              trail.splice(i, 1);
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
          const light1 = new THREE.DirectionalLight(0xffffff, 0.6);
          light1.position.set(2, 3, 1);
          scene.add(light1);

          const floorGeom = new THREE.PlaneGeometry(10, 10);
          const floorMat = new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide });
          const floor = new THREE.Mesh(floorGeom, floorMat);
          floor.rotation.x = -Math.PI / 2;
          floor.position.y = 0;
          scene.add(floor);

          const grid = new THREE.GridHelper(10, 20, 0x666666, 0x444444);
          grid.position.y = 0.01;
          scene.add(grid);

          group = new THREE.Group();
          group.position.set(0, targetHeight, -targetDistance);
          scene.add(group);

          orientationGrid = makeGridLines();
          group.add(orientationGrid);

          dotLeft = makeDotMesh(1, 0xff4d4d, 0.03);
          dotRight = makeDotMesh(2, 0xff4d4d, 0.03);
          group.add(dotLeft);
          group.add(dotRight);

          hudPanel = Base.createHudPanel(THREE, '...', '#222222');
          hudPanel.position.set(0, 2.45, -2.85);
          hudPanel.rotation.x = 0.25;
          scene.add(hudPanel);

          ctx.log('✅ Three.js готов');
        }

        function animate(timeMs) {
          const dt = lastTimeMs ? (timeMs - lastTimeMs) / 1000 : 0;
          lastTimeMs = timeMs;

          const tSec = timeMs / 1000;

          // Input
          const session = renderer.xr.getSession();
          if (session && dt > 0) {
            const gpL = Base.getGamepad(session, 'left');
            const gpR = Base.getGamepad(session, 'right');

            if (!animate._prev) animate._prev = { a: false, b: false, x: false, y: false };

            if (gpL) {
              const axes = gpL.axes || [];
              let stickY = 0;
              if (axes.length >= 4) stickY = axes[3];
              else if (axes.length >= 2) stickY = axes[1];
              stickY = Base.deadzone(stickY, 0.12);
              targetHeight = Base.clamp(targetHeight - stickY * 0.9 * dt, 0.7, 2.2);

              const pressedX = Base.buttonPressed(gpL, 4);
              const pressedY = Base.buttonPressed(gpL, 5);
              if (pressedX && !animate._prev.x) pathIndex = (pathIndex + 1) % PATHS.length;
              if (pressedY && !animate._prev.y) {
                trailEnabled = !trailEnabled;
                lastTrailX = 1e9;
                lastTrailY = 1e9;
              }
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

              targetDistance = Base.clamp(targetDistance - stickY * 0.9 * dt, 0.9, 4.0);
              targetScale = Base.clamp(targetScale + stickX * 0.9 * dt, 0.6, 2.2);

              const pressedA = Base.buttonPressed(gpR, 4);
              const pressedB = Base.buttonPressed(gpR, 5);
              if (pressedA && !animate._prev.a) altFadeEnabled = !altFadeEnabled;
              if (pressedB && !animate._prev.b) pulsePeriodIndex = (pulsePeriodIndex + 1) % PULSE_PERIODS.length;
              animate._prev.a = pressedA;
              animate._prev.b = pressedB;
            }
          }

          if (group) {
            group.position.set(0, targetHeight, -targetDistance);
            group.scale.setScalar(targetScale);
          }

          const pos = pathPosition(tSec);
          if (dotLeft) dotLeft.position.set(pos.x, pos.y, 0);
          if (dotRight) dotRight.position.set(pos.x, pos.y, 0);

          maybeAddTrailDot(pos.x, pos.y, tSec);
          updateTrail(tSec);

          const op = altFadeOpacities(tSec);
          setOpacity(dotLeft, op.l);
          setOpacity(dotRight, op.r);

          // HUD
          const nowMs = performance.now();
          if (hudPanel && nowMs - hudLastUpdateAtMs > 250) {
            const fadeTxt = altFadeEnabled ? `ALT (${pulsePeriodSeconds().toFixed(1)}s)` : 'OFF';
            const path = currentPath();
            const trailTxt = trailEnabled ? 'ON (Y)' : 'OFF (Y)';

            const txt =
              `Тренажёр: Trajectory\n` +
              `Траектория: ${path.name} (X)\n` +
              `Плавное исчезание: ${fadeTxt} (A/B)\n` +
              `След (серый): ${trailTxt}\n` +
              `Правый стик: дистанция + масштаб (Scale: ${targetScale.toFixed(2)})\n` +
              `Левый стик: высота (Height: ${targetHeight.toFixed(2)}m)`;

            Base.updateHudPanel(THREE, hudState, hudPanel, txt, '#222222');
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
  window.WebXRTrainers.trajectory = createTrajectoryTrainer;
})();
