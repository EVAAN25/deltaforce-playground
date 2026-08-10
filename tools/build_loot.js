#!/usr/bin/env node
/*
 * 数据管线：摸金玩法（收集品）数据
 *  物品 = jiansenc/DeltaForceData 官方图鉴快照 props/collection.json（253 件收集品：
 *         名称/品质/格数/类别/产出地图/描述/官方图鉴图，均为真实图鉴数据）
 *  价值 = 三角洲数据帝（orzice.com）真实交易行价格，优先级：
 *         - 设环境变量 ORZICE_TOKEN → 线上实时接口 /v1/sjz_api/item_price_all
 *           （高频1分钟/中频5分钟/低频10分钟更新；token 需在 orzice.com/work 控制台
 *            QQ 登录后开通服务获取，切勿提交进仓库）
 *         - 默认 → 本地 tools/data/item_jz.json：小涛查「物品单格价值」榜
 *           （orzice.com/v/item_jz，374 件实时交易行价，python3 tools/scrape_item_jz.py 刷新）
 *         - 兜底 → 开源快照 orzice/DeltaForcePrice（price.json，2026-01-10 停更）
 *  容器/掉落权重 = 同人自设玩法数值（仅供 WIP 的 2D 摸金撤离玩法使用，见 ../_wip_raid）
 * 输出浏览器直引的 data/loot.js。无第三方依赖，Node >= 18。
 * 用法：node tools/build_loot.js   或   ORZICE_TOKEN=xxx node tools/build_loot.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DFDATA = "https://cdn.jsdelivr.net/gh/jiansenc/DeltaForceData@main/public/json";
const PRICE_SNAPSHOT = "https://cdn.jsdelivr.net/gh/orzice/DeltaForcePrice@master/price.json";
const PRICE_LIVE = "https://orzice.com/workApi/v1/sjz_api/item_price_all";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; deltaforce-playground data pipeline)" };

async function fetchJson(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  return r.json();
}

// ---------- 价格源 ----------
// 优先级：ORZICE_TOKEN 实时接口 > 本地 item_jz.json（小涛查物品单格价值榜，默认）> GitHub 开源快照
// 统一成 { byName: Map<name, {price, time}>, live: bool, date: "YYYY-MM-DD", channel: string }
const LOCAL_ITEM_JZ = path.join(ROOT, "tools", "data", "item_jz.json");

async function fetchPrices() {
  const token = process.env.ORZICE_TOKEN;
  if (token) {
    const raw = await fetchJson(`${PRICE_LIVE}?token=${encodeURIComponent(token)}`);
    const list = Array.isArray(raw) ? raw : raw.data;
    if (!Array.isArray(list)) throw new Error("实时价格接口返回结构异常: " + JSON.stringify(raw).slice(0, 200));
    return { ...packPrices(list, true), channel: "live" };
  }
  if (fs.existsSync(LOCAL_ITEM_JZ)) {
    const raw = JSON.parse(fs.readFileSync(LOCAL_ITEM_JZ, "utf8"));
    const packed = packPrices(raw.items, false);
    packed.date = raw.date; // 榜单抓取日期（scrape_item_jz.py 写入）
    return { ...packed, channel: "item_jz" };
  }
  const list = await fetchJson(PRICE_SNAPSHOT);
  return { ...packPrices(list, false), channel: "snapshot" };
}

function packPrices(list, live) {
  const byName = new Map();
  let maxTime = 0;
  for (const p of list) {
    if (!p || typeof p.name !== "string" || typeof p.price !== "number") continue;
    byName.set(p.name, { price: p.price, time: p.is_get_time || 0 });
    if (p.is_get_time > maxTime) maxTime = p.is_get_time;
  }
  const date = maxTime
    ? new Date(maxTime * 1000).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
    : "未知";
  return { byName, live, date, total: byName.size };
}

const PRICE_SOURCE_NAME = {
  live: "三角洲数据帝（orzice.com）实时交易行 API",
  item_jz: "三角洲数据帝/小涛查「物品单格价值」榜（orzice.com/v/item_jz）",
  snapshot: "三角洲数据帝（orzice.com）交易行价格开源快照（orzice/DeltaForcePrice，已停更）",
};

// ---- 容器表（游戏真实容器；尺寸/档位参考小涛查前端常量）----
// tier: 6=顶级容器 5=高级容器 1=低级容器
const CONTAINERS = [
  { id: 1, name: "大保险箱", w: 4, h: 4, tier: 6 },
  { id: 4, name: "小保险箱", w: 4, h: 4, tier: 6 },
  { id: 26, name: "三角蚌", w: 1, h: 1, tier: 6 },
  { id: 30, name: "金币堆", w: 3, h: 3, tier: 6 },
  { id: 17, name: "电脑", w: 3, h: 3, tier: 6 },
  { id: 28, name: "放射性储物箱", w: 5, h: 6, tier: 5 },
  { id: 29, name: "工业金属储物箱", w: 5, h: 5, tier: 5 },
  { id: 18, name: "服务器", w: 5, h: 5, tier: 5 },
  { id: 3, name: "航空箱", w: 5, h: 6, tier: 5 },
  { id: 5, name: "实验服", w: 4, h: 4, tier: 5 },
  { id: 8, name: "高级储物箱", w: 5, h: 5, tier: 5 },
  { id: 9, name: "医疗物资堆", w: 5, h: 5, tier: 5 },
  { id: 11, name: "登山包", w: 4, h: 5, tier: 5 },
  { id: 22, name: "大武器箱", w: 6, h: 4, tier: 5 },
  { id: 6, name: "井盖", w: 5, h: 6, tier: 1 },
  { id: 7, name: "高级旅行箱", w: 4, h: 4, tier: 1 },
  { id: 10, name: "医疗包", w: 4, h: 4, tier: 1 },
  { id: 2, name: "鸟窝", w: 4, h: 4, tier: 1 },
  { id: 12, name: "旅行袋", w: 4, h: 4, tier: 1 },
  { id: 13, name: "快递箱", w: 4, h: 4, tier: 1 },
  { id: 14, name: "抽屉柜", w: 4, h: 4, tier: 1 },
  { id: 15, name: "垃圾箱", w: 5, h: 6, tier: 1 },
  { id: 16, name: "野外物资堆", w: 7, h: 5, tier: 1 },
  { id: 19, name: "手提箱", w: 4, h: 4, tier: 1 },
  { id: 20, name: "大工具盒", w: 4, h: 4, tier: 1 },
  { id: 21, name: "电脑机箱", w: 3, h: 3, tier: 1 },
  { id: 23, name: "弹药箱", w: 4, h: 4, tier: 1 },
  { id: 24, name: "工具柜", w: 5, h: 6, tier: 1 },
];

// 掉落品质权重（同人自设，仅 WIP 玩法使用）：tier -> {grade: weight}
const DROP_WEIGHTS = {
  6: { 1: 0.03, 2: 0.13, 3: 0.27, 4: 0.30, 5: 0.18, 6: 0.09 },
  5: { 1: 0.14, 2: 0.24, 3: 0.30, 4: 0.20, 5: 0.09, 6: 0.03 },
  1: { 1: 0.347, 2: 0.33, 3: 0.20, 4: 0.09, 5: 0.025, 6: 0.008 },
};

(async () => {
  const [raw, prices] = await Promise.all([
    fetchJson(`${DFDATA}/props/collection.json`),
    fetchPrices(),
  ]);
  // 上游 JSON 嵌套层级不稳定（jData.data / jData.data.data.list 都出现过），递归找物品数组
  function findItems(o) {
    if (Array.isArray(o) && o.length && o[0] && o[0].objectID) return o;
    if (o && typeof o === "object") {
      for (const v of Object.values(o)) { const r = findItems(v); if (r) return r; }
    }
    return null;
  }
  const list = findItems(raw);
  if (!list) throw new Error("collection.json 里没找到物品数组");

  const unpriced = [];
  const items = list.map((it) => {
    const cells = it.length * it.width;
    const p = prices.byName.get(it.objectName);
    const priced = !!p && p.price > 0;
    if (!priced) unpriced.push(it.objectName);
    return {
      id: it.objectID,
      name: it.objectName,
      grade: it.grade, // 1灰 2绿 3蓝 4紫 5金 6红
      len: it.length,
      wid: it.width,
      cells,
      type: (it.propsDetail || {}).type || "",
      source: (it.propsDetail || {}).propsSource || "",
      desc: it.desc || "",
      priced,
      value: priced ? p.price : null,          // 真实交易行价格（快照/实时见 meta）
      perCell: priced ? Math.round(p.price / cells) : null,
      img: `assets/props/p_${it.objectID}.png`,
      remote: it.prePic,
      meme: it.objectName === "座钟" || undefined,
    };
  });

  // 校验：每档品质都要有货（掉落表用）；可交易物品必须占绝大多数
  const byGrade = {};
  items.forEach((i) => { (byGrade[i.grade] = byGrade[i.grade] || []).push(i); });
  for (let g = 1; g <= 6; g++) {
    if (!byGrade[g] || !byGrade[g].length) throw new Error(`品质 ${g} 无物品`);
  }
  const pricedCount = items.length - unpriced.length;
  if (pricedCount < items.length * 0.85) {
    throw new Error(`价格匹配率过低：${pricedCount}/${items.length}，未匹配样例 ${unpriced.slice(0, 5).join("、")}`);
  }

  const meta = {
    priceSource: PRICE_SOURCE_NAME[prices.channel],
    priceDate: prices.date,
    priceLive: prices.live,
    itemCount: items.length,
    pricedCount,
  };

  const out = `/* 由 tools/build_loot.js 生成（${new Date().toISOString().slice(0, 10)}），请勿手改
 * 物品：jiansenc/DeltaForceData 官方图鉴快照（收集品 ${items.length} 件，真实图鉴字段）
 * 价值：${meta.priceSource}，价格日期 ${meta.priceDate}（可交易 ${pricedCount} 件；未匹配 ${unpriced.length} 件不参与出题）
 * 容器与掉落权重：同人自设玩法数值（仅 WIP 玩法使用），非官方数据 */
window.DF_LOOT = ${JSON.stringify({ items, containers: CONTAINERS, dropWeights: DROP_WEIGHTS, meta }, null, 1)};
`;
  fs.writeFileSync(path.join(ROOT, "data", "loot.js"), out);
  const stats = Object.fromEntries(Object.entries(byGrade).map(([g, a]) => [g, a.length]));
  console.log(`data/loot.js 生成完成：物品 ${items.length} 件（品质分布 ${JSON.stringify(stats)}），容器 ${CONTAINERS.length} 种`);
  console.log(`价格源：${meta.priceSource} @ ${meta.priceDate}；可交易 ${pricedCount}/${items.length}`);
  if (unpriced.length) console.log("未匹配价格（不参与出题）:", unpriced.join("、"));
  const top = items.filter((i) => i.priced).sort((a, b) => b.value - a.value).slice(0, 5);
  top.forEach((i) => console.log(`  价值TOP: ${i.name} g${i.grade} ${i.cells}格 ¥${i.value.toLocaleString()} 单格¥${i.perCell.toLocaleString()}`));
})().catch((e) => { console.error(e); process.exit(1); });
