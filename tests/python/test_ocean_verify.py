"""海洋场景优化验证：加载 Britain 关卡，检查着色器编译错误 + 截图海面。
用法：先起本地服务器（node _serve.cjs，端口 8000），再 python test_ocean_verify.py
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000"
errors = []
warns = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=angle"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("console", lambda m: (errors if m.type == "error" else warns).append(f"[{m.type}] {m.text}"))
    page.on("pageerror", lambda e: errors.append(f"[PAGEERROR] {e}"))

    page.goto(BASE, wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(1500)

    # 进入战役模式第一关（Britain，含海洋）
    page.locator("text=开始").first.click()
    page.wait_for_timeout(800)
    page.locator("text=战役模式").first.click()
    page.wait_for_timeout(800)
    page.locator(".level-card.unlocked").first.click()
    page.wait_for_timeout(800)
    page.locator("text=开始任务").first.click()

    # 等待玩家加载完成
    ok = False
    for i in range(15):
        page.wait_for_timeout(2000)
        if page.evaluate("() => typeof window.__aircraft !== 'undefined' && !!window.__aircraft.model"):
            ok = True
            print(f"=== 加载完成，约 {(i+1)*2}s ===")
            break
    if not ok:
        print("!! 玩家模型加载超时")

    # 检查 ocean 状态（平海面特化是否生效）
    info = page.evaluate("""() => {
        const env = window.__debug && window.__debug.env;
        const o = env && env.ocean;
        if (!o) return { ocean: null };
        const pos = o.mesh.geometry.attributes.position;
        return {
            ocean: true,
            wavesEnabled: o._wavesEnabled,
            vertices: pos.count,
            defines: o.material.defines,
        };
    }""")
    print(f"Ocean 状态: {info}")

    # 跳过剧情直接看海面：把相机拉到低空海上视角截图
    page.evaluate("""() => {
        const d = window.__debug;
        if (d.runtime && d.runtime.cinematic) d.runtime.cinematic.skip();
    }""")
    page.wait_for_timeout(1000)

    # 视角 1：当前视角全景（海上）
    page.screenshot(path="test_shots/ocean_verify_1.png")
    # 视角 2：压低高度看近海面细节/斑驳
    page.evaluate("""() => {
        const a = window.__aircraft;
        a.root.position.set(0, 120, 8000);   // 海上低空
        a.root.quaternion.setFromAxisAngle(new (Object.getPrototypeOf(a.root.position).constructor)(0,1,0), 0);
    }""")
    page.wait_for_timeout(800)
    page.screenshot(path="test_shots/ocean_verify_2.png")

    print(f"\n=== 控制台错误 {len(errors)} 条 ===")
    for e in errors[:20]:
        print(e)
    shader_warns = [w for w in warns if "THREE" in w or "WebGL" in w or "shader" in w.lower()]
    print(f"=== 着色器/WebGL 警告 {len(shader_warns)} 条 ===")
    for w in shader_warns[:10]:
        print(w)
    browser.close()

print("\n截图已保存: test_shots/ocean_verify_1.png / ocean_verify_2.png")
sys.exit(1 if errors else 0)
