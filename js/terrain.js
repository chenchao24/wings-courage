import * as THREE from 'three';

/**
 * 地形 v3：fbm 噪声高度 + 顶点着色，按地貌分区。
 *
 * 两种模式：
 *   - barbarossa（默认，COAST_CONFIG=null）：东欧平原缓起伏 + 河流 + 山区 + 耕田
 *   - britain（COAST_CONFIG 存在）：海岸线分区（陆地/过渡带/海域）+ 白崖增益
 *
 * 地貌要素（barbarossa）：
 *   - 缓起伏基础地势（0~9m）
 *   - 远处丘陵山区（30~120m，大尺度噪声 mask，远离原点起飞区）
 *   - 蜿蜒河流（噪声窄带，河床低洼 3~5m，水面蓝灰）
 *   - 大面积耕田（大尺度噪声划分田块：麦黄/深棕休耕地/草地）
 *   - 坡面岩石、山顶岩草
 *
 * Britain 模式（COAST_CONFIG={coastline, cliffHeight, transitionWidth}）：
 *   - 海岸线 z=coastline，玩家在 z>coastline 海上，敌机从 z<coastline 陆地来
 *   - 陆域：_computeLandHeight + 白崖增益（钟形剖面，近海岸最高，内陆深处衰减）
 *   - 过渡带：smoothstep 插值 陆地→海床
 *   - 海域：海床高度（-3），被 Ocean mesh 覆盖
 *
 * 顶点着色无需贴图，无重复感。getTerrainHeight 为解析函数，任意坐标可查。
 */

// ---------- 噪声工具 ----------
function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
// 点到线段的最近距离（用于 kursk 农田按路网距离分布）
function distToSegment(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return Math.hypot(px - x1, pz - z1);
  let t = ((px - x1) * dx + (pz - z1) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

// ---------- 库尔斯克路网骨架（仅用于农田距离分布计算）----------
//   与 kurskRoads.js 控制点严格一致；Catmull-Rom 采样后预计算采样点数组，
//   computeRoadDistance 遍历所有段取最小距离，用于农田沿路网分布。
//   仅 isKurskTheme 时调用，不影响其他关卡。
const KURSK_ROAD_SKELETON = [
  // 公路（主干 G1 + 支线 G2/G3）— G1 两端延伸到 ±20000
  [[3500,20000],[3500,14000],[3200,10000],[3800,6000],[3500,3000],[3300,0],[3700,-3000],[3400,-6000],[3800,-10000],[3500,-14000],[3500,-20000]],
  [[3500,-2500],[0,-2800],[-4000,-2600],[-9000,-3000],[-14000,-2800]],
  [[3800,5000],[8000,5200],[13000,5500],[17000,5800]],
  // 土路（D1-D6）
  [[3400,-6000],[0,-6500],[-4000,-7000],[-7500,-8000]],
  [[3500,2000],[0,2500],[-4500,2200],[-8500,2500]],
  [[3200,10000],[7000,10500],[11000,10000]],
  [[3800,-10000],[7000,-11000],[11000,-12500]],
  [[-4000,-2600],[-4200,-4500],[-4000,-7000]],
  [[8000,5200],[8200,8000],[7800,11000]],
  // 小路（田间径）
  [[-4500,2200],[-5500,3000],[-6500,3500]],
  [[-4000,-7000],[-5000,-7500],[-5500,-8500]],
  [[3300,0],[2000,500],[800,800]],
  [[0,-2800],[-1000,-3500],[-2000,-4000]],
  [[3700,-3000],[5000,-2800],[6500,-3200]],
  [[3800,6000],[4500,6800],[4800,7600]],
  [[-9000,-3000],[-10000,-3800],[-10500,-4600]],
  [[13000,5500],[13500,6300],[13300,7200]],
];

// 路网采样点缓存（懒加载，首次调用时计算）
let _kurskRoadSamples = null;
function getKurskRoadSamples() {
  if (_kurskRoadSamples) return _kurskRoadSamples;
  _kurskRoadSamples = [];
  for (const ctrlPts of KURSK_ROAD_SKELETON) {
    const pts = ctrlPts.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const totalLen = curve.getLength();
    const step = 300;  // 每 300m 采样（精度足够，段数 ~400）
    const n = Math.max(2, Math.ceil(totalLen / step));
    const samples = [];
    for (let i = 0; i <= n; i++) samples.push(curve.getPoint(i / n));
    _kurskRoadSamples.push(samples);
  }
  return _kurskRoadSamples;
}

// 预计算粗粒度距离场（128×128，间距 ~375m），顶点循环中双线性插值查询。
//   直接在 103k 顶点循环中调用 computeRoadDistance（4400 万次 distToSegment）需 4+ 秒，
//   预计算 128×128=16k 点距离场（~700 万次，<1 秒），顶点循环中仅双线性插值（4 次查表），几乎零开销。
//   375m 网格精度对 3500m 过渡带的 smoothstep 足够（误差 < 3%）。
let _kurskDistField = null;
const _DIST_FIELD_N = 128;
const _DIST_FIELD_HALF = 24000;  // 地形半宽 48000/2
function getKurskDistField() {
  if (_kurskDistField) return _kurskDistField;
  const N = _DIST_FIELD_N;
  const half = _DIST_FIELD_HALF;
  _kurskDistField = new Float32Array(N * N);
  const roadSets = getKurskRoadSamples();
  for (let iz = 0; iz < N; iz++) {
    const z = -half + (iz / (N - 1)) * 2 * half;
    for (let ix = 0; ix < N; ix++) {
      const x = -half + (ix / (N - 1)) * 2 * half;
      let minDist = Infinity;
      for (const samples of roadSets) {
        for (let i = 0; i < samples.length - 1; i++) {
          const d = distToSegment(x, z, samples[i].x, samples[i].z, samples[i + 1].x, samples[i + 1].z);
          if (d < minDist) minDist = d;
        }
      }
      _kurskDistField[iz * N + ix] = minDist;
    }
  }
  return _kurskDistField;
}

// 双线性插值查询距离场（顶点循环中调用，O(1)）
function sampleRoadDistance(x, z) {
  const field = getKurskDistField();
  const N = _DIST_FIELD_N;
  const half = _DIST_FIELD_HALF;
  const fx = ((x + half) / (2 * half)) * (N - 1);
  const fz = ((z + half) / (2 * half)) * (N - 1);
  const ix0 = Math.max(0, Math.min(N - 2, Math.floor(fx)));
  const iz0 = Math.max(0, Math.min(N - 2, Math.floor(fz)));
  const tx = fx - ix0;
  const tz = fz - iz0;
  const d00 = field[iz0 * N + ix0];
  const d10 = field[iz0 * N + ix0 + 1];
  const d01 = field[(iz0 + 1) * N + ix0];
  const d11 = field[(iz0 + 1) * N + ix0 + 1];
  const d0 = d00 + (d10 - d00) * tx;
  const d1 = d01 + (d11 - d01) * tx;
  return d0 + (d1 - d0) * tz;
}
function valueNoise2D(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const v00 = hash2(xi, yi, seed), v10 = hash2(xi + 1, yi, seed);
  const v01 = hash2(xi, yi + 1, seed), v11 = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(v00, v10, smooth(xf)), lerp(v01, v11, smooth(xf)), smooth(yf));
}
function fbm(x, y, octaves, persistence, lacunarity, seed) {
  let total = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise2D(x * freq, y * freq, seed + i * 17) * amp;
    max += amp; amp *= persistence; freq *= lacunarity;
  }
  return total / max;
}
// 山脊噪声（用于山的尖锐走势）
function ridge(x, y, seed) {
  return 1 - Math.abs(fbm(x, y, 4, 0.5, 2.0, seed) * 2 - 1);
}

