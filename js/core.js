/*
 * 每日拼图 · 核心逻辑（纯 JS，无 DOM 依赖）
 * 浏览器中挂到 window.PuzzleCore，Node / 小程序中通过 module.exports 引用。
 */
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.PuzzleCore = core;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = 7;
  const ROWS = 8;
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  // 棋盘格子：key = "r,c"
  const CELLS = [];
  const LABEL = {};
  (function buildBoard() {
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 6; c++) CELLS.push([r, c, `${r * 6 + c + 1}月`]);
    for (let d = 1; d <= 31; d++) {
      const i = d - 1;
      CELLS.push([2 + Math.floor(i / 7), i % 7, `${d}日`]);
    }
    // 第 7 行 col 3..6 = 星期日..三，第 8 行 col 4..6 = 星期四..六
    const wd = [[6, 3], [6, 4], [6, 5], [6, 6], [7, 4], [7, 5], [7, 6]];
    wd.forEach(([r, c], i) => CELLS.push([r, c, `星期${WEEKDAYS[i]}`]));
    CELLS.forEach(([r, c, l]) => (LABEL[r + ',' + c] = l));
  })();

  const isBoardCell = (r, c) => LABEL[r + ',' + c] !== undefined;

  // 10 个零件（按实物照片识别）
  const PIECES = [
    { id: 'I4', cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
    { id: 'L4', cells: [[0, 0], [1, 0], [1, 1], [1, 2]] },
    { id: 'S4', cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
    { id: 'Z5', cells: [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]] },
    { id: 'N5', cells: [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3]] },
    { id: 'V5', cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]] },
    { id: 'L5', cells: [[0, 0], [1, 0], [1, 1], [1, 2], [1, 3]] },
    { id: 'T5', cells: [[0, 1], [1, 1], [2, 0], [2, 1], [2, 2]] },
    { id: 'P5', cells: [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1]] },
    { id: 'U5', cells: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]] },
  ];

  /** 归一化：平移到左上角为 (0,0)，按行优先排序 */
  function normalize(cells) {
    const minR = Math.min(...cells.map((p) => p[0]));
    const minC = Math.min(...cells.map((p) => p[1]));
    return cells
      .map(([r, c]) => [r - minR, c - minC])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  const rotateCW = (cells) => normalize(cells.map(([r, c]) => [c, -r]));
  const flipH = (cells) => normalize(cells.map(([r, c]) => [r, -c]));
  const keyOf = (cells) => cells.map((p) => p.join(',')).join(';');

  /**
   * 方向编号 0..7：rot = o % 4（顺时针 90° 次数），flip = o >= 4（先水平翻转）
   */
  function orient(cells, o) {
    let s = normalize(cells);
    if (o >= 4) s = flipH(s);
    for (let i = 0; i < o % 4; i++) s = rotateCW(s);
    return s;
  }
  /** 在当前方向上再顺时针旋转 90° */
  const nextRotation = (o) => (o >= 4 ? 4 : 0) + ((o % 4) + 1) % 4;
  /** 在当前方向上水平翻转：flip∘rot^k = rot^(-k)∘flip */
  const nextFlip = (o) => (o >= 4 ? 0 : 4) + ((4 - (o % 4)) % 4);

  /** 每个零件的去重方向列表 */
  const UNIQUE_ORIENTS = PIECES.map((p) => {
    const seen = new Set();
    const out = [];
    for (let o = 0; o < 8; o++) {
      const s = orient(p.cells, o);
      const k = keyOf(s);
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ o, cells: s });
      }
    }
    return out;
  });

  /** 日期 -> 应露出的 3 个格子 */
  function targetCells(date) {
    const m = date.getMonth(); // 0..11
    const d = date.getDate(); // 1..31
    const w = date.getDay(); // 0=周日
    const find = (label) => CELLS.find((x) => x[2] === label);
    return [find(`${m + 1}月`), find(`${d}日`), find(`星期${WEEKDAYS[w]}`)].map(
      ([r, c]) => [r, c]
    );
  }

  /** 判断零件放在 (row,col) 是否合法；occupied 为 Set<"r,c"> */
  function canPlace(cells, row, col, occupied) {
    for (const [r, c] of cells) {
      const R = r + row, C = c + col;
      if (!isBoardCell(R, C) || occupied.has(R + ',' + C)) return false;
    }
    return true;
  }

  /**
   * 求解。
   * @param {Array<[r,c]>} holes 必须露出的格子
   * @param {Object} fixed  已固定零件 {pieceIndex: {o,row,col}}
   * @param {Object} opts   {shuffle, random, maxNodes}
   * @returns {Object|null|undefined} 解（含 fixed）；null=无解；undefined=超出 maxNodes
   */
  function solve(holes, fixed = {}, opts = {}) {
    const rand = opts.random || Math.random;
    const blocked = new Set(holes.map(([r, c]) => r + ',' + c));
    for (const [i, pl] of Object.entries(fixed)) {
      for (const [r, c] of orient(PIECES[i].cells, pl.o)) {
        const k = r + pl.row + ',' + (c + pl.col);
        if (!isBoardCell(r + pl.row, c + pl.col) || blocked.has(k)) return null;
        blocked.add(k);
      }
    }
    const order = CELLS.map(([r, c]) => [r, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const free = PIECES.map((_, i) => i).filter((i) => !(i in fixed));
    const orients = UNIQUE_ORIENTS.map((list) => {
      const l = list.slice();
      if (opts.shuffle) for (let i = l.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [l[i], l[j]] = [l[j], l[i]];
      }
      return l;
    });
    if (opts.shuffle) for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [free[i], free[j]] = [free[j], free[i]];
    }
    const used = new Set();
    const result = Object.assign({}, fixed);
    const maxNodes = opts.maxNodes || Infinity;
    let nodes = 0;
    const ABORT = {};

    function firstEmpty() {
      for (const [r, c] of order) if (!blocked.has(r + ',' + c)) return [r, c];
      return null;
    }
    function bt() {
      if (++nodes > maxNodes) throw ABORT;
      const e = firstEmpty();
      if (!e) return used.size === free.length;
      for (const i of free) {
        if (used.has(i)) continue;
        for (const { o, cells } of orients[i]) {
          // 让方向中的第一个格子（行优先最小）对齐到首个空格
          const row = e[0] - cells[0][0], col = e[1] - cells[0][1];
          if (!canPlace(cells, row, col, blocked)) continue;
          const ks = cells.map(([r, c]) => r + row + ',' + (c + col));
          ks.forEach((k) => blocked.add(k));
          used.add(i);
          result[i] = { o, row, col };
          if (bt()) return true;
          delete result[i];
          used.delete(i);
          ks.forEach((k) => blocked.delete(k));
        }
      }
      return false;
    }
    try {
      return bt() ? result : null;
    } catch (err) {
      if (err === ABORT) return undefined; // 超出搜索上限，未知是否有解
      throw err;
    }
  }

  return {
    COLS, ROWS, CELLS, LABEL, PIECES, WEEKDAYS,
    isBoardCell, normalize, orient, nextRotation, nextFlip,
    targetCells, canPlace, solve,
  };
});
