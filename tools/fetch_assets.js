#!/usr/bin/env node
/*
 * 图片管线：按 data/weapons.js 与 data/attachments.js 里的 picUrl（官方 CDN 300×150 小图）
 * 下载到本地 assets/。已存在的文件跳过，断点可续。用法：node tools/fetch_assets.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function loadDataJs(file) {
  const win = {};
  new Function("window", fs.readFileSync(path.join(ROOT, "data", file), "utf8"))(win);
  return win;
}

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

(async () => {
  const win = { ...loadDataJs("weapons.js"), ...loadDataJs("attachments.js") };
  const items = [...win.DF_WEAPONS, ...win.DF_ACC];
  let ok = 0, skip = 0, fail = 0;
  for (const it of items) {
    const dest = path.join(ROOT, it.img);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { skip++; continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      const n = await download(it.picUrl, dest);
      ok++;
      if (ok % 50 === 0) console.log(`已下载 ${ok}，跳过 ${skip}... (${it.name} ${n}B)`);
    } catch (e) {
      fail++;
      console.error("下载失败:", it.name, e.message);
    }
  }
  console.log(`完成：新下载 ${ok}，已存在 ${skip}，失败 ${fail}，共 ${items.length}`);
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
