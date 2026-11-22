/*
 * 批量枚举全部日期组合的全部解，写到 solver-data/solutions/。
 *   node scripts/enumerate-all.js [并发数]
 * 每个组合一个文件 MM-DD-W.txt（W：0=周日…6=周六），每行一条解（30 个字符）。
 * 先写 .tmp 再改名，所以文件存在即代表该组合已完整算完；中途打断后重新运行会跳过已完成的组合。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const OUT = path.join(__dirname, '..', 'solver-data', 'solutions');
const fileOf = (m, d, w) => path.join(OUT, `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}-${w}.txt`);

if (!isMainThread) {
  const E = require('./enum-core.js');
  parentPort.on('message', ({ m, d, w }) => {
    const t0 = Date.now();
    const lines = [];
    E.enumerate(E.holesOf(m, d, w), (sol) => lines.push(E.encode(sol)));
    lines.sort();
    const f = fileOf(m, d, w);
    fs.writeFileSync(f + '.tmp', lines.join('\n') + '\n');
    fs.renameSync(f + '.tmp', f);
    parentPort.postMessage({ m, d, w, n: lines.length, ms: Date.now() - t0 });
  });
  return;
}

fs.mkdirSync(OUT, { recursive: true });
// 全部真实存在的「月-日」（含 2 月 29 日）× 7 个星期 = 366 × 7 = 2562
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const all = [];
for (let m = 1; m <= 12; m++) for (let d = 1; d <= DAYS[m - 1]; d++) for (let w = 0; w < 7; w++) all.push({ m, d, w });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.tmp')) fs.unlinkSync(path.join(OUT, f)); // 清理上次中断留下的半成品
const todo = all.filter(({ m, d, w }) => !fs.existsSync(fileOf(m, d, w)));
const workers = Math.max(1, Math.min(+process.argv[2] || os.cpus().length - 1, todo.length));
console.log(`共 ${all.length} 个组合，已完成 ${all.length - todo.length}，待算 ${todo.length}，并发 ${workers}`);
if (!todo.length) process.exit(0);

let next = 0, done = 0, total = 0;
const t0 = Date.now();
for (let i = 0; i < workers; i++) {
  const wk = new Worker(__filename);
  const feed = () => (next < todo.length ? wk.postMessage(todo[next++]) : wk.terminate());
  wk.on('message', ({ n }) => {
    done++; total += n;
    if (done % 50 === 0 || done === todo.length) {
      const s = (Date.now() - t0) / 1000;
      console.log(`${done}/${todo.length}  本次累计解 ${total}  用时 ${s.toFixed(0)}s  预计剩余 ${((s / done) * (todo.length - done)).toFixed(0)}s`);
    }
    feed();
  });
  wk.on('error', (e) => { console.error(e); process.exitCode = 1; });
  feed();
}
