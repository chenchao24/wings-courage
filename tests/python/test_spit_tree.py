"""
喷火模型场景树深度分析（不依赖 THREE 全局）
用 state.nodes 预计算数据 + Object3D 原生属性
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

        # 1. 场景树（只用 Object3D 原生属性，不用 THREE.Box3）
        tree_info = page.evaluate('''() => {
          const m = window.__debug.model;
          if (!m) return { error: 'no model' };
          const tree = [];
          function walk(o, depth) {
            tree.push({
              name: o.name || '(unnamed)',
              type: o.type,
              depth,
              childCount: o.children.length,
              childNames: o.children.map(c => c.name || '(unnamed)'),
              localPos: [+o.position.x.toFixed(3), +o.position.y.toFixed(3), +o.position.z.toFixed(3)],
              isMesh: o.isMesh,
              visible: o.visible,
            });
            o.children.forEach(c => walk(c, depth+1));
          }
          walk(m, 0);
          // 用 state.nodes 的 size/center（已预计算）
          const nodes = window.__debug.state.nodes.map(n => ({
            name: n.name, y: +n.y.toFixed(2), x: +n.x.toFixed(2), z: +n.z.toFixed(2),
            size: [+n.size.x.toFixed(2), +n.size.y.toFixed(2), +n.size.z.toFixed(2)],
            isPropName: n.isPropName,
          }));
          // 模型总范围（从 nodes 推算）
          const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y), zs = nodes.map(n => n.z);
          return {
            tree,
            nodes,
            modelRange: {
              x: [Math.min(...xs), Math.max(...xs)],
              y: [Math.min(...ys), Math.max(...ys)],
              z: [Math.min(...zs), Math.max(...zs)],
            },
            orient: {
              yaw: +window.__debug.orient.yaw.toFixed(2),
              scale: +window.__debug.orient.scale.toFixed(2),
            },
          };
        }''')

        if 'error' in tree_info:
            print('ERROR:', tree_info['error'])
            return

        print(f"=== 模型坐标范围（缩放后世界坐标）===")
        r = tree_info['modelRange']
        print(f"X(左右/翼展): {r['x']}  跨度 {r['x'][1]-r['x'][0]:.2f}")
        print(f"Y(上下/高度): {r['y']}  跨度 {r['y'][1]-r['y'][0]:.2f}")
        print(f"Z(前后/机身): {r['z']}  跨度 {r['z'][1]-r['z'][0]:.2f}")
        sx = r['x'][1]-r['x'][0]; sy = r['y'][1]-r['y'][0]; sz = r['z'][1]-r['z'][0]
        longest = max(sx, sy, sz)
        axis = 'X(翼展)' if sx==longest else 'Y(高度)' if sy==longest else 'Z(机身)'
        print(f"最长维 = {longest:.2f} → {axis}")
        print(f"当前 yaw={tree_info['orient']['yaw']}° scale={tree_info['orient']['scale']}")
        print(f"朝向判断：Z 最负端=机头方向。Z范围 [{r['z'][0]:.2f}, {r['z'][1]:.2f}]")
        print(f"  若机头朝 -Z：螺旋桨应在 Z 最负处；机翼 X 方向展开")

        print(f"\n=== 场景树 ({len(tree_info['tree'])} 节点) ===")
        for n in tree_info['tree']:
            indent = '  ' * n['depth']
            cn = f" children=[{','.join(n['childNames'])}]" if n['childNames'] else ''
            mesh = ' [MESH]' if n['isMesh'] else ''
            vis = '' if n['visible'] else ' [HIDDEN]'
            print(f"{indent}{n['name']:20s}({n['type']}){mesh}{vis} localPos=({n['localPos'][0]:.2f},{n['localPos'][1]:.2f},{n['localPos'][2]:.2f}){cn}")

        print(f"\n=== Mesh 节点详情（按 Z 升序=机头→机尾）===")
        nodes_by_z = sorted(tree_info['nodes'], key=lambda n: n['z'])
        for n in nodes_by_z:
            tag = ' ⚡PROP' if n['isPropName'] else ''
            print(f"  {n['name']:20s} Z={n['z']:7.2f} Y={n['y']:7.2f} X={n['x']:7.2f} size={n['size']}{tag}")

        # 2. 自动标记机头最前端 mesh 为螺旋桨，重 autoOrient
        print(f"\n=== 自动标记机头最前端节点为螺旋桨 ===")
        front = nodes_by_z[0]
        print(f"机头最前端: {front['name']} Z={front['z']} Y={front['y']} size={front['size']}")

        page.evaluate('''(frontName) => {
          const d = window.__debug;
          const n = d.state.nodes.find(x => x.name === frontName);
          if (!n) return;
          d.state.selectedName = frontName;
          n.markedProp = true;
          if (!d.state.markedPropNames.includes(n.name)) d.state.markedPropNames.push(n.name);
          n.mesh.material.transparent = false;
          n.mesh.material.opacity = 1.0;
          if (n.mesh.material.emissive) n.mesh.material.emissive.set(0x6fff8a);
          n.mesh.material.emissiveIntensity = 0.6;
        }''', front['name'])
        page.wait_for_timeout(300)
        page.evaluate("document.getElementById('btn-auto-yaw').click()")
        page.wait_for_timeout(500)
        yaw_after = page.evaluate('() => +window.__debug.orient.yaw.toFixed(2)')
        print(f"标记后 autoOrient yaw = {yaw_after}°")

        # 截图标记后各视角
        for cam, btn in [('chase','btn-cam-chase'), ('side','btn-cam-side'), ('top','btn-cam-top'), ('front','btn-cam-front')]:
            page.evaluate(f"document.getElementById('{btn}').click()")
            page.wait_for_timeout(400)
            path = os.path.join(OUT_DIR, f'spit_marked_{cam}.png')
            page.screenshot(path=path)
            print(f"  截图: spit_marked_{cam}.png")

        # 导出配置
        output = page.evaluate("document.getElementById('out-pre').textContent")
        print(f"\n=== 导出配置 ===")
        print(output)

        json_path = os.path.join(OUT_DIR, 'spit_tree.json')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(tree_info, f, ensure_ascii=False, indent=2)
        print(f"\n场景树 JSON: {json_path}")

        browser.close()
        print('\n完成')

if __name__ == '__main__':
    main()
