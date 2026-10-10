import * as THREE from 'three';
import { Aircraft } from './aircraft.js';
import { Weapons } from './weapons.js';

// 复用临时向量（避免每帧 new）
const _UP = new THREE.Vector3(0, 1, 0);
const _toP = new THREE.Vector3();
const _local = new THREE.Vector3();
const _toT = new THREE.Vector3();
const _localT = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _center = new THREE.Vector3(0, 700, 0); // 中央巡逻区域的中心
const _toW = new THREE.Vector3();          // 僚机编队目标点
const _playerRight = new THREE.Vector3();   // 玩家右方向（支援方向计算）
const _supportTarget = new THREE.Vector3(); // 支援目标点
const _loiterTarget = new THREE.Vector3(); // 盘旋飞向点临时目标（避免污染共享的 _center）
const _bomberTarget = new THREE.Vector3(); // 攻击轰炸机时的占位目标点
const _bomberFwd = new THREE.Vector3();    // 轰炸机前向（临时）
const _SUPPORT_DIRS = ['rear', 'top', 'left', 'right'];

/**
 * 敌机模型校准注册表：按模型 URL 注入朝向/缩放/枪口参数（在 load(url) 时应用）。
 * - 已校准模型（如 Yak-9）：手动偏航值 + 校准枪口（由 tune_enemy.html 调出）。
 * - 新增模型：默认 autoOrient=true（按螺旋桨节点质心自动对齐 -Z），后续可调校后覆盖。
 * 未列出的模型沿用 Enemy 构造函数默认值（autoOrient=true + 通用枪口）。
 *
 * userScale 按真实尺寸比例计算（以玩家 Bf 109 为基准）：
 *   userScale = 3.6 * real_longest / 9.92
 *   real_longest = max(长度, 翼展)，9.92m = Bf 109 翼展（其最长维）
 *   _normalize() 将模型最长维归一化到 9 单位，userScale 再等比放大，
 *   保证所有飞机在场景中的 units/meter 一致（≈3.266 单位/米）。
 *
 * 真实数据：Bf 109(8.85m/9.92m) | Yak-9(8.6m/9.7m) | I-153(6.1m/9.75m) | I-16(5.99m/9.0m)
 */
export const MODEL_CONFIGS = {
  '/model/yak9.glb': {
    autoOrient: false,  // 手动偏航（模型导出朝向偏 139°，由 tune_enemy.html 调出）
    yawOffset: -139, pitchOffset: 0, rollOffset: 0,
    userScale: 3.52,     // 9.7/9.92 * 3.6
    muzzleOffsets: [
      new THREE.Vector3( 6.50, -1.35, -4.15),  // 右机翼
      new THREE.Vector3(-6.50, -1.35, -4.15),  // 左机翼
      new THREE.Vector3( 0.50,  1.00, -7.80),  // 右机头
      new THREE.Vector3(-0.50,  1.00, -7.80),  // 左机头
    ],
  },
  // Polikarpov I-153 "海鸥"（双翼战斗机）：自动朝向，模型自带模糊盘
  '/model/i153.glb': {
    autoOrient: true,
    userScale: 3.54,     // 9.75/9.92 * 3.6
    noVaporTrail: true,  // 苏联老式双翼机，无翼尖拉烟
  },
  // Polikarpov I-16 "小毛驴"（单翼战斗机）：自动朝向，模型自带模糊盘
  '/model/i16.glb': {
    autoOrient: true,
    userScale: 3.27,     // 9.0/9.92 * 3.6
    noVaporTrail: true,  // 苏联老式单翼机，无翼尖拉烟
  },
  // Yakovlev Yak-1（1940 苏联主力，与 Bf 109 E-4 同期，第4-5波压力敌机）
  // 模型带展开起落架 + 静态螺旋桨，需隐藏起落架 + 把螺旋桨节点加入 blur 分支显示
  '/model/yak1.glb': {
    autoOrient: true,
    userScale: 3.63,     // 10.0/9.92 * 3.6
    hideGear: true,      // 触发 _hideLandingGear
    // 用户用 tune_yak_models.html 视觉识别的起落架节点（22 个）
    hideGearNodes: [
      'Line27-FACES_1', 'Line26-FACES_1', 'Line25-FACES_1', 'Torus08-FACES_1',
      'Cylinder28-FACES_1', 'Line08-FACES_1', 'Line09-FACES_1', 'Line03-FACES_1',
      'Torus06-FACES_1', 'stv_gl1-FACES_1', 'stv_gl2-FACES_1', 'Line20-FACES_1',
      'Line04-FACES_1', 'Line19-FACES_1', 'Line02-FACES_1', 'stv_gl04-FACES_1',
      'Line24-FACES_1', 'Line23-FACES_1', 'Line22-FACES_1', 'Line21-FACES_1',
      'stv_gl03-FACES_1', 'Cylinder26-FACES_1',
    ],
    // 螺旋桨静态叶片节点（3 个），加入 propBranches.blur 让 propMode='blur' 时显示
    propNodes: ['Line16-FACES_1', 'Line17-FACES_1', 'Line05-FACES_1'],
  },
  // Yakovlev Yak-7（1942，第6波压力敌机；模型自带模糊盘，处理方式同 Yak-9）
  '/model/yak7.glb': {
    autoOrient: true,
    userScale: 3.63,     // 10.0/9.92 * 3.6
  },
  // Yakovlev Yak-3（1943 轻量化高机动，备用机型；模型带展开起落架需隐藏）
  '/model/yak3.glb': {
    autoOrient: true,
    userScale: 3.34,     // 9.2/9.92 * 3.6
    hideGear: true,
    hideGearNodes: [
      'Object06-FACES_1', 'Object05-FACES_1', 'stvgl01-FACES_1', 'stvgl-FACES_1',
      'Object04-FACES_1', 'Object03-FACES_1', 'Line45-FACES_1', 'Line44-FACES_1',
      'Line43-FACES_1', 'Cylinder32-FACES_1', 'Line42-FACES_1', 'Line41-FACES_1',
      'Line40-FACES_1', 'Torus09-FACES_1', 'Line26-FACES_1', 'Line21-FACES_1',
      'Line27-FACES_1', 'Torus08-FACES_1', 'Cylinder28-FACES_1', 'Line24-FACES_1',
      'Line22-FACES_1', 'Line25-FACES_1',
    ],
    propNodes: ['Line30-FACES_1', 'Line29-FACES_1', 'Line05-FACES_1'],
  },
  // Lavochkin La-5FN（1943 苏联近卫精锐战斗机，库尔斯克第2波精英敌机）
  // 真实翼展 9.80m，userScale=3.60（9.80/9.92 × 3.6 ≈ 3.56，调校台微调至 3.60）
  // autoOrient:false + yawOffset=236.5 手调（autoOrient:true 算出 233.3 不准，手调 236.5 才正）
  // 武器：2×ShVAK 20mm 机炮（机翼前缘），机头 UB 12.7mm 机枪暂未配（精英敌机 2 门 20mm 火力已足）
  '/model/la5.glb': {
    autoOrient: false,
    yawOffset: 236.5, pitchOffset: 0.0, rollOffset: 0.0,
    userScale: 3.60,
    centerOffset: [1.95, 0.00, 0.00],   // body frame 世界单位
    muzzleOffsets: [
      new THREE.Vector3( 0.60, 1.85, -7.55),  // 右机翼 ShVAK 20mm
      new THREE.Vector3(-1.05, 1.85, -7.55),  // 左机翼 ShVAK 20mm
    ],
    hideGear: true,
    hideGearNodes: [
      // 起落架（31 节点，由外部调试工具选出）
      'Torus03-FACES_1', 'Cylinder20-FACES_1', 'Cylinder02_0-FACES_1', 'Cylinder21-FACES_1',
      'Cylinder84-FACES_1', 'Cylinder16-FACES_1', 'Box03-FACES_1', 'Box04-FACES_1',
      'Cylinder103-FACES_1', 'Cylinder101-FACES_1', 'Cylinder100-FACES_1', 'Torus02-FACES_1',
      'Cylinder99-FACES_1', 'Cylinder98-FACES_1', 'Cylinder97-FACES_1', 'Object03-FACES_1',
      'Box06-FACES_1', 'Box05-FACES_1', 'Cylinder109-FACES_1', 'Cylinder108-FACES_1',
      'Cylinder107-FACES_1', 'Cylinder106', 'Object_87', 'Cylinder106-FACES', 'Cylinder106-FACES_1',
      'Cylinder105-FACES_1', 'Cylinder104-FACES_1', 'Torus04-FACES_1',
      'Object06-FACES_1', 'Object02-FACES_1', 'Object05-FACES_1',
      // 飞行员身体（4 节点）
      'lForeArm_0-FACES_1', 'figureHair-FACES_1', 'lHand_01-FACES_1', 'neck_01-FACES_1',
    ],
    // 螺旋桨：vint 节点下 3 片桨叶（Cylinder77/93/94），显式加入 propBranches.blur
    propNodes: ['Cylinder77-FACES_1', 'Cylinder93-FACES_1', 'Cylinder94-FACES_1'],
    propSpinSpeed: 300,        // 高速旋转（默认值，与全局 PROP_SPIN 一致）
    propOpacity: 0.22,         // 桨叶半透明（视觉暂留叠加成模糊感）
    propBlurDisc: true,        // 启用动态模糊盘（黑桨身+黄桨尖径向渐变）
    propBlurStrength: 0.35,   // 模糊盘强度
    propPivotOffset: { x: 0.009, y: 1.019, z: 0.139 },
  },
  // Supermarine Spitfire（1940 英国主力，不列颠战役；第2关"风云不列颠"敌机）
  // 喷火 66 mesh 精细版（2.3MB），起落架隐藏，3 个螺旋桨节点固定高速旋转
  // 朝向为手工调整（autoOrient:false + yawOffset=-124.5，类似 yak9 处理）
  // 8 × .303 勃朗宁 A翼布局枪口（沿用历史布局，待游戏内校准微调）
  '/model/spitfire.glb': {
    autoOrient: false,
    yawOffset: -124.091,    // 调试页面导出的精确值（原 -124.5）
    userScale: 4.08,        // 11.23/9.92 * 3.6（喷火翼展 11.23m，Bf 109 基准 9.92m）
    hideGear: true,         // 触发 _hideLandingGear：模型导出时起落架展开，需隐藏
    hideGearNodes: [
      'Object03-FACES_1','Cylinder07-FACES_1','Cylinder01-FACES_1','Cylinder06-FACES_1',
      'Torus01-FACES_1','Cylinder05-FACES_1','Cylinder82-FACES_1','Cylinder83-FACES_1',
      'Torus04-FACES_1','Cylinder84-FACES_1','Cylinder81-FACES_1','Object02-FACES_1',
      'Cylinder80-FACES_1','Cylinder20-FACES_1','Cylinder02-FACES_1','Torus03-FACES_1',
      'Cylinder16-FACES_1',
    ],
    propNodes: ['Cylinder78-FACES_1','Cylinder79-FACES_1','Cylinder77-FACES_1'],
    propSpinSpeed: 95,       // 喷火桨叶转速（rad/s），低于全局 300 呈现清晰旋转感
    propOpacity: 0.14,       // 桨叶半透明度（配合模糊盘呈现高速旋转效果）
    propBlurDisc: true,      // 启用动态模糊盘（黑桨身 + 黄桨尖径向渐变）
    propBlurStrength: 0.35,  // 模糊盘强度（0=关，1=最大）
    propAxisTilt: { x: 0, y: 0 },     // 旋转轴倾斜修正（度），0=不修正
    propPivotOffset: { x: 0, y: 0, z: 0 }, // 桨毂圆心偏移（模型局部空间）
    // A翼布局：8 × .303 勃朗宁（4左+4右机翼前缘），历史真实火力
    // 枪口位置由 model_tuner.html 校准台精调（沿机翼前缘分布，翼尖外移）
    muzzleOffsets: [
      new THREE.Vector3( 12.05, -0.30, -6.80),  // 右翼外
      new THREE.Vector3(  9.20, -0.60, -7.00),  // 右翼中外
      new THREE.Vector3(  8.40, -0.70, -7.05),  // 右翼中内
      new THREE.Vector3(  6.50, -0.90, -7.05),  // 右翼内
      new THREE.Vector3(-6.35, -0.95, -6.85),  // 左翼内
      new THREE.Vector3(-8.30, -0.75, -6.70),  // 左翼中内
      new THREE.Vector3(-9.05, -0.70, -6.65),  // 左翼中外
      new THREE.Vector3(-11.85, -0.30, -6.30),  // 左翼外
    ],
  },
  // Junkers Ju 87 B "斯图卡"（德国俯冲轰炸机，库尔斯克战役友军编队演出用）
  // 单发，真实翼展 13.8m、长度 11.5m（机身约为 Bf 109 的 1.15 倍），userScale=4.14
  // 朝向为手工调整（autoOrient:false 防止 _autoOrient 覆盖 yawOffset）
  // 螺旋桨/起落架不做处理（演出用纯视觉，桨叶静态可接受）；如需动态桨后续再补
  '/model/ju87.glb': {
    // 模型原生机头在 +Z，yawOffset=270° 将机头旋到 -Z（body frame 前方）并左转对齐
    autoOrient: false,
    yawOffset: 270.0, pitchOffset: 0.0, rollOffset: 0.0,
    userScale: 4.14,  // 13.8/9.92 * 3.6（Ju 87B 翼展 13.8m，Bf 109 基准 9.92m）
    // 性能优化：高空编队演出，阴影/拉烟对画面贡献极小但开销巨大（112 mesh × 10 架）
    castShadow: false,    // 关闭阴影 pass（砍掉 ~1120 draw call）
    noVaporTrail: true,   // 关闭翼尖拉烟检查（巡航速度 80 < 触发阈值 83.3，本就不触发）
  },
  // Ilyushin Il-2 M3 "斯图莫维克"（苏联单发双座强击机，库尔斯克第3波敌机）
  // 真实翼展 14.6m、长度 11.6m；userScale=3.60（调校台视觉校准，模型原寸偏大故缩小）
  // autoOrient:false + yawOffset=242 手调（autoOrient:true 算出 248.5 不准，手调 242 才正）
  '/model/il2.glb': {
    autoOrient: false,
    yawOffset: 242.0, pitchOffset: 0.0, rollOffset: 0.0,
    userScale: 3.60,
    centerOffset: [2.15, 0.00, 0.00],  // body frame 世界单位
  // 武器：2×ShVAK 20mm（机翼前射）+ 1×UB 12.7mm（后座自卫炮塔）
  // 后座炮塔射界按 IL-2M3 史料：UBT 12.7mm 人工操作，方位左右各约 30-40°，上仰至 60°
  // 正后方被垂直尾翼遮挡 → 低角度正后盲区；有效射界为两个斜后上扇形覆盖
  // 用 5 个虚拟朝向（同一枪口位置，不同方向）模拟炮塔扫射，轮换发射：
  //   斜后左上/斜后右上（主覆盖）+ 正后高上（避开尾翼抬高打）+ 斜后左平/斜后右平（延伸水平）
  //   正后低角度不配 → 尾翼盲区
  muzzleOffsets: [
    new THREE.Vector3( 5.90, -0.80, -4.60),  // 0: 右机翼 ShVAK 20mm
    new THREE.Vector3(-6.00, -0.80, -4.60),  // 1: 左机翼 ShVAK 20mm
    new THREE.Vector3(-0.10,  1.45,  4.65),  // 2: 后座 斜后左上
    new THREE.Vector3(-0.10,  1.45,  4.65),  // 3: 后座 斜后右上
    new THREE.Vector3(-0.10,  1.45,  4.65),  // 4: 后座 正后高上
    new THREE.Vector3(-0.10,  1.45,  4.65),  // 5: 后座 斜后左平
    new THREE.Vector3(-0.10,  1.45,  4.65),  // 6: 后座 斜后右平
  ],
  muzzleDirs: [
    new THREE.Vector3( 0.0,  0.0, -1.0),     // 0-1: 机翼前射
    new THREE.Vector3( 0.0,  0.0, -1.0),
    new THREE.Vector3( 0.342, 0.174, 0.925), // 2: 左后上方 yaw=160° pitch=10°
    new THREE.Vector3(-0.342, 0.174, 0.925), // 3: 右后上方 yaw=200° pitch=10°
    new THREE.Vector3( 0.000, 0.087, 0.996), // 4: 正后低 yaw=180° pitch=5°（覆盖同高度正后方）
    new THREE.Vector3( 0.342, 0.000, 0.940), // 5: 左后平 yaw=160° pitch=0°
    new THREE.Vector3(-0.342, 0.000, 0.940), // 6: 右后平 yaw=200° pitch=0°
  ],
  },
  // Heinkel He 111 H-2（德国主力轰炸机，不列颠战役参战；第3关"伦敦上空"轰炸机）
  // 双发中型轰炸机，真实翼展 22.6m（机身约为 Bf 109 的 2.3 倍），userScale=8.20
  // 朝向为手工调整（autoOrient:false + yawOffset=-51.0，由 tune_enemy.html 调出）
  // centerOffset=[2.55,0,0.50]：Box3 几何中心与视觉中心偏差，由调校台手调
  // 螺旋桨：模型把左右桨几何合并到单节点 Ellipse09-FACES_1，无法各自独立旋转
  //         → propBlurOnly:true 标记为纯模糊盘，半透明显示但不旋转
  // 起落架：6 个节点（stv01/03 起落架支柱 + Cylinder03/11/Torus03/Cylinder15 轮组）
  // 自卫炮塔：1 前枪(机头固定) + 3 自卫炮塔(背/腹/侧后)，含独立发射方向 muzzleDirs
  '/model/he111.glb': {
    autoOrient: false,
    yawOffset: -51.0, pitchOffset: 0.0, rollOffset: 0.0,
    userScale: 8.20,
    centerOffset: [2.55, 0.00, 0.50],  // body frame 世界单位（缩放后）
    propNodes: ['Ellipse09-FACES'],
    propBlurOnly: true,  // 左右桨合并到单节点，只能做模糊盘不旋转
    hideGear: true,
    hideGearNodes: ['Cylinder03-FACES','Torus03-FACES','Cylinder15-FACES','stv01-FACES','stv03-FACES','Cylinder11-FACES'],
    muzzleOffsets: [
      new THREE.Vector3(-0.15, -2.15, -19.10),  // 前枪(机头固定)
      new THREE.Vector3(-0.40,  5.10,  4.80),   // 背炮塔(后上)
      new THREE.Vector3( 0.25, -4.45, 12.35),   // 腹炮塔(后下)
      new THREE.Vector3( 3.70,  0.95,  8.70),   // 侧后枪(右后)
    ],
    // 自卫炮塔方向（body frame 单位向量，与 muzzleOffsets 一一对应）
    // yaw=0,pitch=0 → 朝前 -Z；yaw=180 → 朝后；pitch=90 → 朝上
    muzzleDirs: [
      new THREE.Vector3( 0.017, -0.292, -0.956),  // 前枪(yaw=1° pitch=-17°)
      new THREE.Vector3( 0.000,  0.500,  0.866),  // 背炮塔(后上 yaw=180° pitch=30°)
      new THREE.Vector3( 0.000, -0.500,  0.866),  // 腹炮塔(后下 yaw=180° pitch=-30°)
      new THREE.Vector3( 0.839,  0.000,  0.545),  // 侧后枪(右后 yaw=123° pitch=0°)
    ],
  },
  // Junkers Ju 88（德国多功能作战飞机，可用作俯冲轰炸机/重型战斗机）
  // 双发，真实翼展 18.26m、长度 14.36m（机身约为 Bf 109 的 1.8 倍），userScale=6.64
  // 朝向为手工调整（autoOrient:false + yawOffset=308.5，由 tune_enemy.html 调出）
  // centerOffset=[1.40,0,0]：Box3 几何中心与视觉中心偏差
  // 起落架：10 个节点（支柱+轮组，节点名不含 _1 后缀，已修正）
  // 自卫炮塔：1 前枪(座舱固定) + 3 自卫炮塔(背/腹/侧后)，含独立发射方向 muzzleDirs
  '/model/ju88.glb': {
    autoOrient: false,
    yawOffset: 308.5, pitchOffset: 0.0, rollOffset: 0.0,
    userScale: 6.64,
    centerOffset: [1.40, 0.00, 0.00],
    hideGear: true,
    // 起落架 + 舱门节点（按 88.md 调校文档，均带 _1 后缀的 Mesh 节点）
    hideGearNodes: [
      'Cylinder02-FACES_1','Cylinder01-FACES_1','Cylinder03-FACES_1',
      'Cylinder04-FACES_1','Cylinder05-FACES_1','Cylinder06-FACES_1',
      'Cylinder07-FACES_1','Cylinder09-FACES_1','Cylinder10-FACES_1',
      'Cylinder11-FACES_1','Cylinder22-FACES_1','Cylinder23-FACES_1',
      'Cylinder24-FACES_1','Cylinder25-FACES_1','Cylinder26-FACES_1',
      'Cylinder27-FACES_1','Cylinder28-FACES_1',
      'Torus01-FACES_1','Torus02-FACES_1','Torus03-FACES_1','Torus04-FACES_1','Torus05-FACES_1',
      'Line16-FACES_1',
      'stvorka_04-FACES_1','stvorka_03-FACES_1','stvorka_02-FACES_1','stvorka_1-FACES_1',
      'Object01-FACES_1','Object02-FACES_1','Object07-FACES_1','Object08-FACES_1',
      'Object09-FACES_1','Object10-FACES_1','Object19-FACES_1','Object20-FACES_1',
      'Box01-FACES_1','Box04-FACES_1',
    ],
    muzzleOffsets: [
      new THREE.Vector3( 0.25, 3.15, -13.65),  // 前枪(座舱固定)
      new THREE.Vector3(-1.25, 4.25, -4.00),   // 背炮塔(后上)
      new THREE.Vector3( 0.55,-3.05, -3.70),    // 腹炮塔(后下)
      new THREE.Vector3( 0.90, 4.15, -3.65),    // 侧后枪(右后)
    ],
    muzzleDirs: [
      new THREE.Vector3( 0.000,  0.000, -1.000),  // 前枪(yaw=0° pitch=0°)
      new THREE.Vector3(-0.325,  0.309,  0.894),  // 背炮塔(yaw=-160° pitch=18°)
      new THREE.Vector3( 0.000, -0.423,  0.906),  // 腹炮塔(yaw=180° pitch=-25°)
      new THREE.Vector3( 0.278,  0.309,  0.909),  // 侧后枪(yaw=163° pitch=18°)
    ],
  },
  // Boeing B-17G "飞行堡垒"（美国四发重型轰炸机，1944-45 帝国防空战主要目标；第4关"柏林保卫战"轰炸机群）
  // 真实翼展 31.6m、机身长 22.7m，userScale=11.47（31.6/9.92 × 3.6，与敌机系同一约定）。
  // 模型原始朝向：机头 +X、翼展沿 Z（bbox z ±15.8=翼展，x -12.9~10.9=机长），yawOffset=90° 将机头旋到 body frame -Z。
  // 4 螺旋桨节点 helice03_FACES01~04（各成一组 multiProp）；模型自带半透明模糊盘（Cylinder15~22 系列），
  //   故 propBlurDisc 不再程序化生成。
  // 起落架：rueda 轮组（Object35/Object03 主轮、rueda01_FACES02、Object02 尾轮）。
  // 枪口/炮塔/发动机点位待 b17_tuner.html 标定后写入。
  '/model/b17.glb': {
    autoOrient: false,
    yawOffset: 90.0, pitchOffset: 0.0, rollOffset: 0.0,
    userScale: 11.47,
    centerOffset: [0, 0, 0],   // 待调校台手调
    propNodes: ['helice03_FACES01', 'helice03_FACES02', 'helice03_FACES03', 'helice03_FACES04'],
    multiProp: true,           // 4 发：每个桨节点自成一组独立 pivot 旋转
    propSpinSpeed: 160,
    propOpacity: 0.30,
    propBlurDisc: false,       // 模型自带半透明模糊盘，无需程序化生成
    hideGear: true,
    // 起落架节点（b17_tuner 节点页标定：轮组+支柱+舱门等，2026-08-17）
    hideGearNodes: ['Object02', 'Object03', 'Object13-FACES_1', 'Object19-FACES_1', 'Object27-FACES_1', 'Object35', 'helice03_FACES01-FACES_1', 'rueda01_FACES01-FACES_1', 'rueda01_FACES02', 'ruedaatras_FACES01-FACES_1'],
  },
  // Focke-Wulf Fw 190 A-4（1942 德国战斗机，库尔斯克德方主力之一）
  // autoOrient=true（按 Object_2 桨叶质心自动算 yawOffset≈180°）；
  // centerOffset Z=-3.05 修正几何中心前移（桨叶质心在机头，autoOrient 后整体偏后，需前移对齐原点）。
  // 武器：2×20mm MG 151/20（机翼内）+ 2×7.92mm MG 17（机头上方同步机枪），枪口待精调。
  '/model/fw_190_a-4.glb': {
    autoOrient: true, yawOffset: 180.0,
    pitchOffset: 0.0, rollOffset: 0.0, userScale: 3.81,
    centerOffset: [0.00, 0.00, -3.05],
    propNodes: ['Object_2'],
  },
  // North American P-51 "野马"（1944-45 美军远程护航战斗机；第4关"柏林保卫战"护航机）
  // 武器：6 × .50 M2 勃朗宁（机翼前缘 3左+3右），枪口已经调校台标定。
  '/model/p51.glb': {
    autoOrient: true,
    yawOffset: 134.0,
    pitchOffset: 0.0,
    rollOffset: 0.0,
    userScale: 3.60,
    muzzleOffsets: [
      new THREE.Vector3( 9.20, -1.70, -3.50), // 右翼中外
      new THREE.Vector3( 8.40, -1.80, -3.55), // 右翼中内
      new THREE.Vector3( 7.55, -1.90, -3.65), // 右翼内
      new THREE.Vector3(-7.55, -1.85, -3.55), // 左翼内
      new THREE.Vector3(-8.30, -1.80, -3.50), // 左翼中内
      new THREE.Vector3(-9.05, -1.75, -3.45), // 左翼中外
    ],
  },
  // Messerschmitt Me 262 A-1a（第4关"柏林保卫战"友军僚机用；与玩家同机型，
  // 校准值镜像 level_04_berlin.js playerConfig；该 URL 无其他关卡使用，无冲突）
  '/model/me_262.glb': {
    autoOrient: false,
    yawOffset: 180.0,
    pitchOffset: 0.0,
    rollOffset: 0.0,
    userScale: 4.53,
    hideGear: true,
    hideGearNodes: ['Object_8'],        // 无贴图半透明黑壳
    muzzleOffsets: [
      new THREE.Vector3( 0.52,  0.80, -10.68),  // 右上 MK 108
      new THREE.Vector3(-0.48,  0.80, -10.68),  // 左上 MK 108
      new THREE.Vector3( 1.28,  0.14, -10.50),  // 右下 MK 108
      new THREE.Vector3(-1.28,  0.14, -10.50),  // 左下 MK 108
    ],
  },
};