// ---------- GLSL 兼容噪声（与 ocean.js 片元着色器 hash/vnoise/fbm 严格一致）----------
// 用于 coastLineAt(x)：JS 端（terrain 高度/着色）与 GLSL 端（ocean discard）必须算出同一海岸线
function _gFract(x) { return x - Math.floor(x); }
function _gHash(x, y) {
  // 匹配 GLSL: fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)
  return _gFract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
}
function _gMix(a, b, t) { return a + (b - a) * t; }
function _gVnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = _gHash(ix, iy);
  const b = _gHash(ix + 1, iy);
  const c = _gHash(ix, iy + 1);
  const d = _gHash(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return _gMix(_gMix(a, b, ux), _gMix(c, d, ux), uy);
}
function _gFbm(x, y) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 4; i++) { v += a * _gVnoise(x, y); x *= 2; y *= 2; a *= 0.5; }
  return v;
}

const SEED = 20260731;

// ---------- 海岸线配置（Britain 模式；null=barbarossa）----------
let COAST_CONFIG = null;

/**
 * 设置海岸线配置（切换关卡时调用）。
 * cfg = { coastline, cliffHeight, transitionWidth }
 * 传入 null 恢复 barbarossa 模式。切换时清空高度缓存。
 */
export function setCoastConfig(cfg) {
  COAST_CONFIG = cfg;
  _hCache.clear();
}

export function getCoastConfig() {
  return COAST_CONFIG;
}

// ---------- 地形主题（kursk 草原 / null=barbarossa 默认）----------
// kursk：东欧大平原夏季草原，无河流无山区，黄绿色枯黄草甸，暖色地平线
// null（默认）：barbarossa 东欧平原（缓起伏+河流+山区+耕田），行为不变
// britain 模式时此变量必须为 null（britain 走 COAST_CONFIG 海岸分支，陆域深处
//   复用 _computeLandHeight，若 TERRAIN_THEME 非空会污染 britain 内陆地形）
let TERRAIN_THEME = null;

/**
 * 设置地形主题（切换关卡时调用，必须在 terrain.create 之前）。
 * 'kursk' → 大平原草原模式；null → barbarossa 原行为。切换时清空高度缓存 + 路网距离场缓存。
 */
export function setTerrainTheme(theme) {
  TERRAIN_THEME = theme || null;
  _hCache.clear();
  // 清空 kursk 路网距离场缓存（关卡隔离：切换关卡时重建，避免旧缓存污染）
  _kurskDistField = null;
  _kurskRoadSamples = null;
}

