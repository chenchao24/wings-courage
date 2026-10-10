# -*- coding: utf-8 -*-
"""B-17 特效目检（手动工具，非回归）：
  1. 发动机受损拉烟（2 发受损，含 1 发大火）
  2. 30mm 命中反馈（连续触发命中特效 + 碎片/闪光）
  3. 坠毁模式③（多点浓烟 + 全机身火焰）
产出：tests/screenshots/b17_fx_engine.png / b17_fx_impact.png / b17_fx_crash.png
"""
import asyncio, sys
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
URL = "http://127.0.0.1:5173/index.html"

async def wait_for(page, js, timeout=90_000, interval=500):
    el = 0
    while el < timeout:
        r = await page.evaluate(js)
        if r:
            return r
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
            const bs = r.bomberStream || [];
            return (bs.length === 12 && bs.every(function(x){ return x.ready; })) ? 'ok' : null;
        }""", interval=800)

        # 相机钉住工具：每帧跟随指定轰炸机
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            window.__pinOn = (idx, dx, dy, dz, lookUp) => {
                r._updateCamera = function () {
                    const bm = this.bomberStream[idx];
                    if (!bm) return;
                    const p = bm.root.position;
                    const c = this.ctx.camera;
                    c.up.set(0, 1, 0);
                    c.position.set(p.x + dx, p.y + dy, p.z + dz);
                    c.lookAt(p.x, p.y + (lookUp || 0), p.z);
                };
            };
        }""")

        # ===== 1. 发动机拉烟：3 号机 0/2 号发动机受损 + 0 号燃大火 =====
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const bm = r.bomberStream[3];
            bm.engines[0].damaged = true;
            bm.engines[2].damaged = true;
            bm._engineFireIdx = 0;   // 直接指定大火（等效 HP<40% 效果）
            window.__pinOn(3, 40, -70, 240, 25);   // 低机位仰拍：机身衬蓝天背景
            // 手动泵 8s 游戏时间（headless 软渲染帧率低，dt 限幅下实时等待等效极短）
            for (let i = 0; i < 160; i++) bm.updateAll(0.05, r.player);
        }""")
        await page.wait_for_timeout(400)
        await page.screenshot(path="tests/screenshots/b17_fx_engine.png")

        # ===== 2. 命中反馈：4 号机齐放一轮命中特效（出生即全亮，不等寿命） =====
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            window.__pinOn(4, 40, 15, 180);
            const bm = r.bomberStream[4];
            for (let k = 0; k < 5; k++) {
                const p = bm.root.position.clone();
                p.x += (Math.random() - 0.5) * 14;
                p.y += 5 + (Math.random() - 0.5) * 6;
                p.z += (Math.random() - 0.5) * 10;
                bm._spawnImpactFx(p);
                r.player.weapons.spawnHitDebris(p, bm.getForward(), {
                    count: [5, 8], scale: [1.2, 2.4], life: [0.7, 1.2],
                    flash: 0.6, flashSize: [3.5, 5.0], flashLife: [0.16, 0.26],
                });
            }
        }""")
        await page.wait_for_timeout(120)
        await page.screenshot(path="tests/screenshots/b17_fx_impact.png")

        # ===== 3. 坠毁模式③：5 号机强制爆燃解体，泵 3s + 再 3s =====
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const bm = r.bomberStream[5];
            bm.hp = 20;
            bm._enterCrash(3);
            window.__pinOn(5, 120, 40, 420);
            for (let i = 0; i < 60; i++) bm.updateAll(0.05, r.player);
        }""")
        await page.wait_for_timeout(300)
        await page.screenshot(path="tests/screenshots/b17_fx_crash.png")
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const bm = r.bomberStream[5];
            for (let i = 0; i < 60; i++) bm.updateAll(0.05, r.player);
        }""")
        await page.wait_for_timeout(300)
        await page.screenshot(path="tests/screenshots/b17_fx_crash_late.png")

        print("saved: b17_fx_engine / b17_fx_impact / b17_fx_crash / b17_fx_crash_late")
        await b.close()

asyncio.run(main())
