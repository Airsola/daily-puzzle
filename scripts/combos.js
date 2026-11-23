/*
 * 脚本共用：全部真实日期组合与文件命名。
 * 366 个月日（含 2 月 29 日）× 7 个星期 = 2562 个组合。
 */
'use strict';

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 全部组合 [{ m, d, w }]，m=1..12，d=1..31，w=0(周日)..6 */
function allCombos() {
  const out = [];
  for (let m = 1; m <= 12; m++)
    for (let d = 1; d <= DAYS_IN_MONTH[m - 1]; d++)
      for (let w = 0; w < 7; w++) out.push({ m, d, w });
  return out;
}

/** 组合键 / 文件名主体："MM-DD-W"，例如 11 月 22 日星期日 -> "11-22-0" */
const comboKey = ({ m, d, w }) => `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}-${w}`;

module.exports = { DAYS_IN_MONTH, allCombos, comboKey };
