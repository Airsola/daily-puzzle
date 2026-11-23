/*
 * 校验网页用的求解器 core.solve（与离线枚举器是两套独立实现）：
 *   node scripts/verify.js
 * 1. 棋盘格数 - 零件格数 = 3
 * 2. 方向变换自检：nextRotation / nextFlip 与 orient 的定义一致
 * 3. 全部 2562 个日期组合都能解出，且返回的解合法（不越界、不重叠、恰好露出目标三格）
 * 4. 固定零件、搜索上限两种用法的行为符合约定
 */
'use strict';
const core = require('../js/core.js');
const { allCombos, comboKey } = require('./combos.js');

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

// 1. 格数
const boardCells = core.CELLS.length;
const pieceCells = core.PIECES.reduce((s, p) => s + p.cells.length, 0);
console.log(`棋盘格子 ${boardCells}，零件格子 ${pieceCells}，露出 ${boardCells - pieceCells}`);
if (boardCells - pieceCells !== 3) fail('露出格数不是 3');

// 2. 方向变换
const rot = (s) => core.normalize(s.map(([r, c]) => [c, -r]));
const flp = (s) => core.normalize(s.map(([r, c]) => [r, -c]));
const k = (s) => JSON.stringify(s);
for (const p of core.PIECES) for (let o = 0; o < 8; o++) {
  const s = core.orient(p.cells, o);
  if (k(core.orient(p.cells, core.nextRotation(o))) !== k(rot(s))) fail(`旋转不一致 ${p.id} o=${o}`);
  if (k(core.orient(p.cells, core.nextFlip(o))) !== k(flp(s))) fail(`翻转不一致 ${p.id} o=${o}`);
}

/** 解是否合法：每块都放了、不越界不重叠、露出的恰好是 holes */
function isValid(sol, holes) {
  const occ = new Set(holes.map(([r, c]) => r + ',' + c));
  for (let i = 0; i < core.PIECES.length; i++) {
    const pl = sol[i];
    if (!pl) return false;
    for (const [r, c] of core.orient(core.PIECES[i].cells, pl.o)) {
      const R = r + pl.row, C = c + pl.col, key = R + ',' + C;
      if (!core.isBoardCell(R, C) || occ.has(key)) return false;
      occ.add(key);
    }
  }
  return occ.size === boardCells;
}

// 3. 全部组合
const failed = [];
let slowest = 0;
const t0 = Date.now();
for (const combo of allCombos()) {
  const holes = core.holesFor(combo.m, combo.d, combo.w);
  const t = Date.now();
  const sol = core.solve(holes);
  slowest = Math.max(slowest, Date.now() - t);
  if (!sol || !isValid(sol, holes)) failed.push(comboKey(combo));
}
console.log(`组合 ${allCombos().length}，失败 ${failed.length}，总耗时 ${Date.now() - t0}ms，最慢 ${slowest}ms`);
if (failed.length) fail('以下组合无解或解不合法：' + failed.slice(0, 50).join(' '));

// 4. 固定零件 / 搜索上限
const holes = core.holesFor(11, 22, 0);
const base = core.solve(holes);
const fixed = { 0: base[0], 3: base[3] };
const withFixed = core.solve(holes, fixed, { shuffle: true });
if (!withFixed || !isValid(withFixed, holes) || k(withFixed[0]) !== k(base[0]) || k(withFixed[3]) !== k(base[3]))
  fail('固定零件后的解不合法，或没有保留固定零件');
if (core.solve(holes, {}, { maxNodes: 1 }) !== undefined) fail('maxNodes 用尽时应返回 undefined');
if (core.solve(holes, {}, { maxNodes: 0 }) !== undefined) fail('maxNodes: 0 应表示不允许搜索');
// 固定一块占住目标格，必然无解
const blocking = { 0: { o: 0, row: 0, col: 0 } }; // I4 横放盖住 1~4 月
const holesJan = core.holesFor(1, 1, 0);
if (core.solve(holesJan, blocking) !== null) fail('固定零件盖住目标格时应返回 null');
console.log('固定零件、搜索上限：通过');
console.log('✓ 全部校验通过');
