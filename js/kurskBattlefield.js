import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ════════════════════════════════════════════════════════════
// 模块级常量：GLTF 模型库
// ════════════════════════════════════════════════════════════
const SCALE_FACTOR = 1.0;  // 1m 真实 = 1 游戏单位（HUD 高度直接读 position.y，1 单位=1 米）

// 德军坦克（german 涂装：RAL 7028 暗黄 + RAL 6003 绿 + RAL 8017 红棕迷彩）
const GERMAN_MODELS = [
  { path: '/model/ground_optimized/gtank/gtank1.glb',                       realLen: 4.81 },  // Pz II
  { path: '/model/ground_optimized/gtank/gtank3.glb',                       realLen: 6.41 },  // Pz III
  { path: '/model/ground_optimized/gtank/low-poly_panther_german_tank.glb', realLen: 8.66 },  // Panther
  { path: '/model/ground_optimized/gtank/low-poly_pz_ivh_german_tank.glb',  realLen: 7.02 },  // Pz IV H
  { path: '/model/ground_optimized/gtank/low-poly_tiger_german_tank.glb',   realLen: 8.45 },  // Tiger I
  { path: '/model/ground_optimized/gtank/medium_tank_ii.glb',               realLen: 7.02 },  // Pz IV
  { path: '/model/ground_optimized/gtank/tiger_tank_and_crew.glb',          realLen: 8.45 },  // Tiger+Crew
];

// 苏军坦克/车辆（soviet 涂装：4BO 橄榄绿）
const SOVIET_MODELS = [
  { path: '/model/ground_optimized/gtank/low-poly_kv-1_soviet_tank.glb',    realLen: 6.68 },  // KV-1
  { path: '/model/ground_optimized/gtank/low-poly_kv-2_soviet_tank.glb',    realLen: 6.67 },  // KV-2
  { path: '/model/ground_optimized/stank/low-poly_t-34_soviet_tank.glb',    realLen: 7.64 },  // T-34
  { path: '/model/ground_optimized/stank/low-poly_t-34-85_soviet_tank.glb', realLen: 8.15 },  // T-34-85
  { path: '/model/ground_optimized/stank/low-poly_bt-7_soviet_tank.glb',    realLen: 5.66 },  // BT-7
  { path: '/model/ground_optimized/stank/low-poly_su-85_soviet_tank.glb',   realLen: 8.13 },  // SU-85
  { path: '/model/ground_optimized/stank/t-34-stank.glb',                   realLen: 7.64 },  // T-34
  { path: '/model/ground_optimized/stank/truck.glb',                        realLen: 6.06 },  // 补给卡车
];

// 残骸（wreck 涂装：铁锈烧毁色）
const WRECK_MODELS = [
  { path: '/model/ground_optimized/crush/-26_sd_crash.glb',   realLen: 4.88 },  // T-26 残
  { path: '/model/ground_optimized/crush/-28_sd_crash.glb',   realLen: 7.37 },  // T-28 残
  { path: '/model/ground_optimized/crush/-152_sd_crash.glb',  realLen: 9.18 },  // ISU-152 残
  { path: '/model/ground_optimized/crush/airplane_crash.glb', realLen: 10.0 },  // 飞机残骸
  { path: '/model/ground_optimized/crush/kv_sd_crash.glb',    realLen: 6.68 },  // KV 残
  { path: '/model/ground_optimized/crush/t-50-2_sd_crash.glb', realLen: 5.31 }, // T-50 残
];

/**
 * 库尔斯克战场地面物件（纯视觉，不可交互）。
 *
 * 实现方式：
 *   - GLTF 模型：直接 clone 场景方式加载（曾尝试合并几何体+InstancedMesh，
 *     但 InterleavedBufferAttribute 不支持 mergeGeometries，回退到克隆场景保证显示正确）
 *   - 模块级场景缓存：同模型只加载一次，后续 clone 复用
 *   - 涂装用程序化 CanvasTexture（german/soviet/wreck），3 种共享
 *   - 战壕/高炮/弹坑用程序化几何体（无 GLTF）
 *
 * 关卡隔离：仅 theme==='kursk' 时由 environment.js 创建，不影响第 1/2 关。
 */
export class KurskBattlefield {
  constructor(terrain, options = {}, flakConfig = null) {
    this.terrain = terrain;
    this.options = options;
    this.zones = options.zones || {};
    this.flakConfig = flakConfig;

    this.group = new THREE.Group();
    this.smokeEmitters = [];   // {pos, timer, interval} 烟柱发射器
    this.smokeSprites = [];    // 活跃烟雾粒子
    this.flashEmitters = [];      // 地面炮火闪光发射器
    this.explosionEmitters = [];  // 坦克爆炸火光发射器
    this.fxSprites = [];          // 活跃特效 Sprite
    this._clonedObjs = [];        // 克隆的 GLTF 场景对象（dispose 释放材质）
    this._craterGeos = [];        // 弹坑/染色带独立几何体（dispose 释放）
    this._trenchPoints = [];      // 战壕采样点（供士兵生成引用）
    this._tankObjs = [];          // 坦克对象 {obj, baseX, baseZ, type, phase, ...} 微动用
    this._playerPos = new THREE.Vector3();  // 玩家位置缓存（距离剔除用，避免每帧 new）
    this.aaGunPositions = [];     // 防空炮位置列表（供 AntiAircraftFlak 使用）

    this._buildSharedAssets();

    // 同步构建（程序化物件）
    // 性能优化 P1：停用不影响空战/防空的地面摆放物（函数定义保留以便恢复）
    // this._buildCraters();            // 弹坑（纯氛围）
    this._buildSovietDefenses();        // 37mm 高炮（苏军阵地，防空保留；战壕已在函数内移除）
    // this._buildEastWestTrenches();   // 主路两侧战壕线
    // this._buildCraterField();        // 弹坑场（~600个）
    // this._buildDarkenedGround();     // 焦土加深
    // this._buildSupplyDepots();       // 补给堆放处
    // 防空炮阵地（返回炮位士兵数据，同时填充 this.aaGunPositions）
    const aaGunSoldiers = this._buildAAGunPositions();
    // 苏军T34坦克部署（返回坦克士兵数据）
    const tankSoldiers = this._buildT34Tanks();
    // 合并士兵（仅防空炮位 + 苏军坦克跟随），一次性 InstancedMesh 渲染
    const allSoldiers = [
      ...(aaGunSoldiers || []),
      ...(tankSoldiers || []),
    ];
    this._buildSoldierInstancedMeshes(allSoldiers);
    // this._buildBattlefieldFog();    // 战场局部雾气
    // this._buildSmokePillars();      // 燃烧烟柱
    // this._buildFlashEmitters();     // 炮火闪光
    // this._buildProceduralTanks();   // 德军虎式坦克
  }

