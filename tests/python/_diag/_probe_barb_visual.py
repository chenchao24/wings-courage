"""巴巴罗萨卫星地面视觉探针 v2：跳过教学 + 放平姿态后多高度截图。
用法: python _probe_barb_visual.py [port]
产出: tests/test_shots/barb_sat_*.png
"""
import asyncio
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
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
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:200]))

        await page.goto(URL, wait_until="domcontentloaded")
        await wait_for(page, "() => !!window.__shell", timeout=10_000)
        await page.mouse.click(800, 450)
        await page.wait_for_timeout(300)
        await page.evaluate("window.__shell.router.go('level-select')")
        await wait_for(page, "() => !!document.querySelector('.level-card')")
        await page.evaluate("document.querySelector('.level-card[data-id=\"barbarossa\"]').click()")
        await wait_for(page, "() => !!document.querySelector('.briefing-box')")
        await page.evaluate("document.querySelector('.briefing-box [data-action=\"start\"]').click()")

        ok = await wait_for(page, """
            () => { const r = window.__shell && window.__shell.runtime;
                    return !!(r && r.player && r.player.model && r.player.model.visible); }
        """)
        print("玩家就绪:", ok)
        await page.wait_for_timeout(1000)

        # 跳过教学（按按钮文本匹配）
        await page.evaluate("""
            () => { const btns = Array.from(document.querySelectorAll('button'));
                    const b = btns.find(x => x.textContent.includes('跳过教学'));
                    if (b) b.click(); }
        """)
        await page.wait_for_timeout(500)

        tex = await wait_for(page, """
            () => { const g = window.__shell.scene.getObjectByName('barbarossaGround');
                    return g && g.material.map && g.material.map.image && g.material.map.image.width; }
        """, timeout=15_000)
        print("贴图已加载:", bool(tex))

        # (名称, x, y, z, 俯仰姿态: level=放平 / down=低头45°看地)
        shots = [
            ("01_spawn_1800m", 0, 1800, 0, "level"),
            ("02_mid_800m", 0, 800, -3000, "down"),
            ("03_low_400m", 0, 400, -6000, "down"),
            ("04_edge_东缘", 16000, 1500, -12000, "level"),
            ("05_high_4000m", 0, 4000, 0, "down"),
            ("06_horizon_远眺", 0, 1800, 0, "down"),
        ]
        for name, x, y, z, pose in shots:
            await page.evaluate(f"""
                () => {{ const pl = window.__shell.runtime.player;
                         pl.root.position.set({x}, {y}, {z});
                         pl.root.quaternion.identity();
                         {"pl.root.rotateX(-Math.PI/4);" if pose == "down" else ""}
                         pl.angVel.set(0,0,0); }}
            """)
            await page.wait_for_timeout(1300)
            await page.screenshot(path=str(OUT / f"barb_sat_{name}.png"))
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
