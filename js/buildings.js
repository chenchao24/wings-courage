import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

/**
 * 东欧平原建筑 v2：村庄（~20 栋聚集）+ 成片森林区块。
 *
 * - 村庄：每村 18~22 栋房聚集在半径 15~110 内，含小屋/谷仓/教堂，避开陡坡与河流
 * - 森林：成片区块（每块 30~60 棵松树聚集），位置由林区噪声决定，非林区不散树
 * - 全部平房，贴地 y=terrainHeight，castShadow
 * - 提供 obstacleBoxes 供坠毁检测，centers 供雷达显示
 */
export class Buildings {
  constructor(terrain, options = {}) {
    this.terrain = terrain;
    this.villageCount = options.villageCount || 9;
    this.forestPatchCount = options.forestPatchCount || 14;
    this.fieldR = options.fieldR || 3400;
    this.palette = options.palette || 'barbarossa';
    // 启用开关（默认 true=原行为）。关卡配 enabled:false 跳过村庄/森林生成，得到纯净地形。
    // 关卡隔离：britain/barbarossa 不传 → true → 原行为；kursk 传 false → 空地图重新迭代。
    this.enabled = options.enabled !== false;

    this.group = new THREE.Group();
    this.obstacleBoxes = [];
    this.centers = [];

    // 共享几何体
    this.wallGeo = new THREE.BoxGeometry(1, 1, 1);
    this.roofGeo = new THREE.ConeGeometry(0.72, 1, 4);
    this.roofGeo.rotateY(Math.PI / 4);
    // 森林几何体按主题切换：kursk 桦树（白干+卵形树冠）/ 其他 松树（深绿针叶锥）
    this._isBirch = this.palette === 'kursk';
    this.trunkGeo = this._isBirch
      ? new THREE.CylinderGeometry(0.14, 0.20, 1, 6)   // 桦树干（更细）
      : new THREE.CylinderGeometry(0.18, 0.28, 1, 6);  // 松树干
    this.crownGeo = this._isBirch
      ? new THREE.IcosahedronGeometry(1, 0)            // 桦树卵形树冠（低多边形）
      : new THREE.ConeGeometry(1, 1, 7);               // 松树针叶锥

    // 材质池（按主题切换：britain 红砖+灰石板，barbarossa 土色系）
    if (this.palette === 'britain') {
      this.wallMats = [
        new THREE.MeshStandardMaterial({ color: 0x8a4a3a, roughness: 0.96 }), // 红砖
        new THREE.MeshStandardMaterial({ color: 0x7a3a2a, roughness: 0.96 }),
        new THREE.MeshStandardMaterial({ color: 0x6a3020, roughness: 0.96 }),
      ];
      this.roofMats = [
        new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.92 }), // 灰石板
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.92 }),
        new THREE.MeshStandardMaterial({ color: 0x403028, roughness: 0.94 }),
      ];
    } else {
      this.wallMats = [
        new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.96 }),
        new THREE.MeshStandardMaterial({ color: 0x7a6a4a, roughness: 0.96 }),
        new THREE.MeshStandardMaterial({ color: 0x6a5840, roughness: 0.96 }),
        new THREE.MeshStandardMaterial({ color: 0x6a4030, roughness: 0.96 }),
      ];
      this.roofMats = [
        new THREE.MeshStandardMaterial({ color: 0x4a2820, roughness: 0.92 }),
        new THREE.MeshStandardMaterial({ color: 0x363638, roughness: 0.92 }),
        new THREE.MeshStandardMaterial({ color: 0x3e2e1e, roughness: 0.94 }),
      ];
    }
    if (this._isBirch) {
      // 桦树：白色树干 + 黄绿卵形树冠（库尔斯克夏季草原落叶林）
      this.trunkMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.9 });
      this.pineColors = [0x8a9a3a, 0xa8a850, 0x7a8a30, 0x9aa040].map(c => new THREE.Color(c));
    } else {
      // 松树：深棕树干 + 深绿针叶锥（barbarossa 东欧平原针叶林）
      this.trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.95 });
      this.pineColors = [0x3e5a2e, 0x466234, 0x365228].map(c => new THREE.Color(c));
    }
    // 森林用 InstancedMesh：材质白色，每实例通过 instanceColor 设色
    // （否则 instanceColor × material.color 会相乘变暗）
    this.pineMatInst = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });

    if (this.enabled) {
      this._buildVillages();
      this._buildForests();
    } else {
      // 已禁用：清空构造期预建的共享几何体/材质（dispose 会再次防御释放）
      [this.wallGeo, this.roofGeo, this.trunkGeo, this.crownGeo].forEach((g) => g && g.dispose());
      [...this.wallMats, ...this.roofMats, this.trunkMat, this.pineMatInst].forEach((m) => m && m.dispose());
    }
  }

  /** 局部坡度检查：周围采样高度差，平地返回 true */
  _isFlat(x, z, r = 8) {
    const h0 = this.terrain.getHeight(x, z);
    return Math.max(
      Math.abs(this.terrain.getHeight(x + r, z) - h0),
      Math.abs(this.terrain.getHeight(x - r, z) - h0),
      Math.abs(this.terrain.getHeight(x, z + r) - h0),
      Math.abs(this.terrain.getHeight(x, z - r) - h0),
    ) < 2.5;
  }

  /** 村庄集群：每村 ~20 栋聚集，避开陡坡 */
  _buildVillages() {
    for (let v = 0; v < this.villageCount; v++) {
      // 找一个缓坡村子中心（远离原点起飞区）
      let cx = 0, cz = 0, ok = false;
      for (let t = 0; t < 24 && !ok; t++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 700 + Math.sqrt(Math.random()) * this.fieldR;
        cx = Math.cos(ang) * dist; cz = Math.sin(ang) * dist;
        // 海域跳过（可选链兼容旧版 Terrain 无 isLand）
        if (this.terrain.isLand?.(cx, cz) === false) continue;
        if (this._isFlat(cx, cz, 14)) ok = true;
      }
      if (!ok) continue;

      const n = 18 + Math.floor(Math.random() * 5); // 18~22 栋
      for (let i = 0; i < n; i++) {
        // 聚集排布：村子中心半径 15~110
        let bx = 0, bz = 0, bOk = false;
        for (let t = 0; t < 8 && !bOk; t++) {
          const a = Math.random() * Math.PI * 2;
          const r = 15 + Math.random() * 95;
          bx = cx + Math.cos(a) * r; bz = cz + Math.sin(a) * r;
          if (this._isFlat(bx, bz, 7)) bOk = true;
        }
        if (!bOk) continue;
        const type = (i === 0 && Math.random() < 0.3) ? 'church'
                   : (Math.random() < 0.2 ? 'barn' : 'house');
        this._addBuilding(bx, bz, type, Math.random() * Math.PI * 2);
      }
    }
  }

  _addBuilding(x, z, type, yaw) {
    const groundY = this.terrain.getHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, groundY, z);
    g.rotation.y = yaw;

    const wallMat = this.wallMats[Math.floor(Math.random() * this.wallMats.length)];
    const roofMat = this.roofMats[Math.floor(Math.random() * this.roofMats.length)];

    let w, h, d, roofH, roofOverhang = 1.4;
    if (type === 'barn') {
      w = 7 + Math.random() * 4; d = 10 + Math.random() * 5; h = 5 + Math.random() * 2; roofH = 3.5;
    } else if (type === 'church') {
      w = 6; d = 9; h = 5; roofH = 3;
    } else {
      w = 5 + Math.random() * 3; d = 5 + Math.random() * 3; h = 3 + Math.random() * 1.5; roofH = 2.2 + Math.random();
    }

    const wall = new THREE.Mesh(this.wallGeo, wallMat);
    wall.scale.set(w, h, d);
    wall.position.set(0, h / 2, 0);
    wall.castShadow = true; wall.receiveShadow = true;
    g.add(wall);

    const roof = new THREE.Mesh(this.roofGeo, roofMat);
    const rw = Math.max(w, d) * roofOverhang;
    roof.scale.set(rw, roofH, rw);
    roof.position.set(0, h + roofH / 2, 0);
    roof.castShadow = true; roof.receiveShadow = true;
    g.add(roof);

    if (type === 'church') {
      const tower = new THREE.Mesh(this.wallGeo, wallMat);
      tower.scale.set(2.2, h + 2, 2.2);
      tower.position.set(0, (h + 2) / 2, d / 2 + 1);
      tower.castShadow = true; g.add(tower);
      const spire = new THREE.Mesh(this.roofGeo, roofMat);
      spire.scale.set(3.2, 4, 3.2);
      spire.position.set(0, h + 2 + 2, d / 2 + 1);
      spire.castShadow = true; g.add(spire);
    }

    this.group.add(g);
    this.centers.push(new THREE.Vector3(x, groundY, z));

    const box = new THREE.Box3(
      new THREE.Vector3(x - w / 2 - 1, groundY, z - d / 2 - 1),
      new THREE.Vector3(x + w / 2 + 1, groundY + h + roofH, z + d / 2 + 1),
    );
    this.obstacleBoxes.push(box);
  }

  /** 茂密森林：林区区块内密集撒树，冠层重叠成片（InstancedMesh 批量渲染）*/
  _buildForests() {
    const trees = [];
    for (let f = 0; f < this.forestPatchCount; f++) {
      // 找一个林区中心
      let px = 0, pz = 0, ok = false;
      for (let t = 0; t < 30 && !ok; t++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 500 + Math.random() * this.fieldR;
        px = Math.cos(ang) * dist; pz = Math.sin(ang) * dist;
        // 海域跳过（可选链兼容旧版 Terrain 无 isLand）
        if (this.terrain.isLand?.(px, pz) === false) continue;
        if (this.terrain.isForest(px, pz)) ok = true;
      }
      if (!ok) continue;

      // 茂密：每块 120~200 棵，半径 55~90，冠层重叠形成连片林冠
      const n = 120 + Math.floor(Math.random() * 80);
      const patchR = 55 + Math.random() * 35;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * patchR;
        const x = px + Math.cos(a) * r;
        const z = pz + Math.sin(a) * r;
        const gh = this.terrain.getHeight(x, z);
        if (gh > 30 || gh < -2) continue; // 山上/水里不种
        trees.push({ x, z, gh, s: 0.7 + Math.random() * 0.9 });
      }
    }
    this._buildForestInstanced(trees);
  }

  /** InstancedMesh 批量渲染森林：桦树（trunk+1层卵形冠）/ 松树（trunk+3层针叶锥），每实例独立位姿/颜色 */
  _buildForestInstanced(trees) {
    if (!trees.length) return;
    const n = trees.length;
    const LAYERS = this._isBirch ? 1 : 3;  // 桦树单层卵形树冠 / 松树 3 层针叶锥
    const trunkInst = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, n);
    trunkInst.castShadow = true; trunkInst.receiveShadow = true;
    const layerInst = [];
    for (let l = 0; l < LAYERS; l++) {
      const inst = new THREE.InstancedMesh(this.crownGeo, this.pineMatInst, n);
      inst.castShadow = true; inst.receiveShadow = true;
      layerInst.push(inst);
    }
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const t = trees[i];
      const s = t.s;
      const trunkH = (this._isBirch ? 2.2 : 1.5) * s;  // 桦树干更高
      const yaw = Math.random() * Math.PI * 2;
      // trunk
      dummy.position.set(t.x, t.gh + trunkH / 2, t.z);
      dummy.scale.set(1, trunkH, 1);
      dummy.rotation.set(0, yaw, 0);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);
      const mi = Math.floor(Math.random() * this.pineColors.length);
      col.copy(this.pineColors[mi]).multiplyScalar(0.92 + Math.random() * 0.16);

      if (this._isBirch) {
        // 桦树：单层卵形树冠（略压扁的球，黄绿色）
        const ch = 3.0 * s;
        const cr = 2.4 * s;
        dummy.position.set(t.x, t.gh + trunkH + ch * 0.35, t.z);
        dummy.scale.set(cr, ch * 0.9, cr);  // y 略压扁成卵形
        dummy.rotation.set(0, yaw, 0);
        dummy.updateMatrix();
        layerInst[0].setMatrixAt(i, dummy.matrix);
        layerInst[0].setColorAt(i, col);
      } else {
        // 松树：3 层针叶锥（冠层重叠，层间缩进形成锥形树冠）
        let yBase = t.gh + trunkH;
        for (let l = 0; l < LAYERS; l++) {
          const ch = 2.4 * s * (1 - l * 0.18);
          const cr = (2.6 - l * 0.55) * s;
          dummy.position.set(t.x, yBase + ch / 2, t.z);
          dummy.scale.set(cr, ch, cr);
          dummy.rotation.set(0, yaw, 0);
          dummy.updateMatrix();
          layerInst[l].setMatrixAt(i, dummy.matrix);
          layerInst[l].setColorAt(i, col);
          yBase += ch * 0.55;
        }
      }
    }
    trunkInst.instanceMatrix.needsUpdate = true;
    this.group.add(trunkInst);
    for (const inst of layerInst) {
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      this.group.add(inst);
    }
  }

  /** 释放资源（关卡切换时调用） */
  dispose(scene) {
    if (scene) scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isInstancedMesh || o.isMesh) {
        // InstancedMesh 共享 geometry/material，只释放一次（由下方统一处理）
      }
    });
    // 释放共享几何体
    [this.wallGeo, this.roofGeo, this.trunkGeo, this.crownGeo].forEach((g) => g && g.dispose());
    // 释放材质池
    [...this.wallMats, ...this.roofMats, this.trunkMat, this.pineMatInst].forEach((m) => m && m.dispose());
    // 释放每个建筑的独立 mesh（cloned material 已在材质池释放，但 wall/roof mesh 引用共享 geo/mat）
    // group 内 InstancedMesh 的 geometry 已释放，无需重复
    this.obstacleBoxes.length = 0;
    this.centers.length = 0;
    this.group = null;
  }
}
