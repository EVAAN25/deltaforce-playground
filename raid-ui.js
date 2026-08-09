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
  const IS_COARSE = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  const TIP_DEFAULT = IS_COARSE
    ? "摇杆 / 点格子移动 · 点容器开吃 · 右下「交互」开搜与撤离 · 「背包」整理"
    : "WASD / 方向键移动 · 点击格子自动寻路 · 走到容器旁按 <b>F</b>（或点容器）开吃 · 站到撤离点按 <b>F</b> 引导撤离 · <b>Tab</b> 整理背包";

  // ---------- 图片兜底：品质色块 + 物品名首字 ----------
  window.__dfRaidImg = function (img) {
    const div = document.createElement("div");
    div.className = "rit-fb g" + (img.dataset.grade || 1);
    div.textContent = (img.dataset.name || "物")[0];
    img.replaceWith(div);
  };
  function itemImgHTML(item) {
    return `<img loading="lazy" draggable="false" src="${item.img}" alt="${item.name}" data-name="${item.name}" data-grade="${item.grade}" onerror="window.__dfRaidImg(this)">`;
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
    // 红档用加长版V3的前半段（reveal-red-v3-half.mp3，5.6s 带淡出）；完整版 v3 与旧版 reveal-red.mp3 均保留
    const REVEAL_SRC = {
      1: "assets/sfx/reveal-low.mp3", 2: "assets/sfx/reveal-low.mp3", 3: "assets/sfx/reveal-low.mp3",
      4: "assets/sfx/reveal-purple.mp3", 5: "assets/sfx/reveal-gold.mp3", 6: "assets/sfx/reveal-red-v3-half.mp3",
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
    // 撤离成功放歌：按评级给不同情感（WebAudio 合成旋律 + 低音伴奏）
    function fanfare(g) {
      const c = ac(); if (!c) return;
      const t0 = c.currentTime + 0.03;
      const N = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
      // notes = [[midi, 拍数]...]，midi=0 为休止；返回结束时刻
      function seq(notes, type, vol, tStart, beat) {
        let t = tStart;
        for (const [m, b] of notes) {
          if (m) blip(N(m), t, b * beat * 0.92, type, vol);
          t += b * beat;
        }
        return t;
      }
      if (g === "SS" || g === "S") { // 吃撑了：凯旋进行曲（C 大调主旋律 + 低音 + 结尾高音琶音）
        const beat = 0.155;
        const tEnd = seq([
          [72, 1], [76, 1], [79, 1], [84, 2], [79, 1], [84, 2],
          [86, 1], [84, 1], [79, 1], [81, 3], [79, 1], [84, 4],
        ], "sine", 0.2, t0, beat);
        seq([[48, 2], [55, 2], [48, 2], [55, 2], [53, 2], [57, 2], [55, 4]], "triangle", 0.11, t0, beat * 2);
        [[84, 0.5], [88, 0.5], [91, 0.5], [96, 2]].forEach(([m, b], i) => blip(N(m), tEnd + i * 0.09, b * beat, "sine", 0.15));
      } else if (g === "A" || g === "B") { // 吃得还行：轻快上扬短歌
        const beat = 0.15;
        seq([[72, 1], [76, 1], [79, 1], [84, 2], [81, 1], [79, 1], [76, 1], [79, 3]], "sine", 0.18, t0, beat);
        seq([[48, 2], [55, 2], [53, 2], [55, 4]], "triangle", 0.1, t0, beat * 2);
      } else { // 白跑一趟：平淡三音，有点丧但活着回来了
        seq([[72, 1], [76, 1], [79, 2]], "sine", 0.15, t0, 0.16);
      }
    }
    // 被抓：刺耳下行 + 低频重击
    function sting() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      blip(220, t, 0.16, "sawtooth", 0.2);
      blip(155.6, t + 0.14, 0.4, "sawtooth", 0.2);
      blip(82.4, t + 0.3, 0.5, "sine", 0.24);
    }
    // 迷失：阴郁下行三音
    function lost() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      blip(440, t, 0.16, "sine", 0.15); blip(349.2, t + 0.18, 0.16, "sine", 0.14); blip(261.6, t + 0.36, 0.45, "sine", 0.13);
    }
    // 撤离结算 BGM（鼠鼠梗曲《寂寞的人伤心的歌》，按评级分档）
    let bgm = null;
    function bgmStop() {
      if (!bgm) return;
      try { bgm.pause(); } catch (e) { /* 已停 */ }
      bgm = null;
    }
    function bgmPlay(src) {
      bgmStop();
      const a = new Audio(src);
      a.volume = 0.75;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      bgm = a;
    }
    return { rustleStart, rustleStop, ding, pickup, fanfare, sting, lost, bgmPlay, bgmStop };
  })();

  // ---------- 撤离撒花（纯 DOM，无外部库） ----------
  function confettiBurst(gradeG) {
    const n = gradeG === "SS" ? 170 : gradeG === "S" ? 130 : gradeG === "A" ? 85 : gradeG === "B" ? 55 : 30;
    const colors = ["#e0a83c", "#cf4b3a", "#5fae63", "#a06ee0", "#e08a3c", "#f0d78a"];
    const layer = document.createElement("div");
    layer.className = "confetti-layer";
    for (let i = 0; i < n; i++) {
      const pc = document.createElement("i");
      pc.className = "confetti-pc";
      const size = 5 + Math.random() * 7;
      pc.style.left = Math.random() * 100 + "vw";
      pc.style.width = size + "px";
      pc.style.height = size * (0.45 + Math.random()) + "px";
      pc.style.background = colors[(Math.random() * colors.length) | 0];
      pc.style.setProperty("--cfd", (2.4 + Math.random() * 1.8) + "s");
      pc.style.setProperty("--cfdl", (Math.random() * 0.9) + "s");
      pc.style.setProperty("--cfsw", (Math.random() * 160 - 80) + "px");
      pc.style.setProperty("--cfr", (360 + Math.random() * 720) + "deg");
      layer.appendChild(pc);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 6000);
  }

  // ---------- 状态 ----------
  const Raid = { mode: "daily", level: 0, run: null, active: false, overlay: null, bagOpen: false, keys: {}, hover: null, pointer: null, tickTimer: null, rafId: 0 };

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
      extracting: 0, searched: 0,
      story: DFR.RAID_LINES.intro[Math.floor(introRng() * DFR.RAID_LINES.intro.length)],
    };
  }

  // ---------- 地图绘制 ----------
  const canvas = () => $("#raidCanvas");
  const TIER_COLOR = { 6: "#e0a83c", 5: "#a06ee0", 1: "#6d8048" };

  function containerLeftover(c) { // 容器里还剩几件没拿走（含未鉴定）
    return c.drops ? c.drops.filter((d) => !d.taken).length : 0;
  }

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
      if (c.searched) { // 摸过的容器：名称不变，整体变暗
        ctx.fillStyle = "#23272f";
        ctx.fillRect(cx + 2, cy + 2, TS - 4, TS - 4);
        ctx.strokeStyle = "#3a4150";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx + 2.5, cy + 2.5, TS - 5, TS - 5);
        ctx.fillStyle = "#5a6272";
        ctx.fillText(c.name[0], cx + TS / 2, cy + TS / 2 + 1);
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
    if (!run || run.status !== "playing" || Raid.overlay || Raid.bagOpen) return;
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
        if (run.extracting) { run.extracting = 0; updateExtractBar(); } // 移动取消引导
        onEnterTile();
        detect();
        // 点容器寻路到位后自动开搜（摸过的容器也能再开）
        if (!run.queue.length && run.autoSearch) {
          const c = run.autoSearch;
          run.autoSearch = null;
          if (Math.abs(c.x - run.px) + Math.abs(c.y - run.py) === 1 && run.status === "playing") openSearch(c);
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
    if (onExtract) setTip(`到撤离点了！按 <b>F</b> 开始引导（${run.map.cfg.extractMs / 1000} 秒，期间不能走动，被看见＝被抓）`);
    else if (adj) {
      if (!adj.searched) setTip(`旁边是「${adj.name}」（${TIER_NAME[adj.tier]}），按 <b>F</b> 开吃`);
      else {
        const left = containerLeftover(adj);
        setTip(left ? `「${adj.name}」摸过了，里面还剩 ${left} 件，按 <b>F</b> 接着拿` : `「${adj.name}」早被拿空了`);
      }
    }
    else setTip(TIP_DEFAULT);
    // 触屏「交互」按钮文案跟随场景
    const fbtn = $("#raidBtnF");
    if (fbtn) fbtn.textContent = onExtract ? "撤 离" : adj ? (adj.searched ? "再 翻" : "开 吃") : "交 互";
  }

  function adjacentContainer() {
    const run = Raid.run;
    return run.containers.find((c) =>
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
      } else if (k === "f") {
        e.preventDefault();
        if (!hoverAct()) interact(); // 光标在物品上时 F = 放入/移出，否则 = 场景交互
      } else if (k === "escape" || k === "tab") {
        e.preventDefault();
        if (k === "escape" && Raid.overlay) { closeSearch(); return; } // ESC 先关搜索
        toggleBag(); // Tab 开关背包；搜索浮层开着时不动
      }
    });
    window.addEventListener("keyup", (e) => {
      const k = KEYMAP[e.key.toLowerCase()];
      if (k) Raid.keys[k] = false;
    });
    canvas().addEventListener("pointerdown", (e) => {
      if (!Raid.active || !Raid.run || Raid.run.status !== "playing" || Raid.overlay || Raid.bagOpen) return;
      const run = Raid.run;
      const rect = canvas().getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / rect.width * run.map.w);
      const y = Math.floor((e.clientY - rect.top) / rect.height * run.map.h);
      if (x < 0 || y < 0 || x >= run.map.w || y >= run.map.h) return;
      // 点相邻的容器 = 直接开搜（摸过的也能再翻）
      const c = run.containers.find((cc) => cc.x === x && cc.y === y);
      if (c && Math.abs(c.x - run.px) + Math.abs(c.y - run.py) === 1) { openSearch(c); return; }
      // 点远处的容器 = 寻路到它旁边，到位自动开搜
      if (c) {
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
    if (!run || run.status !== "playing" || Raid.overlay || Raid.bagOpen) return;
    const onExtract = run.map.extracts.some((e) => e.x === run.px && e.y === run.py);
    if (onExtract) {
      if (!run.extracting) {
        run.extracting = performance.now();
        run.queue = [];
        updateExtractBar();
        DF_APP.toast("撤离引导开始，别动！");
      }
      return;
    }
    const c = adjacentContainer();
    if (c) openSearch(c);
  }

  // 触屏操控条显隐：浮层（搜索/背包）打开时收起，避免挡住面板底部按钮
  function syncOvClass() {
    document.body.classList.toggle("ov-open", !!(Raid.overlay || Raid.bagOpen));
  }

  // ---------- 背包浮层（Tab/ESC 开关；开着时局内暂停，与搜索浮层互斥） ----------
  function toggleBag() {
    if (Raid.overlay || !Raid.run || Raid.run.status !== "playing") return;
    Raid.bagOpen = !Raid.bagOpen;
    $("#bagOverlay").classList.toggle("hidden", !Raid.bagOpen);
    if (Raid.bagOpen) renderBags();
    syncOvClass();
  }

  function closeBag() {
    if (!Raid.bagOpen) return;
    Raid.bagOpen = false;
    $("#bagOverlay").classList.add("hidden");
    syncOvClass();
  }

  function checkExtract(now) {
    const run = Raid.run;
    if (now - run.extracting >= run.map.cfg.extractMs) finish("extracted");
  }

  function updateExtractBar() {
    const run = Raid.run;
    const bar = $("#raidExtractBar");
    if (!run || !run.extracting) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    const pct = Math.min(100, (performance.now() - run.extracting) / run.map.cfg.extractMs * 100);
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

  function fitsBagSmart(bag, item) { // 不改变 bag 的智能试装（含自动整理重排）
    const clone = { w: bag.w, h: bag.h, occ: bag.occ.map((r) => r.slice()), items: bag.items.slice() };
    return DFR.addToBagSmart(clone, item) !== 0;
  }

  // 背包渲染：主页两个 + 背包浮层两个 + 搜索浮层里两个（同一数据，六处同步）
  const BAG_GRIDS = { bagMain: ["#raidBagMain", "#bagOvMain", "#rpBagMain"], bagSafe: ["#raidBagSafe", "#bagOvSafe", "#rpBagSafe"] };
  function renderBags() {
    const run = Raid.run;
    if (!run) return;
    const cs = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--bagcell"), 10) || 44;
    for (const which of ["bagMain", "bagSafe"]) {
      for (const sel of BAG_GRIDS[which]) {
        const el = $(sel);
        if (!el) continue;
        el.innerHTML = run[which].items.map((e) => bagItemAt(e, cs)).join("");
        el.querySelectorAll(".bag-item").forEach((itemEl, i) => {
          itemEl.addEventListener("dblclick", () => onBagDbl(which, i));
          bindDrag(itemEl, { kind: "bag", which, idx: i });
          itemEl.addEventListener("pointerenter", () => { Raid.hover = { kind: "bag", which, idx: i }; });
          itemEl.addEventListener("pointerleave", () => {
            const h = Raid.hover;
            if (h && h.kind === "bag" && h.which === which && h.idx === i) Raid.hover = null;
          });
        });
      }
    }
    syncHoverFromPointer(); // 元素换新后按光标位置重建悬停
    $("#bagOvValue").textContent = `价值【${DFR.fmt(DFR.bagValue(run.bagMain) + DFR.bagValue(run.bagSafe))}】`;
  }
  function bagItemAt(entry, cs) {
    const it = entry.item;
    const hint = Raid.overlay ? "双击/按F 放回容器 · 拖拽挪位（贴边自动横竖）· 拖出面板丢弃" : "拖拽挪位（贴边自动横竖）· 拖出去丢弃";
    return `<div class="bag-item g${it.grade}" title="${it.name} · 价值【${DFR.fmt(it.value)}】· 单格【${DFR.fmt(it.perCell)}】· ${hint}"
      style="left:${entry.x * cs}px;top:${entry.y * cs}px;width:${entry.w * cs}px;height:${entry.h * cs}px">
      ${itemImgHTML(it)}
      <div class="bi-name">${it.name}</div>
      ${entry.w * entry.h > 1 ? `<div class="bi-val">${DFR.fmt(it.perCell)}/格</div>` : ""}
    </div>`;
  }

  // 双击包内物品：只在搜索浮层里 = 放回当前容器；丢弃没有快捷方式，只能拖出面板
  function onBagDbl(which, idx) {
    if (Raid.overlay && !Raid.overlay.cancelled) returnToContainer(which, idx);
  }

  function discard(which, idx) {
    const run = Raid.run;
    if (!run || run.status !== "playing") return;
    const bag = run[which];
    const entry = bag.items[idx];
    if (!entry) return;
    DFR.removeFromBag(bag, idx);
    renderBags();
    updateHUD();
  }

  // 悬停按 F：待拾取/容器格子 = 入包；包内 = 放回容器（无浮层 = 丢弃）。处理了返回 true
  function hoverAct() {
    const h = Raid.hover;
    const run = Raid.run;
    if (!h || !run || run.status !== "playing") return false;
    const ov = Raid.overlay;
    if (h.kind === "stage") {
      if (!ov || ov.cancelled) return false;
      autoTake(ov, h.i);
      return true;
    }
    if (h.kind === "grid") {
      if (!ov || ov.cancelled) return false;
      const si = stagedDrops(ov.c).indexOf(ov.c.drops[h.i]);
      if (si < 0) return false;
      autoTake(ov, si);
      return true;
    }
    if (h.kind === "bag") {
      if (ov && !ov.cancelled) returnToContainer(h.which, h.idx); // 搜索中按 F = 放回容器
      // 丢弃没有快捷键，只能拖出面板——其余情况按 F 不动
      return true;
    }
    return false;
  }

  // 重渲染后按当前光标位置重建悬停（元素被换掉/就地更新时 pointerenter 不会重发）
  function syncHoverFromPointer() {
    Raid.hover = null;
    const p = Raid.pointer;
    if (!p || !Raid.run) return;
    const el = document.elementFromPoint(p.x, p.y);
    if (!el) return;
    const row = el.closest(".rp-stage-item");
    if (row && !el.closest("button")) {
      const i = [...document.querySelectorAll("#rpStaging .rp-stage-item")].indexOf(row);
      if (i >= 0) { Raid.hover = { kind: "stage", i }; return; }
    }
    const gi = el.closest(".rp-item.revealed:not(.taken)");
    if (gi) { Raid.hover = { kind: "grid", i: Number(gi.dataset.i) }; return; }
    const bi = el.closest(".bag-item");
    if (bi) {
      const grid = bi.closest(".bag-grid");
      const which = (grid.id === "rpBagSafe" || grid.id === "raidBagSafe") ? "bagSafe" : "bagMain";
      const idx = [...grid.querySelectorAll(".bag-item")].indexOf(bi);
      if (idx >= 0) Raid.hover = { kind: "bag", which, idx };
    }
  }

  // 包 ↔ 包 挪动（拖拽落点在另一个背包上）
  function moveBag(fromWhich, idx, toWhich) {
    const run = Raid.run;
    if (!run || run.status !== "playing") return;
    const entry = run[fromWhich].items[idx];
    if (!entry) return;
    if (!fitsBagSmart(run[toWhich], entry.item)) {
      DF_APP.toast(toWhich === "bagSafe" ? "安全箱塞不下这件" : "主背包塞不下这件");
      return;
    }
    DFR.removeFromBag(run[fromWhich], idx);
    DFR.addToBagSmart(run[toWhich], entry.item);
    Sfx.pickup();
    DF_APP.toast(`「${entry.item.name}」挪到${toWhich === "bagSafe" ? "安全箱" : "主背包"}`);
    renderBags();
    updateHUD();
  }

  // ---------- 拖拽（pointer 实现，桌面 / 触屏通用；位移超阈值才算拖，兼容点击与双击） ----------
  const Drag = { cur: null };

  function dragItem(payload) {
    const run = Raid.run;
    if (!run) return null;
    if (payload.kind === "stage") {
      const ov = Raid.overlay;
      if (!ov || ov.cancelled) return null;
      const staged = ov.c.drops.filter((d) => d.revealed && !d.taken);
      const d = staged[payload.i];
      return d ? d.item : null;
    }
    if (payload.kind === "grid") { // 容器格子里已搜出的物品
      const ov = Raid.overlay;
      if (!ov || ov.cancelled) return null;
      const d = ov.c.drops[payload.i];
      return d && d.revealed && !d.taken ? d.item : null;
    }
    const entry = run[payload.which].items[payload.idx];
    return entry ? entry.item : null;
  }

  function bindDrag(el, payload) {
    el.addEventListener("pointerdown", (e) => dragPress(payload, el, e));
  }

  function dragPress(payload, el, e) {
    if (e.button != null && e.button !== 0) return;
    if (Raid.run && Raid.run.status !== "playing") return;
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    const move = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
        started = dragBegin(payload, el, ev);
        if (!started) { cleanup(); return; }
      }
      dragMove(ev);
    };
    const up = (ev) => {
      cleanup();
      if (started) dragEnd(ev);
    };
    const cancel = () => { // 原生拖拽/系统手势打断：只收场，不落点
      cleanup();
      if (started) dragAbort();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }

  function dragAbort() {
    const d = Drag.cur;
    Drag.cur = null;
    if (!d) return;
    d.ghost.remove();
    d.srcEl.classList.remove("drag-src");
    if (d.target && d.target.el) d.target.el.classList.remove("drop-ok", "drop-bad");
  }

  function dragBegin(payload, srcEl, e) {
    if (!dragItem(payload)) return false;
    const ghost = srcEl.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.style.width = srcEl.offsetWidth + "px";
    ghost.style.height = srcEl.offsetHeight + "px";
    document.body.appendChild(ghost);
    srcEl.classList.add("drag-src");
    Drag.cur = { payload, ghost, srcEl, target: null, rot: false, x: e.clientX, y: e.clientY };
    dragMove(e);
    return true;
  }

  // 拖动中横竖切换：幽灵同步换形（自动触发，见 dragTargetAt）
  function setDragRot(d, rot) {
    if (d.rot === rot) return;
    d.rot = rot;
    const w = d.ghost.style.width;
    d.ghost.style.width = d.ghost.style.height;
    d.ghost.style.height = w;
    d.ghost.classList.toggle("rot", rot);
  }

  function dragTargetAt(payload, x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const grid = el.closest(".bag-grid");
    if (grid) {
      const which = (grid.id === "rpBagSafe" || grid.id === "raidBagSafe") ? "bagSafe" : "bagMain";
      const item = dragItem(payload);
      if (payload.kind === "bag" && payload.which === which) { // 同包：按落点格子挪位
        const cs = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--bagcell"), 10) || 44;
        const r = grid.getBoundingClientRect();
        const cx = Math.floor((x - r.left) / cs), cy = Math.floor((y - r.top) / cs);
        // 自动横竖：当前朝向放不下、换个朝向能放，就自动转过去（两者皆可时保持原朝向）
        const cur = Drag.cur ? Drag.cur.rot : false;
        let rot = cur, ok = DFR.canPlaceAt(Raid.run[which], payload.idx, cx, cy, cur);
        if (!ok && DFR.canPlaceAt(Raid.run[which], payload.idx, cx, cy, !cur)) { rot = !cur; ok = true; }
        if (Drag.cur) setDragRot(Drag.cur, rot);
        return { type: "repos", which, el: grid, cx, cy, rot, ok };
      }
      return { type: "bag", which, el: grid, ok: !!item && fitsBagSmart(Raid.run[which], item) };
    }
    // 包内物品拖回容器（仅搜索浮层开着时）
    if (payload.kind === "bag" && Raid.overlay && !Raid.overlay.cancelled) {
      const st = el.closest("#rpStaging") || el.closest(".rp-grid-wrap");
      if (st) return { type: "container", el: st, ok: true };
    }
    return null;
  }

  function dragMove(e) {
    const d = Drag.cur;
    if (!d) return;
    d.x = e.clientX; d.y = e.clientY;
    d.ghost.style.left = e.clientX + "px";
    d.ghost.style.top = e.clientY + "px";
    const t = dragTargetAt(d.payload, e.clientX, e.clientY);
    if (d.target && d.target.el && d.target.el !== (t && t.el)) d.target.el.classList.remove("drop-ok", "drop-bad");
    d.target = t;
    if (t) {
      t.el.classList.remove("drop-ok", "drop-bad");
      t.el.classList.add(t.ok ? "drop-ok" : "drop-bad");
    }
  }

  function dragEnd(e) {
    const d = Drag.cur;
    if (!d) return;
    const t = dragTargetAt(d.payload, e.clientX, e.clientY); // 先算落点（含旋转态）再收场
    Drag.cur = null;
    d.ghost.remove();
    d.srcEl.classList.remove("drag-src");
    if (d.target && d.target.el) d.target.el.classList.remove("drop-ok", "drop-bad");
    if (t && t.el) t.el.classList.remove("drop-ok", "drop-bad");
    if (!t) { // 空白落点：仅「拖出整个面板外」才丢弃包内物品；面板内空白 = 不动
      if (d.payload.kind === "bag" && dropOutsidePanel(e)) discard(d.payload.which, d.payload.idx);
      return;
    }
    if (!t.ok) return;
    if (t.type === "repos") { // 同包挪位（含自动横竖）
      if (DFR.placeAt(Raid.run[t.which], d.payload.idx, t.cx, t.cy, t.rot)) { Sfx.pickup(); renderBags(); }
      return;
    }
    if (t.type === "bag") {
      const act = t.which === "bagSafe" ? "safe" : "main";
      if (d.payload.kind === "stage") takeItem(Raid.overlay, d.payload.i, act);
      else if (d.payload.kind === "grid") { // 容器格子直接拖入包
        const si = stagedDrops(Raid.overlay.c).indexOf(Raid.overlay.c.drops[d.payload.i]);
        if (si >= 0) takeItem(Raid.overlay, si, act);
      }
      else moveBag(d.payload.which, d.payload.idx, t.which);
    } else if (t.type === "container") {
      returnToContainer(d.payload.which, d.payload.idx);
    }
  }

  // 丢弃判定：浮层开着时须拖出整个面板外才算空白；主页上拖到背包外即算
  function dropOutsidePanel(e) {
    const ov = Raid.overlay;
    if (!ov || ov.cancelled) {
      if (!Raid.bagOpen) return true;
      const r = $("#bagPanel").getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    }
    const r = $("#raidPanel").getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  }

  // ---------- 搜索浮层（官方形态：剪影全见 → 逐件点击鉴定；摸过的容器可反复翻） ----------
  function stagedDrops(c) { return c.drops.filter((d) => d.revealed && !d.taken); }

  function openSearch(c) {
    const run = Raid.run;
    if (!c.drops) { // 首开现场随机：内容与布局每局每箱只 roll 一次，之后整局不变
      c.drops = DFR.rollContainer(Math.random, c, LOOT);
    }
    const ov = { c, searching: null, auto: false, done: false, cancelled: false, value: 0 };
    Raid.overlay = ov;
    syncOvClass();
    run.queue = [];

    $("#rpTitle").innerHTML = `${c.name}<span class="rp-tier">${TIER_NAME[c.tier]} · ${c.w}×${c.h}</span>`;
    $("#rpClose").classList.remove("hidden");
    $("#rpSkip").classList.add("hidden"); // 开箱即自动逐件搜索，无需手动

    renderGridItems(ov);
    renderStaging(ov); // 同步价值计数与待拾取区（含重开时的遗留货）
    $("#raidOverlay").classList.remove("hidden");

    const pending = c.drops.filter((d) => !d.revealed).length;
    if (!c.drops.length) {
      ov.done = true;
      $("#rpMsg").textContent = "这容器比鼠鼠的脸还干净……";
    } else if (pending) {
      $("#rpMsg").textContent = c.searched ? "上次没摸完，接着鉴定……" : "民以食为天，开吃！—— 转得越久越值钱";
      ov.auto = true; // 交互后直接开始，逐件自动鉴定
      searchAll(ov);
    } else {
      ov.done = true;
      const left = stagedDrops(c).length;
      $("#rpMsg").textContent = left ? `都鉴定过了，还剩 ${left} 件在箱里，要拿就拿` : "早被拿空了，一件不剩";
    }
  }

  // 容器格子：剪影（未鉴定）/ 已揭晓 / 已拿走 三态渲染
  function renderGridItems(ov) {
    const c = ov.c;
    const grid = $("#rpGrid");
    const cs = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--rpcell"), 10) || 44;
    grid.style.gridTemplateColumns = `repeat(${c.w}, ${cs}px)`;
    grid.style.gridAutoRows = cs + "px";
    const occ = DFR.makeGrid(c.w, c.h, 0);
    c.drops.forEach((d) => {
      for (let dy = 0; dy < d.h; dy++) for (let dx = 0; dx < d.w; dx++) occ[d.y + dy][d.x + dx] = 1;
    });
    let html = c.drops.map((d, i) => {
      const pos = `grid-column:${d.x + 1}/span ${d.w};grid-row:${d.y + 1}/span ${d.h}`;
      if (!d.revealed) {
        return `<div class="rp-item rp-silhouette" data-i="${i}" title="未鉴定 · 占 ${d.w}×${d.h} 格" style="${pos}"><span class="rp-unknown">?</span></div>`;
      }
      return `<div class="rp-item revealed g${d.item.grade}${d.taken ? " taken" : ""}" data-i="${i}"
        title="${d.item.name} · 价值【${DFR.fmt(d.item.value)}】${d.taken ? "（已入包）" : " · 双击/按F/拖拽入包"}" style="${pos}">
        ${itemImgHTML(d.item)}<div class="bi-name">${d.item.name}</div></div>`;
    }).join("");
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      if (!occ[y][x]) html += `<div class="rp-empty" style="grid-column:${x + 1};grid-row:${y + 1}"></div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll(".rp-silhouette").forEach((el) =>
      el.addEventListener("click", () => searchItem(ov, Number(el.dataset.i))));
    // 已揭晓未拿走的格子：悬停按 F / 直接拖进背包
    grid.querySelectorAll(".rp-item.revealed:not(.taken)").forEach((el) =>
      bindGridItem(el, Number(el.dataset.i)));
    syncHoverFromPointer(); // 元素换新后按光标位置重建悬停
  }

  // 容器格子交互（悬停按 F / 双击 / 拖拽入包）；revealItem 就地揭晓的格子也要补绑
  function bindGridItem(el, i) {
    el.addEventListener("pointerenter", () => { Raid.hover = { kind: "grid", i }; });
    el.addEventListener("pointerleave", () => {
      const h = Raid.hover;
      if (h && h.kind === "grid" && h.i === i) Raid.hover = null;
    });
    el.addEventListener("pointerdown", (e) => dragPress({ kind: "grid", i }, el, e));
    el.addEventListener("dblclick", () => {
      const ov = Raid.overlay;
      if (!ov || ov.cancelled) return;
      const si = stagedDrops(ov.c).indexOf(ov.c.drops[i]);
      if (si >= 0) autoTake(ov, si);
    });
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
    $("#rpMsg").textContent = stagedDrops(ov.c).length ? "不够不够，继续吃！—— 双击 / 拖拽入包" : "搜完了，一件不剩";
  }

  function revealItem(ov, d) {
    d.revealed = true;
    const i = ov.c.drops.indexOf(d);
    const el = $("#rpGrid").querySelector(`.rp-item[data-i="${i}"]`);
    if (el) {
      el.classList.remove("rp-silhouette", "searching");
      el.classList.add("g" + d.item.grade, "revealed");
      el.title = `${d.item.name} · 价值【${DFR.fmt(d.item.value)}】· 双击/按F/拖拽入包`;
      el.innerHTML = `${itemImgHTML(d.item)}<div class="bi-name">${d.item.name}</div>`;
      bindGridItem(el, i); // 就地揭晓的格子补绑交互（否则首开时按 F/拖拽不生效）
    }
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

  // 待拾取区：已鉴定未拿走的货（双击 / 悬停按F / 拖拽入包，按钮兜底）
  function renderStaging(ov) {
    const run = Raid.run;
    const staged = stagedDrops(ov.c);
    ov.value = ov.c.drops.filter((d) => d.revealed).reduce((s, d) => s + d.item.value, 0);
    $("#rpValue").textContent = `价值【${DFR.fmt(ov.value)}】`;
    $("#rpStaging").innerHTML = staged.map((d, i) => {
      const it = d.item;
      const canMain = fitsBagSmart(run.bagMain, it);
      const canSafe = fitsBagSmart(run.bagSafe, it);
      return `<div class="rp-stage-item g${it.grade}" title="双击/按F 放入背包 · 可拖拽">
        ${itemImgHTML(it)}
        <span><span class="si-name">${it.name}</span><span class="si-meta">${GRADE_NAME[it.grade]} · ${it.len}×${it.wid} · 价值【${DFR.fmt(it.value)}】· 单格【${DFR.fmt(it.perCell)}】</span></span>
        <span class="si-btns">
          <button class="btn" data-act="main" data-i="${i}" ${canMain ? "" : "disabled"}>入包</button>
          <button class="btn ghost" data-act="safe" data-i="${i}" ${canSafe ? "" : "disabled"}>入箱</button>
        </span>
      </div>`;
    }).join("");
    $("#rpStaging").querySelectorAll(".rp-stage-item").forEach((el, i) => {
      el.addEventListener("dblclick", (e) => {
        if (e.target.closest("button")) return;
        autoTake(ov, i);
      });
      el.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button")) return; // 按钮不触发拖拽
        dragPress({ kind: "stage", i }, el, e);
      });
      // 悬停按 F 只在物品本体上生效（移到按钮区即失效）
      el.addEventListener("pointerover", (e) => {
        if (e.target.closest("button")) {
          const h = Raid.hover;
          if (h && h.kind === "stage" && h.i === i) Raid.hover = null;
          return;
        }
        Raid.hover = { kind: "stage", i };
      });
      el.addEventListener("pointerleave", () => {
        const h = Raid.hover;
        if (h && h.kind === "stage" && h.i === i) Raid.hover = null;
      });
    });
    $("#rpStaging").querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => takeItem(ov, Number(b.dataset.i), b.dataset.act)));
    syncHoverFromPointer(); // 元素换新后按光标位置重建悬停
  }

  function takeItem(ov, i, act) {
    const run = Raid.run;
    const d = stagedDrops(ov.c)[i];
    if (!d) return;
    const bag = act === "safe" ? run.bagSafe : run.bagMain;
    const res = DFR.addToBagSmart(bag, d.item);
    if (!res) {
      DF_APP.toast(act === "safe" ? "安全箱塞不下这件" : "背包塞不下了，丢点别的或留下它");
      return;
    }
    d.taken = true;
    const gi = ov.c.drops.indexOf(d);
    const gel = $("#rpGrid").querySelector(`.rp-item[data-i="${gi}"]`);
    if (gel) gel.classList.add("taken");
    Sfx.pickup();
    DF_APP.toast(res === 2
      ? `背包自动整理后塞下了「${d.item.name}」`
      : act === "safe" ? `「${d.item.name}」进安全箱，稳了` : `「${d.item.name}」入包`);
    renderStaging(ov);
    renderBags();
    updateHUD();
  }

  // 双击入包：主背包优先，塞不下试安全箱（都走智能整理）
  function autoTake(ov, i) {
    const run = Raid.run;
    const d = stagedDrops(ov.c)[i];
    if (!d) return;
    if (fitsBagSmart(run.bagMain, d.item)) takeItem(ov, i, "main");
    else if (fitsBagSmart(run.bagSafe, d.item)) takeItem(ov, i, "safe");
    else DF_APP.toast("背包和安全箱都塞不下了，先腾点地方");
  }

  // 包内物品放回当前容器（重新装箱进格子，之后随时可再拿）
  function returnToContainer(which, idx) {
    const run = Raid.run;
    const ov = Raid.overlay;
    if (!run || !ov || ov.cancelled || run.status !== "playing") return;
    const entry = run[which].items[idx];
    if (!entry) return;
    const c = ov.c;
    const occ = DFR.makeGrid(c.w, c.h, 0);
    c.drops.forEach((d) => {
      if (d.taken) return;
      for (let dy = 0; dy < d.h; dy++) for (let dx = 0; dx < d.w; dx++) occ[d.y + dy][d.x + dx] = 1;
    });
    const pos = DFR.packFirstFit(occ, c.w, c.h, entry.item.len, entry.item.wid, true);
    if (!pos) { DF_APP.toast("容器里没空位放回去了"); return; }
    DFR.removeFromBag(run[which], idx);
    c.drops.push({ item: entry.item, x: pos.x, y: pos.y, w: pos.w, h: pos.h, revealed: true, taken: false });
    Sfx.pickup();
    DF_APP.toast(`「${entry.item.name}」放回「${c.name}」`);
    renderGridItems(ov);
    renderStaging(ov);
    renderBags();
    updateHUD();
  }

  function closeSearch() {
    const ov = Raid.overlay;
    if (!ov) return;
    ov.cancelled = true;
    Sfx.rustleStop();
    const left = containerLeftover(ov.c);
    const run = Raid.run;
    if (!ov.c.searched) { ov.c.searched = true; run.searched++; } // 只首次计入"摸过"
    Raid.overlay = null;
    $("#raidOverlay").classList.add("hidden");
    syncOvClass();
    if (left) DF_APP.toast(`${left} 件留在「${ov.c.name}」里了，随时可以回来拿`);
    updateHUD();
    onEnterTile();
    // 关浮层瞬间可能被巡逻队盯上
    detect();
  }

  // ---------- 撤离庆祝卡（按评级三档：表情包 + 分档 BGM + 引导） ----------
  const CELEB_TIERS = [
    { img: "assets/meme/full.jpg", text: "鼠鼠吃成球了！！！", bgm: "assets/sfx/extract-fat.mp3" },  // SS/S 吃撑
    { img: "assets/meme/ok.jpg", text: "鼠鼠来啰，小有收获～", bgm: "assets/sfx/extract-ok.mp3" },   // A/B 还行
    { img: "assets/meme/poor.jpg", text: "我钱呢……鼠鼠白跑一趟", bgm: null },                        // C 白跑（合成短音）
  ];
  let celebTimer = 0;

  function celebTierOf(gradeG) { return (gradeG === "SS" || gradeG === "S") ? 0 : (gradeG === "A" || gradeG === "B") ? 1 : 2; }

  function showCelebration(run, grade, value) {
    const t = CELEB_TIERS[celebTierOf(grade.g)];
    $("#celebImg").src = t.img;
    const g = $("#celebGrade");
    g.textContent = `${grade.g} · ${grade.name}`;
    g.className = "celeb-grade" + (grade.g === "C" ? " gC" : "");
    $("#celebText").textContent = `${t.text} —— 带出【${DFR.fmt(value)}】`;
    const hasNext = run.mode === "levels" && run.level < DFR.LEVELS.length - 1;
    const btns = [];
    if (run.mode === "daily") btns.push(`<button class="btn" id="celebGoLevels">去闯关 · 关卡模式 →</button>`);
    if (hasNext) btns.push(`<button class="btn" id="celebNext">下一关：${DFR.LEVELS[run.level + 1].name} →</button>`);
    btns.push(`<button class="btn ghost" id="celebOk">收下喜悦</button>`);
    $("#celebBtns").innerHTML = btns.join("");
    $("#celebOk").onclick = hideCelebration;
    if (run.mode === "daily") $("#celebGoLevels").onclick = () => { hideCelebration(); setMode("levels"); };
    if (hasNext) $("#celebNext").onclick = () => {
      hideCelebration();
      Raid.level++;
      Raid.run = null;
      render();
    };
    $("#raidCeleb").classList.remove("hidden");
    clearTimeout(celebTimer);
    celebTimer = setTimeout(hideCelebration, 15000); // 15s 没点自己收
  }

  function hideCelebration() {
    clearTimeout(celebTimer);
    $("#raidCeleb").classList.add("hidden");
  }

  // ---------- 结算 / 元游戏 ----------
  function finish(outcome) {
    const run = Raid.run;
    if (!run || run.status !== "playing") return;
    run.status = outcome;
    run.outcome = outcome;
    run.extracting = 0;
    Sfx.bgmStop();
    hideCelebration();
    updateExtractBar();
    if (Raid.overlay) { Raid.overlay.cancelled = true; Raid.overlay = null; $("#raidOverlay").classList.add("hidden"); Sfx.rustleStop(); }
    closeBag();
    syncOvClass();

    const mainV = DFR.bagValue(run.bagMain);
    const safeV = DFR.bagValue(run.bagSafe);
    const value = outcome === "extracted" ? mainV + safeV : safeV;
    const kept = (outcome === "extracted" ? run.bagMain.items.concat(run.bagSafe.items) : run.bagSafe.items)
      .map((e) => e.item);

    // 结局音效与画面反馈
    if (outcome === "extracted") {
      const g = DFR.raidGrade(value).g;
      const tier = celebTierOf(g);
      if (CELEB_TIERS[tier].bgm) Sfx.bgmPlay(CELEB_TIERS[tier].bgm); // 吃肥放鼠鼠梗曲
      else Sfx.fanfare(g); // 白跑：平淡合成短音
      confettiBurst(g);    // 撒花：评级越高越多
      showCelebration(run, DFR.raidGrade(value), value);
    } else if (outcome === "caught") {
      Sfx.sting();
      const st = document.querySelector(".raid-stage");
      if (st) { st.classList.remove("death"); void st.offsetWidth; st.classList.add("death"); }
    } else Sfx.lost();

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
    const guideLevels = run.mode === "daily" && outcome === "extracted"; // 通关每日一图 → 引导关卡模式
    $("#raidResult").innerHTML = `
      <h2>${titles[outcome]}</h2>
      <p class="r-meta">${metaParts.join(" · ")}</p>
      <p class="r-grade">带出价值【${DFR.fmt(value)}】· 评级 <b>${grade.g}</b> · ${grade.name}</p>
      <p class="r-meta">${dailyRec ? `今日最佳【${DFR.fmt(dailyRec.best)}】 · ` : ""}历史最佳【${DFR.fmt(DF_APP.loadJSON("df_raid_best", 0))}】</p>
      ${guideLevels ? `<p class="r-guide">每日一图已通关 🎉 关卡模式有四张更大的图（零号大坝 → 航天基地），红更多、巡逻更凶，敢不敢去？</p>` : ""}
      <div class="btn-row">
        <button class="btn" id="raidShareBtn">复制分享卡</button>
        <button class="btn ghost" id="raidAgainBtn">再来一局（${run.mode === "daily" ? "今日同图" : run.mode === "levels" ? "本关同图" : "随机新图"} · 不限次）</button>
        ${guideLevels ? `<button class="btn" id="raidGoLevelsBtn">去闯关 · 关卡模式 →</button>` : ""}
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
      Sfx.bgmStop();
      Raid.run = newRun(Raid.mode);
      renderAll();
    };
    if (guideLevels) $("#raidGoLevelsBtn").onclick = () => setMode("levels");
    if (hasNext) $("#raidNextBtn").onclick = () => {
      Sfx.bgmStop();
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
    // 顶部新手引导（按设备给对应操作口径）
    $("#raidHowto").innerHTML = IS_COARSE
      ? "🐭 三步吃肥：<b>①</b> 跑图找发光容器，点它开箱搜货（越亮越值钱）<b>②</b> 躲开红圈巡逻队 <b>③</b> 走到绿色撤离点，点「交互」引导撤离。摇杆移动 · 交互开搜/撤离 · 背包整理。<b>被抓掉光主背包，安全箱永远保住！</b>"
      : "🐭 三步吃肥：<b>①</b> 跑图找发光容器，开箱搜货（转得越久越值钱）<b>②</b> 躲开红圈巡逻队 <b>③</b> 站撤离点按 <b>F</b> 引导撤离。WASD / 点格子移动 · F 开搜/撤离 · Tab 背包。<b>被抓掉光主背包，安全箱永远保住！</b>";
    $("#raidBanner").innerHTML = run.mode === "daily"
      ? `今日地图 <b>#${DF_APP.TODAY}</b> · 全站同图 · 掉落看脸 · 倒计时 ${run.map.cfg.seconds} 秒`
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
    Sfx.bgmStop();
    hideCelebration();
    // 同步 tab 高亮（app.js 的 syncModeTabs 也可调用，这里自理）
    document.querySelectorAll('.mode-tabs[data-game="raid"] .mode-tab').forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === mode));
    render();
  }

  function onRoute(view) {
    Raid.active = view === "raid";
    if (!Raid.active) { loopStop(); Sfx.bgmStop(); hideCelebration(); }
  }

  window.DFR_UI = { render, setMode, onRoute, getMode: () => Raid.mode, _raid: Raid }; // _raid 供自动化自测

  // ---------- 触屏操控（摇杆 + 交互/背包按钮；仅触屏设备显示，绑定无妨） ----------
  function bindTouchUI() {
    const joy = $("#raidJoy"), knob = $("#raidJoyKnob");
    const R = 30; // 摇杆最大偏半径
    let pid = null;
    const clampR = (dx, dy) => {
      const m = Math.hypot(dx, dy);
      return m > R ? [dx / m * R, dy / m * R] : [dx, dy];
    };
    const setDir = (dx, dy) => {
      const k = Raid.keys;
      k.up = k.down = k.left = k.right = false;
      if (Math.hypot(dx, dy) < 10) return; // 死区
      if (Math.abs(dx) > Math.abs(dy)) k[dx > 0 ? "right" : "left"] = true;
      else k[dy > 0 ? "down" : "up"] = true;
    };
    const moveKnob = (dx, dy) => { knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; };
    const vec = (e) => {
      const r = joy.getBoundingClientRect();
      return clampR(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    };
    joy.addEventListener("pointerdown", (e) => {
      if (!Raid.active || !Raid.run || Raid.run.status !== "playing" || Raid.overlay || Raid.bagOpen) return;
      pid = e.pointerId;
      joy.setPointerCapture(pid);
      joy.classList.add("active");
      Raid.run.queue = []; Raid.run.autoSearch = null; // 摇杆接管，清寻路
      const [dx, dy] = vec(e);
      setDir(dx, dy); moveKnob(dx, dy);
      e.preventDefault();
    });
    joy.addEventListener("pointermove", (e) => {
      if (pid !== e.pointerId) return;
      const [dx, dy] = vec(e);
      setDir(dx, dy); moveKnob(dx, dy);
    });
    const end = (e) => {
      if (pid !== e.pointerId) return;
      pid = null;
      joy.classList.remove("active");
      const k = Raid.keys;
      k.up = k.down = k.left = k.right = false;
      moveKnob(0, 0);
    };
    joy.addEventListener("pointerup", end);
    joy.addEventListener("pointercancel", end);
    $("#raidBtnF").addEventListener("click", () => {
      if (!Raid.run || Raid.run.status !== "playing") return;
      if (!hoverAct()) interact(); // 与键盘 F 同一逻辑
    });
    $("#raidBtnBag").addEventListener("click", () => toggleBag());
  }

  // ---------- 启动 ----------
  bindInput();
  bindTouchUI();
  window.addEventListener("pointermove", (e) => { Raid.pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
  // 物品行的 img 默认可拖，会触发浏览器原生 HTML5 拖拽打断 pointer 流——全局拦掉
  document.addEventListener("dragstart", (e) => {
    if (e.target.closest && e.target.closest(".rp-stage-item, .bag-item, .rp-item")) e.preventDefault();
  });
  $("#rpSkip").addEventListener("click", () => { if (Raid.overlay) { Raid.overlay.auto = true; searchAll(Raid.overlay); } });
  $("#rpClose").addEventListener("click", closeSearch);
  $("#bagOverlay").addEventListener("click", (e) => { if (e.target.id === "bagOverlay") closeBag(); }); // 点背板关闭
  $("#bagOvClose").addEventListener("click", closeBag);
  $("#raidCeleb").addEventListener("click", (e) => { if (e.target.id === "raidCeleb") hideCelebration(); }); // 点背板收卡
  if (location.hash === "#/raid") { Raid.active = true; render(); }
})();
