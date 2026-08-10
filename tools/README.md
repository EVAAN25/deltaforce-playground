# 数据管线与数据源说明

本目录存放可重跑的数据管线。结论先行：**枪械 = 官方图鉴快照（df-api，2024-12）合并 GTI 数据库（gtidb.com）的较新平衡数值与新增枪械，共 50 把；配件 = 官方图鉴快照（jiansenc，2024-12）392 件，无可用更新源；收集品 = 官方图鉴快照 253 件 + 三角洲数据帝/小涛查真实交易行价（物品单格价值榜 orzice.com/v/item_jz，2026-08-10 抓取，`scrape_item_jz.py` 可刷新，也可 token 走实时接口）；图片素材来自官方 CDN。拿不到更新的维度见文末「现状与缺口」，不编造任何数值。**

## 数据源调研结论（初版 2026-08-05，更新调研 2026-08-06）

### 采用

| 来源 | URL | 内容 | 字段结构 | 覆盖度 |
|---|---|---|---|---|
| zhuba-Ahhh/df-api | https://github.com/zhuba-Ahhh/df-api | 枪械 7 大类静态数据（`src/arms/json/*.ts`） | `objectID / objectName / secondClassCN / desc / pic / gunDetail{ meatHarm armorHarm fireSpeed shootDistance recoil control stable hipShot capacity fireMode muzzleVelocity soundDistance caliber }` | 47 把（官方图鉴快照 2024-12，含口径与描述；仓库 main/dev/feat/v2 分支数据一致，2025-06 后无枪械数据更新） |
| GTI 数据库 gtidb.com | https://gtidb.com/weapons/10000…10049 | 粉丝 Wiki 武器页（VitePress 静态页，属性表与官方图鉴同构，数值跟随平衡补丁） | 每页：`名称/类型/基础伤害/护甲伤害/射速/射程/后坐力控制/操控速度/据枪稳定性/腰射精度/弹容量/开火模式/子弹初速/枪声传播距离` + 图鉴 objectID（页面插图 URL 内含） | 50 把（含快照没有的 **腾龙突击步枪 / M250通用机枪 / M1911**），2026-08-06 抓取 |
| gtidb 伤害模型 | https://gtidb.com/calculator/dps.html 引用的 `assets/chunks/damages.*.js` | 每枪伤害衰减模型，含 `bulletType`（弹种） | `baseDamage/armorDamage/fireRate/damageFalloffs/bulletType/triggerDelay` | 用于给 3 把新枪定口径（已用已知枪校验映射：AKM→7.62x39、M4A1→5.56、VSS→9x39 均吻合） |
| jiansenc/DeltaForceData | https://github.com/jiansenc/DeltaForceData | 配件 9 大类 + 收集品静态 JSON（`public/json/acc/*.json`、`props/collection.json`） | 配件：`objectID / objectName / secondClassCN(部位) / grade / weight / pic / accDetail{ 数值加成 + advantage/disadvantage 效果文本 }`；收集品：`objectName / grade / 尺寸(len×wid) / 类别 / 产出地图 / desc` | 配件 **392 件** + 收集品 **253 件**（官方图鉴快照 2024-12，仓库停更） |
| 官方图片 CDN | `https://playerhub.df.qq.com/playerhub/60004/object/p_{objectID}.png` | 枪械/配件/干员图片 | 300×150 PNG（`p_` 前缀小图）/ 1200×600 大图 | 全量可用，新枪图片按 objectID 补抓成功 |
| 三角洲数据帝 价格开源快照 | https://github.com/orzice/DeltaForcePrice（`price.json`） | 真实交易行价格 | `{name, price, secondClassCN, is_get_time}` | 1246 条全物品（含收集品 316 条、枪械 60 把、配件 514 件），**2026-01-10 停更**；现为兜底价格源 |
| 小涛查 物品单格价值榜 | https://orzice.com/v/item_jz（接口 `/api/xtc/item_jz_list`，响应 AES 加密） | 实时交易行总价 + 单格价值 | `{name, grade, price, dgjz(单格价值), wh(格数), oid}` | 374 件全物品实时价，2026-08-10 起为**默认价格源**；接口加密不逆向，用 `tools/scrape_item_jz.py`（Playwright 读页面 Vue 实例解密后的数据）抓取 |

**枪械合并规则**（`tools/build_data.js`）：同 objectID 的枪以 gtidb 的数值/类型/开火模式覆盖快照（gtidb 更新、跟随平衡补丁）；口径/描述/重量保留官方图鉴快照；gtidb 独有的枪整枪采用 gtidb 数据，口径取自 gtidb 伤害模型的 bulletType（同站来源），描述暂缺（空串，UI 已做降级）。

### 考察过但未采用（2026-08-06 更新调研新增）

