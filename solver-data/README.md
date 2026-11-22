# 每日拼图 · 全部解法数据

由 `scripts/enumerate-all.js` 穷举生成，再由 `scripts/build-data.js` 逐条校验。

- `puzzle-spec.json`：棋盘格子、10 块零件、每块 8 个方向的具体形状，以及解法编码规则。其他平台（小程序、App 等）只要读这个文件，不需要移植 JS 代码。
- `solutions/MM-DD-W.txt`：某个日期组合下的全部解，每行一条。W 表示星期，0 是周日，6 是周六。共 2562 个文件。
- `solutions/index.json`：每个组合的解的个数，以及汇总统计。
- `solutions.tar.xz`：上面 2562 个文本文件的压缩包（25MB，解开约 144MB，共 4,864,096 条解）。仓库里只存这个压缩包，是一次全量验算的存档。**游戏运行时不会用到它**，提示、答案都在用户端实时计算。

解压：`tar xJf solver-data/solutions.tar.xz -C solver-data`；校验：`shasum -a 256 -c solver-data/solutions.tar.xz.sha256`（需先 `cd solver-data`）。

## 解法编码

每行 30 个字符。按零件顺序 0..9 排列，每块零件占 3 位数字，依次是「方向 o、行 row、列 col」。

零件 i 取 `pieces[i].orientations[o]` 的形状，形状里的格子 `[r, c]` 落在棋盘的 `[r + row, c + col]`。这和网页里零件的 `{o, pos: {row, col}}` 完全一致。

## 重新生成

```bash
node scripts/enumerate-all.js     # 多线程，可中断，重跑时跳过已完成的组合
node scripts/build-data.js        # 校验并生成 puzzle-spec.json 和 index.json
```
