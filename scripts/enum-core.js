/*
 * 全解枚举核心（位运算版）。
 * 棋盘 50 格按行优先编号 0..49，用两个 32 位整数（lo: 0..31，hi: 32..49）表示占用。
 * 每块零件预先算好全部落点，并按「落点最小格子编号」分组，
 * 回溯时总是填当前编号最小的空格，所以每种摆法只会被找到一次。
 */
'use strict';
const C = require('../js/core.js');

// 格子编号：行优先（与 core.solve 的填充顺序一致）
const ORDER = C.CELLS.map(([r, c]) => [r, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const INDEX = new Map(ORDER.map(([r, c], i) => [r + ',' + c, i]));
const N = ORDER.length; // 50

const bit = (i) => (i < 32 ? [(1 << i) >>> 0, 0] : [0, (1 << (i - 32)) >>> 0]);

/** 每块零件的去重方向（保留 core 的方向编号 o，便于与网页互通） */
const ORIENTS = C.PIECES.map((p) => {
  const seen = new Set(), out = [];
  for (let o = 0; o < 8; o++) {
    const cells = C.orient(p.cells, o), k = JSON.stringify(cells);
    if (!seen.has(k)) { seen.add(k); out.push({ o, cells }); }
  }
  return out;
});

/**
 * PLACEMENTS[piece][minCell] = [{lo, hi, o, row, col}]
 * row/col 是方向归一化后左上角在棋盘上的位置（与网页 pos 一致，均 >= 0）
 */
const PLACEMENTS = ORIENTS.map((list) => {
  const byCell = Array.from({ length: N }, () => []);
  for (const { o, cells } of list) {
    for (let row = 0; row < C.ROWS; row++) for (let col = 0; col < C.COLS; col++) {
      let lo = 0, hi = 0, min = Infinity, ok = true;
      for (const [r, c] of cells) {
        const idx = INDEX.get(r + row + ',' + (c + col));
        if (idx === undefined) { ok = false; break; }
        const [a, b] = bit(idx);
        lo = (lo | a) >>> 0; hi = (hi | b) >>> 0;
        if (idx < min) min = idx;
      }
      if (ok) byCell[min].push({ lo, hi, o, row, col });
    }
  }
  return byCell;
});

const FULL_LO = 0xffffffff >>> 0;
const FULL_HI = ((1 << (N - 32)) - 1) >>> 0;

/** 最低位 0 的编号 */
function firstEmpty(lo, hi) {
  if (lo !== FULL_LO) { const x = (~lo) & (lo + 1); return 31 - Math.clz32(x); }
  const x = (~hi) & (hi + 1); return 32 + 31 - Math.clz32(x);
}

/** 邻接表，用于剪枝：孤立空格（四周都被占）必然无解 */
const NEIGHBORS = ORDER.map(([r, c]) =>
  [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].map(([a, b]) => INDEX.get(a + ',' + b)).filter((x) => x !== undefined));
const isSet = (lo, hi, i) => (i < 32 ? (lo >>> i) & 1 : (hi >>> (i - 32)) & 1);

/**
 * 枚举一组「露出格」下的全部解。
 * @param {Array<[r,c]>} holes
 * @param {(sol: Array<{o,row,col}>) => void} onSolution  按零件顺序给出每块的放法
 * @returns {number} 解的个数
 */
function enumerate(holes, onSolution) {
  let lo = 0, hi = 0;
  for (const [r, c] of holes) { const [a, b] = bit(INDEX.get(r + ',' + c)); lo |= a; hi |= b; }
  lo >>>= 0; hi >>>= 0;
  const P = PLACEMENTS.length;
  const used = new Array(P).fill(false);
  const pick = new Array(P);
  let count = 0;

  function deadCell(lo, hi) {
    // 只检查刚好可能被孤立的格：所有空格中，若有四邻全占的，剪掉
    for (let i = 0; i < N; i++) {
      if (isSet(lo, hi, i)) continue;
      let open = false;
      for (const j of NEIGHBORS[i]) if (!isSet(lo, hi, j)) { open = true; break; }
      if (!open) return true;
    }
    return false;
  }

  (function bt(lo, hi, depth) {
    if (depth === P) {
      count++;
      if (onSolution) onSolution(pick.slice());
      return;
    }
    const e = firstEmpty(lo, hi);
    for (let i = 0; i < P; i++) {
      if (used[i]) continue;
      const list = PLACEMENTS[i][e];
      for (let k = 0; k < list.length; k++) {
        const pl = list[k];
        if ((lo & pl.lo) || (hi & pl.hi)) continue;
        const nlo = (lo | pl.lo) >>> 0, nhi = (hi | pl.hi) >>> 0;
        if (depth < P - 1 && deadCell(nlo, nhi)) continue;
        used[i] = true; pick[i] = pl;
        bt(nlo, nhi, depth + 1);
        used[i] = false;
      }
    }
  })(lo, hi, 0);
  return count;
}

/** 一条解法编码：10 块零件依次 3 位数字「方向 行 列」，共 30 个字符 */
const encode = (sol) => sol.map((p) => '' + p.o + p.row + p.col).join('');

/** 日期组合键：月(1..12)-日(1..31)-星期(0..6，0=日) */
function holesOf(m, d, w) {
  const f = (l) => { const x = C.CELLS.find((x) => x[2] === l); return [x[0], x[1]]; };
  return [f(`${m}月`), f(`${d}日`), f(`星期${C.WEEKDAYS[w]}`)];
}

module.exports = { enumerate, encode, holesOf, ORIENTS, ORDER };
