#!/usr/bin/env python3
"""鼠鼠摸金移动端适配端到端自测（触屏仿真：390×844 + hasTouch）
前置：仓库根目录起 python3 -m http.server 8931"""
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
    ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector("#raidCanvas")
    time.sleep(1.2)

    check("触屏操控条显示", pg.evaluate("() => getComputedStyle(document.querySelector('#raidTouchUI')).display") == "flex")
    check("顶部新手引导（触屏口径）", "摇杆" in pg.text_content("#raidHowto") and "安全箱" in pg.text_content("#raidHowto"))
    check("摇杆/按钮可见", pg.is_visible("#raidJoy") and pg.is_visible("#raidBtnF") and pg.is_visible("#raidBtnBag"))
    check("提示语为触屏版", "摇杆" in pg.text_content("#raidTip") or "交互" in pg.text_content("#raidTip"))
    check("容器格尺寸走 --rpcell(34px)", pg.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--rpcell').trim()") == "34px")
    check("画布不溢出屏宽", pg.evaluate("() => document.querySelector('#raidCanvas').getBoundingClientRect().width <= 390"))

    # 摇杆移动：按住向右 0.9s，玩家应向右走若干格
    before = pg.evaluate("() => [window.DFR_UI._raid.run.px, window.DFR_UI._raid.run.py]")
    jb = pg.locator("#raidJoy").bounding_box()
    cx, cy = jb["x"] + jb["width"] / 2, jb["y"] + jb["height"] / 2
    pg.mouse.move(cx, cy)
    pg.mouse.down()
    pg.mouse.move(cx + 40, cy, steps=4)
    time.sleep(0.9)
    pg.mouse.up()
    after = pg.evaluate("() => [window.DFR_UI._raid.run.px, window.DFR_UI._raid.run.py]")
    check("摇杆向右移动生效", after[0] > before[0] or after[1] != before[1], f"{before} → {after}")

    # 传送到容器旁，按「交互」按钮开搜（按钮文案应变「开 吃」）
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid;
      const c = Raid.run.containers[0];
      const spots = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({x:c.x+dx, y:c.y+dy}))
        .filter(t => !Raid.run.map.tiles[t.y][t.x] && !Raid.run.containers.some(cc => cc.x===t.x && cc.y===t.y));
      Raid.run.px = spots[0].x; Raid.run.py = spots[0].y;
      Raid.run.patrols.forEach(pp => { pp.radius = 0; });
    }""")
    pg.evaluate("() => window.DFR_UI._raid && void 0")
    time.sleep(0.2)
    pg.tap("#raidBtnF")
    pg.wait_for_selector("#raidOverlay:not(.hidden)")
    check("点交互按钮开搜", True)

    # 等自动鉴定完，双击 staging 入包（触屏双击）
    for _ in range(120):
        if pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-silhouette').length") == 0: break
        time.sleep(0.5)
    pg.dispatch_event("#rpStaging .rp-stage-item", "dblclick")
    time.sleep(0.3)
    bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
    check("触屏双击入包", bag_n == 1, f"bag={bag_n}")

    # 触屏拖拽 staging → 背包（pointer 流）
    if pg.evaluate("() => document.querySelectorAll('#rpStaging .rp-stage-item').length") > 0:
        sb = pg.locator("#rpStaging .rp-stage-item").first.bounding_box()
        db = pg.locator("#rpBagMain").bounding_box()
        pg.mouse.move(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2)
        pg.mouse.down()
        pg.mouse.move(sb["x"] + sb["width"] / 2 + 20, sb["y"] + sb["height"] / 2 + 20, steps=3)
        pg.mouse.move(db["x"] + db["width"] / 2, db["y"] + db["height"] / 2, steps=8)
        pg.mouse.up()
        time.sleep(0.3)
        bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
        check("触屏拖拽入包", bag_n == 2, f"bag={bag_n}")

    pg.click("#rpClose")
    time.sleep(0.3)
    label = pg.text_content("#raidBtnF").strip()
    check("交互按钮文案跟随场景=再 翻", label == "再 翻", label)

    # 「背包」按钮开关背包浮层（浮层开着时操控条收起，用面板上的「收起」关）
    pg.tap("#raidBtnBag")
    time.sleep(0.3)
    check("背包按钮打开背包浮层", pg.is_visible("#bagOverlay"))
    check("浮层开着时操控条收起", pg.evaluate("() => getComputedStyle(document.querySelector('#raidTouchUI')).display") == "none")
    pg.tap("#bagOvClose")
    time.sleep(0.3)
    check("收起按钮关闭背包浮层", not pg.is_visible("#bagOverlay"))
    check("关浮层后操控条恢复", pg.evaluate("() => getComputedStyle(document.querySelector('#raidTouchUI')).display") == "flex")

    # 浮层内容器与背包在窄屏竖排且不溢出
    check("浮层不溢出屏宽", pg.evaluate("() => document.querySelector('#raidPanel').getBoundingClientRect().width <= 390"))

    check("全程无 JS 报错", not errors, "; ".join(errors[:3]))
    ctx.close()
    b.close()

print("\n" + ("全部通过" if not fails else f"失败 {len(fails)} 项：{fails}"))
sys.exit(1 if fails else 0)
