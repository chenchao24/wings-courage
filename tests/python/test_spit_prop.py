"""
喷火螺旋桨旋转验证：在调试页面模拟 _setupPropPivot 逻辑
创建 pivot → reparent 桨叶 → 旋转 → 截图对比静止/旋转
"""
import os
from playwright.sync_api import sync_playwright

OUT_DIR = os.path.join(os.path.dirname(__file__), 'test_shots')
URL = 'http://localhost:5173/tune_enemy.html?model=/model/spitfire_mk_iia.glb'

# 模拟 aircraft.js _setupPropPivot 的核心逻辑（用 Box3 几何中心）
SETUP_PIVOT_JS = r'''
() => {
  const d = window.__debug;
  const model = d.model;
  if (!model) return { error: 'no model' };
  // 找 Object_4（螺旋桨节点）
  const blades = [];
  model.traverse((o) => { if (o.name === 'Object_4') blades.push(o); });
  if (!blades.length) return { error: 'no prop blade' };

  model.updateWorldMatrix(true, true);
  // 用 Box3 几何中心（与 aircraft.js 修复后一致）
  const c = new THREE.Vector3();
  const tmpBox = new THREE.Box3();
  const tmpCenter = new THREE.Vector3();
  let bladeInfo = [];
  blades.forEach((o) => {
    tmpBox.setFromObject(o);
    tmpBox.getCenter(tmpCenter);
    c.add(tmpCenter);
    bladeInfo.push({
      name: o.name,
      worldPos: [+o.getWorldPosition(new THREE.Vector3()).x.toFixed(2),
                 +o.getWorldPosition(new THREE.Vector3()).y.toFixed(2),
                 +o.getWorldPosition(new THREE.Vector3()).z.toFixed(2)],
      geoCenter: [+tmpCenter.x.toFixed(2), +tmpCenter.y.toFixed(2), +tmpCenter.z.toFixed(2)],
    });
  });
  c.divideScalar(blades.length);

  // 检查是否已有 pivot
  let pivot = model.children.find((c) => c.name === '_propPivot');
  if (pivot) model.remove(pivot);

  // 创建 pivot
  const localPivot = model.worldToLocal(c.clone());
  pivot = new THREE.Group();
  pivot.name = '_propPivot';
  pivot.position.copy(localPivot);
  model.add(pivot);
  blades.forEach((b) => pivot.attach(b));

  // 桨叶半透明（模拟高速模糊盘）
  blades.forEach((b) => {
    b.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { m.transparent = true; m.opacity = 0.6; });
    });
  });

  return {
    bladeCount: blades.length,
    bladeInfo,
    pivotWorldPos: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
    pivotLocalPos: [+localPivot.x.toFixed(2), +localPivot.y.toFixed(2), +localPivot.z.toFixed(2)],
    pivotCreated: true,
  };
}
'''

# 旋转 pivot（绕 Z 轴）
ROTATE_PIVOT_JS = r'''
(angleDeg) => {
  const d = window.__debug;
  const pivot = d.model.children.find((c) => c.name === '_propPivot');
  if (!pivot) return { error: 'no pivot' };
  pivot.rotateZ(THREE.MathUtils.degToRad(angleDeg));
  return { rotated: angleDeg, totalRot: +THREE.MathUtils.radToDeg(pivot.rotation.z).toFixed(1) };
}
'''

