"""扫描 spitfire.glb 节点列表 + 预测螺旋桨节点（机头方向最前 mesh）
帮助用户在调试页面快速找到螺旋桨节点
"""
import asyncio, sys
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
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:200]))

        await page.goto(URL, wait_until="domcontentloaded")
        await page.wait_for_function("() => window.__debug", timeout=10_000)

        # 加载备选喷火
        await page.evaluate("window.__debug.loadModel('/model/spitfire.glb')")
        await page.wait_for_function(
            "() => window.__debug.state.currentModel && window.__debug.state.currentUrl === '/model/spitfire.glb'",
            timeout=30_000,
        )
        await page.wait_for_timeout(1000)

        # 收集所有节点信息 + 计算 mesh 几何中心世界坐标
        nodes = await page.evaluate("""
            () => {
                const d = window.__debug;
                const s = d.state;
                const model = s.currentModel;
                // 收集所有 mesh 的世界包围盒几何中心
                const result = [];
                model.traverse(o => {
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
                        let sumX=0, sumY=0, sumZ=0;
                        corners.forEach(c => {
                            sumX += e[0]*c[0] + e[4]*c[1] + e[8]*c[2] + e[12];
                            sumY += e[1]*c[0] + e[5]*c[1] + e[9]*c[2] + e[13];
                            sumZ += e[2]*c[0] + e[6]*c[1] + e[10]*c[2] + e[14];
                        });
                        const cx = sumX/8, cy = sumY/8, cz = sumZ/8;
                        // 尺寸
                        const sx = bb.max.x - bb.min.x;
                        const sy = bb.max.y - bb.min.y;
                        const sz = bb.max.z - bb.min.z;

                        // 关键词匹配（PROP_KEYWORDS 同步）
                        const PROP_KEYWORDS = ['prop', '螺旋桨', 'airscrew', 'propeller', 'vint', 'винт'];
                        const n = String(o.name || '').toLowerCase();
                        const isPropName = PROP_KEYWORDS.some(k => n.includes(k));

                        result.push({
                            name: o.name,
                            cx: +cx.toFixed(2), cy: +cy.toFixed(2), cz: +cz.toFixed(2),
                            size: [+sx.toFixed(2), +sy.toFixed(2), +sz.toFixed(2)],
                            isPropName,
                            visible: o.visible,
                        });
                    }
                });
                return result;
            }
        """)

        print(f"\n========== spitfire.glb 节点扫描 ==========")
        print(f"总 mesh 数: {len(nodes)}")

        # 找出 cz 最小（机头方向）的几个节点
        sorted_by_z = sorted(nodes, key=lambda n: n['cz'])
        print(f"\n--- 按 z 升序（机头方向）前 10 个节点 ---")
        for n in sorted_by_z[:10]:
            kw = " [PROP_KEYWORD 命中]" if n['isPropName'] else ""
            print(f"  {n['name']:30s} c=({n['cx']:6.2f},{n['cy']:6.2f},{n['cz']:6.2f}) size={n['size']}{kw}")

        # 关键词命中
        kw_hits = [n for n in nodes if n['isPropName']]
        print(f"\n--- PROP_KEYWORDS 命中的节点 ({len(kw_hits)} 个) ---")
        for n in kw_hits:
            print(f"  {n['name']:30s} c=({n['cx']:6.2f},{n['cy']:6.2f},{n['cz']:6.2f}) size={n['size']}")

        # 模型整体包围盒
        bbox = await page.evaluate("""
            () => {
                const m = window.__debug.state.currentModel;
                let minX=Infinity,minY=Infinity,minZ=Infinity;
                let maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
                m.traverse(o => {
                    if (o.isMesh && o.geometry) {
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
                        const e = o.matrixWorld.elements;
                        corners.forEach(c => {
                            const x = e[0]*c[0] + e[4]*c[1] + e[8]*c[2] + e[12];
                            const y = e[1]*c[0] + e[5]*c[1] + e[9]*c[2] + e[13];
                            const z = e[2]*c[0] + e[6]*c[1] + e[10]*c[2] + e[14];
                            minX=Math.min(minX,x); maxX=Math.max(maxX,x);
                            minY=Math.min(minY,y); maxY=Math.max(maxY,y);
                            minZ=Math.min(minZ,z); maxZ=Math.max(maxZ,z);
                        });
                    }
                });
                return {
                    min: [+minX.toFixed(2), +minY.toFixed(2), +minZ.toFixed(2)],
                    max: [+maxX.toFixed(2), +maxY.toFixed(2), +maxZ.toFixed(2)],
                    size: [+((maxX-minX)).toFixed(2), +((maxY-minY)).toFixed(2), +((maxZ-minZ)).toFixed(2)],
                };
            }
        """)
        print(f"\n--- 模型整体世界包围盒 ---")
        print(f"  min: {bbox['min']}")
        print(f"  max: {bbox['max']}")
        print(f"  size (x,y,z): {bbox['size']}")

        # 计算 autoOrient（无 propNodes 时退化为关键词）
        auto_info = await page.evaluate("""
            () => {
                const d = window.__debug;
                const s = d.state;
                const cfg = d.MODEL_CONFIGS['/model/spitfire.glb'];
                const autoYaw = d.computeAutoOrient(s.currentModel, cfg);
                return { autoYaw: +autoYaw.toFixed(2), appliedYaw: +s.yawOffset.toFixed(2) };
            }
        """)
        print(f"\n--- computeAutoOrient 结果 ---")
        print(f"  autoYaw: {auto_info['autoYaw']}°  appliedYaw: {auto_info['appliedYaw']}°")

        # 截图
        await page.screenshot(path=str(ROOT / "test_shots" / "tune_spitfire_alt_scan.png"))
        print(f"\n截图: test_shots/tune_spitfire_alt_scan.png")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
