"""IL-2 循环波次复现探针：杀 1 架、放跑 3 架，观察计数与波次状态。
用法: python _probe_il2.py [port]
"""
import asyncio
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
from playwright.async_api import async_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "5173"
URL = f"http://127.0.0.1:{PORT}/index.html"


async def wait_for(page, js_cond, timeout=40_000, interval=500):
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
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:150]))

        await page.goto(URL, wait_until="domcontentloaded")
        booted = await wait_for(page, "() => !!window.__shell", timeout=30_000)
        print("booted:", booted)
        if not booted:
            await browser.close()
            return
        await page.mouse.click(800, 450)
        await page.wait_for_timeout(300)
        await page.evaluate("window.__shell.router.go('level-select')")
        await wait_for(page, "() => !!document.querySelector('.level-card')")
        await page.evaluate("document.querySelector('.level-card[data-id=\"kursk\"]').click()")
        await wait_for(page, "() => !!document.querySelector('.briefing-box')")
        await page.evaluate("document.querySelector('.briefing-box [data-action=\"start\"]').click()")

        ok = await wait_for(page, """
            () => { const r = window.__shell && window.__shell.runtime;
                    return !!(r && r.player && r.player.model && r.player.model.visible); }
        """)
        print("玩家就绪:", ok)

        # 等剧情系统激活后 ESC 跳过（与 britain 测试同款时序）
        await wait_for(page, """
            () => { const r = window.__shell && window.__shell.runtime;
                    return r && r.cinematic && r.cinematic.active ? 1 : 0; }
        """, timeout=30_000)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(1000)

        # 直接跳到第 3 波（IL-2 循环波次）
        await page.evaluate("""
            () => { const wd = window.__shell.runtime.waveDirector;
                    wd._timer = 0; wd.state = 'idle'; wd.currentWaveIdx = -1;
                    wd._beginWave(2); }
        """)
        spawn_ok = await wait_for(page, """
            () => { const wd = window.__shell.runtime.waveDirector;
                    return wd._activeEnemies.length >= 4 && wd._activeEnemies.every(e => e.ready); }
        """, timeout=30_000)
        print("IL-2 4 架就绪:", spawn_ok)

        st0 = await page.evaluate("""
            () => window.__shell.runtime.waveDirector._activeEnemies.map(e => ({
                st: e._il2State, alt: Math.round(e.root.position.y),
            }))
        """)
        print("初始状态:", st0)

        # 击落 1 架（模拟玩家击杀路径：takeDamage 致死 → 坠毁爆炸 → WaveDirector 计数）
        await page.evaluate("""
            () => { const wd = window.__shell.runtime.waveDirector;
                    const e = wd._activeEnemies[0];
                    e.takeDamage(99999, e.getForward()); }
        """)
        print("已击落 1 架，开始观察 100s...")

        for i in range(20):
            await page.wait_for_timeout(5000)
            s = await page.evaluate("""
                () => { const wd = window.__shell.runtime.waveDirector;
                        return {
                            state: wd.state, killed: wd.killed, target: wd.target,
                            il2Killed: wd._il2Killed, retreating: wd._il2Retreating,
                            waveIdx: wd.currentWaveIdx,
                            active: wd._activeEnemies.map(e => ({
                                st: e._il2State, ex: !!e._exploded, de: !!e._despawnRequested,
                                dist: Math.round(e.root.position.length()/1000) + 'km',
                            })),
                            victoryPending: !!window.__shell.runtime._victoryPending,
                        }; }
            """)
            print(f"[{(i+1)*5}s]", s)
            if s["state"] == "done":
                print(">>> 波次序列已结束（done）")
                break
        await browser.close()


asyncio.run(main())
