"""
喷火 Mk IIa 模型调试脚本
加载 tune_enemy.html，截图多视角，提取节点结构 + autoOrient 结果
"""
import json
import os
import time
from playwright.sync_api import sync_playwright

OUT_DIR = os.path.join(os.path.dirname(__file__), 'test_shots')
os.makedirs(OUT_DIR, exist_ok=True)

URL = 'http://localhost:5173/tune_enemy.html?model=/model/spitfire_mk_iia.glb'

def wait_loaded(page):
    """等待 loader 隐藏 + 模型加载完成"""
    page.wait_for_selector('#loader.hide', timeout=30000)
    page.wait_for_timeout(2500)  # 额外等待模型稳定

def shot(page, name):
    path = os.path.join(OUT_DIR, f'spit_{name}.png')
    page.screenshot(path=path, full_page=False)
    print(f'  截图: {path}')

def click_btn(page, btn_id):
    page.evaluate(f"document.getElementById('{btn_id}').click()")
    page.wait_for_timeout(400)

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 1600, 'height': 900}, device_scale_factor=1)
        page = ctx.new_page()
        # 收集 console
        logs = []
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        page.on('pageerror', lambda e: logs.append(f'[ERROR] {e}'))

        print(f'打开: {URL}')
        page.goto(URL, wait_until='domcontentloaded')
        print('等待加载...')
        wait_loaded(page)

        # 1. 截图各视角
        print('截图各视角:')
        shot(page, 'chase')          # 追尾（默认）
        click_btn(page, 'btn-cam-side')
        shot(page, 'side')
        click_btn(page, 'btn-cam-top')
        shot(page, 'top')
        click_btn(page, 'btn-cam-front')
        shot(page, 'front')
        click_btn(page, 'btn-cam-chase')  # 回追尾

        # 2. 提取节点信息
        print('\n=== 节点分析 ===')
        debug_info = page.evaluate('''() => {
          const d = window.__debug;
          if (!d) return { error: 'no __debug' };
          const nodes = d.state.nodes.map(n => ({
            name: n.name, y: +n.y.toFixed(2), x: +n.x.toFixed(2), z: +n.z.toFixed(2),
            size: [+n.size.x.toFixed(1), +n.size.y.toFixed(1), +n.size.z.toFixed(1)],
            isPropName: n.isPropName, markedProp: n.markedProp,
          }));
          return {
            currentUrl: d.state.currentUrl,
            yaw: +d.orient.yaw.toFixed(2),
            pitch: +d.orient.pitch.toFixed(2),
            roll: +d.orient.roll.toFixed(2),
            scale: +d.orient.scale.toFixed(2),
            markedPropNames: d.state.markedPropNames,
            nodeCount: nodes.length,
            nodes: nodes,
          };
        }''')

        print(f"模型: {debug_info.get('currentUrl')}")
        print(f"朝向: yaw={debug_info['yaw']}° pitch={debug_info['pitch']}° roll={debug_info['roll']}° scale={debug_info['scale']}")
        print(f"节点总数: {debug_info['nodeCount']}")
        print(f"已标记螺旋桨: {debug_info['markedPropNames']}")

        # 候选螺旋桨节点（名称含 prop 关键词）
        prop_candidates = [n for n in debug_info['nodes'] if n['isPropName']]
        print(f"\nPROP_KEYWORDS 匹配节点 ({len(prop_candidates)}):")
        for n in prop_candidates:
            print(f"  {n['name']}  Y={n['y']} pos=({n['x']},{n['z']}) size={n['size']}")

        # 所有节点按 Y 排序（前 30 个，找螺旋桨位置在机头 z 最负）
        print(f"\n节点列表（按 Y 升序，前 25）:")
        sorted_by_y = sorted(debug_info['nodes'], key=lambda n: n['y'])
        for n in sorted_by_y[:25]:
            tag = ' ⚡PROP' if n['isPropName'] else ''
            mk = ' ✅标记' if n['markedProp'] else ''
            print(f"  {n['name']:30s} Y={n['y']:7.2f} X={n['x']:7.2f} Z={n['z']:7.2f} size={n['size']}{tag}{mk}")

        # 按 Z 最负（机头方向）排序，找螺旋桨
        print(f"\n节点列表（按 Z 升序=机头方向，前 15）:")
        sorted_by_z = sorted(debug_info['nodes'], key=lambda n: n['z'])
        for n in sorted_by_z[:15]:
            tag = ' ⚡PROP' if n['isPropName'] else ''
            print(f"  {n['name']:30s} Z={n['z']:7.2f} Y={n['y']:7.2f} X={n['x']:7.2f}{tag}")

        # 3. 测试 autoOrient（重新点自动偏航）
        print('\n=== autoOrient 测试 ===')
        click_btn(page, 'btn-auto-yaw')
        page.wait_for_timeout(300)
        yaw_after = page.evaluate('() => window.__debug.orient.yaw')
        print(f"autoOrient 后 yaw = {yaw_after:.2f}°")
        shot(page, 'after_autoyaw')

        # 4. 加载参考飞机 Bf 109 对比
        print('\n=== 参考飞机对比 ===')
        page.evaluate("document.getElementById('ref-select').value = '/model/bf109_opt.glb'; document.getElementById('ref-select').dispatchEvent(new Event('change'))")
        page.wait_for_timeout(2000)
        shot(page, 'with_bf109_ref')

        # 保存节点数据 JSON
        json_path = os.path.join(OUT_DIR, 'spit_nodes.json')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(debug_info, f, ensure_ascii=False, indent=2)
        print(f'\n节点 JSON 已保存: {json_path}')

        if logs:
            print('\n=== Console 日志 ===')
            for l in logs[:20]:
                print(f'  {l}')

        browser.close()
        print('\n完成')

if __name__ == '__main__':
    main()
