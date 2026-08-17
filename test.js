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

// ---------- 玩法 7：鼠鼠摸金 ----------
const DFR = require("./raid.js");

ok("鼠鼠摸金：容器 28 种三档齐全、掉落权重各 tier 归一", () => {
  assert.strictEqual(DF_LOOT.containers.length, 28);
  const tiers = new Set(DF_LOOT.containers.map((c) => c.tier));
  assert.deepStrictEqual([...tiers].sort(), [1, 5, 6]);
  for (const c of DF_LOOT.containers) {
    assert(c.id != null && c.name && c.w > 0 && c.h > 0, "容器字段 " + c.id);
  }
  for (const t of [1, 5, 6]) {
    const w = DF_LOOT.dropWeights[t];
    assert(w, "缺 tier " + t + " 权重");
    let sum = 0;
    for (const g of [1, 2, 3, 4, 5, 6]) { assert(typeof w[g] === "number" && w[g] >= 0); sum += w[g]; }
    assert(Math.abs(sum - 1) < 1e-9, `tier ${t} 权重和 ${sum}`);
  }
});

ok("鼠鼠摸金：多种子地图全连通（出生点可达所有容器与撤离点）", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const map = DFR.generateRaid(seed, DF_LOOT);
    assert.strictEqual(map.w, DFR.MAP_W); assert.strictEqual(map.h, DFR.MAP_H);
    assert(DFR.validateMap(map), "地图不连通 seed=" + seed);
    assert.strictEqual(map.extracts.length, 2, "撤离点数 " + seed);
    assert(map.containers.length >= 10 && map.containers.length <= 14, "容器数 " + map.containers.length);
    const t6 = map.containers.filter((c) => c.tier === 6).length;
    const t5 = map.containers.filter((c) => c.tier === 5).length;
    assert.strictEqual(t6, 2, "tier6 数 " + seed);
    assert.strictEqual(t5, 4, "tier5 数 " + seed);
    assert(map.patrols.length >= 2 && map.patrols.length <= 3, "巡逻队数 " + seed);
    for (const p of map.patrols) {
      assert(p.path.length >= 4 && (p.radius === 3 || p.radius === 4));
      // 巡逻路线必须远离撤离点，否则撤离引导被压死、没法撤离
      for (const t of p.path) for (const e of map.extracts) {
        assert(Math.abs(t.x - e.x) + Math.abs(t.y - e.y) >= 3,
          `巡逻贴撤离点 seed=${seed} (${t.x},${t.y})->(${e.x},${e.y})`);
      }
    }
  }
});

ok("鼠鼠摸金：全关卡地图生成合法（尺寸/难度参数生效、巡逻不贴撤离点、关卡互不相同）", () => {
  DFR.LEVELS.forEach((lv, i) => {
    const map = DFR.generateRaid(DFG.hash32("df-raid-level:" + lv.id), DF_LOOT, lv.cfg);
    assert.strictEqual(map.w, lv.cfg.w, lv.id + " 宽");
    assert.strictEqual(map.h, lv.cfg.h, lv.id + " 高");
    assert(DFR.validateMap(map), lv.id + " 不连通");
    assert(map.patrols.length >= lv.cfg.patrols[0] && map.patrols.length <= lv.cfg.patrols[1], lv.id + " 巡逻数");
    assert(map.containers.length >= lv.cfg.total[0], lv.id + " 容器数");
    const t6 = map.containers.filter((c) => c.tier === 6).length;
    assert.strictEqual(t6, lv.cfg.tiers.filter((t) => t === 6).length, lv.id + " tier6 数");
    assert(Array.isArray(lv.cfg.bag) && Array.isArray(lv.cfg.safe), lv.id + " 缺 bag/safe 配置");
    if (i > 0) { // 背包/安全箱格数沿关卡单调不减（梯度）
      const prev = DFR.LEVELS[i - 1].cfg;
      assert(lv.cfg.bag[0] * lv.cfg.bag[1] >= prev.bag[0] * prev.bag[1], lv.id + " 背包梯度倒退");
      assert(lv.cfg.safe[0] * lv.cfg.safe[1] >= prev.safe[0] * prev.safe[1], lv.id + " 安全箱梯度倒退");
    }
    for (const p of map.patrols) for (const t of p.path) for (const e of map.extracts)
      assert(Math.abs(t.x - e.x) + Math.abs(t.y - e.y) >= 3, lv.id + " 巡逻贴撤离点");
    if (i > 0) {
      const prev = DFR.generateRaid(DFG.hash32("df-raid-level:" + DFR.LEVELS[i - 1].id), DF_LOOT, DFR.LEVELS[i - 1].cfg);
      assert.notDeepStrictEqual(map.tiles, prev.tiles, "相邻关卡地图雷同");
    }
  });
});

