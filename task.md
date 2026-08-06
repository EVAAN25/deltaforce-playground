# task：三角洲行动游乐场（Delta Force Playground）

## 需求

从零构建「三角洲行动游乐场」粉丝小游戏站并发布到 GitHub Pages。系列第三站，复用兄弟站（starrail-wordle / arknights-playground）的单页应用骨架、样式变量思路与工具函数，风格改为全站统一的深色军事风。用户点名内容方向：改枪（配件搭配），围绕它做主打玩法。

- 玩法 3-4 个，必含改枪主打；每个玩法：每日一题独立种子 + 无限/练习模式 + 独立 localStorage + emoji 分享卡 + 结算评级。
- vanilla HTML/CSS/JS 无构建，file:// 可跑；逻辑层纯函数 node 可测；test.js 覆盖种子确定性、题库校验、分享卡格式、数据完整性；tools/ 可重跑数据管线 + README。
- 页脚免责声明 + 数据来源与日期；不署名任何个人/公司。
- 发布：gh repo create deltaforce-playground --public + GitHub Pages（main 根目录）。

## 交付物

- 仓库：https://github.com/EVAAN25/deltaforce-playground
- 站点：https://evaan25.github.io/deltaforce-playground/
- 数据源调研与管线说明：`tools/README.md`

## 数据源结论（详版见 tools/README.md）

- 采用：zhuba-Ahhh/df-api（官方图鉴快照 2024-12，47 把全属性含口径/描述）+ GTI 数据库 gtidb.com（较新平衡数值 + 3 把新枪：腾龙突击步枪/M250通用机枪/M1911，口径取自同站伤害模型 bulletType）合并 = 枪械 50 把；jiansenc/DeltaForceData（配件 392 件，2024-12 快照，无更新源）；官方 CDN 图片（已本地化 442 张）。数据抓取/合并于 2026-08-06。
- 缺口：2025-2026 赛季新枪（K437/KC17/MK47/RM277 等约 15 把）可确认名录但无官方图鉴格式数值，不入库不编造；枪械↔配件兼容表无公开数据 → 改枪玩法不依赖兼容性。
- 干员数量太少，未进玩法。

## 玩法清单

1. 🔧 改枪大师（主打）：部位 × 目标属性，4 选 1 挑最高加成，5 轮。
2. 🎯 猜枪械：七维 wordle 比对，50 把题池，6 次机会。
3. ⚔️ 枪械对决：每日指定属性 higher-lower，10 轮链；每次作答后公布双方数值。
4. 📶 火力排排坐：5 把枪按指定属性降序排，3 次提交。

四玩法统一：每日题玩完后「再来一题」无缝重开随机题、不限次数；结算面板输赢都有分享卡。

## 2026-08-06 摸金玩法上线（第二批）

- 新增玩法 5「💰 摸金对决」：收集品价值 higher-lower，每日种子指定维度（总价值/单格价值），11 件链 10 轮，作答后公布双方数值；练习无限连击。
- 新增玩法 6「📦 物资排排坐」：5 件物资按指定维度降序排，3 次提交。
- 数据：data/loot.js（253 件收集品，官方图鉴快照 2024-12 的名称/品质/尺寸/类型/产出地图/描述 + 同人自设价值公式），assets/props/ 253 张图；管线 tools/build_loot.js + tools/fetch_props.js（均已验证可重跑，产物逐字节一致）。
- 价值为自设玩法数值已在两个玩法页（橙色虚线警示条）与页脚三处注明。
- build_loot.js 工作区改动（上游 JSON 嵌套层级递归探测）为重跑所需，采用工作区版本。
- 测试：24 项全过（新增 loot 数据完整性、两玩法 30 天种子与题库校验、分享卡输赢断言）。

## 2026-08-06 更新记录（第一批）

- 数据：枪械 47 → 50（gtidb 合并，老枪数值刷新为较新平衡值，如 M4A1 伤害 27→31），新增枪图片已补抓。
- 功能：四玩法结算后「再来一题」直接重开随机题（原逻辑是复用旧练习状态）；对决每次作答（无论对错）公布双方该项数值，答对停留 1.1s 再进下一轮；对决卡片补属性项标签与数据来源说明。
- 测试：题池断言 47 → 50，desc 允许空串（gtidb 新枪无官方描述），19 项全过。

## 复跑要点

- `node test.js` 全过（19 项）后才可发布。
- 数据更新：`node tools/build_data.js && node tools/fetch_assets.js && node test.js`。
- Pages 由 `gh api repos/EVAAN25/deltaforce-playground/pages` 开启，分支 main 根目录。
