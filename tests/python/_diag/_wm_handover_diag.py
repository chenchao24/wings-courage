# -*- coding: utf-8 -*-
"""僚机编队交接后稳定性诊断：泵 14s 过场 + 过场自然结束 + 再泵 15s 直平飞
（无输入，玩家近似直飞），量化交接瞬间是否跳变、交接后槽位误差与姿态步进。"""
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

        res = await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const sq = r.wingmen262;
            const V = sq.members[0].root.position.constructor;
            const slotW = new V();
            const prevQ = sq.members.map(m => m.root.quaternion.clone());
            const snap = (tag) => {
                const s = { tag, err: [], attMax: 0, attSum: 0, attN: 0, states: sq.members.map(m => m._wmState) };
                return s;
            };
            const recStep = (s) => {
                sq.members.forEach((m, k) => {
                    slotW.copy(m._slot).applyQuaternion(r.player.root.quaternion).add(r.player.root.position);
                    if (s.err[k] === undefined) s.err[k] = [];
                    s.err[k].push(+slotW.distanceTo(m.root.position).toFixed(3));
                    const dot = Math.abs(m.root.quaternion.dot(prevQ[k]));
                    const ang = 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
                    if (ang > s.attMax) s.attMax = ang;
                    s.attSum += ang; s.attN++;
                    prevQ[k].copy(m.root.quaternion);
                });
            };
            const pump = (n, s) => { for (let i = 0; i < n; i++) { r.clock.elapsedTime += 0.05; r._update(0.05); recStep(s); } };

            const sCine = snap('cine');   pump(Math.round(14.5 / 0.05), sCine);   // 过场（轨载）
            // 交接前后各 0.5s 细粒度
            const sHand = snap('handover'); pump(Math.round(2.0 / 0.05), sHand);  // 跨过 t=15s 自然结束
            const cineAfter = r._cinematicActive;
            const sPost = snap('post');   pump(Math.round(13 / 0.05), sPost);     // 交接后直平飞
            const stat = (s) => ({
                tag: s.tag, states: s.states,
                errMax: Math.max(...s.err.flat()),
                errMean: +(s.err.flat().reduce((a, b) => a + b, 0) / s.err.flat().length).toFixed(3),
                errLast: s.err.map(e => e[e.length - 1]),
                attMax: +s.attMax.toFixed(4),
                attMean: +(s.attSum / Math.max(1, s.attN)).toFixed(4),
            });
            return { cine: stat(sCine), cineAfter, hand: stat(sHand), post: stat(sPost),
                     formed: sq.formed };
        }""")
        for key in ("cine", "hand", "post"):
            s = res[key]
            print(f"[{s['tag']}] states={s['states']} 槽位误差 最大={s['errMax']}m 均值={s['errMean']}m 末帧={s['errLast']} | "
                  f"姿态步进 最大={s['attMax']}° 均值={s['attMean']}°")
        print("过场在 handover 段内结束:", res["cineAfter"] is False, "| formed:", res["formed"])
        await b.close()

asyncio.run(main())