ok("鼠鼠摸金：每日种子确定性（同种子同图，掉落开箱随机）", () => {
  const seed = DFR.dailySeed("2026-08-05");
  const m1 = DFR.generateRaid(seed, DF_LOOT);
  const m2 = DFR.generateRaid(seed, DF_LOOT);
  assert.strictEqual(JSON.stringify(m1), JSON.stringify(m2), "同种子地图不同");
  // rollContainer 本身仍是确定性函数（同一 rng 序列同结果），游戏内则以 Math.random 现场开箱
  const c = m1.containers[0];
  const d1 = DFR.rollContainer(DFG.mulberry32(42), c, DF_LOOT);
  const d2 = DFR.rollContainer(DFG.mulberry32(42), c, DF_LOOT);
  assert.strictEqual(JSON.stringify(d1.map((d) => d.item.id)), JSON.stringify(d2.map((d) => d.item.id)), "rollContainer 不确定性");
  // 不同日期种子不同
  assert.notStrictEqual(DFR.dailySeed("2026-08-05"), DFR.dailySeed("2026-08-06"));
});

ok("鼠鼠摸金：roll 掉落件数/边界/不重叠/品质合法", () => {
  const map = DFR.generateRaid(DFR.dailySeed("2026-08-05"), DF_LOOT);
  for (const c of map.containers) {
    const rng = DFG.mulberry32(12345 + c.cid);
    const drops = DFR.rollContainer(rng, c, DF_LOOT);
    const cells = c.w * c.h;
    assert(drops.length >= 1 && drops.length <= cells, `件数越界 ${c.name}: ${drops.length}`);
    const occ = new Set();
    for (const d of drops) {
      assert(d.item.grade >= 1 && d.item.grade <= 6, "品质 " + d.item.grade);
      assert(d.x >= 0 && d.y >= 0 && d.x + d.w <= c.w && d.y + d.h <= c.h, "出界 " + d.item.name);
      assert.strictEqual(d.w * d.h, d.item.cells, "面积不符 " + d.item.name);
      for (let dy = 0; dy < d.h; dy++) for (let dx = 0; dx < d.w; dx++) {
        const k = (d.x + dx) + "," + (d.y + dy);
        assert(!occ.has(k), "重叠 " + k);
        occ.add(k);
      }
    }
  }
});

ok("鼠鼠摸金：容器产出池约束（类别/品质上限，2026-08-10 小涛查模拟器采样校准）", () => {
  const byName = Object.fromEntries(DF_LOOT.containers.map((c) => [c.name, c]));
  // 每个容器都要定义产出池
  for (const c of DF_LOOT.containers) assert(c.types && c.types.length >= 1, "缺产出池 " + c.name);
  const rollN = (c, n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(...DFR.rollContainer(DFG.mulberry32(i * 7919 + c.id), c, DF_LOOT));
    return out.map((d) => d.item);
  };
  // 专属池：大/小保险箱只出工艺藏品，服务器/电脑机箱只出电子，医疗物资堆只出医疗
  for (const [name, types] of [["大保险箱", ["工艺藏品"]], ["小保险箱", ["工艺藏品"]], ["服务器", ["电子物品"]], ["电脑机箱", ["电子物品"]], ["医疗物资堆", ["医疗道具"]], ["高级旅行箱", ["家居物品"]]]) {
    const items = rollN(byName[name], 60);
    assert(items.length > 30, name + " 样本太少");
    for (const it of items) assert(types.includes(it.type), `${name} 出了池外类别 ${it.name}(${it.type})`);
  }
  // 井盖不出红（maxGrade 5）；鸟窝池含红（"鸟窝出非洲之心"梗，采样有红）
  for (const it of rollN(byName["井盖"], 60)) assert(it.grade <= 5, "井盖出红 " + it.name);
  const nest6 = DF_LOOT.items.filter((it) => it.grade === 6 && it.value != null && byName["鸟窝"].types.includes(it.type));
  assert(nest6.length > 0, "鸟窝池应含红");
  // 全容器通用：roll 结果永远不出池、不超品质上限
  for (const c of DF_LOOT.containers) {
    for (const it of rollN(c, 30)) {
      assert(c.types.includes(it.type), `${c.name} 出池外 ${it.name}(${it.type})`);
      assert(!c.maxGrade || it.grade <= c.maxGrade, `${c.name} 超品质上限 ${it.name}`);
    }
  }
});

