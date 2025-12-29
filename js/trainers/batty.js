(function () {
  'use strict';

  function createBattyTrainer() {
    return {
      id: 'batty',
      name: 'Batty',
      async start(ctx) {
        const THREE = window.THREE;
        const Base = window.WebXRBase;

        let scene, camera, renderer;
        let stimulusGroup;

        let crosshair;
        let leftRing;
        let rightDot;
        let rightGuideRing;

        const hudState = { hudLastText: '', hudLastBg: '' };
        let hudPanel;
        let hudLastUpdateAtMs = 0;

        let targetDistance = 2.0;
        let targetHeight = 1.6;
        let disparityX = 0.25;
        const tolerance = 0.015;

        let pulseEnabled = false;
        const PULSE_PERIODS = [0.6, 1.0, 1.6, 2.4];
        let pulsePeriodIndex = 1;

        let rotationEnabled = false;

        let motionSeed = Math.random() * 1000;
        let baseOffsetX = 0;
        let baseOffsetY = 0;

        let caught = 0;
        let alignedTimeSec = 0;
        let lastTimeMs = 0;
        let lastSelectAtMs = -1e9;

        function pulsePeriodSeconds() {
          return PULSE_PERIODS[pulsePeriodIndex] || 1.0;
        }

        function respawnTarget() {
          const mag = 0.08 + Math.random() * 0.3;
          const sign = Math.random() < 0.5 ? -1 : 1;
          disparityX = mag * sign;

          motionSeed = Math.random() * 1000;
          baseOffsetX = (Math.random() * 2 - 1) * 0.12;
          baseOffsetY = (Math.random() * 2 - 1) * 0.06;
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

          scene.add(new THREE.AmbientLight(0xffffff, 0.8));
          const light1 = new THREE.DirectionalLight(0xffffff, 0.8);
          light1.position.set(2, 3, 2);
          scene.add(light1);

          stimulusGroup = new THREE.Group();
          scene.add(stimulusGroup);

          // Fixation cross (shared)
          crosshair = new THREE.Group();
          crosshair.layers.set(0);
          const chMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
          const chH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.01, 0.01), chMat);
          const chV = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.2, 0.01), chMat);
          crosshair.add(chH);
          crosshair.add(chV);
          stimulusGroup.add(crosshair);

          // Batty stimulus: moving alignment ring (left) + disk + guide (right)
          const RING_RADIUS = 0.14;
          const RING_TUBE = 0.02;
          const RING_INNER_RADIUS = RING_RADIUS - RING_TUBE;

          const ringMatLeft = new THREE.MeshStandardMaterial({
            color: 0xff4d4d,
            emissive: 0xff0000,
            emissiveIntensity: 0.25,
            transparent: true,
            opacity: 1.0,
          });
          leftRing = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 12, 64), ringMatLeft);
          leftRing.layers.set(1);
          stimulusGroup.add(leftRing);

          const dotMatRight = new THREE.MeshBasicMaterial({
            color: 0xff4d4d,
            transparent: true,
            opacity: 1.0,
            side: THREE.DoubleSide,
          });
          rightDot = new THREE.Mesh(new THREE.CircleGeometry(RING_INNER_RADIUS, 48), dotMatRight);
          rightDot.layers.set(2);
          stimulusGroup.add(rightDot);

          const guideMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.35 });
          rightGuideRing = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, 0.008, 10, 64), guideMat);
          rightGuideRing.layers.set(2);
          stimulusGroup.add(rightGuideRing);

          hudPanel = Base.createHudPanel(THREE, '...', '#222222');
          hudPanel.position.set(0, 2.2, -2.3);
          scene.add(hudPanel);

          const floorGeom = new THREE.PlaneGeometry(10, 10);
          const floorMat = new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide });
          const floor = new THREE.Mesh(floorGeom, floorMat);
          floor.rotation.x = -Math.PI / 2;
          floor.position.y = 0;
          scene.add(floor);

          const grid = new THREE.GridHelper(10, 20, 0x666666, 0x444444);
          grid.position.y = 0.01;
          scene.add(grid);

          const controller0 = renderer.xr.getController(0);
          const controller1 = renderer.xr.getController(1);

          const onSelect = () => {
            const now = performance.now();
            if (now - lastSelectAtMs < 250) return;
            lastSelectAtMs = now;

            const aligned = Math.abs(disparityX) <= tolerance;
            if (aligned) {
              caught++;
              respawnTarget();
              Base.updateHudPanel(THREE, hudState, hudPanel, 'Поймал ✅', '#1f7a3a');
            } else {
              Base.updateHudPanel(THREE, hudState, hudPanel, 'Не совпало ❌', '#7a1f1f');
            }
          };

          const onSqueeze = () => {
            rotationEnabled = !rotationEnabled;
          };

          controller0.addEventListener('selectstart', onSelect);
          controller1.addEventListener('selectstart', onSelect);
          controller0.addEventListener('squeezestart', onSqueeze);
          controller1.addEventListener('squeezestart', onSqueeze);

          scene.add(controller0);
          scene.add(controller1);

          ctx.log('✅ Three.js готов');
        }

        function animate(time) {
          const dt = lastTimeMs ? (time - lastTimeMs) / 1000 : 0;
          lastTimeMs = time;

          // Controller input
          const session = renderer.xr.getSession();
          if (session && dt > 0) {
            const gpR = Base.getGamepad(session, 'right');

            if (!animate._prev) animate._prev = { a: false, b: false };

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

              disparityX = Base.clamp(disparityX + stickX * 0.6 * dt, -0.6, 0.6);
              targetDistance = Base.clamp(targetDistance - stickY * 0.9 * dt, 0.6, 4.0);

              // A/B on right controller
              const pressedA = Base.buttonPressed(gpR, 4);
              const pressedB = Base.buttonPressed(gpR, 5);
              if (pressedA && !animate._prev.a) pulseEnabled = !pulseEnabled;
              if (pressedB && !animate._prev.b) pulsePeriodIndex = (pulsePeriodIndex + 1) % PULSE_PERIODS.length;
              animate._prev.a = pressedA;
              animate._prev.b = pressedB;
            }

            const gpL = Base.getGamepad(session, 'left');
            if (gpL) {
              const axes = gpL.axes || [];
              let stickY = 0;
              if (axes.length >= 4) stickY = axes[3];
              else if (axes.length >= 2) stickY = axes[1];
              stickY = Base.deadzone(stickY, 0.12);
              targetHeight = Base.clamp(targetHeight - stickY * 0.9 * dt, 0.7, 2.2);
            }
          }

          // Motion path (bat flying)
          const t = time / 1000 + motionSeed;
          const pathX = baseOffsetX + 0.22 * Math.sin(t * 0.9);
          const pathY = baseOffsetY + 0.10 * Math.sin(t * 1.3 + 1.1);

          if (stimulusGroup) stimulusGroup.position.set(pathX, targetHeight + pathY, -targetDistance);

          // Optional rotation
          const rot = rotationEnabled ? time * 0.0003 : 0;
          if (leftRing) leftRing.rotation.z = rot;

          // Pulsing
          const period = pulsePeriodSeconds();
          const halfPeriod = period / 2;
          const phaseIndex = pulseEnabled ? Math.floor(t / halfPeriod) % 2 : -1;
          const localT = pulseEnabled ? (t % halfPeriod) / halfPeriod : 0;
          const pulseAlpha = pulseEnabled ? 0.05 + 0.95 * Base.easeOutCubic(localT) : 1.0;
          const leftOpacity = !pulseEnabled ? 1.0 : phaseIndex === 0 ? pulseAlpha : 1.0;
          const rightOpacity = !pulseEnabled ? 1.0 : phaseIndex === 1 ? pulseAlpha : 1.0;

          function setOpacityValue(mesh, opacity) {
            if (!mesh || !mesh.material) return;
            mesh.material.opacity = opacity;
            mesh.material.transparent = opacity < 1.0;
            mesh.material.needsUpdate = true;
          }

          setOpacityValue(leftRing, leftOpacity);
          setOpacityValue(rightDot, rightOpacity);
          setOpacityValue(rightGuideRing, rightOpacity);

          // Disparity offset
          if (leftRing) leftRing.position.set(-disparityX / 2, 0, 0);
          if (rightDot) rightDot.position.set(disparityX / 2, 0, 0);
          if (rightGuideRing) rightGuideRing.position.set(disparityX / 2, 0, 0);

          const alignedNow = Math.abs(disparityX) <= tolerance;
          if (alignedNow) alignedTimeSec += dt;
          if (rightGuideRing) rightGuideRing.visible = !alignedNow;

          const nowMs = performance.now();
          if (hudPanel && nowMs - hudLastUpdateAtMs > 250) {
            const pulse = pulseEnabled ? `ON (${period.toFixed(1)}s)` : 'OFF';
            const rotTxt = rotationEnabled ? 'ON' : 'OFF';
            const hint = alignedNow ? 'СОВПАЛО ✅  Нажмите триггер (поймать)' : 'Совместите и нажмите триггер';
            const txt =
              `Тренажёр: Batty\n` +
              `Пульсация: ${pulse} (A/B)   |   Вращение: ${rotTxt} (Grip)\n` +
              `Правый стик: смещение/дистанция   Левый стик: высота\n` +
              `Dist: ${targetDistance.toFixed(2)}m  Height: ${targetHeight.toFixed(2)}m  |dx|: ${Math.abs(disparityX).toFixed(3)}m\n` +
              `Поймано: ${caught}   |   Время в совпадении: ${alignedTimeSec.toFixed(1)}s\n` +
              `${hint}`;

            Base.updateHudPanel(THREE, hudState, hudPanel, txt, alignedNow ? '#1f7a3a' : '#222222');
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
  window.WebXRTrainers.batty = createBattyTrainer;
})();
