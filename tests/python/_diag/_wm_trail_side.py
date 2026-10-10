# -*- coding: utf-8 -*-
"""僚机喷气流侧视特写（修正版：游戏内 262 翼展约 40m，相机放 150m 外正侧方）
  wm_trail_side.png：正侧方看僚机0 + 其后方喷流带
"""
import asyncio, sys
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
URL = "http://127.0.0.1:5173/index.html"

async def wait_for(page, js, timeout=90_000, interval=500):
    el = 0
    while el < timeout:
        r = await page.evaluate(js)
        if r: return r
        await asyncio.sleep(interval / 1000)
        el += interval
    return None

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await b.new_page(viewport={"width": 1600, "height": 900})
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
        await wait_for(page, """() => {
            const r = window.__shell && window.__shell.runtime;
            if (!r || !r.player || !r.player.model || !r.player.model.visible) return null;
            const sq = r.wingmen262;
            return (sq && sq.members.length === 3 && sq.members.every(x => x.ready)) ? 'ok' : null;
        }""", interval=800)

        # 过场泵到 t≈10s（喷流已成型），钉相机：僚机0 正侧方 150m，看向僚机身后 80m 处（含喷流带）
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            for (let i = 0; i < Math.round(10 / 0.05); i++) { r.clock.elapsedTime += 0.05; r._update(0.05); }
            const w = r.wingmen262.members[0];
            const cam = r.ctx.camera;
            const orig = r._updateCamera.bind(r);
            r._updateCamera = (dt) => {
                orig(dt);
                const f = w.getForward();
                const V = w.root.position.constructor;
                const side = new V(0, 1, 0).cross(f).normalize();   // 左舷侧向
                // 相机在僚机侧后方：侧向 150m、后向 60m、略高 10m；看向机身后 70m 的喷流带中段
                cam.position.copy(w.root.position).addScaledVector(side, 150).addScaledVector(f, -60).add(new V(0, 10, 0));
                cam.lookAt(w.root.position.clone().addScaledVector(f, -70));
            };
        }""")
        await page.wait_for_timeout(1200)
        await page.screenshot(path="tests/screenshots/wm_trail_side.png")
        print("wm_trail_side.png saved")

        # 再泵 3s 后截第二张（确认喷流持续稳定）
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            for (let i = 0; i < Math.round(3 / 0.05); i++) { r.clock.elapsedTime += 0.05; r._update(0.05); }
        }""")
        await page.wait_for_timeout(800)
        await page.screenshot(path="tests/screenshots/wm_trail_side2.png")
        print("wm_trail_side2.png saved")
        await b.close()

asyncio.run(main())
