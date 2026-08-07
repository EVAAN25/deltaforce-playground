#!/usr/bin/env python3
"""鼠鼠摸金本轮改动端到端自测：容器多次摸取 / 背包双击拖拽 / 撤离撒花放歌"""
import sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/#/raid"
fails = []

def check(name, cond, extra=""):
    print(("✓ " if cond else "✗ ") + name + (f"  [{extra}]" if extra else ""))
    if not cond:
        fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector("#raidCanvas")
    time.sleep(1.0)

    # 传送到第一个容器旁并开搜
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid;
      const c = Raid.run.containers[0];
      const spots = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({x:c.x+dx, y:c.y+dy}))
        .filter(t => !Raid.run.map.tiles[t.y][t.x] && !Raid.run.containers.some(cc => cc.x===t.x && cc.y===t.y));
      Raid.run.px = spots[0].x; Raid.run.py = spots[0].y;
      Raid.run.vx = Raid.run.px * 30; Raid.run.vy = Raid.run.py * 30;
      Raid.run.patrols.forEach(pp => { pp.x = 0; pp.y = 0; pp.vx = 0; pp.vy = 0; pp.radius = 0; }); // 关掉巡逻干扰
    }""")
    pg.keyboard.press("f")
    pg.wait_for_selector("#raidOverlay:not(.hidden)")
    check("开搜浮层打开（含内嵌背包）", pg.is_visible("#rpBagMain") and pg.is_visible("#rpBagSafe"))

    # 等自动鉴定完（红货最多 2.3s×1.3 ≈ 3s/件，留足余量）
    for _ in range(120):
        n = pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-silhouette').length")
        if n == 0: break
        time.sleep(0.5)
    total = pg.evaluate("() => window.DFR_UI._raid.overlay.c.drops.length")
    check("自动逐件鉴定完成", n == 0, f"{total} 件")

    staged = pg.evaluate("() => document.querySelectorAll('#rpStaging .rp-stage-item').length")
    check("待拾取区列出全部货", staged == total, f"{staged}/{total}")

    # 双击第一件 → 入包
    name0 = pg.evaluate("() => document.querySelector('#rpStaging .rp-stage-item .si-name').textContent")
    pg.dispatch_event("#rpStaging .rp-stage-item", "dblclick")
    time.sleep(0.3)
    bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
    check("双击放入背包", bag_n == 1, name0)
    check("浮层背包同步渲染", pg.evaluate("() => document.querySelectorAll('#rpBagMain .bag-item, #rpBagSafe .bag-item').length") == 1)

    # 拖拽第二件（如有）→ 主背包
    if total >= 2:
        src = pg.locator("#rpStaging .rp-stage-item").first
        dst = pg.locator("#rpBagMain")
        sb, db = src.bounding_box(), dst.bounding_box()
        pg.mouse.move(sb["x"] + 20, sb["y"] + 10)
        pg.mouse.down()
        pg.mouse.move(sb["x"] + 40, sb["y"] + 30, steps=3)  # 过阈值启动拖拽
        pg.mouse.move(db["x"] + db["width"] / 2, db["y"] + db["height"] / 2, steps=8)
        pg.mouse.up()
        time.sleep(0.3)
        bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
        check("拖拽放入背包", bag_n == 2)

    # 关闭浮层 → 再开：已摸物品直接可见、不重新鉴定
    pg.click("#rpClose")
    time.sleep(0.3)
    searched = pg.evaluate("() => window.DFR_UI._raid.run.searched")
    pg.keyboard.press("f")
    time.sleep(0.5)
    sil = pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-silhouette').length")
    check("重开容器：已鉴定物品直接显示（无剪影）", sil == 0)
    taken_greyed = pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-item.taken').length")
    check("重开容器：已入包物品置灰", taken_greyed == bag_n, f"{taken_greyed}/{bag_n}")
    drops_same = pg.evaluate("() => window.DFR_UI._raid.run.containers[0].drops.length")
    check("同一局容器内容不变", drops_same == total, f"{drops_same}/{total}")

    # 浮层里双击包内物品 → 放回容器
    pg.dispatch_event("#rpBagMain .bag-item, #rpBagSafe .bag-item", "dblclick")
    time.sleep(0.3)
    bag_n2 = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
    check("双击包内物品放回容器", bag_n2 == bag_n - 1)
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
    result_txt = pg.text_content("#raidResult")
    check("结算文案=肥肥撤离", "肥肥撤离" in result_txt)

    check("全程无 JS 报错", not errors, "; ".join(errors[:3]))
    b.close()

print("\n" + ("全部通过" if not fails else f"失败 {len(fails)} 项：{fails}"))
sys.exit(1 if fails else 0)
