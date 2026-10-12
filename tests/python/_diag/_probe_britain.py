"""不列颠关卡状态探针：用于对比当前代码与基线行为差异。
用法: python _probe_britain.py [port]
"""
import asyncio
import sys
from playwright.async_api import async_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PORT = sys.argv[1] if len(sys.argv) > 1 else "5173"
URL = f"http://127.0.0.1:{PORT}/index.html"


async def wait_for(page, js_cond, timeout=30_000, interval=500):
    elapsed = 0
    while elapsed < timeout:
        if await page.evaluate(js_cond):
            return True
        await asyncio.sleep(interval / 1000)
        elapsed += interval
    return False


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await (await browser.new_context(viewport={"width": 1600, "height": 900})).new_page()
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:200]))
        page.on("console", lambda m: print("[console.error]", m.text[:200]) if m.type == "error" else None)

        await page.goto(URL, wait_until="domcontentloaded")
        ok = await wait_for(page, "() => !!window.__shell", timeout=10_000)
        if not ok:
            print("FATAL: __shell 未出现"); await browser.close(); return
        await page.mouse.click(800, 450)
        await page.wait_for_timeout(300)
        await page.evaluate("window.__shell.router.go('level-select')")
        await wait_for(page, "() => !!document.querySelector('.level-card')")
        await page.evaluate("document.querySelector('.level-card[data-id=\"britain\"]').click()")
        await wait_for(page, "() => !!document.querySelector('.briefing-box')")
        await page.evaluate("document.querySelector('.briefing-box [data-action=\"start\"]').click()")

        ready = await wait_for(page, """
            () => { const r = window.__shell && window.__shell.runtime;
                    return !!(r && r.player && r.player.model && r.player.model.visible); }
        """, timeout=30_000)
        print(f"玩家就绪: {ready}")

        for i in range(6):
            await page.wait_for_timeout(5000)
            s = await page.evaluate("""
                () => { const r = window.__shell.runtime;
                        const wd = r.waveDirector;
                        return {
                            t: r._elapsed !== undefined ? Math.round(r._elapsed) : null,
                            pos: r.player.root.position.toArray().map(v => Math.round(v)),
                            alt: Math.round(r.player.root.position.y),
                            speed: Math.round(r.player.speed || 0),
                            enemies: (r.enemies || []).length,
                            enemiesVisible: (r.enemies || []).filter(e => e.model && e.model.visible).length,
                            wdState: wd ? { wave: wd._waveIndex, spawned: wd._spawnedCount, done: !!wd._done } : null,
                            phase: r._storyPhase !== undefined ? r._storyPhase : (r._story && r._story.phase) || null,
                            cinematic: !!(r.cinematic && r.cinematic._active),
                        }; }
            """)
            print(f"[{(i+1)*5}s] {s}")
        await browser.close()


asyncio.run(main())
