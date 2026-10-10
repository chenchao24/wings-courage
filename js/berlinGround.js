import * as THREE from 'three';

/**
 * 柏林地面（仅第四关《柏林保卫战》，theme 'berlin' 时由 environment.js 创建）。
 *
 * 设计：交战高度锁死 3000-7000m（低于 2000m 触发 CombatAltRule），玩家距地面
 * 永远 ≥2000m，故地面不做任何 3D 内容——纯平平面 + Sentinel-2 卫星真彩色贴图
 * （10m/px，scripts/fetch_berlin_ground.py 产出 img/berlin/ground.jpg）。
 * 图幅 80×64km；B-17 走廊把战场推到图幅边缘（机群出生 x=+38km，距东缘仅 2km，
 * 12km 处雾仅遮 ~76%），故加视觉裙边三件套：
 *   ① 环形裙边大平面（外框 4 倍图幅 − 主图内孔，与主平面零重叠，根除垫层 z-fight）；
 *   ② 裙边贴图 = 主图降采样 2048px（~39m/px，镜像平铺与主图逐边对齐）；
 *   ③ 主图最外 2km 环带羽化模糊到裙边频率，接缝锐度平滑过渡。
 * 边界在雾中自然延伸，无硬边无频率跳变。
 *
 * duck-type Terrain 接口（create/getHeight/isLand/dispose），
 * 供 Flak（terrain.getHeight）与 GameRuntime AGL（env.terrain.getHeight）无差别消费。
 * 本模块与 js/terrain.js 完全独立，互不影响（关卡隔离铁原则）。
 */
export class BerlinGround {
  constructor(options = {}) {
    this.width = options.width ?? 80000;    // x 东西向（米）
    this.depth = options.depth ?? 64000;    // z 南北向（米）
    this.textureUrl = options.texture ?? '/img/berlin/ground.jpg';
    this.anisotropy = options.anisotropy ?? 4;
    // 视觉裙边（隐藏图幅边界，纯视觉不扩展可玩区）
    this.skirtScale = options.skirtScale ?? 4;       // 裙边图幅 = 主图 ×4（320×256km）
    this.skirtTexSize = options.skirtTexSize ?? 2048; // 降采样宽度（px，~39m/px）
    this.skirtY = options.skirtY ?? -0.5;            // 略低于主平面，防接缝发线缝
    this.featherMeters = options.featherMeters ?? 2000; // 主图边缘羽化带（渐进模糊到裙边频率）

    this.mesh = null;
    this._texture = null;
    this._skirt = null;
    this._skirtTexture = null;
  }