/**
 * 敌机 AI 类型配置注册表：按类型注入性能参数 + 行为参数 + 机动限制。
 * 与 MODEL_CONFIGS（管外观）解耦：MODEL_CONFIGS 按 URL 注入视觉校准，
 * AI_TYPE_CONFIGS 按 type 注入飞行性能与 AI 行为参数。
 *
 * 字段约定：
 *   性能（覆盖 Enemy 构造函数默认值）：maxSpeed, cruiseSpeed, maxHp, pitchMax/Resp, rollMax/Resp, yawMax/Resp
 *   机动限制（行为方法读取，控制舵量上限）：maxRoll, maxPitch, maxYaw
 *   火力参数：fire = { angleOff, distMin, distMax, burstMin, burstMax, cdMin, cdMax }
 *   行为参数：patrolAltMin/Max, groundTargetPriority, aglFloor
 *
 * 轰炸机/运输机：自带机身炮塔可开火（命中率一般），不同机型开火位置不同。
 *   当前为预留 stub（fire=null），后续补充炮塔枪口与开火逻辑。
 */
const AI_TYPE_CONFIGS = {
  // ---- 战斗机：全机动，对空开火，combatState 三态机 ----
  fighter: {
    maxSpeed: 150, cruiseSpeed: 80, maxHp: 100,
    pitchMax: 1.0, pitchResp: 5.0, rollMax: 2.0, rollResp: 6.0, yawMax: 0.6, yawResp: 3.5,
    maxRoll: 0.7, maxPitch: 0.6, maxYaw: 0.25,
    // 火力增强版：锥宽 0.20rad，距离 200-700m，连发 0.8-1.2s，冷却 1.5-3s
    fire: { angleOff: 0.20, distMin: 200, distMax: 700, burstMin: 0.8, burstMax: 1.2, cdMin: 1.5, cdMax: 3.0 },
    supportFire: { angleOff: 0.25, distMin: 200, distMax: 800, burstMin: 0.8, burstMax: 1.0, cdMin: 1.0, cdMax: 2.5 },
    patrolAltMin: 400, patrolAltMax: 1000, groundTargetPriority: 0, aglFloor: 120,
  },
  // ---- 轰炸机：编队直飞，几乎不机动，HP<20% 仅轻微偏航 ----
  // 机身自卫炮塔：30° 锥宽（0.52rad），300-800m 范围；2s 短连发，4-7s 冷却；
  // 反应慢（1.2s 延迟才开火）；子弹伤害低（weapons 伤害单独配置）
  bomber: {
    maxSpeed: 100, cruiseSpeed: 70, maxHp: 220,
    pitchMax: 0.3, pitchResp: 1.5, rollMax: 0.4, rollResp: 1.5, yawMax: 0.25, yawResp: 1.5,
    maxRoll: 0.0, maxPitch: 0.15, maxYaw: 0.15,
    // 自卫炮塔开火参数（独立检测：朝玩家的方位角 < 30° 即开火，不要求机头朝向玩家）
    fire: {
      angleOff: 0.52,     // 30° 锥宽（0.52 rad），雷达式扫描覆盖
      distMin: 300,       // 不贴脸开火（自卫炮塔反应慢）
      distMax: 800,       // 中距自卫
      burstMin: 1.5,      // 短连发 1.5s
      burstMax: 2.0,      // 最长 2s
      cdMin: 4.0,         // 冷却 4s
      cdMax: 7.0,         // 最长 7s
      reactMin: 1.2,      // 反应延迟 1.2s（玩家进入射击锥后多久才开火）
      reactMax: 1.8,
    },
    patrolAltMin: 600, patrolAltMax: 900, groundTargetPriority: 1, aglFloor: 200,
  },
  // ---- 运输机：与轰炸机相同（无火力，仅编队直飞）----
  transport: {
    maxSpeed: 95, cruiseSpeed: 70, maxHp: 180,
    pitchMax: 0.3, pitchResp: 1.5, rollMax: 0.4, rollResp: 1.5, yawMax: 0.25, yawResp: 1.5,
    maxRoll: 0.0, maxPitch: 0.15, maxYaw: 0.15,
    fire: null,
    patrolAltMin: 600, patrolAltMax: 900, groundTargetPriority: 1, aglFloor: 200,
  },
  // ---- 攻击机：避免缠斗，低空规避或左右摇摆，俯仰/侧滑规避 ----
  attacker: {
    maxSpeed: 120, cruiseSpeed: 75, maxHp: 130,
    pitchMax: 0.8, pitchResp: 4.0, rollMax: 0.9, rollResp: 3.5, yawMax: 0.5, yawResp: 3.0,
    maxRoll: 0.3, maxPitch: 0.5, maxYaw: 0.3,
    fire: null,
    groundFire: { angleOff: 0.30, distMin: 100, distMax: 600, burstMin: 0.5, burstMax: 1.0, cdMin: 2.0, cdMax: 4.0 },
    patrolAltMin: 150, patrolAltMax: 400, groundTargetPriority: 1, aglFloor: 80,
  },
  // ---- 俯冲轰炸机：俯仰更灵敏（俯冲拉起），滚转受限 ----
  diveBomber: {
    maxSpeed: 130, cruiseSpeed: 80, maxHp: 120,
    pitchMax: 1.0, pitchResp: 4.5, rollMax: 0.8, rollResp: 3.5, yawMax: 0.45, yawResp: 3.0,
    maxRoll: 0.25, maxPitch: 0.7, maxYaw: 0.25,
    fire: null,
    groundFire: { angleOff: 0.30, distMin: 100, distMax: 700, burstMin: 0.5, burstMax: 1.0, cdMin: 2.0, cdMax: 4.0 },
    patrolAltMin: 200, patrolAltMax: 500, groundTargetPriority: 1, aglFloor: 80,
  },
};

/**
 * 难度分层配置：对 AI_TYPE_CONFIGS 的关键参数施加乘数。
 * 设计原则：elite 火力增强明显（用户首要诉求），机动温和提升（避免变无敌）。
 */
