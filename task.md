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

- 采用：zhuba-Ahhh/df-api（枪械 47 把全属性）、jiansenc/DeltaForceData（配件 392 件数值加成）、官方 CDN 图片（已本地化 439 张）。
- 砍掉：枪械↔配件逐个兼容表（无公开数据）→ 改枪玩法改为「部位 × 目标属性选最高加成配件」，不依赖兼容性、不编造数值。
- 干员数量太少，未进玩法。

## 玩法清单

1. 🔧 改枪大师（主打）：部位 × 目标属性，4 选 1 挑最高加成，5 轮。
2. 🎯 猜枪械：七维 wordle 比对，47 把题池，6 次机会。
3. ⚔️ 枪械对决：每日指定属性 higher-lower，10 轮链。
4. 📶 火力排排坐：5 把枪按指定属性降序排，3 次提交。

## 复跑要点

- `node test.js` 全过（19 项）后才可发布。
- 数据更新：`node tools/build_data.js && node tools/fetch_assets.js && node test.js`。
- Pages 由 `gh api repos/EVAAN25/deltaforce-playground/pages` 开启，分支 main 根目录。
