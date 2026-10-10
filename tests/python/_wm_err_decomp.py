# -*- coding: utf-8 -*-
"""僚机开局误差分解诊断：沿航向(along)/横向(lat)/垂直(vert) 分量 + 死区分支状态，每秒采样"""
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

        rows = await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const sq = r.wingmen262;
            const V = sq.members[0].root.position.constructor;
            const slotW = new V(), err = new V(), fwd = new V(), right = new V();
            const out = [];
            const steps = Math.round(14 / 0.05);
            for (let i = 0; i < steps; i++) {
                r.clock.elapsedTime += 0.05;
                r._update(0.05);
                if (i % 20 !== 0) continue;   // 每秒一行
                const t = (i * 0.05).toFixed(1);
                fwd.copy(r.player.getForward());
                right.set(0, 1, 0).cross(fwd).negate();  // 机体右向 = fwd × up？此处取反得右
                const row = { t };
                sq.members.forEach((m, k) => {
                    slotW.copy(m._slot).applyQuaternion(r.player.root.quaternion).add(r.player.root.position);
                    err.copy(m.root.position).sub(slotW);   // 机 - 槽
                    row['w' + k] = {
                        along: +err.dot(fwd).toFixed(2),
                        lat: +err.dot(right).toFixed(2),
                        vert: +err.y.toFixed(2),
                        dz: !!(m._smoothWp && m._smoothWp.distanceTo(m.root.position) < 12),
                        wob: +m._lastWob.toFixed(2),
                    };
                });
                row.playerY = +r.player.root.position.y.toFixed(2);
                out.push(row);
            }
            return out;
        }""")
        print("t(s) | 僚机0 along/lat/vert/dz/wob | 僚机1 | 僚机2 | 玩家Y")
        for r in rows:
            fmt = lambda w: f"{w['along']:>6} {w['lat']:>6} {w['vert']:>6} {'DZ' if w['dz'] else 'CR'} {w['wob']:>5}"
            print(f"{r['t']:>4} | {fmt(r['w0'])} | {fmt(r['w1'])} | {fmt(r['w2'])} | {r['playerY']}")
        await b.close()

asyncio.run(main())
