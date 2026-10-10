import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneGltfScene } from 'three/addons/utils/SkeletonUtils.js';
import { VaporTrail } from './VaporTrail.js';

// 世界坐标轴常量（俯仰绕世界 X 轴，保证筋斗完整一圈）
const _WORLD_X = new THREE.Vector3(1, 0, 0);

// glTF 模型缓存：url → gltf（原始模板，永不修改场景图）
// 首次 load 时缓存，后续实例用 SkeletonUtils.clone() 克隆，省去重复网络/解析开销
const _gltfCache = new Map();

// 无螺旋桨动画轨道的敌机（yak1/yak3）桨叶固定转速（rad/s）
// 300 rad/s ≈ 47.7 圈/s，286.5°/帧；3 片桨叶间距 120°，表观旋转 46.5°/帧向前(≈7.75 圈/s)
// 避开 125.66 rad/s(120°/帧)频闪冻结点；配合低透明度呈现高速模糊盘
const PROP_SPIN = 300;

// ---------- 损伤效果共享纹理（模块级，所有实例共用）----------
let _dmgSmokeTex = null;
let _dmgFireTex = null;

// ---------- 螺旋桨模糊盘共享纹理（模块级，黑桨身 + 黄桨尖径向渐变）----------
let _propBlurTex = null;
function _getPropBlurTex() {
  if (_propBlurTex) return _propBlurTex;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  // 桨身到桨轴：黑色；桨尖外部：黄色
  grad.addColorStop(0.00, 'rgba(10,10,10,0)');      // 桨毂中心：透明（露出 3D 桨毂）
  grad.addColorStop(0.12, 'rgba(10,10,10,0)');      // 桨毂区域：透明
  grad.addColorStop(0.18, 'rgba(10,10,10,0.85)');   // 桨叶根部：快速变黑
  grad.addColorStop(0.72, 'rgba(15,15,15,0.7)');    // 桨身：深黑半透明
  grad.addColorStop(0.80, 'rgba(180,150,25,0.6)');  // 桨尖：黄黑过渡
  grad.addColorStop(0.90, 'rgba(200,165,20,0.5)');  // 桨尖外缘：黄色
  grad.addColorStop(1.00, 'rgba(200,165,20,0)');    // 最外缘：渐隐
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _propBlurTex = new THREE.CanvasTexture(canvas);
  return _propBlurTex;
}

// ---------- 螺旋桨模糊盘 FW190 专用纹理（纯黑模糊边缘）----------
let _propBlurTexFw = null;
function _getPropBlurTexFw() {
  if (_propBlurTexFw) return _propBlurTexFw;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  // FW190 专用：桨毂透明 → 黑色桨身 → 边缘模糊渐隐（无白环，整体更透明）
  grad.addColorStop(0.00, 'rgba(10,10,10,0)');        // 桨毂中心：透明
  grad.addColorStop(0.12, 'rgba(10,10,10,0)');        // 桨毂区域：透明
  grad.addColorStop(0.18, 'rgba(15,15,15,0.55)');     // 黑色桨身开始（降低透明度）
  grad.addColorStop(0.60, 'rgba(15,15,15,0.45)');     // 黑色桨身
  grad.addColorStop(0.80, 'rgba(15,15,15,0.25)');     // 边缘模糊渐隐开始
  grad.addColorStop(0.92, 'rgba(15,15,15,0.08)');     // 边缘模糊渐隐
  grad.addColorStop(1.00, 'rgba(15,15,15,0)');        // 最外缘：完全透明
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _propBlurTexFw = new THREE.CanvasTexture(canvas);
  return _propBlurTexFw;
}

/**
 * 生成偏转纺锤形桨叶几何（程序化螺旋桨用）。
 * 形状特征：
 *   - 沿 +Y 延伸（y=0 根部 → y=length 叶尖），几何原点在桨毂
 *   - 弦宽（X 方向）沿 Y 呈纺锤形变化：根部窄 → 40% 处最宽 → 叶尖收尖
 *   - 厚度（Z 方向）随弦宽按比例缩放（叶尖薄）
 *   - 扭转：绕 Y 轴从根部高迎角渐变到叶尖低迎角（真实桨距变化）
 *
 * @param {number} length 桨叶长度（=桨叶半径，body frame 单位）
 * @param {number} maxChord 最大弦宽（中段最宽处，body frame 单位）
 * @param {number} twistDeg 扭转角（度，根部迎角 - 叶尖迎角）
 * @returns {THREE.BufferGeometry}
 */
