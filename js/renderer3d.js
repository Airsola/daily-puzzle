/*
 * Tactile calendar-puzzle renderer. Classic script; only window.THREE (r160)
 * and window.PuzzleCore are required. No network requests or perpetual loop.
 * Public coordinates are the app's SVG coordinates: x right, y down, CELL=100.
 */
(function (root) {
  'use strict';

  const CELL = 100, BX = 40, BY = 80, FW = 780, FH = 920;
  const BLOCK_TOP = 30, TABLE_Z = -26, TILT = Math.PI / 15;
  const DEFAULT_COLORS = ['#E07A5F', '#3D7EA6', '#F2CC8F', '#81B29A', '#9C89B8',
    '#F4A261', '#5FA8A3', '#E5989B', '#6D8B74', '#B5838D'];
  const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  const key = (r, c) => r + ',' + c;

  // Cancel shared edges first, then trace the resulting closed polygons. This
  // gives ONE continuous extrusion per polyomino, including its concave turns.
  function contours(cells) {
    const occupied = new Set(cells.map((p) => key(p[0], p[1])));
    const edges = [], starts = new Map();
    function add(x, y, X, Y) {
      const edge = { a: [x, y], b: [X, Y], used: false };
      edges.push(edge);
      const k = key(x, y);
      if (!starts.has(k)) starts.set(k, []);
      starts.get(k).push(edge);
    }
    cells.forEach(([r, c]) => {
      if (!occupied.has(key(r - 1, c))) add(c, r, c + 1, r);
      if (!occupied.has(key(r, c + 1))) add(c + 1, r, c + 1, r + 1);
      if (!occupied.has(key(r + 1, c))) add(c + 1, r + 1, c, r + 1);
      if (!occupied.has(key(r, c - 1))) add(c, r + 1, c, r);
    });
    const loops = [];
    edges.forEach((first) => {
      if (first.used) return;
      const loop = [];
      let edge = first;
      while (edge && !edge.used) {
        edge.used = true;
        loop.push(edge.a.map((v) => v * CELL));
        const candidates = (starts.get(key(edge.b[0], edge.b[1])) || []).filter((e) => !e.used);
        // At a diagonal touch, follow the right-hand boundary rather than
        // joining two otherwise disconnected outlines at a single vertex.
        const dx = edge.b[0] - edge.a[0], dy = edge.b[1] - edge.a[1];
        candidates.sort((a, b) => {
          const score = (e) => {
            const ex = e.b[0] - e.a[0], ey = e.b[1] - e.a[1];
            return dx * ey - dy * ex === 1 ? 0 : dx * ex + dy * ey === 1 ? 1 : 2;
          };
          return score(a) - score(b);
        });
        edge = candidates[0];
      }
      if (loop.length < 3) return;
      loops.push(loop.filter((p, i) => {
        const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
        return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
      }));
    });
    return loops;
  }

  function area(loop) {
    return loop.reduce((sum, p, i) => {
      const q = loop[(i + 1) % loop.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0) / 2;
  }

  // All source boundaries are orthogonal, so this exact miter offset does not
  // introduce the internal gaps that shrinking individual cells would create.
  function inset(loop, amount) {
    return loop.map((p, i) => {
      const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
      const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]);
      const l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
      return [p[0] - amount * ((p[1] - a[1]) / l1 + (b[1] - p[1]) / l2),
        p[1] + amount * ((p[0] - a[0]) / l1 + (b[0] - p[0]) / l2)];
    });
  }

  function cleanCells(cells) {
    if (!Array.isArray(cells) || !cells.length || cells.length > 64) return null;
    const seen = new Set(), result = [];
    for (const p of cells) {
      if (!Array.isArray(p) || !Number.isInteger(p[0]) || !Number.isInteger(p[1]) ||
          Math.abs(p[0]) > 16 || Math.abs(p[1]) > 16) return null;
      const k = key(p[0], p[1]);
      if (!seen.has(k)) { seen.add(k); result.push([p[0], p[1]]); }
    }
    return result.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  function create(options) {
    options = options || {};
    const T = root.THREE, core = root.PuzzleCore, container = options.container;
    if (!T || !T.WebGLRenderer || !core || !core.CELLS || !core.PIECES) {
      throw new Error('PuzzleRenderer3D requires THREE and PuzzleCore.');
    }
    if (!container || typeof container.appendChild !== 'function') {
      throw new Error('PuzzleRenderer3D requires a container element.');
    }

    const resources = new Set(), geometryCache = new Map(), pieces = new Map();
    const colors = Array.isArray(options.colors) ? options.colors : DEFAULT_COLORS;
    const canvas = document.createElement('canvas');
    canvas.className = 'puzzle-canvas-3d';
    canvas.setAttribute('aria-label', '立体木质每日拼图棋盘');
    canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;';
    let renderer, scene, camera, light, ghost, floorTexture, labelCanvas, labelContext;
    let resizeObserver, motionQuery, raf = 0, disposed = false, unavailable = false;
    let layout = { W: 1510, H: 920 }, lastHit = null, lastHitLocal = null, targetsKey = '', ghostKey = '';
    let width = 0, height = 0, dpr = 0, renderedFrames = 0;
    let reducedMotion = false;
    const raycaster = new T.Raycaster(), pointer = new T.Vector2();
    const hitPoint = new T.Vector3(), topPlane = new T.Plane(new T.Vector3(0, 0, 1), -BLOCK_TOP);
    const own = (resource) => { resources.add(resource); return resource; };

    function fail(error) {
      if (disposed || unavailable) return;
      unavailable = true;
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
      if (typeof options.onUnavailable === 'function') {
        try { options.onUnavailable(error); } catch (_) { /* Host owns its fallback. */ }
      }
    }
    function contextLost(event) {
      event.preventDefault();
      fail(new Error('The puzzle WebGL context was lost.'));
    }
    function invalidate() {
      if (!disposed && !unavailable && !raf) raf = root.requestAnimationFrame(render);
    }
    function applyTransform(p, values) {
      p.mesh.position.set(values.x, -values.y, values.z);
      p.mesh.scale.set(values.scale, values.scale, values.depth);
    }
    function piecePose(p) {
      if (p.pose) return { ...p.pose, center: p.pose.center.clone(), rotation: p.pose.rotation.clone() };
      const c = p.cache.geometry.boundingBox.getCenter(new T.Vector3());
      return { center: c.multiply(p.mesh.scale).add(p.mesh.position),
        rotation: new T.Quaternion(), scale: p.mesh.scale.x, depth: p.mesh.scale.z };
    }
    function finishMotion(p) {
      p.motion = null; p.pose = null;
      p.mesh.matrixAutoUpdate = true;
      p.mesh.quaternion.identity();
      p.outline.visible = p.selected;
      applyTransform(p, p.target);
      p.mesh.updateMatrix();
    }
    function renderMotion(p, now) {
      const motion = p.motion;
      const t = reducedMotion ? 1 : Math.min(1, Math.max(0, (now - motion.start) / motion.duration));
      if (t === 1) { finishMotion(p); return false; }
      const ease = t * t * (3 - 2 * t);
      const localCenter = p.cache.geometry.boundingBox.getCenter(new T.Vector3());
      const target = p.target;
      const end = localCenter.clone().multiply(new T.Vector3(target.scale, target.scale, target.depth))
        .add(new T.Vector3(target.x, -target.y, target.z));
      const pose = p.pose = {
        center: motion.from.center.clone().lerp(end, ease),
        rotation: motion.from.rotation.clone().slerp(new T.Quaternion(), ease),
        scale: T.MathUtils.lerp(motion.from.scale, target.scale, ease),
        depth: T.MathUtils.lerp(motion.from.depth, target.depth, ease),
      };
      pose.center.z += Math.sin(Math.PI * ease) * motion.lift;
      p.mesh.matrixAutoUpdate = false;
      p.mesh.matrix.compose(pose.center, pose.rotation, new T.Vector3(pose.scale, pose.scale, pose.depth))
        .multiply(new T.Matrix4().makeTranslation(-localCenter.x, -localCenter.y, -localCenter.z));
      p.mesh.matrixWorldNeedsUpdate = true;
      return true;
    }
    function render(now) {
      raf = 0;
      if (disposed || unavailable) return;
      let settling = false;
      pieces.forEach((p) => {
        if (p.motion) { settling = renderMotion(p, now) || settling; return; }
        if (!p.tween) return;
        const t = reducedMotion ? 1 : Math.min(1, Math.max(0, (now - p.tween.start) / 190));
        const ease = 1 - Math.pow(1 - t, 3), value = {};
        ['x', 'y', 'z', 'scale', 'depth'].forEach((k) => {
          value[k] = p.tween.from[k] + (p.target[k] - p.tween.from[k]) * ease;
        });
        applyTransform(p, value);
        if (t === 1) p.tween = null;
        else settling = true;
      });
      try {
        renderer.render(scene, camera);
        renderedFrames++;
      } catch (error) { fail(error); }
      if (settling) invalidate();
    }

    // Paths are expressed in public x/y coordinates until this single boundary.
    function path(loop, radius, isHole) {
      const result = isHole ? new T.Path() : new T.Shape();
      const corners = loop.map((p, i) => {
        const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
        const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
        const r = Math.min(radius, la / 3, lb / 3);
        return { p, a: [p[0] + (a[0] - p[0]) * r / la, p[1] + (a[1] - p[1]) * r / la],
          b: [p[0] + (b[0] - p[0]) * r / lb, p[1] + (b[1] - p[1]) * r / lb] };
      });
      result.moveTo(corners[0].a[0], -corners[0].a[1]);
      corners.forEach((c) => {
        result.lineTo(c.a[0], -c.a[1]);
        result.quadraticCurveTo(c.p[0], -c.p[1], c.b[0], -c.b[1]);
      });
      result.closePath();
      return result;
    }
    function shapesFor(loops, amount, radius) {
      const outside = loops.filter((loop) => area(loop) > 0);
      const holes = loops.filter((loop) => area(loop) < 0);
      return outside.map((loop) => {
        const shape = path(inset(loop, amount), radius, false);
        // Existing puzzle pieces have no holes; this also supports ring shapes.
        holes.forEach((hole) => {
          const p = hole[0];
          let inside = false;
          for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
            const a = loop[i], b = loop[j];
            if ((a[1] > p[1]) !== (b[1] > p[1]) &&
                p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
          }
          if (inside) shape.holes.push(path(inset(hole, amount), radius, true));
        });
        return shape;
      });
    }
    function extrude(shapes, depth, bevel, size) {
      return own(new T.ExtrudeGeometry(shapes, { depth, steps: 1, bevelEnabled: true,
        bevelThickness: bevel, bevelSize: size, bevelSegments: 3, curveSegments: 5 }));
    }
    function mesh(geometry, material, z) {
      const object = new T.Mesh(geometry, material);
      object.position.z = z || 0;
      object.castShadow = true;
      object.receiveShadow = true;
      scene.add(object);
      return object;
    }
    function textureFrom(source) {
      const texture = own(new T.CanvasTexture(source));
      texture.colorSpace = T.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return texture;
    }
    function makeCanvas(w, h) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D textures are unavailable.');
      return [c, ctx];
    }
    function grainTexture(pale, tabletop) {
      const [c, ctx] = makeCanvas(512, 512), data = ctx.createImageData(512, 512);
      let seed = 731;
      const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
        const index = (y * 512 + x) * 4;
        // Periodic grain, so repeated texture tiles have no conspicuous seam.
        const wave = y + 1.5 * Math.sin(x * Math.PI / 256) + 0.6 * Math.sin(x * Math.PI / 64);
        const grain = 0.65 * Math.sin(wave * Math.PI / 2) + 0.3 * Math.sin(wave * Math.PI / 64);
        const v = tabletop ? (noise() - 0.5) * 3 : grain * (pale ? 0.7 : 1.4) + (noise() - 0.5) * 1.6;
        const base = tabletop ? [220, 220, 211] : pale ? [249, 248, 243] : [226, 207, 179];
        data.data[index] = base[0] + v;
        data.data[index + 1] = base[1] + v;
        data.data[index + 2] = base[2] + v;
        data.data[index + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      const texture = textureFrom(c);
      texture.wrapS = texture.wrapT = T.RepeatWrapping;
      texture.repeat.set(1 / 520, 1 / 520);
      return texture;
    }
    function labelPlane(texture, z) {
      const material = own(new T.MeshBasicMaterial({ map: texture, transparent: true,
        depthWrite: false, toneMapped: false }));
      const plane = mesh(own(new T.PlaneGeometry(FW, FH)), material, z);
      plane.position.set(FW / 2, -FH / 2, z);
      plane.castShadow = plane.receiveShadow = false;
      plane.renderOrder = 1;
      return plane;
    }
    function drawLabels(targets) {
      const ctx = labelContext;
      ctx.clearRect(0, 0, FW, FH);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      core.CELLS.forEach(([r, c, label]) => {
        const x = BX + c * CELL, y = BY + r * CELL, target = targets.has(key(r, c));
        ctx.strokeStyle = 'rgba(98,68,38,0.12)'; ctx.lineWidth = 0.8;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        // Targets remain actual exposed wood, not painted tiles or floating cards.
        ctx.font = (target ? '600 ' : '500 ') + (label.length > 2 ? '23px ' : '29px ') + FONT;
        ctx.fillStyle = target ? '#a34332' : '#60482f';
        ctx.fillText(label, x + CELL / 2, y + CELL / 2);
      });
      floorTexture.needsUpdate = true;
    }
    function pieceGeometry(cells) {
      const signature = cells.map((p) => key(p[0], p[1])).join(';');
      if (geometryCache.has(signature)) return geometryCache.get(signature);
      const loops = contours(cells), shapes = shapesFor(loops, 6, 4);
      const geometry = extrude(shapes, 24, 3, 3);
      // Bake the bottom to zero and top to 30, independent of mesh placement.
      geometry.translate(0, 0, 3);
      geometry.computeBoundingBox();
      const lineVertices = [];
      shapes.forEach((shape) => {
        const points = shape.getPoints(5);
        for (let i = 0; i < points.length - 1; i++) {
          lineVertices.push(points[i].x, points[i].y, BLOCK_TOP + 0.25,
            points[i + 1].x, points[i + 1].y, BLOCK_TOP + 0.25);
        }
      });
      const outline = own(new T.BufferGeometry());
      outline.setAttribute('position', new T.Float32BufferAttribute(lineVertices, 3));
      const flat = own(new T.ShapeGeometry(shapes, 5));
      const cached = { signature, geometry, outline, flat };
      geometryCache.set(signature, cached);
      return cached;
    }

    function fit() {
      if (disposed || unavailable || !renderer) return;
      const rect = container.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rect.width || container.clientWidth || 1));
      const nextHeight = Math.max(1, Math.round(rect.height || container.clientHeight || 1));
      const nextDpr = Math.min(2, Math.max(1, root.devicePixelRatio || 1));
      if (width !== nextWidth || height !== nextHeight || dpr !== nextDpr) {
        width = nextWidth; height = nextHeight; dpr = nextDpr;
        renderer.setPixelRatio(dpr);
        renderer.setSize(width, height, false);
      }
      const aspect = width / height, padding = 54;
      const fitWidth = layout.W + padding * 2;
      const fitHeight = layout.H * Math.cos(TILT) + padding * 2 + 15;
      const h = Math.max(fitHeight, fitWidth / aspect), w = h * aspect;
      camera.left = -w / 2; camera.right = w / 2;
      camera.top = h / 2; camera.bottom = -h / 2;
      camera.position.set(layout.W / 2, -layout.H / 2 - Math.sin(TILT) * 2600, Math.cos(TILT) * 2600);
      camera.up.set(0, 1, 0);
      camera.lookAt(layout.W / 2, -layout.H / 2, 0);
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      light.position.set(layout.W / 2 - 650, -layout.H / 2 + 750, 1350);
      light.target.position.set(layout.W / 2, -layout.H / 2, 0);
      const span = Math.max(layout.W, layout.H) * 0.76 + 220;
      light.shadow.camera.left = light.shadow.camera.bottom = -span;
      light.shadow.camera.right = light.shadow.camera.top = span;
      light.shadow.camera.updateProjectionMatrix();
      invalidate();
    }
    function setLayout(value) {
      if (disposed || unavailable || !value || !finite(value.W) || !finite(value.H) || value.W <= 0 || value.H <= 0) return;
      layout = { W: value.W, H: value.H };
      fit();
    }
    function setTargets(value) {
      if (disposed || unavailable) return;
      const targets = new Set((Array.isArray(value) ? value : []).filter((p) => Array.isArray(p)).map((p) => key(p[0], p[1])));
      const signature = Array.from(targets).sort().join(';');
      if (signature === targetsKey) return;
      targetsKey = signature;
      drawLabels(targets);
      invalidate();
    }

    let blockGrain, selectionMaterial, ghostMaterial;
    function setPiece(index, value) {
      if (disposed || unavailable || !value || !Number.isInteger(index) || index < 0 || index >= core.PIECES.length) return;
      const cells = cleanCells(value.cells);
      if (!cells || !finite(value.x) || !finite(value.y)) return;
      const scale = finite(value.scale) && value.scale > 0 ? value.scale : 1;
      let p = pieces.get(index);
      const cache = pieceGeometry(cells);
      if (!p) {
        const color = new T.Color(colors[index] || DEFAULT_COLORS[index % DEFAULT_COLORS.length]);
        const top = own(new T.MeshStandardMaterial({ color, map: blockGrain, roughness: 0.55, metalness: 0 }));
        const side = own(new T.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.88),
          map: blockGrain, roughness: 0.61, metalness: 0 }));
        const object = mesh(cache.geometry, [top, side], 0);
        object.userData.pieceIndex = index;
        const outline = new T.LineSegments(cache.outline, selectionMaterial);
        outline.visible = false;
        object.add(outline);
        p = { mesh: object, outline, top, side, cache, tween: null, target: null, dragging: false, selected: false };
        pieces.set(index, p);
      }
      const requestedMotion = value.motion === 'rotate' || value.motion === 'flip';
      const animateMotion = requestedMotion && !!p.target && !reducedMotion;
      // Rebase a rapid second action from the visible pose, not from its old
      // destination. Geometry changes are compensated around the block center.
      const fromPose = animateMotion ? piecePose(p) : null;
      if (p.motion && !animateMotion && (p.cache !== cache || (!value.animate && !value.dragging) || reducedMotion)) finishMotion(p);
      const geometryChanged = p.cache !== cache;
      if (geometryChanged) {
        p.cache = cache; p.mesh.geometry = cache.geometry; p.outline.geometry = cache.outline;
      }
      const dragging = !!value.dragging, selected = !!value.selected;
      // Tray pieces sit on the tabletop; placed pieces sit inside the recess.
      // Dragging lifts a block above the wooden rim, not just above the floor.
      const target = { x: value.x, y: value.y, scale,
        depth: dragging || value.placed ? 1 : Math.max(0.55, Math.min(1, scale)),
        z: dragging ? 25 : value.placed ? 0.45 : TABLE_Z + 1 };
      const changed = !p.target || Object.keys(target).some((k) => target[k] !== p.target[k]);
      const stateChanged = p.dragging !== dragging || p.selected !== selected;
      p.dragging = dragging; p.selected = selected;
      p.outline.visible = selected;
      p.top.emissive.set(selected ? '#67523c' : '#000000');
      p.top.emissiveIntensity = selected ? 0.075 : 0;
      if (animateMotion) {
        const flip = value.motion === 'flip';
        fromPose.rotation.multiply(new T.Quaternion().setFromAxisAngle(
          flip ? new T.Vector3(0, 1, 0) : new T.Vector3(0, 0, 1), flip ? Math.PI : Math.PI / 2));
        p.target = target; p.tween = null;
        const bounds = cache.geometry.boundingBox;
        p.motion = { from: fromPose, start: root.performance.now(), duration: flip ? 340 : 260,
          lift: flip ? (bounds.max.x - bounds.min.x) * Math.max(fromPose.scale, scale) / 2 + 20 : 22 };
        p.outline.visible = false;
        renderMotion(p, p.motion.start);
        invalidate();
        return;
      }
      if (p.motion) {
        p.target = target;
        p.outline.visible = false;
        invalidate();
        return;
      }
      if (changed) {
        const from = { x: p.mesh.position.x, y: -p.mesh.position.y, z: p.mesh.position.z,
          scale: p.mesh.scale.x, depth: p.mesh.scale.z };
        const animate = !!value.animate && !!p.target && !dragging && !reducedMotion;
        p.target = target;
        p.tween = animate ? { from, start: root.performance.now() } : null;
        if (!animate) applyTransform(p, target);
      } else if (p.tween && (dragging || value.animate === false || reducedMotion)) {
        p.tween = null;
        applyTransform(p, target);
      }
      if (changed || geometryChanged || stateChanged) invalidate();
    }
    function setGhost(cells, snap) {
      if (disposed || unavailable) return;
      if (!cells || !snap || !finite(snap.row) || !finite(snap.col)) {
        if (ghost && ghost.visible) { ghost.visible = false; ghostKey = ''; invalidate(); }
        return;
      }
      const valid = cleanCells(cells);
      if (!valid) return;
      const cache = pieceGeometry(valid), signature = cache.signature + '@' + snap.row + ',' + snap.col;
      if (signature === ghostKey) return;
      ghostKey = signature;
      if (!ghost) {
        ghost = mesh(cache.flat, ghostMaterial, 1.2);
        ghost.castShadow = ghost.receiveShadow = false;
        ghost.renderOrder = 2;
      }
      ghost.geometry = cache.flat;
      ghost.position.set(BX + snap.col * CELL, -(BY + snap.row * CELL), 1.2);
      ghost.visible = true;
      invalidate();
    }
    function setRay(clientX, clientY) {
      if (disposed || unavailable || !finite(clientX) || !finite(clientY)) return false;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
      camera.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      return true;
    }
    function hitTest(clientX, clientY) {
      lastHit = null; lastHitLocal = null;
      if (!setRay(clientX, clientY) || Math.abs(pointer.x) > 1 || Math.abs(pointer.y) > 1) return null;
      scene.updateMatrixWorld(true);
      const objects = Array.from(pieces.values()).map((p) => p.mesh);
      const hits = raycaster.intersectObjects(objects, false);
      if (hits.length) {
        lastHit = hits[0].object.userData.pieceIndex;
        lastHitLocal = hits[0].object.worldToLocal(hits[0].point.clone());
      }
      return lastHit;
    }
    // Freeze a settling piece at the visible pose before computing the grab
    // anchor. The logical destination can differ greatly during a tray return.
    function capturePiece(index) {
      const p = pieces.get(index);
      if (!p || disposed || unavailable) return null;
      if (p.motion) { finishMotion(p); invalidate(); }
      p.tween = null;
      p.target = { x: p.mesh.position.x, y: -p.mesh.position.y, z: p.mesh.position.z,
        scale: p.mesh.scale.x, depth: p.mesh.scale.z };
      return { x: p.target.x, y: p.target.y, s: p.target.scale,
        anchorX: lastHit === index && lastHitLocal ? lastHitLocal.x : undefined,
        anchorY: lastHit === index && lastHitLocal ? -lastHitLocal.y : undefined };
    }
    function toWorld(clientX, clientY) {
      if (!setRay(clientX, clientY)) return { x: 0, y: 0 };
      let piece = null;
      pieces.forEach((p) => { if (p.dragging) piece = p; });
      if (!piece && lastHit !== null) piece = pieces.get(lastHit);
      const z = piece ? piece.mesh.position.z + BLOCK_TOP * piece.mesh.scale.z : BLOCK_TOP;
      topPlane.constant = -z;
      if (!raycaster.ray.intersectPlane(topPlane, hitPoint)) return { x: 0, y: 0 };
      return { x: hitPoint.x, y: -hitPoint.y };
    }
    function project(x, y, z) {
      if (disposed || unavailable || !finite(x) || !finite(y)) return null;
      const rect = canvas.getBoundingClientRect();
      camera.updateMatrixWorld(true);
      const point = new T.Vector3(x, -y, finite(z) ? z : BLOCK_TOP).project(camera);
      return { x: rect.left + (point.x + 1) * rect.width / 2,
        y: rect.top + (1 - point.y) * rect.height / 2 };
    }
    function motionChanged(event) {
      reducedMotion = !!event.matches;
      invalidate();
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
      if (resizeObserver) resizeObserver.disconnect();
      root.removeEventListener('resize', fit);
      canvas.removeEventListener('webglcontextlost', contextLost);
      if (motionQuery) {
        if (motionQuery.removeEventListener) motionQuery.removeEventListener('change', motionChanged);
        else if (motionQuery.removeListener) motionQuery.removeListener(motionChanged);
      }
      resources.forEach((resource) => resource.dispose());
      resources.clear(); geometryCache.clear(); pieces.clear();
      if (scene) scene.clear();
      if (light && light.shadow) light.shadow.dispose();
      if (renderer) {
        renderer.dispose();
        // A discarded canvas must not retain one of the browser's scarce GL contexts.
        if (!unavailable) renderer.forceContextLoss();
      }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }

    try {
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false,
        powerPreference: 'default', preserveDrawingBuffer: false });
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.04;
      renderer.setClearColor('#deded5', 1);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.VSMShadowMap;
      scene = new T.Scene();
      camera = new T.OrthographicCamera(-800, 800, 500, -500, 1, 6000);
      scene.add(new T.HemisphereLight('#fff9ee', '#a2a397', 1.5));
      light = new T.DirectionalLight('#fff8ee', 2.7);
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.bias = -0.00012;
      light.shadow.normalBias = 0.7;
      light.shadow.radius = 4;
      light.shadow.blurSamples = 8;
      light.shadow.camera.near = 100; light.shadow.camera.far = 3800;
      scene.add(light, light.target);
      const fill = new T.DirectionalLight('#e8eff5', 0.55);
      fill.position.set(1000, -600, 900); scene.add(fill);

      const wood = grainTexture(false, false);
      blockGrain = grainTexture(true, false);
      const tabletop = grainTexture(false, true);
      // A world-space UV scale is used for the enormous table plane as well.
      const tableGeometry = own(new T.PlaneGeometry(12000, 12000));
      const uv = tableGeometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 12000, uv.getY(i) * 12000);
      const table = mesh(tableGeometry, own(new T.MeshStandardMaterial({ map: tabletop, roughness: 0.96, metalness: 0 })), TABLE_Z);
      table.position.set(700, -700, TABLE_Z); table.castShadow = false;

      const outer = [[0, 0], [664, 0], [664, 256], [FW, 256], [FW, FH], [0, FH]];
      const boardLoops = contours(core.CELLS).map((loop) => loop.map(([x, y]) => [x + BX, y + BY]));
      const bodyMaterial = own(new T.MeshStandardMaterial({ map: wood, color: '#c3ac8d', roughness: 0.66 }));
      const rimMaterial = own(new T.MeshStandardMaterial({ map: wood, color: '#fff8ec', roughness: 0.52 }));
      const floorMaterial = own(new T.MeshStandardMaterial({ map: wood, color: '#dfc9aa', roughness: 0.83 }));
      mesh(extrude(path(outer, 11, false), 20, 2, 2), bodyMaterial, -22);
      const rim = path(outer, 11, false);
      boardLoops.filter((loop) => area(loop) > 0).forEach((loop) => rim.holes.push(path(loop, 3, true)));
      mesh(extrude(rim, 14, 2, 2), rimMaterial, 2);
      mesh(own(new T.ShapeGeometry(shapesFor(boardLoops, 0, 3), 5)), floorMaterial, 0.12);

      // A low-frequency, baked contact shadow anchors the board even where the
      // directional shadow map is soft. It is not a replacement for real shadows.
      const [shadowCanvas, shadowCtx] = makeCanvas(980, 1120);
      shadowCtx.translate(100, 100);
      shadowCtx.shadowColor = 'rgba(49,38,27,0.38)'; shadowCtx.shadowBlur = 28;
      shadowCtx.shadowOffsetX = 2; shadowCtx.shadowOffsetY = 8;
      shadowCtx.fillStyle = '#31261b'; shadowCtx.beginPath();
      outer.forEach(([x, y], i) => i ? shadowCtx.lineTo(x, y) : shadowCtx.moveTo(x, y));
      shadowCtx.closePath(); shadowCtx.fill();
      const boardShadow = mesh(own(new T.PlaneGeometry(980, 1120)),
        own(new T.MeshBasicMaterial({ map: textureFrom(shadowCanvas), transparent: true,
          opacity: 0.22, depthWrite: false, toneMapped: false })), TABLE_Z + 0.15);
      boardShadow.position.set(FW / 2, -FH / 2, TABLE_Z + 0.15);
      boardShadow.castShadow = boardShadow.receiveShadow = false;

      [labelCanvas, labelContext] = makeCanvas(FW * 2, FH * 2);
      labelContext.scale(2, 2);
      floorTexture = textureFrom(labelCanvas);
      labelPlane(floorTexture, 0.4);
      drawLabels(new Set());
      const [titleCanvas, titleCtx] = makeCanvas(FW * 2, FH * 2);
      titleCtx.scale(2, 2); titleCtx.textAlign = 'center'; titleCtx.textBaseline = 'middle';
      titleCtx.fillStyle = '#66452c'; titleCtx.font = '600 31px ' + FONT;
      titleCtx.fillText('每日拼图', 340, 31);
      titleCtx.font = '500 10px ' + FONT; titleCtx.fillStyle = '#876445';
      titleCtx.fillText('D A I L Y   C A L E N D A R', 340, 58);
      titleCtx.font = '500 21px ' + FONT; titleCtx.fillStyle = '#805e40';
      titleCtx.fillText('坚持就是胜利', BX + 200, BY + 750);
      labelPlane(textureFrom(titleCanvas), 18.35);

      selectionMaterial = own(new T.LineBasicMaterial({ color: '#fff6da', transparent: true, opacity: 0.9, toneMapped: false }));
      ghostMaterial = own(new T.MeshBasicMaterial({ color: '#7f9c81', transparent: true, opacity: 0.35,
        depthWrite: false, toneMapped: false }));
      canvas.addEventListener('webglcontextlost', contextLost, false);
      container.appendChild(canvas);
      if (root.matchMedia) {
        motionQuery = root.matchMedia('(prefers-reduced-motion: reduce)');
        reducedMotion = motionQuery.matches;
        if (motionQuery.addEventListener) motionQuery.addEventListener('change', motionChanged);
        else if (motionQuery.addListener) motionQuery.addListener(motionChanged);
      }
      if (root.ResizeObserver) {
        resizeObserver = new root.ResizeObserver(fit);
        resizeObserver.observe(container);
      }
      root.addEventListener('resize', fit);
      fit();
      // Compile once while create() can still signal unsupported GPU/shaders to
      // the caller, rather than leaving an apparently successful blank instance.
      renderer.compile(scene, camera);
    } catch (error) {
      dispose();
      throw error;
    }

    return {
      canvas, setLayout, setTargets, setPiece, setGhost, hitTest, capturePiece, toWorld, project, dispose,
      // Read-only snapshots for integration/performance checks, not scene internals.
      get diagnostics() {
        return { revision: T.REVISION, disposed, unavailable, frames: renderedFrames,
          pendingFrame: !!raf, pieces: pieces.size, cachedShapes: geometryCache.size,
          pixelRatio: dpr, width, height, reducedMotion,
          memory: renderer ? Object.assign({}, renderer.info.memory) : {},
          render: renderer ? Object.assign({}, renderer.info.render) : {} };
      }
    };
  }

  root.PuzzleRenderer3D = { create };
})(window);
