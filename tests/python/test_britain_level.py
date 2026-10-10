"""第二关《风云不列颠》端到端测试 v2
通过 router.go() 直接导航，避免 hash 路由假设。
"""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from playwright.async_api import async_playwright

URL = "http://127.0.0.1:5173/index.html"
SCREENSHOTS_DIR = ROOT / "test_shots"
SCREENSHOTS_DIR.mkdir(exist_ok=True)


async def wait_for(page, js_cond, timeout=10_000, interval=200):
    """轮询等待 JS 条件成立"""
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
        page.on("console", lambda m: print(f"[console.{m.type}]", m.text[:200]) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:300]))

        print("\n========== 启动游戏 ==========")
        await page.goto(URL, wait_until="domcontentloaded")
        await wait_for(page, "() => !!window.__shell")
        await page.wait_for_timeout(500)

        # 触发音频初始化（首次用户交互）
        await page.mouse.click(800, 450)
        await page.wait_for_timeout(300)

        # ===== 进入选关页 =====
        print("\n========== 进入选关页 ==========")
        await page.evaluate("window.__shell.router.go('level-select')")
        await wait_for(page, "() => document.querySelector('.level-card')")

        cards = await page.evaluate("""
            () => Array.from(document.querySelectorAll('.level-card')).map(c => ({
                id: c.dataset.id,
                unlocked: c.dataset.unlocked,
                name: c.querySelector('.card-name') ? c.querySelector('.card-name').textContent : '',
                text: c.textContent.replace(/\\s+/g, ' ').trim().slice(0, 100),
            }))
        """)
        print(f"关卡卡片 ({len(cards)} 个):")
        for c in cards:
            print(f"  [{c['id']}] {c['name']} unlocked={c['unlocked']}")

        await page.screenshot(path=str(SCREENSHOTS_DIR / "britain_v2_01_level_select.png"))

        # ===== 点击 britain 卡片 =====
        print("\n========== 点击 britain 卡片 ==========")
        await page.evaluate("document.querySelector('.level-card[data-id=\"britain\"]').click()")
        await wait_for(page, "() => document.querySelector('.briefing-box')")
        await page.wait_for_timeout(500)
        briefing_text = await page.evaluate("() => document.querySelector('.briefing-box').textContent.replace(/\\s+/g, ' ').trim().slice(0, 200)")
        print(f"简报页文本: {briefing_text}")
        await page.screenshot(path=str(SCREENSHOTS_DIR / "britain_v2_02_briefing.png"))

        # ===== 点击开始任务 =====
        print("\n========== 点击开始任务 ==========")
        await page.evaluate("document.querySelector('.briefing-box [data-action=\"start\"]').click()")

        # 等待 runtime.player 加载完成
        print("等待玩家飞机加载...")
        runtime_ready = await wait_for(page, """
            () => {
                const r = window.__shell && window.__shell.runtime;
                return r && r.player && r.player.model && r.player.model.visible ? 'ready' : null;
            }
        """, timeout=30_000, interval=500)
        if not runtime_ready:
            print("⚠ 玩家 30s 内未就绪")
        else:
            print("✓ 玩家已就绪")

        await page.wait_for_timeout(2000)
        await page.screenshot(path=str(SCREENSHOTS_DIR / "britain_v2_03_loaded.png"))

        # ===== 场景信息验证 =====
        print("\n========== 场景信息 ==========")
        info = await page.evaluate("""
            () => {
                const shell = window.__shell;
                const runtime = shell && shell.runtime;
                const env = shell && shell.env;
                if (!runtime || !env) return { error: 'runtime/env not ready' };

                const scene = shell.scene;
                const player = runtime.player;

                // 检查场景中的关键对象
                const objCounts = {};
                scene.traverse(o => { if (o.name) objCounts[o.name] = (objCounts[o.name] || 0) + 1; });

                const enemies = (runtime.enemies || []).map(e => ({
                    pos: e.root.position.toArray().map(v => Math.round(v)),
                    modelVisible: e.model ? e.model.visible : false,
                    rootVisible: e.root ? e.root.visible : false,
                }));

                const ocean = scene.getObjectByName('ocean');
                const terrain = scene.getObjectByName('terrain');

                return {
                    envTheme: env.envConfig && env.envConfig.theme,
                    hasOcean: !!env.ocean,
                    oceanPos: ocean ? ocean.position.toArray() : null,
                    oceanVerts: ocean ? ocean.geometry.attributes.position.count : 0,
                    terrainPos: terrain ? terrain.position.toArray() : null,
                    terrainVerts: terrain ? terrain.geometry.attributes.position.count : 0,
                    playerPos: player ? player.root.position.toArray().map(v => Math.round(v*100)/100) : null,
                    playerFwd: player ? player.getForward().toArray().map(v => Math.round(v*1000)/1000) : null,
                    playerVisible: player && player.model ? player.model.visible : null,
                    enemyCount: enemies.length,
                    enemies: enemies,
                    objCounts: objCounts,
                    camMode: runtime._camMode,
                    paused: runtime._paused,
                    running: runtime._running,
                    cloudCount: env.clouds ? 0 : 0, // 跳过
                };
            }
        """)
        if "error" in info:
            print(f"❌ {info['error']}")
            await browser.close()
            sys.exit(1)

        for k, v in info.items():
            if k == "objCounts":
                top = sorted(v.items(), key=lambda kv: -kv[1])[:10]
                print(f"  scene 对象 (top 10): {top}")
            elif k == "enemies":
                print(f"  enemies ({len(v)}):")
                for i, e in enumerate(v):
                    print(f"    [{i}] pos={e['pos']} modelVis={e['modelVisible']} rootVis={e['rootVisible']}")
            else:
                print(f"  {k}: {v}")

        # ===== 断言 =====
        print("\n========== 断言 ==========")
        ok = True

        if info.get("envTheme") != "britain":
            print(f"❌ env 主题不是 britain: {info.get('envTheme')}")
            ok = False
        else: print("✓ env 主题 = britain")

        if not info.get("hasOcean"):
            print("❌ 海洋未创建"); ok = False
        else: print(f"✓ 海洋已创建 (顶点 {info.get('oceanVerts')})")

        if info.get("oceanPos") and abs(info["oceanPos"][1]) > 0.1:
            print(f"❌ 海洋 y={info['oceanPos'][1]} 不为 0"); ok = False
        elif info.get("oceanPos"): print(f"✓ 海洋 y=0 (跟随相机 xz)")

        pp = info.get("playerPos")
        if pp:
            # 允许 ±200 漂移（玩家已飞行几秒）
            if abs(pp[0]) > 200 or abs(pp[2] - (-3600)) > 200:
                print(f"❌ 玩家位置错误: {pp} (期望 z≈-3600，允许 ±200)"); ok = False
            else: print(f"✓ 玩家位置合理: ({pp[0]}, {pp[1]}, {pp[2]})")

        pf = info.get("playerFwd")
        if pf:
            if pf[2] > -0.95:
                print(f"❌ 玩家朝向不对: {pf} (期望 ~[0, 0, -1])"); ok = False
            else: print(f"✓ 玩家朝向 -Z: {pf}")

        # 等待敌机生成（首波 0s 后立即刷，但 model 异步加载需时间）
        print("\n等待敌机生成...")
        enemy_ready = await wait_for(page, """
            () => {
                const r = window.__shell && window.__shell.runtime;
                if (!r) return null;
                const es = r.enemies || [];
                return es.length > 0 && es[0].model && es[0].model.visible ? 'ready' : null;
            }
        """, timeout=20_000, interval=500)
        if not enemy_ready:
            print("⚠ 敌机未在 20s 内加载完成")
        else:
            print("✓ 敌机已就绪")

        # 重新读敌机信息
        enemies = await page.evaluate("""
            () => (window.__shell.runtime.enemies || []).map(e => ({
                pos: e.root.position.toArray().map(v => Math.round(v)),
                modelUrl: e.modelUrl || (e.model && e.model.userData && e.model.userData.url) || 'unknown',
            }))
        """)
        print(f"\n敌机最终 ({len(enemies)}):")
        for i, e in enumerate(enemies):
            print(f"  [{i}] pos={e['pos']}")
            # 期望敌机在玩家前方 (z<-3600)，且在陆地 (z<-5000)
            if e['pos'][2] > -3600:
                print(f"    ⚠ 敌机 z={e['pos'][2]} 在玩家后方 (应 <-3600)")
                ok = False
            else:
                # 是否在陆地
                land_z = -5000
                if e['pos'][2] > land_z:
                    print(f"    ⚠ 敌机 z={e['pos'][2]} 在海域 (陆地应 z<-5000)")
                else:
                    print(f"    ✓ 敌机 z={e['pos'][2]} 在陆地 (z<-5000)")

        # 截图战斗场景
        await page.screenshot(path=str(SCREENSHOTS_DIR / "britain_v2_04_combat.png"))

        # ===== 海水波动测试 =====
        print("\n========== 海水波动测试 ==========")
        wave = await page.evaluate("""
            async () => {
                const ocean = window.__shell.scene.getObjectByName('ocean');
                if (!ocean) return { error: 'no ocean' };
                const idx = 1000;
                const y1 = ocean.geometry.attributes.position.getY(idx);
                const runtime = window.__shell.runtime;
                runtime.ctx.env.ocean.update(0.1, window.__shell.camera);
                await new Promise(r => setTimeout(r, 50));
                runtime.ctx.env.ocean.update(0.1, window.__shell.camera);
                const y2 = ocean.geometry.attributes.position.getY(idx);
                return { y1: y1.toFixed(3), y2: y2.toFixed(3), delta: (y2-y1).toFixed(3) };
            }
        """)
        print(f"海水顶点[1000] y: {wave}")
        if "delta" in wave and abs(float(wave["delta"])) > 0.001:
            print("✓ 海水在更新")
        else:
            print("⚠ 海水未变化")

        # ===== 巴巴罗萨回归 =====
        print("\n========== 巴巴罗萨回归 ==========")
        await page.evaluate("window.__shell.runtime.stop()")
        await page.wait_for_timeout(800)
        await page.evaluate("window.__shell.router.go('level-select')")
        await wait_for(page, "() => document.querySelector('.level-card')")
        await page.evaluate("document.querySelector('.level-card[data-id=\"barbarossa\"]').click()")
        await wait_for(page, "() => document.querySelector('.briefing-box')")
        await page.evaluate("document.querySelector('.briefing-box [data-action=\"start\"]').click()")

        bar_ready = await wait_for(page, """
            () => {
                const r = window.__shell && window.__shell.runtime;
                return r && r.player && r.player.model && r.player.model.visible ? 'ready' : null;
            }
        """, timeout=20_000, interval=500)
        if bar_ready:
            print("✓ 巴巴罗萨玩家加载完成")
        else:
            print("⚠ 巴巴罗萨玩家未就绪")

        bar = await page.evaluate("""
            () => {
                const shell = window.__shell;
                const env = shell && shell.env;
                const runtime = shell && shell.runtime;
                if (!env || !runtime) return { error: 'not ready' };
                return {
                    envTheme: env.envConfig && env.envConfig.theme,
                    hasOcean: !!env.ocean,
                    playerPos: runtime.player ? runtime.player.root.position.toArray().map(v=>Math.round(v)) : null,
                };
            }
        """)
        print(f"巴巴罗萨场景: {bar}")
        if bar.get("envTheme") not in (None, "barbarossa"):
            print(f"❌ 巴巴罗萨主题错误: {bar.get('envTheme')}"); ok = False
        else: print(f"✓ 巴巴罗萨主题正确: {bar.get('envTheme')}")
        if bar.get("hasOcean"):
            print("❌ 巴巴罗萨不应有海洋"); ok = False
        else: print("✓ 巴巴罗萨无海洋")

        # 玩家初始位置应回到默认 (0, 700, 0)（无 playerStart 覆盖）
        if bar.get("playerPos"):
            bp = bar["playerPos"]
            if abs(bp[0]) > 200 or abs(bp[2]) > 200 or abs(bp[1] - 700) > 100:
                print(f"❌ 巴巴罗萨玩家位置错误: {bp} (期望 ≈[0, 700, 0]，允许 ±200)"); ok = False
            else: print(f"✓ 巴巴罗萨玩家位置合理: {bp}")

        await page.screenshot(path=str(SCREENSHOTS_DIR / "britain_v2_05_barbarossa.png"))
        await browser.close()

        print("\n========== 总结 ==========")
        if ok:
            print("✅ 测试通过")
        else:
            print("❌ 测试失败")
            sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
