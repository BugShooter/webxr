(function () {
  'use strict';

  function createTrajectoryTrainer() {
    return {
      id: 'trajectory',
      name: 'Trajectory',
      init({ runtime, THREE, Base, scene }) {
        let group;

        const hudState = { hudLastText: '', hudLastBg: '' };
        let hudPanel;
        let hudLastUpdateAtMs = 0;

        // Dot
        let dotLeft;
        let dotRight;

        // Orientation grid (shared)
        let orientationGrid;

        // Trail (shared)
        let trailEnabled = false;
        const trail = [];
        let lastTrailX = 1e9;
        let lastTrailY = 1e9;
        const TRAIL_R = 0.018;
        const TRAIL_DIAMETER = TRAIL_R * 2;
        const TRAIL_FADE_SEC = 1.3;

        const PATHS = [
          { id: 'circle', name: 'Круг' },
          { id: 'eight', name: 'Восьмёрка' },
          { id: 'square', name: 'Квадрат' },
          { id: 'square_diag', name: 'Квадрат + диагонали' },
          { id: 'cross', name: 'Крест' },
          { id: 'rabitsa', name: 'Сетка рабица' },
        ];
        let pathIndex = 0;

        function currentPath() {
          return PATHS[pathIndex] || PATHS[0];
        }


        function makeGridLines() {
          const size = 1.2;
          const steps = 12;
          const verts = [];
          for (let i = 0; i <= steps; i++) {
            const t = -size / 2 + (size * i) / steps;
            // vertical
            verts.push(t, -size / 2, 0, t, size / 2, 0);
            // horizontal
            verts.push(-size / 2, t, 0, size / 2, t, 0);
          }

          const geom = new THREE.BufferGeometry();
          geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
          const mat = new THREE.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.25 });
          const lines = new THREE.LineSegments(geom, mat);
          lines.layers.set(0);
          return lines;
        }

        function makeDotMesh(layer, color, radius) {
          const geom = new THREE.CircleGeometry(radius, 36);
          const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1.0, side: THREE.DoubleSide });
          const mesh = new THREE.Mesh(geom, mat);
          mesh.layers.set(layer);
          return mesh;
        }

        function setOpacity(mesh, opacity) {
          if (!mesh || !mesh.material) return;
          const o = Base.clamp(opacity, 0, 1);
          mesh.material.opacity = o;
          mesh.material.transparent = o < 0.999;
          mesh.visible = o > 0.001;
          mesh.material.needsUpdate = true;
        }

        function polylinePoint(points, t) {
          // points: [{x,y}], closed expected
          if (!points || points.length < 2) return { x: 0, y: 0 };

          let total = 0;
          const segLen = [];
          for (let i = 0; i < points.length - 1; i++) {
            const dx = points[i + 1].x - points[i].x;
            const dy = points[i + 1].y - points[i].y;
            const l = Math.hypot(dx, dy);
            segLen.push(l);
            total += l;
          }

          const dist = (t % 1) * total;
          let acc = 0;
          for (let i = 0; i < segLen.length; i++) {
            const l = segLen[i];
            if (acc + l >= dist) {
              const u = l > 1e-6 ? (dist - acc) / l : 0;
              return {
                x: points[i].x + (points[i + 1].x - points[i].x) * u,
                y: points[i].y + (points[i + 1].y - points[i].y) * u,
              };
            }
            acc += l;
          }

          return { x: points[0].x, y: points[0].y };
        }

        function pathPosition(tSec, pathId) {
          const id = pathId;
          const R = 0.45;

          // Speed chosen to keep motion comfortable
          const speed = 0.22; // cycles/sec
          const tt = tSec * speed;

          if (id === 'circle') {
            const a = tt * Math.PI * 2;
            return { x: R * Math.cos(a), y: R * Math.sin(a) };
          }

          if (id === 'eight') {
            const a = tt * Math.PI * 2;
            return { x: R * Math.sin(a), y: R * Math.sin(a) * Math.cos(a) };
          }

          if (id === 'square') {
            const pts = [
              { x: -R, y: -R },
              { x: R, y: -R },
              { x: R, y: R },
              { x: -R, y: R },
              { x: -R, y: -R },
            ];
            return polylinePoint(pts, tt);
          }

          if (id === 'square_diag') {
            const pts = [
              { x: -R, y: -R },
              { x: R, y: -R },
              { x: R, y: R },
              { x: -R, y: R },
              { x: -R, y: -R },
              { x: R, y: R },
              { x: 0, y: 0 },
              { x: -R, y: R },
              { x: R, y: -R },
              { x: 0, y: 0 },
              { x: -R, y: -R },
            ];
            return polylinePoint(pts, tt);
          }

          if (id === 'cross') {
            const pts = [
              { x: 0, y: R },
              { x: 0, y: -R },
              { x: 0, y: 0 },
              { x: -R, y: 0 },
              { x: R, y: 0 },
              { x: 0, y: 0 },
              { x: 0, y: R },
            ];
            return polylinePoint(pts, tt);
          }

          // rabitsa: diamond-like loop
          const d = R;
          const pts = [
            { x: -d, y: 0 },
            { x: -d / 2, y: d / 2 },
            { x: 0, y: 0 },
            { x: d / 2, y: d / 2 },
            { x: d, y: 0 },
            { x: d / 2, y: -d / 2 },
            { x: 0, y: 0 },
            { x: -d / 2, y: -d / 2 },
            { x: -d, y: 0 },
          ];
          return polylinePoint(pts, tt);
        }

        function maybeAddTrailDot(x, y, nowSec) {
          if (!trailEnabled) return;

          const dx = x - lastTrailX;
          const dy = y - lastTrailY;
          if (Math.hypot(dx, dy) < TRAIL_DIAMETER) return;

          lastTrailX = x;
          lastTrailY = y;

          const mesh = makeDotMesh(0, 0xaaaaaa, TRAIL_R);
          mesh.material.opacity = 0.35;
          mesh.position.set(x, y, 0);
          group.add(mesh);
          trail.push({ mesh, bornAt: nowSec });
        }

        function updateTrail(nowSec) {
          for (let i = trail.length - 1; i >= 0; i--) {
            const t = trail[i];
            const age = nowSec - t.bornAt;
            const k = 1 - Base.clamp(age / TRAIL_FADE_SEC, 0, 1);
            setOpacity(t.mesh, 0.35 * k);
            if (age >= TRAIL_FADE_SEC) {
              group.remove(t.mesh);
              if (t.mesh.geometry) t.mesh.geometry.dispose();
              if (t.mesh.material) t.mesh.material.dispose();
              trail.splice(i, 1);
            }
          }
        }

        group = new THREE.Group();
        scene.add(group);

        orientationGrid = makeGridLines();
        group.add(orientationGrid);

        dotLeft = makeDotMesh(1, 0xff4d4d, 0.03);
        dotRight = makeDotMesh(2, 0xff4d4d, 0.03);
        group.add(dotLeft);
        group.add(dotRight);

        hudPanel = Base.createHudPanel(THREE, '...', '#222222');
        hudPanel.position.set(0, 2.45, -2.85);
        hudPanel.rotation.x = 0.25;
        scene.add(hudPanel);

        this._state = {
          runtime,
          THREE,
          Base,
          scene,
          group,
          hudState,
          hudPanel,
          hudLastUpdateAtMs,
          PATHS,
          pathIndex,
          trailEnabled,
          trail,
          lastTrailX,
          lastTrailY,
          dotLeft,
          dotRight,
        };
      },

      update({ t, input, settings, fade }) {
        const s = this._state;
        if (!s) return;

        if (input?.justX) {
          s.pathIndex = (s.pathIndex + 1) % s.PATHS.length;
        }
        if (input?.justY) {
          s.trailEnabled = !s.trailEnabled;
          s.lastTrailX = 1e9;
          s.lastTrailY = 1e9;
        }

        if (s.group) {
          s.group.position.set(0, settings.height, -settings.distance);
          s.group.scale.setScalar(settings.scale);
        }

        const path = s.PATHS[s.pathIndex] || s.PATHS[0];
        const pos = pathPosition(t, path.id);
        if (s.dotLeft) s.dotLeft.position.set(pos.x, pos.y, 0);
        if (s.dotRight) s.dotRight.position.set(pos.x, pos.y, 0);

        // Trail (grey, shared)
        const nowSec = t;

        const dx = pos.x - s.lastTrailX;
        const dy = pos.y - s.lastTrailY;
        if (s.trailEnabled && Math.hypot(dx, dy) >= TRAIL_DIAMETER) {
          s.lastTrailX = pos.x;
          s.lastTrailY = pos.y;

          const mesh = makeDotMesh(0, 0xaaaaaa, TRAIL_R);
          mesh.material.opacity = 0.35;
          mesh.position.set(pos.x, pos.y, 0);
          s.group.add(mesh);
          s.trail.push({ mesh, bornAt: nowSec });
        }

        // Fade trail
        for (let i = s.trail.length - 1; i >= 0; i--) {
          const item = s.trail[i];
          const age = nowSec - item.bornAt;
          const k = 1 - s.Base.clamp(age / TRAIL_FADE_SEC, 0, 1);
          setOpacity(item.mesh, 0.35 * k);
          if (age >= TRAIL_FADE_SEC) {
            s.group.remove(item.mesh);
            if (item.mesh.geometry) item.mesh.geometry.dispose();
            if (item.mesh.material) item.mesh.material.dispose();
            s.trail.splice(i, 1);
          }
        }

        setOpacity(s.dotLeft, fade.l);
        setOpacity(s.dotRight, fade.r);

        const nowMs = performance.now();
        if (s.hudPanel && nowMs - s.hudLastUpdateAtMs > 250) {
          const trailTxt = s.trailEnabled ? 'ON (Y)' : 'OFF (Y)';
          const fadeTxt = settings.altFadeEnabled ? `ON (${(settings.fadeProfiles[settings.fadeProfileIndex]?.name || 'profile')})` : 'OFF';

          const txt =
            `Тренажёр: Trajectory\n` +
            `Траектория: ${path.name} (X)\n` +
            `След (серый): ${trailTxt}\n` +
            `ALT fade (global): ${fadeTxt}\n` +
            `Откройте меню для настроек`;

          s.Base.updateHudPanel(s.THREE, s.hudState, s.hudPanel, txt, '#222222');
          s.hudLastUpdateAtMs = nowMs;
        }
      },

      dispose() {
        const s = this._state;
        if (!s) return;

        try {
          for (const item of s.trail) {
            s.group.remove(item.mesh);
            if (item.mesh.geometry) item.mesh.geometry.dispose();
            if (item.mesh.material) item.mesh.material.dispose();
          }
        } catch (_) {
          // ignore
        }

        if (s.hudPanel) {
          s.scene.remove(s.hudPanel);
          const map = s.hudPanel.material?.map;
          if (map) map.dispose();
          if (s.hudPanel.geometry) s.hudPanel.geometry.dispose();
          if (s.hudPanel.material) s.hudPanel.material.dispose();
        }

        if (s.group) {
          s.scene.remove(s.group);
          s.group.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose?.();
            if (obj.material) {
              if (obj.material.map) obj.material.map.dispose?.();
              obj.material.dispose?.();
            }
          });
        }

        this._state = null;
      },
    };
  }

  window.WebXRTrainers = window.WebXRTrainers || {};
  window.WebXRTrainers.trajectory = createTrajectoryTrainer;
})();