export function getTerrainTheme() {
  return TERRAIN_THEME;
}

/**
 * 弯曲海岸线 z 值（Britain 模式专用）。
 * 用三层正弦波在 x 方向产生海湾和海岬（±1900m 起伏），
 * JS 端（terrain 高度/着色）与 ocean.js GLSL 端（discard）共用同一公式。
 * 正弦波不用 hash 噪声——避免 JS double 与 GLSL highp float 在 fract(sin*large) 上的精度不匹配。
 * 返回值：该 x 位置的海岸线 z（z > 返回值 = 海，z < 返回值 = 陆）。
 * COAST_CONFIG 为 null（barbarossa）时返回 0，不参与。
 */
export function coastLineAt(x) {
  if (!COAST_CONFIG) return 0;
  return COAST_CONFIG.coastline
    + Math.sin(x * 0.0006) * 1200          // 大海湾（波长 ~10km）
    + Math.sin(x * 0.0017 + 2.1) * 500      // 中海岬（波长 ~3.7km）
    + Math.sin(x * 0.0041 + 4.3) * 200;     // 小海湾（波长 ~1.5km）
}

/** 海床高度（海域返回值，被 Ocean mesh 覆盖）
 *  深 -30 而非 -3：海面(y=0)与海床间距需足够大，否则远处深度缓冲精度不足
 *  会导致 ocean 与 terrain 海床 Z-fighting（闪烁雪花）。30 单位间距在 far=20k 下安全。 */
const SEA_BED = -30;

/**
 * 陆地基础高度（barbarossa 原版 fbm 噪声，Britain 陆域也复用此函数）。
 * Britain 模式在此基础上叠加白崖增益（见 getTerrainHeight 分发）。
 */
function _computeLandHeight(x, z) {
  const isKursk = TERRAIN_THEME === 'kursk';

  // 基础缓起伏：kursk 恢复 barbarossa 原值（9/3.2），保留原版缓起伏地貌感（不推平成平原）
  const base = fbm(x * 0.0016, z * 0.0016, 3, 0.5, 2.0, SEED) * 9 - 1.5;
  const mid = fbm(x * 0.007, z * 0.007, 2, 0.5, 2.0, SEED + 99) * 3.2;
  const detail = fbm(x * 0.03, z * 0.03, 2, 0.4, 2.0, SEED + 199) * 0.7;

  // 山区：kursk 减少山丘分布（更稀更矮，远处偶有低矮丘陵作天际线起伏）；
  //       barbarossa 原版（幅值 110m，mask 0.52-0.68）
  let mountain = 0;
  const dist = Math.hypot(x, z);
  const distMask = smoothstep(1200, 2200, dist); // 1.2km 外才开始有山
  const mountainField = fbm(x * 0.0006, z * 0.0006, 2, 0.5, 2.0, SEED + 311);
  const ridgeN = ridge(x * 0.0022, z * 0.0022, SEED + 411);
  if (isKursk) {
    // kursk：低矮丘陵稀疏分布，大平原为主（用户：丘陵减半、更多平原台地）
    //   单层丘陵（移除原次级层）：mask 0.60-0.78 高阈值→丘陵只占 ~25% 区域，大片平原；
    //   幅值 48m（原 60m），ridge 指数 1.4 山体宽厚；distMask 1.2km 外才起丘陵
    const mountainMask = smoothstep(0.60, 0.78, mountainField) * distMask;
    mountain = Math.pow(ridgeN, 1.4) * mountainMask * 48;
  } else {
    const mountainMask = smoothstep(0.52, 0.68, mountainField) * distMask;
    mountain = Math.pow(ridgeN, 1.6) * mountainMask * 110;
  }

  // 河流：kursk 无河流（去掉水域）；barbarossa 保留；britain 本就 river=0
  let river = 0;
  if (!COAST_CONFIG && !isKursk) {
    const riverVal = fbm(x * 0.0009, z * 0.0009, 2, 0.5, 2.0, SEED + 777);
    const riverBand = 1 - Math.min(1, Math.abs(riverVal - 0.5) / 0.016); // 更窄
    river = riverBand * riverBand * 5; // 河床深 5m
  }

  return base + mid + detail + mountain - river;
}

/**
 * 世界坐标地形高度（解析）。分发 barbarossa / britain 模式。
 */
