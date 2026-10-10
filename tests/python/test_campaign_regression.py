"""前三关隔离回归测试（第4关柏林改动后必跑）
逐关加载 britain / barbarossa / kursk：验证环境主题、地形、玩家就绪、无页面错误。
每关重载页面（最干净的切换方式）。
"""
import asyncio
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from playwright.async_api import async_playwright

URL = "http://127.0.0.1:5173/index.html"
SCREENSHOTS_DIR = ROOT / "test_shots"
SCREENSHOTS_DIR.mkdir(exist_ok=True)

LEVELS = ["britain", "barbarossa", "kursk"]
FAILED = []
PAGE_ERRORS = []


def check(name, cond, detail=""):
    tag = "✓" if cond else "✗"
    print(f"  {tag} {name} {detail}")
    if not cond:
        FAILED.append(name)


async def wait_for(page, js_cond, timeout=10_000, interval=200):
    elapsed = 0
    while elapsed < timeout:
        r = await page.evaluate(js_cond)
        if r:
            return r
        await asyncio.sleep(interval / 1000)
        elapsed += interval
    return None


async def test_level(p, level_id):
    print(f"\n========== {level_id} ==========")
    browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu-stutter"])
    ctx = await browser.new_context(viewport={"width": 1600, "height": 900}, ignore_https_errors=True)
    page = await ctx.new_page()
    page.on("pageerror", lambda e: PAGE_ERRORS.append(f"{level_id}: {str(e)[:200]}"))
    page.on("console", lambda m: PAGE_ERRORS.append(f"{level_id}: console.error {m.text[:150]}") if m.type == "error" else None)

    await page.goto(URL, wait_until="domcontentloaded")
    await wait_for(page, "() => !!window.__shell")
    await page.mouse.click(800, 450)
    await page.wait_for_timeout(300)
    await page.evaluate("window.__shell.router.go('level-select')")
    await wait_for(page, "() => document.querySelector('.level-card')")
    await page.evaluate(f"document.querySelector('.level-card[data-id=\"{level_id}\"]').click()")
    await wait_for(page, "() => document.querySelector('.briefing-box')")
    await page.evaluate("document.querySelector('.briefing-box [data-action=\"start\"]').click()")

    ready = await wait_for(page, """
        () => {
            const r = window.__shell && window.__shell.runtime;
            return r && r.player && r.player.model && r.player.model.visible ? 'ready' : null;
        }
    """, timeout=40_000, interval=500)
    check(f"{level_id} 玩家就绪", ready == "ready")
    await page.wait_for_timeout(2500)

    # 剧情关（britain/kursk）开场过场启动前 _running 短暂为 false，属既定行为：等它变 true
    running = await wait_for(page, "() => window.__shell.runtime && window.__shell.runtime._running === true",
                             timeout=20_000, interval=500)
    check(f"{level_id} 正常运行", running is True)

    info = await page.evaluate("""
        () => {
            const shell = window.__shell;
            const runtime = shell && shell.runtime;
            const env = shell && shell.env;
            if (!runtime || !env) return { error: 'not ready' };
            return {
                theme: env.envConfig && env.envConfig.theme,
                terrainIsBerlin: !!shell.scene.getObjectByName('berlinGround'),
                hasTerrainMesh: !!shell.scene.getObjectByName('terrain'),
                buildings: !!env.buildings,
                ocean: !!env.ocean,
                running: runtime._running,
                noAltRule: !runtime._altRule,
            };
        }
    """)
    print(" ", info)
    check(f"{level_id} 无 BerlinGround 泄漏", info.get("terrainIsBerlin") is False)
    check(f"{level_id} 无高度规则泄漏", info.get("noAltRule") is True)
    await page.screenshot(path=str(SCREENSHOTS_DIR / f"regress_{level_id}.png"))
    await browser.close()


async def main():
    async with async_playwright() as p:
        for lv in LEVELS:
            await test_level(p, lv)

        print("\n========== 结果 ==========")
        if PAGE_ERRORS:
            print(f"页面错误 {len(PAGE_ERRORS)} 条:")
            for e in PAGE_ERRORS[:10]:
                print("  ", e)
        if FAILED or PAGE_ERRORS:
            print(f"回归失败: {FAILED}")
            sys.exit(1)
        print("前三关隔离回归全部通过")


asyncio.run(main())
