/*
 * 校验 solver-data/solutions/ 下的全部解，并生成：
 *   solver-data/puzzle-spec.json   棋盘 / 零件 / 方向 / 编码规则（跨平台复用的唯一依据）
 *   solver-data/solutions/index.json  每个组合的解个数 + 汇总统计
 *   node scripts/build-data.js
 * 校验内容：每条解都铺满 47 格、不越界不重叠、恰好露出目标三格；同一组合内无重复。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../js/core.js');
const E = require('./enum-core.js');

const DATA = path.join(__dirname, '..', 'solver-data');
const OUT = path.join(DATA, 'solutions');

// ---------- puzzle-spec.json ----------
const spec = {
  version: 1,
  board: {
    rows: C.ROWS,
    cols: C.COLS,
    note: '坐标 [row, col]，左上角为 [0,0]。只有 cells 中列出的位置是格子，共 50 格。',
    cells: C.CELLS.map(([r, c, label]) => ({ row: r, col: c, label })),
  },
  pieces: C.PIECES.map((p, i) => ({
    index: i,
    id: p.id,
    size: p.cells.length,
    // 8 个方向编号各自对应的形状（已归一化：最小行、最小列均为 0）。有的方向形状相同。
    orientations: Array.from({ length: 8 }, (_, o) => C.orient(p.cells, o)),
  })),
  orientation: 'o = 0..7。rot = o % 4 为顺时针旋转 90° 的次数；o >= 4 表示先水平翻转（列取反）再旋转。每一步后都平移归一化。',
  solutionEncoding: {
    format: '每条解 30 个字符：按 pieces 的 index 顺序，每块 3 位数字「o row col」。',
    meaning: '零件 i 采用 orientations[o] 的形状，形状中的格子 [r,c] 落在棋盘 [r+row, c+col]。',
    example: '每块 3 位 = "o"+"row"+"col"，例如 "512" 表示方向 5、左上角在第 1 行第 2 列。',
  },
  files: {
    pattern: 'solutions/MM-DD-W.txt',
    note: 'MM=月(01..12)，DD=日(01..31)，W=星期(0=周日 … 6=周六)。每行一条解，按字典序排序。',
    combos: '366 个月日（含 2 月 29 日）× 7 个星期 = 2562 个文件',
  },
  weekdays: C.WEEKDAYS.map((w) => '星期' + w),
};
fs.writeFileSync(path.join(DATA, 'puzzle-spec.json'), JSON.stringify(spec, null, 2) + '\n');

// ---------- 校验 + index.json ----------
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const counts = {};
let total = 0, missing = 0, bad = 0, dup = 0;
const pad = (n) => String(n).padStart(2, '0');
for (let m = 1; m <= 12; m++) for (let d = 1; d <= DAYS[m - 1]; d++) for (let w = 0; w < 7; w++) {
  const name = `${pad(m)}-${pad(d)}-${w}`;
  const f = path.join(OUT, name + '.txt');
  if (!fs.existsSync(f)) { missing++; continue; }
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  const holes = new Set(E.holesOf(m, d, w).map(([r, c]) => r + ',' + c));
  if (new Set(lines).size !== lines.length) dup++;
  for (const line of lines) {
    if (line.length !== 30) { bad++; continue; }
    const occ = new Set(holes);
    let ok = true;
    for (let i = 0; i < 10 && ok; i++) {
      const o = +line[i * 3], row = +line[i * 3 + 1], col = +line[i * 3 + 2];
      for (const [r, c] of spec.pieces[i].orientations[o]) {
        const k = r + row + ',' + (c + col);
        if (!C.isBoardCell(r + row, c + col) || occ.has(k)) { ok = false; break; }
        occ.add(k);
      }
    }
    if (!ok || occ.size !== 50) bad++;
  }
  counts[name] = lines.length;
  total += lines.length;
}
const vals = Object.entries(counts).sort((a, b) => a[1] - b[1]);
const stats = vals.length ? {
  combos: vals.length,
  totalSolutions: total,
  min: { combo: vals[0][0], count: vals[0][1] },
  max: { combo: vals[vals.length - 1][0], count: vals[vals.length - 1][1] },
  average: +(total / vals.length).toFixed(1),
  median: vals[Math.floor(vals.length / 2)][1],
  zeroSolutionCombos: vals.filter((x) => x[1] === 0).map((x) => x[0]),
  uniqueSolutionCombos: vals.filter((x) => x[1] === 1).map((x) => x[0]),
  fewest10: vals.slice(0, 10).map(([k, v]) => `${k}:${v}`),
} : {};
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ stats, counts }, null, 1) + '\n');
console.log(JSON.stringify({ missing, badLines: bad, filesWithDuplicates: dup, ...stats }, null, 1));
if (missing || bad || dup) process.exitCode = 1;