export function getTerrainHeight(x, z) {
  if (!COAST_CONFIG) return _computeLandHeight(x, z);

  // Britain 直立断崖海岸模式（短海滩→陡断崖→崖顶台地→内陆丘陵）
  // 海岸线随 x 弯曲（coastLineAt），产生海湾和海岬
  const { cliffHeight, beachWidth, cliffWidth } = COAST_CONFIG;
  const coastX = coastLineAt(x);               // 该 x 位置的海岸线 z
  const beachHalf = beachWidth / 2;
  const cliffToe = coastX - beachHalf;          // 断崖脚（靠海一侧，海滩尽头）
  const cliffCrest = cliffToe - cliffWidth;    // 断崖顶（靠陆一侧，台地开始）

  // 悬崖高度起伏：x 方向 fbm 噪声，60-90m（低频平滑，避免锯齿状崖顶线）
  const cliffH = cliffHeight + (_gFbm(x * 0.001, 0) - 0.5) * 30;

  // 1. 海域：海床（被 Ocean mesh 覆盖）
  if (z > coastX + beachHalf) {
    return SEA_BED;
  }

  // 2. 海滩：从沙滩(2m) 渐变到海床(-3m)（短海滩）
  if (z > cliffToe) {
    const t = smoothstep(cliffToe, coastX + beachHalf, z);
    return lerp(2, SEA_BED, t);
  }

  // 3. 直立断崖：从崖顶(cliffH) 陡降到海滩(2m)（窄=陡，近似直立）
  if (z > cliffCrest) {
    const t = smoothstep(cliffCrest, cliffToe, z);
    return lerp(cliffH, 2, t);
  }

  // 4. 崖顶台地 + 内陆丘陵：近崖顶平坦台地(cliffH)，2.5km 后衰减为内陆丘陵(land)
  const land = _computeLandHeight(x, z);
  const distInland = cliffCrest - z;  // 离崖顶向内陆距离（正值）
  const plateauFade = smoothstep(0, 2500, distInland);
  return cliffH * (1 - plateauFade) + land * (0.3 + 0.7 * plateauFade);
}

/** 河流掩码（0=非河，1=河心），供着色用 */
function riverMask(x, z) {
  const riverVal = fbm(x * 0.0009, z * 0.0009, 2, 0.5, 2.0, SEED + 777);
  return 1 - Math.min(1, Math.abs(riverVal - 0.5) / 0.022);
}

// 高度缓存
const _hCache = new Map();
export function getHeightCached(x, z) {
  const key = ((x | 0) << 16) ^ (z | 0);
  if (_hCache.has(key)) return _hCache.get(key);
  const h = getTerrainHeight(x, z);
  if (_hCache.size > 4000) _hCache.clear();
  _hCache.set(key, h);
  return h;
}

export class Terrain {
  constructor(size = 18000, segments = 320) {
    this.size = size;
    this.segments = segments;
    this.mesh = null;
  }

