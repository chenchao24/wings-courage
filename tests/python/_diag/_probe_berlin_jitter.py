"""柏林天际线抖动检测：固定视角连拍多帧，逐帧 diff 找出闪烁区域。
用法: python _probe_berlin_jitter.py [port]
产出: tests/test_shots/jitter_*.png + 控制台报告各区域像素变化量
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
FRAMES = 6
INTERVAL_MS = 400


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
        page = await (await browser.new_context(viewport={"width": 1280, "height": 720})).new_page()
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:150]))

        await page.goto(URL, wait_until="domcontentloaded")
        await wait_for(page, "() => !!window.__shell", timeout=30_000)
        await page.mouse.click(640, 360)
        await page.wait_for_timeout(300)
        await page.evaluate("window.__shell.router.go('level-select')")
        await wait_for(page, "() => !!document.querySelector('.level-card')")
        await page.evaluate("document.querySelector('.level-card[data-id=\"berlin\"]').click()")
        await wait_for(page, "() => !!document.querySelector('.briefing-box')")
        await page.evaluate("document.querySelector('.briefing-box [data-action=\\\"start\\\"]').click()")
        ok = await wait_for(page, """
            () => { const r = window.__shell && window.__shell.runtime;
                    return !!(r && r.player && r.player.model && r.player.model.visible); }
        """)
        print("玩家就绪:", ok)
        await wait_for(page, """
            () => { const g = window.__shell.scene.getObjectByName('berlinGround');
                    return g && g.material.map && g.material.map.image && g.material.map.image.width; }
        """, timeout=20_000)
        await page.keyboard.press("Escape")   # 跳过推镜
        await page.wait_for_timeout(1000)

        # 冻结飞行：停表（暂停模拟），相机固定朝东看天际线
        await page.evaluate("""
            () => { const rt = window.__shell.runtime;
                    rt.player.root.quaternion.identity();
                    rt.player.root.rotateY(-Math.PI/2);   // 朝东 +X
                    rt._doPause(); }""")   # 暂停=模拟停帧但保留渲染循环
        await page.wait_for_timeout(500)

        frames = []
        for i in range(FRAMES):
            fp = OUT / f"jitter_{i}.png"
            await page.screenshot(path=str(fp))
            frames.append(fp)
            await page.wait_for_timeout(INTERVAL_MS)

        # 逐帧 diff（PIL），分区统计：上 1/3（天空）、中 1/3（天际线带）、下 1/3（地面）
        from PIL import Image, ImageChops
        import numpy as np
        print("\n逐帧差异（平均 |Δ| 每区，>0.5 即有可见闪烁）:")
        print("帧对        天空区   天际线区  地面区")
        for i in range(1, FRAMES):
            a = np.asarray(Image.open(frames[i-1]).convert("L"), dtype=np.int16)
            b = np.asarray(Image.open(frames[i]).convert("L"), dtype=np.int16)
            d = np.abs(a - b)
            h = d.shape[0]
            sky, hor, gnd = d[:h//3].mean(), d[h//3:2*h//3].mean(), d[2*h//3:].mean()
            print(f"{i-1}→{i}   {sky:6.2f}  {hor:6.2f}   {gnd:6.2f}")
        await browser.close()


asyncio.run(main())
