// 校验：棋盘/零件格数一致，且所有「月 × 日 × 星期」组合都有解
const core = require('../js/core.js');

const boardCells = core.CELLS.length;
const pieceCells = core.PIECES.reduce((s, p) => s + p.cells.length, 0);
console.log(`棋盘格子 ${boardCells}，零件格子 ${pieceCells}，露出 ${boardCells - pieceCells}`);
if (boardCells - pieceCells !== 3) process.exit(1);

// 方向变换自检：nextRotation / nextFlip 与 orient 的定义一致
const rot = (s) => core.normalize(s.map(([r, c]) => [c, -r]));
const flp = (s) => core.normalize(s.map(([r, c]) => [r, -c]));
const k = (s) => JSON.stringify(s);
for (const p of core.PIECES) for (let o = 0; o < 8; o++) {
  const s = core.orient(p.cells, o);
  if (k(core.orient(p.cells, core.nextRotation(o))) !== k(rot(s))) throw new Error('rotation ' + p.id + o);
  if (k(core.orient(p.cells, core.nextFlip(o))) !== k(flp(s))) throw new Error('flip ' + p.id + o);
}

const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
let total = 0, fail = [];
const t0 = Date.now();
let slowest = 0;
for (let m = 1; m <= 12; m++)
  for (let d = 1; d <= DAYS[m - 1]; d++)
    for (let w = 0; w < 7; w++) {
      const find = (l) => core.CELLS.find((x) => x[2] === l).slice(0, 2);
      const holes = [find(`${m}月`), find(`${d}日`), find(`星期${core.WEEKDAYS[w]}`)];
      const t = Date.now();
      const sol = core.solve(holes);
      slowest = Math.max(slowest, Date.now() - t);
      total++;
      if (!sol) fail.push(`${m}月${d}日星期${core.WEEKDAYS[w]}`);
    }
console.log(`组合 ${total}，无解 ${fail.length}，总耗时 ${Date.now() - t0}ms，最慢 ${slowest}ms`);
if (fail.length) console.log(fail.slice(0, 50).join(' '));
process.exit(fail.length ? 1 : 0);
