"""第四关《柏林保卫战》端到端测试
覆盖：选关 → 简报 → 加载（BerlinGround 卫星地面）→ 出生点/朝向
     → 交战高度规则全流程（警告 → 15s 倒计时 → 弹窗 → 重置高度）
     → 沙盒模式（无 waves 不弹胜利结算）
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

FAILED = []


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


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu-stutter"])
        ctx = await browser.new_context(viewport={"width": 1600, "height": 900}, ignore_https_errors=True)
        page = await ctx.new_page()
        page.on("console", lambda m: print(f"[console.{m.type}]", m.text[:200]) if m.type == "error" else None)
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:300]))

        print("\n========== 启动游戏 ==========")
        await page.goto(URL, wait_until="domcontentloaded")
        await wait_for(page, "() => !!window.__shell")
        await page.mouse.click(800, 450)
        await page.wait_for_timeout(300)

        # ===== 选关 → 简报 → 开始 =====
        print("\n========== 进入第4关 ==========")
        await page.evaluate("window.__shell.router.go('level-select')")
        await wait_for(page, "() => document.querySelector('.level-card')")
        card_state = await page.evaluate(
            "() => { const c = document.querySelector('.level-card[data-id=\"berlin\"]'); "
            "return c ? { unlocked: c.dataset.unlocked } : null; }")
        check("柏林卡片存在且解锁", card_state and card_state["unlocked"] == "true", str(card_state))
        await page.screenshot(path=str(SCREENSHOTS_DIR / "berlin_01_level_select.png"))

        await page.evaluate("document.querySelector('.level-card[data-id=\"berlin\"]').click()")
        await wait_for(page, "() => document.querySelector('.briefing-box')")
        await page.evaluate("document.querySelector('.briefing-box [data-action=\"start\"]').click()")

        print("等待玩家飞机加载...")
        ready = await wait_for(page, """
            () => {
                const r = window.__shell && window.__shell.runtime;
                return r && r.player && r.player.model && r.player.model.visible ? 'ready' : null;
            }
        """, timeout=40_000, interval=500)
        check("玩家加载就绪", ready == "ready")
        # 等过场系统就绪（3 架僚机加载完成后 BerlinOpening 才创建；直接 skip 会打空）
        await wait_for(page, """() => {
            const r = window.__shell && window.__shell.runtime;
            return (r && r.cinematic && r.cinematic.active) ? 'ok' : null;
        }""", timeout=30_000)
        # 跳过开场过场（第4关 15s 推镜开场；直接结束避免干扰后续断言时机）
        await page.evaluate("window.__shell.runtime.cinematic.skip()")
        # 轮询等过场真正结束（headless 低帧率下读条时长不定；不结束 cinematic 分支会把高度拉回基准值）
        await wait_for(page, "() => !window.__shell.runtime._cinematicActive", timeout=20_000)
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(SCREENSHOTS_DIR / "berlin_02_loaded.png"))

        # ===== 场景验证 =====
        print("\n========== 场景信息 ==========")
        info = await page.evaluate("""
            () => {
                const shell = window.__shell;
                const runtime = shell && shell.runtime;
                const env = shell && shell.env;
                if (!runtime || !env) return { error: 'runtime/env not ready' };
                const ground = shell.scene.getObjectByName('berlinGround');
                const gp = ground ? ground.geometry.parameters : {};
                return {
                    theme: env.envConfig && env.envConfig.theme,
                    hasGround: !!ground,
                    groundSize: ground ? [gp.width, gp.height] : null,
                    hasTexture: !!(ground && ground.material.map && ground.material.map.image),
                    buildings: !!env.buildings,
                    flak: !!env.flak,
                    ocean: !!env.ocean,
                    playerPos: runtime.player.root.position.toArray().map(v => Math.round(v)),
                    playerFwd: runtime.player.getForward().toArray().map(v => Math.round(v*100)/100),
                    running: runtime._running,
                    hasAltRule: !!runtime._altRule,
                    enemyCount: runtime.enemies.length,
                };
            }
        """)
        print(info)
        check("theme=berlin", info.get("theme") == "berlin")
        check("BerlinGround 存在且 80000x64000",
              info.get("groundSize") == [80000, 64000], str(info.get("groundSize")))
        check("卫星贴图已加载", info.get("hasTexture") is True)
        check("无 Buildings（柏林分支）", info.get("buildings") is False)
        check("无 Ocean", info.get("ocean") is False)
        check("Flak 已创建", info.get("flak") is True)
        check("出生点 x≈21250 y≈6300（过场补偿 + 抬高 300）", abs(info["playerPos"][0] - 21250) < 800 and abs(info["playerPos"][1] - 6300) < 300,
              str(info.get("playerPos")))
        check("朝东迎头（fwd≈+X，机群自东向西飞来）", info["playerFwd"][0] > 0.9, str(info.get("playerFwd")))
        check("CombatAltRule 已创建", info.get("hasAltRule") is True)
        check("无敌机（沙盒）", info.get("enemyCount") == 0)

        # 沙盒：运行数秒不出现胜利结算
        await page.wait_for_timeout(3000)
        victory = await page.evaluate("() => !!document.getElementById('result-overlay')")
        check("沙盒不弹胜利结算", victory is False)

        # ===== 高度规则：警告 → 倒计时 → 弹窗 → 重置 =====
        print("\n========== 交战高度规则 ==========")
        # 冻结飞行物理干扰：直接置位置（飞机仍会前飞，但 15s 倒计时内反复压低）
        await page.evaluate("window.__shell.runtime.player.root.position.y = 2100")
        warn = await wait_for(page, """
            () => { const el = document.getElementById('hud-alt-fence');
                    return el && el.classList.contains('show') ? el.textContent : null; }
        """, timeout=4000)
        check("低于 2200m 出警告", warn is not None, warn or "")

        # 压到 1900m 触发倒计时（每 300ms 重新压低，对抗前飞掉高/爬升）
        await page.evaluate("""
            window.__altTimer = setInterval(() => {
                const r = window.__shell.runtime;
                if (r && r.player) r.player.root.position.y = 1900;
            }, 300)
        """)
        cd = await wait_for(page, """
            () => { const el = document.getElementById('hud-alt-fence');
                    return el && el.dataset.level === 'countdown' ? el.textContent : null; }
        """, timeout=5000)
        check("低于 2000m 进入倒计时提示", cd is not None, (cd or "")[:40])
        await page.screenshot(path=str(SCREENSHOTS_DIR / "berlin_03_countdown.png"))

        # 无头模式 rAF 被节流、游戏时间比墙钟慢数倍：直接把剩余倒计时拨到 2s 验证归零转换
        await page.evaluate("window.__shell.runtime._altRule._remain = 2")
        choice = await wait_for(page, "() => document.querySelector('#alt-choice-overlay') ? 'yes' : null",
                                timeout=30_000, interval=500)
        check("倒计时归零弹出二选一", choice == "yes")
        await page.evaluate("clearInterval(window.__altTimer)")  # 停止压低，避免重置后被拉回 1900
        await page.screenshot(path=str(SCREENSHOTS_DIR / "berlin_04_choice.png"))

        # 选"重置高度" → 读条 → 回到 4000m
        if choice:
            await page.evaluate("document.querySelector('#alt-choice-overlay [data-a=\"reset\"]').click()")
            mask = await wait_for(page, "() => document.querySelector('#alt-reset-mask') ? 'yes' : null", timeout=3000)
            check("重置读条遮罩出现", mask == "yes")
            await page.wait_for_timeout(2500)  # 读条 1200ms + 淡出 600ms + 余量
            after = await page.evaluate("""
                () => { const r = window.__shell.runtime;
                        return { y: Math.round(r.player.root.position.y), running: r._running }; }
            """)
            check("重置后高度≈4000", abs(after["y"] - 4000) < 400, str(after))
            check("重置后模拟恢复运行", after["running"] is True)
            await page.screenshot(path=str(SCREENSHOTS_DIR / "berlin_05_after_reset.png"))

        print("\n========== 结果 ==========")
        if FAILED:
            print(f"失败 {len(FAILED)} 项: {FAILED}")
            sys.exit(1)
        print("全部通过")
        await browser.close()


asyncio.run(main())
