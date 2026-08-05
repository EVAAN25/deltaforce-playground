#!/usr/bin/env node
/*
 * 数据管线：从上游 GitHub 仓库（经 jsDelivr CDN）拉取三角洲行动官方图鉴快照，
 * 清洗后输出浏览器直引的 data/weapons.js 与 data/attachments.js。
 * 无第三方依赖，Node >= 18。用法：node tools/build_data.js
 * 数据源详情见 tools/README.md。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DFAPI = "https://cdn.jsdelivr.net/gh/zhuba-Ahhh/df-api@main/src";
const DFDATA = "https://cdn.jsdelivr.net/gh/jiansenc/DeltaForceData@main/public/json";

const GUN_CLASSES = ["gunRifle", "gunSMG", "gunMP", "gunLMG", "gunPistol", "gunShotgun", "gunSniper"];
const ACC_CLASSES = ["accMuzzle", "accBarrel", "accForeGrip", "accBackGrip", "accHandGuard", "accStock", "accScope", "accMagazine", "accFunctional"];

// 口径显示名（名称表取自 df-api src/config/json/config.ts；x 统一为 × 仅用于展示？否——保持官方写法 x）
const CALIBER_CN = {
  "ammo.338": ".338 Lap Mag", "ammo.357": ".357 Magnum", "ammo.45": ".45 ACP",
  "ammo.50": ".50 AE", "ammo12": "12 Gauge", "ammo12.7x55": "12.7x55mm",
  "ammo4.6x30": "4.6x30mm", "ammo5.45x39": "5.45x39mm", "ammo5.56x45": "5.56x45mm",
  "ammo5.7x28": "5.7x28mm", "ammo5.8x42": "5.8x42mm", "ammo6.8x51": "6.8x51mm",
  "ammo7.62x39": "7.62x39mm", "ammo7.62x51": "7.62x51mm", "ammo7.62x54": "7.62x54mm",
  "ammo9x19": "9x19mm", "ammo9x39": "9x39mm",
};
// 上游笔误修正
const CALIBER_FIX = { "mmo7.62x51": "ammo7.62x51", "mmo7x62x51": "ammo7.62x51" };

// 开火模式规范顺序
const FIRE_MODE_ORDER = ["单发", "连发", "全自动"];

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  return r.text();
}

// 把上游 TS（实为 JS 对象字面量 + import/export）转成可 eval 的模块
function loadTsLiteral(code) {
  code = code.replace(/import[^\n]+\n/g, "");
  code = code.replace(/export\s+const\s+(\w+)\s*=/g, "const $1 =");
  code = code.replace(/export\s+default\s+[^;]+;/g, "");
  code = code.replace(/export\s*\{[^}]*\};?/g, "");
  const names = [...code.matchAll(/const\s+(\w+)\s*=/g)].map((m) => m[1]);
  code += `\nmodule.exports = { ${names.join(", ")} };`;
  const m = { exports: {} };
  new Function("module", "exports", code)(m, m.exports);
  return m.exports;
}

function normCaliber(raw) {
  let c = String(raw || "").trim();
  if (CALIBER_FIX[c]) c = CALIBER_FIX[c];
  if (!CALIBER_CN[c]) throw new Error("未知口径: " + raw);
  return CALIBER_CN[c];
}

function normFireModes(raw) {
  const set = new Set(String(raw || "").split(/[,，、/]+/).map((s) => s.trim()).filter(Boolean));
  const out = FIRE_MODE_ORDER.filter((m) => set.has(m));
  for (const m of set) if (!out.includes(m)) out.push(m); // 兜底：未知模式排最后
  return out;
}

async function buildWeapons() {
  const guns = [];
  for (const cls of GUN_CLASSES) {
    const code = await fetchText(`${DFAPI}/arms/json/${cls}.ts`);
    const mod = loadTsLiteral(code);
    const obj = mod[Object.keys(mod)[0]];
    const list = obj.list || obj;
    for (const g of list) {
      const d = g.gunDetail;
      guns.push({
        id: String(g.objectID),
        name: g.objectName,
        type: g.secondClassCN,
        caliber: normCaliber(d.caliber),
        fireModes: normFireModes(d.fireMode),
        meatHarm: d.meatHarm, armorHarm: d.armorHarm, fireSpeed: d.fireSpeed,
        shootDistance: d.shootDistance, recoil: d.recoil, control: d.control,
        stable: d.stable, hipShot: d.hipShot, capacity: d.capacity,
        muzzleVelocity: d.muzzleVelocity, soundDistance: d.soundDistance,
        weight: g.weight, desc: g.desc,
        img: `assets/guns/${g.objectID}.png`,
        picUrl: `https://playerhub.df.qq.com/playerhub/60004/object/p_${g.objectID}.png`,
      });
    }
  }
  // 完整性校验
  const ids = new Set();
  for (const w of guns) {
    if (ids.has(w.id)) throw new Error("枪械 id 重复: " + w.id);
    ids.add(w.id);
    for (const k of ["meatHarm", "armorHarm", "fireSpeed", "shootDistance", "recoil", "control", "stable", "hipShot", "capacity", "muzzleVelocity", "soundDistance"]) {
      if (typeof w[k] !== "number") throw new Error(`枪械 ${w.name} 缺字段 ${k}`);
    }
    if (!w.fireModes.length) throw new Error("枪械 " + w.name + " 开火模式为空");
  }
  return guns;
}

const ACC_STAT_KEYS = ["recoil", "controlSpeed", "controlStable", "hipShot", "shotDistancePercent", "bombCapacity", "quickSeparate"];

async function buildAttachments() {
  const accs = [];
  for (const cls of ACC_CLASSES) {
    const raw = JSON.parse(await fetchText(`${DFDATA}/acc/${cls}.json`));
    const list = raw.jData.data.data.list;
    for (const a of list) {
      const d = a.accDetail || {};
      const stats = {};
      for (const k of ACC_STAT_KEYS) if (typeof d[k] === "number") stats[k] = d[k];
      const pros = (d.advantage && d.advantage.effectList || []).map((e) => e.value);
      const cons = (d.disadvantage && d.disadvantage.effectList || []).map((e) => e.value);
      accs.push({
        id: String(a.objectID),
        name: a.objectName,
        slot: cls,
        slotCN: a.secondClassCN,
        grade: a.grade,
        weight: a.weight,
        stats, pros, cons,
        img: `assets/acc/${a.objectID}.png`,
        picUrl: `https://playerhub.df.qq.com/playerhub/60004/object/p_${a.objectID}.png`,
      });
    }
  }
  const ids = new Set();
  for (const a of accs) {
    if (ids.has(a.id)) throw new Error("配件 id 重复: " + a.id);
    ids.add(a.id);
  }
  return accs;
}

(async () => {
  const weapons = await buildWeapons();
  const accs = await buildAttachments();
  const header = `/* 由 tools/build_data.js 生成（${new Date().toISOString().slice(0, 10)}），请勿手改；数据源见 tools/README.md */\n`;
  fs.writeFileSync(path.join(ROOT, "data", "weapons.js"),
    header + "window.DF_WEAPONS = " + JSON.stringify(weapons, null, 1) + ";\n");
  fs.writeFileSync(path.join(ROOT, "data", "attachments.js"),
    header + "window.DF_ACC = " + JSON.stringify(accs, null, 1) + ";\n");
  console.log(`weapons: ${weapons.length} 把 -> data/weapons.js`);
  console.log(`attachments: ${accs.length} 件 -> data/attachments.js`);
  const byType = {};
  weapons.forEach((w) => { byType[w.type] = (byType[w.type] || 0) + 1; });
  console.log("枪械类型分布:", JSON.stringify(byType));
  const bySlot = {};
  accs.forEach((a) => { bySlot[a.slotCN] = (bySlot[a.slotCN] || 0) + 1; });
  console.log("配件部位分布:", JSON.stringify(bySlot));
})().catch((e) => { console.error(e); process.exit(1); });
