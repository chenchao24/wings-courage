/**
 * 自由模式 · 敌机机型配置（与战役模式完全隔离）。
 *
 * 当前可选敌机：i16 / spitfire / yak7 / yak9
 * 校准参数（外观）+ 性能参数（飞行）独立复制自 enemy.js 的 MODEL_CONFIGS / MODEL_SPECS，
 * 但数据在本文件独立维护，未来可单独调整不影响战役模式。
 *
 * HP 规则：本文件 maxHp 为基础值；FreeModeEnemy 构造时按"原模式一半"规则应用
 * （即实际 maxHp = config.maxHp * 0.5，由 FreeModeRuntime 在创建时设置）。
 */

import * as THREE from 'three';

/**
 * 敌机校准参数（外观：朝向/缩放/枪口/起落架等）。
 * 按 model URL 索引，结构对齐 enemy.js MODEL_CONFIGS（仅保留本模式所需机型）。
 */
export const FREE_ENEMY_MODEL_CONFIGS = {
  // Polikarpov I-16 "小毛驴"（单翼战斗机）
  '/model/i16.glb': {
    autoOrient: true,
    userScale: 3.27,
    noVaporTrail: true,
  },
  // Supermarine Spitfire Mk IIa（英国主力战斗机）
  '/model/spitfire.glb': {
    autoOrient: false,
    yawOffset: -124.091,
    userScale: 4.08,
    hideGear: true,
    hideGearNodes: [
      'Object03-FACES_1','Cylinder07-FACES_1','Cylinder01-FACES_1','Cylinder06-FACES_1',
      'Torus01-FACES_1','Cylinder05-FACES_1','Cylinder82-FACES_1','Cylinder83-FACES_1',
      'Torus04-FACES_1','Cylinder84-FACES_1','Cylinder81-FACES_1','Object02-FACES_1',
      'Cylinder80-FACES_1','Cylinder20-FACES_1','Cylinder02-FACES_1','Torus03-FACES_1',
      'Cylinder16-FACES_1',
    ],
    propNodes: ['Cylinder78-FACES_1','Cylinder79-FACES_1','Cylinder77-FACES_1'],
    propSpinSpeed: 95,
    propOpacity: 0.14,
    propBlurDisc: true,
    propBlurStrength: 0.35,
    propAxisTilt: { x: 0, y: 0 },
    propPivotOffset: { x: 0, y: 0, z: 0 },
    muzzleOffsets: [
      new THREE.Vector3( 12.05, -0.30, -6.80),
      new THREE.Vector3(  9.20, -0.60, -7.00),
      new THREE.Vector3(  8.40, -0.70, -7.05),
      new THREE.Vector3(  6.50, -0.90, -7.05),
      new THREE.Vector3(-6.35, -0.95, -6.85),
      new THREE.Vector3(-8.30, -0.75, -6.70),
      new THREE.Vector3(-9.05, -0.70, -6.65),
      new THREE.Vector3(-11.85, -0.30, -6.30),
    ],
  },
  // Yakovlev Yak-7（1942 苏联战斗机）
  '/model/yak7.glb': {
    autoOrient: true,
    userScale: 3.63,
  },
  // Yakovlev Yak-9（1942 苏联战斗机）
  '/model/yak9.glb': {
    autoOrient: false,
    yawOffset: -139,
    pitchOffset: 0,
    rollOffset: 0,
    userScale: 3.52,
    muzzleOffsets: [
      new THREE.Vector3( 6.50, -1.35, -4.15),
      new THREE.Vector3(-6.50, -1.35, -4.15),
      new THREE.Vector3( 0.50,  1.00, -7.80),
      new THREE.Vector3(-0.50,  1.00, -7.80),
    ],
  },
};

/**
 * 敌机性能参数（飞行：速度(速度/机动/HP 等）。
 * 按 model URL 索引，结构对齐 enemy.js MODEL_SPECS（仅保留本模式所需机型）。
 * maxHp 为基础值，实际生效值由 FreeModeRuntime 按"原模式一半"规则覆盖。
 */
export const FREE_ENEMY_MODEL_SPECS = {
  '/model/i16.glb': {
    maxSpeed: 130, cruiseSpeed: 90, maxHp: 90,
    pitchMax: 1.25, pitchResp: 5.0,
    rollMax: 2.3, rollResp: 6.0,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 9, liftK: 0.028,
  },
  '/model/spitfire.glb': {
    maxSpeed: 168, cruiseSpeed: 105, maxHp: 110,
    pitchMax: 1.4, pitchResp: 5.8,
    rollMax: 2.5, rollResp: 6.0,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 11,
  },
  '/model/yak7.glb': {
    maxSpeed: 174, cruiseSpeed: 110, maxHp: 100,
    pitchMax: 1.45, pitchResp: 5.5,
    rollMax: 2.4, rollResp: 5.5,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 11,
  },
  '/model/yak9.glb': {
    maxSpeed: 174, cruiseSpeed: 110, maxHp: 100,
    pitchMax: 1.45, pitchResp: 5.5,
    rollMax: 2.4, rollResp: 5.5,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 11,
  },
};

/**
 * 敌机可选机型元数据（供机库页 UI 展示）。
 * id 为 model URL 的简短标识。
 */
export const ENEMY_AIRCRAFT = [
  { id: 'i16',      name: 'I-16',       subtitle: '小毛驴',     nation: '苏', model: '/model/i16.glb' },
  { id: 'spitfire', name: 'Spitfire',   subtitle: '喷火 Mk.II',  nation: '英', model: '/model/spitfire.glb' },
  { id: 'yak7',     name: 'Yak-7',      subtitle: '雅克',       nation: '苏', model: '/model/yak7.glb' },
  { id: 'yak9',     name: 'Yak-9',      subtitle: '雅克',       nation: '苏', model: '/model/yak9.glb' },
];

/** 按 model URL 查敌机校准参数 */
export function getEnemyModelConfig(modelUrl) {
  return FREE_ENEMY_MODEL_CONFIGS[modelUrl] || null;
}

/** 按 model URL 查敌机性能参数 */
export function getEnemyModelSpecs(modelUrl) {
  return FREE_ENEMY_MODEL_SPECS[modelUrl] || null;
}

/** 按 id 查敌机元数据 */
export function getEnemyAircraft(id) {
  return ENEMY_AIRCRAFT.find((a) => a.id === id);
}