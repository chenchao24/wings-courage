from playwright.sync_api import sync_playwright

errors = []
all_logs = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("console", lambda msg: all_logs.append(f"[{msg.type}] {msg.text}"))
    page.on("pageerror", lambda exc: errors.append(f"[PAGEERROR] {exc}"))

    page.goto(f"http://127.0.0.1:{os.environ.get('TEST_PORT', '5173')}", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(1500)

    # 进入游戏
    page.locator("text=开始").first.click()
    page.wait_for_timeout(800)
    page.locator("text=战役模式").first.click()
    page.wait_for_timeout(800)
    page.locator(".level-card.unlocked").first.click()
    page.wait_for_timeout(800)
    page.locator("text=开始任务").first.click()

    # 等待加载完成（最多20秒）
    for i in range(10):
        page.wait_for_timeout(2000)
        has_ac = page.evaluate("() => typeof window.__aircraft !== 'undefined'")
        if has_ac:
            print(f"=== 模型加载完成，耗时约 {(i+1)*2}s ===")
            break

    # 等一秒让游戏稳定
    page.wait_for_timeout(1000)

    # 检查玩家状态
    ac_info = page.evaluate("""() => {
        const a = window.__aircraft;
        return {
            modelLoaded: !!a.model,
            pos: a.root.position.toArray().map(v => v.toFixed(1)),
            hp: a.hp, maxHp: a.maxHp,
            speed: a.speed.toFixed(1),
            hasWeapons: !!a.weapons,
            crashed: a.crashed,
        };
    }""")
    print(f"玩家: {ac_info}")

    # 检查敌机
    debug_info = page.evaluate("""() => {
        const d = window.__debug;
        return d.enemies.map(e => ({
            ready: e.ready, hp: e.hp,
            pos: e.root.position.toArray().map(v=>v.toFixed(0)),
            combatState: e.combatState,
            isLeader: e.isLeader,
        }));
    }""")
    print(f"敌机({len(debug_info)}架): {debug_info}")

    # HUD 读数
    hud_vals = page.evaluate("""() => ({
        speed: document.querySelector('[data-ro="speed"]')?.textContent,
        alt: document.querySelector('[data-ro="alt"]')?.textContent,
        gforce: document.querySelector('.mt-gforce .v')?.textContent,
        throttlePct: document.querySelector('.th-pct')?.textContent,
        wave: document.querySelector('.tb-wave')?.textContent,
    })""")
    print(f"HUD: {hud_vals}")

    # 射击测试
    page.keyboard.down("Space")
    page.wait_for_timeout(2000)
    bullet_count = page.evaluate("() => window.__aircraft?.weapons?.bullets?.length || 0")
    page.keyboard.up("Space")
    print(f"射击2s后活动子弹数: {bullet_count}")
    page.screenshot(path="c:/Users/CC/Desktop/gameSpace727/darkWil/test_shots/07_firing.png")

    # 视角切换测试
    cam_modes = []
    for i in range(5):
        page.keyboard.press("KeyC")
        page.wait_for_timeout(400)
        mode = page.evaluate("() => window.__debug?.runtime?._camMode")
        cam_modes.append(mode)
    print(f"视角切换: {cam_modes}")
    # 切回座舱
    page.keyboard.press("KeyC")
    page.wait_for_timeout(400)

    # 测试 Esc 返回
    page.keyboard.press("Escape")
    page.wait_for_timeout(2000)
    app_visible = page.evaluate("() => getComputedStyle(document.getElementById('app')).display !== 'none'")
    hud_count = page.evaluate("() => document.querySelectorAll('#hud').length")
    has_ac_after = page.evaluate("() => typeof window.__aircraft !== 'undefined'")
    print(f"Esc后: app可见={app_visible}, #hud={hud_count}, __aircraft存在={has_ac_after}")
    page.screenshot(path="c:/Users/CC/Desktop/gameSpace727/darkWil/test_shots/08_after_esc.png")

    # 第二次进入测试资源释放
    page.locator(".level-card.unlocked").first.click()
    page.wait_for_timeout(800)
    page.locator("text=开始任务").first.click()
    for i in range(10):
        page.wait_for_timeout(2000)
        has_ac2 = page.evaluate("() => typeof window.__aircraft !== 'undefined'")
        if has_ac2:
            print(f"第二次加载完成，耗时约 {(i+1)*2}s")
            break
    ac2_info = page.evaluate("() => ({hp: window.__aircraft.hp, pos: window.__aircraft.root.position.toArray().map(v=>v.toFixed(0))})")
    print(f"第二次玩家: {ac2_info}")

    page.keyboard.press("Escape")
    page.wait_for_timeout(2000)
    browser.close()

print("\n========== 页面错误 ==========")
for e in errors:
    print(e)
if not errors:
    print("无页面错误")
