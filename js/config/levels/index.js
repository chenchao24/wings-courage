import britain from './level_01_britain.js';
import barbarossa from './level_02_barbarossa.js';
import kursk from './level_03_kursk.js';
import berlin from './level_04_berlin.js';

/**
 * 关卡注册中心：9 关元数据。
 * 前 6 关有正式名称 + 卡片图：
 *   1《风云不列颠》2《巴巴罗萨之鹰》3《鏖战库尔斯克》4《柏林保卫战》
 *   5《血战中途岛》6《马里亚纳猎杀火鸡日》
 * 后 3 关为"尚未开放"占位。
 *
 * 当前开放第 1~4 关（第 4 关《柏林保卫战》为 P1 地图骨架阶段，Me 262 玩家飞机）。
 * 全部完成后可解锁后续关卡（解锁逻辑待 P8 完善，先写框架）。
 */

// 占位关卡模板（未开放）
function placeholder(id, index, name) {
  return { id, index, name, subtitle: 'Coming Soon', locked: true };
}

export const LEVELS = [
  britain,   // index 1 · 已开放
  barbarossa, // index 2 · 已开放
  kursk,      // index 3 · 已开放（Fw 190 A-4 玩家飞机）
  berlin,     // index 4 · 本次开放（Me 262 玩家飞机，P1 地图骨架阶段）
  { id: 'midway',     index: 5, name: '血战中途岛',     subtitle: 'Battle of Midway',         locked: true, cardImage: '/img/stg5.webp', difficulty: 4 },
  { id: 'mariana',    index: 6, name: '马里亚纳猎杀火鸡日', subtitle: 'Mariana Turkey Shoot', locked: true, cardImage: '/img/stg6.webp', difficulty: 2 },
  placeholder('locked7', 7, '尚未开放'),
  placeholder('locked8', 8, '尚未开放'),
  placeholder('locked9', 9, '尚未开放'),
];

// 当前已解锁的关卡 id 集合（第 1/2/3/4 关开放）
const UNLOCKED_IDS = new Set(['britain', 'barbarossa', 'kursk', 'berlin']);

export function isUnlocked(id) {
  return UNLOCKED_IDS.has(id);
}

export function getLevel(id) {
  return LEVELS.find((l) => l.id === id);
}

/** 标记关卡为已解锁（通关后调用，持久化到 localStorage） */
const PROGRESS_KEY = 'couragewings_progress_v1';
export function unlock(id) {
  UNLOCKED_IDS.add(id);
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!arr.includes(id)) arr.push(id);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(arr));
  } catch (e) { /* ignore */ }
}

// 启动时从 localStorage 恢复解锁状态
try {
  const raw = localStorage.getItem(PROGRESS_KEY);
  if (raw) JSON.parse(raw).forEach((id) => UNLOCKED_IDS.add(id));
} catch (e) { /* ignore */ }
