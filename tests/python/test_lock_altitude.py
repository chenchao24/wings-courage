# -*- coding: utf-8 -*-
"""
验证两项新功能：
  1. 低空警告：AGL < 200m 时屏幕中央闪烁 "高度过低 注意拉起"
  2. 后方锁定警告：敌机从六点钟方向咬尾进入射击锥时，僚机提示 "我们被锁定了，小心规避"
"""
from playwright.sync_api import sync_playwright

errors = []
all_logs = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("console", lambda msg: all_logs.append(f"[{msg.type}] {msg.text}"))
    page.on("pageerror", lambda exc: errors.append(f"[PAGEERROR] {exc}"))

    page.goto("http://127.0.0.1:5173", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(1500)

    # 进入游戏：开始 → 战役模式 → 第一关 → 开始任务
    page.locator("text=开始").first.click()
    page.wait_for_timeout(800)
    page.locator("text=战役模式").first.click()
    page.wait_for_timeout(800)
    page.locator(".level-card.unlocked").first.click()
    page.wait_for_timeout(800)
    page.locator("text=开始任务").first.click()

    # 等待玩家加载完成
    for i in range(10):
        page.wait_for_timeout(2000)
        has_ac = page.evaluate("() => typeof window.__aircraft !== 'undefined'")
        if has_ac:
            print(f"=== 模型加载完成，耗时约 {(i+1)*2}s ===")
            break

    # 跳过教学（点击"跳过教学"按钮）
    page.wait_for_timeout(800)
    skipped = page.evaluate("""() => {
        const btn = document.querySelector('#tutorial-overlay [data-action="skip"]');
        if (btn) { btn.click(); return true; }
        return false;
    }""")
    print(f"跳过教学: {skipped}")
    page.wait_for_timeout(1500)

    # ============================================================
    # 测试1: 低空警告 (AGL < 200m → #hud-altitude 闪烁显示)
    # ============================================================
    print("\n========== 测试1: 低空警告 (AGL < 200m) ==========")

    # 强制玩家到离地 100m（低于 200m 阈值）
    page.evaluate("""() => {
        const a = window.__aircraft;
        const t = window.__debug.env.terrain;
        const gh = t ? t.getHeight(a.root.position.x, a.root.position.z) : 0;
        a.root.position.y = gh + 100;  // 离地 100m
        a.crashed = false;
    }""")
    page.wait_for_timeout(400)  # 等几帧让 HUD 刷新
    low_show = page.evaluate("() => document.querySelector('#hud-altitude')?.classList.contains('show')")
    low_text = page.evaluate("() => document.querySelector('#hud-altitude')?.textContent?.trim()")
    print(f"  低空(AGL=100m): #hud-altitude.show = {low_show}, 文本 = '{low_text}'")
    page.screenshot(path="c:/Users/CC/Desktop/gameSpace727/darkWil/test_shots/10_low_altitude.png")

    # 恢复到 700m（安全高度），警告应消失
    page.evaluate("""() => {
        const a = window.__aircraft;
        a.root.position.y = 700;
    }""")
    page.wait_for_timeout(400)
    safe_show = page.evaluate("() => document.querySelector('#hud-altitude')?.classList.contains('show')")
    print(f"  恢复(AGL≈700m): #hud-altitude.show = {safe_show}")

    test1_pass = (low_show is True) and (safe_show is False)
    print(f"  >>> 测试1 {'通过' if test1_pass else '失败'}")

    # ============================================================
    # 测试2: 后方锁定警告（僚机提示 "我们被锁定了，小心规避"）
    # ============================================================
    print("\n========== 测试2: 后方锁定警告 ==========")

    # 等待敌机刷出并加载完成（模型 GLB 加载需要时间）
    enemy_ready = False
    for i in range(40):
        page.wait_for_timeout(1000)
        info = page.evaluate("""() => {
            const ens = window.__debug.enemies;
            const ready = ens.filter(e => e.ready && !e.crashed);
            const wd = window.__debug.waveDirector;
            return { total: ens.length, ready: ready.length, state: wd ? wd._state : '?' };
        }""")
        if info["ready"] > 0:
            print(f"  敌机就绪: {info['ready']}/{info['total']} 架, state={info['state']} (等待约 {i+1}s)")
            enemy_ready = True
            break
        if i % 5 == 0:
            print(f"  等待中... total={info['total']}, ready={info['ready']}, state={info['state']} ({i+1}s)")

    if not enemy_ready:
        print("  警告: 未等到就绪敌机，尝试手动 skipStartDelay 再等")
        page.evaluate("() => { const wd = window.__debug.waveDirector; if (wd) wd.skipStartDelay(0); }")
        for i in range(15):
            page.wait_for_timeout(1000)
            info = page.evaluate("""() => {
                const ens = window.__debug.enemies;
                const ready = ens.filter(e => e.ready && !e.crashed);
                return { total: ens.length, ready: ready.length };
            }""")
            if info["ready"] > 0:
                print(f"  敌机就绪: {info['ready']}/{info['total']} 架 (额外等待 {i+1}s)")
                enemy_ready = True
                break

    # 把一架就绪敌机传送到玩家正后方 300m，并朝向玩家（进入射击锥）
    positioned = page.evaluate("""() => {
        const rt = window.__debug.runtime;
        const player = rt.player;
        const ens = rt.enemies;
        const en = ens.find(e => e.ready && !e.crashed && !e._exploded);
        if (!en) return 'no ready enemy';
        // 位置：玩家后方 300m
        const pFwd = player.getForward();
        en.root.position.copy(player.root.position).addScaledVector(pFwd, -300);
        // 朝向：非相机 Object3D.lookAt 使 +Z 指向目标；飞机前方是 -Z，
        // 故 lookAt 远离玩家的点，使 -Z 指向玩家
        const farPoint = en.root.position.clone().add(
            en.root.position.clone().sub(player.root.position)
        );
        en.root.lookAt(farPoint);
        // 验证朝向：敌机前向应与"敌机→玩家"向量高度对齐
        const checkFwd = en.getForward();
        const toPlayer = player.root.position.clone().sub(en.root.position).normalize();
        const dot = checkFwd.dot(toPlayer);
        // 重置冷却，确保本帧可触发
        rt._lockWarnCd = 0;
        return { dot: dot.toFixed(3), dist: en.root.position.distanceTo(player.root.position).toFixed(0) };
    }""")
    print(f"  敌机布置: {positioned}")

    # 等待几帧让 _updateLockWarning 触发
    page.wait_for_timeout(600)

    # 读取对话系统内容
    dialog_items = page.evaluate("""() => {
        const items = document.querySelectorAll('#dialog-system .dialog-item');
        return Array.from(items).map(it => it.textContent.replace(/\\s+/g, ' ').trim());
    }""")
    print(f"  对话内容: {dialog_items}")

    # 也检查冷却状态（确认检测逻辑执行过）
    cd_info = page.evaluate("() => ({ cd: window.__debug.runtime._lockWarnCd })")
    print(f"  锁定冷却(应>0表示已触发): {cd_info}")

    page.screenshot(path="c:/Users/CC/Desktop/gameSpace727/darkWil/test_shots/11_lock_warning.png")

    has_lock_warn = dialog_items and any("锁定" in t for t in dialog_items)
    test2_pass = bool(has_lock_warn)
    print(f"  >>> 测试2 {'通过' if test2_pass else '失败'}")

    browser.close()

print("\n========== 总结 ==========")
print(f"测试1(低空警告): {'通过' if test1_pass else '失败'}")
print(f"测试2(锁定警告): {'通过' if test2_pass else '失败'}")

print("\n========== 页面错误 ==========")
for e in errors:
    print(e)
if not errors:
    print("无页面错误")