const TIER_CONFIGS = {
  normal: {
    agility: 1.0, maxSpeed: 1.0, hp: 1.0,
    fireRate: 1.0, fireCone: 1.0, fireRange: 1.0, fireBurst: 1.0,
    evasionChance: 1.0, evasionCd: 1.0,
  },
  elite: {
    agility: 1.15, maxSpeed: 1.10, hp: 1.20,
    fireRate: 1.6, fireCone: 1.15, fireRange: 1.10, fireBurst: 1.25,
    evasionChance: 1.3, evasionCd: 0.85,
  },
};

/**
 * 机型性能注册表：按模型 URL 注入飞行性能覆盖（在 _applyModelConfig 中应用）。
 * 与 MODEL_CONFIGS（管外观）解耦：MODEL_CONFIGS 按 URL 注入视觉校准 + hideGear，
 * MODEL_SPECS 按 URL 注入飞行性能覆盖。
 *
 * 注入优先级：MODEL_SPECS（机型特定）> AI_TYPE_CONFIGS（类型基线）> 构造函数默认值。
 * 调用时机：_applyModelConfig 在 _applyAiConfig 之后执行（_createEnemy 先调 _applyAiConfig
 *           再 load，load 内调 _applyModelConfig），所以 MODEL_SPECS 自然覆盖类型基线。
 *
 * 字段约定：
 *   - 设的是机型基础性能值，注入时乘以 TIER_CONFIGS[this.aiTier] 对应乘数
 *     （maxSpeed×maxSpeed、pitch/roll/yaw×agility、maxHp×hp），保证 elite 仍比 normal 强
 *   - 未列出的机型沿用 AI_TYPE_CONFIGS 基线
 *   - 玩家飞机不走此注册表（本次不动玩家）
 *
 * 真实数据（1941 巴巴罗萨时期）：
 *   Bf 109 E-4(560km/h) | I-153(426) | I-16(440) | Yak-1(580) | Yak-3(655) | Yak-7(590) | Yak-9(591)
 * 换算：0.2945 unit/km/h，玩家 165=560km/h 为基准
 *
 * 性能差异设计（街机化）：
 *   教学敌机（第1-3波）：I-153/I-16 滚转降到玩家(2.6)之下，让玩家容易咬尾
 *   压力敌机（第4-6波）：Yak-1/Yak-7 性能接近玩家，开始给压力
 *   备用机型：Yak-3 性能最强（1943 Boss 级），Yak-9 与 Yak-7 相当
 */
const MODEL_SPECS = {
  // ---- 教学敌机（第1-3波）----
  // I-153 "海鸥"（双翼战斗机）：速度最慢，低速机动+高升力，但滚转被压低让玩家易咬尾
  '/model/i153.glb': {
    maxSpeed: 125, cruiseSpeed: 80, maxHp: 80,
    pitchMax: 1.3, pitchResp: 5.5,
    rollMax: 2.2, rollResp: 6.5,
    yawMax: 0.7, yawResp: 4.0,
    stallThreshold: 8, liftK: 0.034,
  },
  // I-16 "小毛驴"（单翼战斗机）：速度略快于 I-153，滚转次弱
  '/model/i16.glb': {
    maxSpeed: 130, cruiseSpeed: 90, maxHp: 90,
    pitchMax: 1.25, pitchResp: 5.0,
    rollMax: 2.3, rollResp: 6.0,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 9, liftK: 0.028,
  },
  // ---- 压力敌机（第4-5波）----
  // Yak-1（1940，与 Bf 109 E-4 同期）：性能接近玩家，略强
  '/model/yak1.glb': {
    maxSpeed: 171, cruiseSpeed: 105, maxHp: 100,
    pitchMax: 1.35, pitchResp: 5.5,
    rollMax: 2.5, rollResp: 6.0,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 11,
  },
  // ---- 压力敌机（第6波）----
  // Yak-7（1942）：与 Yak-9 性能一致，作为第6波压力敌机
  '/model/yak7.glb': {
    maxSpeed: 174, cruiseSpeed: 110, maxHp: 100,
    pitchMax: 1.45, pitchResp: 5.5,
    rollMax: 2.4, rollResp: 5.5,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 11,
  },
  // ---- 备用机型（本次关卡不使用）----
  // Yak-3（1943 轻量化高机动，性能最强，可作为后期 Boss）
  '/model/yak3.glb': {
    maxSpeed: 193, cruiseSpeed: 120, maxHp: 90,
    pitchMax: 1.5, pitchResp: 6.0,
    rollMax: 2.7, rollResp: 6.5,
    yawMax: 0.75, yawResp: 4.0,
    stallThreshold: 11, liftK: 0.028,
  },
  // Yak-9（1942，与 Yak-7 性能一致；本次关卡不再出现，保留配置供后续关卡使用）
  '/model/yak9.glb': {
    maxSpeed: 174, cruiseSpeed: 110, maxHp: 100,
    pitchMax: 1.45, pitchResp: 5.5,
    rollMax: 2.4, rollResp: 5.5,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 11,
  },
  // Lavochkin La-5FN（1943 苏联近卫精锐，库尔斯克第2波精英敌机，tier:'elite'）
  // 真实：648km/h、M-82FN 2000马力、2×ShVAK 20mm + 2×UB 12.7mm、滚转率高+盘旋优秀
  // 街机化：maxSpeed 190（648×0.2945≈190），精英层×1.10=209（比玩家 FW190 ~190 快 10%）
  // 机动对标 Yak-3（同期 1943 高机动），精英层×1.15 后 pitch 1.73/roll 3.11，近卫精锐飞行员
  // HP 100（精英层×1.20=120），火力由 weapons 单独配（2×20mm 机炮）
  '/model/la5.glb': {
    maxSpeed: 190, cruiseSpeed: 115, maxHp: 100,
    pitchMax: 1.5, pitchResp: 6.0,
    rollMax: 2.7, rollResp: 6.5,
    yawMax: 0.75, yawResp: 4.0,
    stallThreshold: 11,
  },
  // Supermarine Spitfire Mk IIa（1940 英国主力，第2关"风云不列颠"敌机）
  // 历史对比 Bf 109 E-4：最大速度相近（570 vs 594 km/h），盘旋性能更优（椭圆翼升阻比高），
  // 滚转略逊。8×.303 火力密集但单发威力小（口径 7.7mm，无机炮）。
  // 作为敌机：盘旋强（pitch 高）、滚转中庸，maxHp 略高（结构坚固）
  '/model/spitfire.glb': {
    maxSpeed: 168, cruiseSpeed: 105, maxHp: 110,
    pitchMax: 1.4, pitchResp: 5.8,    // 盘旋性能优秀（椭圆翼升阻比高）
    rollMax: 2.5, rollResp: 6.0,      // 滚转略逊 Bf 109
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 11,
  },
  // ---- 攻击机（库尔斯克第3波）----
  // Ilyushin Il-2 M3（苏联单发双座强击机，attacker 类型，tier:'normal'）
  // 真实：420km/h、重装甲、机动差、对地攻击；街机化 maxSpeed 120、maxHp 160（重装甲）
  // 机动极弱（俯仰/滚转/偏航压低 + 舵量限制 maxRoll 0.2），不格斗/不规避
  // 前射固定枪（2×ShVAK 20mm）：极窄锥 4.6°，正对玩家才触发，短点射 + 长冷却（极少开火）
  // 后座自卫炮塔（1×UB 12.7mm）：雷达式扫描 5 虚拟朝向，1200m 开火 / 300m 命中率顶点
  //   单次连射 2-4s + 冷却 0.5-1.5s，玩家不机动时命中率大幅上升（400m 内）
  // 装甲分区：正面迎面减伤 70%（厚甲）、翼侧正常、后方咬尾加成 20%（薄弱）
  '/model/il2.glb': {
    maxSpeed: 120, cruiseSpeed: 75, maxHp: 160,
    pitchMax: 0.6, pitchResp: 3.5,
    rollMax: 0.6, rollResp: 3.0,
    yawMax: 0.4, yawResp: 2.5,
    // AI 舵量限制：偏航为主（转弯），俯仰/滚转极小（主要平飞，少拉起俯冲）
    maxRoll: 0.1, maxPitch: 0.15, maxYaw: 0.3,
    stallThreshold: 8,
    // 前射固定枪开火参数（正对玩家窄锥）
    fire: { angleOff: 0.25, distMin: 300, distMax: 700 },
    // 武器分组：前射 2 管 ShVAK 20mm（~8发/秒/管）+ 后座 5 虚拟朝向 UBT 12.7mm（~17发/秒）
    muzzleGroups: [
      { name: 'forward', indices: [0, 1], fireRate: 0.12 },
      { name: 'turret',  indices: [4], fireRate: 0.06 },
    ],
    // 后座自卫炮塔开火参数（UBT 12.7mm 史实射速 ~600发/分）
    // distOpen 1200 开始开火，distPeak 300 命中率顶点，300-1200 线性衰减
    // angleOff 0.5≈29° 各虚拟朝向扫描锥（覆盖正后方同高度玩家）；连射 2-4s + 冷却 0.5-1.5s
    turretFire: {
      distOpen: 1200, distPeak: 300, angleOff: 0.785,
      burstMin: 2.0, burstMax: 4.0, cdMin: 0.5, cdMax: 1.5,
      reactMin: 0.3, reactMax: 0.8,
    },
    // 武器伤害（比通用机枪 8-12 降一档；UBT 12.7mm 自卫火力偏低，前射 ShVAK 靠射速补偿）
    weaponDamage: [6, 9],
    // IL-2 专属 AI 状态机标志（启用 _thinkIl2：patrol/scatter/groundAttack）
    il2ai: true,
    // 装甲分区（按命中方向·朝向的点积 dot 分区，数组按 minDot 降序）
    // dot>0.87 后方咬尾（夹角<30°）→ ×1.2 装甲薄弱加成
    // -0.87<dot<0.87 翼侧 → ×1.0 正常
    // dot<-0.87 正面迎面（夹角>150°）→ ×0.3 厚甲减伤 70%
    armorRegions: [
      { minDot: 0.87,  multiplier: 1.2 },
      { minDot: -0.87, multiplier: 1.0 },
      { minDot: -1.0,  multiplier: 0.3 },
    ],
  },
  // ---- 轰炸机（第3关"伦敦上空"）----
  // Heinkel He 111 H-2（德国主力轰炸机，1940 不列颠战役参战）
  // 真实数据：maxSpeed 400km/h、cruise 335km/h、翼展 22.6m、长度 16.4m
  // 换算：400 × 0.2945 = 117.8 → 街机化取 95（轰炸机比战斗机慢，玩家容易追上）
  // 机动性极差（双发重轰炸机），俯仰/滚转/偏航均压到极低
  // maxHp=260：双发重轰炸机结构强，比战斗机(100)耐打
  '/model/he111.glb': {
    maxSpeed: 95, cruiseSpeed: 55, maxHp: 260,
    pitchMax: 0.25, pitchResp: 1.2,    // 俯仰迟钝（拉不起来）
    rollMax: 0.35, rollResp: 1.2,      // 滚转极弱
    yawMax: 0.2, yawResp: 1.0,         // 偏航极弱
    stallThreshold: 8,                  // 失速阈值低（低速仍可控）
  },
  // Junkers Ju 88（德国多功能作战飞机，俯冲轰炸机/重型战斗机）
  // 参考喷火参数，后续按机型实际数据调整
  '/model/ju88.glb': {
    maxSpeed: 168, cruiseSpeed: 105, maxHp: 110,
    pitchMax: 1.4, pitchResp: 5.8,
    rollMax: 2.7, rollResp: 6.5,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 11,
  },
  // Focke-Wulf Fw 190 A-4（1942，德国主力战斗机）
  // 真实数据：maxSpeed 656km/h（≈182 单位）、翼展 10.5m、BMW 801 气冷星形引擎 1700hp。
  // 历史对比 Bf 109 E-4：速度更快、滚转更优（Fw 190 滚转率是二战顶尖）、
  // 盘旋略逊（翼载高），火力强（4 门炮）。作为敌机：高速+强滚转+耐打，但盘旋弱给玩家咬尾机会。
  '/model/fw_190_a-4.glb': {
    maxSpeed: 175, cruiseSpeed: 110, maxHp: 110,
    pitchMax: 1.25, pitchResp: 5.5,   // 盘旋略逊 Bf 109（翼载高，拉圈慢）
    rollMax: 3.0, rollResp: 7.5,      // 滚转强（Fw 190 标志性优势，>玩家 2.6）
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 11,
  },
};

/**
 * 敌机：继承 Aircraft 复用加载/归一化/自动朝向/街机物理/坠毁爆炸，
 * 新增 血量 + 自带武器 + AI（按类型/分层分化）。
 *
 * AI 类型（aiType）：fighter | bomber | transport | attacker | diveBomber
 * 难度分层（aiTier）：normal | elite
 * 配置由 AI_TYPE_CONFIGS × TIER_CONFIGS 合成为 _aiCfg，行为方法直接读取。
 * 坐标约定：机头=-Z，pitch+抬头，roll+左滚，yaw+左偏。
 */
