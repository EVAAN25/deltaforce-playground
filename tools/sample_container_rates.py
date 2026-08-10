#!/usr/bin/env python3
"""小涛查开容器模拟器掉落率采样 V3：直接调服务端 roll 接口 /api/sjz/mnq_ss
（页面内 axios + GetPath 签名 + GetData01 解密，100ms 间隔定速，失败重试）。
每容器 2000 开 × 24 容器。输出 container_rates_api_raw.json（逐容器增量保存可断点续跑）。
口径：模拟器作者自述部分容器调高概率；官方从未公布爆率 —— 数字仅供相对比较。
"""
import json, os, time
from playwright.sync_api import sync_playwright

CONTAINERS = {1:'大保险箱',4:'小保险箱',3:'航空箱',5:'实验服',2:'鸟窝',8:'高级储物箱',
 9:'医疗物资堆',11:'登山包',17:'电脑',18:'服务器',22:'大武器箱',6:'井盖',7:'高级旅行箱',
 10:'医疗包',12:'旅行袋',13:'快递箱',14:'抽屉柜',15:'垃圾箱',16:'野外物资堆',19:'手提箱',
 20:'大工具盒',21:'电脑机箱',23:'弹药箱',24:'工具柜'}
OPENS = 2000
OUT = 'container_rates_api_raw.json'

result = json.load(open(OUT)) if os.path.exists(OUT) else {}

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36")
    for attempt in range(5):
        try:
            page.goto('https://orzice.com/v/mnq_sstc', wait_until='domcontentloaded', timeout=60000)
            page.wait_for_load_state('networkidle', timeout=60000)
            break
        except Exception as e:
            print(f'goto 失败第{attempt+1}次: {e}', flush=True); time.sleep(15)
    else:
        raise SystemExit('页面打不开')
    time.sleep(2)
    # 预热验证
    ok = page.evaluate("""async ()=>{ try{
      const res=await axios.get(BaseApiHost+'/api/sjz/mnq_ss'+GetPath('id=1&lv=0'));
      const p=GetData01(res.data.data); (typeof p==='string'?JSON.parse(p):p); return true;
    }catch(e){ return String(e).slice(0,200); } }""")
    if ok is not True:
        raise SystemExit(f'接口验证失败: {ok}')
    print('接口验证通过', flush=True)

    for cid, cname in CONTAINERS.items():
        if cname in result and result[cname]['opens'] >= OPENS:
            print(f'{cname} 已完成，跳过', flush=True); continue
        counts = result.get(cname, {}).get('items', {})
        grades = result.get(cname, {}).get('grades', {})
        done = result.get(cname, {}).get('opens', 0)
        t0 = time.time()
        while done < OPENS:
            n = min(500, OPENS - done)
            r = page.evaluate("""async ([cid,n])=>{
              const items={}; const grades={}; let opens=0, fail=0;
              for(let i=0;i<n;i++){
                let ok=false;
                for(let t=0;t<3 && !ok;t++){
                  try{
                    const res=await axios.get(BaseApiHost+'/api/sjz/mnq_ss'+GetPath('id='+cid+'&lv=0'));
                    const p=GetData01(res.data.data);
                    const arr=typeof p==='string'?JSON.parse(p):p;
                    opens++;
                    for(const it of arr){ items[it.name]=(items[it.name]||0)+1; grades[it.name]=it.grade; }
                    ok=true;
                  }catch(e){ fail++; await new Promise(r=>setTimeout(r,1000)); }
                }
                await new Promise(r=>setTimeout(r,100));
              }
              return {opens, fail, items, grades};
            }""", [cid, n])
            for k, v in r['items'].items(): counts[k] = counts.get(k, 0) + v
            grades.update(r['grades'])
            done += r['opens']
            result[cname] = {'opens': done, 'items': counts, 'grades': grades}
            json.dump(result, open(OUT, 'w'), ensure_ascii=False)
            print(f'  {cname}: {done}/{OPENS} 开 (失败重试 {r["fail"]} 次)', flush=True)
        dt = time.time() - t0
        print(f'{cname} 完成: {done} 开, {len(counts)} 种, {sum(counts.values())} 件, {dt:.0f}s', flush=True)
    b.close()

json.dump(result, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('saved', OUT)
