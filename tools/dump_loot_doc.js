/* 生成《掉落与物品数据库.md》到任务目录（仓库上一级）：容器爆率表 + 每关容器构成 + 全物品清单
 * 用法：node tools/dump_loot_doc.js  */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const win = {};
new Function("window", fs.readFileSync(path.join(ROOT, "data", "loot.js"), "utf8"))(win);
const LOOT = win.DF_LOOT;
const DFR = require(path.join(ROOT, "raid.js"));

const TIER_NAME = { 6: "顶级容器", 5: "高级容器", 1: "低级容器" };
const GRADE_NAME = { 1: "灰", 2: "绿", 3: "蓝", 4: "紫", 5: "金", 6: "红" };
const pct = (x) => (x * 100).toFixed(x * 100 < 1 ? 1 : 0) + "%";
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const L = [];
L.push("# 鼠鼠摸金 · 掉落与物品数据库");
L.push("");
L.push(`> 生成时间 ${new Date().toISOString().slice(0, 10)} · 数据源见 data/loot.js 头部（物品=官方图鉴快照，价格=数据帝交易行快照 ${LOOT.meta.priceDate}，爆率=同人自设非官方）。`);
L.push(`> 重新生成：仓库根目录跑 \`node tools/dump_loot_doc.js\``);
L.push("");
L.push("## 一、容器爆率（每件物品独立按此 roll 品质，再从该品质池等概抽一件）");
L.push("");
L.push("| 容器档位 | 灰 | 绿 | 蓝 | 紫 | 金 | 红 |");
L.push("|---|---|---|---|---|---|---|");
for (const t of [6, 5, 1]) {
  const w = LOOT.dropWeights[t];
  L.push(`| ${TIER_NAME[t]}（tier${t}） | ${pct(w[1])} | ${pct(w[2])} | ${pct(w[3])} | ${pct(w[4])} | ${pct(w[5])} | ${pct(w[6])} |`);
}
L.push("");
L.push("每个容器件数 ≈ 格数÷3（±2 抖动，至少 1 件）。「模拟实测红率」为蒙特卡洛模拟（每容器 800 开）的实际出红占比——大件摆不下会轻微稀释高档占比，实测比标称略低属正常：");
L.push("");
L.push("| 容器 | 档位 | 尺寸 | 期望件数 | 标称红率 | 模拟实测红率 | 每开一次出红期望 |");
L.push("|---|---|---|---|---|---|---|");
for (const c of LOOT.containers) {
  const n = Math.max(1, Math.round(c.w * c.h / 3)); // 件数 ≈ 格数÷3，至少 1 件
  const pr = LOOT.dropWeights[c.tier][6];
  let red = 0, total = 0;
  for (let i = 0; i < 800; i++) {
    for (const d of DFR.rollContainer(Math.random, c, LOOT)) { total++; if (d.item.grade === 6) red++; }
  }
  const sim = total ? red / total : 0;
  L.push(`| ${c.name} | ${TIER_NAME[c.tier]} | ${c.w}×${c.h} | ${n} | ${pct(pr)} | ${(sim * 100).toFixed(1)}% | ${(n * sim * 100).toFixed(1)}% |`);
}
L.push("");
L.push("## 二、关卡容器构成（每关必出的高档容器 + tier1 补齐）");
L.push("");
L.push("| 关卡 | 地图 | 容器数 | 顶级 | 高级 | 巡逻队 | 倒计时 | 撤离引导 |");
L.push("|---|---|---|---|---|---|---|---|");
for (const lv of DFR.LEVELS) {
  const t6 = lv.cfg.tiers.filter((t) => t === 6).length;
  const t5 = lv.cfg.tiers.filter((t) => t === 5).length;
  L.push(`| ${lv.name} | ${lv.cfg.w}×${lv.cfg.h} | ${lv.cfg.total[0]}~${lv.cfg.total[1]} | ${t6} | ${t5} | ${lv.cfg.patrols[0]}~${lv.cfg.patrols[1]} | ${lv.cfg.seconds}s | ${lv.cfg.extractMs / 1000}s |`);
}
L.push("");
L.push("## 三、全物品清单（按品质→价值降序；单格价值=性价比，背包取舍看这个）");
L.push("");
const items = LOOT.items.slice().sort((a, b) => b.grade - a.grade || (b.value || 0) - (a.value || 0));
let cur = 0;
for (const it of items) {
  if (it.grade !== cur) {
    cur = it.grade;
    const pool = items.filter((i) => i.grade === cur);
    L.push(`### ${GRADE_NAME[cur]}（grade ${cur}，共 ${pool.length} 件）`);
    L.push("");
    L.push("| 物品 | 尺寸 | 格数 | 价值 | 单格价值 |");
    L.push("|---|---|---|---|---|");
  }
  L.push(`| ${it.name} | ${it.len}×${it.wid} | ${it.cells} | ${it.value == null ? "不可交易" : fmt(it.value)} | ${it.value == null ? "—" : fmt(it.perCell)} |`);
}
L.push("");
L.push("> 注：不可交易物品（价值为空）不进掉落池、不出现在题池。");

const out = path.join(ROOT, "..", "掉落与物品数据库.md");
fs.writeFileSync(out, L.join("\n") + "\n");
console.log("已生成", out, `（物品 ${items.length} 件）`);
