"""柏林地面视觉裙边 · 截图对比工具（手动运行，非回归）
冻结模拟后直接摆相机（渲染循环仍转）：
  1. 东缘缘外上空朝东俯视（裙边开/关对照）
  2. 缘外 80km 高空回看全图幅（接缝连续性）
产出：tests/screenshots/skirt_edge_on.png / skirt_edge_off.png / skirt_overview.png
"""
import asyncio
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from playwright.async_api import async_playwright

URL = "http://127.0.0.1:5173/index.html"
OUT = ROOT / "screenshots"
OUT.mkdir(exist_ok=True)


async def wait_for(page, js_cond, timeout=10_000, interval=200):
    elapsed = 0
    while elapsed < timeout:
        r = await page.evaluate(js_cond)
        if r:
            return r
        await asyncio.sleep(interval / 1000)
        elapsed += interval
    return None


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu-stutter"])
        ctx = await browser.new_context(viewport={"width": 1600, "height": 900}, ignore_https_errors=True)
        page = await ctx.new_page()
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
        ready = await wait_for(page, """
            () => {
                const r = window.__shell && window.__shell.runtime;
                return r && r.player && r.player.model && r.player.model.visible ? 'ready' : null;
            }
        """, timeout=40_000, interval=500)
        assert ready == "ready", "玩家加载超时"
        ok = await wait_for(page, """
            () => {
                const s = window.__shell.scene.getObjectByName('berlinGroundSkirt');
                return s && s.material.map ? 'ok' : null;
            }
        """, timeout=20_000)
        assert ok == "ok", "裙边贴图未生成"
        await page.wait_for_timeout(500)

        # 挂钩 _updateCamera 钉住相机（冻结 _running 不可靠：渲染随冻结停止，且有路径会恢复运行）
        # 隐藏玩家模型避免挡镜头；云团 Sprite 隐藏防挡俯视
        await page.evaluate("""
            () => {
                const sh = window.__shell;
                sh.runtime.player.root.visible = false;
                sh.scene.traverse(o => { if (o.isSprite) o.visible = false; });
                sh.__pinCam = (px, py, pz, tx, ty, tz, topDown) => {
                    sh.runtime._updateCamera = function () {
                        const c = this.ctx.camera;
                        if (topDown) c.up.set(0, 0, -1);   // 俯视：画面上方=北，避免万向锁
                        c.position.set(px, py, pz);
                        c.lookAt(tx, ty, tz);
                    };
                };
            }
        """)

        # --- 机位 1：东缘缘外 2km、6000m 朝东下视（裙边开） ---
        await page.evaluate("window.__shell.__pinCam(42000, 6000, 0, 80000, 0, 0, false)")
        await page.wait_for_timeout(400)
        await page.screenshot(path=str(OUT / "skirt_edge_on.png"))

        # 同机位关裙边（"改前"对照）
        await page.evaluate(
            "window.__shell.scene.getObjectByName('berlinGroundSkirt').visible = false")
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT / "skirt_edge_off.png"))
        await page.evaluate(
            "window.__shell.scene.getObjectByName('berlinGroundSkirt').visible = true")

        # --- 机位 2：缘外 80km、8000m 回看全图幅（接缝连续性） ---
        await page.evaluate("window.__shell.__pinCam(80000, 8000, 0, 0, 0, 0, false)")
        await page.wait_for_timeout(400)
        await page.screenshot(path=str(OUT / "skirt_overview.png"))

        # --- 机位 3：正下俯视接缝（西半主图/东半裙边同帧对比锐度过渡） ---
        await page.evaluate("window.__shell.__pinCam(40000, 6000, 0, 40000, 0, 100, true)")
        await page.wait_for_timeout(400)
        await page.screenshot(path=str(OUT / "skirt_seam.png"))

        print("截图完成：skirt_edge_on / skirt_edge_off / skirt_overview / skirt_seam")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