# 检查 pivot 是否真的在旋转（桨叶位置变化）
CHECK_BLADE_POS_JS = r'''
() => {
  const d = window.__debug;
  const pivot = d.model.children.find((c) => c.name === '_propPivot');
  if (!pivot) return { error: 'no pivot' };
  const results = [];
  pivot.children.forEach((child) => {
    const wp = new THREE.Vector3();
    child.getWorldPosition(wp);
    // 取桨叶包围盒 max 角点（旋转时角点位置会变，中心不变）
    const box = new THREE.Box3().setFromObject(child);
    results.push({
      name: child.name,
      center: [+wp.x.toFixed(3), +wp.y.toFixed(3), +wp.z.toFixed(3)],
      maxCorner: [+box.max.x.toFixed(3), +box.max.y.toFixed(3), +box.max.z.toFixed(3)],
    });
  });
  return { blades: results, pivotRotZ: +THREE.MathUtils.radToDeg(pivot.rotation.z).toFixed(1) };
}
'''


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 1600, 'height': 900})
        page = ctx.new_page()
        page.goto(URL, wait_until='domcontentloaded')
        page.wait_for_selector('#loader.hide', timeout=30000)
        page.wait_for_timeout(2500)

        # 正面视角看螺旋桨最清楚
        page.evaluate("document.getElementById('btn-cam-front').click()")
        page.wait_for_timeout(500)

        # 1. 静态截图（标记螺旋桨高亮）
        print('[1] 标记螺旋桨 + 创建 pivot...')
        result = page.evaluate(SETUP_PIVOT_JS)
        print(f'    {result}')
        if 'error' in result:
            print('FAILED:', result['error'])
            return
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT_DIR, 'spit_prop_static.png'))
        print('    截图: spit_prop_static.png（静止状态）')

        # 2. 记录初始桨叶位置
        before = page.evaluate(CHECK_BLADE_POS_JS)
        print(f'\n[2] 旋转前桨叶位置: pivotRotZ={before["pivotRotZ"]}°')
        for b in before['blades']:
            print(f'    {b["name"]}: center={b["center"]} maxCorner={b["maxCorner"]}')

        # 3. 旋转 90° 截图
        page.evaluate(ROTATE_PIVOT_JS, 90)
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT_DIR, 'spit_prop_rot90.png'))
        after90 = page.evaluate(CHECK_BLADE_POS_JS)
        print(f'\n[3] 旋转 90° 后: pivotRotZ={after90["pivotRotZ"]}°')
        for b in after90['blades']:
            print(f'    {b["name"]}: center={b["center"]} maxCorner={b["maxCorner"]}')

        # 4. 旋转到 180° 截图
        page.evaluate(ROTATE_PIVOT_JS, 90)
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT_DIR, 'spit_prop_rot180.png'))
        after180 = page.evaluate(CHECK_BLADE_POS_JS)
        print(f'\n[4] 旋转 180° 后: pivotRotZ={after180["pivotRotZ"]}°')

        # 5. 旋转到 270° 截图
        page.evaluate(ROTATE_PIVOT_JS, 90)
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT_DIR, 'spit_prop_rot270.png'))

        # 6. 连续旋转动画截图（模拟高速旋转）
        print(f'\n[5] 模拟高速旋转（连续旋转 600°）截图...')
        for _ in range(10):
            page.evaluate(ROTATE_PIVOT_JS, 60)
        page.wait_for_timeout(200)
        page.screenshot(path=os.path.join(OUT_DIR, 'spit_prop_spinning.png'))

        # 验证：旋转前后桨叶位置是否变化（证明 pivot 真的在旋转）
        print(f'\n[6] 旋转验证:')
        b0 = before['blades'][0] if before['blades'] else None
        b90 = after90['blades'][0] if after90['blades'] else None
        if b0 and b90:
            center_changed = b0['center'] != b90['center']
            corner_changed = b0['maxCorner'] != b90['maxCorner']
            print(f'    桨叶中心变化: {"是" if center_changed else "否"}')
            print(f'    桨叶角点变化: {"是 (旋转生效)" if corner_changed else "否"}')
            if not center_changed and corner_changed:
                print('    -> 中心不变(绕中心旋转正确)，角点变化(桨叶转动) OK')

        print(f'\n截图保存在 test_shots/:')
        print('  spit_prop_static.png  (静止)')
        print('  spit_prop_rot90.png   (旋转90°)')
        print('  spit_prop_rot180.png  (旋转180°)')
        print('  spit_prop_rot270.png  (旋转270°)')
        print('  spit_prop_spinning.png(高速旋转模糊)')

        browser.close()
        print('\n完成')


if __name__ == '__main__':
    main()
