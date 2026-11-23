/*
 * 批量枚举全部日期组合的全部解，写到 solver-data/solutions/。
 *   node scripts/enumerate-all.js [并发数]
 *
 * 输出：每个组合一个文件 MM-DD-W.txt（W：0=周日…6=周六），每行一条解（30 个字符），按字典序排序。
 *
 * 断点续跑：每个文件先写成 .tmp 再改名，所以文件存在即代表该组合已完整算完。
 * 中途打断后重新运行，会跳过已完成的组合，并清理上次没写完的 .tmp。
 *
 * 版本保护：目录里的 run-manifest.json 记录棋盘、零件和枚举规则的指纹。
 * 如果模型或算法变了，指纹对不上，脚本会拒绝续跑，避免新旧数据混在一起。
 *
 * 同一输出目录同时只能运行一个实例（启动时会清理所有 .tmp）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const { allCombos, comboKey } = require('./combos.js');

const OUT = path.join(__dirname, '..', 'solver-data', 'solutions');
const fileOf = (combo) => path.join(OUT, comboKey(combo) + '.txt');

// ---------- 工作线程：算一个组合，写一个文件 ----------
if (!isMainThread) {
  const E = require('./enum-core.js');
  parentPort.on('message', (combo) => {
    const t0 = Date.now();
    const lines = [];
    E.enumerate(E.holesOf(combo.m, combo.d, combo.w), (sol) => lines.push(E.encode(sol)));
    lines.sort();
    const f = fileOf(combo);
    fs.writeFileSync(f + '.tmp', lines.join('\n') + '\n');
    fs.renameSync(f + '.tmp', f);
    parentPort.postMessage({ combo, n: lines.length, ms: Date.now() - t0 });
  });
  return;
}

// ---------- 主线程 ----------
/** 枚举规则版本：改了编码格式或枚举口径时手动加 1 */
const ENUM_VERSION = 1;
function fingerprint() {
  const C = require('../js/core.js');
  const model = {
    enumVersion: ENUM_VERSION,
    cells: C.CELLS,
    pieces: C.PIECES.map((p) => Array.from({ length: 8 }, (_, o) => C.orient(p.cells, o))),
  };
  return crypto.createHash('sha256').update(JSON.stringify(model)).digest('hex').slice(0, 16);
}

fs.mkdirSync(OUT, { recursive: true });
const manifestFile = path.join(OUT, 'run-manifest.json');
const fp = fingerprint();
const hasResults = fs.readdirSync(OUT).some((f) => f.endsWith('.txt'));
if (fs.existsSync(manifestFile)) {
  const old = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (old.fingerprint !== fp) {
    console.error(`棋盘/零件/枚举规则已变化（旧 ${old.fingerprint}，新 ${fp}），不能在旧结果上续跑。` +
      `\n请先删除 ${path.relative(process.cwd(), OUT)} 下的 .txt 和 run-manifest.json 再运行。`);
    process.exit(1);
  }
} else if (hasResults) {
  console.error('目录里已有结果但没有 run-manifest.json，无法确认它们来自同一版本。请先清空该目录的 .txt 再运行。');
  process.exit(1);
}
fs.writeFileSync(manifestFile, JSON.stringify({ fingerprint: fp, enumVersion: ENUM_VERSION }, null, 1) + '\n');

for (const f of fs.readdirSync(OUT)) if (f.endsWith('.tmp')) fs.unlinkSync(path.join(OUT, f));
const all = allCombos();
const todo = all.filter((combo) => !fs.existsSync(fileOf(combo)));
const workerCount = Math.max(1, Math.min(+process.argv[2] || os.cpus().length - 1, todo.length));
console.log(`共 ${all.length} 个组合，已完成 ${all.length - todo.length}，待算 ${todo.length}，并发 ${workerCount}`);
if (!todo.length) process.exit(0);

let next = 0, done = 0, total = 0;
const t0 = Date.now();
const workers = [];
for (let i = 0; i < workerCount; i++) {
  const wk = new Worker(__filename);
  workers.push(wk);
  let current = null;
  const feed = () => {
    if (next < todo.length) { current = todo[next++]; wk.postMessage(current); }
    else { current = null; wk.terminate(); }
  };
  wk.on('message', ({ n }) => {
    done++;
    total += n;
    if (done % 50 === 0 || done === todo.length) {
      const s = (Date.now() - t0) / 1000;
      console.log(`${done}/${todo.length}  本次累计解 ${total}  用时 ${s.toFixed(0)}s  ` +
        `预计剩余 ${((s / done) * (todo.length - done)).toFixed(0)}s`);
    }
    feed();
  });
  // 任何一个线程出错就全部停下：已完成的文件保留，重新运行即可从断点继续
  wk.on('error', (e) => {
    console.error(`计算 ${current ? comboKey(current) : '?'} 时出错：`, e);
    workers.forEach((w) => w.terminate());
    process.exitCode = 1;
  });
  feed();
}
