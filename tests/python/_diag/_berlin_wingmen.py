# -*- coding: utf-8 -*-
"""柏林僚机小队 + 开场过场 · 快速验证（手动工具）
  1. 开场过场激活 + 输入锁定；ESC skip 后解锁 chase
  2. 3 架僚机在位、formation 状态
  3. 敌军接近 <1500m → 编队永久解除 → 三架转 hunt 且分配到模式
  4. evade：假敌机置于僚机后半球 150m → 该架转 evade
  5. 炮塔多目标：玩家远置、僚机置于轰炸机尾后 800m → 尾炮塔 burst
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
        check("玩家+3 僚机加载就绪", ready == "ok")

        # 1. 过场激活 + 输入锁定
        st = await page.evaluate("""() => ({
            cine: !!(window.__shell.runtime._cinematicActive && window.__shell.runtime.cinematic
                     && window.__shell.runtime.cinematic.active),
            cam: window.__shell.runtime.cinematic ? window.__shell.runtime.cinematic.camMode : null,
            formed: window.__shell.runtime.wingmen262.formed,
            states: window.__shell.runtime.wingmen262.members.map(m => m._wmState),
        })""")
        print(" ", st)
        check("开场过场激活（锁输入）", st["cine"] is True)
        check("过场相机=cinematicFixed（推镜路径）", st["cam"] == "cinematicFixed")
        check("僚机初始 formation", all(s == "formation" for s in st["states"]), str(st["states"]))
        await page.screenshot(path="tests/screenshots/wm_opening.png")

        # 2. ESC 跳过 → 解锁 chase（headless 帧率低，读条完成时间不定，轮询等待）
        await page.evaluate("window.__shell.runtime.cinematic.skip()")
        done = await wait_for(page, "() => window.__shell.runtime._cinematicActive === false", timeout=15_000)
        st = await page.evaluate("""() => ({
            cine: window.__shell.runtime._cinematicActive,
            cam: window.__shell.runtime._camMode,
        })""")
        print(" ", st)
        check("跳过后过场结束", done is not None and st["cine"] is False)
        check("视角恢复 chase", st["cam"] == "chase")

        # 3. 传送一架 B-17 到玩家东 400m（巡航会重写 y≈5000：3D 距离 √(400²+1300²)≈1360<1500）
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const p = r.player.root.position;
            const bm = r.bomberStream.find(x => x.ready && !x._falling);
            bm._dist = (38000 + bm.slot.x) - (p.x + 400);
            bm.root.position.set(p.x + 400, p.y, p.z);
        }""")
        await page.wait_for_timeout(2000)
        st = await page.evaluate("""() => {
            const sq = window.__shell.runtime.wingmen262;
            return { formed: sq.formed, states: sq.members.map(m => m._wmState),
                     patterns: sq.members.map(m => m._pattern) };
        }""")
        print(" ", st)
        check("编队解除（formed=false）", st["formed"] is False)
        check("三架转 hunt", all(s == "hunt" for s in st["states"]), str(st["states"]))
        check("均分配到攻击模式", all(st["patterns"]), str(st["patterns"]))

        # 泵 40 帧确认猎杀状态机推进不报错 + 截图
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            for (let i = 0; i < 40; i++) r.wingmen262.update(0.05);
        }""")
        await page.wait_for_timeout(400)
        await page.screenshot(path="tests/screenshots/wm_hunt.png")

        # 4. evade：假敌机置于僚机[0]后半球 150m（纯方法级调用，不进 rt.enemies）
        st = await page.evaluate("""() => {
            const w = window.__shell.runtime.wingmen262.members[0];
            const f = w.getForward();
            const p = w.root.position;
            const fake = { ready: true, crashed: false, _exploded: false,
                           root: { position: { x: p.x - f.x * 150, y: p.y - f.y * 150, z: p.z - f.z * 150 } } };
            const before = w._wmState;
            const triggered = w._checkEvade({ enemies: [fake] });
            return { before, triggered, after: w._wmState };
        }""")
        print(" ", st)
        check("后半球 <200m 触发 evade", st["triggered"] is True and st["after"] == "evade", str(st))

        # 5. 炮塔多目标：玩家远置，僚机[1]置于一架轰炸机正后 700m（尾炮塔射界）
        st = await page.evaluate("""() => {
            const r = window.__shell.runtime;
            r.player.root.position.set(0, 6000, -30000);   // 玩家远置（所有炮塔射程外）
            const bm = r.bomberStream.find(x => x.ready && !x._falling);
            const w = r.wingmen262.members[1];
            // 僚机摆到轰炸机正后 700m 同高度（tail 炮塔 yawCenter=0 覆盖）
            const bf = bm.getForward();
            w.root.position.copy(bm.root.position).addScaledVector(bf, -700);
            // 泵炮塔：僚机在射程射界内 → 应有炮塔进入 burst
            let anyBurst = false;
            for (let i = 0; i < 60; i++) {
                bm.updateAll(0.05, r.player, r.wingmen262.members);
                if (bm.turrets.some(t => t.state === 'burst')) { anyBurst = true; break; }
            }
            return { anyBurst };
        }""")
        print(" ", st)
        check("炮塔锁定僚机（burst）", st["anyBurst"] is True)

        print("\n========== 结果 ==========")
        print("FAILED:", FAILED if FAILED else "无，全部通过")
        await b.close()

asyncio.run(main())
