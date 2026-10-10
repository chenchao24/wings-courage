/**
 * 自由模式 · 玩家可选机型配置（与战役模式完全隔离）。
 *
 * 玩家飞机属性与原游戏保持一致：
 *   - bf109: 走 Aircraft 构造函数默认值（与第1/2关一致），武器组复制第1关 mg17+mgff
 *   - fw190: playerConfig 独立复制第3关校准/物理/武器（与 kursk 一致，但数据独立维护）
 *
 * 本文件不 import 任何 js/config/levels/* 文件，数据独立硬编码。
 */

// ──────────────────────────────────────────────────
// Bf 109 E-4（玩家默认机型，与第1/2关一致）
// 走 Aircraft 构造函数默认值，仅需武器组配置
// ──────────────────────────────────────────────────
const BF109_PLAYER = {
  id: 'bf109',
  name: 'Bf 109 E-4',
  subtitle: 'Messerschmitt',
  nation: '德',
  model: '/model/bf109_opt.glb',
  history: '梅塞施密特 Bf 109 是二战德国空军最主要的主力战斗机，由威利·梅塞施密特设计。E-4 型是 1940 年不列颠战役期间的主力，搭载 DB 601A 倒置 V12 发动机。轻巧灵活，爬升与垂直机动出色，是 1941 年东线战场开战时的德军主力。',
  realSpec: [
    ['最大速度', '548 km/h'],
    ['航程', '660 km'],
    ['发动机', 'DB 601A · 1175 hp'],
    ['武装', '2×MG17 7.92mm + 2×MG FF/M 20mm'],
    ['服役', '1940'],
  ],
  gameBars: [
    ['机动性', 5],
    ['火力', 4],
    ['速度', 4],
    ['爬升', 5],
    ['生存性', 3],
  ],
  // playerConfig：仅武器组（其余走 Aircraft 构造函数默认值）
  // 武器组复制第1关配置（MG 17 机头 + MG FF/M 机翼）
  playerConfig: {
    weapons: {
      groups: {
        mg17: {
          muzzleIndices: [2, 3],
          fireRate: 0.08,
          bulletSpeed: 755,
          damageMin: 3,
          damageMax: 8,
          bulletScale: 1.0,
          bulletColor: 0xfff4c8,
          explosive: false,
          sound: { file: '/sound/gun/bf109-792.mp3', loopStart: 0.02, loopEnd: 0.11 },
        },
        mgff: {
          muzzleIndices: [0, 1],
          fireRate: 0.14,
          bulletSpeed: 700,
          damageMin: 15,
          damageMax: 28,
          bulletScale: 1.8,
          bulletColor: 0xff5520,
          explosive: true,
          sound: { file: '/sound/gun/bf109-20.mp3', loopStart: 0.02, loopEnd: 0.13 },
        },
      },
    },
  },
};

// ──────────────────────────────────────────────────
// Fw 190 A-4（玩家机型，与第3关一致，数据独立复制）
// ──────────────────────────────────────────────────
const FW190_PLAYER = {
  id: 'fw190',
  name: 'Fw 190 A-4',
  subtitle: 'Focke-Wulf',
  nation: '德',
  model: '/model/fw_190_a-5.glb',
  history: '福克-沃尔夫 Fw 190 由库尔特·谭克设计，1941 年服役，是 Bf 109 的补充与继任。A-4 型搭载 BMW 801D 星形发动机，火力与机动性均衡，低空性能优异，被盟军称为"屠夫鸟"。滚转率远超 Bf 109，适合能量战术与俯冲攻击。',
  realSpec: [
    ['最大速度', '656 km/h'],
    ['航程', '800 km'],
    ['发动机', 'BMW 801D · 1700 hp'],
    ['武装', '2×MG17 7.92mm + 4×MG151 20mm'],
    ['服役', '1942'],
  ],
  gameBars: [
    ['机动性', 4],
    ['火力', 5],
    ['速度', 5],
    ['爬升', 4],
    ['生存性', 4],
  ],
  previewOffset: [0, 0, -2.6],
  playerConfig: {
    autoOrient: false,
    yawOffset: 180.0,
    userScale: 3.81,
    centerOffset: [0.00, 0.00, -3.05],
    propNodes: [],
    hideGear: true,
    hideGearNodes: ['Object_4', 'Object_3', 'Object_5'],
    glassNodes: ['Object_9'],
    cockpitLight: {
      x: 0.00, y: 2.40, z: 4.80,
      color: 0xfff2d8, intensity: 2.0, distance: 16, decay: 2.0,
    },
    propProcedural: true,
    propBlurDisc: true,
    propBlurStyle: 'fw',
    propHubOffset: [-0.10, -0.45, -5.80],
    propRadius: 5.20,
    propBladeCount: 3,
    propBladeChord: 0.85,
    propBladeTwist: 35,
    propSpinSpeed: 295,
    propOpacity: 0.00,
    propBlurStrength: 0.90,
    propCut: { zMin: -7.0, zMax: -5.5, cx: 0.0, cy: -0.5, radius: 0.8 },
    muzzleOffsets: [
      [ 0.40,  1.65, -1.80],
      [-0.40,  1.65, -1.80],
      [ 3.10, -1.60, -2.65],
      [ 7.80, -1.10, -1.65],
      [-3.10, -1.60, -2.75],
      [-7.85, -1.20, -1.70],
    ],
    weapons: {
      groups: {
        mg17: {
          muzzleIndices: [0, 1],
          fireRate: 0.10,
          bulletSpeed: 750,
          damageMin: 5,
          damageMax: 10,
          bulletScale: 1.0,
          bulletColor: 0xfff4c8,
          explosive: false,
          sound: { file: '/sound/gun/fw190-131-2.mp3', loopStart: 0.0, loopEnd: 0.21 },
        },
        mg151: {
          muzzleIndices: [2, 3, 4, 5],
          fireRate: 0.18,
          bulletSpeed: 700,
          damageMin: 18,
          damageMax: 36,
          bulletScale: 2.0,
          bulletColor: 0xfff4c8,
          explosive: true,
          sound: { file: '/sound/gun/fw190-151-2.mp3', loopStart: 0.02, loopEnd: 0.29 },
        },
      },
    },
    maxSpeed: 175, minSpeed: 8, cruiseSpeed: 110,
    pitchMax: 1.25, pitchResp: 5.5,
    rollMax: 3.4, rollResp: 7.5,
    yawMax: 0.7, yawResp: 3.5,
    gravity: 4.0, liftK: 0.026, diveAccel: 10, stallThreshold: 12,
    cockpit: {
      x: -0.04, y: 2.25, z: 5.04,
      lookDist: 192, aimLift: 0.145, aimDist: 1600,
      chase: { x: 0.00, y: 4.20, z: 12.50 },
    },
  },
};

/** 玩家可选机型列表 */
export const PLAYER_AIRCRAFT = [BF109_PLAYER, FW190_PLAYER];

/** 按 id 查玩家机型配置 */
export function getPlayerAircraft(id) {
  return PLAYER_AIRCRAFT.find((a) => a.id === id);
}