(function () {
  'use strict';

  function createVRInputAdapter({ input, Base }) {
    const previous = { a: false, b: false, x: false, y: false, menu: false, triggerR: false };
    const hold = { yDownAtMs: null, yUsedForMenu: false };
    let menuAtMs = -1e9;

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
      return { x: Base.deadzone(x, 0.12), y: Base.deadzone(y, 0.12) };
    }

    function poll(session) {
      input.gpL = Base.getGamepad(session, 'left');
      input.gpR = Base.getGamepad(session, 'right');
      input.axesL = input.gpL ? readStick(input.gpL) : { x: 0, y: 0 };
      input.axesR = input.gpR ? readStick(input.gpR) : { x: 0, y: 0 };

      const aNow = input.gpR ? Base.buttonPressed(input.gpR, 4) : false;
      const bNow = input.gpR ? Base.buttonPressed(input.gpR, 5) : false;
      const xNow = input.gpL ? Base.buttonPressed(input.gpL, 4) : false;
      const yNow = input.gpL ? Base.buttonPressed(input.gpL, 5) : false;
      const triggerRNow = input.gpR ? Base.buttonPressed(input.gpR, 0) : false;

      const buttonPressedDigital = (gamepad, index) => !!gamepad?.buttons?.[index]?.pressed;
      const menuNow = input.gpL && [9, 8, 7, 6].some((index) => buttonPressedDigital(input.gpL, index));
      const nowMs = performance.now();

      let menuFromHold = false;
      if (yNow && !previous.y) {
        hold.yDownAtMs = nowMs;
        hold.yUsedForMenu = false;
      }
      if (!yNow) {
        hold.yDownAtMs = null;
        hold.yUsedForMenu = false;
      }
      if (yNow && hold.yDownAtMs != null && !hold.yUsedForMenu && nowMs - hold.yDownAtMs > 450) {
        menuFromHold = true;
        hold.yUsedForMenu = true;
      }

      input.justA = aNow && !previous.a;
      input.justB = bNow && !previous.b;
      input.justX = xNow && !previous.x;
      input.justY = yNow && !previous.y;
      input.justMenu = (!!menuNow && !previous.menu) || menuFromHold;
      input.justTriggerR = triggerRNow && !previous.triggerR;

      if (input.justMenu) {
        if (nowMs - menuAtMs < 350) input.justMenu = false;
        else menuAtMs = nowMs;
      }

      input.a = aNow;
      input.b = bNow;
      input.x = xNow;
      input.y = yNow;
      input.menu = !!menuNow;

      previous.a = aNow;
      previous.b = bNow;
      previous.x = xNow;
      previous.y = yNow;
      previous.menu = !!menuNow;
      previous.triggerR = triggerRNow;
    }

    return { poll };
  }

  function createDesktopInputAdapter({ input, canvas }) {
    const keys = new Set();
    const controlCodes = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'KeyQ', 'KeyX', 'KeyY', 'KeyB', 'Space',
    ]);

    function onPointerDown(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      input.justSelect = true;
      input.justTriggerR = true;
    }

    function onKeyDown(event) {
      if (!controlCodes.has(event.code)) return;
      event.preventDefault();
      keys.add(event.code);
      if (event.repeat) return;

      if (event.code === 'KeyQ') {
        input.justSqueeze = true;
        input.justSqueezeL = true;
      } else if (event.code === 'KeyX') input.justX = true;
      else if (event.code === 'KeyY') input.justY = true;
      else if (event.code === 'KeyB') input.justB = true;
      else if (event.code === 'Space') {
        input.justA = true;
        input.justTriggerR = true;
        input.justSelect = true;
      }
    }

    function onKeyUp(event) {
      keys.delete(event.code);
    }

    function onBlur() {
      keys.clear();
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return {
      poll() {
        const pressed = (code) => keys.has(code) ? 1 : 0;
        input.gpL = null;
        input.gpR = null;
        input.axesL = {
          x: pressed('KeyD') - pressed('KeyA'),
          y: pressed('KeyS') - pressed('KeyW'),
        };
        input.axesR = {
          x: pressed('ArrowRight') - pressed('ArrowLeft'),
          y: pressed('ArrowDown') - pressed('ArrowUp'),
        };
      },

      dispose() {
        canvas.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        keys.clear();
      },
    };
  }

  window.WebXRInputAdapters = {
    createVR: createVRInputAdapter,
    createDesktop: createDesktopInputAdapter,
  };
})();