#!/usr/bin/env python3
"""鼠鼠摸金极限场景 e2e（"极限情况与对应策略"处置清单的实测部分）
前置：仓库根目录起 python3 -m http.server 8931"""
import sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/#/raid"
fails = []

def check(name, cond, extra=""):
    print(("✓ " if cond else "✗ ") + name + (f"  [{extra}]" if extra else ""))
    if not cond:
        fails.append(name)

def fresh(pg, vw=1280):
    pg.goto(URL)
    pg.wait_for_selector("#raidCanvas")
    time.sleep(1.0)
    pg.evaluate("""() => { // 传送容器旁 + 关巡逻
      const Raid = window.DFR_UI._raid;
      const c = Raid.run.containers[0];
      const spots = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({x:c.x+dx, y:c.y+dy}))
        .filter(t => !Raid.run.map.tiles[t.y][t.x] && !Raid.run.containers.some(cc => cc.x===t.x && cc.y===t.y));
      Raid.run.px = spots[0].x; Raid.run.py = spots[0].y;
      Raid.run.vx = Raid.run.px * 30; Raid.run.vy = Raid.run.py * 30;
      Raid.run.patrols.forEach(pp => { pp.radius = 0; });
    }""")

def open_first_container(pg):
    pg.keyboard.press("f")
    pg.wait_for_selector("#raidOverlay:not(.hidden)")
    for _ in range(120):
        if pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-silhouette').length") == 0: break
        time.sleep(0.5)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    # ---------- 1. 包满入包：主背包装满 + 安全箱塞不下 → 拒绝且货留容器 ----------
    fresh(pg)
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid, DFR = window.DFR, L = window.DF_LOOT;
      const big = L.items.find(i => i.len === 2 && i.wid === 2 && i.value != null);
      const bag = Raid.run.bagMain;
      for (let i = 0; i < 6; i++) DFR.addToBag(bag, big); // 6×4 塞满 2×2
      const big2 = L.items.find(i => i.len === 2 && i.wid === 2 && i.value != null && i.id !== big.id) || big;
      DFR.addToBag(Raid.run.bagSafe, big2); // 安全箱也满
    }""")
    open_first_container(pg)
    staged_n = pg.evaluate("() => document.querySelectorAll('#rpStaging .rp-stage-item').length")
    pg.locator("#rpStaging .rp-stage-item").first.dblclick()
    time.sleep(0.3)
    bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
    check("包满入包被拒、货留容器", bag_n == 7 and
          pg.evaluate("() => document.querySelectorAll('#rpStaging .rp-stage-item').length") == staged_n)
    pg.click("#rpClose")
    time.sleep(0.3)

    # ---------- 2. 撤离完成与被看见同帧：撤离优先（checkExtract 先于 detect） ----------
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid;
      const e = Raid.run.map.extracts[0];
      Raid.run.px = e.x; Raid.run.py = e.y;
      Raid.run.vx = e.x * 30; Raid.run.vy = e.y * 30;
      const p = Raid.run.patrols[0];
      p.radius = 99; p.x = e.x; p.y = e.y; p.vx = e.x * 30; p.vy = e.y * 30;
      Raid.run.extracting = performance.now() - 99999; // 引导早该完成
    }""")
    time.sleep(1.0)
    check("撤离与被看见同帧→撤离优先", pg.evaluate("() => window.DFR_UI._raid.run.status") == "extracted")
    pg.evaluate("() => window.DFR_UI.setMode('daily')")
    time.sleep(0.5)

    # ---------- 3. 拖拽进行中不算挂机 + 结算瞬间拖拽收场 ----------
    fresh(pg)
    open_first_container(pg)
    pg.evaluate("() => { window.DFR_UI._raid.lastAct = performance.now() - 6 * 60 * 1000; }")
    sb = pg.locator("#rpStaging .rp-stage-item").first.bounding_box()
    pg.mouse.move(sb["x"] + 100, sb["y"] + 20)
    pg.mouse.down()
    pg.mouse.move(sb["x"] + 160, sb["y"] + 60, steps=4)
    time.sleep(5.6)  # checkIdle 5s 轮询：拖拽中应跳过
    check("拖拽中不误判挂机", pg.evaluate("() => window.DFR_UI._raid.run.status") == "playing")
    # 保持拖拽，直接被抓 → 幽灵必须收场
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid;
      const p = Raid.run.patrols[0];
      p.radius = 99; p.x = Raid.run.px; p.y = Raid.run.py;
      p.vx = Raid.run.vx; p.vy = Raid.run.vy;
    }""")
    for _ in range(20):
        if pg.evaluate("() => window.DFR_UI._raid.run.status") != "playing": break
        time.sleep(0.3)
    pg.mouse.up()
    check("结算瞬间拖拽幽灵收场", pg.evaluate("() => !document.querySelector('.drag-ghost')"))
    pg.mouse.up()

    # ---------- 4. 挂机 4:59 续命：lastAct 未超限不出局 ----------
    fresh(pg)
    pg.evaluate("() => { window.DFR_UI._raid.lastAct = performance.now() - (4 * 60 + 50) * 1000; }")
    time.sleep(5.6)  # 轮询到：4:59 < 5:00 不应出局
    check("挂机 4:59 不出局", pg.evaluate("() => window.DFR_UI._raid.run.status") == "playing")
    # 背包浮层开着时挂机超时：出局 + 浮层清理
    pg.keyboard.press("Tab")
    time.sleep(0.3)
    pg.evaluate("() => { window.DFR_UI._raid.lastAct = performance.now() - 6 * 60 * 1000; }")
    for _ in range(24):
        if pg.evaluate("() => window.DFR_UI._raid.run.status") != "playing": break
        time.sleep(0.5)
    check("浮层开着挂机超时仍出局", pg.evaluate("() => window.DFR_UI._raid.run.status") == "lost")
    check("出局后背包浮层已清理", not pg.is_visible("#bagOverlay"))
    check("挂机卡文案", "挂机" in pg.text_content("#celebGrade"))
    pg.click("#celebAgain")
    time.sleep(0.5)

    # ---------- 5. 搜索中关浮层再开：未鉴定继续自动搜 ----------
    pg.evaluate("""() => { // 到新容器旁
      const Raid = window.DFR_UI._raid;
      const c = Raid.run.containers[1];
      const spots = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({x:c.x+dx, y:c.y+dy}))
        .filter(t => !Raid.run.map.tiles[t.y][t.x] && !Raid.run.containers.some(cc => cc.x===t.x && cc.y===t.y));
      Raid.run.px = spots[0].x; Raid.run.py = spots[0].y;
      Raid.run.patrols.forEach(pp => { pp.radius = 0; });
    }""")
    pg.keyboard.press("f")
    pg.wait_for_selector("#raidOverlay:not(.hidden)")
    pg.click("#rpClose")  # 可能还在搜，直接关
    time.sleep(0.3)
    pg.keyboard.press("f")
    pg.wait_for_selector("#raidOverlay:not(.hidden)")
    done = False
    for _ in range(120):
        if pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-silhouette').length") == 0:
            done = True; break
        time.sleep(0.5)
    check("搜索中关浮层再开继续自动搜", done)
    pg.click("#rpClose")
    time.sleep(0.3)

    # ---------- 6. 空容器 ----------
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid;
      const c = Raid.run.containers[2];
      c.drops = []; // 人为造空容器
      const spots = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({x:c.x+dx, y:c.y+dy}))
        .filter(t => !Raid.run.map.tiles[t.y][t.x] && !Raid.run.containers.some(cc => cc.x===t.x && cc.y===t.y));
      Raid.run.px = spots[0].x; Raid.run.py = spots[0].y;
    }""")
    pg.keyboard.press("f")
    pg.wait_for_selector("#raidOverlay:not(.hidden)")
    check("空容器提示干净", "干净" in pg.text_content("#rpMsg"))
    pg.click("#rpClose")
    time.sleep(0.3)

    # ---------- 7. 容器没空位时放回被拒 ----------
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid, DFR = window.DFR, L = window.DF_LOOT;
      const c = Raid.run.containers[2];
      const cell = L.items.find(i => i.cells === 1 && i.value != null);
      c.w = 1; c.h = 1;
      c.drops = [{ item: cell, x: 0, y: 0, w: 1, h: 1, revealed: true, taken: false }]; // 1×1 已占满
      const bag = Raid.run.bagMain;
      const cell2 = L.items.find(i => i.cells === 1 && i.value != null && i.id !== cell.id) || cell;
      DFR.addToBag(bag, cell2);
      const spots = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({x:c.x+dx, y:c.y+dy}))
        .filter(t => !Raid.run.map.tiles[t.y][t.x] && !Raid.run.containers.some(cc => cc.x===t.x && cc.y===t.y));
      Raid.run.px = spots[0].x; Raid.run.py = spots[0].y;
      window.DFR_UI.render();
    }""")
    pg.keyboard.press("f")
    pg.wait_for_selector("#raidOverlay:not(.hidden)")
    bag_before = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length")
    pg.dispatch_event("#rpBagMain .bag-item", "dblclick")  # 双击放回
    time.sleep(0.3)
    check("容器没空位放回被拒", pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length") == bag_before)
    pg.click("#rpClose")
    time.sleep(0.3)

    # ---------- 8. 图片 404 兜底 ----------
    fb = pg.evaluate("""() => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<img src="assets/props/nope_404.png" data-name="测试物" data-grade="5" onerror="window.__dfRaidImg(this)">`;
      document.body.appendChild(wrap);
      const img = wrap.querySelector('img');
      img.dispatchEvent(new Event('error'));
      const fb = wrap.querySelector('.rit-fb');
      const r = fb ? { cls: fb.className, txt: fb.textContent } : null;
      wrap.remove();
      return r;
    }""")
    check("图片 404 兜底色块", fb and "g5" in fb["cls"] and fb["txt"] == "测")

    # ---------- 9. 窄屏 320px 最大容器不溢出 ----------
    pg2 = b.new_page(viewport={"width": 320, "height": 568}, has_touch=True, is_mobile=True)
    err2 = []
    pg2.on("pageerror", lambda e: err2.append(str(e)))
    pg2.goto(URL)
    pg2.wait_for_selector("#raidCanvas")
    time.sleep(1)
    pg2.evaluate("""() => {
      const Raid = window.DFR_UI._raid, L = window.DF_LOOT;
      const bigC = L.containers.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0]; // 最大容器
      const c = Raid.run.containers[0];
      c.w = bigC.w; c.h = bigC.h; c.cid = bigC.id; c.name = bigC.name; c.tier = bigC.tier;
      const spots = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({x:c.x+dx, y:c.y+dy}))
        .filter(t => !Raid.run.map.tiles[t.y][t.x] && !Raid.run.containers.some(cc => cc.x===t.x && cc.y===t.y));
      Raid.run.px = spots[0].x; Raid.run.py = spots[0].y;
      Raid.run.patrols.forEach(pp => { pp.radius = 0; });
    }""")
    pg2.keyboard.press("f")
    pg2.wait_for_selector("#raidOverlay:not(.hidden)")
    time.sleep(0.5)
    check("320px 最大容器浮层不溢出", pg2.evaluate("""() => {
      const p = document.querySelector('#raidPanel').getBoundingClientRect();
      return p.width <= 320 && p.left >= 0 && p.right <= 321;
    }"""))
    pg2.close()

    # ---------- 10. localStorage 不可用（隐私模式）不崩 ----------
    pg3 = b.new_page()
    err3 = []
    pg3.on("pageerror", lambda e: err3.append(str(e)))
    pg3.add_init_script("""() => {
      const bad = () => { throw new DOMException('denied', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', { get: bad });
    }""")
    pg3.goto(URL)
    time.sleep(1.5)
    ok3 = pg3.evaluate("() => !!window.DFR_UI && !!window.DFR_UI._raid && window.DFR_UI._raid.run.containers.length > 0")
    check("localStorage 不可用页面正常起局", ok3)
    check("localStorage 异常无未捕获报错", not err3, "; ".join(err3[:2]))
    pg3.close()
    b.close()

    print("\n" + ("全部通过" if not fails else f"失败 {len(fails)} 项：{fails}"))
    if errors:
        print("页面报错:", errors[:3])
    sys.exit(1 if fails or errors else 0)
