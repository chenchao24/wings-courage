"""
喷火模型最终验证：螺旋桨标记 + autoOrient + 8枪口预设 + 多视角截图
检查每个枪口是否落在机翼 mesh 包围盒内
"""
import json
import os
from playwright.sync_api import sync_playwright

OUT_DIR = os.path.join(os.path.dirname(__file__), 'test_shots')
URL = 'http://localhost:5173/tune_enemy.html?model=/model/spitfire_mk_iia.glb'


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 1600, 'height': 900})
        page = ctx.new_page()
        page.goto(URL, wait_until='domcontentloaded')
        page.wait_for_selector('#loader.hide', timeout=30000)
        page.wait_for_timeout(2500)

        # 1. 标记 Object_4 为螺旋桨
        page.evaluate('''() => {
          const d = window.__debug;
          const n = d.state.nodes.find(x => x.name === "Object_4");
          if (!n) return;
          d.state.selectedName = "Object_4";
          n.markedProp = true;
          if (!d.state.markedPropNames.includes("Object_4")) d.state.markedPropNames.push("Object_4");
        }''')
        page.wait_for_timeout(200)
        page.evaluate("document.getElementById('btn-auto-yaw').click()")
        page.wait_for_timeout(400)
        yaw = page.evaluate('() => +window.__debug.orient.yaw.toFixed(2)')
        print(f"[1] 螺旋桨标记 Object_4 → autoOrient yaw = {yaw}°")

        # 2. 应用喷火枪口预设
        page.evaluate("window.applyMuzzlePreset && window.applyMuzzlePreset('spitfire')")
        # 兜底：直接触发下拉 change
        if not page.evaluate('() => !!window.applyMuzzlePreset'):
            page.select_option('#muz-preset', 'spitfire')
        page.wait_for_timeout(400)

        # 3. 读取枪口 + 机翼节点，检查空间关系
        info = page.evaluate('''() => {
          const d = window.__debug;
          const muzzles = d.muzzles || [];
          // 机翼候选节点：X 跨度 > 8（大翼展节点）
          const wingNodes = d.state.nodes
            .filter(n => n.size.x > 8)
            .map(n => ({
              name: n.name,
              xMin: +(n.x - n.size.x/2).toFixed(2), xMax: +(n.x + n.size.x/2).toFixed(2),
              yMin: +(n.y - n.size.y/2).toFixed(2), yMax: +(n.y + n.size.y/2).toFixed(2),
              zMin: +(n.z - n.size.z/2).toFixed(2), zMax: +(n.z + n.size.z/2).toFixed(2),
              cx: +n.x.toFixed(2), cz: +n.z.toFixed(2),
              sx: +n.size.x.toFixed(2), sz: +n.size.z.toFixed(2),
            }));
          // 模型范围
          const xs = d.state.nodes.map(n => n.x - n.size.x/2);
          const xs2 = d.state.nodes.map(n => n.x + n.size.x/2);
          const zs = d.state.nodes.map(n => n.z - n.size.z/2);
          const zs2 = d.state.nodes.map(n => n.z + n.size.z/2);
          return {
            muzzles: muzzles.map(m => ({ name: m.name, x:+m.x.toFixed(2), y:+m.y.toFixed(2), z:+m.z.toFixed(2) })),
            wingNodes,
            modelRange: {
              x: [Math.min(...xs), Math.max(...xs2)],
              z: [Math.min(...zs), Math.max(...zs2)],
            },
            propNode: d.state.nodes.find(n => n.name === "Object_4"),
            yaw: +d.orient.yaw.toFixed(2),
            scale: +d.orient.scale.toFixed(2),
          };
        }''')

        print(f"\n[2] 模型范围 X={info['modelRange']['x']} Z={info['modelRange']['z']}")
        print(f"    螺旋桨 Object_4: Z={info['propNode']['z']} (最前端=机头) Y={info['propNode']['y']}")
        print(f"\n[3] 机翼候选节点（X跨度>8）:")
        for w in info['wingNodes']:
            print(f"    {w['name']}: X[{w['xMin']},{w['xMax']}] Z[{w['zMin']},{w['zMax']}] center=({w['cx']},{w['cz']}) size=({w['sx']},{w['sz']})")

        print(f"\n[4] 8枪口位置 + 是否落在机翼包围盒:")
        # 用最大翼展节点作为机翼参考
        wing = max(info['wingNodes'], key=lambda w: w['sx']) if info['wingNodes'] else None
        for muz in info['muzzles']:
            in_wing = ''
            if wing:
                xin = wing['xMin'] <= muz['x'] <= wing['xMax']
                zin = wing['zMin'] <= muz['z'] <= wing['zMax']
                yin = wing['yMin'] <= muz['y'] <= wing['yMax']
                ok = '✓' if (xin and zin) else '✗'
                in_wing = f" {ok} X{'∈' if xin else '∉'} Z{'∈' if zin else '∉'}"
            print(f"    {muz['name']:8s} ({muz['x']:6.2f},{muz['y']:5.2f},{muz['z']:6.2f}){in_wing}")

        # 4. 多视角截图
        print(f"\n[5] 截图各视角:")
        for cam, btn in [('chase', 'btn-cam-chase'), ('side', 'btn-cam-side'),
                         ('top', 'btn-cam-top'), ('front', 'btn-cam-front')]:
            page.evaluate(f"document.getElementById('{btn}').click()")
            page.wait_for_timeout(450)
            path = os.path.join(OUT_DIR, f'spit_final_{cam}.png')
            page.screenshot(path=path)
            print(f"    spit_final_{cam}.png")

        # 5. 导出最终配置
        output = page.evaluate("document.getElementById('out-pre').textContent")
        print(f"\n[6] 最终配置（out-pre）:")
        print(output)

        # 保存验证数据
        json_path = os.path.join(OUT_DIR, 'spit_muzzle_check.json')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(info, f, ensure_ascii=False, indent=2)
        print(f"\n验证数据: {json_path}")

        browser.close()
        print('\n完成')


if __name__ == '__main__':
    main()
