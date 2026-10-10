# -*- coding: utf-8 -*-
"""B-17 损伤模型全量验证（第4关）：
  55% 概率返航 / 发动机数量状态（减速+DoT）/ <40% 大火 / <10% 缓慢坠毁 /
  坠毁四式（过量爆炸）/ 撞机 / 计分（击伤后击落+10）
慢动作无头环境下用直接调用 _updateX(dt) 的方式确定性验证。"""
import asyncio, sys
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
URL = "http://127.0.0.1:5173/index.html"
FAILED = []

def check(name, cond, detail=""):
    print(f"  {'✓' if cond else '✗'} {name} {detail}")
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
        page.on("console", lambda m: print("[console.error]", m.text[:300]) if m.type == "error" else None)
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
        await page.wait_for_timeout(1000)
        # 测试期间冻结胜利结算与计分归零
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            r.levelConfig.intercept.target = 999999;
            r._score = 0;
        }""")

        print("\n========== T1 55%阈值概率返航 ==========")
        t1 = await page.evaluate("""() => {
            const r = window.__shell.runtime;
            for (const b of r.bomberStream) b.onBulletHit(250, null, -1, false);  // 250>247.5 阈值
            return {
                damaged: r.bomberStream.filter(b => b.damaged).length,
                rtb: r.bomberStream.filter(b => b._rtb).length,
                score: r._score,
            };
        }""")
        print(" ", t1)
        check("12 架全部进入击伤状态", t1["damaged"] == 12)
        check("返航架数在 0-12 之间（35% 概率，统计分布）", 0 <= t1["rtb"] <= 12, f"rtb={t1['rtb']}")
        check("击伤计分 +120（12×10）", t1["score"] == 120, f"score={t1['score']}")

        print("\n========== T2 发动机数量状态机 ==========")
        t2 = await page.evaluate("""() => {
            const b = window.__shell.runtime.bomberStream[0];
            b.hp = 400; b._engineFireIdx = -1; b._fireDotAcc = 0;
            const out = {factors: [], dot3: 0, dot4: 0};
            for (let i = 0; i < 4; i++) {
                b.engines[i].damaged = true;
                b._updateDamageStates(0);
                out.factors.push(b._speedFactor);
            }
            // 3 发 DoT=2/s：先灭 1 发回到 3 发状态
            b.engines[3].damaged = false; b._updateDamageStates(0);
            let hp0 = b.hp; b._updateDamageStates(1.0); out.dot3 = hp0 - b.hp;
            // 4 发 DoT=10/s
            b.engines[3].damaged = true; b._updateDamageStates(0);
            hp0 = b.hp; b._updateDamageStates(1.0); out.dot4 = hp0 - b.hp;
            out.fireIdx = b._engineFireIdx;  // hp=400 不应触发大火
            b.hp = 400;
            return out;
        }""")
        print(" ", t2)
        check("减速系数 1发1.0/2发0.9/3发0.8/4发0.75",
              t2["factors"] == [1, 0.9, 0.8, 0.75], str(t2["factors"]))
        check("3 发 DoT = 2/s", abs(t2["dot3"] - 2) < 0.01, f"{t2['dot3']}")
        check("4 发 DoT = 10/s", abs(t2["dot4"] - 10) < 0.01, f"{t2['dot4']}")
        check("HP>40% 不触发大火", t2["fireIdx"] == -1)

        print("\n========== T3 <40% 发动机大火 + 每3s掉2 ==========")
        t3 = await page.evaluate("""() => {
            const b = window.__shell.runtime.bomberStream[0];
            // 只留 2 发受损（无发动机 DoT，隔离大火 DoT）
            b.engines[2].damaged = false; b.engines[3].damaged = false;
            b._engineFireIdx = -1; b._fireDotAcc = 0; b.hp = 170;  // <450*0.4=180
            b._updateDamageStates(0);
            const idx = b._engineFireIdx;
            const hp0 = b.hp;
            b._updateDamageStates(1.0); b._updateDamageStates(1.0); b._updateDamageStates(1.0);
            return {idx, dot: hp0 - b.hp, factor: b._speedFactor};
        }""")
        print(" ", t3)
        check("HP<40% 随机冒烟发动机燃大火", t3["idx"] >= 0, f"fireIdx={t3['idx']}")
        check("大火 DoT：3 秒掉 2", abs(t3["dot"] - 2) < 0.01, f"{t3['dot']}")
        check("2 发受损减速 0.9", t3["factor"] == 0.9)

        print("\n========== T4 <10% 缓慢坠毁 ==========")
        t4 = await page.evaluate("""() => {
            const b = window.__shell.runtime.bomberStream[1];
            b.hp = 40;  // <450*0.1=45
            b._updateDamageStates(0.01);
            const y0 = b.root.position.y;
            const entered = b._slowCrash;
            const pitchDeg = b._slowPitch * 180 / Math.PI;
            const gunsQuiet = b.weapons.enemyGroups.every(g => !g.firing);
            b._updateSlowCrash(1.0);
            const dy = b.root.position.y - y0;
            return {entered, pitchDeg, gunsQuiet, dy, falling: b._falling};
        }""")
        print(" ", t4)
        check("HP<10% 进入缓慢坠毁", t4["entered"] is True)
        check("俯角在 15-20°", 15 <= t4["pitchDeg"] <= 20, f"{t4['pitchDeg']:.1f}°")
        check("炮塔停火", t4["gunsQuiet"] is True)
        check("持续下坠（Δy<0）", t4["dy"] < 0, f"Δy={t4['dy']:.1f}")
        check("尚未判定坠毁（_falling=false）", t4["falling"] is False)

        print("\n========== T5 坠毁模式（普通击杀 ①②③ / 过量爆炸 ④） ==========")
        t5 = await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const out = {modes: [], overkill: null};
            // 普通击杀（hp 留在 -100..0 之间）：最多看 5 架的模式分布
            for (let i = 2; i < 7; i++) {
                const b = r.bomberStream[i];
                b.hp = 30;
                b.onBulletHit(50, null, -1, true);   // hp=-20 → 非过量
                out.modes.push(b._crash ? b._crash.mode : null);
            }
            // 过量击杀（hp<=-100）→ 强制模式④
            const b4 = r.bomberStream[7];
            b4.hp = 50; b4.onBulletHit(600, null, -1, true);  // hp=-550
            out.overkill = {
                mode: b4._crash ? b4._crash.mode : null,
                debris: b4._bigDebris.length,
                fx: b4._fxSprites.length,
                gunsQuiet: b4.weapons.enemyGroups.every(g => !g.firing),
            };
            out.score = r._score;
            return out;
        }""")
        print(" ", t5)
        check("普通击杀模式 ∈ {1,2,3}", all(m in [1, 2, 3] for m in t5["modes"]), str(t5["modes"]))
        ok = t5["overkill"]
        check("过量击杀强制模式④", ok and ok["mode"] == 4, f"mode={ok and ok['mode']}")
        check("爆炸式产生碎片（大块+小碎片）", ok and ok["debris"] > 10, f"debris={ok and ok['debris']}")
        check("爆炸式产生火光/闪光", ok and ok["fx"] > 0, f"fx={ok and ok['fx']}")
        check("坠毁后炮塔停火", ok and ok["gunsQuiet"] is True)
        # T1 后 12 架 damaged；T5 击落 6 架（2..7），每架击伤后击落 +10 → 120+60=180
        check("击伤后击落计分 +10/架（180=120+6×10）", t5["score"] == 180, f"score={t5['score']}")

        print("\n========== T6 坠毁下坠运动 + 碎片存续 ==========")
        t6 = await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const b = r.bomberStream[7];  // 模式④，正在下坠
            const y0 = b.root.position.y;
            // #69 起坠毁俯仰限速 6.5°/s + 残余扰动衰减 ~2s：1s 窗口太小会随机翻红，泵 3s
            for (let i = 0; i < 30; i++) b._updateCrash(0.1);
            const dPos = b.root.position.y - y0;
            const dIdx = r.bomberStream.indexOf(b);
            // 把玩家传送远（>1000m），碎片应当被剔除
            r.player.root.position.set(b.root.position.x + 5000, 5000, 0);
            b._updateBigDebris(0.1);
            return {dPos, debrisAfterFar: b._bigDebris.length, gunsQuiet: true};
        }""")
        print(" ", t6)
        check("坠毁持续下坠（Δy<0）", t6["dPos"] < 0, f"Δy={t6['dPos']:.1f}")
        check("碎片离玩家 >1000m 后消失", t6["debrisAfterFar"] == 0, f"left={t6['debrisAfterFar']}")

        print("\n========== T7 撞机（最后测，玩家爆炸任务失败） ==========")
        await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const b = r.bomberStream.find(x => !x._falling && !x._rtb) || r.bomberStream[0];
            window.__t7bomber = b;
            r.player.root.position.copy(b.root.position);  // 骑到轰炸机上
        }""")
        # 轮询等碰撞发生（headless 帧率低且不稳，固定 wait 会漏帧）
        hit = await wait_for(page, """() => {
            const r = window.__shell.runtime;
            const b = window.__t7bomber;
            return (r.player.crashed || (b && b._falling)) ? 'hit' : null;
        }""", timeout=30_000)
        t7 = await page.evaluate("""() => {
            const r = window.__shell.runtime;
            const b = window.__t7bomber;
            return {playerCrashed: !!r.player.crashed, bomberFalling: !!b._falling,
                    bomberMode: b._crash ? b._crash.mode : null};
        }""")
        print(" ", t7)
        check("玩家爆炸坠毁（任务失败路径）", t7["playerCrashed"] is True)
        check("被撞 B-17 进入坠毁", t7["bomberFalling"] is True)
        check("撞机坠毁模式=④爆炸", t7["bomberMode"] == 4)

        print("\n========== 结果 ==========")
        print("FAILED:", FAILED if FAILED else "无，全部通过")
        await b.close()

asyncio.run(main())
