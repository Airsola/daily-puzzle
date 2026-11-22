// 统计每个日期组合的解的个数（穷举全部解）
const C = require('../js/core.js');
const KEY = (r, c) => r + ',' + c;
function countAll(holes) {
  const blocked = new Set(holes.map(([r, c]) => KEY(r, c)));
  const order = C.CELLS.map(([r, c]) => [r, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const ors = C.PIECES.map((p) => {
    const seen = new Set(), out = [];
    for (let o = 0; o < 8; o++) { const s = C.orient(p.cells, o), k = JSON.stringify(s); if (!seen.has(k)) { seen.add(k); out.push(s); } }
    return out;
  });
  const used = new Array(C.PIECES.length).fill(false);
  let n = 0;
  (function bt() {
    let e = null;
    for (const [r, c] of order) if (!blocked.has(KEY(r, c))) { e = [r, c]; break; }
    if (!e) { n++; return; }
    for (let i = 0; i < ors.length; i++) {
      if (used[i]) continue;
      for (const cells of ors[i]) {
        const row = e[0] - cells[0][0], col = e[1] - cells[0][1];
        if (!C.canPlace(cells, row, col, blocked)) continue;
        const ks = cells.map(([r, c]) => KEY(r + row, c + col));
        ks.forEach((k) => blocked.add(k)); used[i] = true;
        bt();
        used[i] = false; ks.forEach((k) => blocked.delete(k));
      }
    }
  })();
  return n;
}
module.exports = countAll;
if (require.main === module) {
  const arg = process.argv[2];
  if (arg !== 'all') {
    const d = arg ? new Date(arg) : new Date();
    console.log(d.toDateString(), countAll(C.targetCells(d)));
  } else {
    const W = C.WEEKDAYS, res = [];
    const t0 = Date.now();
    for (let m = 1; m <= 12; m++) for (let d = 1; d <= 31; d++) for (const w of W) {
      const f = (l) => { const x = C.CELLS.find((x) => x[2] === l); return [x[0], x[1]]; };
      res.push({ k: `${m}月${d}日 星期${w}`, n: countAll([f(`${m}月`), f(`${d}日`), f(`星期${w}`)]) });
    }
    res.sort((a, b) => a.n - b.n);
    const tot = res.reduce((s, x) => s + x.n, 0);
    console.log('组合数', res.length, '最少', res[0], '最多', res[res.length - 1], '平均', (tot / res.length).toFixed(1), '唯一解个数', res.filter((x) => x.n === 1).length, '耗时s', ((Date.now() - t0) / 1000).toFixed(0));
    console.log('最少的10个', res.slice(0, 10).map((x) => x.k + ':' + x.n).join(' | '));
  }
}
