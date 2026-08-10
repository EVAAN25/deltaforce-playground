#!/usr/bin/env python3
"""抓取小涛查「物品单格价值」榜（https://orzice.com/v/item_jz）全量数据，
输出 tools/data/item_jz.json，供 build_loot.js 作为默认价格源。

页面数据接口 /api/xtc/item_jz_list 的响应是 AES 加密的（密钥在页面内联脚本里），
不逆向签名/解密，直接用 Playwright 开真实页面翻页，读 Vue 实例 AppDataVue.data
（页面自己解密后的明文）。374 件 / 38 页，全程约 1 分钟。

依赖：pip install playwright && playwright install chromium
用法：python3 tools/scrape_item_jz.py
"""
import datetime
import json
import math
import pathlib
import time

from playwright.sync_api import sync_playwright

URL = "https://orzice.com/v/item_jz"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
OUT = pathlib.Path(__file__).resolve().parent / "data" / "item_jz.json"


def main():
    all_items = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent=UA)
        page.goto(URL, wait_until="networkidle", timeout=60000)
        page.wait_for_function(
            "window.AppDataVue && AppDataVue.data && AppDataVue.data.length > 0",
            timeout=30000)
        count = page.evaluate("AppDataVue.count")
        items = json.loads(page.evaluate("JSON.stringify(AppDataVue.data)"))
        per = len(items)
        pages = math.ceil(count / per)
        print(f"count={count} per_page={per} pages={pages}")
        all_items.extend(items)
        for pg in range(2, pages + 1):
            page.evaluate(f"AppDataVue.page = {pg}; AppDataVue.getData();")
            time.sleep(0.8)
            items = json.loads(page.evaluate("JSON.stringify(AppDataVue.data)"))
            all_items.extend(items)
            print("page", pg, "got", len(items))
        browser.close()

    seen = {}
    for it in all_items:  # 翻页抖动去重，按 id
        seen[it["id"]] = it
    items = list(seen.values())
    if len(items) < count * 0.95:
        raise SystemExit(f"抓取不完整：{len(items)}/{count}，请重跑")

    out = {
        "source": URL,
        "date": datetime.date.today().isoformat(),
        "count": len(items),
        "items": [
            {
                "name": x["name"],
                "grade": x["grade"],          # 1灰 2绿 3蓝 4紫 5金 6红
                "price": x["price"],        # 交易行总价（哈夫币）
                "perCell": x["dgjz"],       # 单格价值 = price / cells
                "cells": x["wh"],           # 占格数
                "oid": x["oid"],
            }
            for x in items
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("saved", OUT, len(items), "items @", out["date"])


if __name__ == "__main__":
    main()
