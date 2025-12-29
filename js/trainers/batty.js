(function () {
  'use strict';

  function createBattyTrainer() {
    return {
      id: 'batty',
      name: 'Batty (скоро)',
      async start(ctx) {
        ctx.log('ℹ️ Batty ещё не реализован');
        alert('Batty ещё не реализован. Выберите Binocular MVP.');
      },
    };
  }

  window.WebXRTrainers = window.WebXRTrainers || {};
  window.WebXRTrainers.batty = createBattyTrainer;
})();
