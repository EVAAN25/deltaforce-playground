#!/usr/bin/env node
/*
 * 数据管线 v2：三角洲行动枪械/配件数据
 *  枪械 = df-api 官方图鉴快照（2024-12，含口径/描述）+ GTI 数据库 gtidb.com（更新平衡数值 + 新枪）合并
 *  配件 = jiansenc/DeltaForceData 官方图鉴快照（2024-12，无更新源，保持快照）
 * 输出浏览器直引的 data/weapons.js 与 data/attachments.js。
 * 无第三方依赖，Node >= 18。用法：node tools/build_data.js
 * 数据源详情与调研结论见 tools/README.md。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DFAPI = "https://cdn.jsdelivr.net/gh/zhuba-Ahhh/df-api@main/src";
const DFDATA = "https://cdn.jsdelivr.net/gh/jiansenc/DeltaForceData@main/public/json";
const GTIDB = "https://gtidb.com";

const GUN_CLASSES = ["gunRifle", "gunSMG", "gunMP", "gunLMG", "gunPistol", "gunShotgun", "gunSniper"];
const ACC_CLASSES = ["accMuzzle", "accBarrel", "accForeGrip", "accBackGrip", "accHandGuard", "accStock", "accScope", "accMagazine", "accFunctional"];

// 口径显示名（名称表取自 df-api src/config/json/config.ts）
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

// gtidb 伤害模型 bulletType → 口径显示名（用已知枪校验过：AKM→7.62x39、M4A1→5.56、VSS→9x39 均吻合）
const BULLET_TYPE_CN = {
  "5.56": "5.56x45mm", "6.8": "6.8x51mm", ".45": ".45 ACP", "5.8": "5.8x42mm",
  "7.62x39": "7.62x39mm", "7.62x51": "7.62x51mm", "9x19": "9x19mm", "9x39": "9x39mm",
  ".357": ".357 Magnum", ".50": ".50 AE", "12": "12 Gauge", ".338": ".338 Lap Mag",
  "4.6": "4.6x30mm", "5.7": "5.7x28mm", "5.45": "5.45x39mm", "12.7": "12.7x55mm", "7.62x54": "7.62x54mm",
};

// 开火模式规范顺序
const FIRE_MODE_ORDER = ["单发", "连发", "全自动"];

const UA = { "User-Agent": "Mozilla/5.0 (compatible; deltaforce-playground data pipeline)" };

async function fetchText(url) {
  const r = await fetch(url, { headers: UA });
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

// ---------- 来源 A：df-api 官方图鉴快照（2024-12） ----------
async function buildWeaponsBase() {
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
  return guns;
}

// ---------- 来源 B：GTI 数据库 gtidb.com（持续更新的粉丝 Wiki，数值跟随平衡补丁） ----------

const GTIDB_FIELDS = {
  "名称": "name", "类型": "type", "基础伤害": "meatHarm", "护甲伤害": "armorHarm",
  "射速": "fireSpeed", "射程": "shootDistance", "后坐力控制": "recoil", "操控速度": "control",
  "据枪稳定性": "stable", "腰射精度": "hipShot", "弹容量": "capacity",
  "开火模式": "fireMode", "子弹初速": "muzzleVelocity", "枪声传播距离": "soundDistance",
};
const GTIDB_NUM = ["meatHarm", "armorHarm", "fireSpeed", "shootDistance", "recoil", "control", "stable", "hipShot", "capacity", "muzzleVelocity", "soundDistance"];

function parseGtidbPage(html, pageId) {
  const m = html.match(/playerhub\/40001\/object\/(\d+)\.png/);
  const objectID = m ? m[1] : null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "|");
  const parts = text.split("|").map((s) => s.trim()).filter(Boolean);
  const rec = { page: pageId, objectID };
  for (let i = 0; i < parts.length; i++) {
    const key = GTIDB_FIELDS[parts[i]];
    if (key && i + 1 < parts.length) rec[key] = parts[i + 1];
  }
  if (!objectID || !rec.name) throw new Error("gtidb 页面解析失败: " + pageId);
  for (const k of GTIDB_NUM) {
    rec[k] = parseInt(rec[k], 10);
    if (Number.isNaN(rec[k])) throw new Error(`gtidb ${pageId} ${rec.name} 字段 ${k} 非数字`);
  }
  rec.fireModes = normFireModes(rec.fireMode);
  if (!rec.fireModes.length) throw new Error(`gtidb ${pageId} ${rec.name} 开火模式为空`);
  delete rec.fireMode;
  return rec;
}

async function fetchGtidbWeapons() {
  const sitemap = await fetchText(`${GTIDB}/sitemap.xml`);
  const ids = [...sitemap.matchAll(/weapons\/(\d+)\.html/g)].map((m) => m[1]);
  if (ids.length < 40) throw new Error("gtidb sitemap 武器页过少: " + ids.length);
  const out = [];
  // 串行抓取，礼貌一点
  for (const id of ids) {
    const html = await fetchText(`${GTIDB}/weapons/${id}`);
    out.push(parseGtidbPage(html, id));
  }
  return out;
}

// gtidb 伤害模型 chunk（bulletType 口径线索）：DPS 计算页引用 chunks/damages.*.js
async function fetchGtidbBulletTypes() {
  const dps = await fetchText(`${GTIDB}/calculator/dps.html`);
  const m = dps.match(/\/assets\/chunks\/damages\.[\w-]+\.js/);
  if (!m) throw new Error("找不到 gtidb damages chunk");
  const js = await fetchText(GTIDB + m[0]);
  const jm = js.match(/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
  if (!jm) throw new Error("damages chunk 解析失败");
  const raw = jm[1].replace(/\\'/g, "'");
  const data = JSON.parse(raw);
  const map = {};
  for (const d of data) map[d.name] = d.bulletType;
  return map;
}

// 页面枪名 → bulletType：去掉枪种后缀后做包含匹配（如 "M250通用机枪"→"M250"，"腾龙突击步枪"→"腾龙"）
const NAME_SUFFIXES = ["精确射手步枪", "突击步枪", "狙击步枪", "冲锋枪", "轻机枪", "通用机枪", "霰弹枪", "射手步枪", "手枪", "步枪"];
function bulletTypeFor(name, btMap) {
  let base = name;
  for (const s of NAME_SUFFIXES) if (base.endsWith(s) && base.length > s.length) { base = base.slice(0, -s.length); break; }
  if (btMap[name]) return btMap[name];
  if (btMap[base]) return btMap[base];
  for (const k of Object.keys(btMap)) {
    if (k === base || k.startsWith(base) || base.startsWith(k)) return btMap[k];
  }
  return null;
}

async function buildWeapons() {
  const [base, gtidb, btMap] = await Promise.all([buildWeaponsBase(), fetchGtidbWeapons(), fetchGtidbBulletTypes()]);
  const gtById = {};
  for (const g of gtidb) gtById[g.objectID] = g;

  // 1) 交集：gtidb 数值更新（平衡补丁后的新值），口径/描述/重量保留官方图鉴快照
  let updated = 0;
  const merged = base.map((w) => {
    const g = gtById[w.id];
    if (!g) return w;
    updated++;
    const out = { ...w };
    for (const k of GTIDB_NUM) out[k] = g[k];
    out.type = g.type;
    out.fireModes = g.fireModes;
    return out;
  });

  // 2) gtidb 新增枪：全字段来自 gtidb；口径取 gtidb 伤害模型 bulletType（同站来源）
  const baseIds = new Set(base.map((w) => w.id));
  const added = [];
  for (const g of gtidb) {
    if (baseIds.has(g.objectID)) continue;
    const bt = bulletTypeFor(g.name, btMap);
    const caliber = bt && BULLET_TYPE_CN[bt];
    if (!caliber) throw new Error(`新枪 ${g.name} 无法确定口径（bulletType=${bt}）`);
    const w = {
      id: g.objectID,
      name: g.name,
      type: g.type,
      caliber,
      fireModes: g.fireModes,
      weight: "",
      desc: "",
      img: `assets/guns/${g.objectID}.png`,
      picUrl: `https://playerhub.df.qq.com/playerhub/60004/object/p_${g.objectID}.png`,
    };
    for (const k of GTIDB_NUM) w[k] = g[k];
    merged.push(w);
    added.push(g.name);
  }

  // 完整性校验
  const ids = new Set();
  for (const w of merged) {
    if (ids.has(w.id)) throw new Error("枪械 id 重复: " + w.id);
    ids.add(w.id);
    for (const k of GTIDB_NUM) {
      if (typeof w[k] !== "number") throw new Error(`枪械 ${w.name} 缺字段 ${k}`);
    }
    if (!w.fireModes.length) throw new Error("枪械 " + w.name + " 开火模式为空");
    if (!w.caliber) throw new Error("枪械 " + w.name + " 口径为空");
  }
  console.log(`gtidb 交集更新 ${updated} 把，新增 ${added.length} 把: ${added.join("、") || "无"}`);
  return merged;
}

// ---------- 配件：jiansenc 快照（2024-12，无更新源） ----------
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
  const today = new Date().toISOString().slice(0, 10);
  const header = `/* 由 tools/build_data.js 生成（${today}），请勿手改；数据源见 tools/README.md
 * 枪械：df-api 官方图鉴快照(2024-12) + GTI 数据库 gtidb.com 合并（数值以 gtidb 较新平衡值为准，快照抓取于 ${today}）
 * 配件：jiansenc/DeltaForceData 官方图鉴快照(2024-12) */\n`;
  fs.writeFileSync(path.join(ROOT, "data", "weapons.js"),
    header + "window.DF_WEAPONS = " + JSON.stringify(weapons, null, 1) + ";\n");
  fs.writeFileSync(path.join(ROOT, "data", "attachments.js"),
    header + "window.DF_ACC = " + JSON.stringify(accs, null, 1) + ";\n");
  console.log(`weapons: ${weapons.length} 把 -> data/weapons.js`);
  console.log(`attachments: ${accs.length} 件 -> data/attachments.js`);
  const byType = {};
  weapons.forEach((w) => { byType[w.type] = (byType[w.type] || 0) + 1; });
  console.log("枪械类型分布:", JSON.stringify(byType));
})().catch((e) => { console.error(e); process.exit(1); });
