import * as THREE from 'three';

/**
 * 库尔斯克战场（#86 瘦身为纯数据模块：只计算防空炮位，不再创建任何 3D 物件）。
 *
 * 历史：曾包含程序化 T-34 坦克群、88mm/37mm 炮阵地、士兵 InstancedMesh、弹坑/烟柱等
 * ~4600 个 mesh。实战高度（IL-2 400-600m、战斗机 2300-3600m）下这些地面物件不可见，
 * 2026-10-13 全部移除（旧实现见 git 历史）；GLTF 地面模型管线（model/ground_optimized/）
 * 从未启用，一并删除。
 *
 * 保留职责：根据 flakConfig 的 rearZones/battlefieldZones 多边形计算防空炮位坐标
 * （aaGunPositions），供 AntiAircraftFlak 作为曳光/爆点发射源——炮火不能从空气里射出。
 *
 * 关卡隔离：仅 theme==='kursk' 且 battlefield.enabled 时由 environment.js 创建。
 */
export class KurskBattlefield {
  constructor(terrain, options = {}, flakConfig = null) {
    this.terrain = terrain;
    this.options = options;
    this.zones = options.zones || {};
    this.flakConfig = flakConfig;

    this.group = new THREE.Group();   // 空容器（environment.js 会 scene.add，保持接口）
    this.aaGunPositions = [];         // 防空炮位置列表（供 AntiAircraftFlak 使用）

    this._computeAAGunPositions();
  }

  /**
   * 防空炮位计算（原 _buildAAGunPositions 的纯数据部分，采样逻辑不变）。
   * 后方防空带：每区域 rearGunsPerZone（默认 4）门；战场防空：每区域 battlefieldGunsPerZone（默认 3）门。
   * 阵地防空带（positionZone）历史上是纯视觉不注册炮位，随视觉一并移除。
   */
  _computeAAGunPositions() {
    const cfg = this.flakConfig;
    if (!cfg) return;

    if (cfg.rearZones) {
      for (const zone of cfg.rearZones) {
        const n = cfg.rearGunsPerZone || 4;
        for (let i = 0; i < n; i++) {
          const pos = this._randomInPolygon(zone);
          if (!pos) continue;
          this.aaGunPositions.push({ x: pos.x, z: pos.z, type: 'rear', burstAcc: 0, tracerAcc: 0 });
        }
      }
    }

    if (cfg.battlefieldZones) {
      for (const zone of cfg.battlefieldZones) {
        const n = cfg.battlefieldGunsPerZone || 3;
        for (let i = 0; i < n; i++) {
          const pos = this._randomInPolygon(zone);
          if (!pos) continue;
          this.aaGunPositions.push({ x: pos.x, z: pos.z, type: 'battlefield', burstAcc: 0, tracerAcc: 0 });
        }
      }
    }
  }

  /** 每帧更新（GameRuntime 调用）：无动态物件，空转保接口。 */
  update(dt, playerPos) { /* 无地面物件后无每帧工作 */ }

  // ─────────────────────────────────────────────────────────────
  // 工具：点-in-多边形 + 区域内随机平坦点
  // ─────────────────────────────────────────────────────────────
  _pointInPolygon(x, z, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], zi = polygon[i][1];
      const xj = polygon[j][0], zj = polygon[j][1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  _isFlat(x, z, r = 8) {
    const h0 = this.terrain.getHeight(x, z);
    return Math.max(
      Math.abs(this.terrain.getHeight(x + r, z) - h0),
      Math.abs(this.terrain.getHeight(x - r, z) - h0),
      Math.abs(this.terrain.getHeight(x, z + r) - h0),
      Math.abs(this.terrain.getHeight(x, z - r) - h0),
    ) < 15.0;
  }

  _randomInPolygon(polygon) {
    if (!polygon || polygon.length < 3) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of polygon) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    for (let t = 0; t < 60; t++) {
      const x = minX + Math.random() * (maxX - minX);
      const z = minZ + Math.random() * (maxZ - minZ);
      if (this._pointInPolygon(x, z, polygon) && this._isFlat(x, z, 10)) return { x, z };
    }
    // 60 次仍找不到平坦点：直接返回多边形内随机点
    for (let t = 0; t < 30; t++) {
      const x = minX + Math.random() * (maxX - minX);
      const z = minZ + Math.random() * (maxZ - minZ);
      if (this._pointInPolygon(x, z, polygon)) return { x, z };
    }
    return null;
  }

  dispose(scene) {
    if (scene && this.group) scene.remove(this.group);
    this.aaGunPositions.length = 0;
    this.group = null;
  }
}