function _makeSpindleBladeGeometry(length, maxChord, twistDeg) {
  // 沿叶片长度的截面数（越多越平滑）
  const segments = 12;
  // 梯形桨叶：根部窄 → 叶尖宽（叶尖比根部宽 40%），线性递增
  // 根部 chord = maxChord * 0.60，叶尖 chord = maxChord * 1.00（叶尖比根部宽 40%）
  // 叶尖最后两段微收，形成钝化圆弧头（非锐角）
  const rootChord = 0.60;   // 根部弦宽比例
  const tipChord = 1.00;    // 叶尖弦宽比例（= maxChord）
  const chordRatio = [];
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    // 线性插值，最后 2 段微收钝化
    let r = rootChord + (tipChord - rootChord) * t;
    if (i >= segments - 2) {
      // 叶尖钝化：最后 2 段轻微收窄
      const dip = (i - (segments - 3)) / 3;
      r *= (1.0 - 0.08 * dip);
    }
    chordRatio.push(r);
  }
  // 厚度比例：根部厚 → 叶尖薄（梯形桨叶叶尖虽宽但薄）
  const thickRatio = [0.85, 0.82, 0.78, 0.74, 0.70, 0.64, 0.58, 0.50, 0.42, 0.32, 0.22, 0.14];
  const maxThick = maxChord * 0.16;  // 最大厚度 = 弦宽的 16%
  const twistRad = THREE.MathUtils.degToRad(twistDeg);
  // 根部基础迎角（安装角），让整个桨叶有一定倾角
  const basePitchRad = THREE.MathUtils.degToRad(20);

  const verts = [];
  const indices = [];

  for (let s = 0; s <= segments; s++) {
    const t = s / segments;  // 0=根部, 1=叶尖
    const y = t * length;
    const ci = Math.min(s, segments - 1);
    const chord = maxChord * chordRatio[ci];
    const thick = maxThick * thickRatio[ci];
    // 扭转角：根部 basePitch + twist*0，叶尖 basePitch + twist*(-1)（叶尖迎角小）
    const pitch = basePitchRad - twistRad * t;
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);

    // 截面 4 个角点（弦中心在 y 轴上，前后缘对称）
    // 弦方向 = X，厚度方向 = Z；扭转后绕 Y 轴旋转
    const halfC = chord / 2;
    const halfT = thick / 2;
    // 4 个角点（前缘上、前缘下、后缘下、后缘上）——"前缘"= +X，"后缘"= -X
    const corners = [
      [ halfC,  halfT],  // 前缘上
      [ halfC, -halfT],  // 前缘下
      [-halfC, -halfT],  // 后缘下
      [-halfC,  halfT],  // 后缘上
    ];
    for (const [cx, cz] of corners) {
      // 绕 Y 轴扭转：(x, z) → (x*cos - z*sin, x*sin + z*cos)
      const rx = cx * cosP - cz * sinP;
      const rz = cx * sinP + cz * cosP;
      verts.push(rx, y, rz);
    }
  }

  // 构建三角面索引（每段连接相邻截面的 4 角点）
  for (let s = 0; s < segments; s++) {
    const base = s * 4;
    const next = (s + 1) * 4;
    // 侧面：前缘、下侧、后缘、上侧
    indices.push(base + 0, next + 0, next + 1);  // 前缘三角 1
    indices.push(base + 0, next + 1, base + 1);  // 前缘三角 2
    indices.push(base + 1, next + 1, next + 2);  // 下侧三角 1
    indices.push(base + 1, next + 2, base + 2);  // 下侧三角 2
    indices.push(base + 2, next + 2, next + 3);  // 后缘三角 1
    indices.push(base + 2, next + 3, base + 3);  // 后缘三角 2
    indices.push(base + 3, next + 3, next + 0);  // 上侧三角 1
    indices.push(base + 3, next + 0, base + 0);  // 上侧三角 2
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
function _getDmgSmokeTex() {
  if (_dmgSmokeTex) return _dmgSmokeTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(90,90,90,0.9)');
  g.addColorStop(0.4, 'rgba(60,60,60,0.5)');
  g.addColorStop(1, 'rgba(40,40,40,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  _dmgSmokeTex = new THREE.CanvasTexture(c);
  return _dmgSmokeTex;
}
function _getDmgFireTex() {
  if (_dmgFireTex) return _dmgFireTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,210,1)');
  g.addColorStop(0.25, 'rgba(255,180,40,0.9)');
  g.addColorStop(0.6, 'rgba(220,50,20,0.5)');
  g.addColorStop(1, 'rgba(120,20,10,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  _dmgFireTex = new THREE.CanvasTexture(c);
  return _dmgFireTex;
}
// 碎片共享几何体（多种形状模拟不同零件：小块/大块/长条/扁平蒙皮）
const _debrisGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);         // 小碎块
const _debrisGeoLarge = new THREE.BoxGeometry(1.2, 1.2, 1.2);    // 大碎块
const _debrisGeoLong = new THREE.BoxGeometry(2.5, 0.3, 0.3);     // 长条（机翼/机身碎片）
const _debrisGeoFlat = new THREE.BoxGeometry(1.8, 0.15, 1.2);    // 扁平（蒙皮碎片）
const _debrisGeos = [_debrisGeo, _debrisGeoLarge, _debrisGeoLong, _debrisGeoFlat];
// 临时四元数（坠毁姿态旋转复用，避免每帧 new）
const _tmpQ = new THREE.Quaternion();
const _debrisColors = [0x3a3a3a, 0x4a4030, 0x2a2a2a, 0x5a4a3a, 0x403830, 0x1a1a1a, 0x252020];
// 机炮击落大碎片几何体（比爆炸碎片大，模拟 20mm 撕裂蒙皮/结构件）
const _largeDebrisGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
const _largeDebrisColors = [0x1a1a1a, 0x2a2a2a, 0x3a3030, 0x403830, 0x4a4030, 0x252020];

// 动画分类关键词（用于自动识别"螺旋桨"，并屏蔽起落架/座舱盖）
// 螺旋桨节点关键词：英文/中文/俄文拉丁转写(vint)/俄文西里尔字母(винт)
// Sketchfab 上的苏系模型（I-153/I-16 等）用 "VINT"/"винт" 命名螺旋桨节点
const PROP_KEYWORDS = ['prop', '螺旋桨', 'airscrew', 'propeller', 'vint', 'винт'];
const GEAR_KEYWORDS = ['gear', 'landing', '起落架', 'wheel', '轮'];
const CANOPY_KEYWORDS = ['canopy', 'cover', '座舱', 'hood', 'glass', 'cockpit'];

/** 判断节点名是否为螺旋桨（大小写不敏感，匹配 PROP_KEYWORDS 任一关键词）*/
function isPropName(name) {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return PROP_KEYWORDS.some((k) => n.includes(k));
}

function classifyClip(name) {
  const n = String(name).toLowerCase();
  if (GEAR_KEYWORDS.some(k => n.includes(k)) || CANOPY_KEYWORDS.some(k => n.includes(k))) return 'skip';
  if (PROP_KEYWORDS.some(k => n.includes(k))) return 'prop';
  return 'idle';
}

/**
 * 飞机：负责加载模型、归一化、动画控制（仅螺旋桨）与街机式飞行物理。
 *
 * 层级：
 *   root        —— 飞行组（位置/姿态，世界空间）
 *     modelYaw  —— 朝向校准（仅 yaw 偏移，让机头对齐 -Z）
 *       model   —— gltf 场景（缩放 + 居中），纯视觉
 *     muzzles[] —— 枪口标记（挂在 root 上，body frame 固定偏移）
 */
export class Aircraft {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer; // KTX2Loader.detectSupport 需要

    this.isPlayer = false;  // 玩家飞机标记（GameRuntime 创建后置 true；Weapons 据此区分枪口火光参数）

    this.root = new THREE.Group();
    this.modelYaw = new THREE.Group();
    this.root.add(this.modelYaw);
    scene.add(this.root);

    this.model = null;
    this.mixer = null;
    this.actions = [];      // [{ clip, action, kind }]
    this.propAction = null;

    // 飞行状态
    this.throttle = 0.35;
    this.speed = 0;         // 当前前飞速度（单位/秒）
    this.maxSpeed = 165;    // 约 594 km/h
    this.minSpeed = 8;
    this.cruiseSpeed = 90;  // 巡航速度：无油门输入时速度向此漂移

    // 校准
    this.yawOffset = 0;     // 度
    this.pitchOffset = 0;   // 度（机头上抬为正）
    this.rollOffset = 0;    // 度（右滚为正）
    this.autoOrient = true; // true=自动按螺旋桨质心校准偏航；false=使用手动 yawOffset
    this.baseScale = 1;
    this.userScale = 3.6;   // 默认放大 3.6 倍
    this.centerOffset = null; // [cx,cy,cz] body frame 世界单位（缩放后），微调几何中心对齐原点
    this.propMultiplier = 60;
    this._hideGear = false;  // 模型加载后是否隐藏起落架 mesh（仅特定机型设 true）
    this._hideGearNodes = null;  // 显式起落架节点名列表（优先于 GEAR_KEYWORDS 关键词匹配）
    this._glassNodes = null;     // 显式座舱玻璃节点名列表（强制 transparent+opacity 让玩家能看出去）
    this._propNodes = null;       // 显式螺旋桨节点名列表（加入 propBranches.blur 让 propMode='blur' 时显示）
    this._propBlurOnly = false;   // 纯模糊盘：模型把左右桨几何合并到单节点，仅半透明不旋转（He 111）
    this.multiProp = false;       // 多螺旋桨独立旋转：true=每个 propNode 自成一组（双发左右桨各自旋转）；false=所有桨叶归为 1 组绕同一桨毂旋转（单发默认）
    this._propSpinSpeed = PROP_SPIN; // 桨叶转速覆盖（默认 PROP_SPIN=300；可被机型配置覆盖）
    this._propOpacity = 0.22;        // 桨叶透明度覆盖（默认 0.22；可被机型配置覆盖）
    this._propBlurDisc = false;      // 动态模糊盘开关（默认 false；喷火 true）
    this._propBlurDiscs = [];        // 模糊盘 mesh 列表（挂在 tilt 下，不随 spin 旋转）
    this._propBlurStrength = 0.35;   // 模糊盘强度（0=关，1=最大）
    this._propAxisTilt = { x: 0, y: 0 };     // 旋转轴倾斜修正（度）
    this._propPivotOffset = { x: 0, y: 0, z: 0 }; // 桨毂圆心偏移（模型局部空间）
    this._propRigs = [];             // prop pivot Group 列表（visibility 联动用）

    // 程序化螺旋桨（模型无独立桨叶节点，桨叶几何与机身合并时使用）
    // Fw 190 A-4：Object_6 大网格含静态桨叶，无法 reparent，改在桨毂位置程序化生成
    // 模糊盘 + 旋转桨叶，静态桨叶被盘视觉吸收（停转时露出 = 自然停止状态）
    this._propProcedural = false;        // 程序化桨开关（默认 false；Fw 190 等无桨叶节点机型 true）
    this._propHubOffset = [0, 0, 0];     // 桨毂位置（body frame，缩放校准后；机头=-Z）
    this._propRadius = 1;                // 桨叶半径（body frame 单位）
    this._propBladeCount = 3;            // 桨叶数量
    this._propBlurStyle = 'default';     // 模糊盘纹理样式：'default'(暗黄尖) | 'fw'(亮黄环，FW190 专用)
    // 桨叶形状参数（纺锤形 + 扭转）
    this._propBladeChord = 0.55;         // 最大弦宽（叶片中段最宽处，body frame 单位）
    this._propBladeTwist = 35;           // 扭转角（度，根部迎角 - 叶尖迎角）

    // 静态桨叶透明切割（模型桨叶与机身合并，无法隐藏节点时使用）
    // null=不切割；playerConfig.propCut 配置开启。在 shader 中 discard 桨叶区域顶点，
    // 不修改几何，完全可逆。仅 Fw 190 等合并桨叶机型使用。
    this._propCut = null;                // { zMin, zMax, radius }

    // 座舱内部光源（隐藏玻璃后座舱内漆黑，加 PointLight 照亮仪表贴图）
    // null=不创建；playerConfig.cockpitLight 配置开启，仅 _glassNodes 机型生效
    this._cockpitLight = null;           // { x, y, z, color, intensity, distance, decay }
    this._cockpitLightObj = null;        // PointLight 实例引用（dispose 用）

    // 血量（空战用）
    this.maxHp = 100;
    this.hp = 100;

    // 螺旋桨多状态（飞行模拟模型常把 still/slow/blur/anim 多套叶片叠在一起）
    this.propBranches = { anim: [], blur: [], slow: [] };
    this.propMode = 'blur'; // 有动画轨道的模型由 propAction 旋转；yak1/yak3/He 111 无轨道，由 _propPivots 固定旋转
    this._propPivots = [];   // 螺旋桨 pivot 列表：单发机型 1 个（桨毂中心），multiProp=true 双发机型 N 个（各自桨毂）

    // 机枪枪口（root 本地空间，body frame；机头 = -Z）。按 userScale=3.6 缩放后的机体尺寸定位。
    // 机翼 2 挺 + 机头 2 挺（机头机枪口径较小，与主有机炮区分）
    this.muzzleOffsets = [
      new THREE.Vector3( 7.80, -0.95, -6.15),  // 右机翼
      new THREE.Vector3(-7.85, -0.95, -6.25),  // 左机翼
      new THREE.Vector3( 0.60,  1.35, -6.45),  // 右机头
      new THREE.Vector3(-0.60,  1.35, -6.45),  // 左机头
    ];
    // 枪口独立方向（body frame 单位向量，与 muzzleOffsets 一一对应）。
    // null = 所有枪口共用 getAimDirection()（机头方向 + 座舱上抬）。
    // 轰炸机自卫炮塔需独立方向（背炮塔朝后上、腹炮塔朝后下、侧后枪朝侧后）。
    this.muzzleDirs = null;
    this.muzzleHelpers = [];

    // 瞄准上抬比例（座舱视角下准星上抬，避免被机头遮挡）。
    // 由 main.js setCamMode 设置：座舱模式 0.12，其它模式 0。
    // 同时被 updateCrosshair(准星投影) 与 getAimDirection(子弹方向) 读取，
    // 保证准星指向与子弹落点一致。
    this.aimLift = 0;

    // ---------- 街机飞行物理参数 ----------
    // 角速度（弧度/秒），每帧由 input 趋近目标值，松杆平滑回零
    this.angVel = new THREE.Vector3(); // x=pitch, y=yaw, z=roll
    // 各轴最大角速度与响应速度（越大越灵敏、回中越快）
    this.pitchMax = 1.3;   this.pitchResp = 6.0;
    this.rollMax  = 2.6;   this.rollResp  = 7.0;
    this.yawMax   = 0.7;   this.yawResp   = 4.0;
    // G 力（仅俯仰方向估算，供 HUD 显示）
    this.gForce = 1.0;
    // 翼尖拉烟（高 G 机动时翼尖涡流凝结，由配置 noVaporTrail 禁用）
    this.vaporTrail = null;
    this.noVaporTrail = false;
    // 重力 / 升力（街机版：高速平飞净零，低速下沉）
    this.gravity = 4.0;       // 场景单位/s²
    this.liftK = 0.026;       // lift = speed * liftK，maxSpeed 时 ≈ 4.3 略大于重力
    this.diveAccel = 5;       // 俯冲额外加速度（街机特色：机头朝下加速、朝上减速；0=关闭）
    this.enableGravity = true;
    this.enableCoupling = true; // 滚转-偏航耦合开关
    // 失速
    this.stall = false;       // speed < stallThreshold
    this.stallThreshold = this.minSpeed * 1.5;
    this._stallTimer = 0;     // 用于抖动相位

    // 坠毁
    this.crashed = false;     // 坠毁期间禁用输入与物理
    this._exploded = false;    // 已爆炸（模型隐藏，仅爆炸粒子）
    this._crashTimer = 0;     // 已爆炸后粒子倒计时（坠毁触地前不计时，与重生解耦）
    this.crashShake = 0;      // 镜头震动强度（供 main.js 读取）
    this._crashDamage = 0;    // 坠毁中累计受击伤害（>20 触发空中爆炸）
    this._crashVel = new THREE.Vector3(); // 坠毁速度向量（弹道模式用）
    this._crashSpeed = 0;  // 坠毁前飞标量速度（挣扎模式用）
    this._crashMode = 'ballistic';  // 坠毁模式：'ballistic'(弹道机头朝下) | 'struggle'(挣扎前飞快速下降) | 'dive'(平滑转入俯冲)
    this._crashSinkRate = 0;  // 坠毁下沉速率
    this._crashPitchRate = 0; // 坠毁低头角速度（弧度/秒）
    this._crashRollRate = 0;  // 坠毁滚转角速度（螺旋）
    this._crashYawRate = 0;   // 坠毁偏航角速度
    this._crashFallTime = 0;  // 坠毁已持续时间（安全阀，超时强制爆炸）
    // dive 模式姿态平滑过渡：起始姿态 -> 目标俯冲姿态（slerp 插值，避免瞬间跳变）
    this._crashStartQ = new THREE.Quaternion();  // 坠毁开始时的姿态（slerp 起点）
    this._crashTargetQ = new THREE.Quaternion(); // 目标俯冲姿态（含随机偏航/滚转，每架不同）
    this._crashTransition = 0;  // 过渡进度 0->1（1 表示已完全转到目标姿态）
    this._crashPropDecay = 0;   // 坠毁后螺旋桨衰减因子（1.0→0，渐停）
    this._crashTransitionDur = 1.5; // 过渡总时长（秒），2.5-4.0 随机
    this._crashTargetSpeed = 0;  // 坠毁目标速度（全速80%，从当前速度逐渐加速到此）
    this._crashAccel = 20;       // 坠毁加速度（dive 模式逐渐加速到目标速度）
    this.autoRespawn = true;  // 是否自动重生（玩家 true；敌机 false，由 main.js 编队管理重生）

    // 损伤效果
    this.smokeThreshold = 30;  // HP ≤ 此值开始冒轻度烟（占总血量百分比折算）
    this._whiteSmoke = false;  // 白色轻烟标志（长机负伤离场剧情专用，复用 _damageSmoke 粒子通道）
    this._damageSmoke = [];   // 损伤烟雾 Sprite 粒子
    this._damageFire = [];    // 坠毁火焰 Sprite 粒子
    this._debris = [];        // 爆炸碎片 mesh
    this._killedByExplosive = false;  // 被机炮击落标记（_startCrash 生成大块碎片用）
    this._dmgSmokeTimer = 0;
    this._dmgFireTimer = 0;
    this.obstacles = [];      // 障碍物包围盒列表 [{ box: Box3 }]，由外部注入
    this.terrain = null;      // 地形（提供 getHeight），由外部注入
    this._explosions = [];    // 爆炸粒子
  }

  /** 注册障碍物（环境层调用），传入 THREE.Box3 数组 */
  setObstacles(boxes) { this.obstacles = (boxes || []).map(b => ({ box: b })); }

  /** 注册地形（用于按真实地形高度判断撞地，而非固定 y=2） */
  setTerrain(t) { this.terrain = t; }

  async load(url, onProgress) {
    let gltf;

    if (_gltfCache.has(url)) {
      // 缓存命中：跳过网络/解析，直接克隆
      gltf = _gltfCache.get(url);
    } else {
      // 首次加载：网络请求 + GLTF 解析
      const loader = new GLTFLoader();
      // 预置 DRACO 解码器：若模型已 Draco 压缩可正常加载，未压缩则不会触发，零副作用
      const draco = new DRACOLoader();
      draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/');
      loader.setDRACOLoader(draco);
      // meshopt 解码器：优化版模型使用 EXT_meshopt_compression，必须注册否则报错
      loader.setMeshoptDecoder(MeshoptDecoder);
      // WebP 纹理（EXT_texture_webp）three 0.160 内置支持，无需额外配置

      gltf = await loader.loadAsync(url, (e) => onProgress && onProgress(e));

      // 对原始模板做一次性处理（材质提亮 + 阴影设置）
      // SkeletonUtils.clone() 共享材质引用，所以只在模板上做一次，克隆体继承
      gltf.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // 部分模型材质偏暗，略提亮
          if (o.material) {
            (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
              if (m.roughness !== undefined) m.roughness = Math.min(1, m.roughness + 0.05);
            });
          }
        }
      });

      _gltfCache.set(url, gltf);
    }

    // 克隆场景图（每个实例独立，SkeletonUtils.clone 处理骨骼/动画绑定）
    this.model = cloneGltfScene(gltf.scene);

    // 深拷贝材质：SkeletonUtils.clone() 共享材质引用
    // 后处理链路（_setupPropPivot 等）会修改桨叶材质的 transparent/opacity
    // 若不独立化，修改会传播到所有克隆体（桨叶与机身共享材质时整架飞机变透明）
    this.model.traverse((o) => {
      if (o.isMesh && o.material) {
        if (Array.isArray(o.material)) {
          o.material = o.material.map((m) => m.clone());
        } else {
          o.material = o.material.clone();
        }
      }
    });

    // 后处理链路（每个实例独立执行）
    this._normalize();
    this.modelYaw.add(this.model);
    this._autoOrient();
    this._addMuzzleHelpers();
    this._setupAnimations(gltf.animations);
    this._setupControlSurfaces();
    if (this._hideGear) this._hideLandingGear();  // 隐藏展开的起落架 mesh（仅 _hideGear=true 机型）
    if (this._glassNodes) {
      this._makeGlassTransparent();  // 座舱玻璃隐藏（仅 _glassNodes 机型）
      this._setupCockpitLight();     // 座舱内部光源（照亮仪表贴图，仅 _glassNodes 机型）
    }
    this._applyPropNodes();                          // 把显式螺旋桨节点加入 propBranches.blur 并重应用 propMode
    if (this._propCut) this._applyPropCut();         // 静态桨叶透明切割（shader discard，仅 _propCut 机型）

    return gltf;
  }

  /**
   * 隐藏起落架 mesh。优先用 _hideGearNodes 显式节点名列表（精准），
   * 退化用 GEAR_KEYWORDS 关键词匹配（向后兼容 I-153/I-16 等历史机型）。
   * 仅 _hideGear=true 时调用（用于 yak1/yak3 等模型导出时起落架展开的机型）。
   * 现有 classifyClip 仅跳过起落架动画播放，但 mesh 仍可见，这里补上 mesh 隐藏。
   */
  _hideLandingGear() {
    if (!this.model) return;
    if (this._hideGearNodes && this._hideGearNodes.length) {
      // 显式列表：按名字精准匹配
      const set = new Set(this._hideGearNodes);
      this.model.traverse((o) => {
        if (o.name && set.has(o.name)) o.visible = false;
      });
    } else {
      // 关键词匹配（向后兼容）
      this.model.traverse((o) => {
        if (!o.name) return;
        const n = String(o.name).toLowerCase();
        if (GEAR_KEYWORDS.some((k) => n.includes(k))) o.visible = false;
      });
    }
  }

  /**
   * 座舱玻璃透明化：部分模型（Fw 190 A-4 的 Object_9）座舱玻璃材质不透明且内部
   * 无光照贴图，半透明后座舱内一片漆黑看不到仪表。直接隐藏玻璃节点（visible=false），
   * 玩家座舱视角能直接看出去，仪表贴图也可见。座舱框架由其他 mesh 保留视觉参考。
   * 仅 _glassNodes 列出的机型调用，不影响其他机型。
   */
  _makeGlassTransparent() {
    if (!this.model || !this._glassNodes || !this._glassNodes.length) return;
    const set = new Set(this._glassNodes);
    this.model.traverse((o) => {
      if (!o.name || !set.has(o.name)) return;
      o.visible = false;
    });
  }

  /**
   * 座舱内部光源：部分模型（Fw 190 A-4）座舱内无自发光贴图，隐藏玻璃后内部漆黑。
   * 在座舱位置加一个 PointLight 照亮仪表贴图，挂到 this.root（body frame）。
   * 光源参数由 _cockpitLight 配置（playerConfig.cockpitLight 注入），默认在座舱上方略前。
   * 仅 _glassNodes 机型调用（_setupCockpitLight 在 _makeGlassTransparent 后执行）。
   */
  _setupCockpitLight() {
    if (!this.root) return;
    const cfg = this._cockpitLight;
    if (!cfg) return;  // 未配置则不创建（默认无光源，关卡可按需开启）
    const light = new THREE.PointLight(
      cfg.color !== undefined ? cfg.color : 0xfff2d8,  // 暖白（仪表板琥珀灯感）
      cfg.intensity !== undefined ? cfg.intensity : 1.5,
      cfg.distance !== undefined ? cfg.distance : 18,   // 有限范围，不照亮外部
      cfg.decay !== undefined ? cfg.decay : 2.0,
    );
    light.position.set(
      cfg.x !== undefined ? cfg.x : 0,
      cfg.y !== undefined ? cfg.y : 2.2,
      cfg.z !== undefined ? cfg.z : 4.5,
    );
    light.name = '_cockpitLight';
    this.root.add(light);
    this._cockpitLightObj = light;  // 保存引用（dispose 用）
  }

  /**
   * 静态桨叶透明切割：模型桨叶与机身合并（如 Fw 190 A-4 的 Object_7），
   * 无法用 visible=false 隐藏桨叶。用 shader discard 让桨叶区域顶点不渲染。
   *
   * 原理：
   *   1. 预计算每个顶点的 body frame 坐标（root 局部空间），存为 aBodyPos 属性
   *   2. vertex shader 判断 aBodyPos 是否在桨叶区域（Z 范围内 且 离轴半径 > 阈值）
   *   3. fragment shader 中 discard 标记的片元
   *
   * 不修改几何，完全可逆（uCutEnabled=0 恢复）。
   * 仅 _propCut 配置的机型调用（load 末尾），不影响其他机型。
   */
  _applyPropCut() {
    if (!this.model || !this._propCut) return;
    const cfg = this._propCut;
    const zMin = cfg.zMin;
    const zMax = cfg.zMax;
    const cx = cfg.cx || 0;   // 圆心 X（body frame，默认 0）
    const cy = cfg.cy || 0;   // 圆心 Y（body frame，默认 0）
    const radius = cfg.radius;

    // body frame = root 局部空间。load 末尾 root 在原点无旋转，body frame = 世界坐标。
    // 用 mesh.matrixWorld（已含所有父级变换）算到世界，再减 root.position 得 body frame。
    const v = new THREE.Vector3();
    let meshCount = 0, totalDiscard = 0;

    this.model.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const pos = o.geometry.attributes.position;
      if (!pos) return;

      // 预计算每个顶点的 body frame 位置（mesh local → root local）
      o.updateWorldMatrix(true, true);
      const meshWorld = o.matrixWorld;
      const bodyPosArr = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.applyMatrix4(meshWorld);
        v.sub(this.root.position);
        bodyPosArr[i * 3] = v.x;
        bodyPosArr[i * 3 + 1] = v.y;
        bodyPosArr[i * 3 + 2] = v.z;
        // 统计落在切割区域的顶点（圆心偏移后判断半径）
        const dx = v.x - cx, dy = v.y - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (v.z > zMin && v.z < zMax && r > radius) {
          totalDiscard++;
        }
      }
      o.geometry.setAttribute('aBodyPos', new THREE.BufferAttribute(bodyPosArr, 3));
      meshCount++;

      // 注入 shader（onBeforeCompile）
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((mat) => {
        if (mat.userData.propCutApplied) return;
        const uniforms = {
          uCutEnabled: { value: 1 },
          uCutZMin: { value: zMin },
          uCutZMax: { value: zMax },
          uCutCenterX: { value: cx },
          uCutCenterY: { value: cy },
          uCutRadius: { value: radius },
        };
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uCutEnabled = uniforms.uCutEnabled;
          shader.uniforms.uCutZMin = uniforms.uCutZMin;
          shader.uniforms.uCutZMax = uniforms.uCutZMax;
          shader.uniforms.uCutCenterX = uniforms.uCutCenterX;
          shader.uniforms.uCutCenterY = uniforms.uCutCenterY;
          shader.uniforms.uCutRadius = uniforms.uCutRadius;

          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `
              #include <common>
              attribute vec3 aBodyPos;
              uniform float uCutEnabled;
              uniform float uCutZMin;
              uniform float uCutZMax;
              uniform float uCutCenterX;
              uniform float uCutCenterY;
              uniform float uCutRadius;
              varying float vCutDiscard;
            `)
            .replace('#include <project_vertex>', `
              #include <project_vertex>
              // 圆心偏移：离 (uCutCenterX, uCutCenterY) 的距离
              float dx = aBodyPos.x - uCutCenterX;
              float dy = aBodyPos.y - uCutCenterY;
              float bodyR = length(vec2(dx, dy));
              vCutDiscard = (uCutEnabled > 0.5 && aBodyPos.z > uCutZMin && aBodyPos.z < uCutZMax && bodyR > uCutRadius) ? 1.0 : 0.0;
            `);

          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `
              #include <common>
              varying float vCutDiscard;
            `)
            .replace('#include <clipping_planes_fragment>', `
              #include <clipping_planes_fragment>
              if (vCutDiscard > 0.5) discard;
            `);
        };
        mat.userData.propCutApplied = true;
        mat.userData.cutUniforms = uniforms;
        mat.needsUpdate = true;
      });
    });

  }

  /**
   * 把显式螺旋桨节点（_propNodes）加入 propBranches.blur 分支，
   * 让 propMode='blur' 时能显示这些静态叶片（作为模糊盘视觉替代）。
   * yak1/yak3 模型螺旋桨节点是泛化命名（Line16 等），_setupPropStates 退化分支
   * 不会把它们识别为 blur 分支，导致 propMode='blur' 时螺旋桨完全不可见。
   * 这里补上：把 _propNodes 列出的节点强制加入 propBranches.blur 并重应用 propMode。
   */
  _applyPropNodes() {
    // 程序化螺旋桨：模型无独立桨叶节点（桨叶几何与机身合并），跳过节点 reparent，
    // 在配置的桨毂位置程序化生成模糊盘 + 旋转桨叶。仅 _propProcedural=true 机型走此分支。
    if (this._propProcedural) {
      this._setupProceduralProp();
      this._applyPropMode();
      return;
    }
    if (!this._propNodes || !this._propNodes.length || !this.propBranches) return;
    const set = new Set(this._propNodes);
    this.model.traverse((o) => {
      if (o.name && set.has(o.name) && !this.propBranches.blur.includes(o)) {
        this.propBranches.blur.push(o);
        // 同时从 anim/slow 分支移除（避免重复）
        this.propBranches.anim = this.propBranches.anim.filter((n) => n !== o);
        this.propBranches.slow = this.propBranches.slow.filter((n) => n !== o);
      }
    });
    // propBlurOnly：模型左右桨几何合并到单节点，无法独立旋转
    // → 只做半透明（呈现高速模糊盘视觉），不创建 pivot 不旋转
    if (this._propBlurOnly) {
      this.propBranches.blur.forEach((b) => {
        b.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { m.transparent = true; m.opacity = 0.22; });
        });
      });
    } else {
      this._setupPropPivot();   // 把桨叶 reparent 到桨毂 pivot，供 update 每帧绕桨轴旋转
    }
    this._applyPropMode();  // 重应用 propMode 让新加入的 blur 节点显示
  }

  /**
   * 程序化螺旋桨：模型无独立桨叶节点（桨叶几何与机身合并，无法 reparent），
   * 在配置的桨毂位置（_propHubOffset，body frame 缩放后）程序化生成：
   *   - 模糊盘（半透明黑桨身+黄桨尖径向渐变，覆盖原静态桨叶，呈现高速旋转模糊）
   *   - N 片旋转桨叶（细长深色 mesh，挂在 spin 上随 update 绕 Z 轴高速旋转）
   * 桨毂位置与半径由 playerConfig 调校注入，挂载到 this.root（body frame 原点），
   * rotateZ 绕 root Z 轴旋转（=body Z=前飞方向），避免 model 根旋转导致轴向错位。
   * 原静态桨叶保留：停转时（坠毁）隐藏程序化盘+桨叶，露出静态桨叶=自然停止状态。
   * 仅 _propProcedural=true 机型调用（Fw 190 A-4 等），不影响其他机型。
   */
  _setupProceduralProp() {
    if (!this.model) return;
    const radius = Math.max(0.1, this._propRadius);
    const hub = this._propHubOffset;
    const bladeCount = Math.max(2, this._propBladeCount | 0);

    // 先收缩原模型静态桨叶顶点（桨叶与机身合并，无法 reparent/隐藏，
    // 把桨叶区域顶点 xy 缩到中心轴，视觉消失，被模糊盘覆盖。
    // 仅一次性预处理，不影响其他机型）
    this._shrinkStaticProp();

    // 嵌套结构：pivot(位置=桨毂) → tilt(轴倾斜) → spin(旋转) → 桨叶
    // 挂到 this.root（不含 yawOffset），rotateZ 绕 root Z 轴旋转（=body Z=前飞方向）。
    // 模型可能有根旋转（Fw 190 node-0 90°X），挂到 root 避免 model 局部轴与 body 轴错位。
    // hub 坐标即 body frame 坐标（root 空间），无需换算。
    const pivot = new THREE.Group();
    pivot.name = '_propProcPivot_0';
    pivot.position.set(hub[0], hub[1], hub[2]);
    this.root.add(pivot);
    this._propRigs.push(pivot);  // visibility 联动用（坠毁/重生）

    const tilt = new THREE.Group();
    tilt.name = '_propProcTilt_0';
    tilt.rotation.set(
      THREE.MathUtils.degToRad(this._propAxisTilt.x),
      THREE.MathUtils.degToRad(this._propAxisTilt.y),
      0,
    );
    pivot.add(tilt);

    const spin = new THREE.Group();
    spin.name = '_propProcSpin_0';
    tilt.add(spin);
    this._propPivots.push(spin);  // update 每帧 rotateZ

    // 模糊盘：径向渐变（黑桨身+黄桨尖），半径略大于桨叶以覆盖静态桨叶
    // 挂在 tilt 下（spin 的兄弟），继承轴倾斜但不随 spin 旋转
    // body frame 单位（root 无缩放）
    if (this._propBlurDisc) {
      const discRadius = radius * 1.05;
      const discGeo = new THREE.CircleGeometry(discRadius, 48);
      const discMat = new THREE.MeshBasicMaterial({
        map: this._propBlurStyle === 'fw' ? _getPropBlurTexFw() : _getPropBlurTex(),
        transparent: true,
        // 程序化桨的盘需更实以遮挡模型自带的静态桨叶（喷火的 ×0.6 衰减不适用）
        opacity: this._propBlurStrength * Math.min(1, this._propSpinSpeed / 120),
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.renderOrder = 2;  // 高于云(1)，避免被云遮挡（depthTest 仍保证远处云被前方物体挡）
      tilt.add(disc);
      this._propBlurDiscs.push(disc);
    }

    // 程序化桨叶：偏转纺锤形（中段宽、两端尖、带扭转角），从桨毂向外延伸
    // 沿 +Y 延伸（根部 y=0，叶尖 y=bladeLen），绕 Z 轴均匀分布
    // body frame 单位（root 无缩放）
    const bladeLen = radius;
    const bladeGeo = _makeSpindleBladeGeometry(bladeLen, this._propBladeChord, this._propBladeTwist);
    // 桨叶材质：纯深灰半透明 + 整体边缘模糊（shader 渐变透明）
    // opacity 可低于 0.1 甚至 0（shader 强制 alpha 受 opacity 控制）
    const bladeOpacity = this._propOpacity + 0.18;
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.6,
      metalness: 0.1,
      transparent: true,
      opacity: bladeOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // 注入 shader：整体边缘模糊（根部+叶尖都渐变透明，中段最实）
    bladeMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          varying float vBladeT;
        `)
        .replace('#include <project_vertex>', `
          #include <project_vertex>
          vBladeT = clamp(position.y / ${bladeLen.toFixed(4)}, 0.0, 1.0);
        `);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `
          #include <common>
          varying float vBladeT;
        `)
        // 在 alphatest_fragment 后修改 diffuseColor.a（此 chunk 后 diffuseColor 已确定）
        .replace('#include <alphatest_fragment>', `
          #include <alphatest_fragment>
          // 整体动态模糊：整体降低 alpha + 边缘渐变（根部+叶尖更透明）
          float rootFade = smoothstep(0.0, 0.20, vBladeT);
          float tipFade = 1.0 - smoothstep(0.45, 1.0, vBladeT);
          diffuseColor.a *= 0.35 * rootFade * tipFade;
        `);
    };
    for (let i = 0; i < bladeCount; i++) {
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.renderOrder = 2;  // 高于云(1)，避免被云遮挡
      // 桨叶组：先旋转 Z 分布，再放桨叶（几何原点在桨毂，沿 +Y 延伸）
      const holder = new THREE.Group();
      holder.rotation.z = (Math.PI * 2 * i) / bladeCount;
      holder.add(blade);
      spin.add(holder);
    }
  }

  /**
   * 收缩原模型静态桨叶顶点（桨叶与机身合并，无法 reparent/隐藏）。
   * 把桨叶区域顶点（机头前方 + 离中心轴较远）的 xy 缩到中心轴，视觉消失。
   * 桨毂位置由 _propHubOffset（body frame）经 yawOffset 逆变换转到 model 局部空间。
   * 仅 _propProcedural=true 机型调用，一次性预处理，不影响其他机型。
   */
  _shrinkStaticProp() {
    if (!this.model || !this._propHubOffset) return;

    // body frame → model 局部空间：model 局部 = invQ(bodyFrame) - model.position
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, THREE.MathUtils.degToRad(this.yawOffset), 0)
    );
    const invQ = q.clone().invert();
    const hubBody = new THREE.Vector3(this._propHubOffset[0], this._propHubOffset[1], this._propHubOffset[2]);
    const hubModel = hubBody.clone().applyQuaternion(invQ).sub(this.model.position);

    const cutZ = hubModel.z;        // 切割 z 阈值（model 局部空间，桨毂前方）
    const minDist = 1.2;            // 离中心轴最小距离（小于此视为机身，不切割）

    let totalShrunk = 0;
    this.model.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const geo = o.geometry;
      const pos = geo.attributes.position;
      if (!pos) return;

      let modified = false;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        // 桨叶区域：z 在桨毂前方 且 离中心轴较远（非机身）
        if (v.z > cutZ && Math.sqrt(v.x * v.x + v.y * v.y) > minDist) {
          v.x *= 0.08;   // xy 缩到中心轴，视觉消失
          v.y *= 0.08;
          pos.setXYZ(i, v.x, v.y, v.z);
          modified = true;
          totalShrunk++;
        }
      }
      if (modified) {
        pos.needsUpdate = true;
        geo.computeVertexNormals();  // 重算法线保持光照
      }
    });

    if (totalShrunk > 0) {
      console.log(`[Prop] 静态桨叶顶点已收缩: ${totalShrunk} 个`);
    }
  }

  /**
   * 把显式桨叶 reparent 到一个桨毂 pivot 组，update 每帧绕机体 Z 轴旋转 pivot
   * 即可让所有桨叶同步转动（避免每片桨叶各自绕自身原点翻滚）。
   * 桨毂位置取桨叶世界质心（3 片对称分布时质心≈桨毂轴心）。
   * 用 Group.attach 保持桨叶世界变换不变，仅改父节点。
   * 仅对 _propNodes 桨叶模型（yak1/yak3）生效。
   */
  _setupPropPivot() {
    const blades = this.propBranches.blur;
    if (!blades || !blades.length) return;
    this.model.updateWorldMatrix(true, true);
    // 多螺旋桨独立旋转支持：
    // - 单发机型（Yak/喷火，multiProp=false 默认）：所有桨叶归为 1 组，1 个 pivot 在桨毂中心
    // - 双发机型（multiProp=true）：每个 propNode 自成一组，左右桨各自 1 个 pivot 独立旋转
    // 分组策略由 _buildPropGroups 实现，无 _propNodes 时退化到旧逻辑（所有 blur 节点合为 1 组）
    const groups = this._buildPropGroups(blades);
    const tmpBox = new THREE.Box3();
    const tmpCenter = new THREE.Vector3();
    groups.forEach((group, idx) => {
      if (!group.length) return;
      // 用几何中心而非 transform 原点（喷火 Object_4 等节点原点偏离几何中心）
      tmpBox.makeEmpty();
      group.forEach((o) => tmpBox.expandByObject(o));
      tmpBox.getCenter(tmpCenter);
      // 嵌套结构：pivot(位置) → tilt(轴倾斜) → spin(旋转) → 桨叶
      // 挂载点选择：
      //   - 喷火（_propBlurDisc=true）：挂到 this.root（不含 yawOffset），rotateZ 绕 root Z 轴
      //     喷火桨叶几何与模型 Z 轴不对齐，需要绕 root Z 轴旋转才正确（调试页面验证）
      //   - 其他机型（Yak/Bf109 等）：挂到 this.model（含 yawOffset），rotateZ 绕 model Z 轴
      //     这些机型的桨叶几何与模型 Z 轴对齐，绕 model Z 轴旋转正确
      const useRootSpace = this._propBlurDisc;
      const rigParent = useRootSpace ? this.root : this.model;
      const rigLocalPivot = useRootSpace
        ? this.root.worldToLocal(tmpCenter.clone())
        : this.model.worldToLocal(tmpCenter.clone());
      // 应用桨毂圆心偏移（调试页面导出的 propPivotOffset）
      rigLocalPivot.x += this._propPivotOffset.x;
      rigLocalPivot.y += this._propPivotOffset.y;
      rigLocalPivot.z += this._propPivotOffset.z;

      const pivot = new THREE.Group();
      pivot.name = `_propPivot_${idx}`;
      pivot.position.copy(rigLocalPivot);
      rigParent.add(pivot);
      this._propRigs.push(pivot);  // 记录 rig（visibility 联动用）

      const tilt = new THREE.Group();
      tilt.name = `_propTilt_${idx}`;
      // 旋转轴倾斜修正（度→弧度）
      tilt.rotation.set(
        THREE.MathUtils.degToRad(this._propAxisTilt.x),
        THREE.MathUtils.degToRad(this._propAxisTilt.y),
        0,
      );
      pivot.add(tilt);

      const spin = new THREE.Group();
      spin.name = `_propSpin_${idx}`;
      tilt.add(spin);

      // attach 保持桨叶世界位置/姿态不变（桨叶从原父级移到 spin）
      group.forEach((b) => spin.attach(b));
      // 桨叶半透明：低透明度让高速旋转时视觉暂留叠加成模糊盘
      const opacity = this._propOpacity;
      group.forEach((b) => {
        b.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { m.transparent = true; m.opacity = opacity; });
        });
      });
      // spin Group 入列（update 中 rotateZ 旋转 spin）
      this._propPivots.push(spin);

      // 动态模糊盘（喷火专用）：径向渐变盘面，黑桨身 + 黄桨尖
      // 挂在 tilt 下（spin 的兄弟），继承轴倾斜但不随 spin 旋转
      if (this._propBlurDisc) {
        // 计算桨叶投影半径（垂直于 Z 旋转轴的 XY 平面，世界空间）
        const corners = [];
        for (const x of [tmpBox.min.x, tmpBox.max.x])
          for (const y of [tmpBox.min.y, tmpBox.max.y])
            corners.push([x - tmpCenter.x, y - tmpCenter.y]);
        let maxR = 0;
        corners.forEach(([dx, dy]) => { const d = Math.hypot(dx, dy); if (d > maxR) maxR = d; });
        // rig 父级的缩放系数（root 无缩放=1，model 有 baseScale）
        const rigScale = useRootSpace ? 1 : (this.model.scale.x || 1);
        const radius = (maxR * 0.95) / rigScale || 1;
        const discGeo = new THREE.CircleGeometry(radius, 48);
        const discMat = new THREE.MeshBasicMaterial({
          map: _getPropBlurTex(),
          transparent: true,
          opacity: this._propBlurStrength * Math.min(1, this._propSpinSpeed / 120) * 0.6,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const disc = new THREE.Mesh(discGeo, discMat);
        tilt.add(disc);
        this._propBlurDiscs.push(disc);
      }
    });
  }

  /**
   * 把螺旋桨节点分组，供 _setupPropPivot 创建 pivot。
   * - multiProp=false（单发默认）：所有匹配 _propNodes 的桨叶归为 1 组，共享 1 个桨毂 pivot。
   *   3 片桨叶对称分布时几何质心 ≈ 桨毂轴心，绕质心旋转即三叶同步绕桨毂转动。
   * - multiProp=true（双发机型）：每个 _propNodes 元素自成一组（左右桨各自独立旋转）。
   * - 无 _propNodes 时所有 blur 节点合为 1 组（兼容旧逻辑）。
   */
  _buildPropGroups(blades) {
    if (!this._propNodes || !this._propNodes.length) return [blades];
    const used = new Set();
    // 匹配函数：节点名等于 propNode 名，或以 ':propNode名' 结尾（带命名空间前缀）
    const matchName = (b, name) => b.name === name || b.name.endsWith(':' + name);

    if (this.multiProp) {
      // 双发机型：每个 propNode 自成一组（左右桨各自独立旋转）
      const groups = [];
      this._propNodes.forEach((name) => {
        const group = blades.filter((b) => matchName(b, name) && !used.has(b));
        if (group.length) {
          group.forEach((b) => used.add(b));
          groups.push(group);
        }
      });
      const leftover = blades.filter((b) => !used.has(b));
      if (leftover.length) groups.push(leftover);
      return groups.length ? groups : [blades];
    }

    // 单发机型（默认）：所有匹配 _propNodes 的桨叶归为 1 组，共享 1 个桨毂 pivot
    const matched = blades.filter((b) => this._propNodes.some((n) => matchName(b, n)));
    matched.forEach((b) => used.add(b));
    const leftover = blades.filter((b) => !used.has(b));
    const groups = [];
    if (matched.length) groups.push(matched);
    if (leftover.length) groups.push(leftover);
    return groups.length ? groups : [blades];
  }

  /** 缩放到目标尺寸 + 居中（含 centerOffset 微调） */
  _normalize() {
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const target = 9; // 目标最长边 = 9 单位（约 9 米）
    this.baseScale = target / longest;
    this.model.scale.setScalar(this.baseScale);
    // 把几何中心移到原点
    this.model.position.copy(center).multiplyScalar(-this.baseScale);
    // 用户中心偏移（body frame 世界单位，缩放后）：微调几何中心与视觉中心的对齐
    // 用于垂尾偏高/机头不对称等场景，由 tune_enemy.html 调校后写入 MODEL_CONFIGS.centerOffset
    if (this.centerOffset) {
      this.model.position.x += this.centerOffset[0] || 0;
      this.model.position.y += this.centerOffset[1] || 0;
      this.model.position.z += this.centerOffset[2] || 0;
    }
  }

  /**
   * 自动朝向校准：以所有“螺旋桨”节点的质心作为机头方向，
   * 计算 yaw 偏移使机头对齐 -Z（飞行前方）。
   * 这样无论模型导出时朝哪个方向，都无需手动调向。
   */
  _autoOrient() {
    if (!this.autoOrient) { this._applyCalibration(); return; }
    this.model.updateWorldMatrix(true, true);
    const propNodes = [];
    // 优先用显式螺旋桨节点列表（yak1/yak3 等模型 PROP_KEYWORDS 匹配不到节点名，
    // 必须依赖 MODEL_CONFIGS.propNodes 显式指定才能算出正确朝向）
    if (this._propNodes && this._propNodes.length) {
      const set = new Set(this._propNodes);
      this.model.traverse((o) => {
        if (o.name && set.has(o.name)) propNodes.push(o);
      });
    } else {
      // 退化：按 PROP_KEYWORDS 关键词匹配（Bf 109 / I-153 / I-16 / Yak-9 等）
      this.model.traverse((o) => {
        if (isPropName(o.name)) propNodes.push(o);
      });
    }
    if (!propNodes.length) {
      // 质心算不出时保留 this.yawOffset（可能由 MODEL_CONFIGS/playerConfig 显式指定）
      this._applyCalibration();
      return;
    }
    // 用几何中心而非 transform 原点（同 _setupPropPivot）
    const c = new THREE.Vector3();
    const tmpBox = new THREE.Box3();
    const tmpCenter = new THREE.Vector3();
    propNodes.forEach((o) => {
      tmpBox.setFromObject(o);
      tmpBox.getCenter(tmpCenter);
      c.add(tmpCenter);
    });
    c.divideScalar(propNodes.length);
    // 机头方向（忽略 y，只看水平面）
    const nx = c.x, nz = c.z;
    if (Math.hypot(nx, nz) < 1e-3) {
      // 质心在原点附近（如 gltf-transform 烘焙根 matrix 后），保留 this.yawOffset 兜底
      this._applyCalibration();
      return;
    }
    const phi = Math.atan2(nx, nz); // 从 +Z 朝 +X 的角度
    this.yawOffset = THREE.MathUtils.radToDeg(Math.PI - phi);
    this._applyCalibration();
  }

  _applyCalibration() {
    // YXZ 顺序：先偏航(Y)对齐机头水平方向，再俯仰(X)修正上下，最后滚转(Z)修正侧倾
    this.modelYaw.rotation.set(
      THREE.MathUtils.degToRad(this.pitchOffset),
      THREE.MathUtils.degToRad(this.yawOffset),
      THREE.MathUtils.degToRad(this.rollOffset),
      'YXZ'
    );
    // 仅缩放，不更新 position（model.position 在 _normalize 中一次性设好，
    // 座舱视角偏移已据此校准；改 position 会导致座舱视角偏移）
    this.model.scale.setScalar(this.baseScale * this.userScale);
  }

  setYawOffset(deg)   { this.yawOffset = deg;   this._applyCalibration(); }
  setPitchOffset(deg) { this.pitchOffset = deg; this._applyCalibration(); }
  setRollOffset(deg)  { this.rollOffset = deg;  this._applyCalibration(); }
  setUserScale(s) { this.userScale = s; this._applyCalibration(); }

  /**
   * 受击：扣血 → HP≤0 时 5% 几率直接空中爆炸，95% 冒烟坠毁 → 坠毁中累计伤害>80 空中爆炸。
   * @param {number} d 伤害值
   * @param {THREE.Vector3}" hitDir 命中方向（子弹飞行方向，归一化），用于装甲分区减伤
   * @returns true 当 HP 归零（开始坠毁/爆炸），false 其它
   */
  takeDamage(d, hitDir) {
    if (this._exploded) return false;       // 已爆炸，不再处理
    if (this.crashed) {
      // 坠毁中再受击：累计伤害，>80 触发空中爆炸（需多发机炮命中）
      this._crashDamage += d;
      if (this._crashDamage > 80) this._explode();
      return false;
    }
    // 装甲分区减伤（通用，按命中方向与飞机朝向的点积查分区倍率）
    // dot = hitDir·forward：>0 后方咬尾（装甲薄弱）、<0 正面迎面（厚甲）
    // _armorRegions 数组按 minDot 降序排列，命中第一个 dot>=minDot 的分区应用 multiplier
    if (hitDir && this._armorRegions && this._armorRegions.length) {
      const fwd = this.getForward();
      const dot = hitDir.dot(fwd);
      for (let i = 0; i < this._armorRegions.length; i++) {
        if (dot >= this._armorRegions[i].minDot) {
          d *= this._armorRegions[i].multiplier;
          break;
        }
      }
    }
    this.hp -= d;
    if (this.hp <= 0) {
      this.hp = 0;
      // 击落瞬间：80% 几率额外加小爆燃效果（火光+3-5碎块，不隐藏模型，仅视觉提示）
      if (Math.random() < 0.8) this._spawnKillFlash();
      // 5% 几率直接空中爆炸（火球+碎片），95% 冒烟坠毁
      if (Math.random() < 0.05) {
        this._explode();
      } else {
        this._startCrash();
      }
      return true;
    }
    return false;
  }

  // ---------- 动画 ----------
  _setupAnimations(clips) {
    this.clips = clips || [];
    this.actions = [];
    this.propAction = null;
    this.propClip = null;
    if (this.clips.length) {
      this.mixer = new THREE.AnimationMixer(this.model);

      // 原始片段动作（仅供调试检查，默认不播放）
      this.actions = this.clips.map((clip) => {
        const action = this.mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        return { clip, action, kind: classifyClip(clip.name) };
      });

      // 关键：模型把螺旋桨/起落架/座舱盖/座舱开关全烘焙进同一片段。
      // 这里从所有片段中抽取"节点名含 prop"的 track，合成一个纯净螺旋桨片段，
      // 只播放它 —— 起落架与座舱盖的 track 不参与，保持模型默认姿态。
      const propTracks = [];
      this.clips.forEach((clip) => {
        clip.tracks.forEach((t) => {
          const dot = t.name.lastIndexOf('.');
          const node = dot > 0 ? t.name.substring(0, dot) : t.name;
          if (isPropName(node)) propTracks.push(t);
        });
      });

      if (propTracks.length) {
        this.propClip = new THREE.AnimationClip(
          'Propeller (auto)', this.clips[0].duration, propTracks
        );
        this.propAction = this.mixer.clipAction(this.propClip);
        this.propAction.setLoop(THREE.LoopRepeat, Infinity);
        this.propAction.clampWhenFinished = false;
        this.propAction.play();
        // 固定转速，不随油门变化；timeScale = 倍数（可由调试面板调节）
        this.propAction.timeScale = this.propMultiplier;
      }
    }

    // 识别螺旋桨的 still/slow/blur/anim 多套状态分支，便于只显示一套
    this._setupPropStates();
  }

  // ---------- 控制面（升降舵/方向舵/副翼）----------
  // 旋转轴与基准偏转（调试台实测调校，见 tune.html）
  // 基准偏转=把模型原始异常姿态修正到水平所需的固定偏角；输入驱动在此基础上叠加。
  static SURFACE_CFG = {
    elevator: { axis: new THREE.Vector3(1.00, 0.00, 0.00),  base: -30 },
    rudder:   { axis: new THREE.Vector3(-0.05, -1.00, 0.05), base: -26 },
    aileronL: { axis: new THREE.Vector3(-1.00, 0.10, -0.15), base: -37 },
    aileronR: { axis: new THREE.Vector3(-1.00, -0.10, 0.10), base:  26 },
  };

  _setupControlSurfaces() {
    this.surfaces = { elevator: null, rudder: null, aileronL: null, aileronR: null };
    this.model.traverse((o) => {
      if (!o.name) return;
      if (/^Elevators/i.test(o.name)) this.surfaces.elevator = o;
      else if (/^AileronL/i.test(o.name)) this.surfaces.aileronL = o;
      else if (/^AileronR/i.test(o.name)) this.surfaces.aileronR = o;
    });
    this.model.traverse((o) => { if (o.name === 'Rudder_416') this.surfaces.rudder = o; });
    if (!this.surfaces.rudder) {
      this.model.traverse((o) => { if (/^Rudder/i.test(o.name)) this.surfaces.rudder = o; });
    }
    // 襟翼/减速板：收集（不强制收起，保持模型姿态）
    this.flaps = [];
    this.model.traverse((o) => { if (o.name && /^Flap[LR]/i.test(o.name)) this.flaps.push(o); });

    // 记录模型原始四元数作为基准（不覆盖，偏转在原始姿态上叠加）
    this._surfaceBaseQ = {};
    for (const k of Object.keys(this.surfaces)) {
      const n = this.surfaces[k];
      this._surfaceBaseQ[k] = n ? n.quaternion.clone() : null;
    }
    // 当前叠加偏转（度），由输入驱动
    this._surfaceCur = { elevator: 0, rudder: 0, aileronL: 0, aileronR: 0 };
  }

  /**
   * 根据当前角速度平滑驱动舵面偏转。
   * 用 quaternion 绕本地轴旋转（mixer.update 之后执行，避免被覆盖）。
   */
  _updateSurfaces(dt) {
    if (!this.surfaces || !this.surfaces.elevator) return;
    const k = 1 - Math.exp(-8 * dt);
    const lim = (v, max) => Math.max(-max, Math.min(max, v));
    const EL = THREE.MathUtils.degToRad(35); // 输入驱动的最大附加偏角
    const AL = THREE.MathUtils.degToRad(30);

    // 输入驱动的附加偏转（角速度比例映射）
    const tgtE = lim(this.angVel.x / this.pitchMax, 1) * EL;
    const tgtR = lim(this.angVel.y / this.yawMax, 1) * EL;
    const tgtAL = lim(this.angVel.z / this.rollMax, 1) * AL;

    this._surfaceCur.elevator += (tgtE - this._surfaceCur.elevator) * k;
    this._surfaceCur.rudder   += (tgtR - this._surfaceCur.rudder) * k;
    this._surfaceCur.aileronL += (tgtAL - this._surfaceCur.aileronL) * k;
    this._surfaceCur.aileronR += (-tgtAL - this._surfaceCur.aileronR) * k;

    // 应用：原始姿态 + 基准偏转(修正模型异常) + 输入附加偏转，绕各自调试好的轴
    const deg = THREE.MathUtils.degToRad;
    const apply = (key) => {
      const n = this.surfaces[key];
      const base = this._surfaceBaseQ[key];
      const cfg = Aircraft.SURFACE_CFG[key];
      if (!n || !base || !cfg) return;
      n.quaternion.copy(base); // 恢复模型原始姿态
      // 基准偏转（把模型异常姿态修正到水平）
      n.rotateOnAxis(cfg.axis, deg(cfg.base));
      // 输入附加偏转
      n.rotateOnAxis(cfg.axis, this._surfaceCur[key]);
    };
    apply('elevator');
    apply('rudder');
    apply('aileronL');
    apply('aileronR');
  }

  /**
   * 识别 Prop_Set 下的三套叶片状态分支：
   *   anim（真实旋转叶片）/ blur（高速模糊盘）/ slow（慢转盘）
   * 默认三套全可见会重叠，所以按油门只显示一套。
   */
  _setupPropStates() {
    this.propBranches = { anim: [], blur: [], slow: [] };
    let propSet = null;
    this.model.traverse((o) => { if (o.name && /^Prop_Set/i.test(o.name)) propSet = o; });
    const classify = (name) => (/blur/i.test(name) ? 'blur' : /slow/i.test(name) ? 'slow' : 'anim');
    if (propSet) {
      propSet.children.forEach((c) => this.propBranches[classify(c.name || '')].push(c));
    } else {
      // 退化：按名归类顶层 prop 节点
      this.model.traverse((o) => {
        if (isPropName(o.name)) {
          if (/blur/i.test(o.name)) this.propBranches.blur.push(o);
          else if (/slow/i.test(o.name)) this.propBranches.slow.push(o);
        }
      });
    }
    this._applyPropMode();
  }

  setPropMode(mode) {
    this.propMode = mode;
    this._applyPropMode();
  }

  _applyPropMode() {
    const m = this.propMode;
    if (m === 'auto') { this._updatePropAuto(); return; }
    this.propBranches.anim.forEach((n) => (n.visible = m === 'all' || m === 'anim'));
    this.propBranches.blur.forEach((n) => (n.visible = m === 'all' || m === 'blur'));
    this.propBranches.slow.forEach((n) => (n.visible = m === 'all' || m === 'slow'));
  }

  /** auto 模式：低油门显示旋转叶片，高油门显示模糊盘 */
  _updatePropAuto() {
    if (this.propMode !== 'auto') return;
    const showBlur = this.throttle >= 0.5;
    this.propBranches.anim.forEach((n) => (n.visible = !showBlur));
    this.propBranches.blur.forEach((n) => (n.visible = showBlur));
    this.propBranches.slow.forEach((n) => (n.visible = false));
  }

  /** 默认行为：只播放自动提取的螺旋桨片段 */
  playPropOnly() {
    this.actions.forEach((a) => a.action.stop());
    if (this.propAction) {
      this.propAction.reset();
      this.propAction.play();
      this.propAction.timeScale = this._propSpeed();
    }
  }

  /** 调试用：播放原始完整片段（会一起动起落架/座舱盖，仅用于验证） */
  playAll() {
    if (this.propAction) this.propAction.stop();
    this.actions.forEach((a) => {
      a.action.reset();
      a.action.play();
      a.action.timeScale = 1;
    });
  }

  stopAll() {
    this.actions.forEach((a) => a.action.stop());
    if (this.propAction) this.propAction.stop();
  }

  _propSpeed() {
    // 油门越大螺旋桨越快；怠速也有慢转
    return this.throttle * this.propMultiplier + 0.5;
  }

  /** 单独播放某个原始片段（调试面板用） */
  playSingle(clipName) {
    this.stopAll();
    const a = this.actions.find((x) => x.clip.name === clipName);
    if (a) {
      a.action.reset();
      a.action.play();
      a.action.timeScale = 1;
    }
  }

  // ---------- 枪口 ----------
  _addMuzzleHelpers() {
    const geo = new THREE.SphereGeometry(0.14, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff5a4d });
    this.muzzleOffsets.forEach((m) => {
      const h = new THREE.Mesh(geo, mat);
      h.position.copy(m);
      h.visible = false; // 默认隐藏，避免影响观感
      this.root.add(h);
      this.muzzleHelpers.push(h);
    });
  }

  setMuzzleVisible(v) { this.muzzleHelpers.forEach((h) => (h.visible = v)); }
  getMuzzleWorldPositions() {
    return this.muzzleHelpers.map((h) => h.getWorldPosition(new THREE.Vector3()));
  }
  /**
   * 每个枪口的世界方向（与 getMuzzleWorldPositions 一一对应）。
   * - 无 muzzleDirs（null）：返回 null，调用方退化用 getAimDirection()
   * - 有 muzzleDirs：body frame 单位向量经 root 旋转变换到世界坐标
   * 用于轰炸机自卫炮塔（朝后/侧/上的独立发射方向）。
   */
  getMuzzleWorldDirs() {
    if (!this.muzzleDirs || !this.muzzleDirs.length) return null;
    return this.muzzleDirs.map((d) => d.clone().applyQuaternion(this.root.quaternion).normalize());
  }

  /**
   * 翼尖世界坐标（左右两个，用于拉烟）。
   * X 用模型包围盒极值（机翼最外侧/最宽处），Y/Z 用最靠外枪口近似（机翼高度/前后）。
   * 首次调用时懒计算并缓存到 _wingTipLocal（root 局部坐标）。
   */
  getWingTipWorldPositions() {
    if (!this.model) return null;
    if (!this._wingTipLocal) this._computeWingTips();
    if (!this._wingTipLocal) return null;
    this.root.updateMatrixWorld();
    return [
      this.root.localToWorld(this._wingTipLocal[0].clone()),
      this.root.localToWorld(this._wingTipLocal[1].clone()),
    ];
  }

  _computeWingTips() {
    if (!this.model) return;
    this.root.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    // 收集所有顶点（root 局部坐标）
    const pts = [];
    this.model.traverse((obj) => {
      if (obj.isMesh && obj.geometry) {
        const pos = obj.geometry.attributes.position;
        if (!pos) return;
        m.copy(obj.matrixWorld).premultiply(inv);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          pts.push(v.x, v.y, v.z);
        }
      }
    });
    if (pts.length < 6) return;
    // 第一遍：找 X 极值（机翼最宽处）
    let rightX = -Infinity, leftX = Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      if (pts[i] > rightX) rightX = pts[i];
      if (pts[i] < leftX) leftX = pts[i];
    }
    // 第二遍：X 极值±0.5 范围顶点的 Y/Z 平均值（翼尖实际高度/前后）
    const tol = 0.5;
    let rY = 0, rZ = 0, rN = 0, lY = 0, lZ = 0, lN = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], z = pts[i + 2];
      if (Math.abs(x - rightX) <= tol) { rY += y; rZ += z; rN++; }
      if (Math.abs(x - leftX) <= tol) { lY += y; lZ += z; lN++; }
    }
    if (rN === 0 || lN === 0) return;
    this._wingTipLocal = [
      new THREE.Vector3(rightX, rY / rN, rZ / rN),   // 右翼尖
      new THREE.Vector3(leftX, lY / lN, lZ / lN),    // 左翼尖
    ];
  }

  getForward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.quaternion);
  }

  /**
   * 瞄准方向（子弹实际飞行方向）：机头前方 + 座舱上抬分量。
   * 与 main.js updateCrosshair 的瞄准点计算保持一致——
   *   aimPoint = pos + forward*aimDist + up*(aimDist*aimLift)
   *   ⇒ 方向 = normalize(forward + up*aimLift)
   * 这样座舱模式下准星指向与子弹落点重合，修正"瞄高打低"偏差。
   * 追尾等模式 aimLift=0，退化为 getForward()。
   */
  getAimDirection() {
    const fwd = this.getForward();
    if (!this.aimLift) return fwd;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.root.quaternion);
    return fwd.add(up.multiplyScalar(this.aimLift)).normalize();
  }
  getVelocity() {
    return this.getForward().multiplyScalar(this.speed);
  }

  // ---------- 飞行物理（街机式，打磨版）----------
  /**
   * 角速度模型 + 阻尼回中 + 滚转-偏航耦合 + 轻量重力升力 + 失速 + G 力软限。
   * @param dt 秒
   * @param input { pitch:-1..1, roll:-1..1, yaw:-1..1, throttleUp:bool, throttleDown:bool }
   */
  updateFlight(dt, input) {
    // 坠毁期间不响应输入与物理，只更新爆炸/震动
    if (this.crashed) {
      this._updateCrash(dt);
      return;
    }

    // 油门
    if (input.throttleUp) this.throttle = Math.min(1, this.throttle + dt * 0.45);
    if (input.throttleDown) this.throttle = Math.min(1, Math.max(0, this.throttle - dt * 0.45));

    // 速度：目标随油门；无油门输入时缓慢漂回巡航速度（减速板感）
    let targetSpeed = this.minSpeed + this.throttle * (this.maxSpeed - this.minSpeed);
    const noThrottleInput = !input.throttleUp && !input.throttleDown;
    if (noThrottleInput) {
      targetSpeed = this.speed + (this.cruiseSpeed - this.speed) * Math.min(1, dt * 0.4);
    }
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 1.5);

    // 俯冲额外加速（街机特色：机头朝下加速、朝上减速，轻度能量感）
    // diveAccel=0 时完全跳过，Bf109 等未配置机型走原版纯油门模型
    if (this.diveAccel > 0) {
      const fwd = this.getForward();
      const diveFactor = -fwd.y;  // 机头朝下为正(0~1)，朝上为负(-1~0)
      if (diveFactor !== 0) {
        this.speed += diveFactor * this.diveAccel * dt;
        // 软限：允许俯冲超速 15%，爬升不低于 minSpeed×0.85（街机友好，不致失速坠毁）
        const hardMax = this.maxSpeed * 1.15;
        const hardMin = this.minSpeed * 0.85;
        if (this.speed > hardMax) this.speed = hardMax;
        if (this.speed < hardMin) this.speed = hardMin;
      }
    }

    // 当前姿态：滚转角（仅用于滚转-偏航耦合，取 right 轴在水平面的倾斜）
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    const rollAngle = Math.atan2(right.y, 1);

    // 低速时俯仰舵效衰减（保证筋斗顶部低速仍能继续翻转，下限 0.6）
    const pitchEff = 0.6 + 0.4 * Math.min(1, this.speed / this.maxSpeed);

    // 角速度指数趋近目标（松杆回零），1-exp(-k*dt) 帧率无关
    const kPitch = 1 - Math.exp(-this.pitchResp * dt);
    const kRoll  = 1 - Math.exp(-this.rollResp * dt);
    const kYaw   = 1 - Math.exp(-this.yawResp * dt);
    const pitchTarget = input.pitch * this.pitchMax * pitchEff;
    const rollTarget  = input.roll  * this.rollMax;
    let   yawTarget   = input.yaw   * this.yawMax;

    // 滚转-偏航耦合：滚转角越大自动带一点偏航，转弯更自然。
    // 但俯仰角速度大时（正在筋斗）禁用，避免 rollAngle 在垂直姿态附近跳变
    // 导致偏航突变、瞬间扭成倒飞。
    if (this.enableCoupling && Math.abs(this.angVel.x) < 0.3) {
      yawTarget += Math.sin(rollAngle) * 0.45;
    }

    this.angVel.x += (pitchTarget - this.angVel.x) * kPitch;
    this.angVel.z += (rollTarget  - this.angVel.z) * kRoll;
    this.angVel.y += (yawTarget   - this.angVel.y) * kYaw;

    // G 力软限：俯仰角速度变化率封顶，防止瞬间拉杆掉头
    const gLim = this.pitchMax * 1.6;
    if (this.angVel.x >  gLim) this.angVel.x =  gLim;
    if (this.angVel.x < -gLim) this.angVel.x = -gLim;
    // 估算 G 力（1G 基线 + 俯仰角速度比例），供 HUD 显示
    this.gForce = 1 + Math.abs(this.angVel.x) / this.pitchMax * 5;

    // 应用姿态：全部绕本地轴（俯仰=本地X机翼轴，偏航=本地Y，滚转=本地Z）。
    // 四元数乘法连续无跳变；升降舵俯仰就是绕机翼轴，符合物理。
    if (this.angVel.x) this.root.rotateX(this.angVel.x * dt);
    if (this.angVel.y) this.root.rotateY(this.angVel.y * dt);
    if (this.angVel.z) this.root.rotateZ(this.angVel.z * dt);

    // 前飞
    const forward = this.getForward();
    this.root.position.addScaledVector(forward, this.speed * dt);

    // 重力 / 升力（街机版）：升力始终沿世界 Y 向上，随速度变化。
    // 不做倒飞升力反向（街机模式允许自由筋斗/滚转，不惩罚倒飞）。
    if (this.enableGravity) {
      const lift = this.speed * this.liftK;
      const sink = this.gravity - lift; // 正=下沉
      this.root.position.y -= sink * dt;
    }

    // 失速判定 + 抖动
    this.stall = this.speed < this.stallThreshold;
    if (this.stall) {
      this._stallTimer += dt;
      // 机身轻微抖动 + 额外下沉
      this.root.position.y += Math.sin(this._stallTimer * 30) * 0.05;
      this.root.position.y -= (this.stallThreshold - this.speed) * 0.05 * dt * 60;
    }

    // 撞地坠毁：按真实地形高度判断（低速轻触地不算坠毁，贴地滑行）
    const p = this.root.position;
    const groundH = this.terrain ? this.terrain.getHeight(p.x, p.z) : 0;
    if (p.y < groundH + 2) {
      p.y = groundH + 2;
      if (this.speed > this.minSpeed * 1.5) { this._crash(); return; }
    }

    // 障碍物坠毁
    if (this.obstacles.length) {
      for (const o of this.obstacles) {
        if (o.box.containsPoint(p)) { this._crash(); return; }
      }
    }
  }

  // ---------- 坠毁 / 爆炸 ----------
  /** HP=0：开始冒烟坠毁。平滑转入俯冲（非瞬间跳变），带随机偏航/滚转让每架坠毁姿态不同。*/
  _startCrash() {
    this.crashed = true;
    this._exploded = false;
    this._crashTimer = 0;
    this.crashShake = 0.4;
    this._crashDamage = 0;
    this._crashFallTime = 0;
    this.angVel.set(0, 0, 0);

    // ── dive 模式：两阶段下坠 ──
    // 阶段1（2-6s）：从当前姿态平滑过渡到目标俯冲姿态（20-50° 随机）
    // 阶段2（过渡完成后）：姿态锁定，速度加速到 80% 极速
    this._crashMode = 'dive';

    // 随机目标俯冲角度：20-50° 机头朝下
    const diveAngle = THREE.MathUtils.degToRad(20 + Math.random() * 30);
    // 当前前向水平分量（保留原飞行方向）
    const fwd = this.getForward();
    const fwdHorz = new THREE.Vector3(fwd.x, 0, fwd.z);
    if (fwdHorz.lengthSq() < 1e-4) fwdHorz.set(0, 0, -1);
    fwdHorz.normalize();

    // 初始速度：保持当前飞行速度，方向跟随当前机头朝向
    const currentSpeed = Math.max(this.speed, 20);
    this._crashVel.set(fwd.x * currentSpeed, fwd.y * currentSpeed, fwd.z * currentSpeed);
    // 目标速度：80% 极速（过渡完成后加速到此）
    const fullSpeed = 80 + Math.random() * 60;
    this._crashTargetSpeed = fullSpeed * 0.8;    // 64-112
    this._crashAccel = 15 + Math.random() * 10;  // 加速度 15-25
    this._crashSpeed = 0;
    this._crashSinkRate = 0;
    this._crashPitchRate = 0;
    this._crashRollRate = 0;
    this._crashYawRate = 0;

    // ── 阶段1：姿态过渡参数 ──
    // 记录起始姿态（slerp 起点）
    this._crashStartQ.copy(this.root.quaternion);
    // 构造目标俯冲姿态：机头朝 diveAngle 角度下方 + 随机偏航/滚转
    const diveDir = new THREE.Vector3(
      fwdHorz.x * Math.cos(diveAngle),
      -Math.sin(diveAngle),
      fwdHorz.z * Math.cos(diveAngle)
    ).normalize();
    const baseQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), diveDir);
    const randYaw   = THREE.MathUtils.degToRad((Math.random() - 0.5) * 60);  // 偏航 ±30°
    const randRoll  = THREE.MathUtils.degToRad((Math.random() - 0.5) * 120);  // 滚转 ±60°
    const offsetQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, randYaw, randRoll, 'YXZ')
    );
    this._crashTargetQ.copy(baseQ).multiply(offsetQ);
    // 过渡时长 2-6s 随机
    this._crashTransition = 0;
    this._crashTransitionDur = 2 + Math.random() * 4;

    // 70% 几率伴随橙红色火焰
    this._crashHasFire = Math.random() < 0.7;
    // 螺旋桨坠毁后渐停：初始 40% 转速，~3 秒衰减到 0
    this._crashPropDecay = 1.0;

    // 机炮击落：生成大块黑灰色翻转碎片（20mm 撕裂蒙皮/结构件视觉表现）
    // 区别于 _explode() 的爆炸小碎片：尺寸更大、翻转更剧烈、寿命更长
    if (this._killedByExplosive) {
      this._spawnLargeDebris(this.root.position);
    }

    this.speed = 0;
  }

  /**
   * 机炮击落大碎片：8-14 个大块黑/灰碎片，从机身位置四散飞出 + 翻转 + 重力下坠。
   * 模拟 20mm MG 151/20 高爆弹撕裂蒙皮、结构件脱落的效果。
   * 与 _spawnDebris（爆炸小碎片）区分：尺寸更大、颜色更深、翻转更剧烈、寿命更长。
   */
  _spawnLargeDebris(pos) {
    const n = 8 + Math.floor(Math.random() * 7);  // 8-14 个
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: _largeDebrisColors[i % _largeDebrisColors.length],
        transparent: true, opacity: 1.0,
      });
      const m = new THREE.Mesh(_largeDebrisGeo, mat);
      m.position.copy(pos);
      // 尺寸：1.5-3.5（比爆炸碎片 0.5-2.0 大）
      m.scale.setScalar(1.5 + Math.random() * 2.0);
      // 随机初始旋转
      m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      m.renderOrder = 3;
      this.scene.add(m);
      this._debris.push({
        mesh: m,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 80,    // 水平四散
          Math.random() * 50 + 15,        // 向上飞出（撕裂感）
          (Math.random() - 0.5) * 80
        ),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 10,     // 翻转角速度（比爆炸碎片 8 更剧烈）
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10
        ),
        life: 3.0 + Math.random() * 2.0,  // 3-5 秒（比爆炸碎片 2-3.5s 更长）
        maxLife: 5.0,
      });
    }
  }

  /** 立即爆炸（模型隐藏，强化爆炸+碎片）。用于撞地/撞障碍/空中累计伤害>20 */
  _explode() {

    this.crashed = true;
    this._exploded = true;
    this._crashTimer = 3.0;
    this.crashShake = 1.5;
    this.angVel.set(0, 0, 0);
    this.speed = 0;
    if (this.model) this.model.visible = false;
    // 喷火的螺旋桨 rig 挂在 this.root 下（不在 model 下），需同步隐藏
    for (const rig of this._propRigs) rig.visible = false;
    // 清理损伤烟雾/火焰（由爆炸火光烟团取代，避免粒子残留冻结）
    for (const s of this._damageSmoke) this.scene.remove(s.mesh);
    this._damageSmoke = [];
    for (const f of this._damageFire) this.scene.remove(f.mesh);
    this._damageFire = [];
    this._spawnExplosion(this.root.position);
    this._spawnDebris(this.root.position);
  }

  /** 撞地/撞障碍：立即爆炸（保留旧接口名，内部委托 _explode）*/
  _crash() { if (!this._exploded) this._explode(); }

  _updateCrash(dt) {
    this.crashShake = Math.max(0, this.crashShake - dt * 2.5);

    if (!this._exploded) {
      this._crashFallTime += dt;

      if (this._crashMode === 'dive') {
        // ---- 两阶段下坠 ----
        this._crashTransition += dt / this._crashTransitionDur;
        if (this._crashTransition < 1) {
          // 阶段1：姿态过渡（2-6s）—— slerp + smoothstep 从当前姿态平滑过渡到目标俯冲姿态
          const t = this._crashTransition;
          const eased = t * t * (3 - 2 * t);  // smoothstep ease-in-out
          this.root.quaternion.slerpQuaternions(this._crashStartQ, this._crashTargetQ, eased);
          // 速度方向跟随机头朝向变化（大小保持当前速度）
          const fwd = this.getForward();
          const spd = this._crashVel.length();
          this._crashVel.set(fwd.x * spd, fwd.y * spd, fwd.z * spd);
        } else {
          // 阶段2：加速下坠 —— 姿态锁定，速度加速到 80% 极速
          this.root.quaternion.copy(this._crashTargetQ);
          const currentSpd = this._crashVel.length();
          if (currentSpd < this._crashTargetSpeed && currentSpd > 0.1) {
            const factor = 1 + (this._crashAccel / currentSpd) * dt;
            this._crashVel.multiplyScalar(factor);
          }
          // 速度方向跟随锁定姿态
          const fwd = this.getForward();
          const spd = this._crashVel.length();
          this._crashVel.set(fwd.x * spd, fwd.y * spd, fwd.z * spd);
        }
        // 位置更新
        this.root.position.addScaledVector(this._crashVel, dt);
      } else if (this._crashMode === 'struggle') {
        // ---- 挣扎前飞：沿机头水平方向前飞 + 加速下降 + 小幅振荡 ----
        this._crashSpeed *= (1 - dt * 0.04);
        const fwd = this.getForward();
        this.root.position.x += fwd.x * this._crashSpeed * dt;
        this.root.position.z += fwd.z * this._crashSpeed * dt;
        this._crashVel.y += this._crashSinkRate * dt;
        this.root.position.y -= this._crashVel.y * dt;
        this.root.rotateZ(Math.sin(this._crashFallTime * 2.5) * this._crashRollRate * dt);
        this.root.rotateY(Math.sin(this._crashFallTime * 1.8) * this._crashYawRate * dt);
        this.root.rotateX((-this._crashPitchRate + Math.sin(this._crashFallTime * 3) * 0.15) * dt);
      } else {
        // ---- 弹道坠毁：保留前向动量 + 重力抛物线下坠 + 机头缓慢下垂 ----
        this._crashVel.multiplyScalar(1 - dt * 0.05);
        this._crashVel.y -= this._crashSinkRate * dt;
        this.root.position.addScaledVector(this._crashVel, dt);
        const noseDown = -this.getForward().y;
        if (noseDown < 0.9) this.root.rotateX(-this._crashPitchRate * dt);
        this.root.rotateZ(Math.sin(this._crashFallTime * 2.5) * this._crashRollRate * dt);
        this.root.rotateY(Math.sin(this._crashFallTime * 1.8) * this._crashYawRate * dt);
      }

      // 撞地 → 爆炸
      const p = this.root.position;
      const groundH = this.terrain ? this.terrain.getHeight(p.x, p.z) : 0;
      if (p.y < groundH + 2) { p.y = groundH + 2; this._explode(); }
      // 安全阀：超长时间未触地（异常情况）强制爆炸，避免永不重生
      else if (this._crashFallTime > 30) this._explode();

      // 冒烟 + 火焰（坠毁中效果加重；爆炸当帧已清理由 _explode 处理）
      if (!this._exploded) this._updateDamageEffects(dt, true);
    } else {
      // ---- 已爆炸：仅粒子倒计时 ----
      this._crashTimer -= dt;
    }

    // ---- 更新爆炸粒子 ----
    for (let i = this._explosions.length - 1; i >= 0; i--) {
      const p = this._explosions[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 0.8);            // 阻尼
      p.mesh.scale.multiplyScalar(1 + dt * p.growth);
      p.mesh.material.opacity = Math.max(0, p.life / p.maxLife) * p.baseOpacity;
      if (p.life <= 0) { this.scene.remove(p.mesh); this._explosions.splice(i, 1); }
    }

    // ---- 更新碎片 ----
    for (let i = this._debris.length - 1; i >= 0; i--) {
      const d = this._debris[i];
      d.life -= dt;
      d.vel.y -= this.gravity * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      d.mesh.material.opacity = Math.max(0, d.life / d.maxLife);
      // 火光 Sprite 跟随碎片位置 + 缩小淡出
      if (d.fireSprite) {
        d.fireSprite.position.copy(d.mesh.position);
        const k = Math.max(0, d.life / d.maxLife);
        d.fireSprite.material.opacity = k * 0.9;
        d.fireSprite.scale.multiplyScalar(1 - dt * 0.4);
      }
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        if (d.fireSprite) this.scene.remove(d.fireSprite);
        this._debris.splice(i, 1);
      }
    }

    // 仅在已爆炸且粒子倒计时归零时才重生（坠落未触地前不重生，与坠落过程解耦）
    // 敌机 autoRespawn=false，由 main.js 编队级重生管理（2 架都死后一起重生）
    if (this._exploded && this._crashTimer <= 0 && this.autoRespawn) this.reset();
  }

  /** 击落瞬间小爆燃：几个火光 + 3-5 块碎块飞溅，不隐藏模型，仅视觉提示被击毁 */
  _spawnKillFlash() {
    const pos = this.root.position.clone();
    const fireTex = _getDmgFireTex();
    // 3-5 个小火光 Sprite（快速膨胀+淡出）
    const nFire = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nFire; i++) {
      const mat = new THREE.SpriteMaterial({
        map: fireTex, color: 0xff8833, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.position.copy(pos);
      s.scale.setScalar(2 + Math.random() * 2);
      s.renderOrder = 18;
      this.scene.add(s);
      this._explosions.push({
        mesh: s, vel: new THREE.Vector3((Math.random()-0.5)*20, (Math.random()-0.3)*20, (Math.random()-0.5)*20),
        life: 0.3 + Math.random() * 0.2, maxLife: 0.5, baseOpacity: 0.9, growth: 4.0,
      });
    }
    // 3-5 块碎块飞溅（小尺寸，用现有碎片几何体）
    const nDebris = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nDebris; i++) {
      const geo = _debrisGeos[Math.floor(Math.random() * _debrisGeos.length)];
      const mat = new THREE.MeshBasicMaterial({
        color: _debrisColors[i % _debrisColors.length], transparent: true, opacity: 1.0,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos);
      m.scale.setScalar(0.3 + Math.random() * 1.0);
      m.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      m.renderOrder = 3;
      this.scene.add(m);
      this._debris.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random()-0.5)*50, Math.random()*30+10, (Math.random()-0.5)*50),
        spin: new THREE.Vector3((Math.random()-0.5)*8, (Math.random()-0.5)*8, (Math.random()-0.5)*8),
        life: 1.5 + Math.random() * 1.0, maxLife: 2.5,
        fireSprite: null,
      });
    }
  }

  /** 强化爆炸：中心闪光 + 火焰团 + 烟雾 + 火星 + 冲击波 */
  _spawnExplosion(pos) {
    const fireTex = _getDmgFireTex();
    const smokeTex = _getDmgSmokeTex();

    // 0) 中心闪光：巨大 additive Sprite，极短寿命，模拟爆炸瞬间白光
    const flashMat = new THREE.SpriteMaterial({
      map: fireTex, color: 0xffffff, transparent: true, opacity: 1.0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flash = new THREE.Sprite(flashMat);
    flash.position.copy(pos);
    flash.scale.setScalar(4 + Math.random() * 3);
    flash.renderOrder = 20;
    this.scene.add(flash);
    this._explosions.push({
      mesh: flash, vel: new THREE.Vector3(0, 0, 0),
      life: 0.15, maxLife: 0.15, baseOpacity: 1.0, growth: 8.0,
    });

    // 1) 火焰团：15 个大尺寸 additive Sprite（快速膨胀+淡出，一团火焰爆出效果）
    const fireColors = [0xffaa44, 0xff8822, 0xffcc66, 0xff6633];
    for (let i = 0; i < 15; i++) {
      const mat = new THREE.SpriteMaterial({
        map: fireTex, color: fireColors[i % fireColors.length], transparent: true, opacity: 1.0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.position.copy(pos);
      s.scale.setScalar(3 + Math.random() * 4);
      s.renderOrder = 18;
      this.scene.add(s);
      this._explosions.push({
        mesh: s, vel: new THREE.Vector3((Math.random()-0.5)*28, (Math.random()-0.3)*28, (Math.random()-0.5)*28),
        life: 0.5 + Math.random() * 0.4, maxLife: 0.9, baseOpacity: 1.0, growth: 4.0,
      });
    }
    // 2) 烟雾：16 个深灰 Sprite（缓慢膨胀+淡出，持续较久）
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({
        map: smokeTex, color: 0x444444, transparent: true, opacity: 0.8,
        depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.position.copy(pos);
      s.scale.setScalar(1.5 + Math.random() * 3);
      s.renderOrder = 5;
      this.scene.add(s);
      this._explosions.push({
        mesh: s, vel: new THREE.Vector3((Math.random()-0.5)*18, Math.random()*12+4, (Math.random()-0.5)*18),
        life: 1.5 + Math.random() * 1.5, maxLife: 3.0, baseOpacity: 0.8, growth: 1.8,
      });
    }
    // 3) 火星 Mesh 粒子：30 个，大小速度各异，多色
    const geo = new THREE.SphereGeometry(0.8, 8, 8);
    const colors = [0xff5a4d, 0xffb84d, 0xffe07a, 0xff8833, 0xff4422, 0xffcc88];
    for (let i = 0; i < 30; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length], transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos);
      m.scale.setScalar(0.4 + Math.random() * 1.0);
      m.renderOrder = 19;
      this.scene.add(m);
      const spd = 28 + Math.random() * 42;
      this._explosions.push({
        mesh: m, vel: new THREE.Vector3((Math.random()-0.5)*spd, (Math.random()-0.2)*spd, (Math.random()-0.5)*spd),
        life: 0.6 + Math.random() * 0.6, maxLife: 1.2, baseOpacity: 0.95, growth: 1.8,
      });
    }
  }

  /** 爆炸碎片：多种形状大小零件飞落 + 40% 带火光跟随，大小不一随机飞溅 */
  _spawnDebris(pos) {
    const n = 35 + Math.floor(Math.random() * 20);  // 35-55 个各种零件
    const fireTex = _getDmgFireTex();
    for (let i = 0; i < n; i++) {
      // 随机选择几何体形状（小碎块/大碎块/长条/扁平蒙皮）
      const geo = _debrisGeos[Math.floor(Math.random() * _debrisGeos.length)];
      const mat = new THREE.MeshBasicMaterial({
        color: _debrisColors[i % _debrisColors.length], transparent: true, opacity: 1.0,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos);
      // 尺寸变化大：从小碎片 0.2 到大结构件 4.0，多数偏小
      const sizeRoll = Math.random();
      const sz = sizeRoll < 0.6 ? 0.2 + Math.random() * 0.8 : 1.0 + Math.random() * 3.0;
      m.scale.setScalar(sz);
      m.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      m.renderOrder = 3;
      this.scene.add(m);
      // 速度随尺寸变化：小碎片飞得快，大碎片飞得慢
      const speedFactor = sz < 1.0 ? 1.5 : 0.6;
      const d = {
        mesh: m,
        vel: new THREE.Vector3(
          (Math.random()-0.5)*80*speedFactor,
          Math.random()*50*speedFactor + 10,
          (Math.random()-0.5)*80*speedFactor,
        ),
        spin: new THREE.Vector3(
          (Math.random()-0.5)*10,
          (Math.random()-0.5)*10,
          (Math.random()-0.5)*10,
        ),
        life: 2.0 + Math.random() * 2.5, maxLife: 4.5,
        fireSprite: null,
      };
      // 40% 的碎片带火光跟随（大碎片更高概率带火）
      if (Math.random() < (sz > 1.5 ? 0.6 : 0.3)) {
        const fireMat = new THREE.SpriteMaterial({
          map: fireTex, color: 0xff7722, transparent: true, opacity: 0.9,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        d.fireSprite = new THREE.Sprite(fireMat);
        d.fireSprite.scale.setScalar(1.2 + Math.random() * 2.0);
        d.fireSprite.renderOrder = 18;
        this.scene.add(d.fireSprite);
      }
      this._debris.push(d);
    }
  }

  // ---------- 损伤效果（冒烟 + 火焰）----------
  /**
   * 更新损伤视觉效果。
   * @param dt 帧时间
   * @param crashing 是否坠毁中（true=重度烟雾+火焰，false=轻度冒烟）
   */
  _updateDamageEffects(dt, crashing) {
    // 坠毁中 2s 后烟雾增强：浓度×2.5、尺寸×2.5、拖尾×2.5（1s 内平滑过渡）
    let smokeScale = 1.0, trailScale = 1.0;
    if (crashing && this._crashFallTime > 2.0) {
      const t = Math.min(1, (this._crashFallTime - 2.0) / 1.0);
      smokeScale = 1.0 + 1.5 * t;
      trailScale = 1.0 + 1.5 * t;
    }
    // 烟雾发射
    this._dmgSmokeTimer -= dt;
    if (this._dmgSmokeTimer <= 0) {
      this._dmgSmokeTimer = (crashing ? 0.05 : 0.12) / smokeScale;  // 密度增大=间隔缩短
      this._spawnDamageSmoke(crashing, smokeScale, trailScale);
    }
    // 火焰发射（仅坠毁中且 _crashHasFire=true，70% 几率有火焰）
    if (crashing && this._crashHasFire) {
      this._dmgFireTimer -= dt;
      if (this._dmgFireTimer <= 0) {
        this._dmgFireTimer = 0.04;
        this._spawnDamageFire();
      }
    }
    // 更新烟雾粒子
    for (let i = this._damageSmoke.length - 1; i >= 0; i--) {
      const s = this._damageSmoke[i];
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.vel.multiplyScalar(1 - dt * 0.8);             // 阻尼
      s.vel.y += dt * 3;                               // 热上升
      s.mesh.scale.multiplyScalar(1 + dt * 1.2);       // 膨胀
      s.mesh.material.opacity = Math.max(0, s.life / s.maxLife) * s.baseOpacity;
      if (s.life <= 0) { this.scene.remove(s.mesh); this._damageSmoke.splice(i, 1); }
    }
    // 更新火焰粒子
    for (let i = this._damageFire.length - 1; i >= 0; i--) {
      const f = this._damageFire[i];
      f.life -= dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.scale.multiplyScalar(1 - dt * 1.5);       // 缩小
      f.mesh.material.opacity = Math.max(0, f.life / f.maxLife) * 0.9;
      if (f.life <= 0) { this.scene.remove(f.mesh); this._damageFire.splice(i, 1); }
    }
  }

  /** 从机身中段冒烟（smokeScale/trailScale 用于坠毁中 2s 后增强效果）
   *  坠毁中（heavy=true）生成两层烟雾：主黑烟 + 小浅烟（层次感）
   *  有火光时（_crashHasFire）额外生成少量白烟 */
  _spawnDamageSmoke(heavy, smokeScale = 1.0, trailScale = 1.0) {
    const fwd = this.getForward();
    // 机身中段 body frame 偏移（机身上方+机头后方）
    const off = new THREE.Vector3(0, 1.5, -3).applyQuaternion(this.root.quaternion).add(this.root.position);

    // ---- 主黑烟粒子（拉烟更长、透明度略降） ----
    // _whiteSmoke=true 时改用白色轻烟（长机负伤离场剧情专用）
    const isWhite = this._whiteSmoke;
    const mat = new THREE.SpriteMaterial({
      map: _getDmgSmokeTex(),
      color: isWhite ? 0xeeeeee : (heavy ? 0x222222 : 0x666666),
      transparent: true, opacity: isWhite ? 0.25 : (heavy ? 0.5 : 0.3),
      depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(off);
    s.scale.setScalar((isWhite ? 1.2 + Math.random() * 0.6 : (heavy ? 2.5 + Math.random() * 1.5 : 1.5 + Math.random())) * smokeScale);
    s.renderOrder = 5;
    this.scene.add(s);
    this._damageSmoke.push({
      mesh: s,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 5 - fwd.x * 15 * trailScale,   // 10→15 拉烟更长
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 5 - fwd.z * 15 * trailScale,
      ),
      life: isWhite ? 1.0 + Math.random() * 0.6 : (heavy ? 1.5 + Math.random() : 0.8 + Math.random() * 0.5),
      maxLife: 2.5, baseOpacity: isWhite ? 0.25 : (heavy ? 0.5 : 0.3),
    });

    // ---- 浅色小烟粒子（坠毁中才生成，增加烟雾层次） ----
    if (heavy) {
      const mat2 = new THREE.SpriteMaterial({
        map: _getDmgSmokeTex(),
        color: 0x444444, transparent: true, opacity: 0.3, depthWrite: false,
      });
      const s2 = new THREE.Sprite(mat2);
      s2.position.copy(off);
      s2.scale.setScalar((1.5 + Math.random() * 0.8) * smokeScale);
      s2.renderOrder = 5;
      this.scene.add(s2);
      this._damageSmoke.push({
        mesh: s2,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 3 - fwd.x * 18 * trailScale,   // 更长拉烟
          Math.random() * 2 + 0.5,
          (Math.random() - 0.5) * 3 - fwd.z * 18 * trailScale,
        ),
        life: 1.0 + Math.random() * 0.8, maxLife: 2.0, baseOpacity: 0.3,
      });
    }

    // ---- 白烟粒子（有火光时生成，较少） ----
    if (heavy && this._crashHasFire && Math.random() < 0.4) {
      const matW = new THREE.SpriteMaterial({
        map: _getDmgSmokeTex(),
        color: 0xaaaaaa, transparent: true, opacity: 0.35, depthWrite: false,
      });
      const sw = new THREE.Sprite(matW);
      sw.position.copy(off);
      sw.scale.setScalar((2.0 + Math.random()) * smokeScale);
      sw.renderOrder = 5;
      this.scene.add(sw);
      this._damageSmoke.push({
        mesh: sw,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 4 - fwd.x * 16 * trailScale,
          Math.random() * 2 + 1.5,   // 白烟上升更快
          (Math.random() - 0.5) * 4 - fwd.z * 16 * trailScale,
        ),
        life: 1.2 + Math.random() * 0.6, maxLife: 2.0, baseOpacity: 0.35,
      });
    }
  }

  /** 坠毁火焰（机身到机尾距离内随机位置） */
  _spawnDamageFire() {
    const mat = new THREE.SpriteMaterial({
      map: _getDmgFireTex(), color: 0xff7722,
      transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    // 火光位置：机身到机尾距离内随机（body frame z: 0=机头, -8=机尾），Y 上移到机身
    const zOff = -Math.random() * 8;
    const off = new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.2, zOff)
      .applyQuaternion(this.root.quaternion).add(this.root.position);
    s.position.copy(off);
    s.scale.setScalar(3.0 + Math.random() * 4.0);
    s.renderOrder = 18;
    this.scene.add(s);
    this._damageFire.push({
      mesh: s,
      vel: new THREE.Vector3((Math.random() - 0.5) * 12, Math.random() * 8 + 3, (Math.random() - 0.5) * 12),
      life: 0.4 + Math.random() * 0.3, maxLife: 0.7,
    });
  }

  reset() {
    // 清理残留爆炸/损伤/碎片粒子
    for (const p of this._explosions) this.scene.remove(p.mesh);
    this._explosions = [];
    for (const s of this._damageSmoke) this.scene.remove(s.mesh);
    this._damageSmoke = [];
    for (const f of this._damageFire) this.scene.remove(f.mesh);
    this._damageFire = [];
    for (const d of this._debris) { this.scene.remove(d.mesh); if (d.fireSprite) this.scene.remove(d.fireSprite); }
    this._debris = [];
    this.crashed = false;
    this._exploded = false;
    this._crashTimer = 0;
    this._crashDamage = 0;
    this._crashFallTime = 0;
    this._crashMode = 'ballistic';
    this._crashSpeed = 0;
    this._crashSinkRate = 0;
    this._crashTransition = 0;       // dive 姿态过渡进度归零
    this._crashTransitionDur = 1.5;  // 过渡时长恢复默认（下次 _startCrash 会重新随机）
    this.crashShake = 0;
    this._killedByExplosive = false;  // 重置机炮击落标记
    this.hp = this.maxHp;
    if (this.model) this.model.visible = true;
    // 恢复螺旋桨 rig 可见性（喷火 rig 挂在 this.root 下）
    for (const rig of this._propRigs) rig.visible = true;
    this.root.position.set(0, 1500, 0);
    this.root.quaternion.identity();
    this.angVel.set(0, 0, 0);
    this.gForce = 1.0;
    this.stall = false;
    this._stallTimer = 0;
    this.speed = this.minSpeed + this.throttle * (this.maxSpeed - this.minSpeed);
    if (this.vaporTrail) this.vaporTrail.dispose();  // 重生时清空拉烟粒子
  }

  update(dt) {
    this._updateSurfaces(dt); // 先驱动舵面
    // 坠毁后螺旋桨渐停：衰减因子 1.0→0（~3 秒）
    if (this.crashed && this._crashPropDecay > 0) {
      this._crashPropDecay = Math.max(0, this._crashPropDecay - dt * 0.35);
    }
    if (this.mixer) {
      this.mixer.update(dt);
      if (this.propAction) {
        // 坠毁后螺旋桨减速到 30% 再渐停；正常时全速
        this.propAction.timeScale = this.crashed
          ? this.propMultiplier * this._crashPropDecay * 0.3
          : this.propMultiplier;
      }
    }
    this._updatePropAuto();
    // 桨叶固定高速旋转（yak1/yak3/He 111 等无螺旋桨动画轨道的敌机，桨叶挂在 _propPivots）：
    // 单发机型 1 个 pivot；双发机型 2 个 pivot（左右各自旋转）
    // 坠毁后减速到 40% 再渐停，而非瞬间停转
    // 转速由 _propSpinSpeed 决定（默认 PROP_SPIN=300；喷火 95）
    if (this._propPivots.length) {
      const spin = this.crashed
        ? this._propSpinSpeed * this._crashPropDecay * 0.4
        : this._propSpinSpeed;
      for (let i = 0; i < this._propPivots.length; i++) this._propPivots[i].rotateZ(spin * dt);
    }
    // 坠毁后隐藏模糊盘（桨已停转，无模糊效果）
    if (this._propBlurDiscs.length) {
      const discVisible = !this.crashed;
      for (const d of this._propBlurDiscs) d.visible = discVisible;
    }
    // 损伤冒烟：未坠毁但 HP ≤ 阈值时，机身中段冒轻度黑灰透明烟
    // （坠毁中的重度烟+火焰由 _updateCrash → _updateDamageEffects(dt,true) 负责）
    if (!this.crashed && this.hp > 0 && this.hp <= this.smokeThreshold) {
      this._updateDamageEffects(dt, false);
    }
    // 翼尖拉烟（高 G 机动时翼尖涡流凝结；noVaporTrail 禁用，如苏联老飞机 I-153/I-16）
    // 高度窗可用 _vaporAltMin/_vaporAltMax 覆盖（柏林高空关，缺省 600-4500 原行为）
    if (!this.vaporTrail && !this.noVaporTrail) {
      this.vaporTrail = new VaporTrail(this.scene, this, {
        minAlt: this._vaporAltMin, maxAlt: this._vaporAltMax,
      });
    }
    if (this.vaporTrail) this.vaporTrail.update(dt);
  }
}
