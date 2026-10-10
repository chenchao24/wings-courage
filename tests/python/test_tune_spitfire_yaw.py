"""验证 tune_yak_models.html 修复后喷火朝向与游戏一致
- 加载喷火模型
- computeAutoOrient 应返回 yaw=0°（之前错误返回 180°）
- 模型机头应朝向 -Z（与 forward 箭头方向一致）
"""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from playwright.async_api import async_playwright

URL = "http://127.0.0.1:5173/tune_yak_models.html"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1600, "height": 900})
        page = await ctx.new_page()
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:300]))

        await page.goto(URL, wait_until="domcontentloaded")
        # 等待调试钩子就绪
        await page.wait_for_function("() => window.__debug && window.__debug.state", timeout=10_000)

        # 切换到喷火模型
        await page.evaluate("window.__debug.loadModel('/model/spitfire_mk_iia.glb')")
        # 等待模型加载完成
        await page.wait_for_function(
            "() => window.__debug.state.currentModel && window.__debug.state.currentUrl === '/model/spitfire_mk_iia.glb'",
            timeout=30_000,
        )
        await page.wait_for_timeout(800)  # 等节点收集完成

        info = await page.evaluate("""
            () => {
                const d = window.__debug;
                const s = d.state;
                const model = s.currentModel;
                const modelYaw = s.currentModelYaw;

                const cfg = d.MODEL_CONFIGS['/model/spitfire_mk_iia.glb'];
                const autoYaw = d.computeAutoOrient(model, cfg);

                // 手动用矩阵变换算 mesh 世界包围盒角点（不依赖 THREE.Box3）
                let noseZ = Infinity, tailZ = -Infinity;
                let noseX = 0, noseY = 0;
                modelYaw.traverse(o => {
                    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
                        o.updateWorldMatrix(true, false);
                        o.geometry.computeBoundingBox();
                        const bb = o.geometry.boundingBox;
                        if (!bb) return;
                        const corners = [
                            [bb.min.x, bb.min.y, bb.min.z],
                            [bb.max.x, bb.min.y, bb.min.z],
                            [bb.min.x, bb.max.y, bb.min.z],
                            [bb.max.x, bb.max.y, bb.min.z],
                            [bb.min.x, bb.min.y, bb.max.z],
                            [bb.max.x, bb.min.y, bb.max.z],
                            [bb.min.x, bb.max.y, bb.max.z],
                            [bb.max.x, bb.max.y, bb.max.z],
                        ];
                        const m = o.matrixWorld;
                        const e = m.elements;
                        corners.forEach(c => {
                            const x = c[0], y = c[1], z = c[2];
                            const wx = e[0]*x + e[4]*y + e[8]*z + e[12];
                            const wy = e[1]*x + e[5]*y + e[9]*z + e[13];
                            const wz = e[2]*x + e[6]*y + e[10]*z + e[14];
                            if (wz < noseZ) { noseZ = wz; noseX = wx; noseY = wy; }
                            if (wz > tailZ) { tailZ = wz; }
                        });
                    }
                });

                return {
                    autoYaw: autoYaw.toFixed(2),
                    appliedYaw: s.yawOffset.toFixed(2),
                    modelYawRotY: (modelYaw.rotation.y * 180 / Math.PI).toFixed(2),
                    noseWorldZ: noseZ.toFixed(2),
                    tailWorldZ: tailZ.toFixed(2),
                    noseWorldX: noseX.toFixed(2),
                    noseWorldY: noseY.toFixed(2),
                    propNodesCount: (cfg.propNodes || []).length,
                    nodeCount: s.nodes.length,
                };
            }
        """)
        print("\n========== 喷火朝向验证 ==========")
        for k, v in info.items():
            print(f"  {k}: {v}")

        # 断言
        ok = True
        yaw = float(info["autoYaw"])
        if abs(yaw) > 5:
            print(f"❌ autoYaw={yaw}° 不为 0（期望 0°，朝向 -Z）")
            ok = False
        else:
            print(f"✓ autoYaw={yaw}°（朝向正确，机头 -Z）")

        # 机头应在 -Z 方向（noseWorldZ < 0，且小于 tailWorldZ）
        nose_z = float(info["noseWorldZ"])
        tail_z = float(info["tailWorldZ"])
        if nose_z > 0:
            print(f"❌ 机头 z={nose_z} 在 +Z 方向（模型反了！应 < 0）")
            ok = False
        elif nose_z >= tail_z:
            print(f"❌ 机头 z={nose_z} >= 机尾 z={tail_z}（模型反了）")
            ok = False
        else:
            print(f"✓ 机头 z={nose_z} < 机尾 z={tail_z}（机头朝 -Z，方向正确）")

        # 截图
        await page.screenshot(path=str(Path(ROOT) / "test_shots" / "tune_spitfire_yaw0.png"))
        print(f"\n截图: test_shots/tune_spitfire_yaw0.png")

        await browser.close()
        if ok:
            print("\n✅ 修复验证通过：调试页朝向与游戏一致")
        else:
            print("\n❌ 修复未生效")
            sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
