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
    const ID = 'binocular';
    const MODES = ['alignment', 'split'];
    const SPLIT_SHAPES = ['vertical', 'horizontal', 'zigzag'];
    const PULSE_PERIODS = [0.6, 1.0, 1.6, 2.4];

    let THREE;
    let Base;
    let scene;

    let stimulusGroup;
    let crosshair;

    let leftRing;
    let rightDot;
    let rightGuideRing;
    let leftHalfDisk;
    let rightHalfDisk;
    let leftZigSplit;
    let rightZigSplit;

    const hudState = { hudLastText: '', hudLastBg: '' };
    let hudPanel;
    let hudLastUpdateAtMs = 0;

    let disparityX = 0.25;
    const tolerance = 0.015;
    let score = 0;
    let trials = 0;
    let lastSelectAtMs = -1e9;

    let modeIndex = 0;
    let splitShapeIndex = 0;
    let pulseEnabled = false;
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

    function currentSplitShape() {
      return SPLIT_SHAPES[splitShapeIndex] || 'vertical';
    }

    function pulsePeriodSeconds() {
      return PULSE_PERIODS[pulsePeriodIndex] || 1.0;
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

    function setOpacityValue(mesh, opacity) {
      if (!mesh || !mesh.material) return;
      mesh.material.opacity = opacity;
      mesh.material.transparent = opacity < 1.0;
      mesh.material.needsUpdate = true;
    }

    function initObjects() {
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

      const SPLIT_RADIUS = RING_RADIUS;
      const splitMatLeft = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 1.0, side: THREE.DoubleSide });
      const splitMatRight = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0, side: THREE.DoubleSide });

      leftHalfDisk = new THREE.Mesh(new THREE.CircleGeometry(SPLIT_RADIUS, 72, Math.PI / 2, Math.PI), splitMatLeft);
      leftHalfDisk.layers.set(1);
      stimulusGroup.add(leftHalfDisk);

      rightHalfDisk = new THREE.Mesh(new THREE.CircleGeometry(SPLIT_RADIUS, 72, -Math.PI / 2, Math.PI), splitMatRight);
      rightHalfDisk.layers.set(2);
      stimulusGroup.add(rightHalfDisk);

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
      hudPanel.position.set(0, 2.45, -2.85);
      hudPanel.rotation.x = 0.25;
      scene.add(hudPanel);

      randomizeTrial();
    }

    function disposeAny(obj) {
      if (!obj) return;
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose?.();
        obj.material.dispose?.();
      }
    }

    return {
      id: ID,
      name: 'Binocular MVP',

      init({ THREE: THREE0, Base: Base0, scene: scene0 }) {
        THREE = THREE0;
        Base = Base0;
        scene = scene0;
        initObjects();
      },

      update({ t, dt, input, settings, fade }) {
        // Trainer-specific: disparity adjustment on left stick X
        disparityX = Base.clamp(disparityX + (input.axesR.x || 0) * 0.6 * dt, -0.6, 0.6);

        if (input.justX) {
          modeIndex = (modeIndex + 1) % MODES.length;
          applyModeVisibility();
        }
        if (input.justY) {
          splitShapeIndex = (splitShapeIndex + 1) % SPLIT_SHAPES.length;
          applyModeVisibility();
        }

        if (input.justA) pulseEnabled = !pulseEnabled;
        if (input.justB) pulsePeriodIndex = (pulsePeriodIndex + 1) % PULSE_PERIODS.length;
        if (input.justSqueeze) rotationEnabled = !rotationEnabled;

        if (input.justSelect) {
          const now = performance.now();
          if (now - lastSelectAtMs > 250) {
            lastSelectAtMs = now;
            const aligned = Math.abs(disparityX) <= tolerance;
            if (aligned) score++;
            const bg = aligned ? '#1f7a3a' : '#7a1f1f';
            const txt = aligned ? 'OK ✅  Следующий раунд' : 'Не совпало ❌  Попробуйте ещё';
            Base.updateHudPanel(THREE, hudState, hudPanel, txt, bg);
            randomizeTrial();
          }
        }

        const splitRot = currentSplitShape() === 'horizontal' ? Math.PI / 2 : 0;
        const rot = rotationEnabled ? t * 0.3 : 0;
        if (leftRing) leftRing.rotation.z = rot;
        if (leftHalfDisk) leftHalfDisk.rotation.z = splitRot + rot;
        if (rightHalfDisk) rightHalfDisk.rotation.z = splitRot + rot;
        if (leftZigSplit) leftZigSplit.rotation.z = rot;
        if (rightZigSplit) rightZigSplit.rotation.z = rot;

        // Local pulse * global ALT fade
        const period = pulsePeriodSeconds();
        const halfPeriod = period / 2;
        const phaseIndex = pulseEnabled ? Math.floor(t / halfPeriod) % 2 : -1;
        const localT = pulseEnabled ? (t % halfPeriod) / halfPeriod : 0;
        const pulseAlpha = pulseEnabled ? 0.05 + 0.95 * Base.easeOutCubic(localT) : 1.0;
        const leftPulse = !pulseEnabled ? 1.0 : phaseIndex === 0 ? pulseAlpha : 1.0;
        const rightPulse = !pulseEnabled ? 1.0 : phaseIndex === 1 ? pulseAlpha : 1.0;
        const leftOpacity = leftPulse * fade.l;
        const rightOpacity = rightPulse * fade.r;

        setOpacityValue(leftRing, leftOpacity);
        setOpacityValue(leftHalfDisk, leftOpacity);
        setOpacityValue(leftZigSplit, leftOpacity);
        setOpacityValue(rightDot, rightOpacity);
        setOpacityValue(rightGuideRing, rightOpacity);
        setOpacityValue(rightHalfDisk, rightOpacity);
        setOpacityValue(rightZigSplit, rightOpacity);

        if (stimulusGroup) {
          stimulusGroup.position.set(0, settings.height, -settings.distance);
          stimulusGroup.scale.setScalar(settings.scale);
        }

        if (leftRing) leftRing.position.set(-disparityX / 2, 0, 0);
        if (leftHalfDisk) leftHalfDisk.position.set(-disparityX / 2, 0, 0);
        if (leftZigSplit) leftZigSplit.position.set(-disparityX / 2, 0, 0);
        if (rightDot) rightDot.position.set(disparityX / 2, 0, 0);
        if (rightGuideRing) rightGuideRing.position.set(disparityX / 2, 0, 0);
        if (rightHalfDisk) rightHalfDisk.position.set(disparityX / 2, 0, 0);
        if (rightZigSplit) rightZigSplit.position.set(disparityX / 2, 0, 0);

        const alignedNow = Math.abs(disparityX) <= tolerance;
        const modeNow = currentMode();
        if (rightGuideRing) rightGuideRing.visible = modeNow === 'alignment' && !alignedNow;

        const nowMs = performance.now();
        if (hudPanel && nowMs - hudLastUpdateAtMs > 250) {
          const shape = currentSplitShape();
          const pulse = pulseEnabled ? `ON (${period.toFixed(1)}s)` : 'OFF';
          const rotTxt = rotationEnabled ? 'ON' : 'OFF';
          const hint = alignedNow ? 'СОВПАЛО ✅  Нажмите триггер' : 'Совместите и нажмите триггер';
          const txt =
            `Тренажёр: Binocular MVP\n` +
            `Режим: ${modeNow} (X)   |   Split-фигура: ${shape} (Y)\n` +
            `Пульсация (local): ${pulse} (A/B)   |   Вращение: ${rotTxt} (Grip)\n` +
            `Disparity: right stick X   |   Global: left stick (Height/Dist)\n` +
            `Dist: ${settings.distance.toFixed(2)}m  Height: ${settings.height.toFixed(2)}m  Scale: ${settings.scale.toFixed(2)}\n` +
            `|dx|: ${Math.abs(disparityX).toFixed(3)}m   Счёт: ${score}/${trials}   |   ${hint}`;

          Base.updateHudPanel(THREE, hudState, hudPanel, txt, alignedNow ? '#1f7a3a' : '#222222');
          hudLastUpdateAtMs = nowMs;
        }
      },

      dispose() {
        if (!scene) return;
        if (hudPanel) {
          scene.remove(hudPanel);
          disposeAny(hudPanel);
          hudPanel = null;
        }

        if (stimulusGroup) {
          scene.remove(stimulusGroup);
          stimulusGroup.traverse((obj) => disposeAny(obj));
          stimulusGroup = null;
        }

        crosshair = null;
        leftRing = null;
        rightDot = null;
        rightGuideRing = null;
        leftHalfDisk = null;
        rightHalfDisk = null;
        leftZigSplit = null;
        rightZigSplit = null;
      },
    };
  }

  window.WebXRTrainers = window.WebXRTrainers || {};
  window.WebXRTrainers.binocular = createBinocularTrainer;
})();