ok("鼠鼠摸金：逐物品实测权重 + 品质上浮（2026-08-10 采样基准）", () => {
  const byName = Object.fromEntries(DF_LOOT.containers.map((c) => [c.name, c]));
  // 24 个采样容器带逐物品权重；大武器箱/弹药箱（真池=枪弹）+模拟器未收录 4 容器回退老逻辑
  const withDrops = DF_LOOT.containers.filter((c) => c.rates);
  assert.strictEqual(withDrops.length, 22, "采样容器数");
  for (const name of ["大武器箱", "弹药箱", "三角蚌", "金币堆", "放射性储物箱", "工业金属储物箱"]) {
    assert(!byName[name].rates, name + " 应回退老逻辑");
  }
  const rollN = (c, n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(...DFR.rollContainer(DFG.mulberry32(i * 7919 + c.id), c, DF_LOOT));
    return out.map((d) => d.item);
  };
  // 小保险箱实测每开 1 件 → 游戏内 1~2 件
  const small = byName["小保险箱"];
  for (let i = 0; i < 30; i++) {
    const n = DFR.rollContainer(DFG.mulberry32(i), small, DF_LOOT).length;
    assert(n >= 1 && n <= 2, "小保险箱件数 " + n);
  }
  // 大保险箱：常见货（黄金饰章）必须远比非洲之心多；上浮后红率应高于实测基准 4.96%
  const drops = rollN(byName["大保险箱"], 400);
  const cnt = (n) => drops.filter((d) => d.name === n).length;
  assert(cnt("黄金饰章") > cnt("非洲之心") * 5, "常见/极稀有相对频率失真");
  const red = drops.filter((d) => d.grade === 6).length / drops.length;
  assert(red > 0.06 && red < 0.25, `上浮后红率 ${(red * 100).toFixed(1)}% 不在合理区间`);
});

ok("鼠鼠摸金：first-fit 装箱正确性（含旋转与放不下失败）", () => {
  const bag = DFR.makeBag(2, 2);
  const cell = { id: 1, name: "单格", grade: 1, len: 1, wid: 1, cells: 1, value: 100, perCell: 100 };
  const bar = { id: 2, name: "长条", grade: 2, len: 2, wid: 1, cells: 2, value: 200, perCell: 100 };
  const big = { id: 3, name: "大件", grade: 5, len: 3, wid: 2, cells: 6, value: 999, perCell: 166 };
  assert(DFR.addToBag(bag, cell));
  assert(DFR.addToBag(bag, bar)); // 剩 1×2 竖条空间，2×1 横条靠旋转放入
  assert.strictEqual(bag.items.length, 2);
  assert(!DFR.addToBag(bag, big), "3×2 不该放进 2×2");
  assert(!DFR.addToBag(bag, bar), "只剩 1 格，长条放不下");
  assert(DFR.addToBag(bag, cell), "最后一格能塞单格");
  assert(!DFR.addToBag(bag, cell), "满了再放必须失败");
  assert.strictEqual(DFR.bagValue(bag), 100 + 200 + 100);
  DFR.removeFromBag(bag, 0);
  assert.strictEqual(DFR.bagValue(bag), 300);
  assert(DFR.addToBag(bag, cell), "丢弃后空格可复用");
  // 占用表与物品列表一致
  const occCount = bag.occ.flat().filter(Boolean).length;
  assert.strictEqual(occCount, bag.items.reduce((s, e) => s + e.w * e.h, 0));
});

