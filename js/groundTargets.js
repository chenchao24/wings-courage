import * as THREE from 'three';

/**
 * 地面目标系统 stub（P6 预留）。
 *
 * 当前实现：空容器，无实际目标。AI 读取 getAliveTargets() 返回空数组，
 * 自然回退到巡逻/规避行为。未来填充真实目标（车辆/建筑/防空炮）时，
 * 只需在 _spawn() 中创建 mesh 并 push 到 this.targets，AI 端零改动。
 *
 * 接口契约（供 Enemy AI 读取）：
 *   getAliveTargets() → Array<{ position: THREE.Vector3, alive: boolean, hp: number, mesh: Object3D }>
 *
 * 未来扩展点：
 *   - _spawn()：按关卡配置生成地面目标
 *   - takeDamage(target, d)：被敌机子弹命中时扣血（命中检测由 GameRuntime 触发）
 *   - update(dt)：动画/冒烟/重生
 *   - dispose()：释放资源
 */
export class GroundTargets {
  constructor(scene, terrain, options = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.options = options;
    this.targets = [];   // { position, alive, hp, mesh, ... }
    this.group = new THREE.Group();
    this.scene.add(this.group);
    // stub：不调 _spawn()，targets 保持空
  }

  /** 返回所有存活地面目标（供 Enemy AI 读取）*/
  getAliveTargets() {
    return this.targets.filter((t) => t.alive);
  }

  /** stub：未来在此生成目标 */
  _spawn() { /* TODO P6 */ }

  update(dt) { /* TODO P6 */ }

  takeDamage(target, d) { /* TODO P6 */ }

  dispose() {
    this.scene.remove(this.group);
    this.targets = [];
  }
}
