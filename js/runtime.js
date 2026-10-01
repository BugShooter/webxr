(function () {
  'use strict';

  function startRuntime({
    canvas,
    startBtn,
    desktopBtn,
    desktopControls,
    eyeLabels,
    container,
    statusDiv,
    log,
    build,
    mode = 'vr',
  }) {
    const THREE = window.THREE;
    const Base = window.WebXRBase;
    const trainerRegistry = window.WebXRTrainerRegistry;
    const renderModes = window.WebXRRenderModes;
    const desktopMode = mode === 'desktop';

    if (!THREE || !Base || !trainerRegistry || !renderModes) throw new Error('Runtime dependencies not loaded');

    const runtime = {
      THREE,
      Base,
      build,
      settings: {
        distance: 2.2,
        height: 1.55,
        scale: 1.0,

        // Menu placement (meters from head)
        menuDistance: 3.0,
        menuYOffset: 0.0,

        altFadeEnabled: true,
        fadeProfiles: [
          { name: 'Always ON (no ALT)', onMs: 999999, fadeOutMs: 0, offMs: 0, fadeInMs: 0 },
          { name: 'ALT: on1000 out500 off2000 in500', onMs: 1000, fadeOutMs: 500, offMs: 2000, fadeInMs: 500 },
          { name: 'ALT: on1000 out500 off3000 in500', onMs: 1000, fadeOutMs: 500, offMs: 3000, fadeInMs: 500 },
        ],
        fadeProfileIndex: 1,
      },
      input: null,
      menu: null,
      activeTrainerId: null,
      activeTrainer: null,
      setTrainer: null,
      endSession: null,
      getAltFade: null,
      controllers: null,
      pointerLocal: null,
    };

    let scene;
    let camera;
    let renderer;
    let renderMode;

    let controller0;
    let controller1;
    let resizeHandler = null;
    let inputAdapter = null;
    let desktopPointerMoveHandler = null;
    let menuAdjustAtMs = -1e9;
    const desktopPointer = { x: window.innerWidth * 0.75, y: window.innerHeight * 0.5 };

    // Input state (normalized)
    const input = {
      // raw-ish
      gpL: null,
      gpR: null,
      axesL: { x: 0, y: 0 },
      axesR: { x: 0, y: 0 },

      // buttons (edge)
      a: false,
      b: false,
      x: false,
      y: false,
      menu: false,

      justA: false,
      justB: false,
      justX: false,
      justY: false,
      justMenu: false,

      justSelect: false,
      justSqueeze: false,

      justSqueezeL: false,
      justSqueezeR: false,

      justTriggerR: false,
    };
    runtime.input = input;

    // Menus (two panels)
    const trainerMenu = {
      open: false,
      index: 0,
      hudState: { hudLastText: '', hudLastBg: '' },
      panel: null,
      lastUpdateAtMs: 0,
      layout: null,
    };

    const settingsMenu = {
      open: false,
      index: 0,
      hudState: { hudLastText: '', hudLastBg: '' },
      panel: null,
      lastUpdateAtMs: 0,
      layout: null,
    };

    runtime.menu = { trainerMenu, settingsMenu };

    // Laser pointer (ray) for menu interaction
    const raycaster = new THREE.Raycaster();
    // HUD panels are on layers 0/1/2; allow ray to hit them.
    raycaster.layers.enable(0);
    raycaster.layers.enable(1);
    raycaster.layers.enable(2);
    const laser = {
      line0: null,
      line1: null,
      dot: null,
      activeController: null,
    };

    const POINTER_LOCAL = { x: 0, y: 0, z: -0.035 };
    runtime.pointerLocal = POINTER_LOCAL;

    function status(msg) {
      if (log) log(msg);
      if (statusDiv) statusDiv.textContent = msg;
    }

    function clampMs(v) {
      const n = Math.round(v);
      return Math.max(0, Math.min(600000, n));
    }

    function currentFadeProfile() {
      const arr = runtime.settings.fadeProfiles;
      return arr[runtime.settings.fadeProfileIndex] || arr[0];
    }

    function getAltFade(tSec) {
      if (!runtime.settings.altFadeEnabled) return { l: 1, r: 1 };

      const p = currentFadeProfile();
      const on = Math.max(0.0001, (p.onMs || 0) / 1000);
      const out = Math.max(0, (p.fadeOutMs || 0) / 1000);
      const off = Math.max(0, (p.offMs || 0) / 1000);
      const inn = Math.max(0, (p.fadeInMs || 0) / 1000);

      const eyeCycle = on + out + off + inn;
      if (eyeCycle <= 0.0002) return { l: 1, r: 1 };

      // Alternate which eye is being suppressed. The other eye stays at 1.
      const pairCycle = eyeCycle * 2;
      const tt = ((tSec % pairCycle) + pairCycle) % pairCycle;
      const leftPhase = tt < eyeCycle;
      const u = leftPhase ? tt : tt - eyeCycle;

      function envelope(timeInEye) {
        if (timeInEye < on) return 1;
        const t1 = timeInEye - on;
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

      const active = 0.05 + 0.95 * envelope(u);
      return leftPhase ? { l: active, r: 1 } : { l: 1, r: active };
    }

    runtime.getAltFade = getAltFade;

    function ensureMenuPanels() {
      const placePanel = (panel) => {
        // farther away to reduce vergence strain; scaled up for readability
        const z = -Base.clamp(runtime.settings.menuDistance ?? 3.0, 1.2, 6.0);
        const y = Base.clamp(runtime.settings.menuYOffset ?? 0.0, -0.8, 0.8);
        panel.position.set(0, y, z);
        panel.rotation.x = 0.08;
        panel.scale.setScalar(1.4);
        camera.add(panel);
      };

      if (!trainerMenu.panel) {
        trainerMenu.panel = Base.createHudPanel(THREE, 'Trainer...', '#222222');
        placePanel(trainerMenu.panel);
      }

      if (!settingsMenu.panel) {
        settingsMenu.panel = Base.createHudPanel(THREE, 'Settings...', '#222222');
        placePanel(settingsMenu.panel);
      }
    }

    function applyMenuPlacement() {
      const z = -Base.clamp(runtime.settings.menuDistance ?? 3.0, 1.2, 6.0);
      const y = Base.clamp(runtime.settings.menuYOffset ?? 0.0, -0.8, 0.8);
      if (trainerMenu.panel) {
        trainerMenu.panel.position.z = z;
        trainerMenu.panel.position.y = y;
      }
      if (settingsMenu.panel) {
        settingsMenu.panel.position.z = z;
        settingsMenu.panel.position.y = y;
      }
    }

    function openTrainerMenu() {
      ensureMenuPanels();
      trainerMenu.open = true;
      settingsMenu.open = false;
      trainerMenu.panel.visible = true;
      settingsMenu.panel.visible = false;
      trainerMenu.index = 0;
    }

    function openSettingsMenu() {
      ensureMenuPanels();
      settingsMenu.open = true;
      trainerMenu.open = false;
      settingsMenu.panel.visible = true;
      trainerMenu.panel.visible = false;
      settingsMenu.index = 0;
    }

    function closeMenus() {
      if (trainerMenu.panel) trainerMenu.panel.visible = false;
      if (settingsMenu.panel) settingsMenu.panel.visible = false;
      trainerMenu.open = false;
      settingsMenu.open = false;

      if (laser.dot) laser.dot.visible = false;
      if (laser.line0) laser.line0.visible = false;
      if (laser.line1) laser.line1.visible = false;
    }

    function activeMenu() {
      if (trainerMenu.open) return trainerMenu;
      if (settingsMenu.open) return settingsMenu;
      return null;
    }

    function trainerMenuItems() {
      const items = trainerRegistry.list().map((trainer) => ({
        kind: 'pickTrainer',
        trainerId: trainer.id,
        label: trainer.id === runtime.activeTrainerId
          ? `Current: ${trainer.name}`
          : `Switch to: ${trainer.name}`,
      }));
      items.push({ kind: 'openSettings', label: 'Settings…' });
      items.push({ kind: 'exit', label: 'Exit VR' });
      items.push({ kind: 'close', label: 'Close' });
      return items;
    }

    function settingsMenuItems() {
      const p = currentFadeProfile();
      const profileLabel =
        `Fade profile: ${p?.name || '—'} ` +
        `[ON ${p.onMs} OUT ${p.fadeOutMs} OFF ${p.offMs} IN ${p.fadeInMs}] (Trigger: next)`;

      return [
        { kind: 'altEnabled', label: `ALT fade: ${runtime.settings.altFadeEnabled ? 'ON' : 'OFF'} (Trigger: toggle)` },
        { kind: 'profile', label: profileLabel },
        { kind: 'timing_on', label: `Timing ON: ${p.onMs} ms (Adjust: right stick X)` },
        { kind: 'timing_out', label: `Timing OUT: ${p.fadeOutMs} ms (Adjust: right stick X)` },
        { kind: 'timing_off', label: `Timing OFF: ${p.offMs} ms (Adjust: right stick X)` },
        { kind: 'timing_in', label: `Timing IN: ${p.fadeInMs} ms (Adjust: right stick X)` },
        { kind: 'addProfile', label: 'Add profile (clone)' },
        { kind: 'delProfile', label: 'Delete profile (min 2)' },
        { kind: 'distance', label: `Distance: ${runtime.settings.distance.toFixed(2)}m (Adjust: right stick X)` },
        { kind: 'height', label: `Height: ${runtime.settings.height.toFixed(2)}m (Adjust: right stick X)` },
        { kind: 'scale', label: `Scale: ${runtime.settings.scale.toFixed(2)} (Adjust: right stick X)` },
        { kind: 'back', label: 'Back to Trainer menu' },
        { kind: 'close', label: 'Close' },
      ];
    }

    function applyMenuSelection(item) {
      if (!item) return;

      if (item.kind === 'pickTrainer') {
        if (item.trainerId) runtime.setTrainer(item.trainerId);
        closeMenus();
        return;
      }

      if (item.kind === 'openSettings') {
        openSettingsMenu();
        return;
      }

      if (item.kind === 'back') {
        openTrainerMenu();
        return;
      }

      if (item.kind === 'altEnabled') {
        runtime.settings.altFadeEnabled = !runtime.settings.altFadeEnabled;
        return;
      }

      if (item.kind === 'profile') {
        runtime.settings.fadeProfileIndex = (runtime.settings.fadeProfileIndex + 1) % runtime.settings.fadeProfiles.length;
        return;
      }

      if (item.kind === 'addProfile') {
        const src = currentFadeProfile();
        runtime.settings.fadeProfiles.push({
          name: `Custom ${runtime.settings.fadeProfiles.length + 1}`,
          onMs: clampMs(src.onMs),
          fadeOutMs: clampMs(src.fadeOutMs),
          offMs: clampMs(src.offMs),
          fadeInMs: clampMs(src.fadeInMs),
        });
        runtime.settings.fadeProfileIndex = runtime.settings.fadeProfiles.length - 1;
        return;
      }

      if (item.kind === 'delProfile') {
        if (runtime.settings.fadeProfiles.length <= 2) return;
        const idx = runtime.settings.fadeProfileIndex;
        runtime.settings.fadeProfiles.splice(idx, 1);
        runtime.settings.fadeProfileIndex = Math.max(0, Math.min(runtime.settings.fadeProfiles.length - 1, idx - 1));
        return;
      }

      if (item.kind === 'exit') {
        runtime.endSession();
        return;
      }

      if (item.kind === 'close') {
        closeMenus();
      }
    }

    function adjustMenuValue(kind, deltaX) {
      const now = performance.now();
      if (now - menuAdjustAtMs < 90) return;
      menuAdjustAtMs = now;

      const stepMs = deltaX > 0 ? 50 : -50;
      const stepF = deltaX > 0 ? 0.05 : -0.05;

      const p = currentFadeProfile();

      if (kind === 'timing_on') {
        p.onMs = clampMs(p.onMs + stepMs);
        return;
      }

      if (kind === 'timing_out') {
        p.fadeOutMs = clampMs(p.fadeOutMs + stepMs);
        return;
      }

      if (kind === 'timing_off') {
        p.offMs = clampMs(p.offMs + stepMs);
        return;
      }

      if (kind === 'timing_in') {
        p.fadeInMs = clampMs(p.fadeInMs + stepMs);
        return;
      }

      if (kind === 'distance') {
        runtime.settings.distance = Base.clamp(runtime.settings.distance + stepF, 0.6, 4.0);
        return;
      }

      if (kind === 'height') {
        runtime.settings.height = Base.clamp(runtime.settings.height + stepF, 0.7, 2.2);
        return;
      }

      if (kind === 'scale') {
        runtime.settings.scale = Base.clamp(runtime.settings.scale + stepF, 0.6, 2.2);
      }
    }

    function measureLayout(lines) {
      // Mirrors Base.createTextTexture sizing logic enough for hit-testing
      const canvasW = 1024;
      const canvasH = 512;
      const maxTextWidth = canvasW - 40;
      const maxTextHeight = canvasH - 40;

      const tmp = document.createElement('canvas');
      tmp.width = canvasW;
      tmp.height = canvasH;
      const ctx = tmp.getContext('2d');

      let fontSize = 64;
      while (fontSize >= 18) {
        ctx.font = `Bold ${fontSize}px Arial`;
        const widest = lines.reduce((m, line) => Math.max(m, ctx.measureText(line).width), 0);
        const lineHeight = Math.round(fontSize * 1.1);
        const totalHeight = lineHeight * lines.length;
        if (widest <= maxTextWidth && totalHeight <= maxTextHeight) break;
        fontSize -= 2;
      }

      const lineHeight = Math.round(fontSize * 1.1);
      const totalHeight = lineHeight * lines.length;
      const startY = (canvasH - totalHeight) / 2 + lineHeight / 2;
      return { canvasW, canvasH, fontSize, lineHeight, startY };
    }

    function renderMenuPanel(menuState, title, items, selectedIndex) {
      const now = performance.now();
      if (!menuState.panel) return;
      if (now - menuState.lastUpdateAtMs < 150) return;

      const lines = [];
      lines.push(`${title} (Build ${build || ''})`);
      lines.push('Point + Trigger to select.  Left grip to close.');
      lines.push('Adjust (settings): Right stick X');
      lines.push('');

      const itemStartLine = lines.length;
      for (let i = 0; i < items.length; i++) {
        const prefix = i === selectedIndex ? '▶ ' : '  ';
        lines.push(prefix + items[i].label);
      }

      const txt = lines.join('\n');
      Base.updateHudPanel(THREE, menuState.hudState, menuState.panel, txt, '#111111');
      menuState.layout = {
        lines,
        itemStartLine,
        itemsCount: items.length,
        ...measureLayout(lines),
      };
      menuState.lastUpdateAtMs = now;
    }

    function ensureLaser() {
      if (!laser.dot) {
        const geom = new THREE.SphereGeometry(0.01, 10, 10);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
        mat.depthTest = false;
        laser.dot = new THREE.Mesh(geom, mat);
        laser.dot.layers.set(0);
        laser.dot.layers.enable(1);
        laser.dot.layers.enable(2);
        laser.dot.renderOrder = 1001;
        laser.dot.visible = false;
        scene.add(laser.dot);
      }

      const makeLine = () => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
        const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
        mat.depthTest = false;
        mat.depthWrite = false;
        const line = new THREE.Line(geom, mat);
        line.layers.set(0);
        line.layers.enable(1);
        line.layers.enable(2);
        line.position.set(POINTER_LOCAL.x, POINTER_LOCAL.y, POINTER_LOCAL.z);
        // HUD menus are renderOrder=999; keep the ray above the menu, but below the hit dot.
        line.renderOrder = 1000;
        line.visible = false;
        return line;
      };

      if (!laser.line0) {
        laser.line0 = makeLine();
        controller0.add(laser.line0);
      }
      if (!laser.line1) {
        laser.line1 = makeLine();
        controller1.add(laser.line1);
      }
    }

    function updateLaserAndPick(menuState, items) {
      ensureLaser();

      const panel = menuState.panel;
      const layout = menuState.layout;
      if (!panel || !layout) return { hoveredIndex: -1 };

      // Make sure matrices are up-to-date for raycasting
      panel.updateMatrixWorld(true);
      controller0.updateMatrixWorld(true);
      controller1.updateMatrixWorld(true);

      const tryController = (controller, line) => {
        if (!controller) return null;

        const origin = new THREE.Vector3(POINTER_LOCAL.x, POINTER_LOCAL.y, POINTER_LOCAL.z);
        controller.localToWorld(origin);

        const q = new THREE.Quaternion();
        controller.getWorldQuaternion(q);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();

        raycaster.set(origin, dir);
        const hits = raycaster.intersectObject(panel, true);
        if (!hits || hits.length === 0) {
          line.visible = true;
          line.scale.z = 3.0;
          return null;
        }

        const hit = hits[0];
        const dist = hit.distance;
        line.visible = true;
        line.scale.z = Math.max(0.15, Math.min(4.5, dist));

        if (hit.point) {
          laser.dot.visible = true;
          laser.dot.position.copy(hit.point);
        }

        const uv = hit.uv;
        if (!uv) return { hoveredIndex: -1 };

        const canvasY = (1 - uv.y) * layout.canvasH;
        const firstCenterY = layout.startY;
        const top = firstCenterY - layout.lineHeight / 2;
        const idxLine = Math.floor((canvasY - top) / layout.lineHeight);

        const itemLine = idxLine - layout.itemStartLine;
        if (itemLine < 0 || itemLine >= layout.itemsCount) return { hoveredIndex: -1 };
        return { hoveredIndex: itemLine };
      };

      // prefer right controller for pointing (by handedness)
      laser.dot.visible = false;
      const rightCtrl = runtime.controllers?.right || controller1;
      const leftCtrl = runtime.controllers?.left || controller0;

      const lineFor = (ctrl) => (ctrl === controller0 ? laser.line0 : ctrl === controller1 ? laser.line1 : null);

      const rLine = lineFor(rightCtrl) || laser.line1;
      const lLine = lineFor(leftCtrl) || laser.line0;

      const r = tryController(rightCtrl, rLine);
      const l = r ? null : tryController(leftCtrl, lLine);

      if (laser.line0) laser.line0.visible = !!menuState.open;
      if (laser.line1) laser.line1.visible = !!menuState.open;

      const h = r || l || { hoveredIndex: -1 };
      return h;
    }

    function updateMenus(dt) {
      ensureMenuPanels();
      const menuState = activeMenu();
      if (!menuState) return;

      // While any menu is open: LEFT stick moves the menu placement
      // - X: depth (far/near)
      // - Y: height
      if (Math.abs(input.axesL.x) > 0.12) {
        runtime.settings.menuDistance = Base.clamp(
          (runtime.settings.menuDistance ?? 3.0) + input.axesL.x * 1.6 * dt,
          1.2,
          6.0
        );
      }
      if (Math.abs(input.axesL.y) > 0.12) {
        runtime.settings.menuYOffset = Base.clamp(
          (runtime.settings.menuYOffset ?? 0.0) - input.axesL.y * 1.2 * dt,
          -0.8,
          0.8
        );
      }
      applyMenuPlacement();

      const items = menuState === trainerMenu ? trainerMenuItems() : settingsMenuItems();

      // Hover/select with laser pointer
      const pick = updateLaserAndPick(menuState, items);
      const hovered = pick.hoveredIndex;
      if (hovered >= 0) menuState.index = hovered;

      const selected = items[menuState.index];

      if (input.justSelect && selected) {
        applyMenuSelection(selected);
        input.justSelect = false;
      }

      // Adjust with right stick X for certain settings items
      if (menuState === settingsMenu && selected) {
        const adjX = input.axesR.x;
        if (Math.abs(adjX) > 0.65) {
          if (['timing_on', 'timing_out', 'timing_off', 'timing_in', 'distance', 'height', 'scale'].includes(selected.kind)) {
            adjustMenuValue(selected.kind, adjX);
          }
        }
      }

      renderMenuPanel(
        menuState,
        menuState === trainerMenu ? 'Trainer Menu' : 'Settings',
        items,
        menuState.index
      );
    }

    function disposeActiveTrainer() {
      try {
        runtime.activeTrainer?.dispose?.();
      } catch (e) {
        console.warn(e);
      }
      runtime.activeTrainer = null;
      runtime.activeTrainerId = null;
    }

    function disposeRuntime() {
      renderer?.setAnimationLoop(null);
      disposeActiveTrainer();

      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
      inputAdapter?.dispose?.();
      inputAdapter = null;
      if (desktopPointerMoveHandler) canvas.removeEventListener('pointermove', desktopPointerMoveHandler);

      if (scene) {
        const geometries = new Set();
        const materials = new Set();
        const textures = new Set();

        scene.traverse((object) => {
          if (object.geometry) geometries.add(object.geometry);
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of objectMaterials) {
            if (!material) continue;
            materials.add(material);
            for (const value of Object.values(material)) {
              if (value?.isTexture) textures.add(value);
            }
          }
        });

        for (const texture of textures) texture.dispose();
        for (const material of materials) material.dispose();
        for (const geometry of geometries) geometry.dispose();
        scene.clear();
      }

      renderMode?.dispose();
      renderMode = null;
      scene = null;
      camera = null;
      renderer = null;
      controller0 = null;
      controller1 = null;
      runtime.controllers = null;
      trainerMenu.panel = null;
      settingsMenu.panel = null;
      laser.dot = null;
      laser.line0 = null;
      laser.line1 = null;
      resizeHandler = null;
      desktopPointerMoveHandler = null;
    }

    function setTrainer(id) {
      const registration = trainerRegistry.get(id);
      if (!registration) {
        status('❌ Trainer not found: ' + id);
        return false;
      }

      if (runtime.activeTrainerId === id) return true;

      const trainer = registration.create();
      if (!trainer || typeof trainer.init !== 'function' || typeof trainer.update !== 'function') {
        status('❌ Trainer has no init/update: ' + id);
        return false;
      }

      disposeActiveTrainer();
      runtime.activeTrainer = trainer;
      runtime.activeTrainerId = id;

      trainer.init({ runtime, THREE, Base, scene, camera, renderer });

      status('✅ Trainer: ' + registration.name);
      return true;
    }

    runtime.setTrainer = setTrainer;

    function resizeRenderer() {
      renderMode?.resize();
    }

    function initThreeJS() {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0a0a);

      renderMode = renderModes.create({ mode: desktopMode ? 'desktop' : 'vr', THREE, canvas });
      camera = renderMode.camera;
      renderer = renderMode.renderer;
      // Needed so camera-attached UI (menu panel) is part of the scene graph
      scene.add(camera);

      scene.add(new THREE.AmbientLight(0xffffff, 0.85));
      const light1 = new THREE.DirectionalLight(0xffffff, 0.6);
      light1.position.set(2, 3, 1);
      scene.add(light1);

      // Ground reference
      const floorGeom = new THREE.PlaneGeometry(10, 10);
      const floorMat = new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide });
      const floor = new THREE.Mesh(floorGeom, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0;
      floor.layers.set(0);
      scene.add(floor);

      const grid = new THREE.GridHelper(10, 20, 0x666666, 0x444444);
      grid.position.y = 0.01;
      grid.layers.set(0);
      scene.add(grid);

      controller0 = renderMode.getController(0);
      controller1 = renderMode.getController(1);
      runtime.controllers = { left: controller0, right: controller1 };

      // Simple controller visualization (small cone) so you can see where hands are.
      const makeControllerViz = () => {
        const geom = new THREE.ConeGeometry(0.02, 0.06, 10);
        const mat = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0x111111, emissiveIntensity: 0.35 });
        // Keep controllers visible even when HUD uses depthTest=false.
        mat.depthTest = false;
        mat.depthWrite = false;
        const mesh = new THREE.Mesh(geom, mat);
        // Cone axis is +Y; rotate to point forward (-Z)
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(POINTER_LOCAL.x, POINTER_LOCAL.y, POINTER_LOCAL.z);
        mesh.layers.set(0);
        mesh.renderOrder = 2000;
        return mesh;
      };
      controller0.add(makeControllerViz());
      controller1.add(makeControllerViz());

      // Track handedness mapping (controller indices are not guaranteed to be left/right).
      const onConnected = (controller) => (e) => {
        const h = e?.data?.handedness;
        if (h === 'left' || h === 'right') {
          controller.userData.handedness = h;
          runtime.controllers = runtime.controllers || { left: null, right: null };
          runtime.controllers[h] = controller;
        }
      };
      controller0.addEventListener('connected', onConnected(controller0));
      controller1.addEventListener('connected', onConnected(controller1));

      controller0.addEventListener('selectstart', () => {
        input.justSelect = true;
      });
      controller1.addEventListener('selectstart', () => {
        input.justSelect = true;
      });
      const onSqueezeStart = (controller) => () => {
        input.justSqueeze = true;
        const h = controller.userData?.handedness;
        if (h === 'left') input.justSqueezeL = true;
        else if (h === 'right') input.justSqueezeR = true;
        else {
          // Fallback: assume controller0 is left if unknown
          if (controller === controller0) input.justSqueezeL = true;
          if (controller === controller1) input.justSqueezeR = true;
        }
      };
      controller0.addEventListener('squeezestart', onSqueezeStart(controller0));
      controller1.addEventListener('squeezestart', onSqueezeStart(controller1));

      scene.add(controller0);
      scene.add(controller1);

      resizeHandler = resizeRenderer;
      window.addEventListener('resize', resizeHandler);
      resizeRenderer();

      if (desktopMode) {
        desktopPointerMoveHandler = (event) => {
          const bounds = canvas.getBoundingClientRect();
          desktopPointer.x = event.clientX - bounds.left;
          desktopPointer.y = event.clientY - bounds.top;
        };
        canvas.addEventListener('pointermove', desktopPointerMoveHandler);
      }
    }

    async function start() {
      let session;
      try {
        initThreeJS();
        const inputAdapters = window.WebXRInputAdapters;
        if (!inputAdapters) throw new Error('Input adapters not loaded');
        inputAdapter = desktopMode
          ? inputAdapters.createDesktop({ input, canvas })
          : inputAdapters.createVR({ input, Base });
        if (!desktopMode) {
          session = await Base.requestAndStartXRSession({
            renderer,
            container,
            log,
            requiredFeatures: ['local-floor'],
          });
        }
      } catch (error) {
        disposeRuntime();
        throw error;
      }

      runtime.endSession = () => {
        if (desktopMode) {
          disposeRuntime();
          if (container) container.style.display = 'block';
          if (desktopControls) desktopControls.hidden = true;
          if (eyeLabels) eyeLabels.hidden = true;
          if (desktopBtn) desktopBtn.disabled = false;
          status('Desktop stereo завершён');
          return;
        }
        try {
          session?.end();
        } catch (e) {
          console.warn(e);
        }
      };

      if (desktopMode) {
        if (container) container.style.display = 'none';
        if (desktopControls) desktopControls.hidden = false;
        if (eyeLabels) eyeLabels.hidden = false;
        status('Desktop stereo активен');
      } else {
        session.addEventListener('end', () => {
          status('VR завершён');
          if (container) container.style.display = 'block';
          if (startBtn) startBtn.disabled = false;
          disposeRuntime();
        }, { once: true });
      }

      // Create menu panel (hidden)
      ensureMenuPanels();
      trainerMenu.panel.visible = false;
      settingsMenu.panel.visible = false;

      // Start trainer
      const defaultTrainer = trainerRegistry.getDefault();
      if (defaultTrainer) setTrainer(defaultTrainer.id);
      openTrainerMenu();

      let lastTimeMs = 0;
      renderer.setAnimationLoop((timeMs) => {
        const dt = lastTimeMs ? (timeMs - lastTimeMs) / 1000 : 0;
        lastTimeMs = timeMs;

        inputAdapter.poll(session);
        renderMode.updateControllerPose({ controller0, controller1, pointer: desktopPointer });

        // Preferred: left grip (squeeze) to toggle menu.
        if (input.justSqueezeL || input.justMenu) {
          if (trainerMenu.open || settingsMenu.open) closeMenus();
          else openTrainerMenu();
        }

        if (trainerMenu.open || settingsMenu.open) {
          updateMenus(dt);
        } else {
          // Quick fade switching for Trajectory without opening menus
          if (runtime.activeTrainerId === 'trajectory') {
            if (input.justTriggerR || input.justA) {
              if (!runtime.settings.altFadeEnabled) runtime.settings.altFadeEnabled = true;
              runtime.settings.fadeProfileIndex =
                (runtime.settings.fadeProfileIndex + 1) % runtime.settings.fadeProfiles.length;
            }
          }

          // Global unified controls (when menu is closed)
          // - Left stick Y: height
          // - Left stick X: depth (distance)
          // Right stick is reserved for trainer-specific controls.
          if (dt > 0) {
            runtime.settings.height = Base.clamp(runtime.settings.height - input.axesL.y * 0.9 * dt, 0.7, 2.2);
            runtime.settings.distance = Base.clamp(runtime.settings.distance + input.axesL.x * 0.9 * dt, 0.6, 4.0);
          }

          // let trainer run
          try {
            runtime.activeTrainer?.update?.({
              t: timeMs / 1000,
              dt,
              input,
              settings: runtime.settings,
              fade: getAltFade(timeMs / 1000),
            });
          } catch (e) {
            console.error(e);
          }
        }

        // Reset one-shot flags
        input.justSelect = false;
        input.justSqueeze = false;
        input.justSqueezeL = false;
        input.justSqueezeR = false;
        input.justA = false;
        input.justB = false;
        input.justX = false;
        input.justY = false;
        input.justMenu = false;
        input.justTriggerR = false;

        renderMode.render(scene);
      });

      return desktopMode ? { end: runtime.endSession } : session;
    }

    return start();
  }

  window.WebXRRuntime = {
    start: startRuntime,
  };
})();
