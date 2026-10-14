"""库尔斯克卫星地面视觉探针：跳过剧情后多高度/多位置截图。
用法: python _probe_kursk_visual.py [port]
产出: tests/test_shots/kursk_sat_*.png
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
        await page.evaluate("document.querySelector('.level-card[data-id=\"kursk\"]').click()")
        await wait_for(page, "() => !!document.querySelector('.briefing-box')")
        await page.evaluate("document.querySelector('.briefing-box [data-action=\"start\"]').click()")

        ok = await wait_for(page, """
            () => { const r = window.__shell && window.__shell.runtime;
                    return !!(r && r.player && r.player.model && r.player.model.visible); }
        """)
        print("玩家就绪:", ok)
        tex = await wait_for(page, """
            () => { const g = window.__shell.scene.getObjectByName('kurskGround');
                    return g && g.material.map && g.material.map.image && g.material.map.image.width; }
        """, timeout=20_000)
        print("贴图已加载:", bool(tex))

        # 跳过剧情（等激活再按 ESC），结束后切追尾视角看地面
        await wait_for(page, """
            () => { const r = window.__shell.runtime; return r.cinematic && r.cinematic.active ? 1 : 0; }
        """, timeout=45_000)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(2500)
        # 剧情结束默认落座舱视角，按 C 切追尾
        await page.keyboard.press("KeyC")
        await page.wait_for_timeout(800)

        # (名称, x, y, z, 俯仰rad)
        shots = [
            ("01_fighter_3200m", 2000, 3200, -8000, -0.15),   # 战斗机交战层
            ("02_il2_500m",      2000, 500, -8000, -0.25),    # IL-2 交战层
            ("03_low_200m",      2000, 200, -8000, -0.15),    # 低空
            ("04_spawn_南缘",    2002, 2200, -16000, 0),      # 出生区回望
            ("05_edge_东缘",     18000, 2500, 0, -0.1),       # 图幅边缘
        ]
        for name, x, y, z, pitch in shots:
            await page.evaluate(f"""
                () => {{ const pl = window.__shell.runtime.player;
                         pl.root.position.set({x}, {y}, {z});
                         pl.root.quaternion.identity();
                         pl.root.rotateY(Math.PI);            // 朝 +Z（北，战场方向）
                         pl.root.rotateX({pitch});
                         pl.angVel.set(0,0,0); }}
            """)
            await page.wait_for_timeout(1300)
            await page.screenshot(path=str(OUT / f"kursk_sat_{name}.png"))
            print("截图", name)

        perf = await page.evaluate("""
            () => new Promise(res => {
                const rd = window.__shell.renderer;
                let frames = 0; const t0 = performance.now();
                const loop = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(loop);
                    else res({ fps: Math.round(frames / 3), drawCalls: rd.info.render.calls, tris: rd.info.render.triangles }); };
                requestAnimationFrame(loop);
            })
        """)
        print("性能:", perf)
        await browser.close()


asyncio.run(main())