ok("鼠鼠摸金：智能入包（first-fit 失败时自动整理背包）", () => {
  const cell = (id) => ({ id, name: "单格" + id, grade: 1, len: 1, wid: 1, cells: 1, value: 100, perCell: 100 });
  const h2 = { id: 10, name: "横条", grade: 2, len: 2, wid: 1, cells: 2, value: 200, perCell: 100 };
  const v2 = { id: 11, name: "竖条", grade: 2, len: 1, wid: 2, cells: 2, value: 200, perCell: 100 };
  // 4×2 包摆满后挖掉两个对角格：空格互不相邻，first-fit（含旋转）放不下任何 2 格件
  const bag = DFR.makeBag(4, 2);
  DFR.addToBag(bag, Object.assign({}, h2, { id: 20 })); // (0,0)-(1,0)
  DFR.addToBag(bag, cell(21));                          // (2,0)
  DFR.addToBag(bag, cell(22));                          // (3,0)
  DFR.addToBag(bag, Object.assign({}, h2, { id: 23 })); // (0,1)-(1,1)
  DFR.addToBag(bag, cell(24));                          // (2,1)
  DFR.addToBag(bag, cell(25));                          // (3,1)
  DFR.removeFromBag(bag, 1); // 挖掉 (2,0)
  DFR.removeFromBag(bag, 4); // 挖掉 (3,1) → 空格 (2,0) 与 (3,1) 对角不相邻
  assert(!DFR.addToBag(bag, Object.assign({}, v2)), "前提：对角空格 first-fit 放不下竖条");
  const r = DFR.addToBagSmart(bag, Object.assign({}, v2));
  assert.strictEqual(r, 2, "整理后应能放入");
  assert.strictEqual(bag.items.length, 5, "5 件全在包里");
  // 重排后占用表与物品一致、无重叠
  const occ = DFR.makeGrid(4, 2, 0);
  for (const e of bag.items) for (let dy = 0; dy < e.h; dy++) for (let dx = 0; dx < e.w; dx++) {
    assert(!occ[e.y + dy][e.x + dx], "重排后重叠");
    occ[e.y + dy][e.x + dx] = 1;
  }
  assert.strictEqual(occ.flat().filter(Boolean).length, 8, "4×2 应占满");
  // 真放不下时不动包
  const full = DFR.makeBag(2, 2);
  DFR.addToBag(full, Object.assign({}, h2, { id: 30 }));
  DFR.addToBag(full, Object.assign({}, h2, { id: 31 }));
  assert.strictEqual(DFR.addToBagSmart(full, cell(32)), 0, "总面积超了整理也放不下");
  assert.strictEqual(full.items.length, 2, "失败后原包不变");
});

ok("鼠鼠摸金：包内指定格挪位（canPlaceAt / placeAt）", () => {
  const cell = { id: 1, name: "单格", grade: 1, len: 1, wid: 1, cells: 1, value: 100, perCell: 100 };
  const h2 = { id: 2, name: "横条", grade: 2, len: 2, wid: 1, cells: 2, value: 200, perCell: 100 };
  const bag = DFR.makeBag(4, 2);
  DFR.addToBag(bag, h2);   // idx0 (0,0)-(1,0)
  DFR.addToBag(bag, cell); // idx1 (2,0)
  assert(DFR.canPlaceAt(bag, 0, 1, 0) === false, "挪到别人头上不行");
  assert(DFR.canPlaceAt(bag, 0, 0, 1), "挪到空行可以");
  assert(DFR.canPlaceAt(bag, 0, 3, 0) === false, "出界不行");
  assert(DFR.canPlaceAt(bag, 0, 0, 0), "原位可以");
  assert(DFR.placeAt(bag, 0, 2, 1), "挪到 (2,1)");
  assert.strictEqual(bag.items[0].x, 2);
  assert.strictEqual(bag.items[0].y, 1);
  assert(!bag.occ[0][0] && bag.occ[1][2] && bag.occ[1][3], "占用表同步");
  assert(!DFR.placeAt(bag, 1, 2, 1), "挪到被占格失败");
  assert.strictEqual(bag.items[1].x, 2, "失败后位置不变");
  assert.strictEqual(bag.items[1].y, 0);
});

ok("鼠鼠摸金：包内挪位横竖切换（placeAt rot）", () => {
  const h2 = { id: 1, name: "横条", grade: 2, len: 2, wid: 1, cells: 2, value: 200, perCell: 100 };
  const bag = DFR.makeBag(3, 3);
  DFR.addToBag(bag, h2); // (0,0)-(1,0)，w=2 h=1
  assert(DFR.canPlaceAt(bag, 0, 2, 0, true), "右侧竖放可以");
  assert(!DFR.canPlaceAt(bag, 0, 2, 2, true), "竖放出界不行");
  assert(DFR.placeAt(bag, 0, 2, 0, true), "原地右侧旋转竖放");
  assert.strictEqual(bag.items[0].w, 1, "旋转后宽 1");
  assert.strictEqual(bag.items[0].h, 2, "旋转后高 2");
  assert(bag.occ[0][2] && bag.occ[1][2] && !bag.occ[0][0] && !bag.occ[0][1], "占用表按新形状同步");
  assert(DFR.placeAt(bag, 0, 0, 1, true), "再旋回横放挪到 (0,1)");
  assert.strictEqual(bag.items[0].w, 2);
  assert.strictEqual(bag.items[0].h, 1);
  assert(bag.occ[1][0] && bag.occ[1][1] && !bag.occ[0][2], "占用表还原");
  // 正方形旋转无实际变化但也不出错
  const sq = { id: 2, name: "方块", grade: 1, len: 1, wid: 1, cells: 1, value: 50, perCell: 50 };
  DFR.addToBag(bag, sq);
  const i1 = bag.items.length - 1;
  assert(DFR.placeAt(bag, i1, 0, 0, true), "单格旋转=原样");
  assert.strictEqual(bag.items[i1].w, 1);
});

