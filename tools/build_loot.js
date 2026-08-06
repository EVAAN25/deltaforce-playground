#!/usr/bin/env node
/*
 * 数据管线：摸金撤离玩法（鼠鼠摸金）物品/容器数据
 *  物品 = jiansenc/DeltaForceData 官方图鉴快照 props/collection.json（253 件收集品：
 *         名称/品质/格数/类别/描述/官方图鉴图，均为真实图鉴数据）
 *  容器 = 《三角洲行动》游戏内真实容器名称；w×h 格数与档位参考 B 站 Toy 作品
 *        《三角洲小涛查-鼠鼠偷吃模拟器》前端常量（orzice.com，仅作事实性参考）
 *  价值 = 同人自设公式（官方未公开静态物价）：品质基价 × 类别系数 × 格数^0.85 × 稳定抖动
 *         —— 价值与掉落权重均为玩法设计数值，非官方交易行价，页面已注明
 * 输出浏览器直引的 data/loot.js。无第三方依赖，Node >= 18。
 * 用法：node tools/build_loot.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DFDATA = "https://cdn.jsdelivr.net/gh/jiansenc/DeltaForceData@main/public/json";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; deltaforce-playground data pipeline)" };

async function fetchJson(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  return r.json();
}

// ---- 价值公式（同人自设）----
const GRADE_BASE = { 1: 3000, 2: 8000, 3: 25000, 4: 70000, 5: 220000, 6: 900000 };
const TYPE_MULT = {
  "工艺藏品": 1.5, "电子物品": 1.3, "资料情报": 1.25,
  "医疗道具": 1.0, "工具材料": 0.9, "家居物品": 0.8,
};

// 稳定抖动：同一物品全站同价（±12%）
function jitter(objectID) {
  let h = 2166136261;
  const s = String(objectID);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 0.88 + ((h >>> 0) % 1000) / 1000 * 0.24;
}

function itemValue(it) {
  const cells = it.length * it.width;
  const base = GRADE_BASE[it.grade] || 3000;
  const mult = TYPE_MULT[(it.propsDetail || {}).type] || 1.0;
  const v = base * mult * Math.pow(cells, 0.85) * jitter(it.objectID);
  return Math.round(v / 100) * 100;
}

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

// 掉落品质权重（同人自设）：tier -> {grade: weight}
const DROP_WEIGHTS = {
  6: { 1: 0.05, 2: 0.13, 3: 0.27, 4: 0.30, 5: 0.18, 6: 0.07 },
  5: { 1: 0.15, 2: 0.24, 3: 0.30, 4: 0.20, 5: 0.09, 6: 0.02 },
  1: { 1: 0.35, 2: 0.33, 3: 0.20, 4: 0.09, 5: 0.025, 6: 0.005 },
};

(async () => {
  const raw = await fetchJson(`${DFDATA}/props/collection.json`);
  const list = raw.jData.data;

  const items = list.map((it) => {
    const cells = it.length * it.width;
    const value = itemValue(it);
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
      value,
      perCell: Math.round(value / cells),
      img: `assets/props/p_${it.objectID}.png`,
      remote: it.prePic,
      meme: it.objectName === "座钟" || undefined,
    };
  });

  // 校验：每档品质都要有货，否则掉落表会抽不出来
  const byGrade = {};
  items.forEach((i) => { (byGrade[i.grade] = byGrade[i.grade] || []).push(i); });
  for (let g = 1; g <= 6; g++) {
    if (!byGrade[g] || !byGrade[g].length) throw new Error(`品质 ${g} 无物品`);
  }

  const out = `/* 由 tools/build_loot.js 生成（${new Date().toISOString().slice(0, 10)}），请勿手改
 * 物品：jiansenc/DeltaForceData 官方图鉴快照（收集品 ${items.length} 件，真实图鉴字段）
 * 容器：游戏真实容器（名称/尺寸/档位参考 B 站 Toy《三角洲小涛查》前端常量）
 * 价值与掉落权重：同人自设玩法数值，非官方交易行价 */
window.DF_LOOT = ${JSON.stringify({ items, containers: CONTAINERS, dropWeights: DROP_WEIGHTS }, null, 1)};
`;
  fs.writeFileSync(path.join(ROOT, "data", "loot.js"), out);
  const stats = Object.fromEntries(Object.entries(byGrade).map(([g, a]) => [g, a.length]));
  console.log(`data/loot.js 生成完成：物品 ${items.length} 件（品质分布 ${JSON.stringify(stats)}），容器 ${CONTAINERS.length} 种`);
  const top = [...items].sort((a, b) => b.value - a.value).slice(0, 5);
  top.forEach((i) => console.log(`  价值TOP: ${i.name} g${i.grade} ${i.cells}格 ¥${i.value.toLocaleString()} 单格¥${i.perCell.toLocaleString()}`));
})().catch((e) => { console.error(e); process.exit(1); });
