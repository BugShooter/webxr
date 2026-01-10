(function () {
  'use strict';

  function startRuntime({ canvas, startBtn, container, statusDiv, log, build, initialTrainerId }) {
    const THREE = window.THREE;
    const Base = window.WebXRBase;

    if (!THREE || !Base) throw new Error('THREE/Base not loaded');

    const runtime = {
      THREE,
      Base,
      build,
      settings: {
        distance: 2.2,
        height: 1.55,
        scale: 1.0,

        altFadeEnabled: true,
        fadeProfiles: [
          { name: 'Always ON', onMs: 999999, fadeOutMs: 0, offMs: 0, fadeInMs: 0 },
          { name: 'Alt 400/200/200/400', onMs: 400, fadeOutMs: 200, offMs: 200, fadeInMs: 400 },
        ],
        fadeProfileIndex: 0,
      },
      input: null,
      menu: null,
      activeTrainerId: null,
      activeTrainer: null,
      setTrainer: null,
      endSession: null,
      getAltFade: null,
    };

    let scene;
    let camera;
    let renderer;

    let controller0;
    let controller1;

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

      _prev: { a: false, b: false, x: false, y: false, menu: false },
      _debounce: { navAtMs: -1e9, adjustAtMs: -1e9 },
    };
    runtime.input = input;

    // Menu state
    const menu = {
      open: false,
      index: 0,
      hudState: { hudLastText: '', hudLastBg: '' },
      panel: null,
      lastUpdateAtMs: 0,
    };
    runtime.menu = menu;

    function status(msg) {
      if (log) log(msg);
      if (statusDiv) statusDiv.textContent = msg;
    }

    function clampMs(v) {
      const n = Math.round(v);
      return Math.max(0, Math.min(600000, n));
    }

    function listTrainers() {
      const reg = window.WebXRTrainers || {};
      const ids = Object.keys(reg).sort();
      const trainers = [];
      for (const id of ids) {
        const factory = reg[id];
        if (typeof factory !== 'function') continue;
        const t = factory();
        if (!t) continue;
        // new interface must provide init/update/dispose
        if (typeof t.init !== 'function' || typeof t.update !== 'function') continue;
        trainers.push({ id: t.id || id, name: t.name || id, factory });
      }
      return trainers;
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

    function readStick(gamepad) {
      const axes = gamepad?.axes || [];
      let x = 0;
      let y = 0;
      if (axes.length >= 4) {
        x = axes[2];
        y = axes[3];
      } else if (axes.length >= 2) {
        x = axes[0];
        y = axes[1];
      }
      x = Base.deadzone(x, 0.12);
      y = Base.deadzone(y, 0.12);
      return { x, y };
    }

    function updateInput(session) {
      input.gpL = Base.getGamepad(session, 'left');
      input.gpR = Base.getGamepad(session, 'right');

      input.axesL = input.gpL ? readStick(input.gpL) : { x: 0, y: 0 };
      input.axesR = input.gpR ? readStick(input.gpR) : { x: 0, y: 0 };

      // Keep existing mapping used earlier in this project
      const aNow = input.gpR ? Base.buttonPressed(input.gpR, 4) : false;
      const bNow = input.gpR ? Base.buttonPressed(input.gpR, 5) : false;
      const xNow = input.gpL ? Base.buttonPressed(input.gpL, 4) : false;
      const yNow = input.gpL ? Base.buttonPressed(input.gpL, 5) : false;

      // Menu button: try indices that often map to menu/thumbstick
      const menuNow = input.gpL
        ? Base.buttonPressed(input.gpL, 3) || Base.buttonPressed(input.gpL, 2)
        : input.gpR
          ? Base.buttonPressed(input.gpR, 2)
          : false;

      input.justA = aNow && !input._prev.a;
      input.justB = bNow && !input._prev.b;
      input.justX = xNow && !input._prev.x;
      input.justY = yNow && !input._prev.y;
      input.justMenu = menuNow && !input._prev.menu;

      input.a = aNow;
      input.b = bNow;
      input.x = xNow;
      input.y = yNow;
      input.menu = menuNow;

      input._prev.a = aNow;
      input._prev.b = bNow;
      input._prev.x = xNow;
      input._prev.y = yNow;
      input._prev.menu = menuNow;
    }

    function ensureMenuPanel() {
      if (menu.panel) return;
      menu.panel = Base.createHudPanel(THREE, 'Menu...', '#222222');
      // attach to camera so it follows head
      menu.panel.position.set(0, 0, -1.6);
      menu.panel.rotation.x = 0.1;
      camera.add(menu.panel);
    }

    function openMenu() {
      ensureMenuPanel();
      menu.open = true;
      menu.panel.visible = true;
      menu.index = 0;
    }

    function closeMenu() {
      if (!menu.panel) return;
      menu.open = false;
      menu.panel.visible = false;
    }

    function menuItems() {
      const trainers = listTrainers();
      const idx = Math.max(0, trainers.findIndex((t) => t.id === runtime.activeTrainerId));
      const cur = trainers[idx] || trainers[0];
      const p = currentFadeProfile();

      return [
        { kind: 'trainer', label: `Trainer: ${cur ? cur.name : '—'}  (Trigger: next)` },
        { kind: 'altEnabled', label: `ALT fade: ${runtime.settings.altFadeEnabled ? 'ON' : 'OFF'}  (Trigger: toggle)` },
        { kind: 'profile', label: `Fade profile: ${p?.name || '—'}  (Trigger: next)` },
        { kind: 'timing_on', label: `Timing ON: ${p.onMs} ms  (Adjust: right stick X)` },
        { kind: 'timing_out', label: `Timing OUT: ${p.fadeOutMs} ms  (Adjust: right stick X)` },
        { kind: 'timing_off', label: `Timing OFF: ${p.offMs} ms  (Adjust: right stick X)` },
        { kind: 'timing_in', label: `Timing IN: ${p.fadeInMs} ms  (Adjust: right stick X)` },
        { kind: 'addProfile', label: `Add profile (clone)` },
        { kind: 'delProfile', label: `Delete profile (min 2)` },
        { kind: 'distance', label: `Distance: ${runtime.settings.distance.toFixed(2)}m  (Adjust: right stick X)` },
        { kind: 'height', label: `Height: ${runtime.settings.height.toFixed(2)}m  (Adjust: right stick X)` },
        { kind: 'scale', label: `Scale: ${runtime.settings.scale.toFixed(2)}  (Adjust: right stick X)` },
        { kind: 'exit', label: `Exit VR` },
        { kind: 'close', label: `Close menu` },
      ];
    }

    function applyMenuSelection(kind) {
      const trainers = listTrainers();
      const curIndex = Math.max(0, trainers.findIndex((t) => t.id === runtime.activeTrainerId));

      if (kind === 'trainer') {
        const next = trainers[(curIndex + 1) % Math.max(1, trainers.length)];
        if (next) runtime.setTrainer(next.id);
        return;
      }

      if (kind === 'altEnabled') {
        runtime.settings.altFadeEnabled = !runtime.settings.altFadeEnabled;
        return;
      }

      if (kind === 'profile') {
        runtime.settings.fadeProfileIndex = (runtime.settings.fadeProfileIndex + 1) % runtime.settings.fadeProfiles.length;
        return;
      }

      if (kind === 'addProfile') {
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

      if (kind === 'delProfile') {
        if (runtime.settings.fadeProfiles.length <= 2) return;
        const idx = runtime.settings.fadeProfileIndex;
        runtime.settings.fadeProfiles.splice(idx, 1);
        runtime.settings.fadeProfileIndex = Math.max(0, Math.min(runtime.settings.fadeProfiles.length - 1, idx - 1));
        return;
      }

      if (kind === 'exit') {
        runtime.endSession();
        return;
      }

      if (kind === 'close') {
        closeMenu();
      }
    }

    function adjustMenuValue(kind, deltaX) {
      const now = performance.now();
      if (now - input._debounce.adjustAtMs < 90) return;
      input._debounce.adjustAtMs = now;

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

    function updateMenu() {
      ensureMenuPanel();

      // Navigation with left stick Y
      const now = performance.now();
      const stickY = input.axesL.y;
      if (Math.abs(stickY) > 0.5 && now - input._debounce.navAtMs > 220) {
        input._debounce.navAtMs = now;
        const items = menuItems();
        menu.index = (menu.index + (stickY > 0 ? 1 : -1) + items.length) % items.length;
      }

      const items = menuItems();
      const selected = items[menu.index];

      if (input.justSelect && selected) {
        applyMenuSelection(selected.kind);
        input.justSelect = false;
      }

      // Adjust with right stick X for certain items
      const adjX = input.axesR.x;
      if (Math.abs(adjX) > 0.65 && selected) {
        if (['timing_on', 'timing_out', 'timing_off', 'timing_in', 'distance', 'height', 'scale'].includes(selected.kind)) {
          adjustMenuValue(selected.kind, adjX);
        }
      }

      // Render menu text
      if (now - menu.lastUpdateAtMs > 150) {
        const lines = [];
        lines.push(`Menu (Build ${build || ''})`);
        lines.push('Nav: Left stick Y  |  Select: Trigger  |  Toggle: Menu button');
        lines.push('Adjust: Right stick X');
        lines.push('');

        for (let i = 0; i < items.length; i++) {
          const prefix = i === menu.index ? '▶ ' : '  ';
          lines.push(prefix + items[i].label);
        }

        const txt = lines.join('\n');
        Base.updateHudPanel(THREE, menu.hudState, menu.panel, txt, '#111111');
        menu.lastUpdateAtMs = now;
      }
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

    function setTrainer(id) {
      const reg = window.WebXRTrainers || {};
      const factory = reg[id];
      if (typeof factory !== 'function') {
        status('❌ Trainer not found: ' + id);
        return;
      }

      const trainer = factory();
      if (!trainer || typeof trainer.init !== 'function' || typeof trainer.update !== 'function') {
        status('❌ Trainer has no init/update: ' + id);
        return;
      }

      disposeActiveTrainer();
      runtime.activeTrainer = trainer;
      runtime.activeTrainerId = id;

      trainer.init({ runtime, THREE, Base, scene, camera, renderer });

      status('✅ Trainer: ' + (trainer.name || id));
    }

    runtime.setTrainer = setTrainer;

    function initThreeJS() {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0a0a);

      camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
      camera.position.set(0, 1.6, 0);
      // Needed so camera-attached UI (menu panel) is part of the scene graph
      scene.add(camera);

      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled = true;

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

      controller0 = renderer.xr.getController(0);
      controller1 = renderer.xr.getController(1);

      controller0.addEventListener('selectstart', () => {
        input.justSelect = true;
      });
      controller1.addEventListener('selectstart', () => {
        input.justSelect = true;
      });
      controller0.addEventListener('squeezestart', () => {
        input.justSqueeze = true;
      });
      controller1.addEventListener('squeezestart', () => {
        input.justSqueeze = true;
      });

      scene.add(controller0);
      scene.add(controller1);
    }

    async function start() {
      initThreeJS();

      const session = await Base.requestAndStartXRSession({
        renderer,
        container,
        log,
        requiredFeatures: ['local-floor'],
      });

      runtime.endSession = () => {
        try {
          session.end();
        } catch (e) {
          console.warn(e);
        }
      };

      session.addEventListener('end', () => {
        status('VR завершён');
        if (container) container.style.display = 'block';
        if (startBtn) startBtn.disabled = false;
        disposeActiveTrainer();

        if (menu.panel) {
          try {
            camera.remove(menu.panel);
            const mat = menu.panel.material;
            if (mat?.map) mat.map.dispose?.();
            mat?.dispose?.();
            menu.panel.geometry?.dispose?.();
          } catch (e) {
            console.warn(e);
          }
          menu.panel = null;
        }
      });

      // Create menu panel (hidden)
      ensureMenuPanel();
      menu.panel.visible = false;

      // Start trainer
      const trainers = listTrainers();
      const fallbackId = trainers[0]?.id || initialTrainerId;
      setTrainer(initialTrainerId || fallbackId);

      let lastTimeMs = 0;
      renderer.setAnimationLoop((timeMs) => {
        const dt = lastTimeMs ? (timeMs - lastTimeMs) / 1000 : 0;
        lastTimeMs = timeMs;

        updateInput(session);

        if (input.justMenu) {
          if (menu.open) closeMenu();
          else openMenu();
        }

        if (menu.open) {
          updateMenu();
        } else {
          // Global unified controls (when menu is closed)
          // - Left stick Y: height
          // - Right stick Y: distance
          // - Right stick X: scale
          if (dt > 0) {
            runtime.settings.height = Base.clamp(runtime.settings.height - input.axesL.y * 0.9 * dt, 0.7, 2.2);
            runtime.settings.distance = Base.clamp(runtime.settings.distance - input.axesR.y * 0.9 * dt, 0.6, 4.0);
            runtime.settings.scale = Base.clamp(runtime.settings.scale + input.axesR.x * 0.9 * dt, 0.6, 2.2);
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

        // Set per-eye layers
        const xrCamera = renderer.xr.getCamera(camera);
        if (xrCamera && xrCamera.isArrayCamera && xrCamera.cameras && xrCamera.cameras.length >= 2) {
          xrCamera.cameras[0].layers.enable(0);
          xrCamera.cameras[0].layers.enable(1);
          xrCamera.cameras[0].layers.disable(2);

          xrCamera.cameras[1].layers.enable(0);
          xrCamera.cameras[1].layers.enable(2);
          xrCamera.cameras[1].layers.disable(1);
        }

        // Reset one-shot flags
        input.justSelect = false;
        input.justSqueeze = false;

        renderer.render(scene, camera);
      });

      return session;
    }

    return start();
  }

  window.WebXRRuntime = {
    start: startRuntime,
  };
})();
