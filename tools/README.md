# 数据管线与数据源说明

本目录存放可重跑的数据管线。结论先行：**枪械/配件/属性数据全部来自两个 GitHub 仓库整理的官方图鉴（掌上道聚城 AMS 接口）快照，图片素材来自官方 CDN；「枪械↔配件逐个兼容关系」拿不到真实数据，因此玩法不依赖它。**

## 数据源调研结论（2026-08-05）

### 采用

| 来源 | URL | 内容 | 字段结构 | 覆盖度 |
|---|---|---|---|---|
| zhuba-Ahhh/df-api | https://github.com/zhuba-Ahhh/df-api | 枪械 7 大类静态数据（`src/arms/json/*.ts`） | 每把枪：`objectID / objectName / secondClassCN(类型) / desc / pic / gunDetail{ meatHarm armorHarm fireSpeed shootDistance recoil control stable hipShot capacity fireMode muzzleVelocity soundDistance caliber }` | 步枪16 + 冲锋枪9 + 精确射手步枪7 + 轻机枪2 + 手枪6 + 霰弹枪3 + 狙击步枪4 = **47 把** |
| jiansenc/DeltaForceData | https://github.com/jiansenc/DeltaForceData | 配件 9 大类静态 JSON（`public/json/acc/*.json`） | 每件配件：`objectID / objectName / secondClassCN(部位) / grade / weight / pic / accDetail{ 数值加成 + advantage/disadvantage 效果文本 }` | 枪口34 + 枪管104 + 前握把21 + 后握把27 + 护木24 + 枪托57 + 瞄具31 + 弹匣58 + 功能性36 = **392 件** |
| 官方图片 CDN | `https://playerhub.df.qq.com/playerhub/60004/object/p_{objectID}.png` | 枪械/配件/干员图片 | 300×150 PNG（`p_` 前缀小图）/ 1200×600 大图 | 全量可用，已验证 200 |

两仓库数据同源自腾讯 AMS 图鉴接口（响应壳 `{ret,iRet,sMsg,jData,sAmsSerial}`，序列号 `AMS-DFM-…-661959-…`，快照时间约 2024-12，游戏 S1 赛季前后）。

### 考察过但未采用

- **官网 df.qq.com**：首页仅有活动页静态资源，无公开结构化数据接口；`playerhub.df.qq.com` 只是 COS 静态桶（图片 CDN），无 JSON 接口。
- **AMS 图鉴活接口**（`x6m5.ams.game.qq.com/ams/ame/amesvr`）：接口仍存活（返回 `error actid or flowid`），但 flowId 未知且接口大概率需登录态，放弃重抓，直接用上述快照。
- **gtidb.com（GTI 数据库，粉丝 Wiki）**：VitePress 静态站，50 把枪的属性表（与官方图鉴一致）+ 伤害衰减/部位倍率模型（`assets/chunks/damages.*.js`）。可作交叉校验，本项目未直接使用。
- **干员数据**（df-api `src/agent/json/agents.ts`）：约 10 名干员（红狼、威龙、蜂医、露娜等），含兵种与技能。数量太少撑不起题池，按预设只作次要维度，未进玩法。
- **biligame wiki / 灰机 wiki / fandom**：均无三角洲行动分站或内容（biligame 的 sjzx/deltaforce 路径不存在）。
- **coolxi-tech/deltaforce、DeltaUID 等**：均为需登录态的玩家战绩 API，不含静态图鉴。

### 拿不到、因此砍掉/改设计的数据

- **枪械↔配件逐个兼容表（哪个配件能装哪把枪）**：枪械数据里只有槽位 ID 列表（`allAccessory.slotID`），配件数据里没有槽位/兼容字段，官方详情接口拿不到。→ 「改枪」主打玩法因此设计为**不依赖兼容性**的形态：给定配件部位与目标属性，从候选配件中选出加成最高者（全部用 `accDetail` 真实数值判定，不编造任何数值）。
- 配件属性官方数值 → 有（`accDetail` 数值 + 效果文本），直接用。

## 管线用法

```bash
node tools/build_data.js     # 从上游仓库拉取原始数据 → data/weapons.js + data/attachments.js
node tools/fetch_assets.js   # 按 data/*.js 的图片清单从官方 CDN 下载 → assets/guns/ + assets/acc/
```

两个脚本均无第三方依赖（Node ≥18，用内置 fetch）。`build_data.js` 做的清洗：

- 口径字段修正上游笔误（`mmo7.62x51` → `ammo7.62x51`），并映射为显示名（`.45 ACP`、`12 Gauge`、`5.56x45mm` 等，名称表取自 df-api `src/config/json/config.ts`）。
- 开火模式按 `,`/`/` 分隔归一化为集合，规范顺序为「单发 → 连发 → 全自动」。
- 配件数值加成提取为 `stats` 字典，优劣效果文本提取为 `pros` / `cons`。
- 输出为挂 `window.DF_WEAPONS` / `window.DF_ACC` 的 JS（浏览器直引、node 可注入假 window 测试），图片路径指向本地 `assets/`。

重跑后必须执行 `node test.js` 与 `node tools/fetch_assets.js`（新出现的 objectID 需要补图）。
