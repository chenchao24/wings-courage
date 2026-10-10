import * as THREE from 'three';

/**
 * 库尔斯克路网（1943 年真实交通网络还原）
 *
 * 资料来源：库尔斯克会战战史 + 中俄罗斯高地地理文献
 *   - 库尔斯克城是铁路/公路枢纽，交通线向突出部外围辐射
 *   - 唯一铺砌主干道：奥廖尔—库尔斯克—别尔哥罗德（南北纵贯）
 *   - 大量乡间土路穿梭于麦田、村庄间
 *   - 黑土（chernozem）地貌，干燥时灰土色扬尘，雨后泥泞
 *   - 起伏农田草原，溪谷处有小树林和村庄
 *
 * 三级路网（颜色写实灰土色系，与草原黄绿地形融合）：
 *   - 公路 highway：暖灰土 0x756c60，宽 9m——南北主干 + 东西支线
 *   - 土路 dirt   ：黄褐土 0x645234，宽 5m——弯曲乡间路，连接村庄
 *   - 小路 trail  ：暗黄褐 0x544830，宽 2.5m——田野小径
 *
 * 实现：沿控制点 Catmull-Rom 样条细分，每 20m 采样地形高度贴地生成带状 mesh，
 *   顶点色随机微扰（±15%）模拟路面碾压痕迹/尘土堆积颗粒感，
 *   polygonOffset 防 z-fighting，MeshLambert 受光照与地形明暗一致。
 *
 * 关卡隔离：独立模块，仅 kursk 关创建，不影响第 1/2 关。
 */
