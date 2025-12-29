(function () {
  'use strict';

  function createZigzagSplitTexture(THREE, side, outerRadius, innerRadius) {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    const pxPerUnit = (size * 0.48) / outerRadius;
    ctx.scale(pxPerUnit, pxPerUnit);

    // Base: disk or ring
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(0, 0, outerRadius, 0, Math.PI * 2, false);
    if (innerRadius > 0.0001) {
      ctx.arc(0, 0, innerRadius, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    } else {
      ctx.fill();
    }

    // Mask half with zig boundary
    ctx.globalCompositeOperation = 'destination-in';
    const big = outerRadius * 3;
    const amp = outerRadius * 0.12;
    const teeth = 10;
    const boundary = [];
    for (let i = 0; i <= teeth; i++) {
      const y = -outerRadius + (2 * outerRadius * i) / teeth;
      const x = i % 2 === 0 ? amp : -amp;
      boundary.push({ x, y });
    }

    ctx.beginPath();
    if (side === 'left') {
      ctx.moveTo(-big, -big);
      ctx.lineTo(boundary[0].x, boundary[0].y);
      for (let i = 1; i < boundary.length; i++) ctx.lineTo(boundary[i].x, boundary[i].y);
      ctx.lineTo(-big, big);
      ctx.closePath();
    } else {
      ctx.moveTo(big, -big);
      ctx.lineTo(big, big);
      for (let i = boundary.length - 1; i >= 0; i--) ctx.lineTo(boundary[i].x, boundary[i].y);
      ctx.closePath();
    }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  function createBinocularTrainer() {
    return {
      id: 'binocular',
      name: 'Binocular MVP',
      async start(ctx) {
        const THREE = window.THREE;
        const Base = window.WebXRBase;

        let scene, camera, renderer;
        let stimulusGroup;
        let crosshair;

        // Stimuli
        let leftRing;
        let rightDot;
        let rightGuideRing;
        let leftHalfDisk;
        let rightHalfDisk;
        let leftZigSplit;
        let rightZigSplit;

        // HUD
        const hudState = { hudLastText: '', hudLastBg: '' };
        let hudPanel;
        let hudLastUpdateAtMs = 0;

        // Trainer parameters
        let targetDistance = 2.0;
        let targetHeight = 1.6;
        let disparityX = 0.25;
        const tolerance = 0.015;
        let score = 0;
        let trials = 0;
        let lastTimeMs = 0;
        let lastSelectAtMs = -1e9;

        const MODES = ['alignment', 'split'];
        let modeIndex = 0;

        const SPLIT_SHAPES = ['vertical', 'horizontal', 'zigzag'];
        let splitShapeIndex = 0;

        let pulseEnabled = false;
        const PULSE_PERIODS = [0.6, 1.0, 1.6, 2.4];
        let pulsePeriodIndex = 1;

        let rotationEnabled = false;

        function randomizeTrial() {
          const mag = 0.08 + Math.random() * 0.3;
          const sign = Math.random() < 0.5 ? -1 : 1;
          disparityX = mag * sign;
          trials++;
        }

        function currentMode() {
          return MODES[modeIndex] || 'alignment';
        }

        function pulsePeriodSeconds() {
          return PULSE_PERIODS[pulsePeriodIndex] || 1.0;
        }

        function currentSplitShape() {
          return SPLIT_SHAPES[splitShapeIndex] || 'vertical';
        }

        function applyModeVisibility() {
          const mode = currentMode();
          if (leftRing) leftRing.visible = mode === 'alignment';
          if (rightDot) rightDot.visible = mode === 'alignment';
          if (rightGuideRing) rightGuideRing.visible = mode === 'alignment';

          const splitShape = currentSplitShape();
          const useZig = mode === 'split' && splitShape === 'zigzag';
          if (leftHalfDisk) leftHalfDisk.visible = mode === 'split' && !useZig;
          if (rightHalfDisk) rightHalfDisk.visible = mode === 'split' && !useZig;
          if (leftZigSplit) leftZigSplit.visible = useZig;
          if (rightZigSplit) rightZigSplit.visible = useZig;
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

          crosshair = new THREE.Group();
          crosshair.layers.set(0);
          const chMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
          const chH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.01, 0.01), chMat);
          const chV = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.2, 0.01), chMat);
          crosshair.add(chH);
          crosshair.add(chV);
          stimulusGroup.add(crosshair);

          // Alignment: ring (left) + disk + guide (right)
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

          // Split: solid disk halves
          const SPLIT_RADIUS = RING_RADIUS;
          const splitMatLeft = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 1.0, side: THREE.DoubleSide });
          const splitMatRight = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0, side: THREE.DoubleSide });

          leftHalfDisk = new THREE.Mesh(new THREE.CircleGeometry(SPLIT_RADIUS, 72, Math.PI / 2, Math.PI), splitMatLeft);
          leftHalfDisk.layers.set(1);
          stimulusGroup.add(leftHalfDisk);

          rightHalfDisk = new THREE.Mesh(new THREE.CircleGeometry(SPLIT_RADIUS, 72, -Math.PI / 2, Math.PI), splitMatRight);
          rightHalfDisk.layers.set(2);
          stimulusGroup.add(rightHalfDisk);

          // Zigzag split (disk)
          const outer = RING_RADIUS;
          const inner = 0;
          const zigSize = outer * 2 * 1.1;
          const zigGeom = new THREE.PlaneGeometry(zigSize, zigSize);
          const zigLeftTex = createZigzagSplitTexture(THREE, 'left', outer, inner);
          const zigRightTex = createZigzagSplitTexture(THREE, 'right', outer, inner);

          leftZigSplit = new THREE.Mesh(
            zigGeom,
            new THREE.MeshBasicMaterial({ map: zigLeftTex, transparent: true, opacity: 1.0, side: THREE.DoubleSide })
          );
          leftZigSplit.layers.set(1);
          stimulusGroup.add(leftZigSplit);

          rightZigSplit = new THREE.Mesh(
            zigGeom,
            new THREE.MeshBasicMaterial({ map: zigRightTex, transparent: true, opacity: 1.0, side: THREE.DoubleSide })
          );
          rightZigSplit.layers.set(2);
          stimulusGroup.add(rightZigSplit);

          applyModeVisibility();

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
            if (aligned) score++;
            const bg = aligned ? '#1f7a3a' : '#7a1f1f';
            const txt = aligned ? 'OK ✅  Следующий раунд' : 'Не совпало ❌  Попробуйте ещё';
            Base.updateHudPanel(THREE, hudState, hudPanel, txt, bg);

            randomizeTrial();
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

          randomizeTrial();
          ctx.log('✅ Three.js готов');
        }

        function animate(time) {
          const dt = lastTimeMs ? (time - lastTimeMs) / 1000 : 0;
          lastTimeMs = time;

          const splitRot = currentSplitShape() === 'horizontal' ? Math.PI / 2 : 0;
          const rotSpeed = rotationEnabled ? time * 0.0003 : 0;

          if (leftRing) leftRing.rotation.z = rotSpeed;
          if (leftHalfDisk) leftHalfDisk.rotation.z = splitRot + rotSpeed;
          if (rightHalfDisk) rightHalfDisk.rotation.z = splitRot + rotSpeed;
          if (leftZigSplit) leftZigSplit.rotation.z = rotSpeed;
          if (rightZigSplit) rightZigSplit.rotation.z = rotSpeed;

          const session = renderer.xr.getSession();
          if (session && dt > 0) {
            const gpR = Base.getGamepad(session, 'right');
            const gpL = Base.getGamepad(session, 'left');

            if (!animate._prev) animate._prev = { a: false, b: false, x: false, y: false };

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

              const pressedA = Base.buttonPressed(gpR, 4);
              const pressedB = Base.buttonPressed(gpR, 5);

              if (pressedA && !animate._prev.a) pulseEnabled = !pulseEnabled;
              if (pressedB && !animate._prev.b) pulsePeriodIndex = (pulsePeriodIndex + 1) % PULSE_PERIODS.length;

              animate._prev.a = pressedA;
              animate._prev.b = pressedB;
            }

            if (gpL) {
              const axes = gpL.axes || [];
              let stickY = 0;
              if (axes.length >= 4) stickY = axes[3];
              else if (axes.length >= 2) stickY = axes[1];
              stickY = Base.deadzone(stickY, 0.12);
              targetHeight = Base.clamp(targetHeight - stickY * 0.9 * dt, 0.7, 2.2);

              // X/Y on left controller
              const pressedX = Base.buttonPressed(gpL, 4);
              const pressedY = Base.buttonPressed(gpL, 5);

              if (pressedX && !animate._prev.x) {
                modeIndex = (modeIndex + 1) % MODES.length;
                applyModeVisibility();
              }
              if (pressedY && !animate._prev.y) {
                splitShapeIndex = (splitShapeIndex + 1) % SPLIT_SHAPES.length;
                applyModeVisibility();
              }

              animate._prev.x = pressedX;
              animate._prev.y = pressedY;
            }
          }

          const period = pulsePeriodSeconds();
          const halfPeriod = period / 2;
          const tSec = time / 1000;
          const phaseIndex = pulseEnabled ? Math.floor(tSec / halfPeriod) % 2 : -1;
          const localT = pulseEnabled ? (tSec % halfPeriod) / halfPeriod : 0;
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
          setOpacityValue(leftHalfDisk, leftOpacity);
          setOpacityValue(leftZigSplit, leftOpacity);
          setOpacityValue(rightDot, rightOpacity);
          setOpacityValue(rightGuideRing, rightOpacity);
          setOpacityValue(rightHalfDisk, rightOpacity);
          setOpacityValue(rightZigSplit, rightOpacity);

          if (stimulusGroup) stimulusGroup.position.set(0, targetHeight, -targetDistance);

          if (leftRing) leftRing.position.set(-disparityX / 2, 0, 0);
          if (leftHalfDisk) leftHalfDisk.position.set(-disparityX / 2, 0, 0);
          if (leftZigSplit) leftZigSplit.position.set(-disparityX / 2, 0, 0);
          if (rightDot) rightDot.position.set(disparityX / 2, 0, 0);
          if (rightGuideRing) rightGuideRing.position.set(disparityX / 2, 0, 0);
          if (rightHalfDisk) rightHalfDisk.position.set(disparityX / 2, 0, 0);
          if (rightZigSplit) rightZigSplit.position.set(disparityX / 2, 0, 0);

          const nowMs = performance.now();
          const alignedNow = Math.abs(disparityX) <= tolerance;
          const modeNow = currentMode();
          if (rightGuideRing) rightGuideRing.visible = modeNow === 'alignment' && !alignedNow;

          if (hudPanel && nowMs - hudLastUpdateAtMs > 250) {
            const shape = currentSplitShape();
            const pulse = pulseEnabled ? `ON (${period.toFixed(1)}s)` : 'OFF';
            const rot = rotationEnabled ? 'ON' : 'OFF';
            const hint = alignedNow ? 'СОВПАЛО ✅  Нажмите триггер' : 'Совместите и нажмите триггер';
            const txt =
              `Тренажёр: Binocular MVP\n` +
              `Режим: ${modeNow} (X)   |   Split-фигура: ${shape} (Y)\n` +
              `Пульсация: ${pulse} (A/B)   |   Вращение: ${rot} (Grip)\n` +
              `Правый стик: смещение/дистанция   Левый стик: высота\n` +
              `Dist: ${targetDistance.toFixed(2)}m  Height: ${targetHeight.toFixed(2)}m  |dx|: ${Math.abs(disparityX).toFixed(3)}m\n` +
              `Счёт: ${score}/${trials}   |   ${hint}`;

            Base.updateHudPanel(THREE, hudState, hudPanel, txt, alignedNow ? '#1f7a3a' : '#222222');
            hudLastUpdateAtMs = nowMs;
          }

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
  window.WebXRTrainers.binocular = createBinocularTrainer;
})();
