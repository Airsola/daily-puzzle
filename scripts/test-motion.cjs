/* PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-motion.cjs */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      let now = 0, id = 0;
      const frames = new Map();
      performance.now = () => now;
      window.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
      window.cancelAnimationFrame = id => frames.delete(id);
      window.advanceMotion = ms => {
        now += ms;
        const pending = [...frames.values()]; frames.clear();
        pending.forEach(fn => fn(now));
      };
      let api;
      Object.defineProperty(window, 'PuzzleRenderer3D', {
        get: () => api,
        set(value) {
          api = value;
          const Renderer = THREE.WebGLRenderer;
          THREE.WebGLRenderer = class extends Renderer {
            constructor(...args) {
              super(...args);
              const render = this.render;
              this.render = function(scene, camera) {
                window.testScene = scene;
                return render.call(this, scene, camera);
              };
            }
          };
          const create = api.create;
          api.create = options => (window.testRenderer = create(options));
        },
      });
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.evaluate(() => advanceMotion(0));
    // Select the asymmetric blue L piece, then use the normal toolbar handlers.
    await page.evaluate(() => {
      const stage = document.querySelector('#stage');
      const capture = stage.setPointerCapture;
      stage.setPointerCapture = () => {};
      try {
        const t = new DOMMatrix(document.querySelector('.piece[data-i="1"]').style.transform);
        const point = testRenderer.project(t.e + 50 * t.a, t.f + 50 * t.d, -8.5);
        for (const type of ['pointerdown', 'pointerup']) stage.dispatchEvent(new PointerEvent(type, {
          bubbles: true, pointerId: 41, button: 0, clientX: point.x, clientY: point.y,
        }));
      } finally { stage.setPointerCapture = capture; }
    });
    // Explicit RAF timing avoids software-GPU latency in intermediate samples.
    const advance = ms => page.evaluate(ms => advanceMotion(ms), ms);
    await advance(400);
    const pose = () => page.evaluate(() => {
      const m = testScene.children.find(o => o.userData.pieceIndex === 1);
      return { matrix: m.matrix.elements.slice(), normal: m.matrixAutoUpdate,
        position: m.position.toArray(), scale: m.scale.toArray(), frames: testRenderer.diagnostics.frames };
    });
    for (const action of ['rotate', 'flip']) {
      await page.evaluate(id => document.getElementById(id).click(), action);
      const beginning = await pose();
      assert.equal(beginning.normal, false, `${action}: enters centered animation`);
      await advance(100);
      const middle = await pose();
      assert.equal(middle.normal, false, `${action}: remains animated mid-transition`);
      assert.notDeepEqual(middle.matrix, beginning.matrix, `${action}: has intermediate poses`);
      if (action === 'flip') assert.ok(Math.abs(middle.matrix[2]) > 0.05, 'flip rotates out of the board plane');
      await advance(400);
      const end = await pose();
      assert.equal(end.normal, true, `${action}: restores ordinary mesh transforms`);
      assert.ok(Math.abs(end.matrix[1]) < 1e-8 && Math.abs(end.matrix[2]) < 1e-8, 'no residual rotation');
      await advance(100);
      assert.equal((await pose()).frames, end.frames, 'animation stops rendering when settled');
    }
    // Repeated actions must compose from the currently displayed pose without
    // resetting the piece center or leaving a tilted final mesh.
    const continuity = await page.evaluate(() => {
      const mesh = () => testScene.children.find(o => o.userData.pieceIndex === 1);
      const center = () => {
        const m = mesh();
        return m.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(m.matrix);
      };
      document.querySelector('#rotate').click();
      advanceMotion(75);
      const before = center();
      document.querySelector('#flip').click();
      const after = center();
      for (let i = 0; i < 6; i++) document.querySelector(i % 2 ? '#flip' : '#rotate').click();
      return before.distanceTo(after);
    });
    assert.ok(continuity < 1e-6, 'rapid second action preserves the visible center');
    await advance(450);
    assert.equal((await pose()).normal, true);
    // Re-grabbing a turning block settles it and retains the exact local hit
    // anchor, so the subsequent drag cannot inherit a tilted transform.
    await page.evaluate(() => document.querySelector('#flip').click());
    await advance(100);
    const captured = await page.evaluate(() => {
      const mesh = testScene.children.find(o => o.userData.pieceIndex === 1);
      const state = JSON.parse(localStorage.getItem('daily-puzzle:' + document.querySelector('#date').value));
      const [r, c] = PuzzleCore.orient(PuzzleCore.PIECES[1].cells, state.pieces[1].o)[0];
      mesh.updateMatrixWorld(true);
      const world = mesh.localToWorld(new THREE.Vector3(c * 100 + 50, -r * 100 - 50, 30));
      const point = testRenderer.project(world.x, -world.y, world.z);
      const hit = testRenderer.hitTest(point.x, point.y);
      const anchor = testRenderer.capturePiece(1);
      return { hit, anchor };
    });
    assert.equal(captured.hit, 1);
    assert.ok(Number.isFinite(captured.anchor.anchorX) && Number.isFinite(captured.anchor.anchorY));
    assert.equal((await pose()).normal, true);
    await advance(400);
    // Reduced-motion preference must skip both orientation animations.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(60);
    for (const action of ['rotate', 'flip']) {
      await page.evaluate(id => document.getElementById(id).click(), action);
      assert.equal((await pose()).normal, true, 'reduced motion settles immediately');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: intermediate rotation/3D flip, final alignment, rapid action continuity, idle rendering, reduced motion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
