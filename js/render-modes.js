(function () {
  'use strict';

  function createRenderer(THREE, canvas, xrEnabled) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = xrEnabled;
    return renderer;
  }

  function createVRRenderMode({ THREE, canvas }) {
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 0);
    const renderer = createRenderer(THREE, canvas, true);

    return {
      camera,
      renderer,
      showControllerModels: true,
      showReferenceEnvironment: true,
      getController(index) {
        return renderer.xr.getController(index);
      },
      resize() {
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      },
      updateControllerPose() {
        return null;
      },
      render(scene) {
        const xrCamera = renderer.xr.getCamera(camera);
        if (xrCamera?.isArrayCamera && xrCamera.cameras.length >= 2) {
          xrCamera.cameras[0].layers.enable(0);
          xrCamera.cameras[0].layers.enable(1);
          xrCamera.cameras[0].layers.disable(2);

          xrCamera.cameras[1].layers.enable(0);
          xrCamera.cameras[1].layers.enable(2);
          xrCamera.cameras[1].layers.disable(1);
        }
        renderer.render(scene, camera);
      },
      dispose() {
        renderer.dispose();
      },
    };
  }

  function createDesktopRenderMode({ THREE, canvas }) {
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 0);

    const eyeAspect = (window.innerWidth / 2) / Math.max(1, window.innerHeight);
    const leftEye = new THREE.PerspectiveCamera(75, eyeAspect, 0.1, 100);
    const rightEye = new THREE.PerspectiveCamera(75, eyeAspect, 0.1, 100);
    leftEye.position.x = -0.032;
    rightEye.position.x = 0.032;
    leftEye.layers.set(0);
    leftEye.layers.enable(1);
    rightEye.layers.set(0);
    rightEye.layers.enable(2);
    camera.add(leftEye, rightEye);

    const renderer = createRenderer(THREE, canvas, false);
    const controllers = [new THREE.Group(), new THREE.Group()];

    return {
      camera,
      renderer,
      showControllerModels: false,
      showReferenceEnvironment: true,
      getController(index) {
        return controllers[index];
      },
      resize() {
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        const nextEyeAspect = (width / 2) / height;
        leftEye.aspect = nextEyeAspect;
        leftEye.updateProjectionMatrix();
        rightEye.aspect = nextEyeAspect;
        rightEye.updateProjectionMatrix();
      },
      updateControllerPose({ controller0, controller1, pointer }) {
        const bounds = canvas.getBoundingClientRect();
        const width = Math.max(1, bounds.width);
        const height = Math.max(1, bounds.height);
        const x = Math.max(0, Math.min(width, pointer.x));
        const y = Math.max(0, Math.min(height, pointer.y));
        const eyeIndex = x < width / 2 ? 0 : 1;
        const eyeCamera = eyeIndex === 0 ? leftEye : rightEye;
        const eyeX = eyeIndex === 0 ? x : x - width / 2;
        const ndcX = (eyeX / (width / 2)) * 2 - 1;
        const ndcY = 1 - (y / height) * 2;

        camera.updateMatrixWorld(true);
        eyeCamera.updateMatrixWorld(true);
        const origin = eyeCamera.getWorldPosition(new THREE.Vector3());
        const direction = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(eyeCamera).sub(origin).normalize();
        controller1.position.copy(origin).addScaledVector(direction, 0.08);
        controller1.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);

        const leftHandPosition = camera.localToWorld(new THREE.Vector3(-0.22, -0.2, -0.55));
        controller0.position.copy(leftHandPosition);
        controller0.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
        return eyeIndex === 0 ? 1 : 2;
      },
      render(scene) {
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        const leftWidth = Math.floor(width / 2);
        const rightWidth = width - leftWidth;

        renderer.setScissorTest(true);
        renderer.setViewport(0, 0, leftWidth, height);
        renderer.setScissor(0, 0, leftWidth, height);
        renderer.render(scene, leftEye);
        renderer.setViewport(leftWidth, 0, rightWidth, height);
        renderer.setScissor(leftWidth, 0, rightWidth, height);
        renderer.render(scene, rightEye);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, width, height);
      },
      dispose() {
        renderer.dispose();
      },
    };
  }

  function create(options) {
    if (options.mode === 'vr') return createVRRenderMode(options);
    if (options.mode === 'desktop') return createDesktopRenderMode(options);
    throw new Error(`Unknown render mode: ${options.mode}`);
  }

  window.WebXRRenderModes = { create };
})();