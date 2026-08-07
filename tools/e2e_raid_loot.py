#!/usr/bin/env python3
"""鼠鼠摸金端到端自测：容器多次摸取 / 背包双击拖拽挪位 / 悬停F / 拖空白丢弃 / 撤离撒花放歌
前置：仓库根目录起 python3 -m http.server 8931"""
import sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/#/raid"
fails = []

def check(name, cond, extra=""):
    print(("✓ " if cond else "✗ ") + name + (f"  [{extra}]" if extra else ""))
    if not cond:
        fails.append(name)

def drag(pg, src_box, dst_xy):
    pg.mouse.move(src_box["x"] + src_box["width"] / 2, src_box["y"] + src_box["height"] / 2)
    pg.mouse.down()
    pg.mouse.move(src_box["x"] + src_box["width"] / 2 + 30, src_box["y"] + src_box["height"] / 2 + 30, steps=3)
    pg.mouse.move(dst_xy[0], dst_xy[1], steps=8)
    pg.mouse.up()
    time.sleep(0.3)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector("#raidCanvas")
    time.sleep(1.0)

    # 传送到第一个容器旁并开搜（关巡逻干扰）
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid;
      const c = Raid.run.containers[0];
      const spots = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({x:c.x+dx, y:c.y+dy}))
        .filter(t => !Raid.run.map.tiles[t.y][t.x] && !Raid.run.containers.some(cc => cc.x===t.x && cc.y===t.y));
      Raid.run.px = spots[0].x; Raid.run.py = spots[0].y;
      Raid.run.vx = Raid.run.px * 30; Raid.run.vy = Raid.run.py * 30;
      Raid.run.patrols.forEach(pp => { pp.x = 0; pp.y = 0; pp.vx = 0; pp.vy = 0; pp.radius = 0; });
    }""")
    pg.keyboard.press("f")
    pg.wait_for_selector("#raidOverlay:not(.hidden)")
    check("开搜浮层打开（含内嵌背包）", pg.is_visible("#rpBagMain") and pg.is_visible("#rpBagSafe"))

    # 等自动鉴定完
    n = 1
    # 转圈时悬停第一件不动，揭晓瞬间直接按 F（回归：鼠标静止也须立即可按）
    sb0 = pg.locator('.rp-silhouette[data-i="0"]').bounding_box()
    pg.mouse.move(sb0["x"] + sb0["width"] / 2, sb0["y"] + sb0["height"] / 2)
    for _ in range(60):
        if pg.evaluate("() => !!document.querySelector('.rp-item[data-i=\"0\"].revealed')"): break
        time.sleep(0.5)
    pg.keyboard.press("f")
    time.sleep(0.3)
    bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
    check("揭晓瞬间不动鼠标按 F 即入包", bag_n == 1, f"bag={bag_n}")

    for _ in range(120):
        n = pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-silhouette').length")
        if n == 0: break
        time.sleep(0.5)
    total = pg.evaluate("() => window.DFR_UI._raid.overlay.c.drops.length")
    check("自动逐件鉴定完成", n == 0, f"{total} 件")
    staged = pg.evaluate("() => document.querySelectorAll('#rpStaging .rp-stage-item').length")
    check("待拾取区列出剩余的货", staged == total - 1, f"{staged}/{total - 1}")

    # 双击第一件 → 入包
    pg.dispatch_event("#rpStaging .rp-stage-item", "dblclick")
    time.sleep(0.3)
    bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
    check("双击放入背包", bag_n == 2)

    # 悬停按 F → 入包
    src = pg.locator("#rpStaging .rp-stage-item").first
    sb = src.bounding_box()
    pg.mouse.move(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2)
    time.sleep(0.2)
    pg.keyboard.press("f")
    time.sleep(0.3)
    bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
    check("悬停按 F 放入背包", bag_n == 3, f"bag={bag_n}")

    # 悬在「入包」按钮上按 F → 不触发（F 只对物品本体生效）
    bb = pg.locator("#rpStaging .rp-stage-item button[data-act='main']").first.bounding_box()
    pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
    time.sleep(0.2)
    pg.keyboard.press("f")
    time.sleep(0.3)
    bag_n_btn = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
    check("悬在入包按钮上按 F 不触发", bag_n_btn == bag_n, f"bag={bag_n_btn}")

    # 拖拽下一件（如待拾取区还有）→ 主背包
    if pg.evaluate("() => document.querySelectorAll('#rpStaging .rp-stage-item').length") > 0:
        sb = pg.locator("#rpStaging .rp-stage-item").first.bounding_box()
        db = pg.locator("#rpBagMain").bounding_box()
        drag(pg, sb, (db["x"] + db["width"] / 2, db["y"] + db["height"] / 2))
        bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
        check("拖拽放入背包", bag_n == 4, f"bag={bag_n}")

    # 同包拖拽挪位：找主背包里第一个能挪到别处的件，拖到该格
    repo = pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid, DFR = window.DFR;
      const bag = Raid.run.bagMain;
      for (let idx = 0; idx < bag.items.length; idx++) {
        const it = bag.items[idx];
        for (let y = 0; y < bag.h; y++) for (let x = 0; x < bag.w; x++) {
          if ((x !== it.x || y !== it.y) && DFR.canPlaceAt(bag, idx, x, y)) return { idx, x, y, from: [it.x, it.y] };
        }
      }
      return null;
    }""")
    if repo:
        cs = pg.evaluate("() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bagcell'), 10) || 44")
        r = pg.locator("#rpBagMain").bounding_box()
        ib = pg.locator("#rpBagMain .bag-item").nth(repo["idx"]).bounding_box()
        drag(pg, ib, (r["x"] + (repo["x"] + 0.5) * cs, r["y"] + (repo["y"] + 0.5) * cs))
        now = pg.evaluate(f"() => {{ const e = window.DFR_UI._raid.run.bagMain.items[{repo['idx']}]; return [e.x, e.y]; }}")
        check("同包拖拽挪位", now == [repo["x"], repo["y"]], f"{repo['from']} → {now}")

    # 拖动中按 R 横竖切换：找一件非方形的包内物品，拖到可旋转落点
    rot = pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid, DFR = window.DFR;
      const bag = Raid.run.bagMain;
      for (let idx = 0; idx < bag.items.length; idx++) {
        const it = bag.items[idx];
        if (it.w === it.h) continue;
        for (let y = 0; y < bag.h; y++) for (let x = 0; x < bag.w; x++) {
          if (DFR.canPlaceAt(bag, idx, x, y, true)) return { idx, x, y, w: it.w, h: it.h };
        }
      }
      return null;
    }""")
    if rot:
        cs = pg.evaluate("() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bagcell'), 10) || 44")
        r = pg.locator("#rpBagMain").bounding_box()
        ib = pg.locator("#rpBagMain .bag-item").nth(rot["idx"]).bounding_box()
        pg.mouse.move(ib["x"] + ib["width"] / 2, ib["y"] + ib["height"] / 2)
        pg.mouse.down()
        pg.mouse.move(ib["x"] + ib["width"] / 2 + 30, ib["y"] + ib["height"] / 2 + 30, steps=3)
        pg.keyboard.press("r")
        time.sleep(0.1)
        pg.mouse.move(r["x"] + (rot["x"] + 0.5) * cs, r["y"] + (rot["y"] + 0.5) * cs, steps=8)
        pg.mouse.up()
        time.sleep(0.3)
        wh = pg.evaluate(f"() => {{ const e = window.DFR_UI._raid.run.bagMain.items[{rot['idx']}]; return [e.w, e.h]; }}")
        check("拖动中按R横竖切换", wh == [rot["h"], rot["w"]], f"{[rot['w'], rot['h']]} → {wh}")
    else:
        print("- 跳过旋转拖拽（包内没有非方形物品）")

    # 悬停包内物品按 F → 放回容器
    staged_before = pg.evaluate("() => document.querySelectorAll('#rpStaging .rp-stage-item').length")
    ib = pg.locator("#rpBagMain .bag-item").first.bounding_box()
    pg.mouse.move(ib["x"] + ib["width"] / 2, ib["y"] + ib["height"] / 2)
    time.sleep(0.2)
    pg.keyboard.press("f")
    time.sleep(0.3)
    main_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length")
    staged_after = pg.evaluate("() => document.querySelectorAll('#rpStaging .rp-stage-item').length")
    check("悬停按 F 移出（放回容器）", staged_after == staged_before + 1, f"staged {staged_before}→{staged_after}")

    # 拖包内物品到空白处 → 丢弃
    safe_before = pg.evaluate("() => window.DFR_UI._raid.run.bagSafe.items.length")
    main_before = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length")
    which_sel = "#rpBagSafe .bag-item" if safe_before else "#rpBagMain .bag-item"
    ib = pg.locator(which_sel).first.bounding_box()
    drag(pg, ib, (60, 500))  # 浮层面板外的空白背景
    tot_after = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
    check("拖到空白处丢弃", tot_after == safe_before + main_before - 1, f"{safe_before + main_before}→{tot_after}")

    # 关闭浮层 → 再开：已摸物品直接可见、不重新鉴定
    pg.click("#rpClose")
    time.sleep(0.3)
    searched = pg.evaluate("() => window.DFR_UI._raid.run.searched")
    pg.keyboard.press("f")
    time.sleep(0.5)
    sil = pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-silhouette').length")
    check("重开容器：已鉴定物品直接显示（无剪影）", sil == 0)
    drops_same = pg.evaluate("() => window.DFR_UI._raid.run.containers[0].drops.length")
    check("同一局容器内容不变", drops_same >= total, f"{drops_same}/{total}（放回会加件）")
    pg.click("#rpClose")
    time.sleep(0.3)
    searched2 = pg.evaluate("() => window.DFR_UI._raid.run.searched")
    check("重开不重复计摸过数", searched2 == searched, f"{searched2}")

    # 强制撤离成功：传送撤离点 + 跳过引导
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid;
      const e = Raid.run.map.extracts[0];
      Raid.run.px = e.x; Raid.run.py = e.y;
      Raid.run.extracting = performance.now() - 99999;
      Raid.run.timeLeft = 120;
    }""")
    time.sleep(0.4)
    check("撤离结算出现", pg.is_visible("#raidResult"))
    check("撤离撒花图层出现", pg.evaluate("() => !!document.querySelector('.confetti-layer')"))
    check("撒花碎片数量 > 0", pg.evaluate("() => document.querySelectorAll('.confetti-pc').length") > 0)
    check("结算文案=肥肥撤离", "肥肥撤离" in pg.text_content("#raidResult"))

    check("全程无 JS 报错", not errors, "; ".join(errors[:3]))
    b.close()

print("\n" + ("全部通过" if not fails else f"失败 {len(fails)} 项：{fails}"))
sys.exit(1 if fails else 0)
