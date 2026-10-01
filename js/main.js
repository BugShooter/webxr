(function () {
  'use strict';

  const BUILD = 'v0.8.7 (2026-01-11)';

  const canvas = document.getElementById('glCanvas');
  const startBtn = document.getElementById('startBtn');
  const desktopBtn = document.getElementById('desktopBtn');
  const desktopControls = document.getElementById('desktopControls');
  const desktopExitBtn = document.getElementById('desktopExitBtn');
  const eyeLabels = document.getElementById('eyeLabels');
  const statusDiv = document.getElementById('status');
  const container = document.getElementById('container');
  const versionEl = document.getElementById('buildVersion');

  function log(msg) {
    console.log(msg);
    statusDiv.textContent = msg;
  }

  if (versionEl) versionEl.textContent = BUILD;

  async function startXR() {
    try {
      startBtn.disabled = true;

      if (!window.WebXRRuntime?.start) {
        log('❌ Runtime не загружен');
        startBtn.disabled = false;
        return;
      }

      await window.WebXRRuntime.start({
        canvas,
        startBtn,
        container,
        statusDiv,
        mode: 'vr',
        log,
        build: BUILD,
      });
    } catch (err) {
      console.error(err);
      log('❌ Ошибка: ' + (err?.message || String(err)));
      startBtn.disabled = false;
    }
  }

  let stopDesktopPreview = null;

  async function startDesktopPreview() {
    try {
      desktopBtn.disabled = true;
      const handle = await window.WebXRRuntime.start({
        canvas,
        startBtn,
        desktopBtn,
        desktopControls,
        eyeLabels,
        container,
        statusDiv,
        mode: 'desktop',
        log,
        build: BUILD,
      });
      stopDesktopPreview = handle?.end || null;
    } catch (err) {
      console.error(err);
      log('❌ Ошибка desktop preview: ' + (err?.message || String(err)));
      desktopBtn.disabled = false;
    }
  }

  desktopExitBtn.addEventListener('click', () => {
    stopDesktopPreview?.();
    stopDesktopPreview = null;
  });

  async function checkSupport() {
    if (!navigator.xr) {
      log('❌ WebXR недоступен');
      startBtn.disabled = true;
      return;
    }

    try {
      const supported = await navigator.xr.isSessionSupported('immersive-vr');
      if (!supported) {
        log('❌ VR не поддерживается');
        startBtn.disabled = true;
        return;
      }
      log('✅ WebXR поддерживается');
    } catch (err) {
      log('❌ Ошибка проверки: ' + (err?.message || String(err)));
      startBtn.disabled = true;
    }
  }

  startBtn.addEventListener('click', startXR);
  desktopBtn.addEventListener('click', startDesktopPreview);
  checkSupport();
})();