  create() {
    const geo = new THREE.PlaneGeometry(this.width, this.depth, 1, 1);
    geo.rotateX(-Math.PI / 2);
    // 朝向校准：卫星图顶行=北，本游戏 z+=北（见 kursk 坐标约定）。
    // rotateX(-90°) 后 v=1 位于 -Z（南），翻转 UV.v 使图像顶行（北）落在 +Z。
    // u 不变：图像右缘（东，柏林城所在）对 +x，东缘=玩家出生一侧。
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));

    this._texture = new THREE.TextureLoader().load(this.textureUrl, (tex) => {
      this._applyFeatheredMain(tex.image);   // 主图边缘羽化后替换主贴图
      this._buildSkirtTexture(tex.image);    // 裙边用原图降采样
    });
    this._texture.colorSpace = THREE.SRGBColorSpace;
    this._texture.anisotropy = this.anisotropy;

    const mat = new THREE.MeshStandardMaterial({
      map: this._texture,
      roughness: 0.96,
      metalness: 0.0,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'berlinGround';
    this.mesh.receiveShadow = true;
    this.mesh.add(this._createSkirt());
    return this.mesh;
  }



  /**
   * 视觉裙边：环形大平面（ShapeGeometry 外框 − 主图大小内孔）作为主平面子节点。
   * 与主平面零重叠——整板垫层在远距离深度精度不足（far=50km 时 40km 处深度
   * 分辨率 ~200m）必然 z-fight 闪动，挖孔后从根上消除。
   * UV 由世界坐标线性映射（与主平面同一映射），超出 [0,1] 部分由镜像平铺承接：
   * 裙边与主图四缘逐边对齐、向外镜像翻折，接缝内容连续。
   */
  _createSkirt() {
    const hw = this.width / 2, hd = this.depth / 2;
    const HW = hw * this.skirtScale, HD = hd * this.skirtScale;
    const shape = new THREE.Shape();
    shape.moveTo(-HW, -HD);
    shape.lineTo(HW, -HD);
    shape.lineTo(HW, HD);
    shape.lineTo(-HW, HD);
    shape.closePath();
    const hole = new THREE.Path();   // 内孔 = 主图图幅（顺时针）
    hole.moveTo(-hw, -hd);
    hole.lineTo(-hw, hd);
    hole.lineTo(hw, hd);
    hole.lineTo(hw, -hd);
    hole.closePath();
    shape.holes.push(hole);

    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);       // shape (x,y) → world (x, 0, -y)，法线 +Y
    // u = x/width+0.5, v = z/depth+0.5 —— 与主平面完全同一映射（v 已含北向翻转）
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, pos.getX(i) / this.width + 0.5, pos.getZ(i) / this.depth + 0.5);
    }

    const mat = new THREE.MeshStandardMaterial({
      color: 0x6b6f5a,          // 贴图就位前的兜底色（近似卫星图平均色调）
      roughness: 0.96,
      metalness: 0.0,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'berlinGroundSkirt';
    mesh.position.y = this.skirtY;
    this._skirt = mesh;
    return mesh;
  }

  /**
   * 主图边缘羽化：图幅最外 featherMeters 环带渐进模糊到裙边贴图频率，
   * 消除"高清主图 ↔ 降采样裙边"在接缝处的锐度跳变（高/低频直接相邻才显眼）。
   * 主贴图替换为 CanvasTexture（一次性处理，加载阶段完成）。
   */
  _applyFeatheredMain(image) {
    if (!this.mesh || !image || this.featherMeters <= 0) return;
    const tex = new THREE.CanvasTexture(this._featherEdges(image));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.mesh.material.map = tex;
    this.mesh.material.needsUpdate = true;
    this._texture.dispose();       // 释放原 TextureLoader 纹理（GPU 让位给羽化版）
    this._texture = tex;
  }

  /** 返回边缘羽化后的主图画布：四条边带用模糊副本 + 线性 alpha 蒙版盖回锐图。 */
  _featherEdges(image) {
    const W = image.width, H = image.height;
    const sharp = document.createElement('canvas');
    sharp.width = W; sharp.height = H;
    const sctx = sharp.getContext('2d');
    sctx.drawImage(image, 0, 0);

    // 全图模糊副本（目标 = 裙边频率：~2 倍裙边 texel 尺度）
    const blurPx = Math.max(2, Math.round((W / this.skirtTexSize) * 2));
    const blurred = document.createElement('canvas');
    blurred.width = W; blurred.height = H;
    const bctx = blurred.getContext('2d');
    bctx.filter = `blur(${blurPx}px)`;
    bctx.drawImage(image, 0, 0);

    // 羽化带宽（图幅 10m/px，x/y 同）
    const fx = Math.round(this.featherMeters / (this.width / W));
    const fy = Math.round(this.featherMeters / (this.depth / H));
    // 一条边带：模糊副本裁剪 + destination-in 渐变蒙版（外缘实、内缘无）盖回主图
    const apply = (dx, dy, w, h, horizontal, flip) => {
      const t = document.createElement('canvas');
      t.width = w; t.height = h;
      const tctx = t.getContext('2d');
      tctx.drawImage(blurred, dx, dy, w, h, 0, 0, w, h);
      tctx.globalCompositeOperation = 'destination-in';
      const g = horizontal ? tctx.createLinearGradient(0, 0, w, 0)
                           : tctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, flip ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
      g.addColorStop(1, flip ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0)');
      tctx.fillStyle = g;
      tctx.fillRect(0, 0, w, h);
      sctx.drawImage(t, dx, dy);
    };
    apply(0, 0, fx, H, true, false);        // 西
    apply(W - fx, 0, fx, H, true, true);    // 东
    apply(0, 0, W, fy, false, false);       // 南（图像顶行）
    apply(0, H - fy, W, fy, false, true);   // 北
    return sharp;
  }

  /**
   * 主图解码完成后：降采样画进小画布（保持图幅宽高比，~39m/px；
   * 降采样本身即低通滤波，无需再模糊），镜像平铺到裙边。
   * UV 已在几何层完成对齐映射，贴图无需 repeat/offset。
   */
  _buildSkirtTexture(image) {
    if (!this._skirt || !image) return;
    const W = this.skirtTexSize;
    const H = Math.round(W * this.depth / this.width);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d').drawImage(image, 0, 0, W, H);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
    tex.anisotropy = this.anisotropy;   // 与主图一致，掠射角不额外糊

    this._skirt.material.map = tex;
    this._skirt.material.color.set(0xffffff);
    this._skirt.material.needsUpdate = true;
    this._skirtTexture = tex;
  }

  // 纯平地面：恒定 0。高空关卡，玩家不会接近地面。
  getHeight(x, z) { return 0; }

  isLand(x, z) { return true; }

  dispose() {
    if (this._skirt) {
      this._skirt.geometry.dispose();
      this._skirt.material.dispose();
      this._skirt = null;
    }
    if (this._skirtTexture) {
      this._skirtTexture.dispose();
      this._skirtTexture = null;
    }
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    if (this._texture) {
      this._texture.dispose();
      this._texture = null;
    }
  }
}
