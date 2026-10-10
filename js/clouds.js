import * as THREE from 'three';

/**
 * 体积感云层：每朵云由多个 Sprite 叠加成不规则大云团。
 *
 * 两种生成模式：
 *   - mode='follow'（默认）：云跟随玩家循环回收，超出 recycleR 搬到前方扇形
 *   - mode='fixed'：固定云带，沿指定线段均匀预生成，不回收不重置（关卡专属）
 *
 * 关键改进（解决“假/方块/重复/太低”）：
 *   - 每朵云 = 4-7 个 Sprite 错位叠加成不规则团状，不再是孤立小方块
 *   - 5 张程序化纹理 + 每sprite随机翻转/缩放，杜绝形状重复
 *   - 纹理边缘 alpha 严格归零 + alphaTest 剔除透明像素，消除方形边界
 *   - 大尺寸（团径 280-520），远看连绵成片
 *   - 可选深浅（depthContrast>1）+ 海面投影（shadowEnabled）
 */
export class Clouds {
  constructor(scene, options = {}) {
    this.scene = scene;

    this.mode = options.mode || 'follow';   // 'follow'(默认跟随) | 'fixed'(固定云带)
    this.clusterCount = options.clusterCount || 28; // 云团数量
    this.blobsPerCluster = options.blobsPerCluster || [4, 7]; // 每团 sprite 数范围
    this.fieldR = options.fieldR || 1600;    // 云散布在玩家周围半径
    this.recycleR = options.recycleR || 2000; // 超出则回收
    this.minY = options.minY || 600;         // 高空带下界
    this.maxY = options.maxY || 1100;        // 高空带上界
    this.minSize = options.minSize || 280;   // 单 sprite 尺寸
    this.maxSize = options.maxSize || 520;

    // 可选增强参数（默认值保持原行为；仅关卡配置覆盖时生效，不影响其他关）
    this.opacity = options.opacity ?? 0.92;              // 整体不透明度
    this.frontBias = options.frontBias ?? 0;             // 前方扇形倾向（0=周围均匀，1=集中前方）— 仅 follow 模式
    this.depthContrast = options.depthContrast ?? 1.0;   // 深浅对比（1=原样，>1 顶部高光+底部阴影增强）
    // 体积感阴影强度（0=关闭=原行为；0.3-1.0=开启）。两层效果：
    //   1) 纹理内部：随机暗斑（云体厚度遮挡）+ 亮斑（受光凸起），模拟云团内部明暗
    //   2) 每片 sprite：per-blob 灰度变化（部分偏暗作阴影层/部分偏亮作受光层），
    //      多片重叠时明暗差异 → 肉眼可见的层次立体感
    // 关卡级独立开关，默认 0 不影响其他关。kursk 等需要立体云的关开启。
    this.volumeShade = options.volumeShade ?? 0;
    this.shadowEnabled = options.shadowEnabled === true; // 海面投影开关
    this.shadowOpacity = options.shadowOpacity ?? 0.2;   // 影子浓度
    // 云团主体色（[R,G,B] 0-255）。默认 null = 原版灰白带微蓝（海峡阴天云色）；
    // 关卡可传 [r,g,b] 自定义（如巴巴罗萨东线晴天纯白云 [240,242,246]）
    this.cloudColor = Array.isArray(options.cloudColor) ? options.cloudColor : null;

    // 固定云带参数（仅 mode='fixed' 时使用）
    // bandBox 定义一个矩形区域 [minX, maxX, minY, maxY, minZ, maxZ]，云在该区域内均匀铺开
    this.bandBox  = options.bandBox  || [-2000, 2000, 1000, 1300, 3100, -10000]; // [minX..maxX, minY..maxY, minZ..maxZ]
    this.spacing   = options.spacing   ?? 700;               // 每团间距（网格步长，实际位置带随机抖动）

    // 云的块状分布与尺寸多样性（缺省 0/默认 = 原均匀行为，前三关不受影响）：
    //   patchiness > 0：按 2D value-noise 跳过低值区域的云团（0.4 ≈ 约四成区域晴空）
    //   patchScale：噪声特征尺度（米），越大晴空区越宽
    //   sizeBias：尺寸分布指数（<1 偏大云=原行为 0.8；>1 偏小云多、偶有大云团）
    //   maxClusterScale：特大云团放大上限（原行为 3.0）
    this.patchiness = options.patchiness ?? 0;
    this.patchScale = options.patchScale ?? 12000;
    this.sizeBias = options.sizeBias ?? 0.8;
    this.maxClusterScale = options.maxClusterScale ?? 3.0;
    // 纹理观感（缺省 = 原行为）：
    //   texHoles=false：不打内部小孔（真实云无随机孔洞，仅边缘破碎）
    //   yCoherent=true：云团高度按低频空间噪声相干起伏（云系成层起伏而非同平面随机撒布）
    this.texHoles = options.texHoles !== false;
    this.yCoherent = options.yCoherent === true;
    // 团内散布系数（缺省 1 = 原行为）：>1 时云片散布更宽，相邻云团重叠连成大片云系
    this.spreadMul = options.spreadMul ?? 1.0;
    // 距离淡出（缺省 null = 不启用，前三关不受影响）：
    //   [fadeStart, fadeEnd, cullDist] 米。fadeStart~fadeEnd 线性淡出，超过 cullDist 整团隐藏。
    //   解决：远处大 sprite 在雾灭绝阈值附近随视角移动闪动/可见不可见——
    //   sprite 的雾按片元深度计算，数千米宽的广告牌近缘与中心雾量不同，视角一动边缘就闪。
    //   距离淡出让云在到达雾阈值前平滑消隐，同时形成"近清远淡"的空中透视层次。
    this.distFade = options.distFade || null;

    // 额外云带（仅 fixed 模式）：在主云带之外叠加稀薄层次，如高空稀薄大云层
    // 每项 {bandBox, spacing, opacity, minSize, maxSize, blobsPerCluster, sizeBias}
    // sizeBias < 0.8 偏向大云（pow 指数越小 sizeRank 越偏向 1），用于"少量稀薄大云"层次
    this.extraBands = options.extraBands || [];

    // 5 张不同纹理
    this.textures = [];
    for (let i = 0; i < 5; i++) this.textures.push(this._makeCloudTexture(i));
    // 共享材质（alphaTest 降至 0.008 仅剔除完全透明像素，保留 blur 后的低 alpha 羽化带）
    this.material = new THREE.SpriteMaterial({
      map: this.textures[0],
      transparent: true,
      opacity: this.opacity,
      depthWrite: false,
      alphaTest: 0.008,
      fog: true,
    });

    // 影子共享纹理 + 材质（仅 shadowEnabled 时创建，本关独立）
    if (this.shadowEnabled) {
      this._shadowTex = this._makeShadowTexture();
      this._shadowMat = new THREE.SpriteMaterial({
        map: this._shadowTex,
        transparent: true,
        opacity: this.shadowOpacity,
        depthWrite: false,
        fog: true,
      });
    }

    this.clusters = []; // [{ group, blobs:[{sprite,texIdx}], shadow }]
    if (this.mode === 'fixed') {
      this._buildFixedBand();
    } else {
      for (let i = 0; i < this.clusterCount; i++) {
        const cl = this._makeCluster();
        this._placeInitial(cl);
        this.scene.add(cl.group);
        this.clusters.push(cl);
      }
    }

    // 视锥检测复用对象（避免每帧 new）— follow 模式用
    this._frustum = new THREE.Frustum();
    this._projMat = new THREE.Matrix4();
    this._tmpV = new THREE.Vector3();
  }