  create() {
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    // 东欧地貌色调（barbarossa）
    const isKurskTheme = TERRAIN_THEME === 'kursk';
    // barbarossa 草甸色（cGrass/cGrassLt 仅 barbarossa 用；kursk 走独立 5 色草原色板）
    const cGrass     = new THREE.Color(0x4f6b34); // barbarossa 深草
    const cGrassLt   = new THREE.Color(0x7a9650); // barbarossa 浅草
    const cWheat     = new THREE.Color(0x8a8048); // 麦田（barbarossa 耕田）
    const cFallow    = new THREE.Color(0x4a3522); // 深棕休耕地（barbarossa）
    const cWater     = new THREE.Color(0x3a5a6a); // 河水蓝灰（barbarossa）
    const cWaterEdge = new THREE.Color(0x5a7060); // 河岸湿地（barbarossa）
    const cRock      = new THREE.Color(0x5a544c); // 岩石
    const cForest    = new THREE.Color(0x2f4a26); // 森林深绿（指示林区）
    // kursk 草原色板（7月库尔斯克：麦收期，橄榄黄/枯黄主调，色差小）
    //   去掉深绿色块（用户反馈），统一偏暖黄亮色调，色差小制造视觉层次
    const cKurskDeep   = isKurskTheme ? new THREE.Color(0x8a9038) : null;  // 暗黄绿（原深绿去掉，改黄绿系最暗值）
    const cKurskGrass  = isKurskTheme ? new THREE.Color(0x9aa842) : null;  // 橄榄草绿（主体草原，偏亮）
    const cKurskYellow = isKurskTheme ? new THREE.Color(0xb0a848) : null;  // 黄绿（过渡色/生长期麦）
    const cKurskLight  = isKurskTheme ? new THREE.Color(0xc0b058) : null;  // 橄榄黄（高处干燥/麦茬）
    const cKurskDry    = isKurskTheme ? new THREE.Color(0xd0bc60) : null;  // 枯黄（干旱/已收割，主农田色）
    // kursk 田埂色：亮灰白色（~2.2m 宽，随机 75% 田块有），模拟田间裸露泥土分界
    //   田间裸露泥土在航拍中呈浅色细线，需要在黄绿/枯黄作物中清晰可辨
    const cFieldRidge  = isKurskTheme ? new THREE.Color(0xd8d4cc) : null;  // 亮灰白田埂
    // kursk 5 色高斯混合参数（循环外预计算，避免 103k 顶点重复创建数组）
    //   sigma=0.24（加宽）：相邻色（中心间距 0.2）在边界处重叠更充分，过渡带更宽更柔和
    //     σ=0.15 时相邻色边界权重比 ~0.41（窄过渡，偏生硬）；σ=0.24 时 ~0.75（宽过渡，自然）
    const kurskCenters = isKurskTheme ? [0.10, 0.30, 0.50, 0.70, 0.90] : null;
    const kurskCols    = isKurskTheme ? [cKurskDeep, cKurskGrass, cKurskYellow, cKurskLight, cKurskDry] : null;
    const kurskInv2S2  = isKurskTheme ? 1 / (2 * 0.24 * 0.24) : 0;  // 1/(2σ²)，sigma=0.24 加宽过渡带
    // 边缘渐隐地平线雾色：britain 灰蓝 / kursk 暖橙（= sky bottomColor 0xe8c8a0，天/地/雾同色消除底盘穿帮）/ barbarossa 浅蓝
    const cHorizon   = COAST_CONFIG
      ? new THREE.Color(0x9aa8b8)   // Britain 灰蓝雾色
      : (isKurskTheme ? new THREE.Color(0xe8c8a0) : new THREE.Color(0xc8e0f4));

    // Britain 海岸专用色
    const cSeaBed    = new THREE.Color(0x3a4858); // 海床深色（被海水覆盖）
    const cBeach     = new THREE.Color(0x807a72); // 海滩灰黑砾石滩（白崖海岸卵石滩）
    const cCliff     = new THREE.Color(0xe8e4d8); // 白垩岩（白崖）
    const cCliffTop  = new THREE.Color(0x7a9650); // 崖顶草地

    const halfSize = this.size / 2;
    const hasCoast = !!COAST_CONFIG;
    const coast = COAST_CONFIG;
    const halfT = coast ? coast.transitionWidth / 2 : 0;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = getTerrainHeight(x, z);
      pos.setY(i, h);

      // 坡度（中心差分）
      const eps = 4.0;
      const sl = getTerrainHeight(x - eps, z), sr = getTerrainHeight(x + eps, z);
      const sd = getTerrainHeight(x, z - eps), su = getTerrainHeight(x, z + eps);
      const slope = Math.hypot(sr - sl, su - sd) / (2 * eps);

      let color;
      let useBritainCoast = false;

      // Britain 海岸变量（供后续 cliff 平滑混合用）
      let coastCliffCrest = 0, coastCliffH = 0;
      if (hasCoast) {
        const cx = coastLineAt(x);
        const beachHalf = coast.beachWidth / 2;
        const cliffToe = cx - beachHalf;
        coastCliffCrest = cliffToe - coast.cliffWidth;
        // 悬崖高度（与 getTerrainHeight 一致的噪声，60-90m 起伏）
        coastCliffH = coast.cliffHeight + (_gFbm(x * 0.001, 0) - 0.5) * 30;

        if (z > cx + beachHalf) {
          // 海域：海床深色（被 Ocean 覆盖）
          color = cSeaBed.clone();
          useBritainCoast = true;
        } else if (h < 4) {
          // 海滩：灰黑砾石滩
          color = cBeach.clone();
          useBritainCoast = true;
        }
        // 断崖立面走原版着色（岩石/草地），再由后续 cliff 平滑混合渐变到白色
      }

      if (!useBritainCoast) {
        // 原版陆地着色（barbarossa 全图 + Britain 陆域深处 + kursk 草原）
        // britain/kursk 模式无河流，river 强制 0（kursk 去掉水域）
        const river = (COAST_CONFIG || isKurskTheme) ? 0 : riverMask(x, z);
        const field = fbm(x * 0.0011, z * 0.0011, 2, 0.5, 2.0, SEED + 500);
        const patch = fbm(x * 0.018, z * 0.018, 3, 0.5, 2.0, SEED + 622);
        const fine = fbm(x * 0.06, z * 0.06, 2, 0.4, 2.0, SEED + 733);
        const grassVar = patch * 0.65 + fine * 0.35;
        const forestField = fbm(x * 0.0009, z * 0.0009, 2, 0.5, 2.0, SEED + 888);

        if (isKurskTheme) {
          // ===== kursk 农田区块着色（航拍视角：分割田块 + 田埂边界）=====
          //   农田沿路网分布（近路=农田，远路=草原），总占比 ~30%。
          //   田块规整网格（路附近因路分割有异形，远处规整方格）。
          //   农田色以枯黄/黄绿为主（去掉深色休耕），大部分颜色类似稍有色差。
          if (h > 45) {
            // 山丘顶部岩石（kursk 低矮丘陵偶有裸岩）
            color = cRock.clone().lerp(cKurskGrass, Math.max(0, (70 - h) / 25) * 0.4);
          } else {
            // ===== 农田沿路网分布（总占比 ~30%）=====
            //   路网骨架与 kurskRoads.js 一致，computeRoadDistance 取最近道路距离。
            //   800m 内 farmW=1（高强度农田），3500m 外 farmW=0（草原），中间过渡。
            //   叠加大尺度噪声调制（0.4-1.0），避免路附近全是农田（自然变化）。
            //   路网总长 ~124km，每侧 3500m 缓冲 → 面积 ~868km²，占 2304km² 的 ~38%，
            //   叠加噪声调制（平均 0.7）后实际 ~26-30%。
            const roadDist = sampleRoadDistance(x, z);
            const farmW = smoothstep(3500, 800, roadDist);  // 800m=1, 3500m=0
            const farmlandField = fbm(x * 0.0004, z * 0.0004, 2, 0.5, 2.0, SEED + 900);
            const farmNoise = smoothstep(0.30, 0.70, farmlandField);
            const finalFarmW = farmW * (0.4 + farmNoise * 0.6);

            // 域扭曲网格：长方形田块（非正方形），路附近扭曲大（路分割异形），远处规整
            //   用户：避免纯正方形，多用长方形/不规则四边形
            //   blockScaleX ≠ blockScaleZ → 长方形田块（x方向 ~454m × z方向 ~263m，长宽比 1.7:1）
            //   warpAmount：路附近 0.50（异形），远处 0.15（规整）
            const blockScaleX = 0.0022;  // x方向 ~454m
            const blockScaleZ = 0.0038;  // z方向 ~263m
            const w1 = fbm(x * 0.0012, z * 0.0012, 2, 0.5, 2.0, SEED + 600);
            const w2 = fbm(x * 0.0012 + 50, z * 0.0012 + 50, 2, 0.5, 2.0, SEED + 601);
            const warpAmount = 0.15 + finalFarmW * 0.35;
            const bx = x * blockScaleX + (w1 - 0.5) * warpAmount;
            const bz = z * blockScaleZ + (w2 - 0.5) * warpAmount;
            const bxi = Math.floor(bx), bzi = Math.floor(bz);
            const bxf = bx - bxi, bzf = bz - bzi;
            const blockType = hash2(bxi, bzi, SEED + 800);

            // 农田作物色（7 月麦收期：枯黄为主，黄绿次之，色差小）
            //   参考图：大部分田地颜色类似（枯黄/橄榄黄），稍有色差制造视觉层次
            let farmCrop;
            if (blockType < 0.50) farmCrop = cKurskDry;         // 已收割麦茬（枯黄，主色 50%）
            else if (blockType < 0.82) farmCrop = cKurskYellow; // 生长期麦（黄绿，次色 32%）
            else farmCrop = cKurskLight;                         // 橄榄黄（麦茬层次，18%）

            // 草原色（自然草地：橄榄草绿为主，少量暗绿低洼，偏黄野草）
            let grassCrop;
            if (blockType < 0.55) grassCrop = cKurskGrass;       // 橄榄草绿（主体草原 55%）
            else if (blockType < 0.80) grassCrop = cKurskYellow; // 偏黄野草（过渡 25%）
            else grassCrop = cKurskDeep;                          // 低洼湿草甸暗绿（少量 20%）

            // 农田/草原混合（finalFarmW 边界柔和过渡，无阶跃）
            const crop = farmCrop.clone().lerp(grassCrop, 1 - finalFarmW);
            // 块内微扰（作物/草地内部不均匀，打破纯色平板 — 减小到 ±9% 让色差更小）
            const cropCol = crop.clone().lerp(cKurskLight, (grassVar - 0.5) * 0.14);
            // 田埂：亮灰白色，~2.2m 宽，随机 75% 田块有（田间裸露泥土分界）
            //   田埂为浅色细线，在黄绿/枯黄作物中要清晰可见
            const edgeDist = Math.min(bxf, 1 - bxf, bzf, 1 - bzf);
            const edgeMask = 1 - smoothstep(0.0, 0.010, edgeDist);
            const hasRidge = hash2(bxi, bzi, SEED + 801) < 0.75;
            if (hasRidge) {
              cropCol.lerp(cFieldRidge, edgeMask * (0.30 + finalFarmW * 0.25));  // 加强可见度（0.30-0.55）
            }
            // 高度影响：高处偏枯黄（干燥），丘陵过渡到岩石
            if (h > 8) cropCol.lerp(cKurskDry, smoothstep(8, 20, h) * 0.20);
            cropCol.lerp(cRock, smoothstep(14, 45, h) * 0.4);
            color = cropCol;
          }
        } else {
          // ===== barbarossa 原版着色（河流 + 山区 + 耕田）=====
          if (river > 0.55) {
            color = cWater.clone().lerp(cWaterEdge, (river - 0.55) < 0.2 ? 0.5 : 0);
          } else if (h > 45) {
            color = cRock.clone().lerp(cGrass, Math.max(0, (70 - h) / 25) * 0.4);
          } else if (h > 14) {
            color = cGrass.clone().lerp(cGrassLt, grassVar * 0.4 + 0.2);
            color.lerp(cRock, smoothstep(14, 45, h) * 0.45);
          } else {
            color = cGrass.clone().lerp(cGrassLt, grassVar * 0.6 + 0.2);
            // barbarossa 耕田：麦黄 + 深棕休耕地
            const wWheat = smoothstep(0.52, 0.70, field);
            color.lerp(cWheat, wWheat * 0.6);
            const wFallow = 1 - smoothstep(0.30, 0.46, field);
            color.lerp(cFallow, wFallow * 0.5);
          }

          if (river > 0.15 && river <= 0.55) {
            color.lerp(cWaterEdge, (river - 0.15) / 0.4 * 0.7);
          }
        }
        // 坡面岩石 + 林区暗化（barbarossa 用；kursk 无森林，跳过 cForest 暗化避免深绿色块）
        color.lerp(cRock, Math.min(0.6, slope * 0.45));
        if (!isKurskTheme && forestField > 0.6 && h < 14) color.lerp(cForest, 0.18);
      }

      // 断崖立面着色已移至 onBeforeCompile 片元着色器（per-fragment 像素级精度，无网格分辨率依赖）
      // vertex color 无法解决窄断崖(80m)在粗网格(80m顶点)上的锯齿色块问题
      // shader 按世界坐标 per-fragment 判定断崖区域，像素级精确着色

      // 边缘渐隐：靠近地形方形边界时颜色 lerp 到地平线雾色，视觉上融入天空
      const distC = Math.max(Math.abs(x), Math.abs(z));
      const edge = COAST_CONFIG ? 0 : smoothstep(halfSize * 0.72, halfSize, distC);
      color.lerp(cHorizon, edge);

      colors[i * 3]     = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0.0,
      flatShading: false,
    });

    // Britain 模式：片元级悬崖/海滩/崖顶判定
    // 解决顶点着色受网格分辨率限制（断崖 80m 宽 ≈ 顶点间距 80m）导致的黑白块、锯齿感
    // 顶点级着色在断崖区域只有 0-1 个顶点采样到，色块边界阶跃；片元级按世界坐标 vWorldPos.xz
    // 逐像素精确判定每个像素所属区域（海域/海滩/断崖立面/崖顶台地），像素级精度无网格依赖
    if (COAST_CONFIG) {
      const cliffUniforms = {
        uCoastline:   { value: COAST_CONFIG.coastline },
        uBeachWidth:   { value: COAST_CONFIG.beachWidth },
        uCliffWidth:   { value: COAST_CONFIG.cliffWidth },
        uCliffHeight:  { value: COAST_CONFIG.cliffHeight },
        uCliffColor:   { value: new THREE.Color(0xe8e4d8) },  // 白垩岩
        uBeachColor:   { value: new THREE.Color(0x807a72) },  // 灰黑砾石滩
        uCliffTop:     { value: new THREE.Color(0x7a9650) }, // 崖顶草地
      };
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, cliffUniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `
            #include <common>
            uniform float uCoastline, uBeachWidth, uCliffWidth, uCliffHeight;
            uniform vec3 uCliffColor, uBeachColor, uCliffTop;
            varying vec3 vWorldPos;
            // 弯曲海岸线（与 terrain.js coastLineAt 严格一致：三层正弦波，JS double 与 GLSL highp 在 sin 上无精度差异）
            float coastLineAtF(float x) {
              return uCoastline
                + sin(x * 0.0006) * 1200.0
                + sin(x * 0.0017 + 2.1) * 500.0
                + sin(x * 0.0041 + 4.3) * 200.0;
            }
          `)
          .replace('#include <color_fragment>', `
            #include <color_fragment>
            // ===== 片元级悬崖/海滩/崖顶判定（smoothstep 权重混合，无硬边界，抗锯齿）=====
            float cx = coastLineAtF(vWorldPos.x);
            float beachHalf = uBeachWidth * 0.5;
            float cliffToe = cx - beachHalf;          // 海滩尽头（靠海一侧）
            float cliffCrest = cliffToe - uCliffWidth; // 崖顶（靠陆一侧，台地开始）
            // 各向异性 blur：基于 vWorldPos.z 的过渡带在海岸线斜度大时（等高线接近 x 方向），
            // 垂直等高线方向投影 = blur * cos(α) → 趋近 0，过渡带"消失"导致白色↔草地交界锯齿明显。
            // 用 normFactor = sqrt(1 + slope²) 归一化，使垂直等高线方向过渡恒定 38m，
            // 斜度大时 z 方向 blur 自动放大（最大 ~98m），消除斜度大处的锯齿。
            float slope = cos(vWorldPos.x * 0.0006) * 0.72
                        + cos(vWorldPos.x * 0.0017 + 2.1) * 0.85
                        + cos(vWorldPos.x * 0.0041 + 4.3) * 0.82;
            float normFactor = sqrt(1.0 + slope * slope);
            float blur = 38.0 * normFactor;  // 垂直等高线方向恒定 38m 过渡

            // 基础色 = 顶点着色（内陆/崖顶草地/岩石）
            vec3 col = diffuseColor.rgb;

            // 1. 崖顶 220m 渐变到草地色（内陆→崖顶方向，草地增强）
            float wTopGrass = smoothstep(cliffCrest - 220.0, cliffCrest - 20.0, vWorldPos.z);  // 1=接近崖顶
            col = mix(col, uCliffTop, wTopGrass * 0.5);

            // 2. 断崖立面：cliffCrest < z < cliffToe 区域白色，两侧 blur 过渡到草地/海滩
            //    wCliff 在断崖中部=1，向崖顶/海滩两侧 blur 距离衰减到 0（无硬边界）
            float wCliff = smoothstep(cliffCrest - blur, cliffCrest + blur, vWorldPos.z)
                         * (1.0 - smoothstep(cliffToe - blur, cliffToe + blur, vWorldPos.z));
            float t = smoothstep(cliffCrest, cliffToe, vWorldPos.z);  // 纵向归一化 0=崖顶, 1=崖脚
            float whiteAmount = 1.0 - abs(t - 0.5) * 0.45;  // 崖顶/崖脚稍暗，中部最白
            float n = (fract(sin(vWorldPos.x * 0.31 + vWorldPos.z * 0.23) * 43758.5453) - 0.5) * 0.08;
            vec3 cliffCol = uCliffColor * (whiteAmount + n);
            col = mix(col, cliffCol, wCliff);

            // 3. 海滩：cliffToe < z < cx + beachHalf 区域灰黑，两侧 blur 过渡到断崖/海域
            //    wBeach 在海滩中部=1，向断崖/海域两侧 blur 距离衰减到 0
            float wBeach = smoothstep(cliffToe - blur, cliffToe + blur, vWorldPos.z)
                         * (1.0 - smoothstep(cx + beachHalf - blur, cx + beachHalf + blur, vWorldPos.z));
            col = mix(col, uBeachColor, wBeach);

            diffuseColor.rgb = col;
          `);
      };
    } else if (isKurskTheme) {
      // Kursk 模式：片元级草地颗粒感（高频噪声调制亮度，不受网格分辨率限制）
      // 顶点色在 56m 顶点间距上插值，远处颜色平滑模糊；片元级噪声每像素独立计算，
      // 叠加多层高频亮度变化（7m 草丛斑块 + 1.7m 草茎 + 0.5m 细碎噪点），模拟真实草地质感
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `
            #include <common>
            varying vec3 vWorldPos;
            // 草原颗粒感噪声（高频，片元级，不受网格分辨率限制）
            float kurHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float kurVnoise(vec2 p) {
              vec2 i = floor(p); vec2 f = fract(p);
              float a = kurHash(i);
              float b = kurHash(i + vec2(1.0, 0.0));
              float c = kurHash(i + vec2(0.0, 1.0));
              float d = kurHash(i + vec2(1.0, 1.0));
              vec2 u = f * f * (3.0 - 2.0 * f);
              return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
            }
            float kurFbm(vec2 p) {
              float v = 0.0; float a = 0.5;
              for (int i = 0; i < 3; i++) { v += a * kurVnoise(p); p *= 2.0; a *= 0.5; }
              return v;
            }
          `)
          .replace('#include <color_fragment>', `
            #include <color_fragment>
            // 草地颗粒感：4 层高频噪声，模拟真实草地质感
            //   中频(0.12≈8m)草丛斑块 + 中高频(0.4≈2.5m)草簇 + 高频(1.0≈1m)草茎 + 散点(3.5≈0.3m)细碎草籽/碎石
            float g1 = kurFbm(vWorldPos.xz * 0.12);
            float g2 = kurVnoise(vWorldPos.xz * 0.4);
            float g3 = kurVnoise(vWorldPos.xz * 1.0);
            float g4 = kurHash(floor(vWorldPos.xz * 3.5));
            float grain = g1 * 0.40 + g2 * 0.28 + g3 * 0.22 + g4 * 0.10;
            // 亮度调制：更宽振幅（0.76-1.20），增强颗粒对比，远处不再"糊"成一片
            diffuseColor.rgb *= (0.76 + grain * 0.44);
            // 色彩偏移：颗粒亮处偏黄（干燥草尖），暗处偏绿（湿润草茎），打破纯亮度颗粒的单调
            float tint = g1 - 0.5;
            vec3 dryTint = vec3(1.10, 1.03, 0.82);   // 偏黄（干燥草尖/碎石）
            vec3 wetTint = vec3(0.82, 1.06, 0.92);   // 偏绿（湿润草茎）
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * dryTint, max(0.0, tint) * 0.45);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * wetTint, max(0.0, -tint) * 0.45);
          `);
      };
    }

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    return this.mesh;
  }

  getHeight(x, z) { return getHeightCached(x, z); }

  /** 是否为林区（供建筑模块避开/聚集）*/
  isForest(x, z) {
    return fbm(x * 0.0009, z * 0.0009, 2, 0.5, 2.0, SEED + 888) > 0.6;
  }

  /**
   * 是否为陆地（供 Buildings 过滤海域用）。
   * barbarossa（无 COAST_CONFIG）：全图陆地，返回 true。
   * Britain：z < coastLineAt(x) - 100 为陆地（海岸线随 x 弯曲）。
   */
  isLand(x, z) {
    if (!COAST_CONFIG) return true;
    return z < coastLineAt(x) - 100;
  }

  getNormal(x, z) {
    const eps = 1.5;
    const hl = this.getHeight(x - eps, z), hr = this.getHeight(x + eps, z);
    const hd = this.getHeight(x, z - eps), hu = this.getHeight(x, z + eps);
    const dx = (hr - hl) / (2 * eps), dz = (hu - hd) / (2 * eps);
    return new THREE.Vector3(-dx, 1, -dz).normalize();
  }

  /** 释放资源（关卡切换时调用） */
  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    _hCache.clear();
  }
}
