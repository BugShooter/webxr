(function () {
  'use strict';

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function deadzone(v, dz) {
    return Math.abs(v) < dz ? 0 : v;
  }

  function createTextTexture(THREE, message, backgroundColor) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 1024;
    canvas.height = 512;

    const lines = String(message).split(/\r?\n/);

    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const bg = String(backgroundColor).toLowerCase();
    const textColor = bg === '#fff' || bg === '#ffffff' || bg === 'white' ? '#000000' : '#ffffff';

    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = textColor;

    const maxTextWidth = canvas.width - 40;
    let fontSize = 64;
    while (fontSize >= 22) {
      context.font = `Bold ${fontSize}px Arial`;
      const widest = lines.reduce((m, line) => Math.max(m, context.measureText(line).width), 0);
      if (widest <= maxTextWidth) break;
      fontSize -= 2;
    }

    const lineHeight = Math.round(fontSize * 1.1);
    const totalHeight = lineHeight * lines.length;
    const startY = (canvas.height - totalHeight) / 2 + lineHeight / 2;

    for (let i = 0; i < lines.length; i++) {
      context.fillText(lines[i], canvas.width / 2, startY + i * lineHeight);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function createHudPanel(THREE, message, backgroundColor) {
    const texture = createTextTexture(THREE, message, backgroundColor);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    material.depthTest = false;
    const geometry = new THREE.PlaneGeometry(1.6, 0.7);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 999;
    mesh.layers.set(1);
    mesh.layers.enable(2);
    return mesh;
  }

  function updateHudPanel(THREE, state, mesh, message, backgroundColor) {
    if (!mesh || !mesh.material) return;
    if (message === state.hudLastText && backgroundColor === state.hudLastBg) return;

    const oldMap = mesh.material.map;
    mesh.material.map = createTextTexture(THREE, message, backgroundColor);
    mesh.material.needsUpdate = true;
    if (oldMap) oldMap.dispose();

    state.hudLastText = message;
    state.hudLastBg = backgroundColor;
  }

  function getGamepad(session, handednessPreference) {
    if (!session) return null;

    for (const src of session.inputSources) {
      if (!src || !src.gamepad) continue;
      if (src.handedness === handednessPreference) return src.gamepad;
    }

    for (const src of session.inputSources) {
      if (!src || !src.gamepad) continue;
      if (src.handedness === 'none') return src.gamepad;
    }

    for (const src of session.inputSources) {
      if (!src || !src.gamepad) continue;
      return src.gamepad;
    }

    return null;
  }

  function buttonPressed(gamepad, index) {
    const b = gamepad?.buttons?.[index];
    return !!(b && (b.pressed || b.value > 0.8));
  }

  function easeOutCubic(t) {
    const x = clamp(t, 0, 1);
    return 1 - Math.pow(1 - x, 3);
  }

  async function requestAndStartXRSession({ renderer, container, log, requiredFeatures }) {
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: requiredFeatures || ['local-floor'],
    });

    await renderer.xr.setSession(session);
    if (container) container.style.display = 'none';
    if (log) log('✅ VR активен!');

    return session;
  }

  window.WebXRBase = {
    clamp,
    deadzone,
    easeOutCubic,
    createHudPanel,
    updateHudPanel,
    getGamepad,
    buttonPressed,
    requestAndStartXRSession,
  };
})();
