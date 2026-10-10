# -*- coding: utf-8 -*-
"""近距实测：把玩家传送到 B-17 编队旁（x=36500, y=5000），读 draw call/tris + 截图。
对比原始模型 vs 合并优化模型的渲染开销。用法：python tests/python/_b17_closeup_calls.py"""
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
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:200]))
        page.on("console", lambda m: print("[console.error]", m.text[:200]) if m.type == "error" else None)
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
        await page.wait_for_timeout(2000)

        # 传送到编队领队前方 1.5km（朝西迎头视角，全机群在视锥内）
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            r.player.root.position.set(36300, 5000, 0);
            r.player.speed = 90;
        }""")
        await page.wait_for_timeout(1200)
        info = await page.evaluate("""() => new Promise(function(res){
            requestAnimationFrame(function(){ requestAnimationFrame(function(){
                const r = window.__shell.runtime;
                const ri = r.ctx.renderer.info;
                res({calls: ri.render.calls, tris: ri.render.triangles});
            }); });
        })""")
        print("近距机群（当前 b17.glb）:", info)
        await page.screenshot(path="tests/screenshots/berlin_bomber_closeup.png")
        await b.close()

asyncio.run(main())
