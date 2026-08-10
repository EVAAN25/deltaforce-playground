import json, re, time
from playwright.sync_api import sync_playwright

CONTAINERS = {1:'大保险箱',4:'小保险箱',3:'航空箱',5:'实验服',2:'鸟窝',8:'高级储物箱',
 9:'医疗物资堆',11:'登山包',17:'电脑',18:'服务器',22:'大武器箱',6:'井盖',7:'高级旅行箱',
 10:'医疗包',12:'旅行袋',13:'快递箱',14:'抽屉柜',15:'垃圾箱',16:'野外物资堆',19:'手提箱',
 20:'大工具盒',21:'电脑机箱',23:'弹药箱',24:'工具柜'}
OPENS = 400
VAL_RE = re.compile(r'^[\d.,]+ ?[KM]?$')
SKIP = ('价值【','不够不够','算了','查看得吃记录','第','【得吃记录】')

result = {}
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36")
    page.goto('https://orzice.com/v/mnq_sstc', wait_until='networkidle', timeout=60000)
    time.sleep(3)
    page.evaluate("jinggao(); kfc();")
    time.sleep(1)
    for cid, cname in CONTAINERS.items():
        counts = {}
        for i in range(OPENS):
            page.evaluate(f"chi({cid})")
            page.wait_for_timeout(30)
            txt = page.evaluate("document.getElementById('moniqi').innerText")
            for line in txt.split('\n'):
                line = line.strip()
                if not line or VAL_RE.match(line): continue
                if any(s in line for s in SKIP): continue
                counts[line] = counts.get(line, 0) + 1
        result[cname] = dict(sorted(counts.items(), key=lambda x: -x[1]))
        print(cname, 'unique:', len(counts), 'total:', sum(counts.values()), flush=True)
    b.close()
json.dump(result, open(__file__.replace('sample_container_pools.py','') + 'data/container_pools_sample.json','w'), ensure_ascii=False, indent=1)
print('saved container_pools.json')
