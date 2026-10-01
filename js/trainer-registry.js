(function () {
  'use strict';

  const trainers = new Map();
  let defaultId = null;

  function register({ id, name, create, isDefault = false }) {
    if (!id || !name || typeof create !== 'function') {
      throw new Error('Trainer registration requires id, name, and create');
    }
    if (trainers.has(id)) throw new Error(`Duplicate trainer id: ${id}`);
    if (isDefault && defaultId) throw new Error(`Default trainer already set: ${defaultId}`);

    const trainer = { id, name, create };
    trainers.set(id, trainer);
    if (isDefault) defaultId = id;
    return trainer;
  }

  function list() {
    return Array.from(trainers.values());
  }

  function get(id) {
    return trainers.get(id) || null;
  }

  function getDefault() {
    return trainers.get(defaultId) || trainers.values().next().value || null;
  }

  window.WebXRTrainerRegistry = { register, list, get, getDefault };
})();