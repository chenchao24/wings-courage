# -*- coding: utf-8 -*-
"""复现：被击伤 B-17 返航后卡在空中。击伤一架（伤害过阈值但不击落），
每秒采样位置/朝向，观察停止点与状态。"""
import asyncio, sys
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
URL = "http://127.0.0.1:5173/index.html"

async def wait_for(page, js, timeout=90_000, interval=500):
    el = 0
    while el < timeout:
        r = await page.evaluate(js)
        if r:
            return r
        await asyncio.sleep(interval / 1000)
        el += interval
    return None

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await b.new_page(viewport={"width": 1600, "height": 900})
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:300]))
        page.on("console", lambda m: print("[console.error]", m.text[:300]) if m.type == "error" else None)
        await page.goto(URL, wait_until="domcontentloaded")
        await wait_for(page, "() => !!window.__shell")
        await page.mouse.click(800, 450)
        await page.wait_for_timeout(300)
        await page.evaluate("window.__shell.router.go('level-select')")
        await wait_for(page, "() => document.querySelector('.level-card')")
        await page.evaluate("document.querySelector('.level-card[data-id=\"berlin\"]').click()")
        await wait_for(page, "() => document.querySelector('.briefing-box')")
        await page.evaluate("document.querySelector('.briefing-box [data-action=\"start\"]').click()")
        await wait_for(page, """() => {
            const r = window.__shell && window.__shell.runtime;
            if (!r || !r.player || !r.player.model || !r.player.model.visible) return null;
            const bs = r.bomberStream || [];
            return (bs.length === 12 && bs.every(function(x){ return x.ready; })) ? 'ok' : null;
        }""", interval=800)
        await page.wait_for_timeout(1000)

        # 击伤 0 号（hp 450，阈值 55% → 打掉 250 血，留 200，触发返航不击落）
        st = await page.evaluate("""() => {
            const b = window.__shell.runtime.bomberStream[0];
            b.onBulletHit(250, null, -1, false);
            return {hp: b.hp, damaged: b.damaged, rtb: b._rtb};
        }""")
        print("击伤后状态:", st)

        # 每秒采样一次，共 20 秒（无头低帧率慢动作下观察转向趋势即可）
        for i in range(20):
            await page.wait_for_timeout(1000)
            s = await page.evaluate("""() => {
                const b = window.__shell.runtime.bomberStream[0];
                if (!b) return null;
                const e = b.root.quaternion;
                return {
                    t: %d,
                    pos: b.root.position.toArray().map(function(v){ return Math.round(v); }),
                    rtb: b._rtb, crashed: b.crashed, exploded: b._exploded,
                    ready: b.ready, despawn: !!b._despawnRequested,
                    quat: [e.x.toFixed(2), e.y.toFixed(2), e.z.toFixed(2), e.w.toFixed(2)],
                    fwd: b.getForward().toArray().map(function(v){ return +v.toFixed(2); }),
                    rtbSpeed: b._rtbSpeed
                };
            }""" % i)
            print(s)
            if s is None:
                print("→ 轰炸机已从列表移除（despawn）")
                break

        # 远距离脱离检查：再击伤一架并传送到离玩家 20km+ 处 → 应当即 despawn
        far = await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const before = r.bomberStream.length;
            const b = r.bomberStream[1];
            b.onBulletHit(250, null, -1, false);
            b.root.position.set(8000, 5000, 0);  // 玩家 ≈x=28000，相距 20km > 15km 阈值
            return new Promise(function(res){
                setTimeout(function(){
                    res({before: before, after: r.bomberStream.length, despawned: !!b._despawnRequested});
                }, 500);
            });
        }""")
        print("远距离脱离检查:", far)
        await b.close()

asyncio.run(main())