export class Enemy extends Aircraft {
  constructor(scene, renderer, player) {
    super(scene, renderer);
    this._player = player;

    // AI 类型/分层（由 _applyAiConfig 覆盖；构造时先给默认值保证未配置时退化）
    this.aiType = 'fighter';
    this.aiTier = 'normal';
    this._aiCfg = null;             // 由 _applyAiConfig 合成，行为方法直接读取
    this.groundTargets = null;      // 地面目标系统引用（bomber/attacker 优先攻击）

    // 性能默认值（fighter normal；_applyAiConfig 会按类型/分层覆盖）
    this.maxSpeed = 150;
    this.pitchMax = 1.0; this.pitchResp = 5.0;
    this.rollMax  = 2.0; this.rollResp  = 6.0;
    this.yawMax   = 0.6; this.yawResp   = 3.5;
    this.cruiseSpeed = 80;

    // 血量
    this.maxHp = 100;
    this.hp = 100;

    // 朝向/缩放/枪口默认值：未知模型用 autoOrient 自动校准。
    // 具体模型的校准参数由 MODEL_CONFIGS 在 load(url) 时按 URL 注入。
    this.autoOrient = true;
    this.yawOffset   = 0;
    this.pitchOffset = 0;
    this.rollOffset  = 0;
    this.userScale   = 3.6;   // Bf 109 基准；已知模型在 MODEL_CONFIGS 中按真实尺寸比例覆盖

    // 默认枪口（body frame，机头=-Z）：沿用 Yak-9 校准值作为通用敌机枪口。
    // 具体模型可在 MODEL_CONFIGS 中覆盖（需用 tune_enemy.html 调校）。
    this.muzzleOffsets = [
      new THREE.Vector3( 6.50, -1.35, -4.15),  // 右机翼
      new THREE.Vector3(-6.50, -1.35, -4.15),  // 左机翼
      new THREE.Vector3( 0.50,  1.00, -7.80),  // 右机头
      new THREE.Vector3(-0.50,  1.00, -7.80),  // 左机头
    ];
    // 敌机用机头直接瞄准，无座舱上抬修正
    this.aimLift = 0;

    // 自带武器（火力略高：射速快于玩家，单发伤害范围 8-12）
    this.weapons = new Weapons(scene, this);
    this.weapons.fireRate = 0.06;       // 玩家 0.07
    this.weapons.bulletSpeed = 720;
    this.weapons.life = 2.0;
    this.weapons.damageMin = 8;         // 玩家 8-20
    this.weapons.damageMax = 12;
    this.weapons.setAudio(null);        // 敌机开火不播玩家音效（避免嘈杂）

    // AI 状态
    this._waypoints = [];
    this._wpIdx = 0;
    this._wpReady = false;
    this._evadeTimer = 0;    // 规避中剩余时间
    this._evadeCd = 0;       // 规避冷却（防频繁机动）
    this._evadeRoll = 1;
    this._evadeYawDir = 0;   // 攻击机侧滑方向（+0.5/-0.5）
    this._evadePitchDir = 0; // 攻击机规避俯仰方向（+0.4爬升/-0.4俯冲）
    this._fireTimer = 0;     // 开火持续计时
    this._fireCd = 0;        // 开火冷却
    this._fireReact = 0;     // 自卫炮塔反应延迟计时（轰炸机专用）
    // 攻击机空对空独立开火计时（与前射/地面攻击的 _fireTimer 隔离，避免互扰）
    this._fwdFireTimer = 0;  // 前射固定枪连发计时
    this._fwdFireCd = 0;    // 前射固定枪冷却
    this._turretFireTimer = 0;  // 后座自卫炮塔连发计时
    this._turretFireCd = 0;     // 后座自卫炮塔冷却
    this._turretFireReact = 0;  // 后座炮塔反应延迟
    // 玩家机动判定（后座炮塔命中率加成：不机动时命中率大幅上升）
    this._prevPlayerFwd = null;   // 上一帧玩家朝向
    this._playerSteadyTime = 0;   // 玩家持续不机动时间（秒）
    // IL-2 专属 AI 状态机（_il2State=null 表示非 IL-2，走原 attacker 逻辑）
    this._il2State = null;        // 'patrol' | 'break' | 'retreat'
    this._il2Enabled = false;     // 机型固有标志（_applyModelSpecs 设 true，reset 据此恢复）
    this._il2RetreatPhase = 0;    // 撤退阶段：0=飞回出生点 1=飞向苏军边界
    this._il2SpawnPos = null;     // 出生点（撤退时先飞回此处）
    this._il2BreakTimer = 0;      // break 状态持续计时
    this._il2BreakDir = new THREE.Vector3();  // break 分头方向（侧前45°）
    this._scatterDir = new THREE.Vector3();  // 散开逃窜方向
    this._groundAttackCd = 5 + Math.random() * 5;  // 对地攻击冷却（初始延迟）
    this._groundAttackPhase = 0;  // 0=俯冲 1=扫射 2=拉起
    this._groundAttackTimer = 0;  // 对地攻击阶段计时
    this._sustainedFireTime = 0; // 被持续射击时间
    this._hitFlag = false;       // 本帧被击中标志（takeDamage 设 true）
    this._patrolAltTarget = 600; // 巡逻目标高度
    this._patrolAltCd = 0;       // 高度改变冷却
    this._lowLevelFlag = false;  // 贴地飞行标志（被持续射击>3s 触发）
    this.ready = false;                 // 模型加载完成前不参与 AI/碰撞

    // 编队属性（由 WaveDirector spawnWave 设置关系）
    this.autoRespawn = false;                          // 编队级重生由 main.js 管理（不自动 reset）
    this.combatState = 'formation';                    // 'formation' | 'engaged' | 'solo' | 'attackBomber'（仅 fighter 用）
    this.isLeader = false;
    this.wingman = null;                               // 编队伙伴引用
    this.formationOffset = new THREE.Vector3(40, -10, 30); // 僚机相对长机偏移（body frame: 右40/下10/后30）
    this._supportDir = null;                           // 'rear' | 'top' | 'left' | 'right'
    this._engageTimer = 0;                             // engaged 持续时间（支援方向重选用）

    // 护航模式：优先攻击友军轰炸机，被玩家攻击时转向玩家
    this._bomberTargets = null;                        // 友军轰炸机列表（由 GameRuntime 注入）
    this._lastPlayerAttackTime = 0;                    // 上次被玩家攻击的时间戳（performance.now）
    this._formationTimer = 0;                          // 编队飞行累计时间（到时切 attackBomber）
    this._engageIdleTimer = 0;                         // engaged 状态无玩家攻击的累计时间（到时切回 attackBomber）
    this._playerNearTimer = 0;                         // attackBomber 状态下玩家持续<NearDist 的累计时间（到4s切 engaged）
    this._disengageTimer = 0;                          // engaged 状态玩家拉开>disengageDist 的累计时间（到 disengageHoldTime 切回 attackBomber）

    // 本关自定义出生行为（spawn/loiter），由 WaveDirector 注入；null=走原逻辑（玩家前方出生）
    this._spawnBehavior = null;                        // { spawn:{x,y,z}, loiter:{x,z,radius,alt} }
    this._loiterWp = [];                               // 盘旋巡逻点（绕 loiter 点的圆）
    this._loiterWpR = 0;                               // 盘旋半径缓存（半径变了才重建巡逻点）

    // 本关自定义出生高度区间（默认 null=相对玩家 ±100m 夹在 400-1000；关卡可注入 [min,max] 绝对高度）
    this._spawnAltitude = null;                        // [minY, maxY] 绝对高度，由 setSpawnAltitude 注入

    // 本关自定义出生距离（默认 null=1400-1900 随机；关卡可注入固定值如 7000）
    this._spawnDistance = null;

    // 航线直飞（本关专用，轰炸机平飞到目的地后消失脱离）
    this._route = null;          // [{x,y,z}, ...] 航线点列表，按顺序飞越
    this._routeIdx = 0;          // 当前目标航点索引
    this._despawnRequested = false; // 到达终点请求脱离（由 WaveDirector 检测并释放）

    // 初始化默认 _aiCfg（fighter normal），保证未调 _applyAiConfig 时 think() 不报错
    this._applyAiConfig('fighter', 'normal');
  }

  async load(url) {
    this._applyModelConfig(url);
    await super.load(url);
    this.ready = true;
    this.reset(); // 初始位置
  }

  /**
   * 设置出生行为（本关专用，不影响其他关）。
   * 必须在 load() 之前调用（reset 在 load 内执行，读取 _spawnBehavior 决定出生点）。
   * cfg = { spawn:{x,y,z}, loiter:{x,z,radius,alt} }
   *   - spawn:  内陆出生点；reset() 用此位置 + combatState='loiter'
   *   - loiter:  海边盘旋点 + 半径 + 高度；_thinkLoiter 飞到此点绕圈，玩家接近切 engaged
   * cfg=null 时走原逻辑（玩家前方 1400-1900 出生，combatState='solo'）
   */
  setSpawnBehavior(cfg) {
    this._spawnBehavior = cfg || null;
  }

  /**
   * 设置出生高度区间（本关专用，不影响其他关）。
   * 必须在 load() 之前调用（reset 在 load 内执行，读取 _spawnAltitude 决定高度）。
   * @param {[number,number]|null} range [minY, maxY] 绝对高度；null=走原逻辑（相对玩家 ±100m，夹在 400-1000）
   */
  setSpawnAltitude(range) {
    this._spawnAltitude = Array.isArray(range) ? range : null;
  }

  /** 设置出生距离（玩家前方多少米出生） */
  setSpawnDistance(dist) {
    this._spawnDistance = (typeof dist === 'number' && dist > 0) ? dist : null;
  }

  /**
   * 设置航线直飞（轰炸机平飞到目的地后消失脱离）。
   * 必须在 load() 之前调用（reset 在 load 内执行，读取 _route 决定初始朝向）。
   * route = [{x,y,z}, ...] 航线点列表，按顺序飞越，到达终点后 _despawnRequested=true。
   * 与 _spawnBehavior 互斥：有 _route 时轰炸机走航线直飞，忽略 loiter 盘旋逻辑。
   */
  setRoute(route) {
    this._route = (route && route.length) ? route.map((p) => ({ x: p.x, y: p.y, z: p.z })) : null;
  }

  /**
   * 注入友军轰炸机目标列表（护航模式专用）。
   * 注入后敌机可进入 attackBomber 状态，优先攻击轰炸机。
   * 由 GameRuntime 在关卡启动后调用（友军轰炸机已创建完毕）。
   */
  setBomberTargets(bombers) {
    this._bomberTargets = bombers || null;
  }

  /**
   * 按模型 URL 注入校准参数（朝向/缩放/枪口）+ 性能覆盖。
   * 必须在 super.load(url) 之前调用——_autoOrient/_applyCalibration/_addMuzzleHelpers
   * 都在 Aircraft.load 内执行，依赖这里设置的 yawOffset/userScale/muzzleOffsets。
   * 性能覆盖由 _applyModelSpecs 处理（读 this.aiTier 施加 tier 乘数）。
   * 未知模型沿用构造函数默认值（autoOrient=true 自动按螺旋桨质心对齐 -Z）。
   */
  _applyModelConfig(url) {
    const cfg = MODEL_CONFIGS[url];
    if (cfg) {
      if (cfg.autoOrient  !== undefined) this.autoOrient  = cfg.autoOrient;
      if (cfg.noVaporTrail !== undefined) this.noVaporTrail = cfg.noVaporTrail;
      if (cfg.yawOffset   !== undefined) this.yawOffset   = cfg.yawOffset;
      if (cfg.pitchOffset !== undefined) this.pitchOffset = cfg.pitchOffset;
      if (cfg.rollOffset  !== undefined) this.rollOffset  = cfg.rollOffset;
      if (cfg.userScale   !== undefined) this.userScale   = cfg.userScale;
      // 几何中心微调（body frame 世界单位，缩放后；用于垂尾偏高/机头不对称等场景）
      if (cfg.centerOffset)  this.centerOffset  = cfg.centerOffset.slice();
      if (cfg.muzzleOffsets) this.muzzleOffsets = cfg.muzzleOffsets.map((v) => v.clone());
      // 自卫炮塔独立方向（body frame 单位向量，与 muzzleOffsets 一一对应）
      if (cfg.muzzleDirs) this.muzzleDirs = cfg.muzzleDirs.map((v) => v.clone());
      if (cfg.hideGear    !== undefined) this._hideGear  = cfg.hideGear;
      // 显式起落架节点列表（优先于 GEAR_KEYWORDS 关键词匹配）
      if (cfg.hideGearNodes) this._hideGearNodes = cfg.hideGearNodes.slice();
      // 显式螺旋桨节点列表（加入 propBranches.blur 让 propMode='blur' 时显示）
      if (cfg.propNodes)    this._propNodes    = cfg.propNodes.slice();
      // 纯模糊盘标记（左右桨几何合并到单节点，无法独立旋转，仅半透明不旋转）
      if (cfg.propBlurOnly !== undefined) this._propBlurOnly = cfg.propBlurOnly;
      // 多螺旋桨独立旋转标记（双发机型 true：每个 propNode 自成一组各自旋转；单发默认 false：所有桨叶归为 1 组绕同一桨毂）
      if (cfg.multiProp !== undefined) this.multiProp = cfg.multiProp;
      // 桨叶转速覆盖（默认 PROP_SPIN=300；喷火 95 呈现清晰旋转感）
      if (cfg.propSpinSpeed !== undefined) this._propSpinSpeed = cfg.propSpinSpeed;
      // 桨叶透明度覆盖（默认 0.22；喷火 0.14 配合模糊盘）
      if (cfg.propOpacity !== undefined) this._propOpacity = cfg.propOpacity;
      // 动态模糊盘开关（默认 false；喷火 true 启用黑桨身+黄桨尖径向渐变盘面）
      if (cfg.propBlurDisc !== undefined) this._propBlurDisc = cfg.propBlurDisc;
      // 模糊盘强度（默认 0.35；控制盘面不透明度）
      if (cfg.propBlurStrength !== undefined) this._propBlurStrength = cfg.propBlurStrength;
      // 旋转轴倾斜修正（默认 {x:0,y:0}；修正桨毂轴与模型 Z 轴的偏斜）
      if (cfg.propAxisTilt) this._propAxisTilt = { x: cfg.propAxisTilt.x || 0, y: cfg.propAxisTilt.y || 0 };
      // 桨毂圆心偏移（默认 {x:0,y:0,z:0}；模型局部空间微调旋转中心）
      if (cfg.propPivotOffset) this._propPivotOffset = { x: cfg.propPivotOffset.x || 0, y: cfg.propPivotOffset.y || 0, z: cfg.propPivotOffset.z || 0 };
    }
    // 性能覆盖（机型特定 > 类型基线；读 this.aiTier 施加 tier 乘数）
    this._applyModelSpecs(url);
  }

  /**
   * 按模型 URL 注入飞行性能覆盖。读 this.aiTier（已由 _applyAiConfig 设置）施加 tier 乘数。
   * 在 _applyModelConfig 末尾调用——此时 _applyAiConfig 已执行，aiTier/maxSpeed 等已是类型基线值。
   */
  _applyModelSpecs(url) {
    const specs = MODEL_SPECS[url];
    if (!specs) return;
    const tier = this.aiTier || 'normal';
    const tierCfg = TIER_CONFIGS[tier] || TIER_CONFIGS.normal;

    if (specs.maxSpeed       !== undefined) this.maxSpeed       = specs.maxSpeed * tierCfg.maxSpeed;
    if (specs.cruiseSpeed    !== undefined) this.cruiseSpeed    = specs.cruiseSpeed;
    if (specs.maxHp          !== undefined) this.maxHp          = Math.round(specs.maxHp * tierCfg.hp);
    if (specs.pitchMax       !== undefined) this.pitchMax       = specs.pitchMax * tierCfg.agility;
    if (specs.pitchResp      !== undefined) this.pitchResp      = specs.pitchResp * tierCfg.agility;
    if (specs.rollMax        !== undefined) this.rollMax        = specs.rollMax * tierCfg.agility;
    if (specs.rollResp       !== undefined) this.rollResp       = specs.rollResp * tierCfg.agility;
    if (specs.yawMax         !== undefined) this.yawMax         = specs.yawMax * tierCfg.agility;
    if (specs.yawResp        !== undefined) this.yawResp        = specs.yawResp * tierCfg.agility;
    if (specs.stallThreshold !== undefined) this.stallThreshold = specs.stallThreshold;
    if (specs.liftK          !== undefined) this.liftK          = specs.liftK;
    // 机动舵量限制覆盖 _aiCfg（机型特定 > 类型基线）
    if (specs.maxRoll  !== undefined && this._aiCfg) this._aiCfg.maxRoll  = specs.maxRoll;
    if (specs.maxPitch !== undefined && this._aiCfg) this._aiCfg.maxPitch = specs.maxPitch;
    if (specs.maxYaw   !== undefined && this._aiCfg) this._aiCfg.maxYaw   = specs.maxYaw;
    // 对空开火参数覆盖 _aiCfg.fire（机型特定 > 类型基线；IL-2 attacker 基线 fire=null，此处启用）
    if (specs.fire !== undefined && this._aiCfg) this._aiCfg.fire = specs.fire;
    // 后座自卫炮塔开火参数（IL-2 UBT 12.7mm 雷达式扫描）
    if (specs.turretFire !== undefined && this._aiCfg) this._aiCfg.turretFire = specs.turretFire;
    // 武器分组（前射固定枪 + 后座炮塔独立开火）
    if (specs.muzzleGroups && this.weapons) {
      this.weapons.setEnemyMuzzleGroups(specs.muzzleGroups);
      if (this._aiCfg) this._aiCfg.muzzleGroups = specs.muzzleGroups;
    }
    // 武器伤害覆盖（机型特定；IL-2 降一档）
    if (specs.weaponDamage && this.weapons) {
      this.weapons.damageMin = specs.weaponDamage[0];
      this.weapons.damageMax = specs.weaponDamage[1];
    }
    // 装甲分区减伤配置（通用，按命中方向点积分区；IL-2 正面厚甲/B-17 等未来机型复用）
    if (specs.armorRegions)  this._armorRegions = specs.armorRegions;
    // IL-2 专属 AI 状态机初始化
    if (specs.il2ai) { this._il2Enabled = true; this._il2State = 'patrol'; this._patrolAltTarget = 400; }
  }

