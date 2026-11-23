/*
 * 校验 solver-data/solutions/ 下的全部解；全部通过后才生成：
 *   solver-data/puzzle-spec.json        棋盘 / 零件 / 方向 / 编码规则（跨平台复用的唯一依据）
 *   solver-data/solutions/index.json    每个组合的解个数 + 汇总统计
 *   node scripts/build-data.js
 *
 * 校验内容：每个组合都有文件；每行格式合法；每条解不越界、不重叠、铺满 47 格且恰好露出目标三格；
 * 同一组合内没有重复的解。
 *
 * 校验边界：这里只能证明「文件里的每条解都合法」，不能证明「没有漏掉任何解」。
 * 完整性靠枚举算法本身（见 enum-core.js 的说明），并已与另一套独立实现抽样对拍过。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../js/core.js');
const E = require('./enum-core.js');
const { allCombos, comboKey } = require('./combos.js');

const DATA = path.join(__dirname, '..', 'solver-data');
const OUT = path.join(DATA, 'solutions');

// ---------- 规则说明（先在内存里生成，校验也用它，保证两者一致） ----------
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
    // 8 个方向编号各自对应的形状。已归一化：外接矩形左上角为 [0,0]（形状不一定占这一格）。有的方向形状相同。
    orientations: Array.from({ length: 8 }, (_, o) => C.orient(p.cells, o)),
  })),
  orientation: 'o = 0..7。rot = o % 4 为顺时针旋转 90° 的次数；o >= 4 表示先水平翻转（列取反）再旋转。每一步后都平移归一化。',
  solutionEncoding: {
    format: '每条解 30 个字符：按 pieces 的 index 顺序，每块 3 位数字「o row col」，o=0..7，row=0..7，col=0..6。',
    meaning: '零件 i 采用 orientations[o] 的形状，形状中的格子 [r,c] 落在棋盘 [r+row, c+col]。',
    example: '"512" 表示方向 5、外接矩形左上角在第 1 行第 2 列。',
  },
  files: {
    pattern: 'solutions/MM-DD-W.txt',
    note: 'MM=月(01..12)，DD=日(01..31)，W=星期(0=周日 … 6=周六)。每行一条解，按字典序排序。',
    combos: '366 个月日（含 2 月 29 日）× 7 个星期 = 2562 个文件',
  },
  weekdays: C.WEEKDAYS.map((w) => '星期' + w),
};

// ---------- 校验 ----------
const LINE_FORMAT = /^(?:[0-7][0-7][0-6]){10}$/; // 每块：方向 0..7、行 0..7、列 0..6

/** 一条解是否合法：不越界、不重叠，且与露出格一起恰好铺满 50 格 */
function isValidSolution(line, holes) {
  if (!LINE_FORMAT.test(line)) return false;
  const occupied = new Set(holes);
  for (let i = 0; i < spec.pieces.length; i++) {
    const o = +line[i * 3], row = +line[i * 3 + 1], col = +line[i * 3 + 2];
    for (const [r, c] of spec.pieces[i].orientations[o]) {
      const R = r + row, C2 = c + col, k = R + ',' + C2;
      if (!C.isBoardCell(R, C2) || occupied.has(k)) return false;
      occupied.add(k);
    }
  }
  return occupied.size === spec.board.cells.length;
}

const counts = {};
const problems = [];
let total = 0;
for (const combo of allCombos()) {
  const name = comboKey(combo);
  const f = path.join(OUT, name + '.txt');
  if (!fs.existsSync(f)) { problems.push(`${name}: 缺少文件`); continue; }
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  const holes = E.holesOf(combo.m, combo.d, combo.w).map(([r, c]) => r + ',' + c);
  if (new Set(lines).size !== lines.length) problems.push(`${name}: 有重复的解`);
  const badLine = lines.findIndex((line) => !isValidSolution(line, holes));
  if (badLine >= 0) problems.push(`${name}: 第 ${badLine + 1} 行不合法：${lines[badLine]}`);
  counts[name] = lines.length;
  total += lines.length;
}

if (problems.length) {
  console.error(`校验失败，共 ${problems.length} 个问题，未写出任何文件：`);
  console.error(problems.slice(0, 20).join('\n'));
  process.exit(1);
}

// ---------- 全部通过后再写文件 ----------
const sorted = Object.entries(counts).sort((a, b) => a[1] - b[1]);
const stats = {
  combos: sorted.length,
  totalSolutions: total,
  min: { combo: sorted[0][0], count: sorted[0][1] },
  max: { combo: sorted[sorted.length - 1][0], count: sorted[sorted.length - 1][1] },
  average: +(total / sorted.length).toFixed(1),
  median: sorted[Math.floor(sorted.length / 2)][1],
  zeroSolutionCombos: sorted.filter((x) => x[1] === 0).map((x) => x[0]),
  uniqueSolutionCombos: sorted.filter((x) => x[1] === 1).map((x) => x[0]),
  fewest10: sorted.slice(0, 10).map(([k, v]) => `${k}:${v}`),
};
fs.writeFileSync(path.join(DATA, 'puzzle-spec.json'), JSON.stringify(spec, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ stats, counts }, null, 1) + '\n');
console.log('校验通过，已写出 puzzle-spec.json 和 index.json');
console.log(JSON.stringify(stats, null, 1));
