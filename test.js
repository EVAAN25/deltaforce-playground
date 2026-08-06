/* node 自测：数据完整性 / 六玩法每日确定性 / 题库校验 / 分享卡格式 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 数据 js 注入假 window（浏览器全局变量的 node 等价物）
const win = {};
for (const f of ["weapons", "attachments", "loot"]) {
  const code = fs.readFileSync(path.join(__dirname, "data", f + ".js"), "utf8");
  new Function("window", code)(win);
}
const { DF_WEAPONS, DF_ACC, DF_LOOT } = win;
assert(DF_WEAPONS && DF_ACC && DF_LOOT, "数据全局变量未正确挂载");

const DFG = require("./game.js");

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log("✓", name); }

const byId = {};
DF_WEAPONS.forEach((w) => { byId[w.id] = w; });
const accById = {};
DF_ACC.forEach((a) => { accById[a.id] = a; });
const LOOT_ITEMS = DF_LOOT.items;
const lootById = {};
LOOT_ITEMS.forEach((i) => { lootById[i.id] = i; });

// ---------- 数据完整性 ----------
ok("数据：weapons 50 把、id 唯一、数值字段齐全", () => {
  assert.strictEqual(DF_WEAPONS.length, 50);
  const ids = new Set();
  const TYPES = ["步枪", "冲锋枪", "精确射手步枪", "轻机枪", "手枪", "霰弹枪", "狙击步枪"];
  for (const w of DF_WEAPONS) {
    assert(w.id && w.name && TYPES.includes(w.type), "基本字段 " + w.id);
    for (const k of ["meatHarm", "armorHarm", "fireSpeed", "shootDistance", "recoil", "control", "stable", "hipShot", "capacity", "muzzleVelocity", "soundDistance"]) {
      assert.strictEqual(typeof w[k], "number", `${w.name} 缺 ${k}`);
    }
    assert(w.caliber && w.fireModes.length > 0, "口径/开火模式 " + w.name);
    assert(typeof w.desc === "string" && w.img, "desc/img " + w.name); // gtidb 新增枪暂无官方图鉴描述，desc 可为空串
    assert(!ids.has(w.id)); ids.add(w.id);
  }
});

ok("数据：attachments 392 件、id 唯一、9 个部位、有数值或效果文本", () => {
  assert.strictEqual(DF_ACC.length, 392);
  const ids = new Set();
  const slots = new Set();
  for (const a of DF_ACC) {
    assert(a.id && a.name && a.slot && a.slotCN, "基本字段 " + a.id);
    assert(Object.keys(a.stats).length + a.pros.length > 0, "既无数值也无效果 " + a.name);
    slots.add(a.slot);
    assert(!ids.has(a.id)); ids.add(a.id);
  }
  assert.strictEqual(slots.size, 9, "部位数 " + slots.size);
});

ok("数据：loot 253 件收集品、id 唯一、字段与数值合法、真实价格元信息齐全", () => {
  assert.strictEqual(LOOT_ITEMS.length, 253);
  const ids = new Set();
  const TYPES = ["工艺藏品", "工具材料", "电子物品", "医疗道具", "家居物品", "资料情报"];
  for (const i of LOOT_ITEMS) {
    assert(i.id && i.name, "基本字段 " + i.id);
    assert(Number.isInteger(i.grade) && i.grade >= 1 && i.grade <= 6, "品质 " + i.name);
    assert(TYPES.includes(i.type), "类型 " + i.name);
    assert(i.len > 0 && i.wid > 0 && i.cells === i.len * i.wid, "尺寸 " + i.name);
    assert(typeof i.priced === "boolean", "priced 标记 " + i.name);
    if (i.priced) {
      assert(Number.isInteger(i.value) && i.value > 0, "value " + i.name);
      assert(Number.isInteger(i.perCell) && i.perCell > 0, "perCell " + i.name);
    } else {
      assert(i.value === null && i.perCell === null, "未定价物品应无价值 " + i.name);
    }
    assert(typeof i.source === "string" && typeof i.desc === "string", "source/desc " + i.name);
    assert(i.img && i.remote, "img/remote " + i.name);
    assert(!ids.has(i.id)); ids.add(i.id);
  }
  // 价格元信息：来源与快照日期必须存在（页面据此注明）
  const meta = DF_LOOT.meta;
  assert(meta && meta.priceSource && /^\d{4}-\d{2}-\d{2}$/.test(meta.priceDate), "meta 价格来源/日期");
  assert.strictEqual(meta.pricedCount, DFG.lootPool(LOOT_ITEMS).length, "pricedCount 与题池一致");
  assert(meta.pricedCount >= 230, "可交易物品过少: " + meta.pricedCount);
  assert.strictEqual(meta.itemCount, LOOT_ITEMS.length);
  assert(Array.isArray(DF_LOOT.containers) && DF_LOOT.containers.length > 0, "容器为空");
  for (const c of DF_LOOT.containers) assert(c.name && c.w > 0 && c.h > 0 && c.tier > 0, "容器字段 " + c.name);
});

ok("数据：全部图片文件存在于本地 assets/", () => {
  for (const w of DF_WEAPONS) assert(fs.existsSync(path.join(__dirname, w.img)), "枪械图缺失 " + w.img);
  for (const a of DF_ACC) assert(fs.existsSync(path.join(__dirname, a.img)), "配件图缺失 " + a.img);
  for (const i of LOOT_ITEMS) assert(fs.existsSync(path.join(__dirname, i.img)), "物资图缺失 " + i.img);
});

// ---------- 每日确定性 ----------
const GPOOL_FOR_TEST = DFG.guessPool(DF_WEAPONS);

function next30Days() {
  const out = [];
  const d = new Date(2026, 0, 1);
  for (let i = 0; i < 30; i++) { out.push(DFG.dateStr(d)); d.setDate(d.getDate() + 1); }
  return out;
}

ok("确定性：六玩法同一日期两次结果相同", () => {
  const date = "2026-08-05";
  assert.deepStrictEqual(DFG.smithDaily(date, DF_ACC), DFG.smithDaily(date, DF_ACC));
  assert.strictEqual(DFG.guessDaily(date, GPOOL_FOR_TEST), DFG.guessDaily(date, GPOOL_FOR_TEST));
  assert.deepStrictEqual(DFG.duelDaily(date, DF_WEAPONS), DFG.duelDaily(date, DF_WEAPONS));
  assert.deepStrictEqual(DFG.sortDaily(date, DF_WEAPONS), DFG.sortDaily(date, DF_WEAPONS));
  assert.deepStrictEqual(DFG.lootDuelDaily(date, LOOT_ITEMS), DFG.lootDuelDaily(date, LOOT_ITEMS));
  assert.deepStrictEqual(DFG.lootSortDaily(date, LOOT_ITEMS), DFG.lootSortDaily(date, LOOT_ITEMS));
});

ok("确定性：连续 30 天结果不全部相同", () => {
  const days = next30Days();
  const sets = [
    new Set(days.map((d) => JSON.stringify(DFG.smithDaily(d, DF_ACC).map((r) => r.answerId)))),
    new Set(days.map((d) => DFG.guessDaily(d, GPOOL_FOR_TEST))),
    new Set(days.map((d) => DFG.duelDaily(d, DF_WEAPONS).chain.join(","))),
    new Set(days.map((d) => DFG.sortDaily(d, DF_WEAPONS).ids.join(","))),
    new Set(days.map((d) => DFG.lootDuelDaily(d, LOOT_ITEMS).chain.join(","))),
    new Set(days.map((d) => DFG.lootSortDaily(d, LOOT_ITEMS).ids.join(","))),
  ];
  sets.forEach((s, i) => assert(s.size > 1, `玩法 ${i} 30 天结果无变化`));
});

ok("确定性：不同游戏种子互不干扰（salt 独立）", () => {
  const days = next30Days();
  const salts = ["df-smith", "df-guess", "df-duel", "df-sort", "df-lootduel", "df-lootsort"];
  for (let i = 0; i < salts.length; i++) {
    for (let j = i + 1; j < salts.length; j++) {
      let diff = 0;
      for (const d of days) {
        if (DFG.dailyIndex(d, 100, salts[i]) !== DFG.dailyIndex(d, 100, salts[j])) diff++;
      }
      assert(diff > 20, `${salts[i]} 与 ${salts[j]} 疑似同源: 仅 ${diff}/30 天不同`);
    }
  }
});

ok("确定性：dateStr 本地日期格式", () => {
  assert.strictEqual(DFG.dateStr(new Date(2026, 7, 5)), "2026-08-05");
  assert.strictEqual(DFG.dateStr(new Date(2026, 0, 3)), "2026-01-03");
});

// ---------- 玩法 1：改枪大师 ----------
ok("改枪：可出题组合非空且每个组合满足 ≥4 件 ≥4 种取值", () => {
  const combos = DFG.smithCombos(DF_ACC);
  assert(combos.length >= 10, "组合过少: " + combos.length);
  for (const c of combos) {
    const items = DF_ACC.filter((a) => a.slot === c.slot && typeof a.stats[c.statKey] === "number");
    const values = new Set(items.map((a) => a.stats[c.statKey]));
    assert(items.length >= 4 && values.size >= 4, `组合不达标 ${c.slot}/${c.statKey}`);
    assert(DFG.SMITH_STAT_BY_KEY[c.statKey], "未知属性 " + c.statKey);
  }
  console.log("    （可出题组合 " + combos.length + " 个）");
});

ok("改枪：连续 30 天每天 5 轮、候选 4 件同部位、取值互异、答案唯一最大", () => {
  for (const d of next30Days()) {
    const rounds = DFG.smithDaily(d, DF_ACC);
    assert.strictEqual(rounds.length, DFG.SMITH_ROUNDS, "轮数不足 " + d);
    const combos = new Set();
    for (const r of rounds) {
      combos.add(r.slot + "|" + r.statKey);
      assert.strictEqual(r.candidates.length, 4);
      const items = r.candidates.map((id) => accById[id]);
      assert(items.every((a) => a.slot === r.slot), "候选部位不一致 " + d);
      const values = items.map((a) => a.stats[r.statKey]);
      assert.strictEqual(new Set(values).size, 4, "候选取值重复 " + d);
      const max = Math.max(...values);
      assert.strictEqual(values.filter((v) => v === max).length, 1, "最大值不唯一 " + d);
      assert.strictEqual(accById[r.answerId].stats[r.statKey], max, "答案不是最大值 " + d);
    }
    assert.strictEqual(combos.size, DFG.SMITH_ROUNDS, "组合重复 " + d);
  }
});

ok("改枪：判定、评级、分享卡格式（不含配件名）", () => {
  const rounds = DFG.smithDaily("2026-08-05", DF_ACC);
  const r0 = rounds[0];
  assert(DFG.smithJudge(r0, r0.answerId) === true);
  const wrongId = r0.candidates.find((id) => id !== r0.answerId);
  assert(DFG.smithJudge(r0, wrongId) === false);
  assert.strictEqual(DFG.smithGrade(5), "传奇枪械师");
  assert.strictEqual(DFG.smithGrade(4), "军械库常客");
  assert.strictEqual(DFG.smithGrade(3), "改枪学徒");
  assert.strictEqual(DFG.smithGrade(2), "烧火棍师傅");
  const t = DFG.buildSmithShare({
    date: "2026-08-05", score: 3,
    rounds: [{ slotCN: "枪口", ok: true }, { slotCN: "枪管", ok: false }, { slotCN: "枪托", ok: true }],
  });
  assert(t.includes(DFG.SITE_URL) && t.includes("🔧 3/5"));
  assert(t.split("\n").includes("🟩🟥🟩"));
  for (const r of rounds) for (const id of r.candidates) assert(!t.includes(accById[id].name), "泄露配件名");
  console.log("---- 改枪大师分享卡示例 ----\n" + t + "\n----------------------------");
});

// ---------- 玩法 2：猜枪械 ----------
ok("猜枪：题池 50 把、名字唯一", () => {
  assert.strictEqual(GPOOL_FOR_TEST.length, 50);
  const names = new Set(GPOOL_FOR_TEST.map((w) => w.name));
  assert.strictEqual(names.size, 50, "存在重名枪械");
});

ok("猜枪：比对全同全绿、箭头方向、文本维度、开火模式集合相等", () => {
  const a = byId["18010000001"]; // M4A1突击步枪
  assert(a, "M4A1 不在题池");
  const self = DFG.guessCompare(a, a);
  assert(self.win);
  for (const k of DFG.GUESS_CELL_ORDER) assert.strictEqual(self.cells[k].status, "green", k);
  // 构造目标：伤害/射速更高 → 应给 up；反向给 down
  const fakeTarget = Object.assign({}, a, { id: "fake_t", meatHarm: 99, fireSpeed: 999, shootDistance: 99, capacity: 99 });
  const r = DFG.guessCompare(a, fakeTarget);
  assert.strictEqual(r.cells.meatHarm.status, "up");
  assert.strictEqual(r.cells.fireSpeed.status, "up");
  assert.strictEqual(r.cells.shootDistance.status, "up");
  assert.strictEqual(r.cells.capacity.status, "up");
  const r2 = DFG.guessCompare(fakeTarget, a);
  assert.strictEqual(r2.cells.meatHarm.status, "down");
  // 开火模式顺序无关
  const b = Object.assign({}, a, { id: "fake_b", fireModes: ["单发", "全自动"] });
  assert.strictEqual(DFG.guessCompare(a, b).cells.fireMode.status, "green");
  const c = Object.assign({}, a, { id: "fake_c", fireModes: ["单发"] });
  assert.strictEqual(DFG.guessCompare(a, c).cells.fireMode.status, "red");
  assert(DFG.fireModeEqual(["全自动", "单发"], ["单发", "全自动"]));
  assert(!DFG.fireModeEqual(["全自动"], ["单发", "全自动"]));
});

ok("猜枪：评级档位", () => {
  assert.strictEqual(DFG.guessGrade(1, true), "读枪神探");
  assert.strictEqual(DFG.guessGrade(3, true), "军械专家");
  assert.strictEqual(DFG.guessGrade(5, true), "靶场常客");
  assert.strictEqual(DFG.guessGrade(6, true), "压线过关");
  assert.strictEqual(DFG.guessGrade(6, false), "烧火棍都认不出");
});

ok("猜枪：分享卡含 SITE_URL、每行 7 格、未完成不含答案名", () => {
  const targetId = DFG.guessDaily("2026-08-05", GPOOL_FOR_TEST);
  const target = byId[targetId];
  const others = GPOOL_FOR_TEST.filter((w) => w.id !== targetId).slice(0, 2);
  const results = [...others.map((w) => DFG.guessCompare(w, target)), DFG.guessCompare(target, target)];
  const t = DFG.buildGuessShare({ date: "2026-08-05", results, won: true });
  assert(t.includes(DFG.SITE_URL));
  const lines = t.split("\n");
  assert(lines[1].includes("3/6"));
  const grid = lines.slice(2, 5);
  for (const row of grid) {
    const cells = [...row].filter((ch) => "🟩🟥⬆⬇".includes(ch));
    assert.strictEqual(cells.length, 7, "每行 7 格: " + row);
  }
  const mid = DFG.buildGuessShare({ date: "2026-08-05", results: results.slice(0, 1), won: false });
  assert(!mid.includes(target.name), "泄露答案名");
});

// ---------- 玩法 3：枪械对决 ----------
ok("对决：连续 30 天每日链 11 把、属性合法、相邻取值不同", () => {
  for (const d of next30Days()) {
    const q = DFG.duelDaily(d, DF_WEAPONS);
    assert(DFG.DUEL_STAT_BY_KEY[q.statKey], "未知属性 " + q.statKey);
    assert.strictEqual(q.chain.length, DFG.DUEL_DAILY_ROUNDS + 1, "链长度不足 " + d);
    const chain = q.chain.map((id) => byId[id]);
    for (let i = 0; i + 1 < chain.length; i++) {
      assert(DFG.duelPairable(chain[i], chain[i + 1], q.statKey), `相邻不可配对 ${d}#${i}`);
    }
  }
});

ok("对决：判定、随机下家、评级、分享卡", () => {
  const a = { id: "a", meatHarm: 30 };
  const b = { id: "b", meatHarm: 40 };
  assert(DFG.duelJudge("higher", a, b, "meatHarm") === true);
  assert(DFG.duelJudge("lower", a, b, "meatHarm") === false);
  assert(DFG.duelJudge("lower", b, a, "meatHarm") === true);
  const q = DFG.duelRandom(DF_WEAPONS);
  const left = byId[q.leftId], right = byId[q.rightId];
  assert(DFG.duelPairable(left, right, q.statKey));
  const nxt = DFG.duelNext(DF_WEAPONS, left, q.statKey);
  assert(DFG.duelPairable(nxt, left, q.statKey));
  assert.strictEqual(DFG.duelGrade(10, 10), "行走的数据库");
  assert.strictEqual(DFG.duelGrade(7, 10), "军械分析师");
  assert.strictEqual(DFG.duelGrade(4, 10), "枪械爱好者");
  assert.strictEqual(DFG.duelGrade(1, 10), "回去练枪法");
  const t = DFG.buildDuelShare({
    date: "2026-08-05", statLabel: "伤害", score: 2,
    trail: [{ dir: "higher", ok: true }, { dir: "lower", ok: true }, { dir: "higher", ok: false }],
  });
  assert(t.includes(DFG.SITE_URL) && t.includes("⚔️×2/10") && t.includes("伤害"));
  assert(t.includes("⬆️✔️⬇️✔️⬆️❌"));
});

// ---------- 玩法 4：火力排排坐 ----------
ok("排排坐：连续 30 天每天 5 把、属性合法、取值两两不同、初始非正解", () => {
  for (const d of next30Days()) {
    const q = DFG.sortDaily(d, DF_WEAPONS);
    assert(DFG.SORT_STATS.some((s) => s.key === q.statKey), "未知属性 " + q.statKey);
    assert.strictEqual(q.ids.length, 5);
    assert.strictEqual(new Set(q.ids).size, 5);
    const values = q.ids.map((id) => byId[id][q.statKey]);
    assert.strictEqual(new Set(values).size, 5, "取值重复 " + d);
    const correct = DFG.sortCorrect(q.ids, byId, q.statKey);
    assert(!DFG.sortMarks(q.ids, correct).every(Boolean), "初始即正解 " + d);
  }
});

ok("排排坐：marks 全对/部分对、评级、分享卡不含枪名", () => {
  const q = DFG.sortDaily("2026-08-05", DF_WEAPONS);
  const correct = DFG.sortCorrect(q.ids, byId, q.statKey);
  assert.deepStrictEqual(DFG.sortMarks(correct, correct), [true, true, true, true, true]);
  const partial = correct.slice();
  [partial[0], partial[1]] = [partial[1], partial[0]];
  assert.deepStrictEqual(DFG.sortMarks(partial, correct), [false, false, true, true, true]);
  assert.strictEqual(DFG.sortGrade(1, true), "人形测速仪");
  assert.strictEqual(DFG.sortGrade(2, true), "数据党");
  assert.strictEqual(DFG.sortGrade(3, true), "蒙的不错");
  assert.strictEqual(DFG.sortGrade(3, false), "手感尽失");
  const t = DFG.buildSortShare({
    date: "2026-08-05", statLabel: "射速", won: false,
    attempts: [[true, false, false, true, false], [false, true, false, true, false]],
  });
  assert(t.includes(DFG.SITE_URL) && t.includes("射速"));
  assert(t.split("\n").includes("🟩🟥🟥🟩🟥"));
  for (const id of q.ids) assert(!t.includes(byId[id].name), "泄露枪名 " + byId[id].name);
});

// ---------- 玩法 5：摸金对决 ----------
ok("摸金对决：连续 30 天每日链 11 件、维度合法、相邻取值不同、全部已定价", () => {
  for (const d of next30Days()) {
    const q = DFG.lootDuelDaily(d, LOOT_ITEMS);
    assert(DFG.LOOT_STAT_BY_KEY[q.statKey], "未知维度 " + q.statKey);
    assert.strictEqual(q.chain.length, DFG.LOOT_DUEL_ROUNDS + 1, "链长度不足 " + d);
    const chain = q.chain.map((id) => lootById[id]);
    assert(chain.every((i) => i.priced), "链里混入未定价物品 " + d);
    for (let i = 0; i + 1 < chain.length; i++) {
      assert(DFG.lootDuelPairable(chain[i], chain[i + 1], q.statKey), `相邻不可配对 ${d}#${i}`);
    }
  }
  // 13 件未定价物品（火箭燃料等）不得进入题池
  const pool = DFG.lootPool(LOOT_ITEMS);
  assert(!pool.some((i) => i.name === "火箭燃料"), "未定价物品入池");
});

ok("摸金对决：判定、随机下家、格式化、评级、分享卡不含物品名", () => {
  const a = { id: "a", value: 3000, perCell: 3000 };
  const b = { id: "b", value: 4000, perCell: 1000 };
  assert(DFG.lootDuelJudge("higher", a, b, "value") === true);
  assert(DFG.lootDuelJudge("lower", a, b, "value") === false);
  assert(DFG.lootDuelJudge("higher", a, b, "perCell") === false); // 维度切换判定独立
  assert(DFG.lootDuelJudge("lower", a, b, "perCell") === true);
  const q = DFG.lootDuelRandom(LOOT_ITEMS);
  const left = lootById[q.leftId], right = lootById[q.rightId];
  assert(DFG.lootDuelPairable(left, right, q.statKey));
  const nxt = DFG.lootDuelNext(LOOT_ITEMS, left, q.statKey);
  assert(DFG.lootDuelPairable(nxt, left, q.statKey));
  assert.strictEqual(DFG.formatLoot(4209300), "420.9万");
  assert.strictEqual(DFG.formatLoot(10567300), "1056.7万");
  assert.strictEqual(DFG.formatLoot(19800000), "1980万");
  assert.strictEqual(DFG.formatLoot(8600), "8600");
  assert.strictEqual(DFG.lootDuelGrade(10, 10), "传说拾荒王");
  assert.strictEqual(DFG.lootDuelGrade(7, 10), "摸金校尉");
  assert.strictEqual(DFG.lootDuelGrade(4, 10), "垃圾佬");
  assert.strictEqual(DFG.lootDuelGrade(1, 10), "白给小子");
  const t = DFG.buildLootDuelShare({
    date: "2026-08-05", statLabel: "总价值", score: 2,
    trail: [{ dir: "higher", ok: true }, { dir: "lower", ok: true }, { dir: "higher", ok: false }],
  });
  assert(t.includes(DFG.SITE_URL) && t.includes("💰×2/10") && t.includes("总价值"));
  assert(t.includes("⬆️✔️⬇️✔️⬆️❌"));
  // 输赢都有分享卡：上面是中途败北（won=false 语义由调用方保证），再验证全胜文案
  const winCard = DFG.buildLootDuelShare({
    date: "2026-08-05", statLabel: "单格价值", score: 10,
    trail: Array(10).fill({ dir: "higher", ok: true }),
  });
  assert(winCard.includes("💰×10/10") && winCard.includes("传说拾荒王"));
  const daily = DFG.lootDuelDaily("2026-08-05", LOOT_ITEMS);
  for (const id of daily.chain) assert(!t.includes(lootById[id].name), "泄露物品名 " + lootById[id].name);
  console.log("---- 摸金对决分享卡示例 ----\n" + t + "\n----------------------------");
});

// ---------- 玩法 6：物资排排坐 ----------
ok("物资排排坐：连续 30 天每天 5 件、维度合法、取值两两不同、初始非正解", () => {
  for (const d of next30Days()) {
    const q = DFG.lootSortDaily(d, LOOT_ITEMS);
    assert(DFG.LOOT_STAT_BY_KEY[q.statKey], "未知维度 " + q.statKey);
    assert.strictEqual(q.ids.length, 5);
    assert.strictEqual(new Set(q.ids).size, 5);
    const values = q.ids.map((id) => lootById[id][q.statKey]);
    assert.strictEqual(new Set(values).size, 5, "取值重复 " + d);
    const correct = DFG.sortCorrect(q.ids, lootById, q.statKey);
    assert(!DFG.sortMarks(q.ids, correct).every(Boolean), "初始即正解 " + d);
  }
});

ok("物资排排坐：评级、分享卡格式（输赢都有）不含物品名", () => {
  assert.strictEqual(DFG.lootSortGrade(1, true), "人形估价器");
  assert.strictEqual(DFG.lootSortGrade(2, true), "交易所老炮");
  assert.strictEqual(DFG.lootSortGrade(3, true), "蒙的不错");
  assert.strictEqual(DFG.lootSortGrade(3, false), "看走眼了");
  const q = DFG.lootSortDaily("2026-08-05", LOOT_ITEMS);
  const lose = DFG.buildLootSortShare({
    date: "2026-08-05", statLabel: "单格价值", won: false,
    attempts: [[true, false, false, true, false], [false, true, false, true, false]],
  });
  assert(lose.includes(DFG.SITE_URL) && lose.includes("单格价值") && lose.includes("📦 X/3"));
  assert(lose.split("\n").includes("🟩🟥🟥🟩🟥"));
  const win = DFG.buildLootSortShare({
    date: "2026-08-05", statLabel: "总价值", won: true,
    attempts: [[true, true, true, true, true]],
  });
  assert(win.includes("📦 1/3") && win.includes("人形估价器"));
  for (const id of q.ids) {
    assert(!lose.includes(lootById[id].name), "泄露物品名 " + lootById[id].name);
    assert(!win.includes(lootById[id].name), "泄露物品名 " + lootById[id].name);
  }
});

// ---------- 通用搜索 ----------
ok("搜索：前缀优先、本名命中（M4 → M4A1突击步枪）、排除已猜、空串为空", () => {
  const r = DFG.search(GPOOL_FOR_TEST, "M4", []);
  assert(r.length > 0, "M4 无命中");
  assert(r[0].name.startsWith("M4"), "首条不是 M4 前缀: " + r[0].name);
  assert.strictEqual(DFG.gunBase("M4A1突击步枪"), "M4A1");
  assert.strictEqual(DFG.gunBase("SR-3M紧凑突击步枪"), "SR-3M紧凑");
  assert.strictEqual(DFG.search(GPOOL_FOR_TEST, "", []).length, 0);
  const ex = DFG.search(GPOOL_FOR_TEST, "M4", [r[0].id]);
  assert(!ex.some((w) => w.id === r[0].id));
});

console.log(`\n全部通过：${passed} 项`);
