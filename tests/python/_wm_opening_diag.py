# -*- coding: utf-8 -*-
"""柏林僚机开局编队量化诊断（一次性工具）
泵测开场 14s（dt=0.05），逐帧记录每架僚机：
  - 与指尖槽位的距离误差（m）
  - 每帧姿态角变化量（deg，四元数夹角）→ 微震量化
  - 速度（m/s）
输出统计表，作为修复前基线。
"""
import asyncio, sys, json
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
        ready = await wait_for(page, """() => {
            const r = window.__shell && window.__shell.runtime;
            if (!r || !r.player || !r.player.model || !r.player.model.visible) return null;
            const sq = r.wingmen262;
            return (sq && sq.members.length === 3 && sq.members.every(x => x.ready)) ? 'ok' : null;
        }""", interval=800)
        print("ready:", ready)

        # 泵测开场 14s：dt=0.05 × 280 步；手动推进 clock.elapsedTime（剧情波动基准）
        stats = await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const sq = r.wingmen262;
            const THREE_V = sq.members[0].root.position.constructor;
            const rec = sq.members.map(() => ({ err: [], att: [], spd: [], maxAttStep: 0 }));
            const prevQ = sq.members.map(m => m.root.quaternion.clone());
            const slotW = new THREE_V();
            const steps = Math.round(14 / 0.05);
            for (let i = 0; i < steps; i++) {
                r.clock.elapsedTime += 0.05;
                r._update(0.05);
                sq.members.forEach((m, k) => {
                    // 槽位世界坐标
                    slotW.copy(m._slot).applyQuaternion(r.player.root.quaternion).add(r.player.root.position);
                    const err = slotW.distanceTo(m.root.position);
                    rec[k].err.push(+err.toFixed(3));
                    // 姿态角变化（四元数夹角，deg）
                    const dot = Math.abs(m.root.quaternion.dot(prevQ[k]));
                    const ang = 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
                    rec[k].att.push(+ang.toFixed(4));
                    if (ang > rec[k].maxAttStep) rec[k].maxAttStep = ang;
                    prevQ[k].copy(m.root.quaternion);
                    rec[k].spd.push(+m._speed.toFixed(2));
                });
            }
            return rec.map(rk => ({
                err0: rk.err[0],
                errMax: Math.max(...rk.err),
                errMean: +(rk.err.reduce((a, b) => a + b, 0) / rk.err.length).toFixed(3),
                errLast: rk.err[rk.err.length - 1],
                attStepMax: +rk.maxAttStep.toFixed(4),
                attStepMean: +(rk.att.reduce((a, b) => a + b, 0) / rk.att.length).toFixed(4),
                spdMin: Math.min(...rk.spd), spdMax: Math.max(...rk.spd),
            }));
        }""")
        print("\n僚机开局 14s 泵测（改前基线）：")
        for i, s in enumerate(stats):
            print(f"  僚机{i}: 槽位误差 首帧={s['err0']}m 最大={s['errMax']}m 均值={s['errMean']}m 末帧={s['errLast']}m | "
                  f"姿态步进 最大={s['attStepMax']}° 均值={s['attStepMean']}° | 速度 {s['spdMin']}~{s['spdMax']}m/s")
        # 玩家剧情波动参考
        pl = await page.evaluate("() => ({ spd: window.__shell.runtime.player.speed, y: window.__shell.runtime.player.root.position.y })")
        print("  玩家:", pl)
        await b.close()

asyncio.run(main())