- **官方 AMS 图鉴活接口**（`x6m5.ams.game.qq.com/ams/ame/amesvr`，iActivityId=661959）：接口存活但校验 actid+flowId，flowId 无法获知（快照序列号末段 316968 试过无效），网页端无入口，放弃。
- **AgelessGlitch/delta-force-loadouts**（2026-07 更新）：配装站，含 S2-S10 新枪的改枪码（K437、KC17、MK47、MCX LT、AR57、QCQ171、QJB201、RM277、SVCH、M82、Marlin、FS-12、725、MK4、SR9、复合弓等），但 `baseStats` 全为 0，**只有名录无数值**，仅用于确认缺口清单。
- **shipeng123123/sjz_gun_data**：枪械↔配件兼容关系数据存在，但付费（99 元赞助），未采用。
- **orzice.com（小涛查/数据帝开放平台）**：已接入其**免费开源价格快照**（见上表）。线上开放平台（API 文档 https://work-api.apifox.cn/ ，base `https://orzice.com/workApi`）提供约 30 个接口：全物品基础信息库（`/v1/sjz_api/item_info_all`，含 objectID/分类/detail 扩展参数）、最新价格（`/v1/sjz_api/item_price_all`，高频 1 分钟/中频 5 分钟/低频 10 分钟）、卡战备、价格曲线、改枪码、今日密码等。**全部需 token**：控制台 QQ 登录 → 开通服务（按请求包计费）→ 获取 token；文档明确要求 token 不可暴露、须服务端调用。本站为纯静态站，token 不能随仓库分发，故管线走环境变量：`ORZICE_TOKEN=xxx node tools/build_loot.js` 可一键刷新实时价。
- **df.shallow.ink / api-df.zhuba.online**：社区 API，均需 key 且站点当前不可达。
- **wiki.gg / fandom / biligame / 灰机**：或无三角洲分站，或 Cloudflare 拦截且无结构化属性表；百度百科/官方公告只有零散新枪名，无数值。
- **官网 df.qq.com**：无公开数据接口；`playerhub.df.qq.com` 仅为图片 COS 桶；`playerhub/40001`（国际版图鉴）在官方域不存在，仅 gtidb 引用的 CDN 镜像 `deltaforcewiki.vasdgame.com` 有图。
- **干员数据**（df-api `src/agent/json/agents.ts`）：数量太少，未进玩法。

### 现状与缺口（截至 2026-08-06）

- **枪械数值已更新到 gtidb 当前版本**（2026-08-06 抓取）：47 把老枪全部刷新为较新平衡值（如 M4A1 伤害 27→31），新增 3 把带完整属性的枪。
- **收集品价格已刷新为小涛查物品单格价值榜**（orzice.com/v/item_jz，2026-08-10 抓取 374 件实时交易行价，`python3 tools/scrape_item_jz.py` 可随时重抓）：240/253 件可交易物品参与摸金玩法出题；13 件不可交易物品（火箭燃料等）保留图鉴字段但不参与出题。如需分钟级实时价：按上文步骤在 orzice.com/work 控制台开通服务拿 token 后跑 `ORZICE_TOKEN=xxx node tools/build_loot.js`。
- **2025-2026 赛季新枪（约 10-15 把）**：数据帝价格快照侧证 2026-01 枪械名录 60 把，我们题库（50 把）缺 **K437突击步枪 / KC17突击步枪 / MK47突击步枪 / MK4冲锋枪 / QCQ171冲锋枪 / QJB201轻机枪 / SR9射手步枪 / 725双管霰弹枪 / 复合弓 / 杠杆式步枪**（另 S9-S10 的 RM277/SVCH/M82/MCX LT/AR57 更晚，见配装站改枪码）；但任何可及来源都没有这些枪的官方图鉴格式完整数值 → **不入库、不编造**。
- **配件**：属性停留在官方图鉴快照 2024-12（392 件）；数据帝快照显示 2026-01 配件已达 514 件，但只有名称+价格、无 accDetail 数值 → 无法更新改枪大师题库。
- **枪械↔配件逐个兼容表**：数据帝平台不提供该数据（其接口为物价/卡战备/改枪码，改枪码为不透明字符串无解码文档），其余公开渠道亦无 → 改枪玩法的兼容判断形态（「这件配件能装上哪把枪」）仍无法落地。

## 管线用法

```bash
node tools/build_data.js     # 抓取上游 → 合并 → data/weapons.js + data/attachments.js
node tools/fetch_assets.js   # 按 data/*.js 的图片清单从官方 CDN 下载 → assets/guns/ + assets/acc/
node tools/build_loot.js     # 收集品（253 件）+ 数据帝真实交易行价 → data/loot.js
                             #   价格源优先级：ORZICE_TOKEN=xxx 实时接口
                             #   > tools/data/item_jz.json（默认，小涛查物品单格价值榜，
                             #     python3 tools/scrape_item_jz.py 刷新，需 py playwright）
                             #   > GitHub 开源快照（2026-01-10 停更，兜底）
node tools/fetch_props.js    # 收集品图片 → assets/props/
```

两个脚本均无第三方依赖（Node ≥18，用内置 fetch）。`build_data.js` 做的清洗/合并：

- 枪械：df-api 快照与 gtidb 按 objectID 合并（规则见上）；口径字段修正上游笔误（`mmo7.62x51` → `ammo7.62x51`）；gtidb 新枪口径由其伤害模型 bulletType 映射（`BULLET_TYPE_CN`，用已知枪校验）。
- 开火模式按 `,` `，` `/` 分隔归一化为集合，规范顺序「单发 → 连发 → 全自动」。
- 配件数值加成提取为 `stats` 字典，优劣效果文本提取为 `pros` / `cons`。
- 输出为挂 `window.DF_WEAPONS` / `window.DF_ACC` 的 JS（浏览器直引、node 可注入假 window 测试），图片路径指向本地 `assets/`。

重跑后必须执行 `node test.js` 与 `node tools/fetch_assets.js`（新出现的 objectID 需要补图）。