export class KurskRoads {
  constructor(terrain, options = {}) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'kursk-roads';
    this._build();
  }

  _build() {
    // ===== 颜色（灰白系，1943 年干燥土路航拍色）=====
    //   航拍视角下，干燥土路（碾压压实）呈灰白色调，与黄绿农田形成自然对比。
    //   R≈G>B 微暖灰白，避免偏黄；无纹理但有颗粒感（顶点色微扰）。
    const COL_HIGHWAY = 0xd0ccc6;  // 公路：亮灰白（大路，碾压多最亮）
    const COL_DIRT    = 0xb8b4ae;  // 土路：中灰白（乡间路）
    const COL_TRAIL   = 0xa09890;  // 小路：暗灰白（田间径，少碾压偏暗）

    // ===== 主干公路 G1（南北纵贯，偏东 x≈3500，模拟奥廖尔-库尔斯克-别尔哥罗德主干）=====
    //   库尔斯克突出部唯一铺砌主干道，略带弯曲绕行地形起伏
    //   两端延伸到地图边缘（±20000）
    this._buildRoad([
      [3500, 20000], [3500, 14000], [3200, 10000], [3800, 6000], [3500, 3000],
      [3300, 0], [3700, -3000], [3400, -6000], [3800, -10000], [3500, -14000], [3500, -20000],
    ], 18, COL_HIGHWAY);

    // ===== 支线公路（东西向，从主干分出连接远方）=====
    // G2：主干 z≈-2500 向西
    this._buildRoad([
      [3500, -2500], [0, -2800], [-4000, -2600], [-9000, -3000], [-14000, -2800],
    ], 14, COL_HIGHWAY);
    // G3：主干 z≈5000 向东
    this._buildRoad([
      [3800, 5000], [8000, 5200], [13000, 5500], [17000, 5800],
    ], 14, COL_HIGHWAY);

    // ===== 土路（乡间路，弯曲，连接村庄——真实库尔斯克遍布的乡间土路）=====
    // D1：主干 z≈-6000 向西南蜿蜒
    this._buildRoad([
      [3400, -6000], [0, -6500], [-4000, -7000], [-7500, -8000],
    ], 5, COL_DIRT);
    // D2：主干 z≈2000 向西北
    this._buildRoad([
      [3500, 2000], [0, 2500], [-4500, 2200], [-8500, 2500],
    ], 5, COL_DIRT);
    // D3：主干 z≈10000 向东
    this._buildRoad([
      [3200, 10000], [7000, 10500], [11000, 10000],
    ], 5, COL_DIRT);
    // D4：主干 z≈-10000 向东南
    this._buildRoad([
      [3800, -10000], [7000, -11000], [11000, -12500],
    ], 5, COL_DIRT);
    // D5：横向乡间路，连接 G2 与 D1（村庄间的联络路）
    this._buildRoad([
      [-4000, -2600], [-4200, -4500], [-4000, -7000],
    ], 4, COL_DIRT);
    // D6：从 G3 中段向北
    this._buildRoad([
      [8000, 5200], [8200, 8000], [7800, 11000],
    ], 4, COL_DIRT);

    // ===== 小路（田野小径，短而弯，少碾压的草地踩径）=====
    this._buildRoad([[-4500, 2200], [-5500, 3000], [-6500, 3500]], 2.5, COL_TRAIL);
    this._buildRoad([[-4000, -7000], [-5000, -7500], [-5500, -8500]], 2.5, COL_TRAIL);
    this._buildRoad([[3300, 0], [2000, 500], [800, 800]], 2.5, COL_TRAIL);
    this._buildRoad([[0, -2800], [-1000, -3500], [-2000, -4000]], 2.5, COL_TRAIL);
    this._buildRoad([[3700, -3000], [5000, -2800], [6500, -3200]], 2.5, COL_TRAIL);
    this._buildRoad([[3800, 6000], [4500, 6800], [4800, 7600]], 2.5, COL_TRAIL);
    this._buildRoad([[-9000, -3000], [-10000, -3800], [-10500, -4600]], 2.5, COL_TRAIL);
    this._buildRoad([[13000, 5500], [13500, 6300], [13300, 7200]], 2.5, COL_TRAIL);
  }

  /**
   * 构建一条道路：沿控制点 Catmull-Rom 样条细分，贴地生成带状 mesh。
   *   - 4 顶点横截面：左外（路肩外缘）/ 左内（路面左缘）/ 右内（路面右缘）/ 右外（路肩外缘）
   *   - 路面宽度 = width；路肩 3-5m 浅色衔接带（比路面亮的灰白），外缘 alpha 虚化
   *   - 砂石质感：片元级多频率噪声（2m/0.5m/0.12m 颗粒），路面粗糙不光滑
   *   - 边缘虚化：路肩外缘 alpha 渐变 + 噪声扰动（不规则虚化边界，非硬直边）
   *   - MeshLambert 漫反射不反光，polygonOffset 防 z-fighting
   */
  _buildRoad(controlPoints, width, color) {
    const pts = controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const totalLen = curve.getLength();
    // 采样步长 8m（原 20m 太大，地形起伏会导致道路穿入地形）
    //   8m 步长下地形高度变化 <1m，配合每顶点独立采样地形高度，道路完全贴合地形
    const step = 8;
    const n = Math.max(2, Math.ceil(totalLen / step));
    const samples = [];
    for (let i = 0; i <= n; i++) samples.push(curve.getPoint(i / n));

    const baseColor = new THREE.Color(color);
    // 路肩色：浅色衔接（路色 lerp 浅灰褐色 25%，模拟路边松散尘土/草土混合带）
    //   参考图：路肩为浅灰褐色，比路面略亮但不突兀，边缘柔和融入地形
    const lightCol = new THREE.Color(0xdedacf);
    const shoulderColor = baseColor.clone().lerp(lightCol, 0.30);

    const hw = width / 2;
    // 路肩宽度 3-5m（路两侧3-5米浅色衔接）
    const shoulderW = Math.max(3, Math.min(5, hw * 0.4 + 1));
    // 扩散带宽度 5m（用户要求：路两侧增加2条路面色扩散带，每边5m，透明度0.6，边缘虚化）
    //   模拟真实土路两侧车辆碾压/风蚀的尘土扩散区，航拍中路两侧有比路肩更宽的浅色带
    const extraW = 5;
    // 总半宽 = 路面半宽 + 路肩宽 + 扩散带宽
    const totalHalf = hw + shoulderW + extraW;
    // roadSide 归一化（0=左外外, 0.5=路心, 1=右外外）
    //   a=路面半宽占比, b=路肩宽占比, c=扩散带宽占比, a+b+c=0.5
    const a = hw / (2 * totalHalf);
    const b = shoulderW / (2 * totalHalf);
    const c = extraW / (2 * totalHalf);
    // shader 用：路面边缘和路肩外缘的 edge01 值（edge01=0 路心, =1 外外缘）
    const pavementEdge = 2 * a;        // = hw / totalHalf
    const shoulderEdge = 2 * (a + b);  // = (hw + shoulderW) / totalHalf

    const positions = [];
    const colors = [];
    const roadSides = [];
    const indices = [];

    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      // 中心点地形高度（用于计算横向偏移方向，不直接用于顶点Y）
      const h = this.terrain.getHeight(p.x, p.z);

      let dx, dz;
      if (i === 0) { dx = samples[1].x - p.x; dz = samples[1].z - p.z; }
      else if (i === samples.length - 1) { dx = p.x - samples[i-1].x; dz = p.z - samples[i-1].z; }
      else { dx = samples[i+1].x - samples[i-1].x; dz = samples[i+1].z - samples[i-1].z; }
      const len = Math.hypot(dx, dz) || 1;
      const tx = -dz / len;  // 横向单位向量
      const tz = dx / len;

      // 每个横向顶点独立采样地形高度 + 0.6 偏移
      //   路总宽达 28m（公路18m+路肩5m+扩散带5m），横向地形起伏会导致道路穿入地形
      //   每顶点独立采样确保道路mesh完全贴合地形，不穿入不悬空
      const yOff = 0.6;
      const y0 = this.terrain.getHeight(p.x - tx*totalHalf,      p.z - tz*totalHalf)      + yOff;
      const y1 = this.terrain.getHeight(p.x - tx*(hw+shoulderW), p.z - tz*(hw+shoulderW)) + yOff;
      const y2 = this.terrain.getHeight(p.x - tx*hw,             p.z - tz*hw)             + yOff;
      const y3 = this.terrain.getHeight(p.x + tx*hw,             p.z + tz*hw)             + yOff;
      const y4 = this.terrain.getHeight(p.x + tx*(hw+shoulderW), p.z + tz*(hw+shoulderW)) + yOff;
      const y5 = this.terrain.getHeight(p.x + tx*totalHalf,      p.z + tz*totalHalf)      + yOff;

      // 6 顶点：左外外 / 左路肩外缘 / 左路面缘 / 右路面缘 / 右路肩外缘 / 右外外
      positions.push(p.x - tx*totalHalf,      y0, p.z - tz*totalHalf);       // 0 左外外
      positions.push(p.x - tx*(hw+shoulderW), y1, p.z - tz*(hw+shoulderW));  // 1 左路肩外缘
      positions.push(p.x - tx*hw,             y2, p.z - tz*hw);              // 2 左路面缘
      positions.push(p.x + tx*hw,             y3, p.z + tz*hw);              // 3 右路面缘
      positions.push(p.x + tx*(hw+shoulderW), y4, p.z + tz*(hw+shoulderW));  // 4 右路肩外缘
      positions.push(p.x + tx*totalHalf,      y5, p.z + tz*totalHalf);       // 5 右外外

      // roadSide 归一化横向坐标（0=左外外, 0.5=路心, 1=右外外）
      //   c=扩散带占比, b=路肩占比, a=路面半宽占比
      //   左外外=0, 左路肩外缘=c, 左路面缘=c+b, 右路面缘=1-(c+b), 右路肩外缘=1-c, 右外外=1
      roadSides.push(0.0, c, c+b, 1-(c+b), 1-c, 1.0);

      // 顶点色：路面/扩散带用路面色，路肩用浅色衔接色
      //   扩散带用路面色（用户要求"和路一个颜色"），路肩用浅色衔接
      const v = 0.88 + Math.random() * 0.24;   // 路面 ±12%
      const sv = 0.86 + Math.random() * 0.28;  // 路肩 ±14%
      const ev = 0.88 + Math.random() * 0.24;  // 扩散带独立扰动
      colors.push(
        baseColor.r * ev,     baseColor.g * ev,     baseColor.b * ev,      // 0 左外外（扩散带=路面色）
        shoulderColor.r * sv, shoulderColor.g * sv, shoulderColor.b * sv,  // 1 左路肩外缘（浅色衔接）
        baseColor.r * v,      baseColor.g * v,      baseColor.b * v,       // 2 左路面缘（路面色）
        baseColor.r * v,      baseColor.g * v,      baseColor.b * v,       // 3 右路面缘（路面色）
        shoulderColor.r * sv, shoulderColor.g * sv, shoulderColor.b * sv,  // 4 右路肩外缘（浅色衔接）
        baseColor.r * ev,     baseColor.g * ev,     baseColor.b * ev,      // 5 右外外（扩散带=路面色）
      );
    }

    // 三角形索引（每段 6 顶点，5 矩形 10 三角形）
    //   矩形：左扩散带 / 左路肩 / 路面 / 右路肩 / 右扩散带
    for (let i = 0; i < samples.length - 1; i++) {
      const a0=i*6, a1=i*6+1, a2=i*6+2, a3=i*6+3, a4=i*6+4, a5=i*6+5;
      const b0=(i+1)*6, b1=(i+1)*6+1, b2=(i+1)*6+2, b3=(i+1)*6+3, b4=(i+1)*6+4, b5=(i+1)*6+5;
      indices.push(a0,a1,b1); indices.push(a0,b1,b0);  // 左扩散带
      indices.push(a1,a2,b2); indices.push(a1,b2,b1);  // 左路肩
      indices.push(a2,a3,b3); indices.push(a2,b3,b2);  // 路面
      indices.push(a3,a4,b4); indices.push(a3,b4,b3);  // 右路肩
      indices.push(a4,a5,b5); indices.push(a4,b5,b4);  // 右扩散带
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('roadSide', new THREE.Float32BufferAttribute(roadSides, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    // MeshStandardMaterial(roughness=1.0, metalness=0)：完全哑光漫反射，绝对不反光
    //   用户明确要求"路应该是不反光的"，MeshLambert 虽无镜面反射但与地形 Standard 材质光照计算不一致，
    //   用 Standard + roughness=1 确保与地形同光照模型，100% 粗糙=完全不反光
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,            // 路肩外缘 alpha 虚化
      depthWrite: true,             // 写深度，避免道路交叉点混合错误
      roughness: 1.0,               // 完全粗糙，无任何光泽
      metalness: 0.0,               // 非金属（土路）
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uPavementEdge = { value: pavementEdge };
      shader.uniforms.uShoulderEdge = { value: shoulderEdge };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float roadSide;\nvarying float vRoadSide;\nvarying vec3 vWorldPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoadSide = roadSide;\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `
          #include <common>
          uniform float uPavementEdge;
          uniform float uShoulderEdge;
          varying float vRoadSide;
          varying vec3 vWorldPos;
          float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vnoise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p);
            float a = hash21(i), b = hash21(i+vec2(1,0)), c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
            vec2 u = f*f*(3.0-2.0*f);
            return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
          }
          float fbm2(vec2 p) {
            float v = 0.0; float a = 0.5;
            for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.0; a *= 0.5; }
            return v;
          }
        `)
        .replace('#include <color_fragment>', `
          #include <color_fragment>
          float edge01 = abs(vRoadSide - 0.5) * 2.0;  // 0=路心, 1=外外缘

          // ===== 砂石颗粒感：4 层频率噪声叠加 =====
          float n1 = vnoise(vWorldPos.xz * 0.25);
          float n2 = vnoise(vWorldPos.xz * 1.0);
          float n3 = vnoise(vWorldPos.xz * 4.0);
          float n4 = vnoise(vWorldPos.xz * 16.0);
          float grain = (n1*0.28 + n2*0.30 + n3*0.26 + n4*0.16 - 0.5) * 0.45;
          diffuseColor.rgb *= (1.0 + grain);
          // 路肩/扩散带额外颗粒（松散尘土更不均匀）
          float offPavement = smoothstep(uPavementEdge*0.9, uShoulderEdge, edge01);
          float sGrain = (vnoise(vWorldPos.xz * 2.2) - 0.5) * 0.22 * offPavement;
          diffuseColor.rgb *= (1.0 + sGrain);

          // ===== 3 区域 alpha（路面/路肩/扩散带）=====
          //   路面区(edge01<pavementEdge): alpha=1.0 不透明
          //   路肩区(pavementEdge<edge01<shoulderEdge): alpha 1.0→0.70 半透明衔接
          //   扩散带区(shoulderEdge<edge01<1.0): alpha 0.60→0.0 用户要求透明度0.6+边缘虚化
          float aPavement = 1.0;
          float aShoulder = mix(1.0, 0.70, smoothstep(uPavementEdge, uShoulderEdge, edge01));
          float aExtra = 0.60 * (1.0 - smoothstep(uShoulderEdge, 1.0, edge01));
          // 区域权重（smoothstep 软过渡，避免区域间硬边界）
          float wExtra = smoothstep(uShoulderEdge*0.97, uShoulderEdge*1.03, edge01);
          float wPavement = 1.0 - smoothstep(uPavementEdge*0.97, uPavementEdge*1.03, edge01);
          float wShoulder = clamp(1.0 - wExtra - wPavement, 0.0, 1.0);
          float alpha = wPavement*aPavement + wShoulder*aShoulder + wExtra*aExtra;
          // 扩散带外缘噪声扰动（虚化边界更自然，非硬直边）
          float edgeN = fbm2(vWorldPos.xz * 0.035);
          alpha *= (1.0 - smoothstep(0.88, 1.05, edge01 + (edgeN - 0.5) * 0.28));
          diffuseColor.a *= alpha;
          if (diffuseColor.a < 0.02) discard;
        `);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 0.5;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  dispose(scene) {
    if (scene) scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
