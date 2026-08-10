/*
 * 三角洲行动游乐场 —— 纯逻辑层（UMD：浏览器挂 window.DFG，node 可 require）
 * 不依赖 DOM；数据由调用方传入（浏览器里是 window.DF_WEAPONS / window.DF_ACC）
 */
(function (root, factory) {
  const DFG = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = DFG;
  else root.DFG = DFG;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SITE_NAME = "三角洲行动游乐场";
  const SITE_URL = "https://komozyw.com/df/"; // 国内可达主站（.io 需翻墙，分享卡一律带 komozyw；2026-08-11 起 HTTPS 可用）

  // ---------- 随机与每日种子 ----------

  // FNV-1a 32bit
  function hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 本地日期 YYYY-MM-DD（不用 UTC，保证“今天”符合玩家直觉）
  function dateStr(d) {
    d = d || new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${dd}`;
  }

  // 带 salt 的每日索引：各玩法 salt 不同，同一天各玩法的题互不干扰
  function dailyIndex(date, count, salt) {
    const rng = mulberry32(hash32((salt || "df") + ":" + date));
    return Math.floor(rng() * count);
  }

  // 用 rng 原地洗牌（Fisher-Yates）
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- 通用：模糊搜索（猜枪械的自动补全） ----------

  // 名称去掉枪种后缀后的“本名”，用于搜索（"M4" 能命中 "M4A1突击步枪"）
  const NAME_SUFFIXES = ["精确射手步枪", "突击步枪", "狙击步枪", "冲锋枪", "轻机枪", "霰弹枪", "手枪", "步枪"];
  function gunBase(name) {
    for (const s of NAME_SUFFIXES) {
      if (name.endsWith(s) && name.length > s.length) return name.slice(0, -s.length);
    }
    return name;
  }

  function normalize(s) {
    return String(s).replace(/[·•.\s・-]/g, "").toLowerCase();
  }

  // 在候选枪械列表里按名字模糊匹配，前缀命中排前
  function search(candidates, query, excludeIds, limit) {
    const q = normalize(query);
    if (!q) return [];
    const ex = new Set(excludeIds || []);
    const out = [];
    for (const c of candidates) {
      if (ex.has(c.id)) continue;
      const full = normalize(c.name);
      const base = normalize(gunBase(c.name));
      if (full.includes(q) || base.includes(q)) {
        out.push({ c, score: (full.startsWith(q) || base.startsWith(q)) ? 0 : 1 });
      }
    }
    out.sort((a, b) => a.score - b.score || a.c.id.localeCompare(b.c.id));
    return out.slice(0, limit || 8).map((x) => x.c);
  }

  /* ================================================================
   * 玩法 1：改枪大师（主打）
   * 每轮：一个配件部位 + 一个目标属性，4 件同部位候选配件，选对该属性加成最高的。
   * 判定全部使用配件 accDetail 的真实数值，不依赖拿不到的枪械兼容表。
   * ================================================================ */

  const SMITH_STATS = [
    { key: "recoil", label: "后坐力控制", unit: "" },
    { key: "controlSpeed", label: "操控速度", unit: "" },
    { key: "controlStable", label: "据枪稳定性", unit: "" },
    { key: "hipShot", label: "腰射精度", unit: "" },
    { key: "shotDistancePercent", label: "射程", unit: "%" },
    { key: "bombCapacity", label: "弹容量", unit: " 发" },
  ];
  const SMITH_STAT_BY_KEY = {};
  SMITH_STATS.forEach((s) => { SMITH_STAT_BY_KEY[s.key] = s; });
  const SMITH_ROUNDS = 5;

  // 可出题的（部位 × 属性）组合：该部位内 ≥4 件配件带该数值且取值 ≥4 种
  function smithCombos(accs) {
    const combos = [];
    const bySlot = {};
    accs.forEach((a) => { (bySlot[a.slot] = bySlot[a.slot] || []).push(a); });
    for (const slot of Object.keys(bySlot).sort()) {
      for (const st of SMITH_STATS) {
        const items = bySlot[slot].filter((a) => typeof a.stats[st.key] === "number");
        const values = new Set(items.map((a) => a.stats[st.key]));
        if (items.length >= 4 && values.size >= 4) {
          combos.push({ slot, slotCN: items[0].slotCN, statKey: st.key });
        }
      }
    }
    return combos;
  }

  /*
   * 从某组合出 4 件候选：目标属性取值两两不同，且最大值唯一（保证唯一正确答案）。
   * rng 确定性；组合不成立时返回 null（理论上 smithCombos 已过滤，双重保险）。
   */
  function smithRound(rng, accs, combo) {
    const items = accs.filter((a) => a.slot === combo.slot && typeof a.stats[combo.statKey] === "number");
    const shuffled = shuffle(items.slice(), rng);
    const picked = [];
    const usedValues = new Set();
    for (const a of shuffled) {
      const v = a.stats[combo.statKey];
      if (usedValues.has(v)) continue;
      picked.push(a);
      usedValues.add(v);
      if (picked.length === 4) break;
    }
    if (picked.length < 4) return null;
    let best = picked[0];
    for (const a of picked) if (a.stats[combo.statKey] > best.stats[combo.statKey]) best = a;
    return {
      slot: combo.slot,
      slotCN: combo.slotCN,
      statKey: combo.statKey,
      candidates: picked.map((a) => a.id),
      answerId: best.id,
    };
  }

  // 每日 5 轮：组合不重复
  function smithDaily(date, accs) {
    const combos = smithCombos(accs);
    const rng = mulberry32(hash32("df-smith:" + date));
    const rounds = [];
    const used = new Set();
    let guard = 0;
    while (rounds.length < SMITH_ROUNDS && guard++ < 200) {
      const combo = combos[Math.floor(rng() * combos.length)];
      const key = combo.slot + "|" + combo.statKey;
      if (used.has(key)) continue;
      const r = smithRound(rng, accs, combo);
      if (!r) continue;
      used.add(key);
      rounds.push(r);
    }
    return rounds;
  }

  function smithRandom(accs, rand) {
    rand = rand || Math.random;
    const combos = smithCombos(accs);
    const rng = mulberry32(Math.floor(rand() * 0xffffffff));
    const rounds = [];
    const used = new Set();
    let guard = 0;
    while (rounds.length < SMITH_ROUNDS && guard++ < 200) {
      const combo = combos[Math.floor(rng() * combos.length)];
      const key = combo.slot + "|" + combo.statKey;
      if (used.has(key)) continue;
      const r = smithRound(rng, accs, combo);
      if (!r) continue;
      used.add(key);
      rounds.push(r);
    }
    return rounds;
  }

  function smithJudge(round, pickId) { return pickId === round.answerId; }

  function smithGrade(score) {
    if (score >= SMITH_ROUNDS) return "传奇枪械师";
    if (score === 4) return "军械库常客";
    if (score === 3) return "改枪学徒";
    return "烧火棍师傅";
  }

  // rounds: [{slotCN, ok}]
  function buildSmithShare(opts) {
    const { date, rounds, score, practice } = opts;
    const label = practice ? "改枪大师·练习" : `改枪大师 #${date}`;
    const marks = rounds.map((r) => (r.ok ? "🟩" : "🟥")).join("");
    const lines = [
      `${SITE_NAME} · ${label}`,
      `🔧 ${score}/${SMITH_ROUNDS}`,
      marks,
      `评级：${smithGrade(score)}`,
      SITE_URL,
    ];
    return lines.join("\n");
  }

  /* ================================================================
   * 玩法 2：猜枪械（wordle 式七维比对）
   * 文本维度：类型 / 口径 / 开火模式（集合相等才算对）
   * 数值维度：伤害 / 射速 / 射程 / 弹容量（⬆️=答案更高，⬇️=更低）
   * ================================================================ */

  const GUESS_MAX_TRIES = 6;
  const GUESS_CELL_ORDER = ["type", "caliber", "fireMode", "meatHarm", "fireSpeed", "shootDistance", "capacity"];
  const GUESS_CELL_LABEL = {
    type: "类型", caliber: "口径", fireMode: "开火模式",
    meatHarm: "伤害", fireSpeed: "射速", shootDistance: "射程", capacity: "弹容量",
  };
  const GUESS_CELL_EMOJI = { green: "🟩", red: "🟥", up: "⬆️", down: "⬇️" };

  function guessPool(weapons) { return weapons.slice(); }

  function guessDaily(date, pool) {
    return pool[dailyIndex(date, pool.length, "df-guess")].id;
  }

  function guessRandom(pool, rand) {
    rand = rand || Math.random;
    return pool[Math.floor(rand() * pool.length)].id;
  }

  function cmpNumeric(g, t) {
    if (g === t) return 0;
    return t > g ? 1 : -1;
  }

  function numCell(g, t) {
    const dir = cmpNumeric(g, t);
    if (dir === 0) return { status: "green" };
    return { status: dir > 0 ? "up" : "down", dir };
  }

  // 开火模式集合相等判定（顺序无关）
  function fireModeEqual(a, b) {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return b.every((m) => s.has(m));
  }

  function guessCompare(g, t) {
    return {
      win: g.id === t.id,
      cells: {
        type: { status: g.type === t.type ? "green" : "red" },
        caliber: { status: g.caliber === t.caliber ? "green" : "red" },
        fireMode: { status: fireModeEqual(g.fireModes, t.fireModes) ? "green" : "red" },
        meatHarm: numCell(g.meatHarm, t.meatHarm),
        fireSpeed: numCell(g.fireSpeed, t.fireSpeed),
        shootDistance: numCell(g.shootDistance, t.shootDistance),
        capacity: numCell(g.capacity, t.capacity),
      },
    };
  }

  function guessGrade(tries, won) {
    if (!won) return "烧火棍都认不出";
    if (tries === 1) return "读枪神探";
    if (tries <= 3) return "军械专家";
    if (tries <= 5) return "靶场常客";
    return "压线过关";
  }

  // results: guessCompare 的结果数组；只含 emoji 与成绩，不含答案名
  function buildGuessShare(opts) {
    const { date, results, won, practice } = opts;
    const label = practice ? "猜枪械·练习" : `猜枪械 #${date}`;
    const rows = results.map((r) =>
      GUESS_CELL_ORDER.map((k) => GUESS_CELL_EMOJI[r.cells[k].status]).join(""));
    const lines = [
      `${SITE_NAME} · ${label}`,
      won ? `🎯 ${results.length}/${GUESS_MAX_TRIES}` : `🎯 X/${GUESS_MAX_TRIES}`,
      ...rows,
      `评级：${guessGrade(results.length, won)}`,
      SITE_URL,
    ];
    return lines.join("\n");
  }

  /* ================================================================
   * 玩法 3：枪械对决（higher-lower）
   * 每日种子决定比拼属性，固定 10 轮链式；练习模式随机属性无限连击。
   * ================================================================ */

  const DUEL_STATS = [
    { key: "meatHarm", label: "伤害" },
    { key: "armorHarm", label: "护甲伤害" },
    { key: "fireSpeed", label: "射速" },
    { key: "shootDistance", label: "射程" },
    { key: "recoil", label: "后坐力控制" },
    { key: "control", label: "操控速度" },
    { key: "stable", label: "据枪稳定性" },
    { key: "hipShot", label: "腰射精度" },
    { key: "capacity", label: "弹容量" },
    { key: "muzzleVelocity", label: "子弹初速" },
  ];
  const DUEL_STAT_BY_KEY = {};
  DUEL_STATS.forEach((s) => { DUEL_STAT_BY_KEY[s.key] = s; });
  const DUEL_DAILY_ROUNDS = 10;

  // 两把枪能否在该属性上配对：取值不同（排除平局）
  function duelPairable(a, b, statKey) {
    return a[statKey] !== b[statKey];
  }

  // 每日：种子选属性 + 11 把枪串成链（相邻在该属性上取值不同）
  function duelDaily(date, weapons) {
    const rng = mulberry32(hash32("df-duel:" + date));
    const stat = DUEL_STATS[Math.floor(rng() * DUEL_STATS.length)];
    const shuffled = shuffle(weapons.slice(), rng);
    const chain = [shuffled[0]];
    for (let i = 1; i < shuffled.length && chain.length < DUEL_DAILY_ROUNDS + 1; i++) {
      if (duelPairable(chain[chain.length - 1], shuffled[i], stat.key)) chain.push(shuffled[i]);
    }
    return { statKey: stat.key, chain: chain.map((w) => w.id) };
  }

  // 练习模式：随机属性 + 随机起手
  function duelRandom(weapons, rand) {
    rand = rand || Math.random;
    const stat = DUEL_STATS[Math.floor(rand() * DUEL_STATS.length)];
    const left = weapons[Math.floor(rand() * weapons.length)];
    const right = duelNext(weapons, left, stat.key, rand);
    return { statKey: stat.key, leftId: left.id, rightId: right.id };
  }

  // 无限模式：随机选一把能与 current 在该属性上配对的下家
  function duelNext(weapons, current, statKey, rand) {
    rand = rand || Math.random;
    const cands = weapons.filter((w) => w.id !== current.id && duelPairable(w, current, statKey));
    return cands[Math.floor(rand() * cands.length)];
  }

  // 判定：guess ∈ {"higher","lower"}，right 相对 left
  function duelJudge(guess, left, right, statKey) {
    return (guess === "higher") === (right[statKey] > left[statKey]);
  }

  function duelGrade(score, total) {
    if (total && score >= total) return "行走的数据库";
    if (score >= 7) return "军械分析师";
    if (score >= 4) return "枪械爱好者";
    return "回去练枪法";
  }

  // trail: [{dir:"higher"|"lower", ok:bool}]
  function buildDuelShare(opts) {
    const { date, statLabel, score, trail, practice } = opts;
    const label = practice ? "枪械对决·练习" : `枪械对决 #${date}`;
    const scoreText = practice ? `⚔️×${score}` : `⚔️×${score}/${DUEL_DAILY_ROUNDS}`;
    const marks = trail.map((t) => (t.dir === "higher" ? "⬆️" : "⬇️") + (t.ok ? "✔️" : "❌")).join("");
    const lines = [
      `${SITE_NAME} · ${label}`,
      `比拼属性：${statLabel}`,
      scoreText,
      marks,
      `评级：${duelGrade(score, practice ? 0 : DUEL_DAILY_ROUNDS)}`,
      SITE_URL,
    ];
    return lines.join("\n");
  }

  /* ================================================================
   * 玩法 4：火力排排坐
   * 5 把枪按每日种子指定的属性从高到低排序，3 次提交机会。
   * ================================================================ */

  const SORT_STATS = [
    { key: "fireSpeed", label: "射速" },
    { key: "meatHarm", label: "伤害" },
    { key: "shootDistance", label: "射程" },
    { key: "capacity", label: "弹容量" },
    { key: "muzzleVelocity", label: "子弹初速" },
  ];
  const SORT_PICK = 5;
  const SORT_MAX_TRIES = 3;

  /*
   * 选 5 把在该属性上取值两两不同的枪；凑不齐时放宽为取值不全同，保证能出题。
   */
  function sortPick(rng, weapons, statKey) {
    const shuffled = shuffle(weapons.slice(), rng);
    const picked = [];
    for (const w of shuffled) {
      if (picked.every((p) => p[statKey] !== w[statKey])) picked.push(w);
      if (picked.length === SORT_PICK) return picked;
    }
    for (const w of shuffled) {
      if (picked.includes(w)) continue;
      picked.push(w);
      if (picked.length === SORT_PICK) return picked;
    }
    return picked; // 理论上不会到这里
  }

  function sortDaily(date, weapons) {
    const rng = mulberry32(hash32("df-sort:" + date));
    const stat = SORT_STATS[Math.floor(rng() * SORT_STATS.length)];
    const ids = sortPick(rng, weapons, stat.key).map((w) => w.id);
    // 保证初始不是已排好
    const sorted = ids.slice().sort((a, b) => weapons.find((w) => w.id === b)[stat.key] - weapons.find((w) => w.id === a)[stat.key]);
    if (ids.every((id, i) => id === sorted[i])) [ids[0], ids[1]] = [ids[1], ids[0]];
    return { statKey: stat.key, ids };
  }

  function sortRandom(weapons, rand) {
    rand = rand || Math.random;
    const rng = mulberry32(Math.floor(rand() * 0xffffffff));
    const stat = SORT_STATS[Math.floor(rng() * SORT_STATS.length)];
    const ids = sortPick(rng, weapons, stat.key).map((w) => w.id);
    const sorted = ids.slice().sort((a, b) => weapons.find((w) => w.id === b)[stat.key] - weapons.find((w) => w.id === a)[stat.key]);
    if (ids.every((id, i) => id === sorted[i])) [ids[0], ids[1]] = [ids[1], ids[0]];
    return { statKey: stat.key, ids };
  }

  // 正确顺序（高 → 低）
  function sortCorrect(ids, byId, statKey) {
    return ids.slice().sort((a, b) => byId[b][statKey] - byId[a][statKey]);
  }

  // 逐位判定
  function sortMarks(orderIds, correctIds) {
    return orderIds.map((id, i) => id === correctIds[i]);
  }

  function sortGrade(tries, won) {
    if (!won) return "手感尽失";
    if (tries === 1) return "人形测速仪";
    if (tries === 2) return "数据党";
    return "蒙的不错";
  }

  // attempts: 每次提交的 marks 数组（bool×5）
  function buildSortShare(opts) {
    const { date, statLabel, attempts, won, practice } = opts;
    const label = practice ? "火力排排坐·练习" : `火力排排坐 #${date}`;
    const rows = attempts.map((m) => m.map((b) => (b ? "🟩" : "🟥")).join(""));
    const lines = [
      `${SITE_NAME} · ${label}`,
      `比拼属性：${statLabel}`,
      won ? `📶 ${attempts.length}/${SORT_MAX_TRIES}` : `📶 X/${SORT_MAX_TRIES}`,
      ...rows,
      `评级：${sortGrade(attempts.length, won)}`,
      SITE_URL,
    ];
    return lines.join("\n");
  }

  /* ================================================================
   * 玩法 5/6：鼠鼠摸金（收集品）
   * 价值/单格价值为同人自设玩法数值（官方未公开静态物价），判定仅用站内数据。
   * ================================================================ */

  const LOOT_STATS = [
    { key: "value", label: "总价值" },
    { key: "perCell", label: "单格价值" },
  ];
  const LOOT_STAT_BY_KEY = {};
  LOOT_STATS.forEach((s) => { LOOT_STAT_BY_KEY[s.key] = s; });
  const LOOT_DUEL_ROUNDS = 10;

  // 出题池：仅可交易（有真实交易行价格）的收集品；未匹配到价格的不参与出题
  function lootPool(items) {
    return items.filter((i) => i.priced && typeof i.value === "number" && typeof i.perCell === "number");
  }

  // 金额展示：≥1 万用「万」保留一位小数（整数不带 .0），否则原值
  function formatLoot(n) {
    if (n >= 10000) {
      const w = n / 10000;
      return (Math.round(w * 10) / 10) + "万";
    }
    return String(n);
  }

  // 两件物资能否在该维度上配对：取值不同（排除平局）
  function lootDuelPairable(a, b, statKey) {
    return a[statKey] !== b[statKey];
  }

  // 每日：种子选维度 + 11 件串成链（相邻在该维度上取值不同）
  function lootDuelDaily(date, items) {
    const pool = lootPool(items);
    const rng = mulberry32(hash32("df-lootduel:" + date));
    const stat = LOOT_STATS[Math.floor(rng() * LOOT_STATS.length)];
    const shuffled = shuffle(pool.slice(), rng);
    const chain = [shuffled[0]];
    for (let i = 1; i < shuffled.length && chain.length < LOOT_DUEL_ROUNDS + 1; i++) {
      if (lootDuelPairable(chain[chain.length - 1], shuffled[i], stat.key)) chain.push(shuffled[i]);
    }
    return { statKey: stat.key, chain: chain.map((w) => w.id) };
  }

  function lootDuelRandom(items, rand) {
    rand = rand || Math.random;
    const pool = lootPool(items);
    const stat = LOOT_STATS[Math.floor(rand() * LOOT_STATS.length)];
    const left = pool[Math.floor(rand() * pool.length)];
    const right = lootDuelNext(pool, left, stat.key, rand);
    return { statKey: stat.key, leftId: left.id, rightId: right.id };
  }

  function lootDuelNext(items, current, statKey, rand) {
    rand = rand || Math.random;
    const cands = items.filter((w) => w.id !== current.id && lootDuelPairable(w, current, statKey));
    return cands[Math.floor(rand() * cands.length)];
  }

  // 判定：guess ∈ {"higher","lower"}，right 相对 left
  function lootDuelJudge(guess, left, right, statKey) {
    return (guess === "higher") === (right[statKey] > left[statKey]);
  }

  function lootDuelGrade(score, total) {
    if (total && score >= total) return "传说拾荒王";
    if (score >= 7) return "摸金校尉";
    if (score >= 4) return "垃圾佬";
    return "白给小子";
  }

  // trail: [{dir:"higher"|"lower", ok:bool}]
  function buildLootDuelShare(opts) {
    const { date, statLabel, score, trail, practice } = opts;
    const label = practice ? "摸金对决·练习" : `摸金对决 #${date}`;
    const scoreText = practice ? `💰×${score}` : `💰×${score}/${LOOT_DUEL_ROUNDS}`;
    const marks = trail.map((t) => (t.dir === "higher" ? "⬆️" : "⬇️") + (t.ok ? "✔️" : "❌")).join("");
    const lines = [
      `${SITE_NAME} · ${label}`,
      `比拼维度：${statLabel}`,
      scoreText,
      marks,
      `评级：${lootDuelGrade(score, practice ? 0 : LOOT_DUEL_ROUNDS)}`,
      SITE_URL,
    ];
    return lines.join("\n");
  }

  // ---------- 物资排排坐 ----------

  const LOOT_SORT_PICK = 5;
  const LOOT_SORT_MAX_TRIES = 3;

  function lootSortDaily(date, items) {
    const pool = lootPool(items);
    const rng = mulberry32(hash32("df-lootsort:" + date));
    const stat = LOOT_STATS[Math.floor(rng() * LOOT_STATS.length)];
    const ids = sortPick(rng, pool, stat.key).map((w) => w.id);
    const byId = {};
    pool.forEach((w) => { byId[w.id] = w; });
    const sorted = sortCorrect(ids, byId, stat.key);
    if (ids.every((id, i) => id === sorted[i])) [ids[0], ids[1]] = [ids[1], ids[0]];
    return { statKey: stat.key, ids };
  }

  function lootSortRandom(items, rand) {
    rand = rand || Math.random;
    const pool = lootPool(items);
    const rng = mulberry32(Math.floor(rand() * 0xffffffff));
    const stat = LOOT_STATS[Math.floor(rng() * LOOT_STATS.length)];
    const ids = sortPick(rng, pool, stat.key).map((w) => w.id);
    const byId = {};
    pool.forEach((w) => { byId[w.id] = w; });
    const sorted = sortCorrect(ids, byId, stat.key);
    if (ids.every((id, i) => id === sorted[i])) [ids[0], ids[1]] = [ids[1], ids[0]];
    return { statKey: stat.key, ids };
  }

  function lootSortGrade(tries, won) {
    if (!won) return "看走眼了";
    if (tries === 1) return "人形估价器";
    if (tries === 2) return "交易所老炮";
    return "蒙的不错";
  }

  // attempts: 每次提交的 marks 数组（bool×5）
  function buildLootSortShare(opts) {
    const { date, statLabel, attempts, won, practice } = opts;
    const label = practice ? "物资排排坐·练习" : `物资排排坐 #${date}`;
    const rows = attempts.map((m) => m.map((b) => (b ? "🟩" : "🟥")).join(""));
    const lines = [
      `${SITE_NAME} · ${label}`,
      `比拼维度：${statLabel}`,
      won ? `📦 ${attempts.length}/${LOOT_SORT_MAX_TRIES}` : `📦 X/${LOOT_SORT_MAX_TRIES}`,
      ...rows,
      `评级：${lootSortGrade(attempts.length, won)}`,
      SITE_URL,
    ];
    return lines.join("\n");
  }

  return {
    SITE_NAME, SITE_URL,
    hash32, mulberry32, dateStr, dailyIndex, shuffle, normalize, gunBase, search,
    // 改枪大师
    SMITH_STATS, SMITH_STAT_BY_KEY, SMITH_ROUNDS,
    smithCombos, smithRound, smithDaily, smithRandom, smithJudge, smithGrade, buildSmithShare,
    // 猜枪械
    GUESS_MAX_TRIES, GUESS_CELL_ORDER, GUESS_CELL_LABEL, GUESS_CELL_EMOJI,
    guessPool, guessDaily, guessRandom, cmpNumeric, numCell, fireModeEqual, guessCompare, guessGrade, buildGuessShare,
    // 枪械对决
    DUEL_STATS, DUEL_STAT_BY_KEY, DUEL_DAILY_ROUNDS,
    duelPairable, duelDaily, duelRandom, duelNext, duelJudge, duelGrade, buildDuelShare,
    // 火力排排坐
    SORT_STATS, SORT_PICK, SORT_MAX_TRIES,
    sortPick, sortDaily, sortRandom, sortCorrect, sortMarks, sortGrade, buildSortShare,
    // 鼠鼠摸金：摸金对决 + 物资排排坐
    LOOT_STATS, LOOT_STAT_BY_KEY, LOOT_DUEL_ROUNDS, formatLoot, lootPool,
    lootDuelPairable, lootDuelDaily, lootDuelRandom, lootDuelNext, lootDuelJudge, lootDuelGrade, buildLootDuelShare,
    LOOT_SORT_PICK, LOOT_SORT_MAX_TRIES,
    lootSortDaily, lootSortRandom, lootSortGrade, buildLootSortShare,
  };
});
