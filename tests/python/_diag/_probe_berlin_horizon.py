"""柏林关卡天际线/雾观感探针：进关后多视角截图。
用法: python _probe_berlin_horizon.py [port]
产出: tests/test_shots/berlin_horizon_*.png
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
        await page.evaluate("document.querySelector('.level-card[data-id=\"berlin\"]').click()")
        await wait_for(page, "() => !!document.querySelector('.briefing-box')")
        await page.evaluate("document.querySelector('.briefing-box [data-action=\"start\"]').click()")

        ok = await wait_for(page, """
            () => { const r = window.__shell && window.__shell.runtime;
                    return !!(r && r.player && r.player.model && r.player.model.visible); }
        """)
        print("玩家就绪:", ok)
        tex = await wait_for(page, """
            () => { const g = window.__shell.scene.getObjectByName('berlinGround');
                    return g && g.material.map && g.material.map.image && g.material.map.image.width; }
        """, timeout=20_000)
        print("贴图已加载:", bool(tex))

        # 跳过 15s 推镜开场
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(1500)

        # (名称, x, y, z, pitchDeg) —— 朝东（机群方向，+X）看地平线
        shots = [
            ("01_spawn_6300m", None, None, None, 0),
            ("02_horizon_3000m", 0, 3000, 0, -5),
            ("03_corridor_east", 30000, 4000, 0, -8),   # 东缘机群走廊（原白化重灾区）
            ("04_low_800m", 21250, 800, 0, -3),
        ]
        for name, x, y, z, pitch in shots:
            # 姿态：朝东（机头 +X），可带俯仰
            await page.evaluate(f"""
                () => {{ const pl = window.__shell.runtime.player;
                         if ({'true' if x is not None else 'false'}) pl.root.position.set({x}, {y}, {z});
                         pl.root.quaternion.identity();
                         pl.root.rotateY(-Math.PI/2);          // 机头 -Z → 转朝 +X（东）
                         pl.root.rotateX({pitch * 3.14159 / 180});
                         pl.angVel.set(0,0,0); }}
            """)
            await page.wait_for_timeout(1300)
            await page.screenshot(path=str(OUT / f"berlin_horizon_{name}.png"))
            print("截图", name)
        await browser.close()


asyncio.run(main())
