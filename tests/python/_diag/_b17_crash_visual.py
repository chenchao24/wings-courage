# -*- coding: utf-8 -*-
"""坠毁视觉目检：强制一架进入爆燃解体（模式③）+ 一架爆炸（模式④），近距截图。"""
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

        # 模式③爆燃解体：0 号机；玩家置于其南侧 600m 同高度
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const b = r.bomberStream[0];
            b.hp = 20; b.onBulletHit(40, null, -1, true);  // hp=-20 非过量 → 随机①②③
            // 强制③便于目检
            b._falling = false; b._enterCrash(3);
            const p = b.root.position;
            r.player.root.position.set(p.x + 200, p.y + 60, p.z + 600);
            r.player.root.lookAt(p.x, p.y, p.z);
            window.__shotBomber = b;
        }""")
        await page.wait_for_timeout(2500)
        await page.screenshot(path="tests/screenshots/b17_crash_mode3.png")

        # 模式④爆炸：1 号机
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const b = r.bomberStream[1];
            b.hp = 30; b.onBulletHit(500, null, -1, true);  // 过量 → ④爆炸
            const p = b.root.position;
            r.player.root.position.set(p.x + 150, p.y + 50, p.z + 500);
            r.player.root.lookAt(p.x, p.y, p.z);
            window.__shotBomber = b;
        }""")
        await page.wait_for_timeout(1200)
        await page.screenshot(path="tests/screenshots/b17_crash_mode4.png")
        await page.wait_for_timeout(2500)
        await page.screenshot(path="tests/screenshots/b17_crash_mode4_late.png")
        print("saved: b17_crash_mode3/mode4/mode4_late.png")
        await b.close()

asyncio.run(main())
