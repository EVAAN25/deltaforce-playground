/* 鼠鼠摸金 —— UI 层（依赖 game.js 的 DFG、raid.js 的 DFR、data/loot.js 的 DF_LOOT、app.js 导出的 DF_APP） */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const DFG = window.DFG;
  const DFR = window.DFR;
  const LOOT = window.DF_LOOT;

  const TS = 30; // 每格像素（720×480 / 24×16）
  const TIER_NAME = { 6: "顶级容器", 5: "高级容器", 1: "低级容器" };
  const GRADE_NAME = { 1: "灰", 2: "绿", 3: "蓝", 4: "紫", 5: "金", 6: "红" };
  const TIP_DEFAULT = "WASD / 方向键移动 · 点击格子自动寻路 · 走到容器旁按 <b>E</b>（或点容器）开吃 · 站到撤离点按 <b>E</b> 引导撤离";

  // ---------- 图片兜底：品质色块 + 物品名首字 ----------
  window.__dfRaidImg = function (img) {
    const div = document.createElement("div");
    div.className = "rit-fb g" + (img.dataset.grade || 1);
    div.textContent = (img.dataset.name || "物")[0];
    img.replaceWith(div);
  };
  function itemImgHTML(item) {
    return `<img loading="lazy" src="${item.img}" alt="${item.name}" data-name="${item.name}" data-grade="${item.grade}" onerror="window.__dfRaidImg(this)">`;
  }

  // ---------- 音效（WebAudio 合成，无外部资源；首次开箱/按键时激活） ----------
  const Sfx = (() => {
    let ctx = null, master = null, noiseBuf = null, rustle = null;
    function ac() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }
    function noise() {
      if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      return noiseBuf;
    }
    // 翻找声「鼠鼠祟祟」：循环噪声 + 带通 + 增益抖动，模拟窸窸窣窣（合成版，先保留）
    function rustleStart() {
      const c = ac(); if (!c) return;
      rustleStop();
      const src = c.createBufferSource();
      src.buffer = noise(); src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 0.8;
      const g = c.createGain(); g.gain.value = 0.05;
      const lfo = c.createOscillator(); lfo.type = "triangle"; lfo.frequency.value = 8.5;
      const lfoG = c.createGain(); lfoG.gain.value = 0.038;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(); lfo.start();
      rustle = { src, lfo };
    }
    function rustleStop() {
      if (!rustle) return;
      try { rustle.src.stop(); rustle.lfo.stop(); } catch (e) { /* 已停止 */ }
      rustle = null;
    }
    function blip(freq, at, dur, type, vol) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      o.connect(g); g.connect(master);
      o.start(at); o.stop(at + dur + 0.05);
    }
    // 出货音：真实音频（来自 ItemLevelAndSearchSoundMod，assets/sfx/），按品质分层
    const REVEAL_SRC = {
      1: "assets/sfx/reveal-low.mp3", 2: "assets/sfx/reveal-low.mp3", 3: "assets/sfx/reveal-low.mp3",
      4: "assets/sfx/reveal-purple.mp3", 5: "assets/sfx/reveal-gold.mp3", 6: "assets/sfx/reveal-red.mp3",
    };
    const revealCache = {};
    function ding(grade) {
      const src = REVEAL_SRC[grade] || REVEAL_SRC[1];
      let a = revealCache[src];
      if (!a) { a = new Audio(src); a.preload = "auto"; revealCache[src] = a; }
      a.currentTime = 0;
      a.volume = 0.85;
      const p = a.play();
      if (p && p.catch) p.catch(() => { // 自动播放被拦时用合成音兜底
        const c = ac(); if (!c) return;
        const t = c.currentTime;
        if (grade >= 6) { blip(987.8, t, 0.12, "sine", 0.22); blip(1174.7, t + 0.09, 0.12, "sine", 0.2); blip(1480, t + 0.18, 0.32, "sine", 0.2); }
        else if (grade === 5) { blip(880, t, 0.12, "sine", 0.2); blip(1174.7, t + 0.09, 0.24, "sine", 0.17); }
        else if (grade === 4) blip(784, t, 0.11, "sine", 0.15);
        else blip(340 + grade * 70, t, 0.06, "triangle", 0.12);
      });
    }
    // 入包/入箱：短促"咔哒"
    function pickup() {
      const c = ac(); if (!c) return;
      blip(520, c.currentTime, 0.06, "square", 0.09);
    }
    return { rustleStart, rustleStop, ding, pickup };
  })();

  // ---------- 状态 ----------
  const Raid = { mode: "daily", level: 0, run: null, active: false, overlay: null, keys: {}, tickTimer: null, rafId: 0 };

  function newRun(mode) {
    let seed, cfg, level = null, practiceName = null;
    if (mode === "daily") {
      seed = DFR.dailySeed(DF_APP.TODAY); cfg = DFR.DEFAULT_CFG;
    } else if (mode === "levels") {
      level = Raid.level; cfg = DFR.LEVELS[level].cfg;
      seed = DFG.hash32("df-raid-level:" + DFR.LEVELS[level].id); // 每关固定图，全站一致
    } else {
      const lv = DFR.LEVELS[Math.floor(Math.random() * DFR.LEVELS.length)];
      cfg = lv.cfg; practiceName = lv.name;
      seed = (Math.floor(Math.random() * 0xffffffff) >>> 0);
    }
    const map = DFR.generateRaid(seed, LOOT, cfg);
    const introRng = DFG.mulberry32((seed ^ 0x5f3a) >>> 0);
    const now = performance.now();
    return {
      mode, level, seed, map, practiceName,
      solid: DFR.makeSolidFn(map),
      timeLeft: map.cfg.seconds,
      px: map.spawn.x, py: map.spawn.y,
      vx: map.spawn.x * TS, vy: map.spawn.y * TS,
      queue: [], nextStep: 0, nextNpc: now + DFR.PATROL_STEP_MS, nextSec: now + 1000,
      patrols: map.patrols.map((p) => ({
        path: p.path, radius: p.radius, i: 0, dir: 1,
        x: p.path[0].x, y: p.path[0].y, vx: p.path[0].x * TS, vy: p.path[0].y * TS,
      })),
      containers: map.containers.map((c) => Object.assign({ searched: false, drops: null }, c)),
      bagMain: DFR.makeBag(6, 4),
      bagSafe: DFR.makeBag(2, 2),
      status: "playing", outcome: null,
      extracting: 0, extractAcc: 0, extractPaused: false, searched: 0,
      story: DFR.RAID_LINES.intro[Math.floor(introRng() * DFR.RAID_LINES.intro.length)],
    };
  }

  // ---------- 地图绘制 ----------
  const canvas = () => $("#raidCanvas");
  const TIER_COLOR = { 6: "#e0a83c", 5: "#a06ee0", 1: "#6d8048" };

  function draw() {
    const run = Raid.run;
    const cv = canvas();
    if (!cv || !run) return;
    const ctx = cv.getContext("2d");
    const { w, h, tiles } = run.map;
    ctx.clearRect(0, 0, cv.width, cv.height);
    // 地板 / 墙
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (tiles[y][x] === 1) {
        ctx.fillStyle = "#313844";
        ctx.fillRect(x * TS, y * TS, TS, TS);
        ctx.fillStyle = "#3d4553";
        ctx.fillRect(x * TS, y * TS, TS, 3);
      } else {
        ctx.fillStyle = (x + y) % 2 ? "#1d2129" : "#20252e";
        ctx.fillRect(x * TS, y * TS, TS, TS);
      }
    }
    // 撤离点
    for (const e of run.map.extracts) {
      ctx.fillStyle = "rgba(95,174,99,.28)";
      ctx.fillRect(e.x * TS, e.y * TS, TS, TS);
      ctx.strokeStyle = "#5fae63";
      ctx.lineWidth = 2;
      ctx.strokeRect(e.x * TS + 1, e.y * TS + 1, TS - 2, TS - 2);
      ctx.fillStyle = "#a8d8ab";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("撤", e.x * TS + TS / 2, e.y * TS + TS / 2 + 1);
    }
    // 容器
    ctx.font = "bold 12px sans-serif";
    for (const c of run.containers) {
      const cx = c.x * TS, cy = c.y * TS;
      if (c.searched) {
        ctx.fillStyle = "#2a2f3a";
        ctx.fillRect(cx + 2, cy + 2, TS - 4, TS - 4);
        ctx.strokeStyle = "#3a4150";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx + 2.5, cy + 2.5, TS - 5, TS - 5);
        ctx.fillStyle = "#5a6272";
        ctx.fillText("✓", cx + TS / 2, cy + TS / 2 + 1);
      } else {
        const col = TIER_COLOR[c.tier];
        ctx.fillStyle = col + "33";
        ctx.fillRect(cx + 2, cy + 2, TS - 4, TS - 4);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.strokeRect(cx + 2.5, cy + 2.5, TS - 5, TS - 5);
        ctx.fillStyle = col;
        ctx.fillText(c.name[0], cx + TS / 2, cy + TS / 2 + 1);
      }
    }
    // 寻路队列的脚印
    ctx.fillStyle = "rgba(224,138,60,.5)";
    for (const s of run.queue) {
      ctx.beginPath();
      ctx.arc(s.x * TS + TS / 2, s.y * TS + TS / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // 巡逻队 + 视野
    for (const p of run.patrols) {
      ctx.fillStyle = "rgba(207,106,85,.10)";
      ctx.beginPath();
      ctx.arc(p.vx + TS / 2, p.vy + TS / 2, p.radius * TS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(207,106,85,.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#cf6a55";
      ctx.beginPath();
      ctx.arc(p.vx + TS / 2, p.vy + TS / 2, TS / 2 - 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 15px sans-serif";
      ctx.fillText("!", p.vx + TS / 2, p.vy + TS / 2 + 1);
    }
    // 鼠鼠
    ctx.font = "20px sans-serif";
    ctx.fillText("🐭", run.vx + TS / 2, run.vy + TS / 2 + 2);
    // 平滑趋近
    run.vx += (run.px * TS - run.vx) * 0.35;
    run.vy += (run.py * TS - run.vy) * 0.35;
    for (const p of run.patrols) {
      p.vx += (p.x * TS - p.vx) * 0.35;
      p.vy += (p.y * TS - p.vy) * 0.35;
    }
  }

  // ---------- 主循环 ----------
  function loopStart() {
    if (!Raid.tickTimer) Raid.tickTimer = setInterval(tick, 50);
    if (!Raid.rafId) {
      const frame = () => { draw(); Raid.rafId = requestAnimationFrame(frame); };
      Raid.rafId = requestAnimationFrame(frame);
    }
  }
  function loopStop() {
    clearInterval(Raid.tickTimer); Raid.tickTimer = null;
    cancelAnimationFrame(Raid.rafId); Raid.rafId = 0;
  }

  function walkBlocked(x, y) {
    const run = Raid.run;
    if (run.map.tiles[y][x] === 1) return true;
    return run.containers.some((c) => c.x === x && c.y === y);
  }

  function tick() {
    const run = Raid.run;
    if (!run || run.status !== "playing" || Raid.overlay) return;
    const now = performance.now();
    // 玩家移动
    if (now >= run.nextStep) {
      const dir = run.queue.length ? null : heldDir();
      let step = null;
      if (run.queue.length) step = run.queue.shift();
      else if (dir) {
        const nx = run.px + dir[0], ny = run.py + dir[1];
        if (nx >= 0 && ny >= 0 && nx < run.map.w && ny < run.map.h && !walkBlocked(nx, ny)) step = { x: nx, y: ny };
      }
      if (step) {
        run.px = step.x; run.py = step.y;
        run.nextStep = now + DFR.PLAYER_STEP_MS;
        if (run.extracting) { // 移动取消引导：进度清零重来
          run.extracting = 0; run.extractAcc = 0; run.extractPaused = false;
          updateExtractBar();
        }
        onEnterTile();
        detect();
        // 点容器寻路到位后自动开搜
        if (!run.queue.length && run.autoSearch) {
          const c = run.autoSearch;
          run.autoSearch = null;
          if (!c.searched && Math.abs(c.x - run.px) + Math.abs(c.y - run.py) === 1 && run.status === "playing") openSearch(c);
        }
      }
    }
    // 巡逻队
    if (now >= run.nextNpc) {
      run.nextNpc = now + DFR.PATROL_STEP_MS;
      for (const p of run.patrols) {
        p.i += p.dir;
        if (p.i >= p.path.length - 1) { p.i = p.path.length - 1; p.dir = -1; }
        else if (p.i <= 0) { p.i = 0; p.dir = 1; }
        p.x = p.path[p.i].x; p.y = p.path[p.i].y;
      }
      detect();
      if (run.extracting) checkExtract(now);
    }
    // 倒计时
    if (now >= run.nextSec) {
      run.nextSec = now + 1000;
      run.timeLeft--;
      updateHUD();
      if (run.timeLeft <= 0) { finish("lost"); return; }
    }
    if (run.extracting) updateExtractBar();
  }

  function heldDir() {
    const k = Raid.keys;
    if (k.up) return [0, -1];
    if (k.down) return [0, 1];
    if (k.left) return [-1, 0];
    if (k.right) return [1, 0];
    return null;
  }

  function onEnterTile() {
    const run = Raid.run;
    const onExtract = run.map.extracts.some((e) => e.x === run.px && e.y === run.py);
    const adj = adjacentContainer();
    if (onExtract) setTip(`到撤离点了！按 <b>E</b> 开始引导（${run.map.cfg.extractMs / 1000} 秒，被看见会暂停、走动会取消）`);
    else if (adj) setTip(`旁边是「${adj.name}」（${TIER_NAME[adj.tier]}），按 <b>E</b> 开吃`);
    else setTip(TIP_DEFAULT);
  }

  function adjacentContainer() {
    const run = Raid.run;
    return run.containers.find((c) => !c.searched &&
      Math.abs(c.x - run.px) + Math.abs(c.y - run.py) === 1) || null;
  }

  function detect() {
    const run = Raid.run;
    if (run.status !== "playing") return;
    for (const p of run.patrols) {
      const d = Math.hypot(run.px - p.x, run.py - p.y);
      if (d <= p.radius && DFR.losClear(run.solid, p.x, p.y, run.px, run.py)) {
        finish("caught");
        return;
      }
    }
  }

  // ---------- 交互 ----------
  const KEYMAP = {
    w: "up", arrowup: "up", s: "down", arrowdown: "down",
    a: "left", arrowleft: "left", d: "right", arrowright: "right",
  };

  function bindInput() {
    window.addEventListener("keydown", (e) => {
      if (!Raid.active || !Raid.run || Raid.run.status !== "playing") return;
      const k = e.key.toLowerCase();
      if (KEYMAP[k]) {
        Raid.keys[KEYMAP[k]] = true;
        Raid.run.queue = []; // 键盘接管，清空寻路
        Raid.run.autoSearch = null;
        e.preventDefault();
      } else if (k === "e") {
        e.preventDefault();
        interact();
      }
    });
    window.addEventListener("keyup", (e) => {
      const k = KEYMAP[e.key.toLowerCase()];
      if (k) Raid.keys[k] = false;
    });
    canvas().addEventListener("pointerdown", (e) => {
      if (!Raid.active || !Raid.run || Raid.run.status !== "playing" || Raid.overlay) return;
      const run = Raid.run;
      const rect = canvas().getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / rect.width * run.map.w);
      const y = Math.floor((e.clientY - rect.top) / rect.height * run.map.h);
      if (x < 0 || y < 0 || x >= run.map.w || y >= run.map.h) return;
      // 点相邻的容器 = 直接开搜
      const c = run.containers.find((cc) => cc.x === x && cc.y === y);
      if (c && !c.searched && Math.abs(c.x - run.px) + Math.abs(c.y - run.py) === 1) { openSearch(c); return; }
      // 点远处的容器 = 寻路到它旁边，到位自动开搜
      if (c && !c.searched) {
        const adj = [{ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 }]
          .filter((t) => t.x >= 0 && t.y >= 0 && t.x < run.map.w && t.y < run.map.h && !walkBlocked(t.x, t.y));
        let best = null;
        for (const t of adj) {
          const p = DFR.findPath(walkBlocked, run.map.w, run.map.h, { x: run.px, y: run.py }, t);
          if (p && (!best || p.length < best.length)) best = p;
        }
        if (best) { run.queue = best.slice(1); run.autoSearch = c; }
        return;
      }
      const path = DFR.findPath(walkBlocked, run.map.w, run.map.h, { x: run.px, y: run.py }, { x, y });
      if (path) { run.queue = path.slice(1); run.autoSearch = null; }
    });
  }

  function interact() {
    const run = Raid.run;
    if (!run || run.status !== "playing" || Raid.overlay) return;
    const onExtract = run.map.extracts.some((e) => e.x === run.px && e.y === run.py);
    if (onExtract) {
      if (!run.extracting) {
        run.extracting = performance.now();
        run.extractAcc = 0;
        run.extractPaused = false;
        run.queue = [];
        updateExtractBar();
        DF_APP.toast("撤离引导开始，别动！");
      }
      return;
    }
    const c = adjacentContainer();
    if (c) openSearch(c);
  }

  // 巡逻队"看见"玩家（距离内 + 无遮挡）→ 引导暂停，进度保留；走远后自动继续
  function checkExtract(now) {
    const run = Raid.run;
    const threat = run.patrols.some((p) =>
      Math.hypot(run.px - p.x, run.py - p.y) <= DFR.EXTRACT_INTERRUPT_DIST &&
      DFR.losClear(run.solid, p.x, p.y, run.px, run.py));
    if (threat) {
      if (!run.extractPaused) {
        run.extractAcc += now - run.extracting;
        run.extractPaused = true;
        DF_APP.toast(DFR.RAID_LINES.interrupt);
      }
      updateExtractBar();
      return;
    }
    if (run.extractPaused) { run.extractPaused = false; run.extracting = now; }
    if (run.extractAcc + (now - run.extracting) >= run.map.cfg.extractMs) finish("extracted");
  }

  function updateExtractBar() {
    const run = Raid.run;
    const bar = $("#raidExtractBar");
    if (!run || !run.extracting) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    bar.classList.toggle("paused", run.extractPaused);
    bar.querySelector(".re-text").textContent = run.extractPaused ? "猛攻队逼近——引导暂停（进度保留）" : "撤离引导中……";
    const done = run.extractAcc + (run.extractPaused ? 0 : performance.now() - run.extracting);
    const pct = Math.min(100, done / run.map.cfg.extractMs * 100);
    $("#raidExtractFill").style.width = pct + "%";
  }

  // ---------- HUD / 背包 ----------
  function setTip(html) { $("#raidTip").innerHTML = html; }

  function updateHUD() {
    const run = Raid.run;
    if (!run) return;
    const t = Math.max(0, run.timeLeft);
    const timer = $("#raidTimer");
    timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    timer.classList.toggle("danger", t <= 30);
    $("#raidValue").textContent = DFR.fmt(DFR.bagValue(run.bagMain) + DFR.bagValue(run.bagSafe));
    $("#raidSearched").textContent = `${run.searched}/${run.containers.length}`;
  }

  function fitsBag(bag, item) { // 不改变 bag 的试装
    const occ = bag.occ.map((r) => r.slice());
    return !!DFR.packFirstFit(occ, bag.w, bag.h, item.len, item.wid, true);
  }

  function renderBags() {
    const run = Raid.run;
    if (!run) return;
    const cs = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--bagcell"), 10) || 44;
    $("#raidBagMain").innerHTML = run.bagMain.items.map((e) => bagItemAt(e, cs)).join("");
    $("#raidBagSafe").innerHTML = run.bagSafe.items.map((e) => bagItemAt(e, cs)).join("");
    $("#raidBagMain").querySelectorAll(".bag-item").forEach((el, i) =>
      el.addEventListener("click", () => discard("bagMain", i)));
    $("#raidBagSafe").querySelectorAll(".bag-item").forEach((el, i) =>
      el.addEventListener("click", () => discard("bagSafe", i)));
  }
  function bagItemAt(entry, cs) {
    const it = entry.item;
    return `<div class="bag-item g${it.grade}" title="${it.name} · 价值【${DFR.fmt(it.value)}】· 单格【${DFR.fmt(it.perCell)}】· 点击丢弃"
      style="left:${entry.x * cs}px;top:${entry.y * cs}px;width:${entry.w * cs}px;height:${entry.h * cs}px">
      ${itemImgHTML(it)}
      <div class="bi-name">${it.name}</div>
      ${entry.w * entry.h > 1 ? `<div class="bi-val">${DFR.fmt(it.perCell)}/格</div>` : ""}
    </div>`;
  }

  function discard(which, idx) {
    const run = Raid.run;
    if (!run || run.status !== "playing") return;
    const bag = run[which];
    const entry = bag.items[idx];
    if (!entry) return;
    DFR.removeFromBag(bag, idx);
    DF_APP.toast(`丢下了「${entry.item.name}」`);
    renderBags();
    updateHUD();
  }

  // ---------- 搜索浮层（官方形态：剪影全见 → 逐件点击鉴定） ----------
  function openSearch(c) {
    const run = Raid.run;
    if (!c.drops) { // 局种子 + 容器坐标 → 掉落与搜索顺序无关，每日图全场确定
      const drng = DFG.mulberry32(DFG.hash32(`df-raid-drop:${run.seed}:${c.cid}:${c.x},${c.y}`));
      c.drops = DFR.rollContainer(drng, c, LOOT);
    }
    const ov = { c, searching: null, auto: false, done: false, cancelled: false, value: 0, staging: [] };
    Raid.overlay = ov;
    run.queue = [];

    $("#rpTitle").innerHTML = `${c.name}<span class="rp-tier">${TIER_NAME[c.tier]} · ${c.w}×${c.h}</span>`;
    $("#rpValue").textContent = "价值【0】";
    $("#rpMsg").textContent = c.drops.length ? "民以食为天，开吃！—— 转得越久越值钱" : "这容器比鼠鼠的脸还干净……";
    $("#rpStaging").innerHTML = "";
    $("#rpClose").classList.remove("hidden");
    $("#rpSkip").classList.add("hidden"); // 开箱即自动逐件搜索，无需手动

    // 官方：开箱即见全部物品剪影（占格形状可见，可预判大件），随后自动逐件鉴定
    const grid = $("#rpGrid");
    grid.style.gridTemplateColumns = `repeat(${c.w}, 44px)`;
    grid.style.gridAutoRows = "44px";
    const occ = DFR.makeGrid(c.w, c.h, 0);
    c.drops.forEach((d) => {
      for (let dy = 0; dy < d.h; dy++) for (let dx = 0; dx < d.w; dx++) occ[d.y + dy][d.x + dx] = 1;
    });
    let html = c.drops.map((d, i) =>
      `<div class="rp-item rp-silhouette" data-i="${i}" title="未鉴定 · 占 ${d.w}×${d.h} 格"
        style="grid-column:${d.x + 1}/span ${d.w};grid-row:${d.y + 1}/span ${d.h}"><span class="rp-unknown">?</span></div>`).join("");
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      if (!occ[y][x]) html += `<div class="rp-empty" style="grid-column:${x + 1};grid-row:${y + 1}"></div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll(".rp-silhouette").forEach((el) =>
      el.addEventListener("click", () => searchItem(ov, Number(el.dataset.i))));
    $("#raidOverlay").classList.remove("hidden");
    if (!c.drops.length) { ov.done = true; return; }
    ov.auto = true; // 交互后直接开始，逐件自动鉴定
    searchAll(ov);
  }

  // 逐件鉴定：放大镜转圈，耗时 ∝ 品质并加随机扰动（官方"转得越久越值钱"，偶有久转出低货）
  function searchItem(ov, i) {
    if (ov.cancelled || ov.searching != null) return;
    const d = ov.c.drops[i];
    if (!d || d.revealed) return;
    const el = $("#rpGrid").querySelector(`.rp-item[data-i="${i}"]`);
    if (!el) return;
    const ms = DFR.REVEAL_SEC[d.item.grade] * 1000 * (0.9 + Math.random() * 0.4);
    ov.searching = i;
    el.classList.add("searching");
    el.style.setProperty("--rd", ms + "ms");
    Sfx.rustleStart();
    const t0 = performance.now();
    const iv = setInterval(() => {
      if (ov.cancelled || Raid.overlay !== ov) { clearInterval(iv); Sfx.rustleStop(); return; }
      if (performance.now() - t0 < ms) return;
      clearInterval(iv);
      Sfx.rustleStop();
      ov.searching = null;
      revealItem(ov, d);
      Sfx.ding(d.item.grade);
      if (ov.auto) setTimeout(() => searchAll(ov), 60);
    }, 40);
  }

  // 「全部搜索」：按顺序自动鉴定剩余货
  function searchAll(ov) {
    if (ov.cancelled || Raid.overlay !== ov) return;
    const i = ov.c.drops.findIndex((d) => !d.revealed);
    if (i < 0) { ov.auto = false; checkAllRevealed(ov); return; }
    searchItem(ov, i);
  }

  function checkAllRevealed(ov) {
    if (ov.cancelled || !ov.c.drops.every((d) => d.revealed)) return;
    ov.done = true;
    ov.auto = false;
    $("#rpSkip").classList.add("hidden");
    $("#rpMsg").textContent = ov.staging.length ? "不够不够，继续吃！—— 点下面的货入包" : "搜完了，一件不剩";
  }

  function revealItem(ov, d) {
    d.revealed = true;
    const i = ov.c.drops.indexOf(d);
    const el = $("#rpGrid").querySelector(`.rp-item[data-i="${i}"]`);
    if (el) {
      el.classList.remove("rp-silhouette", "searching");
      el.classList.add("g" + d.item.grade, "revealed");
      el.title = `${d.item.name} · 价值【${DFR.fmt(d.item.value)}】`;
      el.innerHTML = `${itemImgHTML(d.item)}<div class="bi-name">${d.item.name}</div>`;
    }
    ov.staging.push(d);
    ov.value += d.item.value;
    $("#rpValue").textContent = `价值【${DFR.fmt(ov.value)}】`;
    const panel = $("#raidPanel");
    if (d.item.meme) {
      $("#rpMsg").textContent = DFR.MEME_TEXT;
    } else if (d.item.grade === 6) {
      $("#rpMsg").textContent = DFR.RAID_LINES.red;
      panel.classList.remove("flash-red"); void panel.offsetWidth; panel.classList.add("flash-red");
    } else if (d.item.grade === 5) {
      $("#rpMsg").textContent = DFR.RAID_LINES.gold;
      panel.classList.remove("flash-gold"); void panel.offsetWidth; panel.classList.add("flash-gold");
    }
    renderStaging(ov);
    checkAllRevealed(ov);
  }

  function renderStaging(ov) {
    const run = Raid.run;
    $("#rpStaging").innerHTML = ov.staging.map((d, i) => {
      const it = d.item;
      const canMain = fitsBag(run.bagMain, it);
      const canSafe = fitsBag(run.bagSafe, it);
      return `<div class="rp-stage-item g${it.grade}">
        ${itemImgHTML(it)}
        <span><span class="si-name">${it.name}</span><span class="si-meta">${GRADE_NAME[it.grade]} · ${it.len}×${it.wid} · 价值【${DFR.fmt(it.value)}】· 单格【${DFR.fmt(it.perCell)}】</span></span>
        <span class="si-btns">
          <button class="btn" data-act="main" data-i="${i}" ${canMain ? "" : "disabled"}>入包</button>
          <button class="btn ghost" data-act="safe" data-i="${i}" ${canSafe ? "" : "disabled"}>入箱</button>
        </span>
      </div>`;
    }).join("");
    $("#rpStaging").querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => takeItem(ov, Number(b.dataset.i), b.dataset.act)));
  }

  function takeItem(ov, i, act) {
    const run = Raid.run;
    const d = ov.staging[i];
    if (!d) return;
    const bag = act === "safe" ? run.bagSafe : run.bagMain;
    if (!DFR.addToBag(bag, d.item)) {
      DF_APP.toast(act === "safe" ? "安全箱塞不下这件" : "背包塞不下了，丢点别的或留下它");
      return;
    }
    ov.staging.splice(i, 1);
    d.taken = true;
    const gi = ov.c.drops.indexOf(d);
    const gel = $("#rpGrid").querySelector(`.rp-item[data-i="${gi}"]`);
    if (gel) gel.classList.add("taken");
    Sfx.pickup();
    DF_APP.toast(act === "safe" ? `「${d.item.name}」进安全箱，稳了` : `「${d.item.name}」入包`);
    renderStaging(ov);
    renderBags();
    updateHUD();
  }

  function closeSearch() {
    const ov = Raid.overlay;
    if (!ov) return;
    ov.cancelled = true;
    Sfx.rustleStop();
    const left = ov.c.drops.filter((d) => !d.revealed).length + ov.staging.length;
    if (left) DF_APP.toast(`${left} 件带不走，留给下一只鼠了`);
    const run = Raid.run;
    ov.c.searched = true;
    run.searched++;
    Raid.overlay = null;
    $("#raidOverlay").classList.add("hidden");
    updateHUD();
    onEnterTile();
    // 关浮层瞬间可能被巡逻队盯上
    detect();
  }

  // ---------- 结算 / 元游戏 ----------
  function finish(outcome) {
    const run = Raid.run;
    if (!run || run.status !== "playing") return;
    run.status = outcome;
    run.outcome = outcome;
    run.extracting = 0;
    updateExtractBar();
    if (Raid.overlay) { Raid.overlay.cancelled = true; Raid.overlay = null; $("#raidOverlay").classList.add("hidden"); Sfx.rustleStop(); }

    const mainV = DFR.bagValue(run.bagMain);
    const safeV = DFR.bagValue(run.bagSafe);
    const value = outcome === "extracted" ? mainV + safeV : safeV;
    const kept = (outcome === "extracted" ? run.bagMain.items.concat(run.bagSafe.items) : run.bagSafe.items)
      .map((e) => e.item);

    // 图鉴收集（每日 / 练习都记）
    const coll = DF_APP.loadJSON("df_raid_collection", {});
    kept.forEach((it) => { coll[it.id] = (coll[it.id] || 0) + 1; });
    DF_APP.store.set("df_raid_collection", JSON.stringify(coll));
    // 历史最佳
    const allBest = Math.max(DF_APP.loadJSON("df_raid_best", 0), value);
    DF_APP.store.set("df_raid_best", JSON.stringify(allBest));
    // 每日记录（首页绿点 + 今日最佳）
    if (run.mode === "daily") {
      const key = DF_APP.dkey("raid");
      const rec = DF_APP.loadJSON(key, { plays: 0, best: 0, status: null });
      rec.plays++;
      rec.best = Math.max(rec.best, value);
      rec.status = outcome === "extracted" ? "won" : "lost";
      DF_APP.store.set(key, JSON.stringify(rec));
    }
    // 关卡记录（每关历史最佳）
    if (run.mode === "levels") {
      const best = DF_APP.loadJSON("df_raid_level_best", {});
      const id = DFR.LEVELS[run.level].id;
      best[id] = Math.max(best[id] || 0, value);
      DF_APP.store.set("df_raid_level_best", JSON.stringify(best));
    }

    renderResult(outcome, value, mainV, safeV, kept);
    renderCollection();
  }

  function renderResult(outcome, value, mainV, safeV, kept) {
    const run = Raid.run;
    const grade = DFR.raidGrade(value);
    const titles = {
      extracted: "🐭 肥肥撤离！",
      caught: "💀 " + DFR.RAID_LINES.caught,
      lost: "⏱ " + DFR.RAID_LINES.lost,
    };
    const bestItem = kept.slice().sort((a, b) => b.value - a.value)[0];
    const dailyRec = run.mode === "daily" ? DF_APP.loadJSON(DF_APP.dkey("raid"), null) : null;
    const metaParts = [`搜刮 ${run.searched}/${run.containers.length} 容器`];
    if (outcome === "extracted") metaParts.push(`背包【${DFR.fmt(mainV)}】+ 安全箱【${DFR.fmt(safeV)}】`);
    else metaParts.push(`安全箱保住【${DFR.fmt(safeV)}】` + (mainV ? `，背包【${DFR.fmt(mainV)}】喂了猛攻队` : ""));
    if (bestItem) metaParts.push(`最肥一件：${bestItem.name}`);
    const hasNext = run.mode === "levels" && outcome === "extracted" && run.level < DFR.LEVELS.length - 1;
    $("#raidResult").innerHTML = `
      <h2>${titles[outcome]}</h2>
      <p class="r-meta">${metaParts.join(" · ")}</p>
      <p class="r-grade">带出价值【${DFR.fmt(value)}】· 评级 <b>${grade.g}</b> · ${grade.name}</p>
      <p class="r-meta">${dailyRec ? `今日最佳【${DFR.fmt(dailyRec.best)}】 · ` : ""}历史最佳【${DFR.fmt(DF_APP.loadJSON("df_raid_best", 0))}】</p>
      <div class="btn-row">
        <button class="btn" id="raidShareBtn">复制分享卡</button>
        <button class="btn ghost" id="raidAgainBtn">再来一局（${run.mode === "daily" ? "今日同图" : run.mode === "levels" ? "本关同图" : "随机新图"} · 不限次）</button>
        ${hasNext ? `<button class="btn" id="raidNextBtn">下一关：${DFR.LEVELS[run.level + 1].name} →</button>` : ""}
      </div>`;
    $("#raidResult").classList.remove("hidden");
    $("#raidShareBtn").onclick = () => DF_APP.copyText(DFR.buildRaidShare({
      date: DF_APP.TODAY, practice: run.mode === "practice", outcome, value,
      searched: run.searched, total: run.containers.length,
      bestItemName: bestItem ? bestItem.name : null,
      mapName: run.mode === "levels" ? DFR.LEVELS[run.level].name : null,
    }));
    $("#raidAgainBtn").onclick = () => {
      Raid.run = newRun(Raid.mode);
      renderAll();
    };
    if (hasNext) $("#raidNextBtn").onclick = () => {
      Raid.level++;
      Raid.run = null;
      render();
    };
    setTip("本局结束 —— " + (outcome === "extracted" ? "肥肥撤离，下把更肥" : "鼠鼠落泪，下把再来"));
  }

  function renderCollection() {
    const coll = DF_APP.loadJSON("df_raid_collection", {});
    const entries = Object.entries(coll)
      .map(([id, n]) => ({ item: LOOT.items.find((i) => String(i.id) === id), n }))
      .filter((e) => e.item)
      .sort((a, b) => b.item.grade - a.item.grade || b.item.value - a.item.value);
    $("#raidCollection").innerHTML = `
      <p class="raid-coll-summary">已收集 <b>${entries.length}</b> / ${LOOT.items.length} 种 · 历史最佳【${DFR.fmt(DF_APP.loadJSON("df_raid_best", 0))}】</p>
      <div class="raid-coll-grid">${entries.map((e) => `
        <div class="raid-coll-item g${e.item.grade}" title="${e.item.name} · 价值【${DFR.fmt(e.item.value)}】">
          ${itemImgHTML(e.item)}
          <div class="ci-name">${e.item.name}</div>
          <div class="ci-count">×${e.n} · 单格${DFR.fmt(e.item.perCell)}</div>
        </div>`).join("") || '<p class="raid-coll-summary">还没吃到过东西，去摸一把吧</p>'}
      </div>`;
  }

  // ---------- 渲染入口 ----------
  function renderLevels() {
    const el = $("#raidLevels");
    el.classList.toggle("hidden", Raid.mode !== "levels");
    if (Raid.mode !== "levels") return;
    const best = DF_APP.loadJSON("df_raid_level_best", {});
    const CN = ["一", "二", "三", "四"];
    el.innerHTML = DFR.LEVELS.map((lv, i) => `
      <button class="raid-level${i === Raid.level ? " active" : ""}" data-i="${i}">
        <b>第${CN[i]}关 · ${lv.name}</b>
        <span>${lv.desc}</span>
        <span class="rl-best">${best[lv.id] ? "最佳【" + DFR.fmt(best[lv.id]) + "】" : "——"}</span>
      </button>`).join("");
    el.querySelectorAll(".raid-level").forEach((b) =>
      b.addEventListener("click", () => { Raid.level = Number(b.dataset.i); Raid.run = null; render(); }));
  }

  function renderAll() {
    const run = Raid.run;
    const cv = canvas();
    cv.width = run.map.w * TS;
    cv.height = run.map.h * TS;
    $("#raidBanner").innerHTML = run.mode === "daily"
      ? `今日地图 <b>#${DF_APP.TODAY}</b> · 全站同图同掉落 · 倒计时 ${run.map.cfg.seconds} 秒`
      : run.mode === "levels"
        ? `第 ${run.level + 1} 关 · <b>${DFR.LEVELS[run.level].name}</b> · ${DFR.LEVELS[run.level].desc} · 固定地图 · 倒计时 ${run.map.cfg.seconds} 秒`
        : `练习模式 · 随机地图（${run.practiceName}规格）· 倒计时 ${run.map.cfg.seconds} 秒 · 不计入每日成绩`;
    $("#raidStory").textContent = run.story;
    $("#raidResult").classList.add("hidden");
    $("#raidExtractBar").classList.add("hidden");
    updateHUD();
    renderBags();
    onEnterTile();
    renderCollection();
    renderLevels();
  }

  function render() {
    if (!Raid.run || Raid.run.mode !== Raid.mode ||
        (Raid.mode === "levels" && Raid.run.level !== Raid.level)) Raid.run = newRun(Raid.mode);
    renderAll();
    loopStart();
  }

  function setMode(mode) {
    Raid.mode = mode;
    Raid.run = null;
    // 同步 tab 高亮（app.js 的 syncModeTabs 也可调用，这里自理）
    document.querySelectorAll('.mode-tabs[data-game="raid"] .mode-tab').forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === mode));
    render();
  }

  function onRoute(view) {
    Raid.active = view === "raid";
    if (!Raid.active) loopStop();
  }

  window.DFR_UI = { render, setMode, onRoute, getMode: () => Raid.mode };

  // ---------- 启动 ----------
  bindInput();
  $("#rpSkip").addEventListener("click", () => { if (Raid.overlay) { Raid.overlay.auto = true; searchAll(Raid.overlay); } });
  $("#rpClose").addEventListener("click", closeSearch);
  if (location.hash === "#/raid") { Raid.active = true; render(); }
})();
