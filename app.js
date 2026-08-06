/* 三角洲行动游乐场 —— UI 层（依赖 game.js 的纯逻辑 DFG 与 data/*.js 的全局数据） */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const DFG = window.DFG;

  const WEAPONS = window.DF_WEAPONS;
  const ACCS = window.DF_ACC;
  const byId = {};
  WEAPONS.forEach((w) => { byId[w.id] = w; });
  const accById = {};
  ACCS.forEach((a) => { accById[a.id] = a; });
  const GPOOL = DFG.guessPool(WEAPONS);

  // ---------- 本地存储（file:// 下也尽量可用，失败降级为内存） ----------
  const store = (() => {
    try { localStorage.setItem("df.__t", "1"); localStorage.removeItem("df.__t"); }
    catch (e) { const m = {}; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; }
    return {
      get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    };
  })();
  function loadJSON(k, fallback) {
    try { const v = JSON.parse(store.get(k)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  const TODAY = DFG.dateStr();
  const dkey = (game) => `df_${game}_${TODAY}`;

  // ---------- 枪械/配件图（加载失败时换成名称占位块） ----------
  window.__dfImg = function (img) {
    const div = document.createElement("div");
    div.className = img.className;
    div.style.cssText = "display:flex;align-items:center;justify-content:center;background:var(--card-hi);color:var(--ink-soft);font-size:11px;padding:2px;";
    div.textContent = img.dataset.name || "图鉴";
    img.replaceWith(div);
  };
  function gunImgHTML(w, cls) {
    return `<img class="gun-img ${cls || ""}" loading="lazy" src="${w.img}" alt="${w.name}" data-name="${w.name}" onerror="window.__dfImg(this)">`;
  }
  function accImgHTML(a, cls) {
    return `<img class="gun-img ${cls || ""}" loading="lazy" src="${a.img}" alt="${a.name}" data-name="${a.name}" onerror="window.__dfImg(this)">`;
  }

  // ---------- 复制与提示 ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败，请手动复制"); }
    document.body.removeChild(ta);
  }
  function copyText(text) {
    const done = () => toast("分享卡已复制，去粘贴吧");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }

  // 输入框错误抖动（≤300ms）
  function shakeInput(input) {
    input.classList.add("shake");
    setTimeout(() => input.classList.remove("shake"), 320);
  }

  /* ================================================================
   * 玩法 1：改枪大师
   * state = {rounds:[5 轮题目], pos, score, results:[{slotCN,ok}], picked:[id...], status}
   * ================================================================ */
  const Smith = { mode: "daily", daily: null, practice: null, answered: false };

  function sState() { return Smith.mode === "daily" ? Smith.daily : Smith.practice; }
  function sPersist() { if (Smith.mode === "daily") store.set(dkey("smith"), JSON.stringify(Smith.daily)); }

  function smithNewState(rounds) {
    return { rounds, pos: 0, score: 0, results: [], picked: [], status: "playing" };
  }

  function smithInit() {
    const rounds = DFG.smithDaily(TODAY, ACCS);
    const saved = loadJSON(dkey("smith"), null);
    Smith.daily = (saved && JSON.stringify(saved.rounds) === JSON.stringify(rounds))
      ? saved : smithNewState(rounds);
  }

  function smithNewPractice() { Smith.practice = smithNewState(DFG.smithRandom(ACCS)); }

  function smithRender() {
    const s = sState();
    const done = s.status !== "playing";
    $("#smithBanner").innerHTML = Smith.mode === "daily"
      ? `今日题目 <b>#${TODAY}</b> · 固定 ${DFG.SMITH_ROUNDS} 轮 · 全站同题`
      : `练习模式 · 随机出题 · 不计入每日成绩`;
    // 轮次进度条
    $("#smithSegBar").innerHTML = s.rounds.map((_, i) => {
      let cls = "";
      if (i < s.results.length) cls = s.results[i].ok ? "hit" : "miss";
      else if (i === s.pos && !done) cls = "on";
      return `<div class="seg ${cls}">${i + 1}</div>`;
    }).join("");
    if (done) { smithRenderResult(); return; }
    $("#smithResult").classList.add("hidden");
    const round = s.rounds[s.pos];
    const stat = DFG.SMITH_STAT_BY_KEY[round.statKey];
    $("#smithQuestion").innerHTML =
      `第 <b>${s.pos + 1}</b> / ${DFG.SMITH_ROUNDS} 轮 · 改装台 · <span class="q-slot">【${round.slotCN}】</span>位<br>` +
      `目标：选出 <b>${stat.label}</b> 加成最高的一件`;
    const revealed = s.picked.length > s.pos;
    $("#smithGrid").innerHTML = round.candidates.map((id) => {
      const a = accById[id];
      let cls = "";
      if (revealed) {
        cls = "reveal";
        if (id === round.answerId) cls += " correct";
        else if (id === s.picked[s.pos]) cls += " wrong";
      }
      const statPart = revealed
        ? `<div class="sc-stat">${a.stats[round.statKey] > 0 ? "+" : ""}${a.stats[round.statKey]}${stat.unit}</div>
           <div class="sc-effects">
             ${a.pros.map((p) => `<div class="pro">▲ ${p}</div>`).join("")}
             ${a.cons.map((c) => `<div class="con">▼ ${c}</div>`).join("")}
           </div>`
        : "";
      return `<div class="smith-card ${cls}" data-id="${id}">
        ${accImgHTML(a)}
        <div class="sc-name">${a.name}</div>
        ${statPart}
      </div>`;
    }).join("");
    if (!revealed) {
      $("#smithGrid").querySelectorAll(".smith-card").forEach((el) => {
        el.addEventListener("click", () => smithPick(el.dataset.id));
      });
    }
    $("#smithNextBtn").classList.toggle("hidden", !revealed);
    $("#smithNextBtn").textContent = s.pos + 1 >= DFG.SMITH_ROUNDS ? "查看结算 🏁" : "下一轮 ⏭";
  }

  function smithPick(id) {
    const s = sState();
    if (!s || s.status !== "playing" || s.picked.length > s.pos) return;
    const round = s.rounds[s.pos];
    const ok = DFG.smithJudge(round, id);
    s.picked.push(id);
    s.results.push({ slotCN: round.slotCN, ok });
    if (ok) { s.score++; toast("选对啦！"); }
    else {
      toast("不是它，看揭示数值");
      $("#smithGrid").classList.add("shake");
      setTimeout(() => $("#smithGrid").classList.remove("shake"), 450);
    }
    sPersist();
    smithRender();
  }

  function smithNext() {
    const s = sState();
    if (s.pos + 1 >= DFG.SMITH_ROUNDS) s.status = "won"; // 5 轮打完即结算，按 score 评级
    else s.pos++;
    sPersist();
    smithRender();
  }

  function smithRenderResult() {
    const s = sState();
    $("#smithGrid").innerHTML = "";
    $("#smithQuestion").innerHTML = "";
    $("#smithSegBar").innerHTML = s.rounds.map((_, i) =>
      `<div class="seg ${s.results[i] && s.results[i].ok ? "hit" : "miss"}">${i + 1}</div>`).join("");
    $("#smithNextBtn").classList.add("hidden");
    $("#smithResult").innerHTML = `
      <h2>${s.score >= DFG.SMITH_ROUNDS ? "满分收工！" : `本轮战绩 ${s.score} / ${DFG.SMITH_ROUNDS}`}</h2>
      <p class="r-meta">${s.results.map((r, i) => `第${i + 1}轮·${r.slotCN} ${r.ok ? "🟩" : "🟥"}`).join("　")}</p>
      <p class="r-grade">评级 <b>${DFG.smithGrade(s.score)}</b></p>
      <div class="btn-row">
        <button class="btn" id="smithShareBtn">复制分享卡</button>
        <button class="btn ghost" id="smithAgainBtn">再来一套（随机 · 不限次）</button>
      </div>`;
    $("#smithResult").classList.remove("hidden");
    $("#smithShareBtn").onclick = () => copyText(DFG.buildSmithShare({
      date: TODAY, rounds: s.results, score: s.score, practice: Smith.mode === "practice",
    }));
    $("#smithAgainBtn").onclick = () => {
      smithNewPractice(); // 无缝重开随机题：每日题玩完也可不限次继续
      if (Smith.mode === "daily") smithSetMode("practice");
      else smithRender();
    };
  }

  function smithSetMode(mode) {
    Smith.mode = mode;
    if (mode === "practice" && !Smith.practice) smithNewPractice();
    syncModeTabs("smith");
    smithRender();
  }

  /* ================================================================
   * 玩法 2：猜枪械（wordle 七维比对）
   * state = {targetId, guesses:[id...], results:[...], status}
   * ================================================================ */
  const Guess = { mode: "daily", daily: null, practice: null, sugItems: [], sugIndex: -1 };

  function gState() { return Guess.mode === "daily" ? Guess.daily : Guess.practice; }
  function gTarget() { return byId[gState().targetId]; }
  function gPersist() { if (Guess.mode === "daily") store.set(dkey("guess"), JSON.stringify(Guess.daily)); }

  function guessNewState(targetId) { return { targetId, guesses: [], results: [], status: "playing" }; }

  function guessInit() {
    const targetId = DFG.guessDaily(TODAY, GPOOL);
    const saved = loadJSON(dkey("guess"), null);
    Guess.daily = (saved && saved.targetId === targetId) ? saved : guessNewState(targetId);
  }

  function guessNewPractice() { Guess.practice = guessNewState(DFG.guessRandom(GPOOL)); }

  function gCellHTML(cell, text) {
    let arrow = "";
    if (cell.status === "up") arrow = '<span class="arrow">⬆</span>';
    if (cell.status === "down") arrow = '<span class="arrow">⬇</span>';
    return `<div class="cell ${cell.status}"><span>${text}</span>${arrow}</div>`;
  }

  function gRowHTML(w, res) {
    const cells = res.cells;
    return `<div class="row guess-grid">
      <div class="cell name">${gunImgHTML(w)}<span>${w.name}</span></div>
      ${gCellHTML(cells.type, w.type)}
      ${gCellHTML(cells.caliber, w.caliber)}
      ${gCellHTML(cells.fireMode, w.fireModes.join("/"))}
      ${gCellHTML(cells.meatHarm, w.meatHarm)}
      ${gCellHTML(cells.fireSpeed, w.fireSpeed)}
      ${gCellHTML(cells.shootDistance, w.shootDistance)}
      ${gCellHTML(cells.capacity, w.capacity)}
    </div>`;
  }

  function guessRender() {
    const s = gState();
    $("#guessBanner").innerHTML = Guess.mode === "daily"
      ? `今日题目 <b>#${TODAY}</b> · 全站同题 · 进度自动保存`
      : `练习模式 · 随机出题 · 不计入每日成绩`;
    const left = DFG.GUESS_MAX_TRIES - s.guesses.length;
    $("#guessTries").innerHTML = `剩 <b>${left}</b> / ${DFG.GUESS_MAX_TRIES} 次`;
    $("#guessRows").innerHTML = s.guesses.map((id, i) => gRowHTML(byId[id], s.results[i])).join("");
    const playing = s.status === "playing";
    $("#guessInput").disabled = !playing;
    $("#guessInput").placeholder = playing ? "输入枪械名，如：M4A1" : "本局已结束";
    if (playing) $("#guessResult").classList.add("hidden");
    else guessRenderResult();
    gCloseSuggest();
  }

  function guessRenderResult() {
    const s = gState();
    const t = gTarget();
    const won = s.status === "won";
    const tries = s.guesses.length;
    $("#guessResult").innerHTML = `
      ${gunImgHTML(t, "lg r-portrait")}
      <h2>${won ? "猜中了！" : "揭晓答案"}：${t.name}</h2>
      <p class="r-meta">${t.type} · ${t.caliber} · ${t.fireModes.join("/")} · 伤害${t.meatHarm} · 射速${t.fireSpeed} · 射程${t.shootDistance} · 弹容${t.capacity}</p>
      ${t.desc ? `<p class="r-quote">${t.desc}</p>` : ""}
      <p class="r-grade">${won ? tries : "X"}/${DFG.GUESS_MAX_TRIES} 次 · 评级 <b>${DFG.guessGrade(tries, won)}</b></p>
      <div class="btn-row">
        <button class="btn" id="guessShareBtn">复制分享卡</button>
        <button class="btn ghost" id="guessAgainBtn">再来一题（随机 · 不限次）</button>
      </div>`;
    $("#guessResult").classList.remove("hidden");
    $("#guessShareBtn").onclick = () => copyText(DFG.buildGuessShare({
      date: TODAY, results: s.results, won, practice: Guess.mode === "practice",
    }));
    $("#guessAgainBtn").onclick = () => {
      guessNewPractice(); // 无缝重开随机题：每日题玩完也可不限次继续
      if (Guess.mode === "daily") guessSetMode("practice");
      else guessRender();
    };
  }

  function guessSubmit(id) {
    const s = gState();
    if (!s || s.status !== "playing") return;
    if (s.guesses.includes(id)) { toast("这把枪已经猜过了"); return; }
    const res = DFG.guessCompare(byId[id], gTarget());
    s.guesses.push(id);
    s.results.push(res);
    if (res.win) s.status = "won";
    else {
      if (s.guesses.length >= DFG.GUESS_MAX_TRIES) s.status = "lost";
      shakeInput($("#guessInput"));
    }
    gPersist();
    guessRender();
  }

  // 自动补全（题池内枪械，带图）
  function gCloseSuggest() { $("#guessSuggest").classList.add("hidden"); Guess.sugItems = []; Guess.sugIndex = -1; }
  function gOpenSuggest(list) {
    Guess.sugItems = list;
    Guess.sugIndex = list.length ? 0 : -1;
    const ul = $("#guessSuggest");
    ul.innerHTML = list.map((w, i) => `
      <li data-id="${w.id}" class="${i === Guess.sugIndex ? "active" : ""}">
        ${gunImgHTML(w)}
        <span class="s-name">${w.name}</span>
        <span class="s-meta">${w.type} · ${w.caliber}</span>
      </li>`).join("");
    ul.classList.toggle("hidden", !list.length);
    ul.querySelectorAll("li").forEach((li) => {
      li.addEventListener("pointerdown", (e) => { e.preventDefault(); gPick(li.dataset.id); });
    });
  }
  function gMoveSuggest(delta) {
    if (!Guess.sugItems.length) return;
    Guess.sugIndex = (Guess.sugIndex + delta + Guess.sugItems.length) % Guess.sugItems.length;
    $("#guessSuggest").querySelectorAll("li").forEach((li, i) =>
      li.classList.toggle("active", i === Guess.sugIndex));
  }
  function gPick(id) {
    $("#guessInput").value = "";
    gCloseSuggest();
    guessSubmit(id);
  }
  function guessBindInput() {
    const input = $("#guessInput");
    const guessed = () => gState().guesses;
    input.addEventListener("input", () => gOpenSuggest(DFG.search(GPOOL, input.value, guessed())));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); gMoveSuggest(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); gMoveSuggest(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (Guess.sugItems.length) gPick(Guess.sugItems[Math.max(Guess.sugIndex, 0)].id);
        else {
          const m = DFG.search(GPOOL, input.value, guessed(), 1);
          if (m.length) gPick(m[0].id);
        }
      } else if (e.key === "Escape") gCloseSuggest();
    });
    input.addEventListener("blur", () => setTimeout(gCloseSuggest, 120));
    input.addEventListener("focus", () => {
      if (input.value) gOpenSuggest(DFG.search(GPOOL, input.value, guessed()));
    });
  }

  function guessSetMode(mode) {
    Guess.mode = mode;
    if (mode === "practice" && !Guess.practice) guessNewPractice();
    syncModeTabs("guess");
    guessRender();
  }

  /* ================================================================
   * 玩法 3：枪械对决
   * daily    = {statKey, chain:[11 ids], pos, score, trail:[{dir,ok}], status}
   * practice = {statKey, leftId, rightId, streak, trail, status}
   * ================================================================ */
  const Duel = { mode: "daily", daily: null, practice: null, locked: false };

  function dState() { return Duel.mode === "daily" ? Duel.daily : Duel.practice; }
  function dPair() {
    const s = dState();
    if (Duel.mode === "daily") {
      const i = Math.min(s.pos, s.chain.length - 2);
      return [byId[s.chain[i]], byId[s.chain[i + 1]]];
    }
    return [byId[s.leftId], byId[s.rightId]];
  }
  function dPersist() { if (Duel.mode === "daily") store.set(dkey("duel"), JSON.stringify(Duel.daily)); }

  function duelInit() {
    const q = DFG.duelDaily(TODAY, WEAPONS);
    const saved = loadJSON(dkey("duel"), null);
    Duel.daily = (saved && saved.statKey === q.statKey && JSON.stringify(saved.chain) === JSON.stringify(q.chain))
      ? saved
      : { statKey: q.statKey, chain: q.chain, pos: 0, score: 0, trail: [], status: "playing" };
  }

  function duelNewPractice() {
    const q = DFG.duelRandom(WEAPONS);
    Duel.practice = { statKey: q.statKey, leftId: q.leftId, rightId: q.rightId, streak: 0, trail: [], status: "playing" };
  }

  function duelCardHTML(w, side, reveal, statKey) {
    const stat = DFG.DUEL_STAT_BY_KEY[statKey];
    const valuePart = (side === "left" || reveal)
      ? `<div class="pop-play">${w[statKey]}<small>${stat.label}</small></div>`
      : `<div class="pop-play unknown">？<small>${stat.label}</small></div>`;
    return `${gunImgHTML(w)}<div class="pop-name">${w.name}</div><div class="pop-type">${w.type} · ${w.caliber}</div>${valuePart}`;
  }

  function duelRender(reveal) {
    const s = dState();
    const [left, right] = dPair();
    const done = s.status !== "playing";
    const stat = DFG.DUEL_STAT_BY_KEY[s.statKey];
    $("#duelBanner").innerHTML = Duel.mode === "daily"
      ? `今日题目 <b>#${TODAY}</b> · 固定 ${DFG.DUEL_DAILY_ROUNDS} 轮 · 答错即结算 · 每次作答后公布双方数值`
      : `练习模式 · 直到答错 · 最高连击 <b>${loadJSON("df_duel_best", 0)}</b> · 每次作答后公布双方数值`;
    $("#duelStat").innerHTML = `${Duel.mode === "daily" ? "今日" : "本局"}比拼属性：<b>${stat.label}</b>`;
    $("#duelLeft").innerHTML = duelCardHTML(left, "left", done, s.statKey);
    $("#duelRight").innerHTML = duelCardHTML(right, "right", done || reveal, s.statKey);
    $("#duelActions").classList.toggle("hidden", done || Duel.locked);
    $("#duelStreak").innerHTML = Duel.mode === "daily"
      ? `第 <b>${Math.min(s.pos + 1, DFG.DUEL_DAILY_ROUNDS)}</b> / ${DFG.DUEL_DAILY_ROUNDS} 轮 · 已连对 ${s.score}`
      : `当前连击 <b>${s.streak}</b>`;
    if (done) duelRenderResult();
    else $("#duelResult").classList.add("hidden");
  }

  function duelRenderResult() {
    const s = dState();
    const [left, right] = dPair();
    const stat = DFG.DUEL_STAT_BY_KEY[s.statKey];
    const score = Duel.mode === "daily" ? s.score : s.streak;
    const won = Duel.mode === "daily" && s.status === "won";
    const bestLine = Duel.mode === "practice"
      ? `<p class="r-meta">历史最高连击：${loadJSON("df_duel_best", 0)}</p>` : "";
    $("#duelResult").innerHTML = `
      <h2>${won ? "十轮全对，太强了！" : `答错了，连击定格在 ${score}`}</h2>
      <p class="r-meta">${left.name} ${stat.label} ${left[s.statKey]} ｜ ${right.name} ${stat.label} ${right[s.statKey]}</p>
      <p class="r-grade">评级 <b>${DFG.duelGrade(score, Duel.mode === "daily" ? DFG.DUEL_DAILY_ROUNDS : 0)}</b></p>
      ${bestLine}
      <div class="btn-row">
        <button class="btn" id="duelShareBtn">复制分享卡</button>
        <button class="btn ghost" id="duelAgainBtn">再来一局（随机 · 不限次）</button>
      </div>`;
    $("#duelResult").classList.remove("hidden");
    $("#duelShareBtn").onclick = () => copyText(DFG.buildDuelShare({
      date: TODAY, statLabel: stat.label, score, trail: s.trail, practice: Duel.mode === "practice",
    }));
    $("#duelAgainBtn").onclick = () => {
      duelNewPractice(); // 无缝重开随机题：每日题玩完也可不限次继续
      if (Duel.mode === "daily") duelSetMode("practice");
      else duelRender();
    };
  }

  const DUEL_REVEAL_MS = 1100; // 作答后公布双方数值的停留时长

  function duelAnswer(dir) {
    const s = dState();
    if (!s || s.status !== "playing" || Duel.locked) return;
    const [left, right] = dPair();
    const ok = DFG.duelJudge(dir, left, right, s.statKey);
    s.trail.push({ dir, ok });
    if (Duel.mode === "daily") {
      if (ok) {
        s.score++;
        // 答对也先公布双方数值，停留后进入下一轮
        Duel.locked = true;
        duelRender(true);
        setTimeout(() => {
          Duel.locked = false;
          s.pos++;
          if (s.pos >= DFG.DUEL_DAILY_ROUNDS) s.status = "won";
          dPersist();
          duelRender();
        }, DUEL_REVEAL_MS);
      } else {
        s.status = "lost";
        dPersist();
        duelRender(true); // 答错：揭示双方数值后结算
      }
    } else {
      if (ok) {
        s.streak++;
        Duel.locked = true;
        duelRender(true);
        setTimeout(() => {
          Duel.locked = false;
          s.leftId = s.rightId;
          s.rightId = DFG.duelNext(WEAPONS, right, s.statKey).id;
          duelRender();
        }, DUEL_REVEAL_MS);
      } else {
        s.status = "lost";
        const best = loadJSON("df_duel_best", 0);
        if (s.streak > best) store.set("df_duel_best", JSON.stringify(s.streak));
        duelRender(true);
      }
    }
  }

  function duelSetMode(mode) {
    Duel.mode = mode;
    if (mode === "practice" && !Duel.practice) duelNewPractice();
    syncModeTabs("duel");
    duelRender();
  }

  /* ================================================================
   * 玩法 4：火力排排坐
   * state = {statKey, ids:[5]（当前排列）, attempts:[marks...], status}
   * ================================================================ */
  const Sort = { mode: "daily", daily: null, practice: null, sel: -1 };

  function tState() { return Sort.mode === "daily" ? Sort.daily : Sort.practice; }
  function tCorrect() { return DFG.sortCorrect(tState().ids, byId, tState().statKey); }
  function tPersist() { if (Sort.mode === "daily") store.set(dkey("sort"), JSON.stringify(Sort.daily)); }

  function sortInit() {
    const q = DFG.sortDaily(TODAY, WEAPONS);
    const key = q.statKey + "|" + q.ids.slice().sort().join(",");
    const saved = loadJSON(dkey("sort"), null);
    if (saved && saved.statKey + "|" + saved.ids.slice().sort().join(",") === key) Sort.daily = saved;
    else Sort.daily = { statKey: q.statKey, ids: q.ids, attempts: [], status: "playing" };
  }

  function sortNewPractice() {
    const q = DFG.sortRandom(WEAPONS);
    Sort.practice = { statKey: q.statKey, ids: q.ids, attempts: [], status: "playing" };
  }

  function sortRender() {
    const s = tState();
    Sort.sel = -1;
    const stat = DFG.SORT_STATS.find((x) => x.key === s.statKey);
    $("#sortBanner").innerHTML = (Sort.mode === "daily"
      ? `今日题目 <b>#${TODAY}</b> · `
      : `练习模式 · `) + `点两张卡片交换位置 · 按 <b>${stat.label}</b> 从高到低（上高下低）`;
    const done = s.status !== "playing";
    $("#sortList").innerHTML = s.ids.map((id, i) => {
      const w = byId[id];
      return `<div class="tl-card ${done ? "done" : ""}" data-i="${i}">
        <span class="pos">${i + 1}</span>
        ${gunImgHTML(w)}
        <span class="tname">${w.name}<span class="ttype">${w.type}</span></span>
        ${done ? `<span class="tdate">${w[s.statKey]}</span>` : ""}
      </div>`;
    }).join("");
    if (!done) {
      $("#sortList").querySelectorAll(".tl-card").forEach((el) => {
        el.addEventListener("click", () => sortTap(Number(el.dataset.i)));
      });
    }
    const left = DFG.SORT_MAX_TRIES - s.attempts.length;
    $("#sortTries").innerHTML = `剩 <b>${left}</b> / ${DFG.SORT_MAX_TRIES} 次提交`;
    $("#sortSubmit").disabled = done;
    $("#sortAttempts").innerHTML = s.attempts.map((m) =>
      `<div class="tl-marks">${m.map((b) => (b ? "🟩" : "🟥")).join("")}</div>`).join("");
    if (done) sortRenderResult();
    else $("#sortResult").classList.add("hidden");
  }

  function sortTap(i) {
    if (Sort.sel === -1) {
      Sort.sel = i;
      $("#sortList").querySelectorAll(".tl-card")[i].classList.add("sel");
    } else if (Sort.sel === i) {
      Sort.sel = -1;
      $("#sortList").querySelectorAll(".tl-card")[i].classList.remove("sel");
    } else {
      const s = tState();
      [s.ids[Sort.sel], s.ids[i]] = [s.ids[i], s.ids[Sort.sel]];
      tPersist();
      sortRender();
    }
  }

  function sortSubmit() {
    const s = tState();
    if (s.status !== "playing") return;
    const marks = DFG.sortMarks(s.ids, tCorrect());
    s.attempts.push(marks);
    if (marks.every(Boolean)) s.status = "won";
    else if (s.attempts.length >= DFG.SORT_MAX_TRIES) {
      s.status = "lost";
      s.ids = tCorrect(); // 揭示正确顺序
    }
    tPersist();
    sortRender();
  }

  function sortRenderResult() {
    const s = tState();
    const stat = DFG.SORT_STATS.find((x) => x.key === s.statKey);
    const won = s.status === "won";
    $("#sortResult").innerHTML = `
      <h2>${won ? "排序正确！" : "手感尽失，正确顺序已揭示"}</h2>
      <p class="r-meta">${s.ids.map((id) => `${byId[id].name}（${byId[id][s.statKey]}）`).join(" → ")}</p>
      <p class="r-grade">${won ? s.attempts.length : "X"}/${DFG.SORT_MAX_TRIES} 次 · 评级 <b>${DFG.sortGrade(s.attempts.length, won)}</b></p>
      <div class="btn-row">
        <button class="btn" id="sortShareBtn">复制分享卡</button>
        <button class="btn ghost" id="sortAgainBtn">再来一题（随机 · 不限次）</button>
      </div>`;
    $("#sortResult").classList.remove("hidden");
    $("#sortShareBtn").onclick = () => copyText(DFG.buildSortShare({
      date: TODAY, statLabel: stat.label, attempts: s.attempts, won, practice: Sort.mode === "practice",
    }));
    $("#sortAgainBtn").onclick = () => {
      sortNewPractice(); // 无缝重开随机题：每日题玩完也可不限次继续
      if (Sort.mode === "daily") sortSetMode("practice");
      else sortRender();
    };
  }

  function sortSetMode(mode) {
    Sort.mode = mode;
    if (mode === "practice" && !Sort.practice) sortNewPractice();
    syncModeTabs("sort");
    sortRender();
  }

  /* ================================================================
   * 路由 / 模式切换 / 首页
   * ================================================================ */
  const VIEWS = {
    "": "home", "#/": "home",
    "#/smith": "smith", "#/guess": "guess", "#/duel": "duel", "#/sort": "sort",
  };
  const RENDER = { smith: smithRender, guess: guessRender, duel: duelRender, sort: sortRender };

  function route() {
    const view = VIEWS[location.hash] || "home";
    ["home", "smith", "guess", "duel", "sort"].forEach((v) =>
      $(`#view-${v}`).classList.toggle("hidden", v !== view));
    if (view === "home") renderHomeDots();
    else RENDER[view]();
    window.scrollTo(0, 0);
  }

  function syncModeTabs(game) {
    const mode = { smith: Smith.mode, guess: Guess.mode, duel: Duel.mode, sort: Sort.mode }[game];
    $$(`.mode-tabs[data-game="${game}"] .mode-tab`).forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === mode));
  }

  function renderHomeDots() {
    const checks = {
      smith: loadJSON(dkey("smith"), null),
      guess: loadJSON(dkey("guess"), null),
      duel: loadJSON(dkey("duel"), null),
      sort: loadJSON(dkey("sort"), null),
    };
    for (const [game, st] of Object.entries(checks)) {
      const done = st && (st.status === "won" || st.status === "lost");
      $(`#dot-${game}`).classList.toggle("done", !!done);
    }
  }

  // ---------- 启动 ----------
  function init() {
    smithInit();
    guessInit();
    duelInit();
    sortInit();
    guessBindInput();
    $("#smithNextBtn").addEventListener("click", smithNext);
    $("#duelHigher").addEventListener("click", () => duelAnswer("higher"));
    $("#duelLower").addEventListener("click", () => duelAnswer("lower"));
    $("#sortSubmit").addEventListener("click", sortSubmit);
    $$(".mode-tabs").forEach((tabs) => {
      const game = tabs.dataset.game;
      const setter = { smith: smithSetMode, guess: guessSetMode, duel: duelSetMode, sort: sortSetMode }[game];
      tabs.querySelectorAll(".mode-tab").forEach((b) =>
        b.addEventListener("click", () => setter(b.dataset.mode)));
    });
    window.addEventListener("hashchange", route);
    route();
  }

  init();
})();