  /**
   * 固定云带：主云带 + extraBands 额外稀薄层。
   * 主云带用 this.bandBox/this.spacing，extraBands 每项可独立配置 bandBox/spacing/层参数。
   */
  _buildFixedBand() {
    this._buildBand(this.bandBox, this.spacing, {});
    for (const band of this.extraBands) {
      this._buildBand(band.bandBox, band.spacing ?? 700, band);
    }
  }

  /**
   * 通用云带构建：在 bandBox 定义的矩形 3D 区域内铺开云团。
   *   bandBox = [minX, maxX, minY, maxY, minZ, maxZ]
   * 采用网格抖动分布：以 spacing 为网格步长生成规则网格，每格内位置 ±0.4 cell 随机抖动。
   * patchiness > 0 时按 2D value-noise 跳过部分云团，形成块状云系 + 大片晴空（仅显式配置的关卡）。
   * @param layerOpts 透传给 _makeCluster 的层覆盖配置（opacity/minSize/maxSize/blobsPerCluster/sizeBias）
   */
  _buildBand(bandBox, spacing, layerOpts = {}) {
    const [minX, maxX, minY, maxY, minZ, maxZ] = bandBox;
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const rangeZ = maxZ - minZ;

    const step = spacing;
    const nx = Math.max(1, Math.round(rangeX / step));
    const nz = Math.max(1, Math.round(rangeZ / step));
    const cellX = rangeX / nx;
    const cellZ = rangeZ / nz;
    const patch = layerOpts.patchiness ?? this.patchiness;

    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        // 网格中心 + ±0.4 cell 抖动
        const cx = minX + (ix + 0.5) * cellX + (Math.random() - 0.5) * cellX * 0.8;
        const cz = minZ + (iz + 0.5) * cellZ + (Math.random() - 0.5) * cellZ * 0.8;
        // 高度：默认均匀随机（原行为）；yCoherent=true 时按低频空间噪声起伏（云系成层），
        // 每团再叠 ±0.16×rangeY 随机，打破"同一高度一条链"的甲板感
        const cy = minY + (this.yCoherent
          ? rangeY * (0.12 + 0.76 * this._patchNoise(cx + 7917, cz - 3311)) + rangeY * (Math.random() - 0.5) * 0.16
          : Math.random() * rangeY);

        // 块状分布：噪声低于阈值整格跳过（patchiness=0 时全部保留 = 原行为）
        if (patch > 0 && this._patchNoise(cx, cz) < patch) continue;

        const cl = this._makeCluster(layerOpts);
        cl.group.position.set(cx, cy, cz);
        this.scene.add(cl.group);
        if (cl.shadow) {
          cl.shadow.position.set(cx, 0, cz);
        }
        this.clusters.push(cl);
      }
    }
  }

  /** 简易 2D value-noise（无依赖，hash 角点 + 双线性平滑），供块状分布使用 */
  _patchNoise(x, z) {
    const s = this.patchScale;
    const xi = Math.floor(x / s), zi = Math.floor(z / s);
    const xf = x / s - xi, zf = z / s - zi;
    const h = (a, b) => { const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n); };
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    return h(xi, zi) * (1 - u) * (1 - v) + h(xi + 1, zi) * u * (1 - v)
         + h(xi, zi + 1) * (1 - u) * v + h(xi + 1, zi + 1) * u * v;
  }

  /**
   * 程序化生成一张柔和云纹理：多个柔球叠加 + 整体 blur 模糊边缘。
   * 关键改进（消除图块边缘感）：
   *   - 画布提升到 512×512（更高分辨率承载 blur 后的细节）
   *   - 绘制时用 ctx.filter='blur(14px)' 整体高斯模糊，所有柔球边缘自然羽化，
   *     消除"多个圆形柔球叠加后可见的团块边界"
   *   - 延长边缘渐变（0.7→1.0 从 0.18→0），配合 blur 形成无锯齿的柔和过渡
   *   - alphaTest 降至 0.008（仅剔除完全透明像素，保留 blur 后的低 alpha 羽化带）
   */
  _makeCloudTexture(seed) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    // 关键：先清空确保完全透明（不能 fillRect 任何纯色，否则出方块）
    g.clearRect(0, 0, 512, 512);

    // 固定 seed 伪随机，纹理稳定
    let rng = seed * 9301 + 49297;
    const rand = () => { rng = (rng * 9301 + 49297) % 233280; return rng / 233280; };

    // 云团主体色：默认灰白带微蓝（英吉利海峡阴天云色）；关卡可经 cloudColor 选项覆盖为纯白等
    let tint;
    if (this.cloudColor) {
      // 自定义云色：在基色基础上 ±8 随机抖动，保留纹理内部层次（避免纯色平板）
      const [br, bg, bb] = this.cloudColor;
      tint = [
        Math.max(0, Math.min(255, br + Math.floor(rand() * 16 - 8))),
        Math.max(0, Math.min(255, bg + Math.floor(rand() * 16 - 8))),
        Math.max(0, Math.min(255, bb + Math.floor(rand() * 16 - 8))),
      ];
    } else {
      const warm = 215 + Math.floor(rand() * 15);   // 215-229，带灰度
      tint = [warm, warm, warm + 10];          // R=G<warm+10>B，微蓝灰白
    }

    // 整体高斯模糊，让所有柔球边缘自然羽化（12px，略减以保留边缘质感）
    g.filter = 'blur(12px)';

    // 叠加 10-14 个柔球，错位排布成不规则团
    //   约束在画布内：球心≤342 + 半径≤145 + blur12 = 499 < 512，柔球不越界→无画布切割→无方形直边
    //   柔球自然重叠形成不规则边缘（非圆形），配合下方 destination-out 侵蚀制造破碎感
    const balls = 10 + Math.floor(rand() * 5);
    for (let i = 0; i < balls; i++) {
      const cx = 170 + rand() * 172;   // 170-342
      const cy = 175 + rand() * 140;   // 175-315
      const r = 55 + rand() * 90;      // 55-145
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},0.95)`);
      grd.addColorStop(0.5, `rgba(${tint[0]},${tint[1]},${tint[2]},0.5)`);
      // 延长边缘渐变：0.7→1.0 从 0.18→0，配合 blur 形成更宽的羽化带
      grd.addColorStop(0.7, `rgba(${tint[0]},${tint[1]},${tint[2]},0.18)`);
      grd.addColorStop(1, `rgba(${tint[0]},${tint[1]},${tint[2]},0)`); // 边缘严格 0
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
    }

    // 关闭 blur 绘制高光/阴影（避免被模糊导致层次丢失）
    g.filter = 'none';

    // 顶部高光（受太阳照射，上部更亮）— depthContrast>1 时增强
    if (this.depthContrast > 1.0) {
      const hlA = 0.15 * (this.depthContrast - 1.0);
      const hl = g.createLinearGradient(0, 0, 0, 280);
      hl.addColorStop(0, `rgba(255,250,240,${hlA})`);
      hl.addColorStop(1, 'rgba(255,250,240,0)');
      g.fillStyle = hl;
      g.globalCompositeOperation = 'source-atop'; // 只在已有云像素上叠加
      g.fillRect(0, 0, 512, 280);
    }
    // 底部阴影（云底暗，增加体积感）— depthContrast>1 时增强
    const shA = 0.16 + 0.22 * (this.depthContrast - 1.0);
    const sh = g.createLinearGradient(0, 240, 0, 512);
    sh.addColorStop(0, 'rgba(200,210,225,0)');
    sh.addColorStop(1, `rgba(150,160,175,${shA})`);
    g.fillStyle = sh;
    g.globalCompositeOperation = 'source-atop'; // 只在已有云像素上叠加阴影
    g.fillRect(0, 0, 512, 512);
    g.globalCompositeOperation = 'source-over';

    // 体积感内部阴影/高光（volumeShade>0 启用）：local 暗斑+亮斑模拟云团内部厚度变化。
    //   真实云团并非均匀亮度——厚处挡光变暗（云芯阴影），凸起处受光变亮（阳光面）。
    //   在云体内部随机投 3-4 个暗斑（偏下半，云底阴影区）+ 2 个亮斑（偏上半，受光面），
    //   用 source-atop 限制只影响已有云像素，配合 per-blob 灰度变化形成立体层次。
    //   默认 volumeShade=0 跳过此段，不影响其他关。
    if (this.volumeShade > 0) {
      const vs = this.volumeShade;
      g.globalCompositeOperation = 'source-atop';
      // 暗斑（云体内部阴影，模拟厚云挡光）：冷灰色，偏下半部
      const shPatches = 3 + Math.floor(rand() * 2);
      for (let i = 0; i < shPatches; i++) {
        const px = 200 + rand() * 112;     // 200-312（云体水平范围）
        const py = 230 + rand() * 82;      // 230-312（偏下半，云底阴影区）
        const pr = 38 + rand() * 48;       // 38-86
        const a = 0.20 * vs;               // 强度随 volumeShade 线性增强
        const grd = g.createRadialGradient(px, py, 0, px, py, pr);
        grd.addColorStop(0, `rgba(135,145,160,${a})`);
        grd.addColorStop(0.6, `rgba(135,145,160,${a * 0.4})`);
        grd.addColorStop(1, 'rgba(135,145,160,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(px, py, pr, 0, Math.PI * 2);
        g.fill();
      }
      // 亮斑（受光凸起，模拟阳光照亮云顶凸出部）：暖白色，偏上半部
      const hlPatches = 2;
      for (let i = 0; i < hlPatches; i++) {
        const px = 205 + rand() * 102;     // 205-307
        const py = 185 + rand() * 55;      // 185-240（偏上半，受光面）
        const pr = 32 + rand() * 38;       // 32-70
        const a = 0.14 * vs;
        const grd = g.createRadialGradient(px, py, 0, px, py, pr);
        grd.addColorStop(0, `rgba(255,250,242,${a})`);
        grd.addColorStop(1, 'rgba(255,250,242,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(px, py, pr, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    }

    // 边缘破碎：destination-out 随机小圆侵蚀云边缘，制造不规则破碎感（替代平滑圆形蒙版）。
    //   真实云边缘破碎、不规则，非光滑圆形。用随机小圆在边缘环带咬出不规则缺口 + 少量内部小孔。
    //   柔球已约束在画布内（不越界），无需圆形蒙版即可无方形直边；侵蚀只做破碎质感，不做边界裁切。
    g.globalCompositeOperation = 'destination-out';
    g.filter = 'blur(8px)';
    // 边缘环带侵蚀（175-255 半径）：咬出不规则缺口，打破光滑圆形轮廓
    for (let i = 0; i < 32; i++) {
      const ang = rand() * Math.PI * 2;
      const dist = 175 + rand() * 80;
      const ex = 256 + Math.cos(ang) * dist;
      const ey = 256 + Math.sin(ang) * dist;
      const er = 12 + rand() * 28;
      const grd = g.createRadialGradient(ex, ey, 0, ex, ey, er);
      grd.addColorStop(0, 'rgba(0,0,0,0.55)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(ex, ey, er, 0, Math.PI * 2);
      g.fill();
    }
    // 内部小孔（少量）：增加破碎通透感，避免实心团块
    // texHoles=false 时跳过（真实云并无随机孔洞；孔洞在视觉上更像"被咬掉"，违和）
    if (this.texHoles) {
      for (let i = 0; i < 6; i++) {
        const ex = 215 + rand() * 82;
        const ey = 215 + rand() * 82;
        const er = 8 + rand() * 14;
        const grd = g.createRadialGradient(ex, ey, 0, ex, ey, er);
        grd.addColorStop(0, 'rgba(0,0,0,0.35)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(ex, ey, er, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** 程序化生成影子纹理：柔和径向暗斑，用于云团在海面投影 */
  _makeShadowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(20,30,40,0.85)');
    grd.addColorStop(0.5, 'rgba(20,30,40,0.45)');
    grd.addColorStop(0.85, 'rgba(20,30,40,0.10)');
    grd.addColorStop(1, 'rgba(20,30,40,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * 创建一个云团：多个 sprite 错位叠加 + 可选影子 sprite。
   * @param layerOpts 可选层覆盖配置（来自 extraBands 项），未提供字段回退到 this 默认值。
   *   - opacity: 该层整体不透明度
   *   - minSize/maxSize: sprite 尺寸范围
   *   - blobsPerCluster: 每团 sprite 数范围 [min,max]
   *   - sizeBias: pow 指数（<0.8 偏向大云；用于稀薄大云层）
   * 小云更透明：opacityScale = 0.5 + sizeRank*0.5，最小云 opacity 减半，大云保持原样。
   * 解决"小云因 sprite 聚集重叠反而更不透明"的问题。
   */
  _makeCluster(layerOpts = {}) {
    const group = new THREE.Group();
    const blobsPerCluster = layerOpts.blobsPerCluster ?? this.blobsPerCluster;
    const [minB, maxB] = blobsPerCluster;
    const n = minB + Math.floor(Math.random() * (maxB - minB + 1));
    const blobs = [];
    // 云团尺寸等级：pow 指数控制偏向——<1 偏大云（原行为 0.8），>1 偏小云多、偶有大云团
    // pow(0.8) → 约 57% 概率为大云团（sizeRank>0.5）；pow(1.7) → 小云为主、少数特大云
    const sizeBias = layerOpts.sizeBias ?? this.sizeBias;
    const sizeRank = Math.pow(Math.random(), sizeBias);
    const maxCap = layerOpts.maxClusterScale ?? this.maxClusterScale;
    const clusterScale = 1.2 + sizeRank * (maxCap - 1.2);   // 1.2x ~ maxCap（原行为上限 3.0）
    // clusterR 基础值增大（90-210），让云团覆盖范围更广，相邻云团更易重叠连片
    // spreadMul（缺省 1=原行为）：团内散布加宽，云系内相邻云团互相渗透合并成大片
    const spread = layerOpts.spreadMul ?? this.spreadMul;
    const clusterR = (90 + Math.random() * 120) * clusterScale * spread;
    // 影子尺寸随云团等级同步放大
    const shadowScale = clusterScale;
    // 小云更透明：小云团（sizeRank→0）sprite 聚集重叠区域 alpha 累积过多反而更不透明，
    // 用 opacityScale 让小云整体淡下来；大云（sizeRank→1）保持原 opacity 不变。
    const opacity = layerOpts.opacity ?? this.opacity;
    const opacityScale = 0.5 + sizeRank * 0.5;   // 0.5(最小) → 1.0(最大)
    const minSize = layerOpts.minSize ?? this.minSize;
    const maxSize = layerOpts.maxSize ?? this.maxSize;
    for (let i = 0; i < n; i++) {
      const texIdx = Math.floor(Math.random() * this.textures.length);
      const mat = this.material.clone();
      mat.map = this.textures[texIdx];
      // 每片 sprite 独立 opacity 微调（0.75-1.0 倍）× 小云淡度系数，增加云团内部明暗层次
      mat.opacity = opacity * opacityScale * (0.75 + Math.random() * 0.25);      // 体积感 per-blob 灰度变化（volumeShade>0 启用）：部分 blob 偏暗(阴影层)/部分偏亮(受光层)。
      //   mat.color 灰色乘以纹理 → 整片 sprite 变暗/变亮。多片重叠时明暗差异产生层次立体感：
      //   暗片在亮片之后=深度遮挡感；亮片在暗片之前=凸起受光感。
      //   30% 偏暗(0.86-0.92) + 50% 中间调(0.96-1.0) + 20% 偏亮(1.0-1.04)，"少量灰度"不突兀。
      //   默认 volumeShade=0 跳过，mat.color 保持白色(1,1,1)=原行为。
      if (this.volumeShade > 0) {
        const vs = this.volumeShade;
        const roll = Math.random();
        let gray;
        if (roll < 0.30) {
          // 阴影层：偏暗，模拟云团内部/底部遮挡
          gray = 1.0 - (0.10 + Math.random() * 0.06) * vs;   // vs=1 → 0.84-0.90
        } else if (roll < 0.80) {
          // 中间调：轻微偏暗，过渡自然
          gray = 1.0 - (0.02 + Math.random() * 0.04) * vs;   // vs=1 → 0.94-0.98
        } else {
          // 受光层：略亮，模拟顶部阳光面（>1.0 经 ACES 色调映射安全提亮）
          gray = 1.0 + (0.03 + Math.random() * 0.04) * vs;   // vs=1 → 1.03-1.07
        }
        mat.color = new THREE.Color(gray, gray, gray);
      }
      const s = new THREE.Sprite(mat);
      // 每片 sprite 尺寸：在云团尺寸等级基础上 ±0.7 随机变化
      const baseSz = minSize + Math.random() * (maxSize - minSize);
      const sz = baseSz * clusterScale * (0.7 + Math.random() * 0.6);
      // 略扁 + 随机纵横比，避免规则
      const aspect = 0.55 + Math.random() * 0.25;
      s.scale.set(sz, sz * aspect, 1);
      // 在团内错位（xz 偏移，y 小偏移）
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * clusterR;
      s.position.set(
        Math.cos(a) * r,
        (Math.random() - 0.5) * 30,
        Math.sin(a) * r,
      );
      // sprite 随机旋转 + 随机纹理，打破形状重复
      mat.rotation = Math.random() * Math.PI * 2;
      // 渲染顺序：cloud sprite 在 ocean/sky 之后渲染（renderOrder=1），
      // 避免 ocean（transparent+depthWrite:false）后渲染覆盖云底部
      s.renderOrder = 1;
      // 关闭视锥剔除：大 Sprite 中心出视锥时整团被剔除导致"突然消失"
      s.frustumCulled = false;
      group.add(s);
      blobs.push({ sprite: s, texIdx, baseOpacity: mat.opacity });  // baseOpacity 供距离淡出恢复原值
    }
    // 影子 sprite（海面投影，y=0，位置由 update 同步跟随云团 xz）
    let shadow = null;
    if (this.shadowEnabled && this._shadowMat) {
      shadow = new THREE.Sprite(this._shadowMat);
      // 影子尺寸随云团尺寸同步放大，略扁（太阳低仰角投影拉长感）
      const shSz = this.maxSize * 1.15 * shadowScale;
      shadow.scale.set(shSz, shSz * 0.62, 1);
      shadow.renderOrder = 1;     // 在 ocean 之后渲染，正确混合成海面暗斑
      shadow.frustumCulled = false;
      this.scene.add(shadow);
    }
    return { group, blobs, shadow };
  }

  /**
   * 初始放置：前方扇形分布（frontBias 控制）。
   * 默认前向 -Z（飞机初始朝向）；frontBias=0 时全圆均匀（保持原行为），
   * frontBias>0 时集中到前方扇形，让云主要在视野前方生成。
   */
  _placeInitial(cl) {
    const fwdA = Math.PI; // -Z 方向（atan2(0,-1)）
    const halfArc = Math.PI * (1 - this.frontBias * 0.7); // frontBias=1 → ±0.3π 窄扇
    const a = fwdA + (Math.random() * 2 - 1) * halfArc;
    const r = Math.sqrt(Math.random()) * this.fieldR;
    cl.group.position.set(
      Math.sin(a) * r,
      this.minY + Math.random() * (this.maxY - this.minY),
      Math.cos(a) * r,
    );
    if (cl.shadow) {
      cl.shadow.position.set(cl.group.position.x, 0, cl.group.position.z);
    }
  }

  /**
   * 每帧更新：
   *   - mode='follow'：把超出回收半径的云团搬到玩家前方扇形，且目标位置必须避开相机视锥，
   *     这样云在玩家视野外生成，避免"突然刷新出来"的视觉跳变。
   *   - mode='fixed'：云团位置固定，仅同步影子位置（影子已在构造时定位，此处保险刷新一次）。
   * @param playerPos 玩机当前位置
   * @param playerFwd 玩机前向（决定云搬到前方哪个方向，仅 follow 用）
   * @param camera 相机（用于视锥检测，可选；不传则回退到前方扇形放置）
   */
  update(playerPos, playerFwd, camera) {
    // fixed 模式：云位置固定；影子刷新 + 距离淡出（distFade 配置时）
    if (this.mode === 'fixed') {
      const df = this.distFade;
      for (const cl of this.clusters) {
        if (cl.shadow) {
          cl.shadow.position.set(cl.group.position.x, 0, cl.group.position.z);
        }
        // 距离淡出：fadeStart~fadeEnd 线性淡出，超过 cullDist 整团隐藏。
        // 云在到达雾灭绝阈值前平滑消隐 → 远处云不再随视角闪动，同时形成近清远淡层次。
        if (df && playerPos) {
          const dx = cl.group.position.x - playerPos.x;
          const dz = cl.group.position.z - playerPos.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist >= df[2]) {
            if (cl.group.visible) cl.group.visible = false;
            continue;
          }
          if (!cl.group.visible) cl.group.visible = true;
          const fade = dist <= df[0] ? 1 : Math.max(0, 1 - (dist - df[0]) / (df[1] - df[0]));
          for (const b of cl.blobs) {
            b.sprite.material.opacity = b.baseOpacity * fade;
          }
        }
      }
      return;
    }

    // follow 模式：预计算视锥（相机存在时）
    let frustum = null;
    if (camera) {
      this._projMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._projMat);
      frustum = this._frustum;
    }
    for (const cl of this.clusters) {
      const dx = cl.group.position.x - playerPos.x;
      const dz = cl.group.position.z - playerPos.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 > this.recycleR * this.recycleR) {
        this._relocate(cl, playerPos, playerFwd, frustum);
      }
      // 影子跟随云团 xz（投影到 y=0 海面）
      if (cl.shadow) {
        cl.shadow.position.set(cl.group.position.x, 0, cl.group.position.z);
      }
    }
  }

  /** 给云团找一个新的、避开视锥的位置 */
  _relocate(cl, playerPos, playerFwd, frustum) {
    const fwdA = Math.atan2(playerFwd.x, playerFwd.z);
    // 前方扇形宽度由 frontBias 收窄：frontBias=0 时 ±0.45π（原行为），=1 时 ±0.15π（集中前方）
    const arc = 0.9 - this.frontBias * 0.6;
    for (let tries = 0; tries < 8; tries++) {
      const da = (Math.random() - 0.5) * Math.PI * arc;
      const a = fwdA + da;
      const r = this.fieldR * (0.55 + Math.random() * 0.45);
      const ty = this.minY + Math.random() * (this.maxY - this.minY);
      this._tmpV.set(
        playerPos.x + Math.sin(a) * r,
        ty,
        playerPos.z + Math.cos(a) * r,
      );
      // 无相机或目标在视锥外 → 采用
      if (!frustum || !frustum.containsPoint(this._tmpV)) {
        cl.group.position.copy(this._tmpV);
        return;
      }
    }
    // 全部尝试都在视锥内（罕见，如飞机悬停高空俯瞰）：放到正后方远处
    const a = fwdA + Math.PI;
    const r = this.fieldR * 0.9;
    cl.group.position.set(
      playerPos.x + Math.sin(a) * r,
      this.minY + Math.random() * (this.maxY - this.minY),
      playerPos.z + Math.cos(a) * r,
    );
  }

  /** 释放资源（关卡切换时调用） */
  dispose(scene) {
    this.clusters.forEach((cl) => {
      if (scene) scene.remove(cl.group);
      if (cl.shadow && scene) scene.remove(cl.shadow);
      // 每个 sprite 的 material 是共享 material.clone()，需独立释放
      cl.blobs.forEach((b) => b.sprite.material.dispose());
    });
    if (this._shadowMat) this._shadowMat.dispose();
    if (this._shadowTex) this._shadowTex.dispose();
    this.textures.forEach((t) => t.dispose());
    this.material.dispose();
    this.clusters.length = 0;
  }
}
