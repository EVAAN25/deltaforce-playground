/*
 * 鼠鼠摸金 —— 纯逻辑层（UMD：浏览器挂 window.DFR，node 可 require）
 * 不依赖 DOM；依赖 game.js 的 DFG（hash32 / mulberry32 / shuffle）与 data/loot.js 的数据（由调用方传入）
 * 物品价值为三角洲数据帝真实交易行价（见 data/loot.js meta）；品质权重为同人自设玩法数值，非官方概率；
 * 容器产出池（哪些容器能出哪些类别/品质上限）按小涛查开容器模拟器采样校准（2026-08-10，见 tools/build_loot.js 容器表）。
 * 未定价物品（value 为 null）不进掉落池（rollContainer 已过滤）。
 */
(function (root, factory) {
  const isNode = typeof module !== "undefined" && module.exports;
  const DFG = isNode ? require("./game.js") : root.DFG;
  const DFR = factory(DFG);
  if (isNode) module.exports = DFR;
  else root.DFR = DFR;
})(typeof self !== "undefined" ? self : this, function (DFG) {
  "use strict";

  // ---------- 常量 ----------
  const MAP_W = 24;
  const MAP_H = 16;
  const RAID_SECONDS = 240;      // 局内倒计时
  const EXTRACT_MS = 5000;       // 撤离引导时长
  const PATROL_STEP_MS = 550;    // 巡逻队走一格的间隔（UI 用）
  const PLAYER_STEP_MS = 140;    // 玩家走一格的间隔（UI 用）

  // 单格揭晓耗时（秒），照抄小涛查节奏
  const REVEAL_SEC = { 1: 0.5, 2: 0.7, 3: 0.8, 4: 0.8, 5: 1.5, 6: 2.3 };
  const BIG_CELLS = 6;           // cells >= 6 的大件揭晓前多停一拍
  const BIG_PAUSE_MS = 700;

  const MEME_TEXT = "座钟？？谁把送终的玩意儿塞这了";

  /*
   * 关卡配置（图名用官方烽火地带地图名）。cfg 字段：
   * w/h 地图格数 · seconds 倒计时 · extractMs 撤离引导 · obs 障碍块数区间
   * tiers 必出高价值容器 tier 列表（不足 total 的用 tier1 补齐）
   * total 容器总数区间 · patrols 巡逻队数区间 · radius 视野半径区间
   */
  const LEVELS = [
    { id: "dam", name: "零号大坝·外围", desc: "教学关：图小巡逻少，时间宽裕",
      cfg: { w: 20, h: 13, seconds: 300, extractMs: 4000, obs: [5, 8], tiers: [6, 5, 5], total: [8, 10], patrols: [1, 2], radius: [3, 3] } },
    { id: "valley", name: "长弓溪谷", desc: "标准局：经典尺寸，两队巡逻",
      cfg: { w: MAP_W, h: MAP_H, seconds: RAID_SECONDS, extractMs: EXTRACT_MS, obs: [8, 12], tiers: [6, 6, 5, 5, 5, 5], total: [10, 14], patrols: [2, 3], radius: [3, 4] } },
    { id: "brakkesh", name: "巴克什", desc: "大图多巡逻，高价值容器更多",
      cfg: { w: 28, h: 18, seconds: 300, extractMs: 6000, obs: [10, 15], tiers: [6, 6, 5, 5, 5, 5, 5], total: [13, 16], patrols: [3, 4], radius: [3, 4] } },
    { id: "space", name: "航天基地", desc: "最大图、重兵把守、引导最久",
      cfg: { w: 32, h: 20, seconds: 330, extractMs: 7000, obs: [14, 20], tiers: [6, 6, 6, 5, 5, 5, 5, 5], total: [15, 19], patrols: [4, 5], radius: [3, 4] } },
  ];
  const DEFAULT_CFG = LEVELS[1].cfg;

  // 评级：按带出价值分档
  const RAID_GRADES = [
    { min: 2000000, g: "SS", name: "鼠王登神" },
    { min: 800000, g: "S", name: "肥肥撤离" },
    { min: 200000, g: "A", name: "吃得满嘴流油" },
    { min: 50000, g: "B", name: "勉强回了本" },
    { min: 0, g: "C", name: "白跑一趟" },
  ];

  // 鼠鼠人格文案
  const RAID_LINES = {
    intro: [
      "月黑风高夜，鼠鼠进货时。",
      "民以食为天，开吃！",
      "悄咪咪摸进去，香喷喷扛出来。",
    ],
    caught: "你被猛攻队一脚踢死了！主背包撒了一地，只保住了安全箱……",
    lost: "倒计时归零，鼠鼠迷失在了禁区里……",
    extracted: "肥肥撤离！这波不亏，下波更肥。",
    gold: "出金了！！",
    red: "大红！！鼠鼠我呀，要发财了！",
  };

  function raidGrade(value) {
    for (const t of RAID_GRADES) if (value >= t.min) return { g: t.g, name: t.name };
    return RAID_GRADES[RAID_GRADES.length - 1];
  }

  // 千分位
  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  // 每日一图种子：本地日期 → 整数种子
  function dailySeed(date) { return DFG.hash32("df-raid:" + date); }

  // ---------- 网格工具 ----------

  function makeGrid(w, h, fill) {
    const g = [];
    for (let y = 0; y < h; y++) { const row = []; for (let x = 0; x < w; x++) row.push(fill); g.push(row); }
    return g;
  }

  // BFS 可达集（isBlocked(x,y) 返回 true 表示不可走），返回 Set<"x,y">
  function bfsReachable(isBlocked, w, h, from) {
    const seen = new Set([from.x + "," + from.y]);
    const q = [from];
    while (q.length) {
      const c = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx, ny = c.y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = nx + "," + ny;
        if (seen.has(k) || isBlocked(nx, ny)) continue;
        seen.add(k);
        q.push({ x: nx, y: ny });
      }
    }
    return seen;
  }

  // BFS 寻路：返回含起终点的路径数组，不可达返回 null
  function findPath(isBlocked, w, h, from, to) {
    if (from.x === to.x && from.y === to.y) return [{ x: from.x, y: from.y }];
    if (isBlocked(to.x, to.y)) return null;
    const prev = new Map();
    const seen = new Set([from.x + "," + from.y]);
    const q = [from];
    while (q.length) {
      const c = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx, ny = c.y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = nx + "," + ny;
        if (seen.has(k) || isBlocked(nx, ny)) continue;
        seen.add(k);
        prev.set(k, c);
        if (nx === to.x && ny === to.y) {
          const path = [{ x: nx, y: ny }];
          let p = c;
          while (p) { path.unshift({ x: p.x, y: p.y }); p = prev.get(p.x + "," + p.y) || null; }
          return path;
        }
        q.push({ x: nx, y: ny });
      }
    }
    return null;
  }

  // Bresenham 视线：中间的格子都不能是遮挡（端点不查）
  function losClear(isSolid, x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    while (!(x === x1 && y === y1)) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) break;
      if (isSolid(x, y)) return false;
    }
    return true;
  }

  // ---------- 地图生成 ----------

  /*
   * 生成一局地图（布局由 cfg 决定尺寸与难度）：边界墙 + 内部障碍块 + 出生点（左端）
   * + 2 个撤离点（右端上下）+ 容器（cfg.tiers 必出，tier1 补齐）+ cfg.patrols 条巡逻往返路径。
   * 返回 null 表示本次随机布局不可用（调用方换种子重试）。
   */
  function tryGenMap(rng, loot, cfg) {
    cfg = cfg || DEFAULT_CFG;
    const W = cfg.w, H = cfg.h;
    const tiles = makeGrid(W, H, 0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) tiles[y][x] = 1;
    }
    // 内部障碍块
    const nObs = cfg.obs[0] + Math.floor(rng() * (cfg.obs[1] - cfg.obs[0] + 1));
    for (let i = 0; i < nObs; i++) {
      const ow = 1 + Math.floor(rng() * 3), oh = 1 + Math.floor(rng() * 2);
      const ox = 1 + Math.floor(rng() * (W - 2 - ow)), oy = 1 + Math.floor(rng() * (H - 2 - oh));
      for (let y = oy; y < oy + oh; y++) for (let x = ox; x < ox + ow; x++) tiles[y][x] = 1;
    }
    const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && tiles[y][x] === 0;

    // 出生点：左端
    let spawn = null;
    for (let g = 0; g < 200 && !spawn; g++) {
      const y = 2 + Math.floor(rng() * (H - 4));
      if (free(1, y)) spawn = { x: 1, y };
    }
    if (!spawn) return null;

    // 撤离点：右端上下各一
    const extracts = [];
    const eyA = 1 + Math.floor(rng() * (Math.floor(H / 2) - 1));
    const eyB = Math.floor(H / 2) + Math.floor(rng() * (H - 2 - Math.floor(H / 2)));
    for (const ey of [eyA, eyB]) {
      let placed = null;
      for (let y = ey; y < H - 1 && !placed; y++) if (free(W - 2, y)) placed = { x: W - 2, y };
      for (let y = ey - 1; y >= 1 && !placed; y--) if (free(W - 2, y)) placed = { x: W - 2, y };
      if (!placed) return null;
      extracts.push(placed);
    }
    if (extracts[0].x === extracts[1].x && extracts[0].y === extracts[1].y) return null;

    // 容器：cfg.tiers 必出 + 其余 tier1，总数在 cfg.total 区间内
    const byTier = { 1: [], 5: [], 6: [] };
    loot.containers.forEach((c) => { if (byTier[c.tier]) byTier[c.tier].push(c); });
    const tierList = cfg.tiers.slice();
    let total = cfg.total[0] + Math.floor(rng() * (cfg.total[1] - cfg.total[0] + 1));
    total = Math.max(total, tierList.length);
    while (tierList.length < total) tierList.push(1);
    DFG.shuffle(tierList, rng);

    const containers = [];
    const taken = new Set([spawn.x + "," + spawn.y]);
    extracts.forEach((e) => taken.add(e.x + "," + e.y));
    const nearContainer = (x, y) => containers.some((c) => Math.abs(c.x - x) <= 1 && Math.abs(c.y - y) <= 1);
    const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    for (const tier of tierList) {
      const defs = byTier[tier];
      if (!defs.length) return null;
      const def = defs[Math.floor(rng() * defs.length)];
      let spot = null;
      for (let g = 0; g < 300 && !spot; g++) {
        const x = 1 + Math.floor(rng() * (W - 2)), y = 1 + Math.floor(rng() * (H - 2));
        if (!free(x, y) || taken.has(x + "," + y) || nearContainer(x, y)) continue;
        if (manhattan({ x, y }, spawn) < 4) continue;
        if (extracts.some((e) => manhattan({ x, y }, e) < 2)) continue;
        // 至少有一个相邻可站格子（用于搜索）
        if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => free(x + dx, y + dy))) continue;
        spot = { x, y };
      }
      if (!spot) return null;
      taken.add(spot.x + "," + spot.y);
      containers.push({ cid: def.id, name: def.name, tier: def.tier, w: def.w, h: def.h, types: def.types, maxGrade: def.maxGrade, x: spot.x, y: spot.y });
    }

    const containerAt = new Set(containers.map((c) => c.x + "," + c.y));
    const walkable = (x, y) => free(x, y) && !containerAt.has(x + "," + y);

    // 巡逻队：cfg.patrols 条直线往返路径
    const patrols = [];
    const nPatrol = cfg.patrols[0] + Math.floor(rng() * (cfg.patrols[1] - cfg.patrols[0] + 1));
    for (let p = 0; p < nPatrol; p++) {
      let path = null;
      for (let g = 0; g < 300 && !path; g++) {
        const x = 1 + Math.floor(rng() * (W - 2)), y = 1 + Math.floor(rng() * (H - 2));
        if (!walkable(x, y) || manhattan({ x, y }, spawn) < 6) continue;
        const horiz = rng() < 0.5;
        const seg = [{ x, y }];
        for (const s of [1, -1]) {
          let cx = x, cy = y;
          for (let k = 0; k < 6; k++) {
            const nx = cx + (horiz ? s : 0), ny = cy + (horiz ? 0 : s);
            if (!walkable(nx, ny)) break;
            if (s > 0) seg.push({ x: nx, y: ny }); else seg.unshift({ x: nx, y: ny });
            cx = nx; cy = ny;
          }
        }
        // 巡逻路线必须离撤离点 >=3 格，否则撤离引导永远被压，没法撤离
        if (seg.length >= 4 && seg.every((t) => extracts.every((e) => manhattan(t, e) >= 3))) path = seg;
      }
      if (!path) return null;
      const radius = cfg.radius[0] + (cfg.radius[1] > cfg.radius[0] && rng() < 0.4 ? cfg.radius[1] - cfg.radius[0] : 0);
      patrols.push({ path, radius });
    }

    return { w: W, h: H, tiles, spawn, extracts, containers, patrols, cfg };
  }

  // 连通性验证：出生点可达所有撤离点，且每个容器都有可达的相邻站位
  function validateMap(map) {
    const containerAt = new Set(map.containers.map((c) => c.x + "," + c.y));
    const isBlocked = (x, y) => map.tiles[y][x] === 1 || containerAt.has(x + "," + y);
    const reach = bfsReachable(isBlocked, map.w, map.h, map.spawn);
    for (const e of map.extracts) if (!reach.has(e.x + "," + e.y)) return false;
    for (const c of map.containers) {
      const ok = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .some(([dx, dy]) => reach.has((c.x + dx) + "," + (c.y + dy)));
      if (!ok) return false;
    }
    for (const p of map.patrols) {
      for (const t of p.path) if (isBlocked(t.x, t.y)) return false;
    }
    return true;
  }

  // 生成入口：同种子必然同图；布局不合法时种子递增重试；cfg 缺省 = 长弓溪谷（标准局）
  function generateRaid(seed, loot, cfg) {
    cfg = cfg || DEFAULT_CFG;
    for (let attempt = 0; attempt < 300; attempt++) {
      const rng = DFG.mulberry32((seed + attempt * 7919) >>> 0);
      const map = tryGenMap(rng, loot, cfg);
      if (map && validateMap(map)) { map.seed = seed; map.attempt = attempt; return map; }
    }
    throw new Error("generateRaid: 300 次重试仍无合法地图");
  }

  // 巡逻队视线遮挡：墙与容器挡视线
  function makeSolidFn(map) {
    const containerAt = new Set(map.containers.map((c) => c.x + "," + c.y));
    return (x, y) => map.tiles[y][x] === 1 || containerAt.has(x + "," + y);
  }

  // ---------- 掉落 roll ----------

  function fitsPossible(item, w, h) {
    return (item.len <= w && item.wid <= h) || (item.wid <= w && item.len <= h);
  }

  function weightedGrade(weights, rng) {
    let sum = 0;
    for (const g of [1, 2, 3, 4, 5, 6]) sum += weights[g] || 0;
    let r = rng() * sum;
    for (const g of [1, 2, 3, 4, 5, 6]) { r -= weights[g] || 0; if (r <= 0) return g; }
    return 6;
  }

  /*
   * first-fit 装箱：在 gw×gh 的占用表 occ 里为 iw×ih 的物品找位（可旋转），
   * 找到即占用并返回 {x,y,w,h}，放不下返回 null。扫描顺序固定，结果确定。
   */
  function packFirstFit(occ, gw, gh, iw, ih, rotate) {
    const dims = (rotate && iw !== ih) ? [[iw, ih], [ih, iw]] : [[iw, ih]];
    for (const [w, h] of dims) {
      if (w > gw || h > gh) continue;
      for (let y = 0; y + h <= gh; y++) {
        for (let x = 0; x + w <= gw; x++) {
          let ok = true;
          for (let dy = 0; dy < h && ok; dy++) for (let dx = 0; dx < w; dx++) {
            if (occ[y + dy][x + dx]) { ok = false; break; }
          }
          if (ok) {
            for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) occ[y + dy][x + dx] = 1;
            return { x, y, w, h };
          }
        }
      }
    }
    return null;
  }

  /*
   * 开容器现场 roll 掉落：件数 ≈ w*h/3 ± 抖动（至少 1、不超过格数）；
   * 每件先按容器 tier 的品质权重 roll 品质，再从该品质能放进容器、且属于该容器
   * 产出池（cont.types 物品类别约束、cont.maxGrade 品质上限，2026-08-10 起按小涛查
   * 模拟器采样校准，见 tools/build_loot.js 容器表注释）的物品池等概 roll；
   * 无适配物品的品质会从权重里剔除后重归一（不再空 roll）。
   * 返回已装箱的 [{item, x, y, w, h}]（摆不下的会放弃该件，保证至少 1 件）。
   */
  function rollContainer(rng, cont, loot) {
    const cells = cont.w * cont.h;
    let count = Math.round(cells / 3) + (Math.floor(rng() * 5) - 2);
    count = Math.max(1, Math.min(cells, count));
    const weights = loot.dropWeights[cont.tier];
    const inPool = (it) =>
      it.value != null &&
      fitsPossible(it, cont.w, cont.h) &&
      (!cont.types || cont.types.includes(it.type)) &&
      (!cont.maxGrade || it.grade <= cont.maxGrade);
    // 按品质预分池，并重归一权重（池为空的品质不再占用权重）
    const pools = {};
    const effWeights = {};
    for (const g of [1, 2, 3, 4, 5, 6]) {
      if (cont.maxGrade && g > cont.maxGrade) continue;
      const pool = loot.items.filter((it) => it.grade === g && inPool(it));
      if (pool.length && (weights[g] || 0) > 0) { pools[g] = pool; effWeights[g] = weights[g]; }
    }
    const occ = makeGrid(cont.w, cont.h, 0);
    const placed = [];
    let guard = 0;
    while (placed.length < count && guard++ < 200) {
      const grade = weightedGrade(effWeights, rng);
      const pool = pools[grade];
      if (!pool || !pool.length) continue;
      // 同品质重试 3 次：大件摆不下会稀释高品质占比，多抽几件同品质的再放弃
      for (let t = 0; t < 3; t++) {
        const item = pool[Math.floor(rng() * pool.length)];
        const pos = packFirstFit(occ, cont.w, cont.h, item.len, item.wid, true);
        if (pos) { placed.push({ item, x: pos.x, y: pos.y, w: pos.w, h: pos.h }); break; }
      }
    }
    if (!placed.length) { // 极端保底：塞一件池内 1 格货（池空才退回全物品）
      let pool = loot.items.filter((it) => it.cells === 1 && inPool(it));
      if (!pool.length) pool = loot.items.filter((it) => it.cells === 1 && it.value != null);
      const item = pool[Math.floor(rng() * pool.length)];
      const pos = packFirstFit(occ, cont.w, cont.h, item.len, item.wid, true);
      if (pos) placed.push({ item, x: pos.x, y: pos.y, w: pos.w, h: pos.h });
    }
    return placed;
  }

  // ---------- 背包 ----------

  function makeBag(w, h) { return { w, h, occ: makeGrid(w, h, 0), items: [] }; }

  // first-fit 入包；成功返回 true
  function addToBag(bag, item) {
    const pos = packFirstFit(bag.occ, bag.w, bag.h, item.len, item.wid, true);
    if (!pos) return false;
    bag.items.push({ item, x: pos.x, y: pos.y, w: pos.w, h: pos.h });
    return true;
  }

  // 丢弃背包中第 idx 件
  function removeFromBag(bag, idx) {
    const it = bag.items[idx];
    if (!it) return;
    for (let dy = 0; dy < it.h; dy++) for (let dx = 0; dx < it.w; dx++) bag.occ[it.y + dy][it.x + dx] = 0;
    bag.items.splice(idx, 1);
  }

  function bagValue(bag) { return bag.items.reduce((s, it) => s + it.item.value, 0); }

  /*
   * 智能入包：先 first-fit 直放；放不下则把全包物品连新件一起重排（大件优先，两种排序各试一次），
   * 重排成功则应用新布局。返回 0=放不下 / 1=直接放入 / 2=整理后放入。
   */
  function addToBagSmart(bag, item) {
    if (addToBag(bag, item)) return 1;
    const all = bag.items.map((e) => e.item).concat([item]);
    const orders = [
      (a, b) => b.len * b.wid - a.len * a.wid,                       // 面积大的先放
      (a, b) => Math.max(b.len, b.wid) - Math.max(a.len, a.wid),     // 最长边大的先放
    ];
    for (const ord of orders) {
      const sorted = all.slice().sort(ord);
      const occ = makeGrid(bag.w, bag.h, 0);
      const placed = [];
      let ok = true;
      for (const it of sorted) {
        const pos = packFirstFit(occ, bag.w, bag.h, it.len, it.wid, true);
        if (!pos) { ok = false; break; }
        placed.push({ item: it, x: pos.x, y: pos.y, w: pos.w, h: pos.h });
      }
      if (ok) { bag.occ = occ; bag.items = placed; return 2; }
    }
    return 0;
  }

  // 能否把包内第 idx 件挪到以 (x,y) 为左上角的格子（不改变 bag；自身原位视为空；rot=true 按横竖互换后的形状判定）
  function canPlaceAt(bag, idx, x, y, rot) {
    const it = bag.items[idx];
    if (!it) return false;
    const w = rot ? it.h : it.w, h = rot ? it.w : it.h;
    if (x < 0 || y < 0 || x + w > bag.w || y + h > bag.h) return false;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const cx = x + dx, cy = y + dy;
      const self = cx >= it.x && cx < it.x + it.w && cy >= it.y && cy < it.y + it.h;
      if (!self && bag.occ[cy][cx]) return false;
    }
    return true;
  }

  // 把包内第 idx 件挪到 (x,y)（rot=true 同时横竖互换）；成功返回 true，失败不动包
  function placeAt(bag, idx, x, y, rot) {
    if (!canPlaceAt(bag, idx, x, y, rot)) return false;
    const it = bag.items[idx];
    for (let dy = 0; dy < it.h; dy++) for (let dx = 0; dx < it.w; dx++) bag.occ[it.y + dy][it.x + dx] = 0;
    if (rot) { const t = it.w; it.w = it.h; it.h = t; }
    for (let dy = 0; dy < it.h; dy++) for (let dx = 0; dx < it.w; dx++) bag.occ[y + dy][x + dx] = 1;
    it.x = x; it.y = y;
    return true;
  }

  // 占某格的物品下标，空格返回 -1
  function itemIndexAt(bag, x, y) {
    for (let i = 0; i < bag.items.length; i++) {
      const e = bag.items[i];
      if (x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h) return i;
    }
    return -1;
  }

  /*
   * 拖拽落位带互换：能放就放（"moved"）；放不下且目标区只压着 1 件别的物品时，
   * 尝试互换——A 落到目标位，B 去 A 的原位（B 保持自身形状，A 的原位须放得下 B），
   * 成功返回 "swapped"，都不行返回 null 且不动包。
   */
  function placeOrSwap(bag, idx, x, y, rot) {
    if (placeAt(bag, idx, x, y, rot)) return "moved";
    const it = bag.items[idx];
    if (!it) return null;
    const w = rot ? it.h : it.w, h = rot ? it.w : it.h;
    if (x < 0 || y < 0 || x + w > bag.w || y + h > bag.h) return null;
    const others = new Set();
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const cx = x + dx, cy = y + dy;
      if (cx >= it.x && cx < it.x + it.w && cy >= it.y && cy < it.y + it.h) continue; // 自身原位
      const j = itemIndexAt(bag, cx, cy);
      if (j >= 0 && j !== idx) others.add(j);
    }
    if (others.size !== 1) return null;
    const B = bag.items[others.values().next().value];
    // 快照以便失败还原
    const a = { x: it.x, y: it.y, w: it.w, h: it.h };
    const b = { x: B.x, y: B.y, w: B.w, h: B.h };
    const clear = (e) => { for (let dy = 0; dy < e.h; dy++) for (let dx = 0; dx < e.w; dx++) bag.occ[e.y + dy][e.x + dx] = 0; };
    const fill = (e) => { for (let dy = 0; dy < e.h; dy++) for (let dx = 0; dx < e.w; dx++) bag.occ[e.y + dy][e.x + dx] = 1; };
    const areaFree = (bx, by, bw, bh) => {
      if (bx < 0 || by < 0 || bx + bw > bag.w || by + bh > bag.h) return false;
      for (let dy = 0; dy < bh; dy++) for (let dx = 0; dx < bw; dx++) if (bag.occ[by + dy][bx + dx]) return false;
      return true;
    };
    clear(it); clear(B);
    // A 落目标位（placeAt 已失败过，但那是 B 占着导致的；清空后必成）
    it.x = x; it.y = y; it.w = w; it.h = h;
    fill(it);
    // B 去 A 的原位
    if (areaFree(a.x, a.y, B.w, B.h)) {
      B.x = a.x; B.y = a.y;
      fill(B);
      return "swapped";
    }
    // 还原
    it.x = a.x; it.y = a.y; it.w = a.w; it.h = a.h;
    B.x = b.x; B.y = b.y; B.w = b.w; B.h = b.h;
    clear(it); clear(B); // 位置/形状已还原，重铺占用
    fill(it); fill(B);
    return null;
  }

  // 不改变 bag 的"挪位或互换"可行性（克隆试跑）
  function canPlaceOrSwap(bag, idx, x, y, rot) {
    if (canPlaceAt(bag, idx, x, y, rot)) return true;
    const clone = {
      w: bag.w, h: bag.h,
      occ: bag.occ.map((r) => r.slice()),
      items: bag.items.map((e) => ({ item: e.item, x: e.x, y: e.y, w: e.w, h: e.h })),
    };
    return placeOrSwap(clone, idx, x, y, rot) != null;
  }

  // ---------- 分享卡 ----------

  function buildRaidShare(opts) {
    const { date, practice, outcome, value, searched, total, bestItemName, mapName } = opts;
    const grade = raidGrade(value);
    const label = mapName ? `鼠鼠摸金·${mapName}` : practice ? "鼠鼠摸金·练习" : `鼠鼠摸金 #${date}`;
    const outcomeLine = outcome === "extracted"
      ? `🐭 肥肥撤离！带出【${fmt(value)}】`
      : outcome === "caught"
        ? `💀 被一脚踢死，安全箱保住【${fmt(value)}】`
        : `⏱ 迷失禁区，安全箱保住【${fmt(value)}】`;
    const lines = [
      `${DFG.SITE_NAME} · ${label}`,
      outcomeLine,
      `📦 搜刮 ${searched}/${total} · 评级 ${grade.g}·${grade.name}`,
    ];
    if (bestItemName) lines.push(`🧀 最肥一件：${bestItemName}`);
    lines.push(DFG.SITE_URL.replace(/\/$/, "") + "/raid"); // 摸金分享卡带专路由直达
    return lines.join("\n");
  }

  return {
    MAP_W, MAP_H, RAID_SECONDS, EXTRACT_MS,
    PATROL_STEP_MS, PLAYER_STEP_MS,
    REVEAL_SEC, BIG_CELLS, BIG_PAUSE_MS, MEME_TEXT, RAID_GRADES, RAID_LINES,
    LEVELS, DEFAULT_CFG,
    raidGrade, fmt, dailySeed,
    makeGrid, bfsReachable, findPath, losClear,
    tryGenMap, validateMap, generateRaid, makeSolidFn,
    fitsPossible, weightedGrade, packFirstFit, rollContainer,
    makeBag, addToBag, addToBagSmart, removeFromBag, canPlaceAt, placeAt, itemIndexAt, placeOrSwap, canPlaceOrSwap, bagValue,
    buildRaidShare,
  };
});
