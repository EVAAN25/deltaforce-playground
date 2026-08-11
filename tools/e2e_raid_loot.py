#!/usr/bin/env python3
"""鼠鼠摸金端到端自测：容器多次摸取 / 背包双击拖拽挪位 / 悬停F / 拖空白丢弃 / 撤离撒花放歌
前置：仓库根目录起 python3 -m http.server 8931"""
import sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/#/raid"
fails = []


def wait_meme(pg, timeout=4.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pg.evaluate("() => { const im = document.querySelector('#celebImg'); return im.complete && im.naturalWidth > 0; }"):
            return True
        time.sleep(0.3)
    return False

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
    check("顶部新手引导（桌面口径）", "WASD" in pg.text_content("#raidHowto") and "安全箱" in pg.text_content("#raidHowto"))

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
    pg.locator("#rpStaging .rp-stage-item").first.dblclick()
    time.sleep(0.3)
    bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
    check("双击放入背包", bag_n == 2)
    # 身上价值 = 主背包+安全箱合计，实时更新
    carry = pg.evaluate("() => window.DFR.bagValue(window.DFR_UI._raid.run.bagMain) + window.DFR.bagValue(window.DFR_UI._raid.run.bagSafe)")
    shown = pg.evaluate("() => parseInt(document.querySelector('#rpBagValue').textContent.replace(/[^0-9]/g, ''))")
    check("背包区显示身上合计价值", shown == carry and carry > 0, f"{shown}/{carry}")

    # 悬停按 F → 入包（待拾取区还有才测）
    if pg.evaluate("() => document.querySelectorAll('#rpStaging .rp-stage-item').length") > 0:
        src = pg.locator("#rpStaging .rp-stage-item").first
        sb = src.bounding_box()
        pg.mouse.move(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2)
        time.sleep(0.2)
        bag_before = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
        pg.keyboard.press("f")
        time.sleep(0.3)
        bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
        check("悬停按 F 放入背包", bag_n == bag_before + 1, f"bag={bag_n}")
    else:
        bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")

    # 悬在「入包」按钮上按 F → 不触发（F 只对物品本体生效；有待拾取才测）
    if pg.evaluate("() => document.querySelectorAll('#rpStaging .rp-stage-item').length") > 0:
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
        bag_before = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
        drag(pg, sb, (db["x"] + db["width"] / 2, db["y"] + db["height"] / 2))
        bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
        check("拖拽放入背包", bag_n == bag_before + 1, f"bag={bag_n}")

    # 从容器格子直接拖入背包（如还有未拿走的）
    if pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-item.revealed:not(.taken)').length") > 0:
        gb = pg.locator("#rpGrid .rp-item.revealed:not(.taken)").first.bounding_box()
        db = pg.locator("#rpBagMain").bounding_box()
        bag_before = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
        rev_before = pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-item.revealed:not(.taken)').length")
        pg.mouse.move(gb["x"] + gb["width"] / 2, gb["y"] + gb["height"] / 2)
        pg.mouse.down()
        pg.mouse.move(gb["x"] + gb["width"] / 2 + 30, gb["y"] + gb["height"] / 2 + 30, steps=3)
        pg.mouse.move(db["x"] + db["width"] / 2, db["y"] + db["height"] / 2, steps=4)
        time.sleep(0.2)
        check("拖拽幽灵可见（z-index 99 压过浮层）",
              pg.evaluate("() => { const g = document.querySelector('.drag-ghost'); return g && getComputedStyle(g).zIndex === '99' && g.getBoundingClientRect().width > 0; }"))
        pg.mouse.move(db["x"] + db["width"] / 2, db["y"] + db["height"] / 2, steps=4)
        pg.mouse.up()
        time.sleep(0.3)
        bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
        check("容器格子直接拖入背包", bag_n == bag_before + 1, f"bag={bag_n}")
        rev_after = pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-item.revealed:not(.taken)').length")
        taken_ghost = pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-item.taken').length")
        check("拿走的格子直接清除（不留置灰占位）", rev_after == rev_before - 1 and taken_ghost == 0,
              f"revealed {rev_before}→{rev_after}, taken占位 {taken_ghost}")

    # 双击容器格子物品图标 → 入包（如还有未拿走的）
    if pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-item.revealed:not(.taken)').length") > 0:
        bag_before = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
        pg.locator("#rpGrid .rp-item.revealed:not(.taken)").first.dblclick()
        time.sleep(0.3)
        bag_n = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
        check("双击物品图标进包", bag_n == bag_before + 1, f"bag={bag_n}")

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

    # 自动横竖（确定性场景）：A=2×1 拖到被 B 占据的右边界，横向被挡 → 自动竖放
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid, DFR = window.DFR, L = window.DF_LOOT;
      Raid.run.bagMain = DFR.makeBag(6, 4);
      const a = L.items.find(i => i.len === 2 && i.wid === 1 && i.value != null);
      const b = L.items.find(i => i.len === 2 && i.wid === 1 && i.value != null && i.id !== a.id);
      DFR.addToBag(Raid.run.bagMain, a); // (0,0)-(1,0)
      const bag = Raid.run.bagMain;
      bag.items.push({ item: b, x: 4, y: 0, w: 2, h: 1 }); // B 堵右边界 (4,0)-(5,0)
      bag.occ[0][4] = 1; bag.occ[0][5] = 1;
      window.DFR_UI.render();
    }""")
    time.sleep(0.3)
    cs = pg.evaluate("() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bagcell'), 10) || 44")
    r = pg.locator("#rpBagMain").bounding_box()
    ib = pg.locator("#rpBagMain .bag-item").nth(0).bounding_box()
    pg.mouse.move(ib["x"] + ib["width"] / 2, ib["y"] + ib["height"] / 2)
    pg.mouse.down()
    pg.mouse.move(ib["x"] + ib["width"] / 2 + 25, ib["y"] + ib["height"] / 2 + 12, steps=3)
    pg.mouse.move(r["x"] + 5.5 * cs, r["y"] + 0.5 * cs, steps=8)
    pg.mouse.up()
    time.sleep(0.3)
    wh = pg.evaluate("() => { const e = window.DFR_UI._raid.run.bagMain.items[0]; return [e.x, e.y, e.w, e.h]; }")
    check("拖到横向被挡自动竖放", wh[2] == 1 and wh[3] == 2, f"{wh}")

    # 拖拽互换：A=2×1 拖到 B=1×1 头上 → 交换位置
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid, DFR = window.DFR, L = window.DF_LOOT;
      Raid.run.bagMain = DFR.makeBag(6, 4);
      const a = L.items.find(i => i.len === 2 && i.wid === 1 && i.value != null);
      const b = L.items.find(i => i.cells === 1 && i.value != null && i.id !== a.id);
      DFR.addToBag(Raid.run.bagMain, a);
      DFR.addToBag(Raid.run.bagMain, b);
      window.DFR_UI.render();
    }""")
    time.sleep(0.3)
    cs = pg.evaluate("() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bagcell'), 10) || 44")
    r = pg.locator("#rpBagMain").bounding_box()
    ib = pg.locator("#rpBagMain .bag-item").nth(0).bounding_box()
    pg.mouse.move(ib["x"] + ib["width"] / 2, ib["y"] + ib["height"] / 2)
    pg.mouse.down()
    pg.mouse.move(ib["x"] + ib["width"] / 2 + 30, ib["y"] + ib["height"] / 2 + 20, steps=3)
    pg.mouse.move(r["x"] + 2.5 * cs, r["y"] + 0.5 * cs, steps=8)
    pg.mouse.up()
    time.sleep(0.3)
    pos = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.map(e => [e.x, e.y])")
    check("拖拽压位互换", pos[0] == [2, 0] and pos[1] == [0, 0], f"{pos}")

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

    # 拖到「面板内空白」（如 rp-msg 文字区）→ 不丢弃
    safe_before = pg.evaluate("() => window.DFR_UI._raid.run.bagSafe.items.length")
    main_before = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length")
    which_sel = "#rpBagSafe .bag-item" if safe_before else "#rpBagMain .bag-item"
    mb = pg.locator("#rpMsg").bounding_box()
    ib = pg.locator(which_sel).first.bounding_box()
    drag(pg, ib, (mb["x"] + mb["width"] / 2, mb["y"] + mb["height"] / 2))
    tot = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
    check("面板内空白不丢弃", tot == safe_before + main_before, f"{tot}")

    # 拖出整个面板外 → 丢弃
    safe_before = pg.evaluate("() => window.DFR_UI._raid.run.bagSafe.items.length")
    main_before = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length")
    which_sel = "#rpBagSafe .bag-item" if safe_before else "#rpBagMain .bag-item"
    ib = pg.locator(which_sel).first.bounding_box()
    drag(pg, ib, (30, 300))  # 浮层面板外的背景区
    tot_after = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
    check("拖出面板外丢弃", tot_after == safe_before + main_before - 1, f"{safe_before + main_before}→{tot_after}")

    # 关闭浮层 → 再开：已摸物品直接可见、不重新鉴定
    pg.click("#rpClose")
    time.sleep(0.3)

    # Tab 打开背包浮层 → ESC 关闭 → Tab 开关（与搜索浮层互斥，须在关搜索后测）
    pg.keyboard.press("Tab")
    time.sleep(0.3)
    check("Tab 打开背包浮层", pg.is_visible("#bagOverlay"))
    ov_items = pg.evaluate("() => document.querySelectorAll('#bagOvMain .bag-item, #bagOvSafe .bag-item').length")
    check("背包浮层渲染物品", ov_items == tot_after, f"{ov_items}/{tot_after}")
    # 背包浮层里双击 / 悬停按 F 都不丢弃（丢弃只能拖出去；包空则跳过）
    if tot_after > 0:
        pg.dispatch_event("#bagOvMain .bag-item, #bagOvSafe .bag-item", "dblclick")
        time.sleep(0.2)
        bb = pg.locator("#bagOvMain .bag-item, #bagOvSafe .bag-item").first.bounding_box()
        pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
        time.sleep(0.2)
        pg.keyboard.press("f")
        time.sleep(0.2)
        tot2 = pg.evaluate("() => window.DFR_UI._raid.run.bagMain.items.length + window.DFR_UI._raid.run.bagSafe.items.length")
        check("背包浮层双击/按F 不丢弃", tot2 == tot_after, f"{tot2}/{tot_after}")
    pg.keyboard.press("Escape")
    time.sleep(0.3)
    check("ESC 关闭背包浮层", not pg.is_visible("#bagOverlay"))
    pg.keyboard.press("Tab")
    time.sleep(0.2)
    pg.keyboard.press("Tab")
    time.sleep(0.2)
    check("Tab 再按关闭", not pg.is_visible("#bagOverlay"))

    searched = pg.evaluate("() => window.DFR_UI._raid.run.searched")
    pg.keyboard.press("f")
    time.sleep(0.5)
    sil = pg.evaluate("() => document.querySelectorAll('#rpGrid .rp-silhouette').length")
    check("重开容器：已鉴定物品直接显示（无剪影）", sil == 0)
    drops_same = pg.evaluate("() => window.DFR_UI._raid.run.containers[0].drops.length")
    check("同一局容器内容不变", drops_same >= total, f"{drops_same}/{total}（放回会加件）")
    pg.keyboard.press("Escape")
    time.sleep(0.3)
    check("ESC 关闭搜索浮层", not pg.is_visible("#raidOverlay"))
    searched2 = pg.evaluate("() => window.DFR_UI._raid.run.searched")
    check("重开不重复计摸过数", searched2 == searched, f"{searched2}")

    # 强制撤离成功：传送撤离点 + 跳过引导
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid;
      const e = Raid.run.map.extracts[0];
      Raid.run.px = e.x; Raid.run.py = e.y;
      Raid.run.extracting = performance.now() - 99999;
    }""")
    time.sleep(0.4)
    check("撤离结算出现", pg.is_visible("#raidResult"))
    check("撤离撒花图层出现", pg.evaluate("() => !!document.querySelector('.confetti-layer')"))
    check("撒花碎片数量 > 0", pg.evaluate("() => document.querySelectorAll('.confetti-pc').length") > 0)
    check("结算文案=肥肥撤离", "肥肥撤离" in pg.text_content("#raidResult"))

    # 每日一图通关 → 庆祝卡（表情包弹卡）+ 引导关卡模式
    check("庆祝卡弹出", pg.is_visible("#raidCeleb"))
    check("庆祝卡表情包已加载", wait_meme(pg))
    check("庆祝卡含引导按钮", pg.is_visible("#celebGoLevels"))
    check("成功卡有再来一局", pg.is_visible("#celebAgain"))
    # 复制分享卡 → toast 压过卡片在最上层
    pg.click("#celebShare")
    time.sleep(0.5)
    check("分享 toast 可见且最上层", pg.is_visible("#toast") and
          pg.evaluate("() => getComputedStyle(document.querySelector('#toast')).zIndex") == "70")
    pg.click("#celebGoLevels")
    time.sleep(0.5)
    check("点击后切到关卡模式", pg.is_visible("#raidLevels") and pg.evaluate("() => window.DFR_UI.getMode()") == "levels")
    check("庆祝卡已收", not pg.is_visible("#raidCeleb"))

    # 红音效加长版 V3 可加载
    snd = pg.evaluate("""() => new Promise((res) => {
      const a = new Audio();
      a.oncanplaythrough = () => res('OK');
      a.onerror = () => res('FAIL');
      a.src = 'assets/sfx/reveal-red-v3-half.mp3';
    })""")
    check("红音效 V3 可加载", snd == "OK")

    # 失败也弹卡（被抓）：表情包 + 分享/再来一局按钮（关卡模式无去闯关）
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid;
      Raid.run.status = "playing";
      const p = Raid.run.patrols[0];
      p.radius = 99;
      p.x = Raid.run.px; p.y = Raid.run.py;
    }""")
    for _ in range(20):  # detect 走 tick，轮询等结算
        if pg.evaluate("() => window.DFR_UI._raid.run.status") != "playing": break
        time.sleep(0.3)
    check("被抓失败卡弹出", pg.is_visible("#raidCeleb"))
    check("失败卡标题", "被一脚踢死" in pg.text_content("#celebGrade"))
    check("失败卡表情包已加载", wait_meme(pg))
    check("失败卡有分享/再来一局", pg.is_visible("#celebShare") and pg.is_visible("#celebAgain"))
    check("关卡模式失败卡无去闯关", pg.evaluate("() => !document.querySelector('#celebGoLevels')"))
    pg.click("#celebAgain")
    time.sleep(0.5)
    check("失败卡再来一局重开", pg.evaluate("() => window.DFR_UI._raid.run.status") == "playing" and not pg.is_visible("#raidCeleb"))

    # 每日模式失败卡有去闯关
    pg.evaluate("() => window.DFR_UI.setMode('daily')")
    time.sleep(0.5)
    pg.evaluate("""() => {
      const Raid = window.DFR_UI._raid;
      const p = Raid.run.patrols[0];
      p.radius = 99;
      p.x = Raid.run.px; p.y = Raid.run.py;
    }""")
    for _ in range(20):
        if pg.evaluate("() => window.DFR_UI._raid.run.status") != "playing": break
        time.sleep(0.3)
    check("每日被抓失败卡有去闯关", pg.is_visible("#celebGoLevels"))
    pg.click("#celebGoLevels")
    time.sleep(0.5)
    check("失败卡去闯关切关卡模式", pg.evaluate("() => window.DFR_UI.getMode()") == "levels")

    # 挂机 5 分钟无操作自动出局（无倒计时）
    pg.evaluate("() => { window.DFR_UI.setMode('daily'); }")
    time.sleep(0.5)
    pg.evaluate("() => { window.DFR_UI._raid.lastAct = performance.now() - 6 * 60 * 1000; }")
    # checkIdle 5s 轮询；冷文件加载饿主线程会推迟定时器，给足 20s 窗口（2026-08-11 抖动实测）
    for _ in range(40):
        if pg.evaluate("() => window.DFR_UI._raid.run.status") != "playing": break
        time.sleep(0.5)
    check("挂机超时自动出局", pg.evaluate("() => window.DFR_UI._raid.run.status") == "lost")
    check("挂机失败卡文案", "挂机" in pg.text_content("#celebGrade"))

    check("全程无 JS 报错", not errors, "; ".join(errors[:3]))
    b.close()

print("\n" + ("全部通过" if not fails else f"失败 {len(fails)} 项：{fails}"))
sys.exit(1 if fails else 0)
