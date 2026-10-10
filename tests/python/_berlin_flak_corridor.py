# -*- coding: utf-8 -*-
"""柏林防空走廊（corridor 模式）快速验证：
  A. 编队前锋进入走廊东缘+700m 内 → 首个区间开火，其余不 firing
  B. 爆点高度在编队平均高度 ±400m（+余量）内
  C. 深入走廊一半 → 随机一架进坠毁且玩家积分不变
  D. 编队全部飞离 → 所有区间停火
"""
import asyncio, sys
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
URL = "http://127.0.0.1:5173/index.html"
FAILED = []

def check(name, cond, detail=""):
    tag = "✓" if cond else "✗"
    print(f"  {tag} {name} {detail}")
    if not cond:
        FAILED.append(name)

async def wait_for(page, js, timeout=90_000, interval=500):
    el = 0
    while el < timeout:
        r = await page.evaluate(js)
        if r:
            return r
        await asyncio.sleep(interval / 1000)
        el += interval
    return None

SET_FORMATION = """(frontX) => {
    const r = window.__shell.runtime;
    for (const b of r.bomberStream) b._dist = (38000 + b.slot.x) - frontX;
}"""
PUMP_FLAK = """(n) => {
    const r = window.__shell.runtime;
    const flak = window.__shell.env.flak;
    for (let i = 0; i < n; i++)
        flak.update(0.05, r.player.root.position, r.ctx.camera, null, null, r.bomberStream);
}"""
SEG_STATE = """() => window.__shell.env.flak._corridorSegs.map(s => s.firing ? 1 : 0)"""

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
            return (bs.length === 12 && bs.every(x => x.ready)) ? 'ok' : null;
        }""", interval=800)
        has_corridor = await page.evaluate("() => !!(window.__shell.env.flak && window.__shell.env.flak.corridor)")
        check("corridor 模式已启用", has_corridor is True)
        n_segs = await page.evaluate("() => window.__shell.env.flak._corridorSegs.length")
        check("区间数 = 15（45km/3000m）", n_segs == 15, f"segs={n_segs}")

        # A. 前锋 14500（东缘 15000 内 500m）：seg0 开火，seg1 不开
        await page.evaluate(SET_FORMATION, 14500)
        await page.evaluate(PUMP_FLAK, 10)
        segs = await page.evaluate(SEG_STATE)
        check("首区间开火", segs[0] == 1, str(segs[:4]))
        check("次区间未开火（前锋未到 12700）", segs[1] == 0)

        # B. 玩家传送到编队旁（爆点剔除 cullR=4000 以玩家为基准；横向错开 2km 防误撞）
        await page.evaluate("window.__shell.runtime.player.root.position.set(14500, 4500, 2000)")
        await page.evaluate(PUMP_FLAK, 300)
        info = await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const flak = window.__shell.env.flak;
            const ys = flak._bursts.map(x => x.pos.y);
            const alt = r.bomberStream.reduce((s, x) => s + x.root.position.y, 0) / r.bomberStream.length;
            return { bursts: ys.length, minY: ys.length ? Math.min(...ys) : 0,
                     maxY: ys.length ? Math.max(...ys) : 0, meanAlt: alt };
        }""")
        print(" ", info)
        check("爆点已生成", info["bursts"] > 0, f"bursts={info['bursts']}")
        check("爆点高度在编队 ±400m(+150 余量)",
              abs(info["minY"] - info["meanAlt"]) <= 550 and abs(info["maxY"] - info["meanAlt"]) <= 550,
              f"y∈[{info['minY']:.0f},{info['maxY']:.0f}] alt={info['meanAlt']:.0f}")

        # C. 前锋 -8000（深入过半，半长点 -7500）：随机一架进坠毁，积分不变
        score0 = await page.evaluate("() => window.__shell.runtime._score")
        await page.evaluate(SET_FORMATION, -8000)
        await page.evaluate(PUMP_FLAK, 10)
        res = await page.evaluate("""() => {
            const r = window.__shell.runtime;
            return { falling: r.bomberStream.filter(x => x._falling).length, score: r._score,
                     killedFlag: window.__shell.env.flak._corridorKilled };
        }""")
        print(" ", res)
        check("表演击落触发（一架进坠毁）", res["killedFlag"] is True and res["falling"] == 1, f"falling={res['falling']}")
        check("玩家积分不变", res["score"] == score0, f"score={res['score']}")

        # D. 编队远飞离（前锋 -32000）：全部停火
        await page.evaluate(SET_FORMATION, -32000)
        await page.evaluate(PUMP_FLAK, 10)
        segs = await page.evaluate(SEG_STATE)
        check("编队飞离后全部停火", all(s == 0 for s in segs), str(segs))

        print("\n========== 结果 ==========")
        print("FAILED:", FAILED if FAILED else "无，全部通过")
        await b.close()

asyncio.run(main())