  /**
   * 按 AI 类型 + 分层注入性能/行为参数。在 load(url) 之前调用（与 _applyModelConfig 同时机）。
   * 读取 AI_TYPE_CONFIGS[type] × TIER_CONFIGS[tier] 合成 this._aiCfg。
   * 同时覆盖 Aircraft 物理参数与 Weapons 火力参数。
   * @param {string} type  'fighter'|'bomber'|'transport'|'attacker'|'diveBomber'
   * @param {string} tier  'normal'|'elite'，默认 'normal'
   */
  _applyAiConfig(type, tier = 'normal') {
    const baseCfg = AI_TYPE_CONFIGS[type] || AI_TYPE_CONFIGS.fighter;
    const tierCfg = TIER_CONFIGS[tier] || TIER_CONFIGS.normal;

    this.aiType = type;
    this.aiTier = tier;

    // 物理参数（覆盖构造函数默认值）
    this.maxSpeed    = baseCfg.maxSpeed * tierCfg.maxSpeed;
    this.cruiseSpeed = baseCfg.cruiseSpeed;
    this.maxHp       = Math.round(baseCfg.maxHp * tierCfg.hp);
    this.pitchMax = baseCfg.pitchMax * tierCfg.agility;
    this.pitchResp = baseCfg.pitchResp * tierCfg.agility;
    this.rollMax  = baseCfg.rollMax  * tierCfg.agility;
    this.rollResp  = baseCfg.rollResp  * tierCfg.agility;
    this.yawMax   = baseCfg.yawMax   * tierCfg.agility;
    this.yawResp   = baseCfg.yawResp   * tierCfg.agility;

    // 武器参数（fireRate 是秒/发，越小越快）
    if (this.weapons) {
      const dmgMul = tier === 'elite' ? 1.15 : 1.0;
      if (type === 'bomber') {
        // 轰炸机自卫炮塔：射速慢、伤害低（自卫反击不易击杀战斗机）
        this.weapons.fireRate = 0.18 / tierCfg.fireRate;   // 3 倍慢于战斗机
        this.weapons.bulletSpeed = 580;                    // 弹速慢，易规避
        this.weapons.damageMin = 2 * dmgMul;               // 伤害 2-4（战斗机 8-12）
        this.weapons.damageMax = 4 * dmgMul;
      } else {
        this.weapons.fireRate = 0.06 / tierCfg.fireRate;
        this.weapons.bulletSpeed = 720;
        this.weapons.damageMin = 8 * dmgMul;
        this.weapons.damageMax = 12 * dmgMul;
      }
    }

    // 合成有效 AI 配置（行为方法读取，避免每帧重算）
    const scaleFire = (fc) => fc ? {
      angleOff: fc.angleOff * tierCfg.fireCone,
      distMin:  fc.distMin,
      distMax:  fc.distMax * tierCfg.fireRange,
      burstMin: fc.burstMin * tierCfg.fireBurst,
      burstMax: fc.burstMax * tierCfg.fireBurst,
      cdMin:    fc.cdMin / tierCfg.fireRate,
      cdMax:    fc.cdMax / tierCfg.fireRate,
      reactMin: fc.reactMin || 0,
      reactMax: fc.reactMax || 0,
    } : null;

    this._aiCfg = {
      type, tier,
      maxRoll:  baseCfg.maxRoll,
      maxPitch: baseCfg.maxPitch,
      maxYaw:   baseCfg.maxYaw,
      fire:        scaleFire(baseCfg.fire),
      supportFire: scaleFire(baseCfg.supportFire),
      groundFire:  scaleFire(baseCfg.groundFire),
      patrolAltMin: baseCfg.patrolAltMin,
      patrolAltMax: baseCfg.patrolAltMax,
      groundTargetPriority: baseCfg.groundTargetPriority,
      aglFloor: baseCfg.aglFloor,
      breakDist: baseCfg.breakDist != null ? baseCfg.breakDist : 500,  // 编队散开距离（玩家靠近至此值触发 _breakFormation）
      evasionChance: (type === 'fighter' ? 0.015 : 0) * tierCfg.evasionChance,
      evasionCdMin: 7 * tierCfg.evasionCd,
      evasionCdMax: 12 * tierCfg.evasionCd,
    };
  }

  /** 注册地面目标系统（用于 bomber/attacker 优先攻击）*/
  setGroundTargets(gt) { this.groundTargets = gt || null; }

  /**
   * 本关 AI 参数覆盖（关卡隔离机制）。
   * 在 _applyAiConfig 之后调用，覆盖 _aiCfg 的任意字段，只影响本关敌机。
   * 支持覆盖：
   *   - 行为参数：patrolAltMin/Max、aglFloor、fire、supportFire、maxRoll/Pitch/Yaw、evasionChance 等（合并到 _aiCfg）
   *   - 物理参数：maxHp、maxSpeed、cruiseSpeed、pitchMax/Resp、rollMax/Resp、yawMax/Resp（赋给 this.xxx）
   *   - 脱战参数：playerNearDist（attackBomber→engaged 触发距离，默认 300）
   *              disengageDist（engaged→attackBomber 脱战距离，默认 1200）
   *              disengageHoldTime（脱战持续时间，默认 0=立刻切）
   * 必须在 load() 之前调用（_initWaypoints 在 think 首次调用时读取 _aiCfg）。
   */
  setAiOverride(override) {
    if (!override || !this._aiCfg) return;
    // 物理字段直接赋给实例属性（_applyAiConfig 也是赋给 this.xxx，不在 _aiCfg 里）
    const PHYSICAL_KEYS = {
      maxHp: true, maxSpeed: true, cruiseSpeed: true,
      pitchMax: true, pitchResp: true, rollMax: true, rollResp: true, yawMax: true, yawResp: true,
    };
    for (const key of Object.keys(override)) {
      const val = override[key];
      if (val == null) continue;
      if (PHYSICAL_KEYS[key]) {
        this[key] = val;
        // maxHp 改了同步 hp（敌机出生时 hp=maxHp，setAiOverride 在 load 前调用，此时 hp 还没被攻击过）
        if (key === 'maxHp') this.hp = val;
      } else if (typeof val === 'object' && typeof this._aiCfg[key] === 'object' && !Array.isArray(val)) {
        // fire/supportFire/groundFire 是对象，浅合并
        this._aiCfg[key] = { ...this._aiCfg[key], ...val };
      } else {
        this._aiCfg[key] = val;
      }
    }
    // 巡逻点高度变了，标记需重建
    this._wpReady = false;
  }

  /**
   * override Aircraft.takeDamage：调父类扣血/坠毁/爆炸逻辑，
   * 额外触发编队散开 + 被玩家攻击时切换到 engaged 攻击玩家。
   * - formation → 散开切 engaged（原行为）
   * - attackBomber → 放弃攻击轰炸机，切 engaged 攻击玩家
   * - engaged → 刷新 _lastPlayerAttackTime（保持攻击玩家）
   */
  takeDamage(d, hitDir) {
    const dead = super.takeDamage(d, hitDir);
    if (!dead) this._hitFlag = true;  // IL-2 持续射击检测（驱动规避机动）
    if (!dead && this.aiType === 'fighter') {
      this._lastPlayerAttackTime = performance.now();
      this._engageIdleTimer = 0;
      this._disengageTimer = 0;  // 玩家再次攻击，脱战计时清零
      if (this.combatState === 'formation' || this.combatState === 'attackBomber') {
        this._breakFormation();
        this.combatState = 'engaged';
        // 不强制规避：被命中只切状态反击，规避走 engaged 状态的概率判定（保持攻击节奏）
      }
    }
    return dead;
  }

  /**
   * 玩家子弹近距擦过感知（40m 内）：感知到威胁 → 切 engaged 攻击玩家 + 立即规避。
   * 仅 fighter 类型生效；只在非交战状态（formation/attackBomber/loiter）触发，
   * 已 engaged/solo 则忽略（避免重复触发）。
   * 不调 _breakFormation：只切自身状态，不影响僚机（僚机未被擦过不一定感知到威胁）。
   * 由 GameRuntime._hitDetection 每帧检测玩家子弹距离触发。
   */
  notifyBulletNearMiss() {
    if (this.aiType !== 'fighter') return;
    if (this.combatState === 'formation' || this.combatState === 'attackBomber' || this.combatState === 'loiter') {
      this.combatState = 'engaged';
      this._engageTimer = 0;
      this._lastPlayerAttackTime = performance.now();
      this._disengageTimer = 0;
      this._playerNearTimer = 0;
      this._triggerEvade();  // 子弹擦过 = 被瞄准，立即规避
    }
  }

  /**
   * 强制触发规避机动（翻滚 + 上仰 + 加速），绕过 _thinkEngaged/_thinkSolo 的概率判定。
   * 用于被咬尾/被命中/子弹擦过时立即反应：被攻击了不能再直线飞等死。
   * 规避持续 1.2-2s，之后进入 _evadeCd 冷却（engagedEvasionCdMin/Max，默认 5-9s）。
   */
  _triggerEvade() {
    const cfg = this._aiCfg;
    const evCdMin = cfg.engagedEvasionCdMin ?? 5;
    const evCdMax = cfg.engagedEvasionCdMax ?? 9;
    this._evadeTimer = 1.2 + Math.random() * 0.8;
    this._evadeRoll = Math.random() < 0.5 ? 0.9 : -0.9;
    this._evadeCd = evCdMin + Math.random() * (evCdMax - evCdMin);
  }

  /** 编队散开：自身切 engaged，并通知队友一起散开（队友随机选支援方向）。*/
  _breakFormation() {
    this.combatState = 'engaged';
    this._engageTimer = 0;
    if (this.wingman && !this.wingman.crashed && this.wingman.combatState === 'formation') {
      this.wingman.combatState = 'engaged';
      this.wingman._engageTimer = 0;
      this.wingman._supportDir = _SUPPORT_DIRS[Math.floor(Math.random() * _SUPPORT_DIRS.length)];
    }
  }

  /**
   * 重生（override Aircraft.reset）：敌机坠毁后重生在玩家前方远处随机方位，
   * 而非玩家原点。机头朝向玩家。
   */
  reset() {
    // 清理残留爆炸/损伤/碎片粒子（与 Aircraft.reset 一致）
    for (const p of this._explosions) this.scene.remove(p.mesh);
    this._explosions = [];
    for (const s of this._damageSmoke) this.scene.remove(s.mesh);
    this._damageSmoke = [];
    for (const f of this._damageFire) this.scene.remove(f.mesh);
    this._damageFire = [];
    for (const d of this._debris) this.scene.remove(d.mesh);
    this._debris = [];
    this.crashed = false;
    this._exploded = false;
    this._crashTimer = 0;
    this._crashDamage = 0;
    this._crashFallTime = 0;
    this._crashMode = 'ballistic';
    this._crashSpeed = 0;
    this._crashSinkRate = 0;
    this.crashShake = 0;
    this.hp = this.maxHp;
    if (this.model) this.model.visible = true;
    this.angVel.set(0, 0, 0);
    this.gForce = 1.0;
    this.stall = false;
    this._stallTimer = 0;
    this.throttle = 0.75;
    this.speed = this.cruiseSpeed;

    const p = this._player;
    if (this._route && this._route.length) {
      // 航线直飞模式（轰炸机平飞到目的地后脱离）：出生点 = route[0]，朝 route[1] 飞
      const r0 = this._route[0];
      this.root.position.set(r0.x, r0.y, r0.z);
      this._routeIdx = this._route.length > 1 ? 1 : 0;
      this._despawnRequested = false;
      if (this._route.length > 1) {
        const r1 = this._route[1];
        // lookAt 让 +Z 朝目标，飞机机头在 -Z，需旋转 180° 使机头朝向飞行方向
        this.root.lookAt(r1.x, r1.y, r1.z);
        this.root.rotateY(Math.PI);
      } else {
        this.root.quaternion.identity();
      }
      // 轰炸机走 _thinkBomber 航线分支，combatState 仅用于编队标记
      this.combatState = 'formation';
    } else if (this._spawnBehavior && this._spawnBehavior.spawn) {
      // 本关自定义出生点（内陆）：用 spawn 位置 + combatState='loiter'（飞到海边盘旋）
      const s = this._spawnBehavior.spawn;
      this.root.position.set(s.x, s.y, s.z);
      const l = this._spawnBehavior.loiter;
      if (l) {
        // 朝 loiter 点方向（朝海），lookAt + rotateY(π) 使机头(-Z)朝目标
        this.root.lookAt(l.x, l.alt, l.z);
        this.root.rotateY(Math.PI);
      } else {
        this.root.quaternion.identity();
      }
      this.combatState = 'loiter';
    } else if (p && p.model) {
      const ang = (Math.random() - 0.5) * 1.6;        // 前方 ±0.8 弧度扇形
      // 出生距离：本关配 _spawnDistance 用固定值；否则原逻辑 1400-1900
      const dist = this._spawnDistance || (1400 + Math.random() * 500);
      const dir = p.getForward().clone().applyAxisAngle(_UP, ang);
      this.root.position.copy(p.root.position).addScaledVector(dir, dist);
      // 高度：本关配 _spawnAltitude 用绝对区间；否则原逻辑（相对玩家 ±100m，夹在 400-1000）
      if (this._spawnAltitude) {
        this.root.position.y = this._spawnAltitude[0] + Math.random() * (this._spawnAltitude[1] - this._spawnAltitude[0]);
      } else {
        this.root.position.y = Math.max(400, Math.min(1000, p.root.position.y + (Math.random() - 0.5) * 200));
      }
      // lookAt 让 +Z 朝玩家，rotateY(π) 使机头(-Z)朝玩家
      this.root.lookAt(p.root.position);
      this.root.rotateY(Math.PI);
    } else {
      this.root.position.set(0, 700, -1500);
      this.root.quaternion.identity();
    }
    this._evadeTimer = 0;
    this._evadeCd = 0;
    this._fireTimer = 0;
    this._fireCd = 0;
    this._fwdFireTimer = 0;
    this._fwdFireCd = 0;
    this._turretFireTimer = 0;
    this._turretFireCd = 0;
    this._turretFireReact = 0;
    this._playerSteadyTime = 0;
    this._il2State = this._il2Enabled ? 'patrol' : null;
    this._il2RetreatPhase = 0;
    this._il2SpawnPos = null;
    this._il2BreakTimer = 0;
    this._groundAttackCd = 5 + Math.random() * 5;
    this._groundAttackPhase = 0;
    this._groundAttackTimer = 0;
    this._sustainedFireTime = 0;
    this._hitFlag = false;
    this._patrolAltTarget = 600;
    this._patrolAltCd = 0;
    this._lowLevelFlag = false;
    this._wpIdx = 0;
    this._engageTimer = 0;
    this._supportDir = null;
    // combatState / wingman / isLeader / formationOffset 保留（由 main.js 编队重生时管理）
  }