ok("鼠鼠摸金：拖拽互换位置（placeOrSwap）", () => {
  const mk = (id, l, w) => ({ id, name: "物" + id, grade: 2, len: l, wid: w, cells: l * w, value: 100, perCell: 50 });
  const occOK = (bag) => {
    const occ = DFR.makeGrid(bag.w, bag.h, 0);
    for (const e of bag.items) for (let dy = 0; dy < e.h; dy++) for (let dx = 0; dx < e.w; dx++) {
      if (occ[e.y + dy][e.x + dx]) return false;
      occ[e.y + dy][e.x + dx] = 1;
    }
    return bag.occ.flat().filter(Boolean).length === bag.items.reduce((s, e) => s + e.w * e.h, 0);
  };
  // A=2×1 在 (0,0)，B=1×1 在 (2,0)：A 拖到 (2,0) → 互换
  let bag = DFR.makeBag(4, 2);
  DFR.addToBag(bag, mk(1, 2, 1));
  DFR.addToBag(bag, mk(2, 1, 1));
  assert.strictEqual(DFR.placeOrSwap(bag, 0, 2, 0, false), "swapped");
  assert.deepStrictEqual([bag.items[0].x, bag.items[0].y, bag.items[0].w, bag.items[0].h], [2, 0, 2, 1], "A 落目标位");
  assert.deepStrictEqual([bag.items[1].x, bag.items[1].y], [0, 0], "B 去 A 原位");
  assert(occOK(bag), "互换后占用一致");
  // B 放不进 A 原位时不换：A=1×1 (0,0)，C=2×2 (1,0)-(2,1)，A 拖到 (1,1) 压 C → C 塞不进 (0,0) 的 1 格 → 失败
  bag = DFR.makeBag(4, 2);
  DFR.addToBag(bag, mk(1, 1, 1));
  DFR.addToBag(bag, Object.assign(mk(3, 2, 2)));
  assert.strictEqual(DFR.placeOrSwap(bag, 0, 1, 1, false), null, "大件塞不回小位不换");
  assert.deepStrictEqual([bag.items[0].x, bag.items[0].y], [0, 0], "A 没动");
  assert(occOK(bag), "失败后占用不变");
  // 压着 2 件不同物品不换：A=2×1 (0,0)，B/C 两个 1×1 在 (2,0)(3,0)，A 拖到 (2,0) 目标区压 B、C → 不换
  bag = DFR.makeBag(4, 2);
  DFR.addToBag(bag, mk(1, 2, 1)); // (0,0)-(1,0)
  DFR.addToBag(bag, mk(2, 1, 1)); // (2,0)
  DFR.addToBag(bag, mk(3, 1, 1)); // (3,0)
  assert.strictEqual(DFR.placeOrSwap(bag, 0, 2, 0, false), null, "目标区压两件不换");
  assert.deepStrictEqual([bag.items[0].x, bag.items[0].y], [0, 0], "A 没动");
  assert(occOK(bag), "失败后占用不变");
  // 空位挪移仍走 moved
  bag = DFR.makeBag(4, 2);
  DFR.addToBag(bag, mk(1, 1, 1));
  assert.strictEqual(DFR.placeOrSwap(bag, 0, 3, 1, false), "moved");
  assert(DFR.canPlaceOrSwap(bag, 0, 3, 1, false), "canPlaceOrSwap 空位 true");
  assert(!DFR.canPlaceOrSwap(bag, 0, 5, 1, false), "出界 false");
});

