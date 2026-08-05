# 三角洲行动游乐场

非官方《三角洲行动》（Delta Force）粉丝同人小游戏站，纯静态单页应用，无需构建，打开即玩。

**在线地址：https://evaan25.github.io/deltaforce-playground/**

## 玩法

| 玩法 | 说明 |
|---|---|
| 🔧 改枪大师 | 主打玩法。每轮给定配件部位与目标属性（后坐力控制 / 操控速度 / 据枪稳定性 / 腰射精度 / 射程 / 弹容量），从 4 件候选配件中选出加成最高者，共 5 轮。判定全部使用官方图鉴配件数值。 |
| 🎯 猜枪械 | Wordle 式七维比对：类型 / 口径 / 开火模式 / 伤害 / 射速 / 射程 / 弹容量，数值带 ⬆️⬇️ 提示，6 次机会。题池 47 把枪。 |
| ⚔️ 枪械对决 | Higher-Lower：每日种子指定一项属性，判断右边枪械数值更高还是更低，固定 10 轮，答错即结算；练习模式无限连击。 |
| 📶 火力排排坐 | 把 5 把枪按每日指定属性（射速 / 伤害 / 射程 / 弹容量 / 子弹初速）从高到低排序，3 次提交机会，逐位给 🟩🟥。 |

每个玩法：每日一题（按本地日期独立种子，全站同题）+ 不限次练习模式 + 独立 localStorage 进度 + emoji 分享卡 + 结算评级。

## 本地运行

```bash
# 任选其一
python3 -m http.server 8000     # 然后访问 http://localhost:8000
open index.html                 # file:// 直接打开也能跑（数据与图片全部内嵌本地）
```

## 测试

```bash
node test.js    # 19 项：数据完整性 / 四玩法每日确定性 / 题库校验 / 分享卡格式
```

## 数据与素材

- 枪械 47 把（7 大类全属性）、配件 392 件（9 大部位数值加成）：来自 GitHub 仓库 [zhuba-Ahhh/df-api](https://github.com/zhuba-Ahhh/df-api) 与 [jiansenc/DeltaForceData](https://github.com/jiansenc/DeltaForceData) 整理的官方图鉴数据快照（约 2024-12），本站于 2026-08-05 拉取并清洗。
- 图片：官方图鉴 CDN（`playerhub.df.qq.com`）300×150 图鉴图，已下载至本地 `assets/`。
- 「枪械↔配件逐个兼容关系」无公开真实数据，故改枪玩法设计为不依赖兼容性的形态；全站不编造任何数值。
- 数据源调研详情与可重跑管线见 [tools/README.md](tools/README.md)（`node tools/build_data.js && node tools/fetch_assets.js`）。

## 目录结构

```
index.html / style.css / app.js   # 单页应用（vanilla，无构建步骤）
game.js                           # 纯逻辑层（UMD，node 可测）
data/weapons.js                   # 枪械数据（管线生成）
data/attachments.js               # 配件数据（管线生成）
assets/guns/ assets/acc/          # 图片素材（官方 CDN 小图）
tools/                            # 数据管线 + 数据源说明
test.js                           # node 自测
```

## 免责声明

本站为非官方粉丝同人作品，与腾讯（Tencent）及琳琅天上工作室（Team Jade）无关。游戏名称、素材版权归原厂商所有，仅作粉丝交流用途。