  /**
   * 程序化虎式坦克（Tiger I 比例：长8.45×宽3.7×高3.0，深黄棕单色）。
   * 共享几何体+材质，每辆仅 Group+Mesh 引用，零纹理零 GLTF 开销。
   * 部署：战壕后50m，主路两侧各3km，每公里6-8辆，朝向战壕(-z)。
   */
  _buildProceduralTanks() {
    // 共享材质+几何体（所有坦克复用，dispose 时统一释放）
    this._tankMat = new THREE.MeshLambertMaterial({ color: 0x7a6a2e });  // 深黄棕
    this._tankTrackMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });  // 履带黑
    const L = 8.45, W = 3.7, H = 3.0;  // Tiger I 真实尺寸
    this._tankHullGeo    = new THREE.BoxGeometry(W, H * 0.45, L);
    this._tankTurretGeo  = new THREE.BoxGeometry(W * 0.85, H * 0.35, L * 0.35);
    this._tankBarrelGeo  = new THREE.CylinderGeometry(0.12, 0.14, L * 0.6, 8);
    this._tankBarrelGeo.rotateX(Math.PI / 2);  // 圆柱默认 Y 轴，旋转为 Z 向
    this._tankTrackGeo   = new THREE.BoxGeometry(0.6, H * 0.3, L * 1.02);

    const trenchZ = -17000;
    const tankZ = trenchZ - 50;  // 战壕后50m
    let placed = 0;
    for (let side of [-1, 1]) {
      for (let km = 0; km < 3; km++) {
        const xCenter = 3500 + side * (500 + km * 1000);
        const tankCount = 6 + Math.floor(Math.random() * 3);
        for (let i = 0; i < tankCount; i++) {
          const x = xCenter + (Math.random() - 0.5) * 800;
          const z = tankZ + (Math.random() - 0.5) * 30;
          const obj = this._makeProceduralTank(L, W, H);
          const groundY = this.terrain.getHeight(x, z);
          obj.position.set(x, groundY, z);
          // 炮管默认朝 -z，旋转 π 让炮管朝 +z（朝战壕/玩家方向）
          obj.rotation.y = Math.PI + (Math.random() - 0.5) * 0.4;
          // 显式关闭阴影（程序化坦克纯视觉，无需阴影投射）
          obj.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
          this.group.add(obj);
          this._tankObjs.push({ obj, baseX: x, baseZ: z });
          placed++;
        }
      }
    }
  }

  /** 组装一辆程序化坦克（引用共享几何体+材质，零额外分配） */
  _makeProceduralTank(L, W, H) {
    const g = new THREE.Group();
    // 车体
    const hull = new THREE.Mesh(this._tankHullGeo, this._tankMat);
    hull.position.y = H * 0.35;
    g.add(hull);
    // 炮塔（略偏前 = -z 方向，炮管朝 -z）
    const turret = new THREE.Mesh(this._tankTurretGeo, this._tankMat);
    turret.position.y = H * 0.75;
    turret.position.z = -L * 0.1;
    g.add(turret);
    // 主炮管（朝 -z）
    const barrel = new THREE.Mesh(this._tankBarrelGeo, this._tankMat);
    barrel.position.set(0, H * 0.75, -L * 0.45);
    g.add(barrel);
    // 履带（两侧）
    for (let side of [-1, 1]) {
      const track = new THREE.Mesh(this._tankTrackGeo, this._tankTrackMat);
      track.position.set(side * (W / 2 + 0.1), H * 0.15, 0);
      g.add(track);
    }
    return g;
  }

  // ════════════════════════════════════════════════════════════
  // 防空炮阵地（新规划：阵地防空带 + 后方防空带 + 战场防空）
  // ════════════════════════════════════════════════════════════
  _buildAAGunPositions() {
    if (!this.flakConfig) return [];
    const cfg = this.flakConfig;
    const soldiers = [];

    // 共享材质
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x3a3a32, roughness: 0.85, metalness: 0.4 });
    const gunDarkMat = new THREE.MeshStandardMaterial({ color: 0x2a2a24, roughness: 0.9, metalness: 0.3 });
    const truckMat = new THREE.MeshLambertMaterial({ color: 0x4a5a3a });
    const truckDarkMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });

    // ── 阵地防空带：每组3门，每隔1200m，排列随机（纯视觉，emission继承老苏军系数）──
    if (cfg.positionZone) {
      const zMin = Math.min(...cfg.positionZone.map(p => p[1]));
      const zMax = Math.max(...cfg.positionZone.map(p => p[1]));
      const xMin = Math.min(...cfg.positionZone.map(p => p[0]));
      const xMax = Math.max(...cfg.positionZone.map(p => p[0]));
      const groupSize = cfg.positionGroupSize || 3;
      const spacing = cfg.positionGroupSpacing || 1200;
      let count = 0;
      for (let x = xMin + spacing / 2; x < xMax; x += spacing) {
        for (let i = 0; i < groupSize; i++) {
          const gx = x + (Math.random() - 0.5) * 300;
          const gz = zMin + Math.random() * (zMax - zMin);
          this._addAAGunModel(gx, gz, gunMat, gunDarkMat, soldiers, 'position');
          count++;
        }
      }
    }

    // ── 后方防空带：每区域4门炮 ──
    if (cfg.rearZones) {
      let count = 0;
      for (const zone of cfg.rearZones) {
        const n = cfg.rearGunsPerZone || 4;
        for (let i = 0; i < n; i++) {
          const pos = this._randomInPolygon(zone);
          if (!pos) continue;
          this._addAAGunModel(pos.x, pos.z, gunMat, gunDarkMat, soldiers, 'rear');
          this.aaGunPositions.push({ x: pos.x, z: pos.z, type: 'rear', burstAcc: 0, tracerAcc: 0 });
          count++;
        }
      }
    }

    // ── 战场防空：每区域3门炮 ──
    if (cfg.battlefieldZones) {
      let count = 0;
      for (const zone of cfg.battlefieldZones) {
        const n = cfg.battlefieldGunsPerZone || 3;
        for (let i = 0; i < n; i++) {
          const pos = this._randomInPolygon(zone);
          if (!pos) continue;
          this._addAAGunModel(pos.x, pos.z, gunMat, gunDarkMat, soldiers, 'battlefield');
          this.aaGunPositions.push({ x: pos.x, z: pos.z, type: 'battlefield', burstAcc: 0, tracerAcc: 0 });
          count++;
        }
      }
    }

    // 补给车辆 — 性能优化 P1 已移除
    // this._addSupplyTrucks(truckMat, truckDarkMat);

    return soldiers;
  }

  /** 88mm Flak 风格防空炮 3D 模型（1:1 比例，比旧 37mm 大得多） */
  _addAAGunModel(cx, cz, gunMat, gunDarkMat, soldiers, type) {
    const g = new THREE.Group();
    const groundY = this.terrain.getHeight(cx, cz);
    g.position.set(cx, groundY, cz);
    g.rotation.y = Math.random() * Math.PI * 2;

    // 沙袋围墙（5m 半径，16 个沙袋）
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const sb = new THREE.Mesh(this.sandbagGeo, this.sandbagMat);
      sb.position.set(Math.cos(a) * 5, 0.3, Math.sin(a) * 5);
      sb.rotation.y = a + (Math.random() - 0.5) * 0.2;
      g.add(sb);
    }

    // 平台底座（4.5m × 0.3m × 4.5m）
    const platform = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.3, 4.5), gunDarkMat);
    platform.position.y = 0.15;
    g.add(platform);

    // 4 条十字形驻锄（out rigger，2.5m 长）
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 2.5), gunDarkMat);
      leg.position.set(Math.cos(a) * 1.8, 0.1, Math.sin(a) * 1.8);
      leg.rotation.y = a;
      g.add(leg);
    }

    // 中央立柱（0.8m 半径，1.0m 高）
    const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.0, 8), gunMat);
    pivot.position.y = 0.8;
    g.add(pivot);

    // 炮架摇篮（2m × 0.4m × 1.5m）
    const cradle = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 2.0), gunMat);
    cradle.position.y = 1.5;
    g.add(cradle);

    // 双联 88mm 炮管（4.7m 长，仰角 70°）
    const barrelGeo = new THREE.CylinderGeometry(0.08, 0.10, 4.7, 8);
    barrelGeo.rotateX(-Math.PI / 2);
    for (const side of [-0.4, 0.4]) {
      const barrel = new THREE.Mesh(barrelGeo, gunMat);
      barrel.position.set(side, 1.6, -1.0);
      barrel.rotation.x = Math.PI * 70 / 180;
      g.add(barrel);
    }

    // 瞄准盾（0.8m × 0.6m 小盾）
    const shield = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 0.1), gunMat);
    shield.position.set(0, 1.6, 0.3);
    g.add(shield);

    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.group.add(g);

    // 炮位士兵（2-3 名）
    const guardCount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < guardCount; i++) {
      soldiers.push({
        x: cx + (Math.random() - 0.5) * 14,
        z: cz + (Math.random() - 0.5) * 14,
        heading: Math.random() * Math.PI * 2,
        inTrench: false,
      });
    }
  }

  /** 补给卡车（简单程序化模型） */
  _addSupplyTrucks(truckMat, truckDarkMat) {
    const placed = new Set();
    for (const gun of this.aaGunPositions) {
      if (Math.random() > 0.3) continue;  // 约 30% 炮位有补给车
      const tx = gun.x + (Math.random() - 0.5) * 30;
      const tz = gun.z + (Math.random() - 0.5) * 30;
      const key = `${Math.round(tx / 20)}_${Math.round(tz / 20)}`;
      if (placed.has(key)) continue;
      placed.add(key);

      const g = new THREE.Group();
      const groundY = this.terrain.getHeight(tx, tz);
      g.position.set(tx, groundY, tz);
      g.rotation.y = Math.random() * Math.PI * 2;

      // 车厢（5m × 2.2m × 1.8m）
      const body = new THREE.Mesh(new THREE.BoxGeometry(5, 1.8, 2.2), truckMat);
      body.position.y = 1.2;
      g.add(body);
      // 驾驶室（2m × 2.2m × 1.8m）
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2.0), truckMat);
      cab.position.set(-3.2, 1.1, 0);
      g.add(cab);
      // 4 个轮子
      const wheelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.3, 8);
      wheelGeo.rotateZ(Math.PI / 2);
      for (const [wx, wz] of [[-3.5, -1.1], [-3.5, 1.1], [2.0, -1.1], [2.0, 1.1]]) {
        const wheel = new THREE.Mesh(wheelGeo, truckDarkMat);
        wheel.position.set(wx, 0.6, wz);
        g.add(wheel);
      }
      g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      this.group.add(g);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 苏军 T34 坦克部署（T-34-85 比例，程序化）
  // ════════════════════════════════════════════════════════════
  _buildT34Tanks() {
    if (!this.flakConfig?.tankZones) return [];
    const cfg = this.flakConfig;
    const soldiers = [];

    // 共享材质+几何体（T-34-85 尺寸：长6.1×宽3.0×高2.45）
    const t34Mat = new THREE.MeshLambertMaterial({ color: 0x4a5a3a });  // 苏军 4BO 橄榄绿
    const t34TrackMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const L = 6.1, W = 3.0, H = 2.45;
    const hullGeo = new THREE.BoxGeometry(L, H * 0.5, W);
    const turretGeo = new THREE.BoxGeometry(L * 0.35, H * 0.35, W * 0.8);
    const barrelGeo = new THREE.CylinderGeometry(0.08, 0.09, 4.2, 8);  // 85mm 炮管
    barrelGeo.rotateX(Math.PI / 2);
    const trackGeo = new THREE.BoxGeometry(L * 1.02, H * 0.3, 0.5);
    // T34 特有斜面装甲前部
    const slopeGeo = new THREE.BoxGeometry(L * 0.2, H * 0.4, W * 0.95);

    let placed = 0;
    for (const zone of cfg.tankZones) {
      const xMin = Math.min(...zone.map(p => p[0]));
      const xMax = Math.max(...zone.map(p => p[0]));
      const zMin = Math.min(...zone.map(p => p[1]));
      const zMax = Math.max(...zone.map(p => p[1]));
      const spacing = cfg.tankSpacing || 1000;
      const perKm = cfg.tanksPerKm || 4;

      for (let x = xMin + spacing / perKm / 2; x < xMax; x += spacing / perKm) {
        const tx = x + (Math.random() - 0.5) * 100;
        const tz = zMin + Math.random() * (zMax - zMin);
        const obj = this._makeT34Tank(L, W, H, hullGeo, turretGeo, barrelGeo, trackGeo, slopeGeo, t34Mat, t34TrackMat);
        const groundY = this.terrain.getHeight(tx, tz);
        obj.position.set(tx, groundY, tz);
        obj.rotation.y = Math.random() * Math.PI * 2;
        obj.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        this.group.add(obj);
        placed++;

        // 坦克后 50m 内跟随 5-7 名士兵
        const soldierCount = (cfg.tankSoldiers?.[0] || 5) + Math.floor(Math.random() * ((cfg.tankSoldiers?.[1] || 7) - (cfg.tankSoldiers?.[0] || 5) + 1));
        const behindAngle = obj.rotation.y + Math.PI;  // 坦克后方
        for (let i = 0; i < soldierCount; i++) {
          const dist = 10 + Math.random() * 40;  // 10-50m
          const spread = (Math.random() - 0.5) * 30;  // ±15m 散开
          const sx = tx + Math.cos(behindAngle) * dist + Math.cos(behindAngle + Math.PI / 2) * spread;
          const sz = tz + Math.sin(behindAngle) * dist + Math.sin(behindAngle + Math.PI / 2) * spread;
          soldiers.push({ x: sx, z: sz, heading: obj.rotation.y, inTrench: false });
        }
      }
    }
    return soldiers;
  }

  /** 组装 T-34-85 坦克（斜面装甲特色） */
  _makeT34Tank(L, W, H, hullGeo, turretGeo, barrelGeo, trackGeo, slopeGeo, mat, trackMat) {
    const g = new THREE.Group();
    // 车体
    const hull = new THREE.Mesh(hullGeo, mat);
    hull.position.y = H * 0.35;
    g.add(hull);
    // 斜面装甲前部（T34 标志性倾斜前装甲）
    const slope = new THREE.Mesh(slopeGeo, mat);
    slope.position.set(-L * 0.42, H * 0.4, 0);
    slope.rotation.z = -Math.PI / 6;  // 倾斜 30°
    g.add(slope);
    // 炮塔
    const turret = new THREE.Mesh(turretGeo, mat);
    turret.position.y = H * 0.72;
    turret.position.z = -L * 0.1;
    g.add(turret);
    // 85mm 主炮管（朝 -z）
    const barrel = new THREE.Mesh(barrelGeo, mat);
    barrel.position.set(0, H * 0.72, -L * 0.45);
    g.add(barrel);
    // 履带（两侧）
    for (let side of [-1, 1]) {
      const track = new THREE.Mesh(trackGeo, trackMat);
      track.position.set(0, H * 0.15, side * (W / 2 + 0.1));
      g.add(track);
    }
    return g;
  }

  // ─────────────────────────────────────────────────────────────
  // 共享资源（dispose 释放）
  // ─────────────────────────────────────────────────────────────
  _buildSharedAssets() {
    // 战壕 / 反坦克壕（灰土色，干燥翻土，比之前深一档）
    this.trenchGeo = new THREE.BoxGeometry(1, 1, 1);
    this.trenchMat = new THREE.MeshStandardMaterial({ color: 0x847e72, roughness: 1.0 });
    this.dirtMat   = new THREE.MeshStandardMaterial({ color: 0x746e64, roughness: 0.98 });

    // 37mm 高炮阵地 61-K
    this.aaMountGeo  = new THREE.BoxGeometry(2.6, 0.4, 2.6);
    this.aaBarrelGeo = new THREE.CylinderGeometry(0.07, 0.09, 3.2, 6);
    this.aaBarrelGeo.rotateX(-Math.PI / 2);
    this.aaMat = new THREE.MeshStandardMaterial({ color: 0x3a3a32, roughness: 0.85, metalness: 0.35 });

    // 沙袋（高炮阵地围墙）
    this.sandbagGeo = new THREE.BoxGeometry(1.1, 0.6, 0.7);
    this.sandbagMat = new THREE.MeshStandardMaterial({ color: 0x7a6a4a, roughness: 0.98 });

    // 弹坑材质（焦土深褐色，roughness=1 不反光）
    this.craterMat = new THREE.MeshLambertMaterial({ color: 0x140e06 });
    this.craterEdgeMat = new THREE.MeshLambertMaterial({ color: 0x2a1e10 });

    // 烟柱 / 闪光纹理
    this.smokeTex = this._makeSmokeTexture();
    this.flashTex = this._makeFlashTexture(0xfff0a0, 0xfff8d0);  // 地面炮火闪光
    this.fireTex  = this._makeFlashTexture(0xff5010, 0xffa040);  // 坦克爆炸火光
    // 注：尘埃纹理已移除（坦克不再产生烟尘）

    // 涂装纹理（GLTF 模型用，3 种共享）
    this.paintTexs = {
      german: this._makePaintTexture('german'),
      soviet: this._makePaintTexture('soviet'),
      wreck:  this._makePaintTexture('wreck'),
    };

    // 战壕染色带纹理（宽度方向中间不透明、两侧渐隐到 0，灰白土色）
    //   用于战壕两侧 3m 翻土染色区，边缘模糊无明显线条
    this.stainTex = this._makeStainTexture();
    this.stainMat = new THREE.MeshLambertMaterial({
      map: this.stainTex,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    // 士兵（程序化：躯干+头，单色灰绿军服，性能优先）
    this.soldierBodyGeo = new THREE.CylinderGeometry(0.25, 0.3, 1.4, 6);
    this.soldierHeadGeo = new THREE.SphereGeometry(0.22, 6, 5);
    this.soldierMat = new THREE.MeshLambertMaterial({ color: 0x4a4a36 });  // 灰绿军服（单一颜色）

    // 补给箱（木质弹药箱/物资箱）
    this.crateGeo = new THREE.BoxGeometry(1.5, 1.2, 1.0);
    this.crateMat = new THREE.MeshLambertMaterial({ color: 0x5a4628 });  // 深木色
  }

  // ─────────────────────────────────────────────────────────────
  // 纹理生成
  // ─────────────────────────────────────────────────────────────
  _makeSmokeTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0.0, 'rgba(70,70,70,0.92)');
    g.addColorStop(0.4, 'rgba(55,55,55,0.7)');
    g.addColorStop(0.8, 'rgba(35,35,35,0.25)');
    g.addColorStop(1.0, 'rgba(25,25,25,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _makeFlashTexture(coreColorHex, hotColorHex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const cr = new THREE.Color(coreColorHex);
    const ht = new THREE.Color(hotColorHex);
    const rgba = (col, a) => `rgba(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0},${a})`;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0.0, rgba(ht, 1.0));
    g.addColorStop(0.2, rgba(ht, 0.95));
    g.addColorStop(0.45, rgba(cr, 0.85));
    g.addColorStop(0.7, rgba(cr, 0.4));
    g.addColorStop(1.0, rgba(cr, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** 程序化涂装纹理（german/soviet/wreck），从 terrain_test 移植 */
  _makePaintTexture(type) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    if (type === 'german') {
      ctx.fillStyle = '#9c8c4a'; ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#4b5320';
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(Math.random()*256, Math.random()*256, 30+Math.random()*40, 15+Math.random()*25, Math.random()*Math.PI, 0, Math.PI*2); ctx.fill(); }
      ctx.fillStyle = '#5a3a28';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(Math.random()*256, Math.random()*256, 20+Math.random()*30, 10+Math.random()*20, Math.random()*Math.PI, 0, Math.PI*2); ctx.fill(); }
    } else if (type === 'soviet') {
      ctx.fillStyle = '#3d4a2a'; ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#2a3520';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(Math.random()*256, Math.random()*256, 25+Math.random()*35, 15+Math.random()*20, Math.random()*Math.PI, 0, Math.PI*2); ctx.fill(); }
      ctx.fillStyle = '#4a5c34';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(Math.random()*256, Math.random()*256, 20+Math.random()*25, 12+Math.random()*15, Math.random()*Math.PI, 0, Math.PI*2); ctx.fill(); }
    } else { // wreck
      ctx.fillStyle = '#2a2018'; ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#6b3a1a';
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(Math.random()*256, Math.random()*256, 20+Math.random()*35, 12+Math.random()*20, Math.random()*Math.PI, 0, Math.PI*2); ctx.fill(); }
      ctx.fillStyle = '#8a4a20';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(Math.random()*256, Math.random()*256, 15+Math.random()*20, 8+Math.random()*12, Math.random()*Math.PI, 0, Math.PI*2); ctx.fill(); }
      ctx.fillStyle = '#1a1510';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(Math.random()*256, Math.random()*256, 25+Math.random()*30, 15+Math.random()*20, Math.random()*Math.PI, 0, Math.PI*2); ctx.fill(); }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /**
   * 战壕染色带纹理：宽度方向（U）中间不透明灰白土色、两侧渐隐到 0；
   * 长度方向（V）加少量颗粒噪点模拟翻土质感。
   * 用于战壕两侧 3m 染色区，边缘模糊无明显线条。
   */
  _makeStainTexture() {
    const w = 128, h = 32;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    // 宽度方向渐变：边缘透明 → 中间灰土色不透明（加深一档匹配战壕）
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0.00, 'rgba(140,132,120,0)');
    grad.addColorStop(0.20, 'rgba(140,132,120,0.35)');
    grad.addColorStop(0.42, 'rgba(128,120,108,0.85)');
    grad.addColorStop(0.50, 'rgba(118,110,100,0.95)');
    grad.addColorStop(0.58, 'rgba(128,120,108,0.85)');
    grad.addColorStop(0.80, 'rgba(140,132,120,0.35)');
    grad.addColorStop(1.00, 'rgba(140,132,120,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // 颗粒噪点（翻土质感）
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 145 + (Math.random() * 30) | 0;
      const g = 135 + (Math.random() * 25) | 0;
      const b = 122 + (Math.random() * 20) | 0;
      // 距离中心越远透明度越低（跟随渐变）
      const dist = Math.abs(x - w / 2) / (w / 2);
      const a = (1 - dist) * 0.5 * Math.random();
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ─────────────────────────────────────────────────────────────
  // GLTF 模型加载（直接克隆场景方式，terrain_test 验证可用）
  //   同模型只 loadAsync 一次缓存到 sceneCache，后续 clone(true) 复用；
  //   每个 clone 独立替换涂装材质 + 贴地 + 朝向，简单可靠。
  // ─────────────────────────────────────────────────────────────
  async _loadAllGltfModels() {
    try {
      const loader = new GLTFLoader();
      // meshopt 解码器：优化版模型使用 EXT_meshopt_compression，必须注册否则报错（同 aircraft.js）
      loader.setMeshoptDecoder(MeshoptDecoder);
      // 实例级场景缓存（同模型只加载一次，后续 clone 复用）
      const sceneCache = new Map();
      const loadScene = async (path) => {
        if (!sceneCache.has(path)) {
          const gltf = await loader.loadAsync(path);
          sceneCache.set(path, gltf.scene);
        }
        return sceneCache.get(path);
      };

      // 放置计划：4 组
      const plans = [
        { models: GERMAN_MODELS, count: this.options.germanTanks || 0,     zone: this.zones.friendly,   paint: 'german', isWreck: false },
        { models: SOVIET_MODELS, count: this.options.sovietTanks || 0,     zone: this.zones.enemy,      paint: 'soviet', isWreck: false },
        { models: WRECK_MODELS,  count: this.options.bombardedWrecks || 0, zone: this.zones.bombarded,  paint: 'wreck',  isWreck: true },
        { models: WRECK_MODELS,  count: this.options.mainBattleWrecks || 0,zone: this.zones.mainBattle, paint: 'wreck',  isWreck: true },
      ];

      let placed = 0;
      for (const plan of plans) {
        if (!plan.zone || plan.count <= 0) continue;
        for (let i = 0; i < plan.count; i++) {
          const pos = this._randomInPolygon(plan.zone);
          if (!pos) continue;
          const cfg = plan.models[Math.floor(Math.random() * plan.models.length)];
          try {
            const srcScene = await loadScene(cfg.path);
            const obj = srcScene.clone(true);

            // 缩放到真实尺寸（1m = 1 游戏单位）
            const box = new THREE.Box3().setFromObject(obj);
            const size = new THREE.Vector3();
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const scale = (cfg.realLen * SCALE_FACTOR) / maxDim;
            obj.scale.setScalar(scale);

            // 涂装替换
            if (this.paintTexs[plan.paint]) {
              obj.traverse(o => {
                if (o.isMesh) o.material = new THREE.MeshLambertMaterial({ map: this.paintTexs[plan.paint] });
              });
            }

            // 贴地
            const box2 = new THREE.Box3().setFromObject(obj);
            const center2 = new THREE.Vector3();
            box2.getCenter(center2);
            const groundY = this.terrain.getHeight(pos.x, pos.z);
            const sink = plan.isWreck ? 0.4 + Math.random() * 0.4 : 0;
            obj.position.set(pos.x - center2.x, groundY - box2.min.y + 0.1 - sink, pos.z - center2.z);

            // 朝向 + 残骸倾斜
            obj.rotation.set(
              plan.isWreck ? (Math.random() - 0.5) * 0.5 : 0,
              Math.random() * Math.PI * 2,
              plan.isWreck ? (Math.random() - 0.5) * 0.5 : 0,
              'YXZ'
            );

            obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
            this.group.add(obj);
            this._clonedObjs.push(obj);
            placed++;

            // 残骸 40% 登记为爆炸发射器
            if (plan.isWreck && Math.random() < 0.4) {
              this.explosionEmitters.push({
                pos: new THREE.Vector3(pos.x, groundY + 1.5, pos.z),
                timer: Math.random() * 4,
                interval: 3.0 + Math.random() * 4.0,
              });
            }
          } catch (e) {
            console.warn('[KurskBattlefield] 模型加载失败:', cfg.path, e.message);
          }
        }
      }
    } catch (e) {
      console.warn('[KurskBattlefield] GLTF 加载异常:', e.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 弹坑
  // ─────────────────────────────────────────────────────────────
  _buildCraters() {
    // 被炮击区：密集弹坑（大范围重叠，炮击痕迹重）
    const bombardedCount = this.options.bombardedCraters || 0;
    for (let i = 0; i < bombardedCount; i++) {
      const pos = this._randomInPolygon(this.zones.bombarded);
      if (!pos) continue;
      this._addCrater(pos.x, pos.z, 3 + Math.random() * 4);  // 半径 3-7
    }
    // 主战场：分散弹坑（较稀疏，分布不均匀）
    const mainCount = this.options.mainBattleCraters || 0;
    for (let i = 0; i < mainCount; i++) {
      const pos = this._randomInPolygon(this.zones.mainBattle);
      if (!pos) continue;
      this._addCrater(pos.x, pos.z, 2 + Math.random() * 3);  // 半径 2-5
    }
  }

  _addCrater(x, z, radius) {
    const groundY = this.terrain.getHeight(x, z);
    // 外圈（略浅，焦土翻飞边缘）
    const edgeGeo = new THREE.CircleGeometry(radius * 1.3, 12);
    edgeGeo.rotateX(-Math.PI / 2);
    const edge = new THREE.Mesh(edgeGeo, this.craterEdgeMat);
    edge.position.set(x, groundY + 0.04, z);
    edge.receiveShadow = true;
    this.group.add(edge);
    this._craterGeos.push(edgeGeo);
    // 内坑（深色焦黑）
    const innerGeo = new THREE.CircleGeometry(radius, 12);
    innerGeo.rotateX(-Math.PI / 2);
    const inner = new THREE.Mesh(innerGeo, this.craterMat);
    inner.position.set(x, groundY + 0.06, z);
    inner.receiveShadow = true;
    this.group.add(inner);
    this._craterGeos.push(innerGeo);
  }

  // ─────────────────────────────────────────────────────────────
  // 苏军阵地防御工事：战壕网络 + 37mm 高炮阵地
  // ─────────────────────────────────────────────────────────────
  _buildSovietDefenses() {
    const polygon = this.zones.enemy;
    if (!polygon) return;

    // 战壕网络 — 性能优化 P1 已移除（不影响空战/防空）
    // const trenchCount = this.options.sovietTrenches || 0;
    // for (let i = 0; i < trenchCount; i++) {
    //   const pos = this._randomInPolygon(polygon);
    //   if (!pos) continue;
    //   this._addTrenchNetwork(pos.x, pos.z, Math.random() * Math.PI * 2);
    // }

    // 37mm 高炮阵地（纯视觉，不接伤害）
    const aaCount = this.options.sovietAAGuns || 0;
    for (let i = 0; i < aaCount; i++) {
      const pos = this._randomInPolygon(polygon);
      if (!pos) continue;
      this._addAAGun(pos.x, pos.z, Math.random() * Math.PI * 2);
    }
  }

  _addTrenchNetwork(cx, cz, heading) {
    const g = new THREE.Group();
    const groundY = this.terrain.getHeight(cx, cz);
    g.position.set(cx, groundY, cz);
    g.rotation.y = heading;
    // 真实战壕：主壕 15-25m，支壕 8-12m，宽 1.5m，深 1.8m
    this._addTrenchSegment(g, 0, 0, 15 + Math.random() * 10, 1.5, Math.PI / 2);
    this._addTrenchSegment(g, -5, 3, 8 + Math.random() * 4, 1.5, 0);
    this._addTrenchSegment(g, 4, -3, 8 + Math.random() * 4, 1.5, 0);
    this.group.add(g);
  }

  _addTrenchSegment(parent, ox, oz, length, width, segHeading) {
    const seg = new THREE.Group();
    seg.position.set(ox, 0, oz);
    seg.rotation.y = segHeading;
    const depth = 1.8;  // 1.8m 深（真实战壕深度）
    const inner = new THREE.Mesh(this.trenchGeo, this.trenchMat);
    inner.scale.set(width, depth, length);
    inner.position.set(0, -depth / 2 + 0.1, 0);
    inner.receiveShadow = true;
    seg.add(inner);
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(this.trenchGeo, this.dirtMat);
      edge.scale.set(0.5, 0.5, length);  // 土垒宽 0.5m
      edge.position.set(side * (width / 2 + 0.4), 0.25, 0);
      edge.castShadow = true; edge.receiveShadow = true;
      seg.add(edge);
    }
    parent.add(seg);
  }

  _addAAGun(cx, cz, heading) {
    const g = new THREE.Group();
    const groundY = this.terrain.getHeight(cx, cz);
    g.position.set(cx, groundY, cz);
    g.rotation.y = heading;

    // 圆形沙袋墙
    const ringCount = 12;
    for (let i = 0; i < ringCount; i++) {
      const a = (i / ringCount) * Math.PI * 2;
      const sb = new THREE.Mesh(this.sandbagGeo, this.sandbagMat);
      sb.position.set(Math.cos(a) * 4, 0.3, Math.sin(a) * 4);
      sb.rotation.y = a + (Math.random() - 0.5) * 0.2;
      sb.castShadow = true; sb.receiveShadow = true;
      g.add(sb);
    }
    // 底座 + 立柱
    const mount = new THREE.Mesh(this.aaMountGeo, this.aaMat);
    mount.position.set(0, 0.4, 0);
    mount.castShadow = true; mount.receiveShadow = true;
    g.add(mount);
    const pillar = new THREE.Mesh(this.trenchGeo, this.aaMat);
    pillar.scale.set(0.3, 1.0, 0.3);
    pillar.position.set(0, 1.0, 0);
    g.add(pillar);
    // 双联 37mm 炮管（仰角 70° 防空）
    for (const side of [-0.4, 0.4]) {
      const barrel = new THREE.Mesh(this.aaBarrelGeo, this.aaMat);
      barrel.position.set(side, 1.2, -0.8);
      barrel.rotation.x = Math.PI * 70 / 180;
      barrel.castShadow = true;
      g.add(barrel);
    }
    this.group.add(g);
  }

  // ─────────────────────────────────────────────────────────────
  // 战壕线（主路两侧各 3km，沿 X 轴连续排布，z=-17000）
  //   主路 x≈3500，西侧 x∈[500,3500]，东侧 x∈[3500,6500]
  //   每条：长 50-150m（沿 X 轴），宽 2m，下陷 2m，灰白土色
  //   形状：Catmull-Rom 圆滑曲线 + 每段小抖动，不平直
  //   边缘：两侧各 3m 染色带渐变模糊（共 8m 宽），无明显线条
  //   士兵：战壕附近生成，战壕内 70% / 战壕外 30%
  // ─────────────────────────────────────────────────────────────
  _buildEastWestTrenches() {
    const centerZ = -17000;
    const roadX = 3500;
    const halfRange = 3000;
    const stainWidth = 8;
    // 主路两侧各 3km：西侧 [500, 3500]，东侧 [3500, 6500]
    const sides = [
      { xMin: roadX - halfRange, xMax: roadX },
      { xMin: roadX, xMax: roadX + halfRange },
    ];

    // 收集所有段数据（先不创建 Mesh，最后用 InstancedMesh 批量渲染）
    const stainSegs = [];  // {x,y,z,sx,sz,heading}
    const innerSegs = [];  // {x,y,z,sx,sz,heading}
    let count = 0;
    for (const side of sides) {
      let x = side.xMin;
      while (x < side.xMax) {
        const len = 50 + Math.random() * 100;
        const gap = 2 + Math.random() * 6;
        const trenchX = x + len / 2;
        if (trenchX + len / 2 > side.xMax) break;
        const z = centerZ + (Math.random() - 0.5) * 30;
        this._collectTrenchSegs(trenchX, z, len, stainWidth, stainSegs, innerSegs);
        x += len + gap;
        count++;
      }
    }
    // 批量创建 InstancedMesh
    this._buildTrenchInstancedMeshes(stainSegs, innerSegs);
  }

  _collectTrenchSegs(centerX, centerZ, length, stainWidth, stainSegs, innerSegs) {
    const depth = 2, width = 2;
    const ctrlCount = Math.max(4, Math.floor(length / 20));
    const ctrlPoints = [];
    for (let i = 0; i <= ctrlCount; i++) {
      const t = i / ctrlCount;
      const x = centerX - length / 2 + t * length;
      const z = centerZ + (Math.random() - 0.5) * 16;
      ctrlPoints.push(new THREE.Vector3(x, 0, z));
    }
    const curve = new THREE.CatmullRomCurve3(ctrlPoints);
    const samples = Math.max(10, Math.floor(length / 2));
    const points = curve.getPoints(samples);

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i], p2 = points[i + 1];
      const jitterX = (Math.random() - 0.5) * 0.8;
      const jitterZ = (Math.random() - 0.5) * 0.8;
      const cx = (p1.x + p2.x) / 2 + jitterX;
      const cz = (p1.z + p2.z) / 2 + jitterZ;
      const cy = this.terrain.getHeight(cx, cz);
      const segLen = p1.distanceTo(p2);
      const heading = Math.atan2(p2.x - p1.x, p2.z - p1.z);

      stainSegs.push({ x: cx, y: cy + 0.04, z: cz, sx: stainWidth, sz: segLen + 0.2, heading: heading + (Math.random() - 0.5) * 0.1 });
      innerSegs.push({ x: cx, y: cy - depth / 2 - 0.05, z: cz, sx: width, sz: segLen + 0.2, heading });

      if (!this._trenchPoints) this._trenchPoints = [];
      this._trenchPoints.push({ x: cx, z: cz, y: cy, heading });
    }
  }

  // 用 2 个 InstancedMesh 渲染所有战壕段（draw call 从 ~5000 降到 2）
  _buildTrenchInstancedMeshes(stainSegs, innerSegs) {
    // 染色带 InstancedMesh
    const stainGeo = new THREE.PlaneGeometry(1, 1);
    stainGeo.rotateX(-Math.PI / 2);
    const stainMesh = new THREE.InstancedMesh(stainGeo, this.stainMat, stainSegs.length);
    const innerMesh = new THREE.InstancedMesh(this.trenchGeo, this.trenchMat, innerSegs.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < stainSegs.length; i++) {
      const seg = stainSegs[i];
      p.set(seg.x, seg.y, seg.z);
      q.setFromEuler(new THREE.Euler(0, seg.heading, 0));
      s.set(seg.sx, 1, seg.sz);
      m.compose(p, q, s);
      stainMesh.setMatrixAt(i, m);
    }
    for (let i = 0; i < innerSegs.length; i++) {
      const seg = innerSegs[i];
      p.set(seg.x, seg.y, seg.z);
      q.setFromEuler(new THREE.Euler(0, seg.heading, 0));
      s.set(seg.sx, 2, seg.sz);  // depth=2
      m.compose(p, q, s);
      innerMesh.setMatrixAt(i, m);
    }
    stainMesh.instanceMatrix.needsUpdate = true;
    innerMesh.instanceMatrix.needsUpdate = true;
    innerMesh.receiveShadow = true;
    this.group.add(stainMesh, innerMesh);
    this._trenchInstancedMeshes = [stainMesh, innerMesh];
    this._trenchInstancedGeos = [stainGeo];
  }

  // ─────────────────────────────────────────────────────────────
  // 地面颜色加深（直接修改地形顶点色，战壕前500m/后300m 焦土氛围）
  //   不叠加 Plane，直接改 terrain geometry 的 color attribute
  //   区域内顶点色 lerp 到深褐色，边缘 smoothstep 过渡
  // ─────────────────────────────────────────────────────────────
  _buildDarkenedGround() {
    const terrainMesh = this.terrain.mesh || this.terrain.terrainMesh;
    if (!terrainMesh || !terrainMesh.geometry.attributes.color) {
      console.warn('[KurskBattlefield] 地形无 vertexColor，跳过地面加深');
      return;
    }
    const geo = terrainMesh.geometry;
    const posAttr = geo.attributes.position;
    const colAttr = geo.attributes.color;
    const tmpColor = new THREE.Color(0x3a2e1e);  // 深褐焦土色
    const darkColor = new THREE.Color();
    let modified = 0;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      // 区域判定：主路两侧各3km × 战壕前500m后300m
      if (x < 400 || x > 6600) continue;
      if (z < -17500 || z > -16200) continue;
      // 边缘 smoothstep 过渡（距边界 200m 内渐变，避免硬边）
      const edgeX = Math.min(KurskBattlefield._smoothstep(400, 600, x), KurskBattlefield._smoothstep(6600, 6400, x));
      const edgeZ = Math.min(KurskBattlefield._smoothstep(-17500, -17300, z), KurskBattlefield._smoothstep(-16200, -16400, z));
      const weight = Math.min(edgeX, edgeZ) * 0.55;  // 最大加深 55%
      // 读取原色 lerp 到深褐
      darkColor.setRGB(colAttr.getX(i), colAttr.getY(i), colAttr.getZ(i));
      darkColor.lerp(tmpColor, weight);
      colAttr.setXYZ(i, darkColor.r, darkColor.g, darkColor.b);
      modified++;
    }
    colAttr.needsUpdate = true;
  }

  /** smoothstep: [edge0,edge1] → [0,1] 平滑过渡 */
  static _smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  // ─────────────────────────────────────────────────────────────
  // 弹坑场（战壕前500m/后300m范围，~600个，纯贴图无物理）
  //   密度：离中心越近越密（pow 偏向中心），大小不均匀（3-10.5m）
  //   形态：星型爆炸痕迹纹理（中心灰黑 + 8条辐射条纹灰白/灰，边缘虚化无硬边）
  //   尺寸：中心直径3-10.5m（最大+50%），星型外径 = 中心直径 × 1.4
  //   渲染：1个 InstancedMesh，1 draw call
  // ─────────────────────────────────────────────────────────────
  _buildCraterField() {
    if (!this._trenchPoints || this._trenchPoints.length === 0) return;

    // 星型爆炸纹理（中心灰黑 + 8条辐射条纹 + 外圈灰白，边缘虚化）
    if (!this.craterStarTex) this.craterStarTex = this._makeCraterStarTexture();
    const craterStarMat = new THREE.MeshBasicMaterial({
      map: this.craterStarTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this._craterStarMat = craterStarMat;

    // 沿战壕线采样弹坑中心点（每隔 ~4 个战壕段取一个，数量翻倍）
    const step = 4;
    const craters = [];  // {x, z, size, heading}
    for (let i = 0; i < this._trenchPoints.length; i += step) {
      const tp = this._trenchPoints[i];
      // 中心 = 战壕位置（前后辐射）
      const centerX = tp.x;
      const centerZ = tp.z;
      // 前500m / 后300m 范围，密度随距离衰减
      // 前500m: r = 500 × pow(random, 1.5)，后300m: r = -300 × pow(random, 1.5)
      const isFront = Math.random() < 0.625;  // 500/(500+300)=0.625 前后比例
      const maxR = isFront ? 500 : 300;
      const r = maxR * Math.pow(Math.random(), 1.5);  // pow 偏向中心
      const sign = isFront ? 1 : -1;  // 前=+z, 后=-z
      // 角度偏窄（前后方向为主，两侧扩散）
      const angle = (Math.random() - 0.5) * Math.PI * 0.8;  // ±72°
      const x = centerX + Math.sin(angle) * r;
      const z = centerZ + Math.cos(angle) * r * sign;
      // 大小不均匀：pow 分布偏向小弹坑，少量大弹坑
      const sizeRand = Math.pow(Math.random(), 2.0);  // 偏小
      const size = 3 + sizeRand * 7.5;  // 3-10.5m（最大+50%）
      craters.push({ x, z, size, heading: Math.random() * Math.PI * 2 });
    }

    // InstancedMesh 渲染
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, craterStarMat, craters.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < craters.length; i++) {
      const c = craters[i];
      const y = this.terrain.getHeight(c.x, c.z) + 0.03;
      p.set(c.x, y, c.z);
      q.setFromEuler(new THREE.Euler(0, c.heading, 0));
      s.set(c.size, 1, c.size);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this._craterFieldMesh = mesh;
    this._craterFieldGeo = geo;
  }

  /** 星型爆炸痕迹纹理：中心灰黑圆 + 8条辐射条纹 + 外圈灰白渐隐（边缘完全虚化） */
  _makeCraterStarTexture() {
    const s = 256;  // 提高分辨率，边缘虚化更细腻
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const cx = s / 2, cy = s / 2;

    // 1. 外圈焦土晕染层（最大范围，极低透明度，与地面无硬边过渡）
    const gradOuter = ctx.createRadialGradient(cx, cy, s * 0.1, cx, cy, s / 2);
    gradOuter.addColorStop(0.0, 'rgba(70,65,58,0.0)');
    gradOuter.addColorStop(0.3, 'rgba(80,75,68,0.25)');
    gradOuter.addColorStop(0.5, 'rgba(100,95,88,0.18)');
    gradOuter.addColorStop(0.75, 'rgba(130,125,115,0.08)');
    gradOuter.addColorStop(1.0, 'rgba(150,145,138,0)');
    ctx.fillStyle = gradOuter;
    ctx.fillRect(0, 0, s, s);

    // 2. 中圈过渡层（灰褐色，连接中心黑和外圈白，虚化过渡）
    const gradMid = ctx.createRadialGradient(cx, cy, s * 0.08, cx, cy, s * 0.32);
    gradMid.addColorStop(0.0, 'rgba(50,45,38,0.6)');
    gradMid.addColorStop(0.4, 'rgba(75,70,62,0.45)');
    gradMid.addColorStop(0.7, 'rgba(100,95,85,0.25)');
    gradMid.addColorStop(1.0, 'rgba(120,115,105,0)');
    ctx.fillStyle = gradMid;
    ctx.fillRect(0, 0, s, s);

    // 3. 8条辐射条纹（星型爆炸痕迹，从中心向外逐渐变细变淡，边缘虚化）
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.25;
      const len = s * 0.46 * (0.65 + Math.random() * 0.35);
      const wInner = 8 + Math.random() * 4;
      const wOuter = 1.5;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      const grad = ctx.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0.0, 'rgba(110,105,95,0.5)');
      grad.addColorStop(0.3, 'rgba(130,125,115,0.35)');
      grad.addColorStop(0.7, 'rgba(150,145,135,0.15)');
      grad.addColorStop(1.0, 'rgba(160,155,145,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -wInner / 2);
      ctx.lineTo(len, -wOuter / 2);
      ctx.lineTo(len, wOuter / 2);
      ctx.lineTo(0, wInner / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 4. 中心灰黑实心圆（弹坑本体，边缘虚化过渡到中圈）
    const gradInner = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.18);
    gradInner.addColorStop(0.0, 'rgba(15,13,10,0.92)');
    gradInner.addColorStop(0.3, 'rgba(25,22,18,0.8)');
    gradInner.addColorStop(0.6, 'rgba(40,36,30,0.55)');
    gradInner.addColorStop(0.85, 'rgba(55,50,42,0.25)');
    gradInner.addColorStop(1.0, 'rgba(70,65,55,0)');
    ctx.fillStyle = gradInner;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.18, 0, Math.PI * 2);
    ctx.fill();

    // 5. 颗粒噪点（焦土质感，只在有像素处加）
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] > 8) {
        const n = (Math.random() - 0.5) * 35;
        img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
        img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
        img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
      }
    }
    ctx.putImageData(img, 0, 0);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ─────────────────────────────────────────────────────────────
  // 沿壕士兵（战壕内 70% / 战壕外 30%，每 3-5m 一个，密度更高）
  //   用 InstancedMesh 渲染（draw call 从 ~3000 降到 2）
  // ─────────────────────────────────────────────────────────────
  _buildSoldiers() {
    if (!this._trenchPoints || this._trenchPoints.length === 0) return;
    const soldiers = [];  // {x,y,z,heading,inTrench}
    for (let i = 0; i < this._trenchPoints.length; i += 3 + Math.floor(Math.random() * 3)) {
      const tp = this._trenchPoints[i];
      const isInTrench = Math.random() < 0.7;
      let x, z;
      if (isInTrench) {
        x = tp.x + (Math.random() - 0.5) * 1.0;
        z = tp.z + (Math.random() - 0.5) * 1.0;
      } else {
        const perpX = Math.cos(tp.heading);
        const perpZ = -Math.sin(tp.heading);
        const offset = (5 + Math.random() * 10) * (Math.random() < 0.5 ? 1 : -1);
        x = tp.x + perpX * offset;
        z = tp.z + perpZ * offset;
      }
      soldiers.push({ x, z, heading: tp.heading + (Math.random() - 0.5) * 0.5, inTrench: isInTrench });
    }
    return soldiers;
  }

  // ─────────────────────────────────────────────────────────────
  // 战壕后方散兵（-z 方向 200m 内，每个战壕段约 6-8 人随机散布）
  // ─────────────────────────────────────────────────────────────
  _buildSoldiersBehindTrench() {
    if (!this._trenchPoints || this._trenchPoints.length === 0) return [];
    const soldiers = [];
    for (const tp of this._trenchPoints) {
      if (Math.random() > 0.12) continue;
      const dz = -(10 + Math.random() * 190);
      const dx = (Math.random() - 0.5) * 30;
      soldiers.push({ x: tp.x + dx, z: tp.z + dz, heading: tp.heading + (Math.random() - 0.5) * 1.0, inTrench: false });
    }
    return soldiers;
  }

  // 批量创建士兵 InstancedMesh（body + head 各一个）
  _buildSoldierInstancedMeshes(soldiers) {
    if (!soldiers || soldiers.length === 0) return;
    const bodyMesh = new THREE.InstancedMesh(this.soldierBodyGeo, this.soldierMat, soldiers.length);
    const headMesh = new THREE.InstancedMesh(this.soldierHeadGeo, this.soldierMat, soldiers.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    for (let i = 0; i < soldiers.length; i++) {
      const sol = soldiers[i];
      const groundY = this.terrain.getHeight(sol.x, sol.z);
      q.setFromEuler(new THREE.Euler(0, sol.heading, 0));
      p.set(sol.x, groundY + (sol.inTrench ? 0.3 : 0.7), sol.z);
      m.compose(p, q, s);
      bodyMesh.setMatrixAt(i, m);
      p.set(sol.x, groundY + (sol.inTrench ? 1.1 : 1.5), sol.z);
      m.compose(p, q, s);
      headMesh.setMatrixAt(i, m);
    }
    bodyMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    this.group.add(bodyMesh, headMesh);
    this._soldierInstancedMeshes = [bodyMesh, headMesh];
  }

  // ─────────────────────────────────────────────────────────────
  // 补给堆放处（战壕后 200-300m，每 1km 一组，木箱堆叠+散落+附近士兵）
  // ─────────────────────────────────────────────────────────────
  _buildSupplyDepots() {
    const trenchZ = -17000;
    const depotZ = trenchZ - 250;  // 战壕后 250m
    const guards = [];
    // 主路两侧各 3km，每 333m 一组（数量3倍：原每1km→现每333m）
    for (let side of [-1, 1]) {
      const baseX = 3500 + side * 500;
      for (let i = 0; i < 9; i++) {
        const cx = baseX + side * i * 333;
        const cz = depotZ + (Math.random() - 0.5) * 50;
        this._addSupplyDepot(cx, cz, guards);
      }
    }
    return guards;
  }

  _addSupplyDepot(cx, cz, guards) {
    const groundY = this.terrain.getHeight(cx, cz);
    const g = new THREE.Group();
    g.position.set(cx, groundY, cz);
    g.rotation.y = Math.random() * Math.PI * 2;
    // 堆叠箱（5-8 个，部分叠放）
    const stackCount = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < stackCount; i++) {
      const crate = new THREE.Mesh(this.crateGeo, this.crateMat);
      crate.position.set(
        (Math.random() - 0.5) * 6,
        i < 3 ? i * 1.2 : 0,
        (Math.random() - 0.5) * 6
      );
      crate.rotation.y = (Math.random() - 0.5) * 0.4;
      crate.castShadow = true;
      crate.receiveShadow = true;
      g.add(crate);
    }
    // 散落箱（3-5 个，倒地）
    const scatterCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < scatterCount; i++) {
      const crate = new THREE.Mesh(this.crateGeo, this.crateMat);
      crate.position.set(
        (Math.random() - 0.5) * 14,
        0.4,
        (Math.random() - 0.5) * 14
      );
      crate.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2, 0);
      crate.castShadow = true;
      g.add(crate);
    }
    this.group.add(g);
    // 守卫士兵数据（加入 guards 数组，由外部统一 InstancedMesh 渲染）
    const guardCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < guardCount; i++) {
      guards.push({
        x: cx + (Math.random() - 0.5) * 20,
        z: cz + (Math.random() - 0.5) * 20,
        heading: Math.random() * Math.PI * 2,
        inTrench: false,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 坦克分布（战壕后 50m，程序化坦克，深黄色，虎式比例，每公里 6-8 辆）
  //   无 GLTF 模型，无烟尘烟雾，无地面阴影贴片
  // ─────────────────────────────────────────────────────────────
  _addSoldier(x, z, heading, inTrench) {
    const groundY = this.terrain.getHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, groundY, z);
    g.rotation.y = heading;
    const body = new THREE.Mesh(this.soldierBodyGeo, this.soldierMat);
    body.position.y = inTrench ? 0.3 : 0.7;
    g.add(body);
    const head = new THREE.Mesh(this.soldierHeadGeo, this.soldierMat);
    head.position.y = inTrench ? 1.1 : 1.5;
    g.add(head);
    this.group.add(g);
  }

  // ─────────────────────────────────────────────────────────────
  // 战场局部雾气（低空战雾，远距模糊+氛围）
  //   3 层半透明 Plane 贴地，跟随地形起伏，fog:true 受场景雾影响
  //   远端自然融入场景雾色，近端低透明度不遮挡视线
  //   范围：主路两侧各 3km × 战壕前后 1km
  // ─────────────────────────────────────────────────────────────
  _buildBattlefieldFog() {
    const xMin = 400, xMax = 6600;
    const zMin = -17600, zMax = -16400;
    const cx = (xMin + xMax) / 2;
    const cz = (zMin + zMax) / 2;
    const w = xMax - xMin, h = zMax - zMin;
    // 3 层不同高度的雾带
    this._fogPlanes = [];
    for (let i = 0; i < 3; i++) {
      const segX = 40, segZ = 8;
      const geo = new THREE.PlaneGeometry(w, h, segX, segZ);
      geo.rotateX(-Math.PI / 2);
      // 逐顶点贴地 + 随机扰动模拟雾气流动
      const pos = geo.attributes.position;
      for (let j = 0; j < pos.count; j++) {
        const wx = cx + pos.getX(j);
        const wz = cz + pos.getZ(j);
        pos.setY(j, this.terrain.getHeight(wx, wz) + 2 + i * 4 + Math.random() * 2);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      // 雾气材质：灰白半透明，受场景雾影响
      const mat = new THREE.MeshBasicMaterial({
        color: 0xd8d4cc,
        transparent: true,
        opacity: 0.18 - i * 0.04,  // 底层 0.18 / 中层 0.14 / 高层 0.10
        depthWrite: false,
        fog: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, 0, cz);
      mesh.renderOrder = 1;  // 在地形之后渲染
      this.group.add(mesh);
      this._fogPlanes.push({ mesh, geo, mat });
    }
  }

  // 燃烧烟柱（主战场永久地标）
  // ─────────────────────────────────────────────────────────────
  _buildSmokePillars() {
    const count = this.options.smokePillars || 0;
    for (let i = 0; i < count; i++) {
      const pos = this._randomInPolygon(this.zones.mainBattle);
      if (!pos) continue;
      const groundY = this.terrain.getHeight(pos.x, pos.z);
      this.smokeEmitters.push({
        pos: new THREE.Vector3(pos.x, groundY, pos.z),
        timer: Math.random() * 0.2,
        interval: 0.15 + Math.random() * 0.1,
      });
    }
  }

  _spawnSmokeSprite(origin) {
    const mat = new THREE.SpriteMaterial({
      map: this.smokeTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      color: 0x9a9a9a,
    });
    const sprite = new THREE.Sprite(mat);
    const s = 8 + Math.random() * 4;
    sprite.scale.set(s, s, 1);
    sprite.position.copy(origin);
    sprite.position.y += 2;
    this.group.add(sprite);
    const maxLife = 3.5 + Math.random() * 1.5;
    this.smokeSprites.push({
      sprite,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 1.5,
        6 + Math.random() * 3,
        (Math.random() - 0.5) * 1.5,
      ),
      life: maxLife,
      maxLife,
      baseScale: s,
      growth: 2.2 + Math.random() * 0.8,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 炮火闪光发射器（主战场地面炮兵齐射节奏）
  // ─────────────────────────────────────────────────────────────
  _buildFlashEmitters() {
    const count = this.options.flashEmitters || 0;
    for (let i = 0; i < count; i++) {
      const pos = this._randomInPolygon(this.zones.mainBattle);
      if (!pos) continue;
      const groundY = this.terrain.getHeight(pos.x, pos.z);
      this.flashEmitters.push({
        pos: new THREE.Vector3(pos.x, groundY + 2.2, pos.z),
        timer: Math.random() * 2.5,
        interval: 2.0 + Math.random() * 3.0,
      });
    }
  }

  _spawnFlash(origin) {
    const mat = new THREE.SpriteMaterial({
      map: this.flashTex,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    const s = 10 + Math.random() * 4;
    sprite.scale.set(s, s, 1);
    sprite.position.copy(origin);
    this.group.add(sprite);
    const maxLife = 0.15 + Math.random() * 0.08;
    this.fxSprites.push({ sprite, life: maxLife, maxLife, baseScale: s, growth: 18 + Math.random() * 8, peakOpacity: 1.0 });
  }

  _spawnExplosion(origin) {
    const mat = new THREE.SpriteMaterial({
      map: this.fireTex,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    const s = 14 + Math.random() * 6;
    sprite.scale.set(s, s, 1);
    sprite.position.copy(origin);
    this.group.add(sprite);
    const maxLife = 0.45 + Math.random() * 0.2;
    this.fxSprites.push({ sprite, life: maxLife, maxLife, baseScale: s, growth: 12 + Math.random() * 5, peakOpacity: 0.95 });

    // 伴随黑烟
    const smokeMat = new THREE.SpriteMaterial({
      map: this.smokeTex,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      color: 0x4a4a4a,
    });
    const smokeSprite = new THREE.Sprite(smokeMat);
    const ss = 6 + Math.random() * 3;
    smokeSprite.scale.set(ss, ss, 1);
    smokeSprite.position.copy(origin);
    this.group.add(smokeSprite);
    const sMaxLife = 1.2 + Math.random() * 0.6;
    this.smokeSprites.push({
      sprite: smokeSprite,
      vel: new THREE.Vector3((Math.random() - 0.5) * 2.5, 4 + Math.random() * 2, (Math.random() - 0.5) * 2.5),
      life: sMaxLife, maxLife: sMaxLife, baseScale: ss, growth: 3.5 + Math.random() * 1.0,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 每帧更新（GameRuntime 调用）
  //   粒子推进：烟柱/闪光/爆炸 + 坦克微动
  //   playerPos: 玩家位置（距离剔除用），可选
  // ─────────────────────────────────────────────────────────────
  update(dt, playerPos) {
    if (playerPos) this._playerPos.copy(playerPos);
    // 坦克距离剔除（8km 外隐藏，省 draw call；GLTF 坦克静态无微动）
    //   玩家出生点距坦克约 500m，8km 阈值确保出生即可见；
    //   _playerPos 为原点（update 未传入玩家位置）时跳过剔除，避免误隐藏
    if (this._playerPos.x === 0 && this._playerPos.z === 0) {
      // 原点跳过，坦克保持默认 visible
    } else {
      const TANK_CULL_SQ = 64000000;  // 8000² = 64,000,000
      for (const t of this._tankObjs) {
        const dx = t.baseX - this._playerPos.x;
        const dz = t.baseZ - this._playerPos.z;
        const distSq = dx * dx + dz * dz;
        const shouldShow = distSq < TANK_CULL_SQ;
        if (t.obj.visible !== shouldShow) t.obj.visible = shouldShow;
      }
    }

    // 雾气 Plane 距离剔除（8km 外隐藏，省 fillrate）
    if (this._fogPlanes) {
      const FOG_CULL_SQ = 64000000;  // 8000²
      const fcx = 3500, fcz = -17000;  // 雾区中心
      const fdx = fcx - this._playerPos.x;
      const fdz = fcz - this._playerPos.z;
      const fogVisible = (fdx * fdx + fdz * fdz) < FOG_CULL_SQ;
      for (const fp of this._fogPlanes) {
        if (fp.mesh.visible !== fogVisible) fp.mesh.visible = fogVisible;
      }
    }

    // 烟柱发射
    for (const em of this.smokeEmitters) {
      em.timer -= dt;
      if (em.timer <= 0) { this._spawnSmokeSprite(em.pos); em.timer = em.interval; }
    }
    // 炮火闪光
    for (const em of this.flashEmitters) {
      em.timer -= dt;
      if (em.timer <= 0) { this._spawnFlash(em.pos); em.timer = em.interval; }
    }
    // 残骸爆燃
    for (const em of this.explosionEmitters) {
      em.timer -= dt;
      if (em.timer <= 0) { this._spawnExplosion(em.pos); em.timer = em.interval; }
    }

    // 推进烟雾粒子
    for (let i = this.smokeSprites.length - 1; i >= 0; i--) {
      const p = this.smokeSprites[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.sprite);
        p.sprite.material.dispose();
        this.smokeSprites.splice(i, 1);
        continue;
      }
      p.sprite.position.x += p.vel.x * dt;
      p.sprite.position.y += p.vel.y * dt;
      p.sprite.position.z += p.vel.z * dt;
      p.vel.multiplyScalar(1 - dt * 0.5);
      p.vel.y -= dt * 0.8;
      const grow = p.baseScale + (p.maxLife - p.life) * p.growth;
      p.sprite.scale.set(grow, grow, 1);
      p.sprite.material.opacity = 0.85 * (p.life / p.maxLife);
    }

    // 推进特效 Sprite
    for (let i = this.fxSprites.length - 1; i >= 0; i--) {
      const fx = this.fxSprites[i];
      fx.life -= dt;
      if (fx.life <= 0) {
        this.group.remove(fx.sprite);
        fx.sprite.material.dispose();
        this.fxSprites.splice(i, 1);
        continue;
      }
      const elapsed = fx.maxLife - fx.life;
      const t = elapsed / fx.maxLife;
      const grow = fx.baseScale + elapsed * fx.growth;
      fx.sprite.scale.set(grow, grow, 1);
      let opacity;
      if (t < 0.15) opacity = fx.peakOpacity * (t / 0.15);
      else opacity = fx.peakOpacity * Math.pow(1 - (t - 0.15) / 0.85, 2.0);
      fx.sprite.material.opacity = opacity;
    }
  }

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
    ) < 15.0;  // 放宽到 15（坦克能在缓坡放置，原 3.0 太严格导致找不到点）
  }

  _randomInPolygon(polygon) {
    if (!polygon || polygon.length < 3) return null;
    // 包围盒
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
    // 60 次仍找不到平坦点：直接返回多边形内随机点（不强求平坦，保证有物件）
    for (let t = 0; t < 30; t++) {
      const x = minX + Math.random() * (maxX - minX);
      const z = minZ + Math.random() * (maxZ - minZ);
      if (this._pointInPolygon(x, z, polygon)) return { x, z };
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // 释放资源
  // ─────────────────────────────────────────────────────────────
  dispose(scene) {
    if (scene) scene.remove(this.group);
    // 烟雾粒子材质
    for (const p of this.smokeSprites) p.sprite.material.dispose();
    this.smokeSprites.length = 0;
    this.smokeEmitters.length = 0;
    // 特效 Sprite 材质
    for (const fx of this.fxSprites) fx.sprite.material.dispose();
    this.fxSprites.length = 0;
    this.flashEmitters.length = 0;
    this.explosionEmitters.length = 0;
    this._tankObjs.length = 0;

    // 克隆场景对象的材质（每个实例独立 clone 了材质，需逐个释放）
    for (const obj of this._clonedObjs) {
      obj.traverse(o => { if (o.isMesh && o.material && o.material !== this._tankMat) o.material.dispose(); });
    }
    this._clonedObjs.length = 0;
    // 坦克共享材质+几何体释放（程序化坦克所有实例引用同一组资源，统一释放）
    if (this._tankMat) this._tankMat.dispose();
    if (this._tankTrackMat) this._tankTrackMat.dispose();
    if (this._tankTex) this._tankTex.dispose();
    if (this._tankShadowMat) this._tankShadowMat.dispose();
    [this._tankHullGeo, this._tankTurretGeo, this._tankBarrelGeo, this._tankTrackGeo].forEach(g => g && g.dispose());
    // 共享几何体
    [this.trenchGeo, this.aaMountGeo, this.aaBarrelGeo, this.sandbagGeo, this.soldierBodyGeo, this.soldierHeadGeo, this.crateGeo,
     ...(this._trenchInstancedGeos || [])].forEach((g) => g && g.dispose());
    // 弹坑独立几何体
    for (const g of this._craterGeos) g.dispose();
    this._craterGeos.length = 0;
    // InstancedMesh 释放
    if (this._trenchInstancedMeshes) this._trenchInstancedMeshes.forEach(m => m && m.dispose());
    if (this._soldierInstancedMeshes) this._soldierInstancedMeshes.forEach(m => m && m.dispose());
    if (this._craterFieldMesh) this._craterFieldMesh.dispose();
    if (this._craterFieldGeo) this._craterFieldGeo.dispose();
    if (this._craterStarMat) this._craterStarMat.dispose();
    if (this.craterStarTex) this.craterStarTex.dispose();
    // 尘埃对象池释放（已移除，保留空检查防错）
    // 雾气 Plane 释放
    if (this._fogPlanes) {
      for (const fp of this._fogPlanes) { fp.geo.dispose(); fp.mat.dispose(); }
      this._fogPlanes.length = 0;
    }
    // 深色地面已直接改地形顶点色，无需释放资源
    // 共享材质
    [this.trenchMat, this.dirtMat, this.aaMat, this.sandbagMat, this.craterMat, this.craterEdgeMat, this.stainMat, this.crateMat, this.soldierMat].forEach((m) => m && m.dispose());
    // 纹理
    [this.smokeTex, this.flashTex, this.fireTex, this.stainTex,
     this.paintTexs.german, this.paintTexs.soviet, this.paintTexs.wreck].forEach((t) => t && t.dispose());
    this.group = null;
  }
}
