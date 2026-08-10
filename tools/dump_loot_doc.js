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
L.push(`> 生成时间 ${new Date().toISOString().slice(0, 10)} · 数据源见 data/loot.js 头部（物品=官方图鉴快照，价格=${LOOT.meta.priceSource} ${LOOT.meta.priceDate}，${LOOT.meta.dropRateSource || "爆率=同人自设非官方"}）。`);
L.push(`> 重新生成：仓库根目录跑 \`node tools/dump_loot_doc.js\``);
L.push("");
L.push("## 一、容器掉落（逐物品加权：基准=小涛查开容器模拟器服务端接口实测 24 容器×2000 开，游戏内按品质上浮 灰/绿×1 蓝×1.05 紫×1.15 金×1.4 红×1.8）");
L.push("");
// 基准红率/金率（采样原始计数，含图鉴外物品）
let rawRates = {};
try {
  rawRates = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "data", "container_rates_api_raw.json"), "utf8"));
} catch (e) { /* 无采样文件时基准列留空 */ }
L.push("大武器箱/弹药箱的真实主产是枪械弹药（收集品图鉴不含），与模拟器未收录的 4 个容器（三角蚌/金币堆/放射性储物箱/工业金属储物箱）一起回退 tier 品质权重（同人自设）：tier6 红 9% / tier5 红 3% / tier1 红 0.8%。");
L.push("");
L.push("「上浮后红率」为蒙特卡洛模拟（每容器 800 开）的实际出红占比——大件摆不下会轻微稀释，实测略低属正常：");
L.push("");
L.push("| 容器 | 档位 | 尺寸 | 平均每开件数(实测) | 基准红率(实测) | 上浮后红率(蒙特卡洛) | 每开一次出红期望 |");
L.push("|---|---|---|---|---|---|---|");
for (const c of LOOT.containers) {
  const avg = c.avgDrops != null ? c.avgDrops : "—";
  let base = "—";
  const r = rawRates[c.name];
  if (r && r.opens) {
    let red = 0, tot = 0;
    for (const [n, cnt] of Object.entries(r.items)) { tot += cnt; if (r.grades && r.grades[n] === 6) red += cnt; }
    base = (red / tot * 100).toFixed(1) + "%";
  }
  let red = 0, total = 0;
  for (let i = 0; i < 800; i++) {
    for (const d of DFR.rollContainer(Math.random, c, LOOT)) { total++; if (d.item.grade === 6) red++; }
  }
  const sim = total ? red / total : 0;
  const perOpen = c.avgDrops != null ? c.avgDrops : Math.max(1, Math.round(c.w * c.h / 3));
  L.push(`| ${c.name} | ${TIER_NAME[c.tier]} | ${c.w}×${c.h} | ${avg} | ${base} | ${(sim * 100).toFixed(1)}% | ${(perOpen * sim * 100).toFixed(1)}% |`);
}
L.push("");
L.push("逐物品实测爆率全表见任务目录《容器物品爆率表_20260810.md》（24 容器×2000 开，含图鉴外物品）；结构化数据在 tools/data/container_item_rates.json。");
L.push("");
L.push("## 二、容器产出池（哪些容器能出哪些类别；2026-08-10 采样小涛查开容器模拟器校准，每容器 400 开、命中占比 ≥3% 收录）");
L.push("");
L.push("标【推断】的 4 个容器模拟器未收录，按语义自设。");
L.push("");
L.push("| 容器 | 档位 | 可产出类别 | 品质上限 |");
L.push("|---|---|---|---|");
for (const c of LOOT.containers) {
  L.push(`| ${c.name} | ${TIER_NAME[c.tier]} | ${(c.types || []).join("、")} | ${c.maxGrade ? GRADE_NAME[c.maxGrade] : "—"} |`);
}
L.push("");
L.push("## 三、关卡容器构成（每关必出的高档容器 + tier1 补齐）");
L.push("");
L.push("| 关卡 | 地图 | 容器数 | 顶级 | 高级 | 巡逻队 | 倒计时 | 撤离引导 |");
L.push("|---|---|---|---|---|---|---|---|");
for (const lv of DFR.LEVELS) {
  const t6 = lv.cfg.tiers.filter((t) => t === 6).length;
  const t5 = lv.cfg.tiers.filter((t) => t === 5).length;
  L.push(`| ${lv.name} | ${lv.cfg.w}×${lv.cfg.h} | ${lv.cfg.total[0]}~${lv.cfg.total[1]} | ${t6} | ${t5} | ${lv.cfg.patrols[0]}~${lv.cfg.patrols[1]} | ${lv.cfg.seconds}s | ${lv.cfg.extractMs / 1000}s |`);
}
L.push("");
L.push("## 四、全物品清单（按品质→价值降序；单格价值=性价比，背包取舍看这个）");
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
