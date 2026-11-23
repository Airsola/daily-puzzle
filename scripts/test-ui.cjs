/* Optional browser regression suite. No runtime/npm dependencies are needed by the game.
 * PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-ui.cjs
 * Screenshots go to UI_SCREENSHOT_DIR (defaults to OS temp directory).
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.PUZZLE_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const screenshots = process.env.UI_SCREENSHOT_DIR || os.tmpdir();
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Capture the renderer only in the test context, without a production debug global.
    await page.addInitScript(() => {
      let api;
      Object.defineProperty(window, 'PuzzleRenderer3D', {
        configurable: true,
        get: () => api,
        set: value => {
          api = value;
          const create = value.create;
          value.create = options => (window.testRenderer = create(options));
        },
      });
    });
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#stage').classList.contains('is-3d'));
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(screenshots, 'puzzle-3d-desktop.png') });
    assert.equal(await page.locator('#stage canvas').count(), 1);
    // Raycasting, click rotation, keyboard flip, then dragging into a legal board position.
    const point = await page.evaluate(() => {
      const p = document.querySelector('.piece[data-i="0"]');
      const t = new DOMMatrix(p.style.transform);
      return testRenderer.project(t.e + 50 * t.a, t.f + 50 * t.d, 30 * t.a);
    });
    await page.mouse.click(point.x, point.y);
    let state = await readState(page);
    assert.equal(state.pieces[0].o, 1, 'click rotates');
    await page.keyboard.press('f');
    state = await readState(page);
    assert.equal(state.pieces[0].o, 7, 'F flips');
    await page.click('#reset');
    await page.waitForTimeout(300);
    const dragPoints = await page.evaluate(() => {
      const t = new DOMMatrix(document.querySelector('.piece[data-i="0"]').style.transform);
      return { start: testRenderer.project(t.e + 50 * t.a, t.f + 50 * t.d, 30 * t.a), end: testRenderer.project(90, 130, 30) };
    });
    await page.mouse.move(dragPoints.start.x, dragPoints.start.y);
    await page.mouse.down();
    await page.mouse.move(dragPoints.end.x, dragPoints.end.y, { steps: 12 });
    await page.mouse.up();
    state = await readState(page);
    assert.deepEqual(state.pieces[0].pos, { row: 0, col: 0 }, 'drag snaps into board');
    await page.reload();
    assert.deepEqual((await readState(page)).pieces[0].pos, state.pieces[0].pos, 'reload preserves state');
    // Catch a piece in the first frame of its return animation: the visible
    // mesh, not the tray destination, must determine the drag anchor.
    await page.evaluate(() => {
      const stage = document.querySelector('#stage');
      const capture = stage.setPointerCapture;
      stage.setPointerCapture = () => {}; // synchronous deterministic pointer sequence
      try {
        const start = testRenderer.project(90, 130, 30.45);
        const end = testRenderer.project(90, 330, 55);
        document.querySelector('#reset').click();
        const fire = (type, point) => stage.dispatchEvent(new PointerEvent(type, {
          bubbles: true, pointerId: 77, pointerType: 'mouse', button: 0,
          clientX: point.x, clientY: point.y,
        }));
        fire('pointerdown', start);
        fire('pointermove', end);
        fire('pointermove', end);
        fire('pointerup', end);
      } finally { stage.setPointerCapture = capture; }
    });
    state = await readState(page);
    assert.deepEqual(state.pieces[0].pos, { row: 2, col: 0 }, 'grabbing a settling piece retains its local anchor');
    // Toggle both renderers without changing the persisted puzzle.
    await page.click('#render-mode');
    assert.equal(await page.locator('#stage canvas').count(), 0);
    assert.deepEqual((await readState(page)).pieces, state.pieces);
    await page.click('#render-mode');
    assert.equal(await page.locator('#stage canvas').count(), 1);
    await page.click('#reset');
    await page.click('#hint');
    assert.equal((await readState(page)).pieces.filter(p => p.pos).length, 1);
    await page.click('#answer');
    await page.click('#modal-cancel');
    assert.equal((await readState(page)).pieces.filter(p => p.pos).length, 1);
    await page.click('#answer');
    await page.click('#modal-close');
    await page.waitForTimeout(350);
    state = await readState(page);
    assert.equal(state.won, true);
    await assertSolution(page, state);
    assert.equal(await page.textContent('#answer'), '换一种');
    await page.screenshot({ path: path.join(screenshots, 'puzzle-3d-solved.png') });
    const first = JSON.stringify(state.pieces);
    await page.click('#answer');
    state = await readState(page);
    assert.notEqual(JSON.stringify(state.pieces), first);
    await assertSolution(page, state);
    await page.click('#reset');
    for (let i = 0; i < 10; i++) await page.click('#hint');
    assert.equal((await readState(page)).won, true);
    assert.equal(await page.locator('#done').isVisible(), true);
    await page.click('#modal-close');
    assert.equal((await readState(page)).won, false);
    // Date change and phone-size rendering.
    await page.locator('#date').fill('2026-12-31');
    await page.locator('#date').dispatchEvent('change');
    assert.match(await page.textContent('#goal'), /12月.*31日/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.locator('#date').blur();
    await page.waitForTimeout(2200); // let the previous answer's toast disappear
    await page.screenshot({ path: path.join(screenshots, 'puzzle-3d-mobile.png') });
    // Real touch input through Chrome's protocol (not mouse emulation).
    const touch = await page.context().newCDPSession(page);
    const touchPoint = await page.evaluate(() => {
      const t = new DOMMatrix(document.querySelector('.piece[data-i="0"]').style.transform);
      return testRenderer.project(t.e + 50 * t.a, t.f + 50 * t.d, -8.5);
    });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchPoint.x, y: touchPoint.y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal((await readState(page)).pieces[0].o, 1, 'touch tap rotates');
    await page.click('#reset');
    await page.waitForTimeout(250);
    const touchDrag = await page.evaluate(() => {
      const t = new DOMMatrix(document.querySelector('.piece[data-i="0"]').style.transform);
      return { start: testRenderer.project(t.e + 50 * t.a, t.f + 50 * t.d, -8.5), end: testRenderer.project(90, 130, 55) };
    });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchDrag.start] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchDrag.end] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchDrag.end] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.deepEqual((await readState(page)).pieces[0].pos, { row: 0, col: 0 }, 'touch drag snaps');
    await page.click('#reset');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.click('#answer');
    await page.click('#modal-close');
    await page.waitForTimeout(350);
    await assertSolution(page, await readState(page));
    await page.screenshot({ path: path.join(screenshots, 'puzzle-3d-mobile-solved.png') });
    // Layout changes must leave toolbar and result banner off the board.
    for (const [width, height] of [[844, 390], [568, 320], [900, 900], [1280, 800], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(250);
      const layout = await page.evaluate(() => {
        const tools = document.querySelector('.tools').getBoundingClientRect();
        const card = document.querySelector('#modal .card').getBoundingClientRect();
        const a = testRenderer.project(0, 0, 18), b = testRenderer.project(780, 920, 18);
        return { toolbarVisible: tools.bottom <= innerHeight + 1,
          overlap: card.left < b.x && card.right > a.x && card.top < b.y && card.bottom > a.y,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(layout.toolbarVisible, true, `${width}x${height}: toolbar visible`);
      assert.equal(layout.overlap, false, `${width}x${height}: banner avoids board`);
      assert.equal(layout.overflow, false, `${width}x${height}: no horizontal overflow`);
      if (width === 844) await page.screenshot({ path: path.join(screenshots, 'puzzle-3d-landscape.png') });
    }
    const idleFrames = await page.evaluate(() => testRenderer.diagnostics.frames);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => testRenderer.diagnostics.frames), idleFrames, 'no perpetual render loop');
    // A lost GPU context must preserve progress and show the playable SVG fallback.
    await page.evaluate(() => document.querySelector('#stage canvas').dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
    assert.equal(await page.locator('#stage.is-3d').count(), 0);
    assert.equal((await readState(page)).won, true);
    await page.click('#reset');
    await page.click('#hint');
    assert.equal((await readState(page)).pieces.filter(p => p.pos).length, 1);
    assert.deepEqual(errors, []);
    const fallback = await browser.newPage();
    fallback.on('pageerror', error => errors.push(error.message));
    await fallback.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (type.includes('webgl')) return null;
        return getContext.call(this, type, ...args);
      };
    });
    await fallback.goto(url);
    assert.equal(await fallback.locator('#stage.is-3d').count(), 0, 'unsupported GPU falls back immediately');
    await fallback.click('#hint');
    assert.equal((await readState(fallback)).pieces.filter(p => p.pos).length, 1);
    assert.deepEqual(errors, []);
    await fallback.close();
    console.log('PASS: 3D rendering, hit testing, rotation/flip, mouse and touch drag/snap, reload, mode switching, hints, answers, discoveries, dates, portrait/landscape layouts, idle rendering, GPU fallback.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
async function readState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('daily-puzzle:' + document.querySelector('#date').value)));
}
async function assertSolution(page, state) {
  const valid = await page.evaluate(state => {
    const C = PuzzleCore, occupied = new Set();
    for (let i = 0; i < state.pieces.length; i++) {
      const p = state.pieces[i];
      if (!p.pos) return false;
      for (const [r, c] of C.orient(C.PIECES[i].cells, p.o)) {
        const row = r + p.pos.row, col = c + p.pos.col, key = row + ',' + col;
        if (!C.isBoardCell(row, col) || occupied.has(key)) return false;
        occupied.add(key);
      }
    }
    const [y, m, d] = document.querySelector('#date').value.split('-').map(Number);
    return occupied.size === 47 && C.targetCells(new Date(y, m - 1, d)).every(([r, c]) => !occupied.has(r + ',' + c));
  }, state);
  assert.equal(valid, true, 'solution has exactly the three target holes');
}
