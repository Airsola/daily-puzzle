/* 每日拼图 · 浏览器界面（SVG 渲染 + Pointer Events 拖拽） */
(function () {
  'use strict';
  const C = window.PuzzleCore;

  // ---------- 几何常量（SVG 用户坐标，1 格 = 100） ----------
  const CELL = 100, PAD = 40, TITLE = 80;
  const BX = PAD, BY = TITLE;                       // 棋盘左上角
  const FW = C.COLS * CELL + PAD * 2;              // 木框宽
  const FH = TITLE + C.ROWS * CELL + PAD;          // 木框高
  const COLORS = ['#E07A5F', '#3D7EA6', '#F2CC8F', '#81B29A', '#9C89B8',
                  '#F4A261', '#5FA8A3', '#E5989B', '#6D8B74', '#B5838D'];
  const NS = 'http://www.w3.org/2000/svg';
  const STORE = 'daily-puzzle:';

  const $ = (id) => document.getElementById(id);
  const svg = $('game'), boardLayer = $('board'), ghostLayer = $('ghost'), piecesLayer = $('pieces');
  const key = (r, c) => r + ',' + c;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /** 一组格子的外轮廓线段（相邻格之间不画） */
  function outline(cells, ox, oy) {
    const set = new Set(cells.map(([r, c]) => key(r, c)));
    let d = '';
    for (const [r, c] of cells) {
      const x = ox + c * CELL, y = oy + r * CELL;
      if (!set.has(key(r - 1, c))) d += `M${x},${y}h${CELL}`;
      if (!set.has(key(r + 1, c))) d += `M${x},${y + CELL}h${CELL}`;
      if (!set.has(key(r, c - 1))) d += `M${x},${y}v${CELL}`;
      if (!set.has(key(r, c + 1))) d += `M${x + CELL},${y}v${CELL}`;
    }
    return d;
  }

  // ---------- 状态 ----------
  const pieces = C.PIECES.map((p, i) => ({ i, o: 0, pos: null, g: null }));
  let layout = null;
  let dateStr = '', targets = [], targetSet = new Set();
  let selected = null, drag = null;
  let elapsed = 0, startedAt = null, won = false, usedAnswer = false, bestTime = null;
  let found = [];            // 当天玩家独立拼出的不同解法（解法指纹）
  let shownAnswers = new Set(); // 本次打开页面后「答案 / 换一种」展示过的解法，尽量不重复

  // ---------- 布局 ----------
  function computeLayout() {
    const r = $('stage').getBoundingClientRect();
    if (r.width / Math.max(r.height, 1) > 1.15) {
      const slot = 230, cols = 3;
      return { trayX: FW + 40, trayY: 0, cols, slot, scale: 0.5, W: FW + 40 + cols * slot, H: Math.max(FH, 4 * slot) };
    }
    const cols = 4, slot = FW / cols;
    return { trayX: 0, trayY: FH + 24, cols, slot, scale: 0.42, W: FW, H: FH + 24 + 3 * slot };
  }
  function applyLayout() {
    layout = computeLayout();
    svg.setAttribute('viewBox', `0 0 ${layout.W} ${layout.H}`);
    pieces.forEach((p) => place(p, false));
  }

  // ---------- 棋盘 ----------
  function drawBoard() {
    boardLayer.textContent = '';
    // 内阴影：让空格看起来是凹下去的槽，木块盖上去才有"镂空"对比
    const defs = el('defs', {}, boardLayer);
    const f = el('filter', { id: 'inset', x: '-10%', y: '-10%', width: '120%', height: '120%' }, defs);
    el('feFlood', { 'flood-color': '#5a3a1c', 'flood-opacity': '0.55', result: 'c' }, f);
    el('feComposite', { in: 'c', in2: 'SourceAlpha', operator: 'out', result: 'inv' }, f);
    el('feGaussianBlur', { in: 'inv', stdDeviation: '5', result: 'b' }, f);
    el('feOffset', { in: 'b', dx: '3', dy: '4', result: 'o' }, f);
    el('feComposite', { in: 'o', in2: 'SourceAlpha', operator: 'in', result: 's' }, f);
    const m = el('feMerge', {}, f);
    el('feMergeNode', { in: 'SourceGraphic' }, m);
    el('feMergeNode', { in: 's' }, m);
    const nx = BX + 6 * CELL + PAD * 0.6, ny = BY + 2 * CELL - PAD * 0.6;
    el('path', { class: 'frame', d: `M0,0H${nx}V${ny}H${FW}V${FH}H0Z` }, boardLayer);
    el('text', { class: 'title', x: BX + 3 * CELL, y: 58 }, boardLayer).textContent = '每日拼图';
    for (const [r, c, label] of C.CELLS) {
      const x = BX + c * CELL, y = BY + r * CELL;
      const k = key(r, c);
      el('rect', { class: 'cell' + (targetSet.has(k) ? ' target' : ''), 'data-k': k, x, y, width: CELL, height: CELL }, boardLayer);
      const t = el('text', {
        class: 'label' + (label.length > 2 ? ' small' : '') + (targetSet.has(k) ? ' target' : ''),
        x: x + CELL / 2, y: y + CELL / 2,
      }, boardLayer);
      t.textContent = label;
    }
    el('path', { class: 'well', d: outline(C.CELLS.map(([r, c]) => [r, c]), BX, BY) }, boardLayer);
    el('text', { class: 'motto', x: BX + 2 * CELL, y: BY + 7.5 * CELL, 'dominant-baseline': 'central' }, boardLayer)
      .textContent = '坚持就是胜利';
  }

  // ---------- 零件 ----------
  const cellsOf = (p) => C.orient(C.PIECES[p.i].cells, p.o);
  const sizeOf = (cells) => [Math.max(...cells.map((x) => x[0])) + 1, Math.max(...cells.map((x) => x[1])) + 1];

  function drawPiece(p) {
    if (!p.g) {
      p.g = el('g', { class: 'piece', 'data-i': p.i }, piecesLayer);
    }
    p.g.textContent = '';
    const cells = cellsOf(p);
    for (const [r, c] of cells)
      el('rect', { x: c * CELL, y: r * CELL, width: CELL + 0.5, height: CELL + 0.5, fill: COLORS[p.i] }, p.g);
    el('path', { class: 'edge', d: outline(cells, 0, 0) }, p.g);
  }

  function homeXYS(p) {
    const { trayX, trayY, cols, slot, scale } = layout;
    const [h, w] = sizeOf(cellsOf(p));
    const sx = trayX + (p.i % cols) * slot, sy = trayY + Math.floor(p.i / cols) * slot;
    return { x: sx + (slot - w * CELL * scale) / 2, y: sy + (slot - h * CELL * scale) / 2, s: scale };
  }
  function currentXYS(p) {
    return p.pos ? { x: BX + p.pos.col * CELL, y: BY + p.pos.row * CELL, s: 1 } : homeXYS(p);
  }
  function setTransform(p, x, y, s) {
    p.g.style.transform = `translate(${x}px,${y}px) scale(${s})`;
  }
  function place(p, animate) {
    p.g.classList.toggle('anim', !!animate);
    const { x, y, s } = currentXYS(p);
    setTransform(p, x, y, s);
  }
  function occupiedExcept(skip) {
    const occ = new Set();
    for (const p of pieces) {
      if (p === skip || !p.pos) continue;
      for (const [r, c] of cellsOf(p)) occ.add(key(r + p.pos.row, c + p.pos.col));
    }
    return occ;
  }
  function select(p) {
    if (selected && selected.g) selected.g.classList.remove('selected');
    selected = p;
    if (p) p.g.classList.add('selected');
  }

  /** 旋转/翻转后尽量留在棋盘原处；放不下就回到托盘 */
  function transformPiece(p, nextO) {
    const before = sizeOf(cellsOf(p));
    p.o = nextO;
    drawPiece(p);
    if (p.pos) {
      const after = sizeOf(cellsOf(p));
      const r0 = p.pos.row + Math.round((before[0] - after[0]) / 2);
      const c0 = p.pos.col + Math.round((before[1] - after[1]) / 2);
      const occ = occupiedExcept(p), cells = cellsOf(p);
      const tries = [[0, 0], [0, -1], [-1, 0], [0, 1], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
      const hit = tries.find(([dr, dc]) => C.canPlace(cells, r0 + dr, c0 + dc, occ));
      p.pos = hit ? { row: r0 + hit[0], col: c0 + hit[1] } : null;
    }
    if (drag && drag.p === p) {
      const [h, w] = sizeOf(cellsOf(p));
      drag.offX = (w * CELL) / 2;
      drag.offY = (h * CELL) / 2;
      moveDrag(drag.last);
    } else {
      place(p, true);
      afterChange();
    }
  }
  const rotate = (p) => p && !won && transformPiece(p, C.nextRotation(p.o));
  const flip = (p) => p && !won && transformPiece(p, C.nextFlip(p.o));

  // ---------- 拖拽 ----------
  function toSvg(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function snapOf(p, x, y) {
    const row = Math.round((y - BY) / CELL), col = Math.round((x - BX) / CELL);
    return C.canPlace(cellsOf(p), row, col, occupiedExcept(p)) ? { row, col } : null;
  }
  function drawGhost(p, snap) {
    ghostLayer.textContent = '';
    if (!snap) return;
    for (const [r, c] of cellsOf(p))
      el('rect', { class: 'ghost', x: BX + (c + snap.col) * CELL, y: BY + (r + snap.row) * CELL, width: CELL, height: CELL }, ghostLayer);
  }
  function moveDrag(pt) {
    const { p } = drag;
    const x = pt.x - drag.offX, y = pt.y - drag.offY;
    setTransform(p, x, y, 1);
    drag.snap = snapOf(p, x, y);
    drawGhost(p, drag.snap);
  }

  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.piece');
    if (!g || won || drag || e.button > 0) return;
    e.preventDefault();
    const p = pieces[+g.dataset.i];
    select(p);
    startTimer();
    const pt = toSvg(e), cur = currentXYS(p);
    drag = {
      p, id: e.pointerId, moved: false, snap: null, last: pt,
      sx: e.clientX, sy: e.clientY,
      offX: (pt.x - cur.x) / cur.s, offY: (pt.y - cur.y) / cur.s,
    };
    svg.setPointerCapture(e.pointerId);
    piecesLayer.appendChild(g);      // 置顶
    g.classList.remove('anim');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    if (!drag.moved) { drag.moved = true; drag.p.g.classList.add('dragging'); }
    drag.last = toSvg(e);
    moveDrag(drag.last);
  });
  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    ghostLayer.textContent = '';
    d.p.g.classList.remove('dragging');
    if (!d.moved) {
      if (!cancelled) rotate(d.p);        // 轻点 = 旋转
      return;
    }
    d.p.pos = cancelled ? d.p.pos : d.snap;
    place(d.p, true);
    afterChange();
  }
  svg.addEventListener('pointerup', (e) => endDrag(e, false));
  svg.addEventListener('pointercancel', (e) => endDrag(e, true));
  svg.addEventListener('contextmenu', (e) => {
    const g = e.target.closest('.piece');
    if (!g) return;
    e.preventDefault();
    const p = pieces[+g.dataset.i];
    select(p);
    flip(p);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const p = drag ? drag.p : selected;
    if (e.key === 'r' || e.key === 'R') rotate(p);
    else if (e.key === 'f' || e.key === 'F') flip(p);
  });

  // ---------- 计时 / 存档 ----------
  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const elapsedNow = () => elapsed + (startedAt ? Date.now() - startedAt : 0);
  function startTimer() { if (!startedAt && !won) startedAt = Date.now(); }
  function stopTimer() { elapsed = elapsedNow(); startedAt = null; }
  setInterval(() => { $('timer').textContent = fmt(elapsedNow()); }, 500);

  function save() {
    const data = {
      pieces: pieces.map((p) => ({ o: p.o, pos: p.pos })),
      elapsed: elapsedNow(), won, usedAnswer, bestTime,
    };
    try { localStorage.setItem(STORE + dateStr, JSON.stringify(data)); } catch (_) { /* 隐私模式等 */ }
  }
  // 解法指纹：每块零件实际覆盖的格子（零件各不相同，所以可唯一标识一种摆法）
  function solutionKey() {
    return pieces.map((p) => cellsOf(p).map(([r, c]) => key(r + p.pos.row, c + p.pos.col)).sort().join(' ')).join('|');
  }
  function loadFound() {
    try { found = JSON.parse(localStorage.getItem(STORE + 'found:' + dateStr)) || []; } catch (_) { found = []; }
  }
  function saveFound() {
    try { localStorage.setItem(STORE + 'found:' + dateStr, JSON.stringify(found)); } catch (_) { /* 忽略 */ }
  }
  function load() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORE + dateStr)); } catch (_) { data = null; }
    pieces.forEach((p, i) => {
      const s = data && data.pieces && data.pieces[i];
      p.o = s ? s.o : 0;
      p.pos = s ? s.pos : null;
    });
    elapsed = (data && data.elapsed) || 0;
    won = !!(data && data.won);
    usedAnswer = !!(data && data.usedAnswer);
    bestTime = (data && data.bestTime) || null;
    startedAt = null;
  }

  // ---------- 胜负 ----------
  function revealedCells() {
    const occ = occupiedExcept(null);
    return C.CELLS.filter(([r, c]) => !occ.has(key(r, c)));
  }
  function afterChange() {
    const allPlaced = pieces.every((p) => p.pos);
    if (allPlaced) {
      const open = revealedCells();
      if (open.every(([r, c]) => targetSet.has(key(r, c)))) {
        if (!won) {
          won = true;
          stopTimer();
          const t = elapsedNow();
          if (usedAnswer) {
            shownAnswers.add(solutionKey());
            showModal('答案', `这是 ${goalText()} 的一种解法。点「换一种」看看别的摆法。`);
          } else {
            if (!bestTime || t < bestTime) bestTime = t;
            const k = solutionKey();
            const isNew = !found.includes(k);
            if (isNew) { found.push(k); saveFound(); }
            const tail = isNew
              ? (found.length > 1 ? `这是你今天找到的第 ${found.length} 种解法！` : '坚持就是胜利！')
              : '这种摆法你之前已经找到过了。';
            showModal('完成！', `${goalText()}，用时 ${fmt(t)}。${tail}`, {
              okText: '再找一种', cancelText: '好的', onOk: reset, banner: true,
            });
          }
        }
      } else {
        toast(`露出的是 ${open.map((x) => x[2]).join(' ')}，还不是目标日期`);
      }
    }
    select(won ? null : selected);
    refreshStatus();
    save();
  }
  function refreshStatus() {
    svg.classList.toggle('won', won);
    const open = new Set(revealedCells().map(([r, c]) => key(r, c)));
    boardLayer.querySelectorAll('.cell').forEach((r) => r.classList.toggle('revealed', won && open.has(r.dataset.k)));
    $('done').hidden = !found.length && !bestTime;
    $('done').textContent = (found.length > 1 ? `已发现 ${found.length} 种解法` : '已完成') +
      (bestTime ? ` · 最佳 ${fmt(bestTime)}` : '');
    ['rotate', 'flip', 'hint'].forEach((id) => ($(id).disabled = won));
    // 看过答案后，「答案」按钮变成「换一种」，可以连续翻看不同解法
    const another = won && usedAnswer;
    $('answer').textContent = another ? '换一种' : '答案';
    $('answer').disabled = won && !usedAnswer;
  }

  // ---------- 提示 / 答案 ----------
  function fixedPlacements() {
    const fixed = {};
    pieces.forEach((p) => { if (p.pos) fixed[p.i] = { o: p.o, row: p.pos.row, col: p.pos.col }; });
    return fixed;
  }
  function applyPlacement(i, pl) {
    const p = pieces[i];
    p.o = pl.o;
    p.pos = { row: pl.row, col: pl.col };
    drawPiece(p);
    piecesLayer.appendChild(p.g);
    place(p, true);
  }
  function hint() {
    if (won) return;
    startTimer();
    const fixed = fixedPlacements();
    const sol = C.solve(targets, fixed, { shuffle: true, maxNodes: 2e6 });
    if (!sol) {
      toast('按当前摆法拼不出目标日期，拿下几块再试试');
      return;
    }
    // 提示覆盖「最靠左上的空格」的那一块
    const occ = occupiedExcept(null);
    const first = C.CELLS.map(([r, c]) => [r, c])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .find(([r, c]) => !occ.has(key(r, c)) && !targetSet.has(key(r, c)));
    const idx = Object.keys(sol).map(Number).find((i) => !(i in fixed) &&
      C.orient(C.PIECES[i].cells, sol[i].o).some(([r, c]) => r + sol[i].row === first[0] && c + sol[i].col === first[1]));
    applyPlacement(idx, sol[idx]);
    select(pieces[idx]);
    afterChange();
  }
  // 答案 = 把剩下的提示一次性全部应用：优先保留已摆好的零件，无解时才整盘重排
  function answer() {
    if (won && usedAnswer) return anotherAnswer();
    if (won) return;
    showModal('显示答案？', '会把剩下的零件全部摆好，本局不计入成绩。', {
      okText: '显示答案',
      cancelText: '取消',
      onOk: applyAnswer,
    });
  }
  function applyAnswer() {
    const fixed = fixedPlacements();
    let sol = Object.keys(fixed).length ? C.solve(targets, fixed, { shuffle: true, maxNodes: 2e6 }) : null;
    const kept = !!sol;
    if (!sol) sol = C.solve(targets, {}, { shuffle: true });
    if (!sol) { toast('没有找到解法'); return; }
    usedAnswer = true;
    pieces.forEach((p) => applyPlacement(p.i, sol[p.i]));
    if (!kept && Object.keys(fixed).length) toast('当前摆法无解，已整盘重新摆放');
    afterChange();
  }
  /** 换一种：整盘随机求解，尽量挑一个本次还没展示过的解法 */
  function anotherAnswer() {
    let sol = null, k = '';
    for (let tries = 0; tries < 30; tries++) {
      const s2 = C.solve(targets, {}, { shuffle: true });
      if (!s2) break;
      k = C.PIECES.map((_, i) => C.orient(C.PIECES[i].cells, s2[i].o)
        .map(([r, c]) => key(r + s2[i].row, c + s2[i].col)).sort().join(' ')).join('|');
      sol = s2;
      if (!shownAnswers.has(k)) break;
    }
    if (!sol) { toast('没有找到解法'); return; }
    shownAnswers.add(k);
    $('modal').hidden = true;
    pieces.forEach((p) => applyPlacement(p.i, sol[p.i]));
    toast(`已展示 ${shownAnswers.size} 种不同解法`);
    afterChange();
  }
  function reset() {
    pieces.forEach((p) => { p.pos = null; p.o = 0; drawPiece(p); place(p, true); });
    elapsed = 0; startedAt = null; won = false; usedAnswer = false;
    select(null);
    afterChange();
  }

  // ---------- 提示 UI ----------
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  let modalOk = null;
  /** 页面内弹窗；传 opts.onOk 时作为确认框使用（不依赖 window.confirm，内嵌页面里也能用） */
  function showModal(title, text, opts = {}) {
    $('modal-title').textContent = title;
    $('modal-text').textContent = text;
    $('modal-close').textContent = opts.okText || '好的';
    $('modal-cancel').textContent = opts.cancelText || '取消';
    $('modal-cancel').hidden = !opts.onOk;
    modalOk = opts.onOk || null;
    // 纯提示（如完成）用底部横幅、不遮盖棋盘；确认框仍居中带遮罩
    $('modal').classList.toggle('banner', opts.banner != null ? opts.banner : !opts.onOk);
    $('modal').hidden = false;
  }
  $('modal-close').onclick = () => {
    $('modal').hidden = true;
    const fn = modalOk;
    modalOk = null;
    if (fn) fn();
  };
  $('modal-cancel').onclick = () => { $('modal').hidden = true; modalOk = null; };

  // ---------- 日期 ----------
  const pad2 = (n) => String(n).padStart(2, '0');
  const toStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  function goalText() {
    return targets.map(([r, c]) => C.LABEL[key(r, c)]).join(' ');
  }
  function setDate(str) {
    if (dateStr) { stopTimer(); save(); }
    const [y, m, d] = str.split('-').map(Number);
    dateStr = str;
    $('date').value = str;
    targets = C.targetCells(new Date(y, m - 1, d));
    targetSet = new Set(targets.map(([r, c]) => key(r, c)));
    $('goal').textContent = goalText();
    load();
    loadFound();
    shownAnswers = new Set();
    drawBoard();
    pieces.forEach((p) => { drawPiece(p); place(p, false); });
    select(null);
    refreshStatus();
  }

  $('date').addEventListener('change', (e) => e.target.value && setDate(e.target.value));
  $('today').onclick = () => setDate(toStr(new Date()));
  $('rotate').onclick = () => rotate(selected) || (!selected && toast('先点选一个零件'));
  $('flip').onclick = () => flip(selected) || (!selected && toast('先点选一个零件'));
  $('hint').onclick = hint;
  $('answer').onclick = answer;
  $('reset').onclick = reset;
  window.addEventListener('resize', applyLayout);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopTimer(); save(); }
  });

  // ---------- 启动 ----------
  layout = computeLayout();
  svg.setAttribute('viewBox', `0 0 ${layout.W} ${layout.H}`);
  setDate(toStr(new Date()));
})();
