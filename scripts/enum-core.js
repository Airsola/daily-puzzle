/*
 * 全解枚举核心（位运算版）。网页不使用它，它只用于离线统计与验算。
 *
 * 表示方法：棋盘 50 格按行优先编号 0..49（core.BOARD_ORDER），
 * 占用状态用两个 32 位无符号整数表示：lo 存第 0..31 格，hi 存第 32..49 格。
 *
 * 搜索方法：与 core.solve 相同，每一步只填编号最小的空格。
 * 它前面的格子都已被占，所以能盖住它的落点，其最小格子必然就是它。
 * 因此把每块零件的全部落点按「最小格子编号」预先分组，搜索时只需看这一组。
 * 每种最终摆法在每一层都唯一决定下一块放什么，所以每种摆法恰好被找到一次。
 *
 * 输入前提：恰好 3 个互不相同、位于棋盘上的露出格（50 - 3 = 47 = 零件格数之和）。
 */
'use strict';
const C = require('../js/core.js');

const ORDER = C.BOARD_ORDER;
const INDEX = new Map(ORDER.map(([r, c], i) => [r + ',' + c, i]));
const CELL_COUNT = ORDER.length; // 50
const PIECE_COUNT = C.PIECES.length; // 10

const FULL_LO = 0xffffffff >>> 0;
const FULL_HI = ((1 << (CELL_COUNT - 32)) - 1) >>> 0;

/** 格子编号 -> [lo 位, hi 位] */
const bitOf = (i) => (i < 32 ? [(1 << i) >>> 0, 0] : [0, (1 << (i - 32)) >>> 0]);
const isSet = (lo, hi, i) => (i < 32 ? (lo >>> i) & 1 : (hi >>> (i - 32)) & 1);

/** 每块零件的去重方向（保留 core 的方向编号 o，便于与网页互通） */
const ORIENTS = C.PIECES.map((p) => C.uniqueOrientations(p.cells));

/**
 * PLACEMENTS[piece][minCell] = [{ lo, hi, o, row, col }]
 * 一个落点 = 某个方向的形状，外接矩形左上角放在棋盘 (row, col)，与网页零件的 pos 一致。
 */
const PLACEMENTS = ORIENTS.map((list) => {
  const byMinCell = Array.from({ length: CELL_COUNT }, () => []);
  for (const { o, cells } of list) {
    for (let row = 0; row < C.ROWS; row++) {
      for (let col = 0; col < C.COLS; col++) {
        let lo = 0, hi = 0, min = Infinity, onBoard = true;
        for (const [r, c] of cells) {
          const idx = INDEX.get(r + row + ',' + (c + col));
          if (idx === undefined) { onBoard = false; break; }
          const [a, b] = bitOf(idx);
          lo = (lo | a) >>> 0;
          hi = (hi | b) >>> 0;
          if (idx < min) min = idx;
        }
        if (onBoard) byMinCell[min].push({ lo, hi, o, row, col });
      }
    }
  }
  return byMinCell;
});

/**
 * 编号最小的空格。(~x) & (x + 1) 只留下 x 最低的那个 0 位。
 * 调用前提：棋盘未满（满了就没有空格可找）。
 */
function firstFreeCell(lo, hi) {
  if (lo !== FULL_LO) return 31 - Math.clz32((~lo) & (lo + 1));
  return 32 + 31 - Math.clz32((~hi) & (hi + 1));
}

/** 每格的上下左右邻居（只含棋盘内的格子） */
const NEIGHBORS = ORDER.map(([r, c]) =>
  [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .map(([a, b]) => INDEX.get(a + ',' + b))
    .filter((x) => x !== undefined));

/**
 * 剪枝：扫描所有空格，只要有一个空格四邻都被占，就必然无解。
 * 安全前提：所有零件都是四邻连通的，且没有单格零件，所以孤立的单个空格永远填不上。
 */
function hasIsolatedCell(lo, hi) {
  for (let i = 0; i < CELL_COUNT; i++) {
    if (isSet(lo, hi, i)) continue;
    let hasFreeNeighbor = false;
    for (const j of NEIGHBORS[i]) if (!isSet(lo, hi, j)) { hasFreeNeighbor = true; break; }
    if (!hasFreeNeighbor) return true;
  }
  return false;
}

/** 校验并把露出格转成初始占用状态；不符合输入前提时直接报错，而不是悄悄算错 */
function initialState(holes) {
  if (holes.length !== 3) throw new Error(`需要恰好 3 个露出格，收到 ${holes.length} 个`);
  let lo = 0, hi = 0;
  const seen = new Set();
  for (const [r, c] of holes) {
    const idx = INDEX.get(r + ',' + c);
    if (idx === undefined) throw new Error(`露出格 [${r},${c}] 不在棋盘上`);
    if (seen.has(idx)) throw new Error(`露出格 [${r},${c}] 重复`);
    seen.add(idx);
    const [a, b] = bitOf(idx);
    lo |= a;
    hi |= b;
  }
  return [lo >>> 0, hi >>> 0];
}

/**
 * 枚举一组露出格下的全部解。
 * @param {Array<[r,c]>} holes 恰好 3 个露出格
 * @param {(chosen: Array<{o,row,col}>) => void} [onSolution] 每找到一个解调用一次，按零件顺序给出放法
 * @returns {number} 解的个数
 */
function enumerate(holes, onSolution) {
  const [startLo, startHi] = initialState(holes);
  const used = new Array(PIECE_COUNT).fill(false);
  const chosenPlacements = new Array(PIECE_COUNT);
  let count = 0;

  function search(lo, hi) {
    if (lo === FULL_LO && hi === FULL_HI) { // 棋盘铺满即为一个解
      count++;
      if (onSolution) onSolution(chosenPlacements.slice());
      return;
    }
    const cell = firstFreeCell(lo, hi);
    for (let piece = 0; piece < PIECE_COUNT; piece++) {
      if (used[piece]) continue;
      for (const pl of PLACEMENTS[piece][cell]) {
        if ((lo & pl.lo) || (hi & pl.hi)) continue; // 与已占格重叠
        const nextLo = (lo | pl.lo) >>> 0;
        const nextHi = (hi | pl.hi) >>> 0;
        if (hasIsolatedCell(nextLo, nextHi)) continue;
        used[piece] = true;
        chosenPlacements[piece] = pl;
        search(nextLo, nextHi);
        used[piece] = false; // 回溯
      }
    }
  }
  search(startLo, startHi);
  return count;
}

/** 一条解法编码：10 块零件依次 3 位数字「方向 o、行 row、列 col」，共 30 个字符 */
const encode = (chosen) => chosen.map((p) => '' + p.o + p.row + p.col).join('');

/** 月(1..12)、日(1..31)、星期(0=周日..6) -> 3 个露出格 */
const holesOf = (m, d, w) => C.holesFor(m, d, w);

module.exports = { enumerate, encode, holesOf, ORIENTS, ORDER };