ok("鼠鼠摸金：未定价物品（value=null）不进掉落池、结算无 NaN", () => {
  // 数据里存在未定价物品（火箭燃料等，2026-08-06 起价值切数据帝真实物价）
  assert(DF_LOOT.items.some((i) => i.value === null), "前提：存在未定价物品");
  // 多种子多容器 roll：掉落物一律有数值价值
  for (let seed = 1; seed <= 10; seed++) {
    const map = DFR.generateRaid(seed, DF_LOOT);
    for (const c of map.containers) {
      const rng = DFG.mulberry32(999 + seed * 100 + c.cid);
      const drops = DFR.rollContainer(rng, c, DF_LOOT);
      for (const d of drops) {
        assert(typeof d.item.value === "number" && d.item.value > 0, `掉落未定价物品 ${d.item.name}`);
        assert(typeof d.item.perCell === "number" && d.item.perCell > 0, "perCell " + d.item.name);
      }
    }
  }
  // 结算路径：装箱 → bagValue 不出现 NaN
  const map = DFR.generateRaid(7, DF_LOOT);
  const bag = DFR.makeBag(6, 4);
  for (const c of map.containers) {
    const drops = DFR.rollContainer(DFG.mulberry32(c.cid), c, DF_LOOT);
    for (const d of drops) DFR.addToBag(bag, d.item);
  }
  const v = DFR.bagValue(bag);
  assert(Number.isFinite(v) && v >= 0, "bagValue NaN: " + v);
});

ok("鼠鼠摸金：评级分档边界", () => {
  assert.strictEqual(DFR.raidGrade(0).g, "C");
  assert.strictEqual(DFR.raidGrade(49999).g, "C");
  assert.strictEqual(DFR.raidGrade(50000).g, "B");
  assert.strictEqual(DFR.raidGrade(199999).g, "B");
  assert.strictEqual(DFR.raidGrade(200000).g, "A");
  assert.strictEqual(DFR.raidGrade(799999).g, "A");
  assert.strictEqual(DFR.raidGrade(800000).g, "S");
  assert.strictEqual(DFR.raidGrade(1999999).g, "S");
  assert.strictEqual(DFR.raidGrade(2000000).g, "SS");
});

ok("鼠鼠摸金：Bresenham 视线被墙挡、无挡则通", () => {
  // 3×3 全空
  const open = DFR.makeGrid(3, 3, 0);
  const solidOpen = (x, y) => open[y][x] === 1;
  assert(DFR.losClear(solidOpen, 0, 0, 2, 2));
  assert(DFR.losClear(solidOpen, 0, 1, 2, 1));
  // 中间一堵墙
  open[1][1] = 1;
  assert(!DFR.losClear(solidOpen, 0, 0, 2, 2), "斜线被 (1,1) 挡");
  assert(!DFR.losClear(solidOpen, 0, 1, 2, 1), "横线被 (1,1) 挡");
  assert(DFR.losClear(solidOpen, 0, 2, 2, 2), "底边横线不受影响");
});

ok("鼠鼠摸金：分享卡格式（撤离/被抓/迷失三种结局）", () => {
  const t1 = DFR.buildRaidShare({ date: "2026-08-05", outcome: "extracted", value: 1234500, searched: 5, total: 12, bestItemName: "黄金瞪羚" });
  assert(t1.includes(DFG.SITE_URL) && t1.includes("鼠鼠摸金 #2026-08-05"));
  assert(t1.includes("🐭") && t1.includes("【1,234,500】") && t1.includes("5/12"));
  assert(t1.includes("评级 S·肥肥撤离") && t1.includes("黄金瞪羚"));
  const t2 = DFR.buildRaidShare({ date: "2026-08-05", outcome: "caught", value: 12345, searched: 2, total: 12 });
  assert(t2.includes("💀") && t2.includes("【12,345】") && t2.includes("评级 C"));
  const t3 = DFR.buildRaidShare({ date: "2026-08-05", practice: true, outcome: "lost", value: 0, searched: 0, total: 12 });
  assert(t3.includes("⏱") && t3.includes("练习"));
  const t4 = DFR.buildRaidShare({ date: "2026-08-05", outcome: "extracted", value: 500000, searched: 8, total: 15, mapName: "巴克什" });
  assert(t4.includes("鼠鼠摸金·巴克什") && !t4.includes("#2026-08-05"), "关卡分享卡标题");
  console.log("---- 鼠鼠摸金分享卡示例 ----\n" + t1 + "\n----------------------------");
});

console.log(`\n全部通过：${passed} 项`);
