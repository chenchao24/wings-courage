import asyncio, sys
from playwright.async_api import async_playwright
async def wait_for(page, js, timeout=40000, interval=500):
    e=0
    while e<timeout:
        r=await page.evaluate(js)
        if r: return r
        await asyncio.sleep(interval/1000); e+=interval
    return None
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True, args=["--no-sandbox","--disable-gpu-stutter"])
        pg=await (await b.new_context(viewport={"width":1600,"height":900})).new_page()
        errs=[]
        pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
        pg.on("console", lambda m: errs.append("console.error: "+m.text[:150]) if m.type=="error" else None)
        await pg.goto("http://127.0.0.1:5173/index.html", wait_until="domcontentloaded")
        await wait_for(pg, "() => !!window.__shell")
        await pg.mouse.click(800,450); await pg.wait_for_timeout(300)
        await pg.evaluate("window.__shell.router.go('level-select')")
        await wait_for(pg, "() => document.querySelector('.level-card')")
        await pg.evaluate("document.querySelector('.level-card[data-id=\"berlin\"]').click()")
        await wait_for(pg, "() => document.querySelector('.briefing-box')")
        await pg.evaluate("document.querySelector('.briefing-box [data-action=\"start\"]').click()")
        await wait_for(pg, """() => { const r=window.__shell&&window.__shell.runtime;
            return r&&r.player&&r.player.model&&r.player.model.visible?'ready':null; }""")
        n = await pg.evaluate("() => window.__shell.clouds ? window.__shell.clouds.clusters.length : -1")
        print("云团数量:", n)
        # 平视云层（交战高度内）
        await pg.evaluate("window.__shell.runtime.player.root.position.set(0, 3600, 0)")
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path="tests/test_shots/berlin_clouds_v3.png")
        # 高空俯瞰云系分布
        await pg.evaluate("""() => { const pl=window.__shell.runtime.player;
            pl.root.position.set(0, 6500, 0); pl.root.rotateX(0.5); }""")
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path="tests/test_shots/berlin_clouds_v3_top.png")
        print("页面错误:", errs if errs else "无")
        await b.close()
asyncio.run(main())
