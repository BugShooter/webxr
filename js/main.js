(function () {
  'use strict';

  const BUILD = 'v0.8.1 (2026-01-10)';

  const canvas = document.getElementById('glCanvas');
  const startBtn = document.getElementById('startBtn');
  const statusDiv = document.getElementById('status');
  const container = document.getElementById('container');
  const trainerSelect = document.getElementById('trainerSelect');
  const versionEl = document.getElementById('buildVersion');

  function log(msg) {
    console.log(msg);
    statusDiv.textContent = msg;
  }

  if (versionEl) versionEl.textContent = BUILD;

  function getSelectedTrainerId() {
    return trainerSelect?.value || 'binocular';
  }

  async function startXR() {
    try {
      startBtn.disabled = true;

      const trainerId = getSelectedTrainerId();
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
        log,
        build: BUILD,
        initialTrainerId: trainerId,
      });
    } catch (err) {
      console.error(err);
      log('❌ Ошибка: ' + (err?.message || String(err)));
      startBtn.disabled = false;
    }
  }

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
  checkSupport();
})();