  /** 初始化巡逻点（以出生位置为中心半径850，高度按 _aiCfg.patrolAltMin/Max 起伏）*/
  _initWaypoints() {
    this._waypoints = [];
    // 以当前出生位置为巡逻中心（避免硬编码原点导致远战场关卡飞离战场）
    this._patrolCenter = this.root.position.clone();
    const cx = this._patrolCenter.x, cz = this._patrolCenter.z;
    const R = 850, N = 8;
    const altMin = this._aiCfg.patrolAltMin || 600;
    const altMax = this._aiCfg.patrolAltMax || 850;
    const altRange = Math.max(50, altMax - altMin);
    // IL-2 加随机相位偏移，避免同组多机同步盘旋（视觉上不呈编队）
    const phaseOff = this._il2State ? Math.random() * Math.PI * 2 : 0;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + phaseOff;
      const alt = altMin + Math.random() * altRange;
      this._waypoints.push(new THREE.Vector3(cx + Math.cos(a) * R, alt, cz + Math.sin(a) * R));
    }
    this._wpIdx = 0;
    this._wpReady = true;
  }

  /**
   * AI 大脑：按 aiType 派发到类型行为方法，fighter 内部再按 combatState 派发。
   * 优先级：撞地拉起 > 高度上限下降 > 队友死亡检测 > 类型派发
   */
  think(dt, player) {
    const input = { pitch: 0, yaw: 0, roll: 0, throttleUp: false, throttleDown: false, fire: false };
    if (this.crashed || !player || !player.model) return input;
    if (!this._wpReady) this._initWaypoints();

    const myPos = this.root.position;
    const groundH = this.terrain ? this.terrain.getHeight(myPos.x, myPos.z) : 0;
    const agl = myPos.y - groundH;

    // ---- 最高优先级：撞地拉起（按类型 aglFloor）----
    if (agl < this._aiCfg.aglFloor) {

      input.pitch = 1.0;
      input.throttleUp = true;
      return input;
    }

    // ---- 高度上限：超过巡逻高度上限 +100 强制下降 ----
    // 航线直飞模式（轰炸机按 _route 平飞）跳过此检测，保持航线指定高度
    // IL-2 跳过此检测（由 _thinkIl2 自身高度管理，避免与 IL2 巡航高度冲突导致大幅俯冲坠毁）
    if (!(this._route && this._route.length) && !this._il2State && myPos.y > this._aiCfg.patrolAltMax + 100) {
      input.pitch = -0.6;
      return input;
    }

    // ---- 队友被击落 → 切 solo（仅 fighter 类型用 combatState）----
    if (this.aiType === 'fighter' && this.wingman && this.wingman._exploded) {
      this.combatState = 'solo';
      this.wingman = null;
    }

    // ---- 类型派发 ----
    switch (this.aiType) {
      case 'fighter':
        return this._thinkFighter(dt, player, input);
      case 'bomber':
      case 'transport':
        return this._thinkBomber(dt, player, input);
      case 'attacker':
      case 'diveBomber':
        return this._thinkAttacker(dt, player, input);
      default:
        return this._thinkFighter(dt, player, input);
    }
  }

  /** 战斗机 AI：按 combatState 派发到 loiter/formation/engaged/attackBomber/solo。*/
  _thinkFighter(dt, player, input) {
    if (this.combatState === 'loiter')        return this._thinkLoiter(dt, player, input);
    if (this.combatState === 'formation')    return this._thinkFormation(dt, player, input);
    if (this.combatState === 'engaged')      return this._thinkEngaged(dt, player, input);
    if (this.combatState === 'attackBomber') return this._thinkAttackBomber(dt, player, input);
    return this._thinkSolo(dt, player, input);
  }

  /**
   * 盘旋待敌（本关专用，combatState='loiter'）：
   * 飞向 loiter 点，到达后绕圈盘旋；玩家接近 (<1200m) 切 engaged 接敌。
   * 盘旋阶段不主动开火（等待接敌）。
   */
  _thinkLoiter(dt, player, input) {
    const myPos = this.root.position;
    const cfg = this._aiCfg;
    const lb = this._spawnBehavior && this._spawnBehavior.loiter;
    if (!lb) { this.combatState = 'solo'; return this._thinkSolo(dt, player, input); }

    // 玩家接近 → 接敌
    _toP.copy(player.root.position).sub(myPos);
    const distP = _toP.length();

    if (distP < 1200) {
      this.combatState = 'engaged';
      return this._thinkEngaged(dt, player, input);
    }

    // 轰炸机接近 < 8000 -> 切 attackBomber（主动拦截轰炸机，不再被动盘旋等玩家）
    if (this._bomberTargets && this._bomberTargets.length) {
      let nearestBomberDist = Infinity;
      for (const fb of this._bomberTargets) {
        if (!fb || !fb.ready || fb._despawnRequested) continue;
        const d = myPos.distanceTo(fb.root.position);
        if (d < nearestBomberDist) nearestBomberDist = d;
      }
      if (nearestBomberDist < 8000) {
        this.combatState = 'attackBomber';
        return this._thinkAttackBomber(dt, player, input);
      }
    }


    // 飞行目标：未到盘旋区 -> 飞向 loiter 点；到达 -> 绕圈
    const dCenter = Math.hypot(myPos.x - lb.x, myPos.z - lb.z);
    let target;
    if (dCenter > lb.radius + 200) {
      target = _loiterTarget.set(lb.x, lb.alt, lb.z);  // 飞向盘旋中心（独立临时变量，不污染 _center）
    } else {
      // 到达盘旋区：绕 loiter 点画圆（缓存巡逻点，半径变了才重建）
      if (this._loiterWpR !== lb.radius) {
        this._loiterWp = [];
        const R = lb.radius, N = 8;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2;
          this._loiterWp.push(new THREE.Vector3(lb.x + Math.cos(a) * R, lb.alt, lb.z + Math.sin(a) * R));
        }
        this._loiterWpR = lb.radius;
        this._wpIdx = 0;
      }
      const wp = this._loiterWp[this._wpIdx];
      if (myPos.distanceTo(wp) < 200) {
        this._wpIdx = (this._wpIdx + 1) % this._loiterWp.length;
      }
      target = this._loiterWp[this._wpIdx];
    }

    // 朝目标飞（复用 _thinkSolo 的飞行控制逻辑）
    _toT.copy(target).sub(myPos);
    const distT = _toT.length();
    _invQ.copy(this.root.quaternion).invert();
    _localT.copy(_toT).applyQuaternion(_invQ);
    input.pitch = THREE.MathUtils.clamp(_localT.y / Math.max(80, distT * 0.35), -cfg.maxPitch, cfg.maxPitch);
    input.roll = THREE.MathUtils.clamp(-_localT.x / Math.max(80, distT * 0.5), -cfg.maxRoll, cfg.maxRoll);
    input.yaw = THREE.MathUtils.clamp(-_localT.x / Math.max(120, distT * 0.7), -cfg.maxYaw, cfg.maxYaw);
    this._maintainThrottle(input);
    return input;
  }

  /**
   * 编队飞行：长机按 waypoint 巡逻，僚机跟随长机保持 body frame 偏移。
   * 玩家距离 < 500m → 散开（_breakFormation）切 engaged。
   * 编队飞行累计 8s 后 → 切 attackBomber（无玩家攻击时转向轰炸机）。
   */
  _thinkFormation(dt, player, input) {
    const myPos = this.root.position;
    const cfg = this._aiCfg;

    // 玩家靠近 → 散开（默认 500m；第2关巴巴罗萨等近距离出生用此阈值）
    _toP.copy(player.root.position).sub(myPos);
    const distP = _toP.length();
    if (distP < cfg.breakDist) {
      this._breakFormation();
      return this._thinkEngaged(dt, player, input);
    }

    // 编队飞行累计计时 → 切 attackBomber（有轰炸机目标时）
    this._formationTimer += dt;
    if (this._formationTimer > 3 && this._bomberTargets && this._bomberTargets.length > 0) {
      this.combatState = 'attackBomber';
      return this._thinkAttackBomber(dt, player, input);
    }

    if (this.isLeader) {
      // 长机：有 loiter 点 → 飞向 loiter 点（保持本关高度）；无 → 按中央 waypoint 巡逻
      const lb = this._spawnBehavior && this._spawnBehavior.loiter;
      let target;
      if (lb) {
        target = _loiterTarget.set(lb.x, lb.alt, lb.z);
      } else {
        const dCenter = Math.hypot(myPos.x - this._patrolCenter.x, myPos.z - this._patrolCenter.z);
        if (dCenter > 1300) {
          _loiterTarget.set(this._patrolCenter.x, myPos.y, this._patrolCenter.z);
          target = _loiterTarget;                // 飞离巡逻中心，返回中心
        } else {
          const wp = this._waypoints[this._wpIdx];
          if (myPos.distanceTo(wp) < 250) {
            this._wpIdx = (this._wpIdx + 1) % this._waypoints.length;
          }
          target = this._waypoints[this._wpIdx];
        }
      }
      _toT.copy(target).sub(myPos);
      const distT = _toT.length();
      _invQ.copy(this.root.quaternion).invert();
      _localT.copy(_toT).applyQuaternion(_invQ);
      input.pitch = THREE.MathUtils.clamp(_localT.y / Math.max(80, distT * 0.35), -cfg.maxPitch, cfg.maxPitch);
      input.roll = THREE.MathUtils.clamp(-_localT.x / Math.max(80, distT * 0.5), -cfg.maxRoll, cfg.maxRoll);
      input.yaw = THREE.MathUtils.clamp(-_localT.x / Math.max(120, distT * 0.7), -cfg.maxYaw, cfg.maxYaw);
    } else {
      // 僚机：跟随长机保持编队偏移（wingman 引用 = 长机）
      const leader = this.wingman;
      if (!leader || !leader.ready || leader.crashed) {
        this.combatState = 'solo';                  // 长机异常 → 转 solo
        return this._thinkSolo(dt, player, input);
      }
      // 目标点 = 长机位置 + 长机姿态 × formationOffset
      _toW.copy(this.formationOffset).applyQuaternion(leader.root.quaternion).add(leader.root.position);
      _toT.copy(_toW).sub(myPos);
      const distT = _toT.length();
      _invQ.copy(this.root.quaternion).invert();
      _localT.copy(_toT).applyQuaternion(_invQ);
      input.pitch = THREE.MathUtils.clamp(_localT.y / Math.max(80, distT * 0.4), -cfg.maxPitch, cfg.maxPitch);
      input.roll = THREE.MathUtils.clamp(-_localT.x / Math.max(80, distT * 0.6), -cfg.maxRoll, cfg.maxRoll);
      input.yaw = THREE.MathUtils.clamp(-_localT.x / Math.max(120, distT * 0.8), -cfg.maxYaw, cfg.maxYaw);
    }

    this._maintainThrottle(input);
    return input;
  }

  /**
   * 战斗散开：自己被咬尾→规避；队友被咬尾→支援；否则→单机攻击/巡逻。
   * 玩家距离拉开 > 1200m → 切回 attackBomber（护航模式：远离即转回轰炸机）。
   */
  _thinkEngaged(dt, player, input) {
    const myPos = this.root.position;
    const cfg = this._aiCfg;

    // 玩家相对位置
    _toP.copy(player.root.position).sub(myPos);
    const distP = _toP.length();
    _invQ.copy(this.root.quaternion).invert();
    _local.copy(_toP).applyQuaternion(_invQ);
    // pursuedDist 默认 350（原值），本关可通过 aiOverride.pursuedDist 覆盖
    // 扩大后敌机在更远距离被咬尾时也会持续触发规避（解决 700m 尾随不规避问题）
    const pursuedDist = cfg.pursuedDist || 350;
    const mePursued = _local.z > 0 && distP < pursuedDist;  // 自己被咬尾

    // 玩家距离拉开 > disengageDist 且持续 disengageHoldTime → 切回 attackBomber（有轰炸机目标时）
    // disengageDist 默认 1200、disengageHoldTime 默认 0（立刻切，原行为），本关可通过 aiOverride 覆盖
    const disengageDist = this._aiCfg.disengageDist || 1200;
    const disengageHoldTime = this._aiCfg.disengageHoldTime || 0;
    if (distP > disengageDist && this._bomberTargets && this._bomberTargets.length > 0) {
      if (disengageHoldTime > 0) {
        this._disengageTimer += dt;
        if (this._disengageTimer < disengageHoldTime) {
          // 脱战计时未满，继续按 engaged 行动（走下面的规避/支援/solo 逻辑）
        } else {
          this._disengageTimer = 0;
          this.combatState = 'attackBomber';
          this._attackPhase = 'approach';  // 重新从接近阶段开始
          return this._thinkAttackBomber(dt, player, input);
        }
      } else {
        this.combatState = 'attackBomber';
        this._attackPhase = 'approach';  // 重新从接近阶段开始
        return this._thinkAttackBomber(dt, player, input);
      }
    } else {
      this._disengageTimer = 0; // 玩家靠近则归零
    }

    // 规避冷却 / 规避中（复用 evade 逻辑）
    if (this._evadeCd > 0) this._evadeCd -= dt;
    if (this._evadeTimer > 0) {
      this._evadeTimer -= dt;
      input.roll = this._evadeRoll;
      input.pitch = 0.6;
      input.throttleUp = true;
      return input;
    }
    // engaged 状态规避触发频率略高（默认冷却 5-9s，概率 = cfg.evasionChance * 1.3）
    // engagedEvasionCdMin/Max 默认 null = 5/9（原值），本关可通过 aiOverride 覆盖
    const evadeChance = cfg.evasionChance * 1.3;
    if (mePursued && this._evadeCd <= 0 && Math.random() < evadeChance) {
      const evCdMin = cfg.engagedEvasionCdMin ?? 5;
      const evCdMax = cfg.engagedEvasionCdMax ?? 9;
      this._evadeTimer = 1.2 + Math.random() * 0.8;
      this._evadeRoll = Math.random() < 0.5 ? 0.9 : -0.9;
      this._evadeCd = evCdMin + Math.random() * (evCdMax - evCdMin);
      input.roll = this._evadeRoll;
      input.pitch = 0.6;
      input.throttleUp = true;
      return input;
    }

    // 队友被咬尾 → 支援
    if (this.wingman && !this.wingman.crashed && this.wingman.ready) {
      _toT.copy(player.root.position).sub(this.wingman.root.position);
      const wingDistP = _toT.length();
      if (wingDistP < 400) {
        _invQ.copy(this.wingman.root.quaternion).invert();
        _localT.copy(_toT).applyQuaternion(_invQ);
        if (_localT.z > 0) return this._support(dt, player, input);  // 玩家在队友身后
      }
    }

    // 否则 → 一般单机 AI（巴巴罗萨风格：追击+巡逻，不持续咬尾）
    return this._thinkSolo(dt, player, input);
  }

  /**
   * 攻击友军轰炸机（combatState='attackBomber'，护航模式专用）：
   * - 玩家接近 < 800m → 切 engaged 攻击玩家
   * - 4 方向槽位（top/left/right/bottom）从不同方向接近轰炸机
   * - 攻击阶段：approach(接近) → strike(扫射) → egress(脱离) → 循环
   * - 距轰炸机 < 1000m 进入 strike 开火；< 250m 切 egress 脱离
   * - 子弹不会命中轰炸机（GameRuntime 命中检测跳过 friendlyBombers）
   * - 无轰炸机目标时退化到 solo
   */
  _thinkAttackBomber(dt, player, input) {
    const myPos = this.root.position;
    const cfg = this._aiCfg;
    const fc = cfg.fire;

    // 玩家相对位置
    _toP.copy(player.root.position).sub(myPos);
    const distPlayer = _toP.length();

    // 玩家接近 < playerNearDist → 切 engaged 攻击玩家（近距离威胁才脱离轰炸机攻击）
    // 被玩家开火时 takeDamage 已切 engaged，此处只处理距离触发
    // playerNearDist 默认 300（原值），本关可通过 aiOverride.playerNearDist 覆盖
    const playerNearDist = this._aiCfg.playerNearDist || 300;
    if (distPlayer < playerNearDist) {
      this._playerNearTimer += dt;
      const playerNearHoldTime = this._aiCfg.playerNearHoldTime || 4;
      if (this._playerNearTimer >= playerNearHoldTime) {
        this._breakFormation();
        this.combatState = 'engaged';
        this._lastPlayerAttackTime = performance.now();
        this._playerNearTimer = 0;
        return this._thinkEngaged(dt, player, input);
      }
    } else {
      this._playerNearTimer = 0; // 玩家拉开则归零
    }

    // 无轰炸机目标 → 退化 solo
    if (!this._bomberTargets || !this._bomberTargets.length) {
      this.combatState = 'solo';
      return this._thinkSolo(dt, player, input);
    }

    // 找最近的存活轰炸机
    let nearestBomber = null;
    let nearestDist = Infinity;
    for (const fb of this._bomberTargets) {
      if (!fb || !fb.ready || fb._despawnRequested) continue;
      _toT.copy(fb.root.position).sub(myPos);
      const d = _toT.length();
      if (d < nearestDist) { nearestDist = d; nearestBomber = fb; }
    }
    if (!nearestBomber) {
      this.combatState = 'solo';
      return this._thinkSolo(dt, player, input);
    }

    // 轰炸机位置 + 前向
    const bomberPos = nearestBomber.root.position;
    _bomberFwd.copy(nearestBomber.getForward());

    // 按方向槽位计算攻击占位点（从前后上下左右各方向接近）
    // top=前上方俯冲, bottom=后下方爬升, left=左侧, right=右侧, front=前方折回迎头
    _bomberTarget.copy(bomberPos);
    const slot = this._attackSlot || 'top';
    if (slot === 'top') {
      _bomberTarget.addScaledVector(_bomberFwd, 400);   // 前方 400m
      _bomberTarget.y += 400;                            // 上方 400m（俯冲攻击）
    } else if (slot === 'bottom') {
      _bomberTarget.addScaledVector(_bomberFwd, -400);  // 后方 400m
      _bomberTarget.y -= 250;                            // 下方 250m（爬升攻击）
    } else if (slot === 'left') {
      const left = new THREE.Vector3().crossVectors(_bomberFwd, _UP).normalize();
      _bomberTarget.addScaledVector(left, 500);          // 左侧 500m
      _bomberTarget.addScaledVector(_bomberFwd, 100);    // 略前方
      _bomberTarget.y += 100;
    } else if (slot === 'right') {
      const right = new THREE.Vector3().crossVectors(_UP, _bomberFwd).normalize();
      _bomberTarget.addScaledVector(right, 500);         // 右侧 500m
      _bomberTarget.addScaledVector(_bomberFwd, 100);    // 略前方
      _bomberTarget.y += 100;
    } else {  // front（飞到前方折回迎头）
      _bomberTarget.addScaledVector(_bomberFwd, 600);    // 前方 600m
      _bomberTarget.y += 150;
    }

    // 攻击阶段状态机：approach → strike → egress → approach（循环）
    // approach: 朝占位点飞；strike: 距轰炸机 < 1000m 朝轰炸机飞并开火；egress: < 250m 朝远离方向飞
    if (!this._attackPhase) this._attackPhase = 'approach';

    if (this._attackPhase === 'approach') {
      // 朝占位点飞
      _toT.copy(_bomberTarget).sub(myPos);
      const distT = _toT.length();
      _invQ.copy(this.root.quaternion).invert();
      _localT.copy(_toT).applyQuaternion(_invQ);
      input.pitch = THREE.MathUtils.clamp(_localT.y / Math.max(80, distT * 0.35), -cfg.maxPitch, cfg.maxPitch);
      input.roll = THREE.MathUtils.clamp(-_localT.x / Math.max(80, distT * 0.5), -cfg.maxRoll, cfg.maxRoll);
      input.yaw = THREE.MathUtils.clamp(-_localT.x / Math.max(120, distT * 0.7), -cfg.maxYaw, cfg.maxYaw);
      this._maintainThrottle(input);
      // 距轰炸机 < 1000m → 切 strike
      if (nearestDist < 1000) this._attackPhase = 'strike';
    } else if (this._attackPhase === 'strike') {
      // 朝轰炸机飞（俯冲/侧滑接近），进入射程开火
      _toT.copy(bomberPos).sub(myPos);
      const distT = _toT.length();
      _invQ.copy(this.root.quaternion).invert();
      _localT.copy(_toT).applyQuaternion(_invQ);
      input.pitch = THREE.MathUtils.clamp(_localT.y / Math.max(80, distT * 0.4), -cfg.maxPitch, cfg.maxPitch);
      input.roll = THREE.MathUtils.clamp(-_localT.x / Math.max(80, distT * 0.6), -cfg.maxRoll, cfg.maxRoll);
      input.yaw = THREE.MathUtils.clamp(-_localT.x / Math.max(120, distT * 0.8), -cfg.maxYaw, cfg.maxYaw);
      input.throttleUp = true;  // 加速掠过
      // 开火：前方窄锥 + 距离 200-1000m
      if (fc && _localT.z < 0 && distT > fc.distMin && distT < 1000) {
        if (this._fireCd > 0) this._fireCd -= dt;
        if (this._fireTimer > 0) this._fireTimer -= dt;
        if (this._fireTimer > 0) {
          input.fire = true;
        } else if (this._fireCd <= 0) {
          _fwd.copy(this.getForward());
          const angleOff = Math.acos(Math.max(-1, Math.min(1, _fwd.dot(_toT) / distT)));
          if (angleOff < fc.angleOff + 0.15) {
            input.fire = true;
            this._fireTimer = fc.burstMin + Math.random() * (fc.burstMax - fc.burstMin);
            this._fireCd = fc.cdMin + Math.random() * (fc.cdMax - fc.cdMin);
          }
        }
      }
      // 距轰炸机 < 250m → 切 egress 脱离
      if (nearestDist < 250) this._attackPhase = 'egress';
    } else {  // egress
      // 朝远离轰炸机方向飞（加速脱离）
      _toT.copy(myPos).sub(bomberPos).normalize();
      _bomberTarget.copy(myPos).addScaledVector(_toT, 800);
      _toT.copy(_bomberTarget).sub(myPos);
      const distT = _toT.length();
      _invQ.copy(this.root.quaternion).invert();
      _localT.copy(_toT).applyQuaternion(_invQ);
      input.pitch = THREE.MathUtils.clamp(_localT.y / Math.max(80, distT * 0.35), -cfg.maxPitch, cfg.maxPitch);
      input.roll = THREE.MathUtils.clamp(-_localT.x / Math.max(80, distT * 0.5), -cfg.maxRoll, cfg.maxRoll);
      input.yaw = THREE.MathUtils.clamp(-_localT.x / Math.max(120, distT * 0.7), -cfg.maxYaw, cfg.maxYaw);
      input.throttleUp = true;  // 全速脱离
      // 距轰炸机 > 1200m → 切回 approach 重新攻击
      if (nearestDist > 1200) this._attackPhase = 'approach';
    }

    return input;
  }

  /**
   * 支援：队友被咬尾时，从玩家后方/上方/侧方随机选一个方向包抄射击。
   * 每 4s 重选一次方向（避免频繁切换）。
   */
  _support(dt, player, input) {
    const myPos = this.root.position;
    const cfg = this._aiCfg;
    const sfc = cfg.supportFire;

    // 每 4s 重选方向
    this._engageTimer += dt;
    if (this._engageTimer > 4 || !this._supportDir) {
      this._supportDir = _SUPPORT_DIRS[Math.floor(Math.random() * _SUPPORT_DIRS.length)];
      this._engageTimer = 0;
    }

    const playerPos = player.root.position;
    const playerFwd = player.getForward();
    _playerRight.set(1, 0, 0).applyQuaternion(player.root.quaternion);

    switch (this._supportDir) {
      case 'rear':                                      // 玩家后方 300m
        _supportTarget.copy(playerPos).addScaledVector(playerFwd, -300);
        break;
      case 'top':                                       // 玩家上方 200m + 略后 100m
        _supportTarget.copy(playerPos).add(new THREE.Vector3(0, 200, 0)).addScaledVector(playerFwd, -100);
        break;
      case 'left':                                      // 玩家左侧 250m
        _supportTarget.copy(playerPos).addScaledVector(_playerRight, -250);
        break;
      case 'right':                                     // 玩家右侧 250m
        _supportTarget.copy(playerPos).addScaledVector(_playerRight, 250);
        break;
    }
    // 钳制高度（避免撞地或过高），上限按 _aiCfg.patrolAltMax + 100
    const groundH = this.terrain ? this.terrain.getHeight(_supportTarget.x, _supportTarget.z) : 0;
    const altCeil = (this._aiCfg.patrolAltMax || 1000) + 100;
    _supportTarget.y = Math.max(groundH + 200, Math.min(altCeil, _supportTarget.y));

    // 朝支援目标点飞
    _toT.copy(_supportTarget).sub(myPos);
    const distT = _toT.length();
    _invQ.copy(this.root.quaternion).invert();
    _localT.copy(_toT).applyQuaternion(_invQ);
    input.pitch = THREE.MathUtils.clamp(_localT.y / Math.max(80, distT * 0.35), -cfg.maxPitch, cfg.maxPitch);
    input.roll = THREE.MathUtils.clamp(-_localT.x / Math.max(80, distT * 0.5), -cfg.maxRoll, cfg.maxRoll);
    input.yaw = THREE.MathUtils.clamp(-_localT.x / Math.max(120, distT * 0.7), -cfg.maxYaw, cfg.maxYaw);
    input.throttleUp = true;                          // 支援时加速就位

    // 到达支援点附近且玩家在前方窄锥 → 开火
    if (sfc && distT < 600) {
      _toP.copy(playerPos).sub(myPos);
      const distP = _toP.length();
      if (distP > sfc.distMin && distP < sfc.distMax) {
        _local.copy(_toP).applyQuaternion(_invQ);
        if (_local.z < 0) {
          _fwd.copy(this.getForward());
          const angleOff = Math.acos(Math.max(-1, Math.min(1, _fwd.dot(_toP) / distP)));
          if (angleOff < sfc.angleOff) input.fire = true;
        }
      }
    }

    return input;
  }

  /**
   * 单机战斗（solo 或 engaged 未被咬尾/未支援时）：巡逻 + 规避 + 低欲望攻击。
   * 即原有 think 逻辑。
   */
  _thinkSolo(dt, player, input) {
    const myPos = this.root.position;
    const cfg = this._aiCfg;
    const fc = cfg.fire;

    // 玩家相对位置（用于规避/开火/靠近判断）
    _toP.copy(player.root.position).sub(myPos);
    const distP = _toP.length();
    _invQ.copy(this.root.quaternion).invert();
    _local.copy(_toP).applyQuaternion(_invQ);
    const playerBehind = _local.z > 0; // 玩家在身后 = 被咬尾

    // 规避冷却 / 规避中
    if (this._evadeCd > 0) this._evadeCd -= dt;
    if (this._evadeTimer > 0) {
      this._evadeTimer -= dt;
      input.roll = this._evadeRoll;
      input.pitch = 0.6;
      input.throttleUp = true;
      return input;
    }
    if (this._evadeCd <= 0 && playerBehind && distP < (cfg.pursuedDist || 350) && Math.random() < cfg.evasionChance) {
      this._evadeTimer = 1.2 + Math.random() * 0.8;
      this._evadeRoll = Math.random() < 0.5 ? 0.9 : -0.9;
      this._evadeCd = cfg.evasionCdMin + Math.random() * (cfg.evasionCdMax - cfg.evasionCdMin);
      input.roll = this._evadeRoll;
      input.pitch = 0.6;
      input.throttleUp = true;
      return input;
    }

    // 选择目标点
    let target;
    const dCenter = Math.hypot(myPos.x - this._patrolCenter.x, myPos.z - this._patrolCenter.z);
    if (distP > 1500) {
      target = player.root.position;            // 玩家太远，向玩家靠近
    } else if (dCenter > 1300) {
      _loiterTarget.set(this._patrolCenter.x, myPos.y, this._patrolCenter.z);
      target = _loiterTarget;                    // 飞离巡逻中心，返回中心
    } else {
      const wp = this._waypoints[this._wpIdx];
      if (myPos.distanceTo(wp) < 250) {
        this._wpIdx = (this._wpIdx + 1) % this._waypoints.length;
      }
      target = this._waypoints[this._wpIdx];
    }

    // 朝目标点飞（巡逻盘旋，温和舵量）
    _toT.copy(target).sub(myPos);
    const distT = _toT.length();
    _localT.copy(_toT).applyQuaternion(_invQ);
    input.pitch = THREE.MathUtils.clamp(_localT.y / Math.max(80, distT * 0.35), -cfg.maxPitch, cfg.maxPitch);
    input.roll = THREE.MathUtils.clamp(-_localT.x / Math.max(80, distT * 0.5), -cfg.maxRoll, cfg.maxRoll);
    input.yaw = THREE.MathUtils.clamp(-_localT.x / Math.max(120, distT * 0.7), -cfg.maxYaw, cfg.maxYaw);
    this._maintainThrottle(input);

    // 攻击（读取 _aiCfg.fire 参数：锥宽/距离/连发时长/冷却）
    if (!fc) return input;
    if (this._fireCd > 0) this._fireCd -= dt;
    if (this._fireTimer > 0) this._fireTimer -= dt;
    if (this._fireTimer > 0) {
      input.fire = true;
    } else if (this._fireCd <= 0) {
      if (_local.z < 0 && distP > fc.distMin && distP < fc.distMax) {
        _fwd.copy(this.getForward());
        const angleOff = Math.acos(Math.max(-1, Math.min(1, _fwd.dot(_toP) / distP)));
        if (angleOff < fc.angleOff) {
          input.fire = true;
          this._fireTimer = fc.burstMin + Math.random() * (fc.burstMax - fc.burstMin);
          this._fireCd = fc.cdMin + Math.random() * (fc.cdMax - fc.cdMin);
        }
      }
    }

    return input;
  }

  // ==================== 轰炸机/运输机 AI ====================

  /**
   * 轰炸机/运输机 AI：
   * - 编队直飞（长机按 waypoint 巡逻，僚机跟随），不因受击散开
   * - 几乎不机动：舵量上限极小（由 _aiCfg.maxRoll/Pitch/Yaw 物理限制）
   * - HP < 20% 时做轻微偏航修正（左右摇摆，模拟受损勉强维持航向）
   * - 机身自卫炮塔：雷达式扫描（30°锥），玩家进入任意炮塔射击锥且在距离内即开火
   *   反应慢（1.2s+），短连发（2s），冷却长（4-7s），伤害低
   * - 优先地面目标（若 groundTargets 非空，则朝最近地面目标直飞）
   */
  _thinkBomber(dt, player, input) {
    const myPos = this.root.position;
    const cfg = this._aiCfg;

    // 0. 航线直飞模式（本关专用，最高优先级）：按 _route 飞越航点，到达终点后脱离
    //    轰炸机平飞不盘旋、不追玩家，只按航线飞，到边缘消失
    if (this._route && this._route.length && this._routeIdx < this._route.length) {
      const wp = this._route[this._routeIdx];
      _toT.copy(wp).sub(myPos);
      const distW = _toT.length();
      if (distW < 250) {
        // 到达当前航点，切下一个；最后一个航点到达 → 请求脱离
        this._routeIdx++;
        if (this._routeIdx >= this._route.length) {
          this._despawnRequested = true;
          if (this.model) this.model.visible = false;
          if (this.propBranches) {
            // 隐藏螺旋桨模糊盘等所有子节点
            this.root.traverse((o) => { if (o !== this.root) o.visible = false; });
          }
          input.throttleDown = true;
          return input;
        }
      }
      // 朝当前航点平飞（不滚转，仅俯仰/偏航微调保持航向）
      this._flyToTarget(_toT, input, 0.0, cfg.maxPitch, cfg.maxYaw);
      this._maintainThrottle(input);
      // 自卫炮塔仍可开火（航线直飞时炮塔独立运作）
      this._bomberTurretFire(dt, player, input, myPos, cfg);
      return input;
    }

    // 1. 优先地面目标（stub：若存在则朝最近目标直飞）
    const gt = this._getNearestGroundTarget();
    if (gt) {
      _toT.copy(gt).sub(myPos);
      if (_toT.length() > 100) {
        this._flyToTarget(_toT, input, 0.0, cfg.maxPitch, cfg.maxYaw);
        this._maintainThrottle(input);
        return input;
      }
    }

    // 2. HP < 20% 时轻微偏航修正（左右摇摆，模拟受损）
    if (this.hp < this.maxHp * 0.2) {
      input.yaw = Math.sin(performance.now() * 0.001) * 0.10;
    }

    // 3. 编队飞行（长机巡逻 / 僚机跟随）
    if (this.isLeader || !this.wingman) {
      const dCenter = Math.hypot(myPos.x, myPos.z);
      let target;
      if (dCenter > 1300) {
        _center.y = myPos.y;  // 保持当前高度回中央（避免硬编码 700m 导致高空敌机上下横跳）
        target = _center;
      } else {
        const wp = this._waypoints[this._wpIdx];
        if (myPos.distanceTo(wp) < 300) {
          this._wpIdx = (this._wpIdx + 1) % this._waypoints.length;
        }
        target = this._waypoints[this._wpIdx];
      }
      _toT.copy(target).sub(myPos);
      this._flyToTarget(_toT, input, 0.0, cfg.maxPitch, cfg.maxYaw);
    } else {
      const leader = this.wingman;
      if (!leader || !leader.ready || leader.crashed) {
        const wp = this._waypoints[this._wpIdx];
        _toT.copy(wp).sub(myPos);
        this._flyToTarget(_toT, input, 0.0, cfg.maxPitch, cfg.maxYaw);
      } else if (leader._despawnRequested) {
        // 长机已脱离（到达航线终点），僚机跟随脱离
        this._despawnRequested = true;
        if (this.model) this.model.visible = false;
        input.throttleDown = true;
        return input;
      } else {
        _toW.copy(this.formationOffset).applyQuaternion(leader.root.quaternion).add(leader.root.position);
        _toT.copy(_toW).sub(myPos);
        this._flyToTarget(_toT, input, 0.0, cfg.maxPitch, cfg.maxYaw);
      }
    }

    // 4. 机身自卫炮塔开火（独立雷达式扫描，不要求机头朝向玩家）
    this._bomberTurretFire(dt, player, input, myPos, cfg);

    this._maintainThrottle(input);
    return input;
  }

  /**
   * 轰炸机自卫炮塔开火逻辑（独立于飞行模式，航线直飞/编队巡逻都可调用）。
   * 雷达式扫描：玩家进入任一炮塔射击锥（30°）且在距离内 → 反应延迟 → 短连发 → 长冷却。
   * 不要求机体朝向玩家，只看玩家方位 vs 各炮塔方向夹角。
   */
  _bomberTurretFire(dt, player, input, myPos, cfg) {
    const fc = cfg.fire;
    if (!fc || !this.muzzleDirs) return;
    _toP.copy(player.root.position).sub(myPos);
    const distP = _toP.length();
    if (distP <= fc.distMin || distP >= fc.distMax) {
      // 玩家超出射程，重置反应计时
      this._fireReact = 0;
      return;
    }
    // 计算玩家方向（世界坐标单位向量）
    _toP.normalize();
    // 检查每个炮塔是否能打到玩家（玩家方向 vs 炮塔方向夹角）
    let turretCanHit = false;
    const worldDirs = this.getMuzzleWorldDirs();
    if (worldDirs) {
      for (let i = 0; i < worldDirs.length; i++) {
        const dot = worldDirs[i].dot(_toP);
        if (dot > Math.cos(fc.angleOff)) { turretCanHit = true; break; }
      }
    }
    // 开火计时：反应延迟 + 短连发 + 长冷却
    if (this._fireCd > 0) this._fireCd -= dt;
    if (this._fireTimer > 0) this._fireTimer -= dt;
    if (this._fireTimer > 0) {
      input.fire = true;
    } else if (this._fireCd <= 0) {
      // 反应延迟：玩家进入射击锥后等 reactMin~reactMax 秒才真正开火
      if (turretCanHit) {
        if (this._fireReact > 0) {
          this._fireReact -= dt;
          if (this._fireReact <= 0) {
            input.fire = true;
            this._fireTimer = fc.burstMin + Math.random() * (fc.burstMax - fc.burstMin);
            this._fireCd = fc.cdMin + Math.random() * (fc.cdMax - fc.cdMin);
            this._fireReact = 0;
          }
        } else {
          // 首次进入射击锥，启动反应计时
          this._fireReact = fc.reactMin + Math.random() * (fc.reactMax - fc.reactMin);
        }
      }
    }
  }

  // ==================== 攻击机/俯冲轰炸机 AI ====================

  /**
   * 攻击机/俯冲轰炸机 AI：
   * - 避免缠斗：玩家靠近时低空规避或左右摇摆，不大滚转
   * - 优先地面目标（若 groundTargets 非空，则朝目标做攻击跑次）
   * - 无地面目标时：低空巡逻
   * - 规避方式：侧滑（yaw + 小幅 roll）+ 高度变化（climb/dive），不桶滚
   */
  _thinkAttacker(dt, player, input) {
    // IL-2 专属状态机（patrol/scatter/groundAttack）
    if (this._il2State) return this._thinkIl2(dt, player, input);

    const myPos = this.root.position;

    // 玩家相对位置
    _toP.copy(player.root.position).sub(myPos);
    const distP = _toP.length();
    _invQ.copy(this.root.quaternion).invert();
    _local.copy(_toP).applyQuaternion(_invQ);
    const playerBehind = _local.z > 0;

    // 1. 飞行行为（规避 > 对地 > 巡逻，子方法只改 input 不 return）
    if (distP < 600 && (playerBehind || distP < 350)) {
      this._attackerEvasion(dt, player, input, distP);
    } else {
      const gt = this._getNearestGroundTarget();
      if (gt) {
        this._attackerGroundAttack(dt, player, input, gt);
      } else {
        this._attackerPatrol(dt, player, input);
      }
    }

    // 2. 空对空开火（独立于飞行模式：前射固定枪 + 后座自卫炮塔）
    this._attackerAirFire(dt, player, myPos, distP);

    return input;
  }

  // ==================== IL-2 专属 AI 状态机 ====================

  /**
   * IL-2 攻击机专属 AI（patrol/retreat 两状态）。
   * - patrol：低空 300-500m waypoint 巡逻，后炮塔自卫开火，被攻击时规避
   * - retreat：玩家距离<300m 触发，朝苏军边界 z+ 全速飞，后炮塔持续开火
   *   被攻击：80% 偏航/加减速机动，20% 轻微俯仰改变高度
   * 撤退成功（距离>10000m 持续5s 或 到边界）由 WaveDirector 检测，不计战果
   */
  _thinkIl2(dt, player, input) {
    const myPos = this.root.position;
    _toP.copy(player.root.position).sub(myPos);
    const distP = _toP.length();

    // 被持续射击跟踪（_hitFlag 由 takeDamage 设置）
    if (this._hitFlag) { this._sustainedFireTime += dt; this._hitFlag = false; }
    else this._sustainedFireTime = 0;

    // 每帧重置武器分组开火标志
    if (this.weapons && this.weapons.enemyGroups) {
      this.weapons.setGroupFiring('forward', false);
      this.weapons.setGroupFiring('turret', false);
    }

    // ---- 状态转换 ----
    // patrol → break：接敌感知（玩家<1500m 或 被攻击）触发分头散开
    if (this._il2State === 'patrol' && (distP < 1500 || this._sustainedFireTime > 0)) {
      this._il2State = 'break';
      this._il2BreakTimer = 2.0 + Math.random() * 1.0;
      const ang = (Math.random() < 0.5 ? 1 : -1) * Math.PI / 4;
      this._il2BreakDir.copy(this.getForward()).applyAxisAngle(_UP, ang);
    }
    // break → retreat：分头持续 2-3s 后转撤退
    if (this._il2State === 'break' && this._il2BreakTimer <= 0) {
      this._il2State = 'retreat';
    }

    // ---- 执行状态 ----
    if (this._il2State === 'patrol') {
      this._il2Patrol(dt, input, myPos);
    } else if (this._il2State === 'break') {
      this._il2Break(dt, input, myPos);
    } else {
      this._il2Retreat(dt, input, myPos);
    }

    // 后座自卫炮塔开火（patrol/break/retreat 都开火，主要攻击方式）
    this._attackerAirFire(dt, player, input, myPos, distP);


    return input;
  }

  /** IL-2 巡逻：固定高度 waypoint 盘旋 + 被攻击时规避 */
  _il2Patrol(dt, input, myPos) {
    const cfg = this._aiCfg;

    // waypoint 巡逻
    const wp = this._waypoints[this._wpIdx];
    if (myPos.distanceTo(wp) < 250) {
      this._wpIdx = (this._wpIdx + 1) % this._waypoints.length;
    }
    _toT.copy(wp).sub(myPos);
    this._flyToTarget(_toT, input, cfg.maxRoll, cfg.maxPitch, cfg.maxYaw);

    // 固定高度平飞（覆盖 _flyToTarget 的 pitch，极缓修正到 _patrolAltTarget）
    const altErr = this._patrolAltTarget - myPos.y;
    input.pitch = THREE.MathUtils.clamp(altErr / 400, -cfg.maxPitch, cfg.maxPitch);

    // 被攻击时规避
    this._il2Evasion(dt, input);

    this._maintainThrottle(input);
  }

  /** IL-2 接敌分头：朝随机侧前 45° 方向全速飞 2-3s，然后转 retreat */
  _il2Break(dt, input, myPos) {
    const cfg = this._aiCfg;
    this._il2BreakTimer -= dt;

    // 朝分头方向飞（侧前 45°）
    _toT.copy(this._il2BreakDir).multiplyScalar(2000);
    this._flyToTarget(_toT, input, cfg.maxRoll, cfg.maxPitch, cfg.maxYaw);

    // 被攻击时规避
    this._il2Evasion(dt, input);

    // 全速脱离
    input.throttleUp = true;
    input.throttleDown = false;
  }

  /** IL-2 撤退：朝苏军边界 z+ 全速飞 + 被攻击时规避 + 后炮塔开火 */
  _il2Retreat(dt, input, myPos) {
    const cfg = this._aiCfg;

    // 朝苏军边界（z+ 远方）直飞
    _toT.set(0, myPos.y, 20000).sub(myPos);
    this._flyToTarget(_toT, input, cfg.maxRoll, cfg.maxPitch, cfg.maxYaw);

    // 被攻击时规避
    this._il2Evasion(dt, input);

    this._maintainThrottle(input);
    // 撤退全速飞
    input.throttleUp = true;
    input.throttleDown = false;
  }

  /** IL-2 规避：被攻击时 95% 偏航/加减速，5% 短暂拉起调整高度（不俯冲不翻跟头） */
  _il2Evasion(dt, input) {
    if (this._sustainedFireTime <= 0) return;
    if (this._evadeCd > 0) this._evadeCd -= dt;
    if (this._evadeTimer > 0) {
      this._evadeTimer -= dt;
      if (this._evadeMode === 0) {
        // 偏航 + 加减速机动
        input.yaw = this._evadeYawDir;
        input.roll = this._evadeYawDir * 0.15;
        if (this._evadeAccel) { input.throttleUp = true; input.throttleDown = false; }
        else { input.throttleDown = true; input.throttleUp = false; }
      } else {
        // 短暂拉起调整高度（仅爬升不俯冲，不翻跟头）
        input.pitch = 0.2;
      }
    } else if (this._evadeCd <= 0) {
      this._evadeTimer = 1.0 + Math.random() * 0.5;
      this._evadeYawDir = Math.random() < 0.5 ? 0.5 : -0.5;
      this._evadeMode = Math.random() < 0.95 ? 0 : 1;  // 95% 偏航+加速, 5% 短暂拉起
      this._evadeAccel = Math.random() < 0.5;
      this._evadeCd = 2 + Math.random() * 1;
    }
  }

  /**
   * 攻击机空对空开火（独立于飞行模式）。
   * - 前射固定枪（forward 组）：正对玩家锥内持续开火（无CD）
   * - 后座自卫炮塔（turret 组）：以后枪指向线为中心 45° 锥，距离概率门
   */
  _attackerAirFire(dt, player, input, myPos, distP) {
    if (!this.weapons || !this.weapons.enemyGroups) return;
    const cfg = this._aiCfg;

    // ---- 前射固定枪：正对玩家锥内持续开火（无CD）----
    const fc = cfg.fire;
    if (fc && distP >= fc.distMin && distP <= fc.distMax) {
      _fwd.copy(this.getForward());
      _toT.copy(player.root.position).sub(myPos).normalize();
      if (_fwd.dot(_toT) > Math.cos(fc.angleOff)) {
        this.weapons.setGroupFiring('forward', true);
      }
    }

    // ---- 后座自卫炮塔：以后枪指向线为中心 45° 锥 + 距离概率门 ----
    this._attackerTurretFire(dt, player, myPos, cfg);
  }

  /**
   * 攻击机后座自卫炮塔开火（以后枪指向线为中心 45° 锥，模拟自由转动射界）。
   * 命中率：distOpen 1200 开始开火，distPeak 300 命中率顶点，300-1200 线性衰减。
   */
  _attackerTurretFire(dt, player, myPos, cfg) {
    const tfc = cfg.turretFire;
    if (!tfc || !this.muzzleDirs) return;

    _toP.copy(player.root.position).sub(myPos);
    const distT = _toP.length();
    if (distT > tfc.distOpen) { this._turretFireReact = 0; return; }
    _toP.normalize();

    // 后炮塔射界判定：以后枪指向线为中心 45° 锥内可射击（遍历 turret 组枪口朝向）
    let turretCanHit = false;
    const worldDirs = this.getMuzzleWorldDirs();
    if (worldDirs) {
      const cosCone = Math.cos(tfc.angleOff);
      const turretGroup = cfg.muzzleGroups && cfg.muzzleGroups.find(g => g.name === 'turret');
      const indices = turretGroup ? turretGroup.indices : null;
      if (indices) {
        for (const i of indices) {
          if (i < worldDirs.length && worldDirs[i].dot(_toP) > cosCone) { turretCanHit = true; break; }
        }
      }
    }
    if (!turretCanHit) { this._turretFireReact = 0; return; }

    // 命中概率门：distPeak→1.0, distOpen→0.15 线性衰减
    const hitChance = THREE.MathUtils.clamp(
      (tfc.distOpen - distT) / (tfc.distOpen - tfc.distPeak), 0.15, 1.0
    );

    // 开火计时：反应延迟 + 长连发（2-4s）+ 短冷却
    if (this._turretFireCd > 0) this._turretFireCd -= dt;
    if (this._turretFireTimer > 0) this._turretFireTimer -= dt;
    if (this._turretFireTimer > 0) {
      this.weapons.setGroupFiring('turret', true);
    } else if (this._turretFireCd <= 0) {
      if (this._turretFireReact > 0) {
        this._turretFireReact -= dt;
        if (this._turretFireReact <= 0) {
          if (Math.random() < hitChance) {
            this.weapons.setGroupFiring('turret', true);
            this._turretFireTimer = tfc.burstMin + Math.random() * (tfc.burstMax - tfc.burstMin);
            this._turretFireCd = tfc.cdMin + Math.random() * (tfc.cdMax - tfc.cdMin);
          }
          this._turretFireReact = 0;
        }
      } else {
        this._turretFireReact = tfc.reactMin + Math.random() * (tfc.reactMax - tfc.reactMin);
      }
    }
  }

  /** 攻击机规避：侧滑 + 高度变化，不桶滚 */
  _attackerEvasion(dt, player, input, distP) {
    if (this._evadeCd > 0) this._evadeCd -= dt;
    if (this._evadeTimer > 0) {
      this._evadeTimer -= dt;
      input.yaw = this._evadeYawDir;
      input.roll = this._evadeYawDir * 0.2;   // 极小滚转辅助侧滑
      input.pitch = this._evadePitchDir;       // +0.4 爬升 / -0.4 俯冲
      input.throttleDown = distP < 200;        // 被咬尾减速让玩家冲过头
      input.throttleUp = distP > 400;          // 前方则加速脱离
      return input;
    }

    // 重新触发规避
    if (this._evadeCd <= 0) {
      this._evadeTimer = 1.5 + Math.random() * 1.0;
      this._evadeYawDir = Math.random() < 0.5 ? 0.5 : -0.5;
      // 70% 概率俯冲（贴地逃跑），30% 爬升
      this._evadePitchDir = Math.random() < 0.7 ? -0.4 : 0.4;
      this._evadeCd = 3 + Math.random() * 2;
    }

    this._maintainThrottle(input);
    return input;
  }

  /** 攻击机对地攻击跑次（stub：朝目标俯冲，到达后开火 + 拉起） */
  _attackerGroundAttack(dt, player, input, targetPos) {
    const cfg = this._aiCfg;
    const gfc = cfg.groundFire;
    const myPos = this.root.position;
    _toT.copy(targetPos).sub(myPos);
    const distT = _toT.length();
    _invQ.copy(this.root.quaternion).invert();
    _localT.copy(_toT).applyQuaternion(_invQ);

    // 朝目标飞（允许俯冲，不大滚转）
    input.pitch = THREE.MathUtils.clamp(_localT.y / Math.max(80, distT * 0.4), -0.6, cfg.maxPitch);
    input.roll  = THREE.MathUtils.clamp(-_localT.x / Math.max(80, distT * 0.5), -cfg.maxRoll, cfg.maxRoll);
    input.yaw   = THREE.MathUtils.clamp(-_localT.x / Math.max(120, distT * 0.7), -cfg.maxYaw, cfg.maxYaw);

    // 进入射程 → 开火（对地）
    if (gfc && distT < gfc.distMax && distT > gfc.distMin) {
      _fwd.copy(this.getForward());
      const angleOff = Math.acos(Math.max(-1, Math.min(1, _fwd.dot(_toT) / distT)));
      if (angleOff < gfc.angleOff) {
        const hasGroups = !!this.weapons && !!this.weapons.enemyGroups;
        if (this._fireCd > 0) this._fireCd -= dt;
        if (this._fireTimer > 0) {
          this._fireTimer -= dt;
          if (hasGroups) this.weapons.setGroupFiring('forward', true);
          else input.fire = true;
        } else if (this._fireCd <= 0) {
          if (hasGroups) this.weapons.setGroupFiring('forward', true);
          else input.fire = true;
          this._fireTimer = gfc.burstMin + Math.random() * (gfc.burstMax - gfc.burstMin);
          this._fireCd = gfc.cdMin + Math.random() * (gfc.cdMax - gfc.cdMin);
        }
      }
    }

    this._maintainThrottle(input);
    return input;
  }

  /** 攻击机低空巡逻：waypoint + 贴地飞行 */
  _attackerPatrol(dt, player, input) {
    const cfg = this._aiCfg;
    const myPos = this.root.position;
    const wp = this._waypoints[this._wpIdx];
    if (myPos.distanceTo(wp) < 250) {
      this._wpIdx = (this._wpIdx + 1) % this._waypoints.length;
    }
    _toT.copy(wp).sub(myPos);
    this._flyToTarget(_toT, input, cfg.maxRoll, cfg.maxPitch, cfg.maxYaw);
    this._maintainThrottle(input);
    return input;
  }

  // ==================== 共享辅助方法 ====================

  /** 朝目标点飞（局部坐标 → 舵量，受 maxRoll/Pitch/Yaw 限制）*/
  _flyToTarget(toTargetVec, input, maxRoll, maxPitch, maxYaw) {
    const distT = toTargetVec.length();
    _invQ.copy(this.root.quaternion).invert();
    _localT.copy(toTargetVec).applyQuaternion(_invQ);
    input.pitch = THREE.MathUtils.clamp(_localT.y / Math.max(80, distT * 0.35), -maxPitch, maxPitch);
    input.roll  = THREE.MathUtils.clamp(-_localT.x / Math.max(80, distT * 0.5), -maxRoll, maxRoll);
    input.yaw   = THREE.MathUtils.clamp(-_localT.x / Math.max(120, distT * 0.7), -maxYaw, maxYaw);
  }

  /** 油门维持巡航速度 */
  _maintainThrottle(input) {
    if (this.speed < this.cruiseSpeed * 0.85) input.throttleUp = true;
    else if (this.speed > this.cruiseSpeed * 1.15) input.throttleDown = true;
  }

  /** 获取最近的地面目标位置（stub：返回 Vector3 或 null）*/
  _getNearestGroundTarget() {
    if (!this.groundTargets) return null;
    const list = this.groundTargets.getAliveTargets();
    if (!list || !list.length) return null;
    let best = null, bestD = Infinity;
    const myPos = this.root.position;
    for (const t of list) {
      const d = myPos.distanceToSquared(t.position);
      if (d < bestD) { bestD = d; best = t.position; }
    }
    return best;
  }

  /** 每帧统一推进：AI 决策 → 物理 → 舵面/动画 → 武器 */
  updateAll(dt, player) {
    if (!this.ready) return;
    const input = this.think(dt, player);
    this.updateFlight(dt, input);   // crashed 时内部自处理（含 _updateCrash → reset 重生）
    this.update(dt);                // 舵面 + 螺旋桨动画
    this.weapons.update(dt, !!input.fire && !this.crashed);
  }

  /** 返回敌机位置（供雷达/碰撞，保持与 targets 同接口风格）*/
  getPosition() { return this.root.position; }
}
