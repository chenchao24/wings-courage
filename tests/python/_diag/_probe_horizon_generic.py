"""通用关卡天际线截图探针：进关→跳过剧情→平飞姿态看天际线截图。
用法: python _probe_horizon_generic.py <levelId> [port]
产出: tests/test_shots/horizon_<levelId>_*.png
"""
import asyncio
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
from playwright.async_api import async_playwright

LEVEL = sys.argv[1]
PORT = sys.argv[2] if len(sys.argv) > 2 else "5173"
URL = f"http://127.0.0.1:{PORT}/index.html"
OUT = ROOT / "test_shots"
OUT.mkdir(exist_ok=True)


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
        await wait_for(page, "() => !!window.__shell", timeout=30_000)
        await page.mouse.click(800, 450)
        await page.wait_for_timeout(300)
        await page.evaluate("window.__shell.router.go('level-select')")
        await wait_for(page, "() => !!document.querySelector('.level-card')")
        await page.evaluate(f"document.querySelector('.level-card[data-id=\"{LEVEL}\"]').click()")
        await wait_for(page, "() => !!document.querySelector('.briefing-box')")
        await page.evaluate("document.querySelector('.briefing-box [data-action=\"start\"]').click()")

        ok = await wait_for(page, """
            () => { const r = window.__shell && window.__shell.runtime;
                    return !!(r && r.player && r.player.model && r.player.model.visible); }
        """)
        print("玩家就绪:", ok)

        # 教学覆盖层关掉（若有）
        await page.wait_for_timeout(1200)
        await page.evaluate("""
            () => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('跳过教学'));
                    if (b) b.click(); }
        """)

        # 剧情关：等激活后 C 键切到第三人称视角（座舱框会挡天际线）；按 _camMode 变化确认，最多重按 5 次
        hasCine = await page.evaluate("() => !!(window.__shell.runtime.cinematic)")
        if hasCine:
            await wait_for(page, """
                () => { const r = window.__shell.runtime; return r.cinematic && r.cinematic.active ? 1 : 0; }
            """, timeout=45_000)
            for _ in range(5):
                cam = await page.evaluate("() => window.__shell.runtime._camMode")
                if cam and cam != "cockpit":
                    break
                await page.keyboard.press("KeyC")
                await page.wait_for_timeout(700)

        # 保持当前航向，水平看前方天际线
        await page.evaluate("""
            () => { const pl = window.__shell.runtime.player;
                    const q = pl.root.quaternion;  // 去俯仰：取 yaw 重建水平姿态
                    const fwd = pl.getForward();
                    const yaw = Math.atan2(fwd.x, fwd.z);
                    pl.root.quaternion.identity();
                    pl.root.rotateY(yaw);
                    pl.angVel.set(0,0,0); }
        """)
        await page.wait_for_timeout(1200)
        await page.screenshot(path=str(OUT / f"horizon_{LEVEL}_01.png"))

        # 稍低头看地面远处与天际线衔接
        await page.evaluate("""
            () => { const pl = window.__shell.runtime.player;
                    pl.root.rotateX(-0.12); pl.angVel.set(0,0,0); }
        """)
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(OUT / f"horizon_{LEVEL}_02.png"))
        print("截图完成", LEVEL)
        await browser.close()


asyncio.run(main())
