/**
 * 自由模式 · 难度配置（与战役模式完全隔离）。
 *
 * 难度影响：
 *   - enemyHpMul:  敌机 HP 基础值乘数（叠加在"原模式一半"规则之上）
 *   - enemyAgilityMul: 敌机机动性乘数（pitch/roll/yaw 响应）
 *   - enemyFireRateMul: 敌机开火频率乘数（越小越快）
 *   - enemyDamageMul: 敌机单发伤害乘数
 *   - playerHpMul: 玩家 HP 乘数（默认 100）
 *
 * 本次迭代先搭框架，难度参数后续细调。
 */
export const FREE_DIFFICULTIES = [
  {
    id: 'easy',
    name: '新兵',
    subtitle: 'EASY',
    enemyHpMul: 0.8,
    enemyAgilityMul: 0.8,
    enemyFireRateMul: 1.3,
    enemyDamageMul: 0.7,
    playerHpMul: 1.2,
  },
  {
    id: 'normal',
    name: '老兵',
    subtitle: 'NORMAL',
    enemyHpMul: 1.0,
    enemyAgilityMul: 1.0,
    enemyFireRateMul: 1.0,
    enemyDamageMul: 1.0,
    playerHpMul: 1.0,
  },
  {
    id: 'hard',
    name: '王牌',
    subtitle: 'HARD',
    enemyHpMul: 1.2,
    enemyAgilityMul: 1.15,
    enemyFireRateMul: 0.8,
    enemyDamageMul: 1.3,
    playerHpMul: 0.9,
  },
];

/** 按 id 查难度配置 */
export function getFreeDifficulty(id) {
  return FREE_DIFFICULTIES.find((d) => d.id === id);
}

/**
 * 时间限制选项（分钟）。
 * 0 表示无限制（自由练习）。
 */
export const FREE_TIME_LIMITS = [
  { id: '0',  label: '无限制', minutes: 0 },
  { id: '5',  label: '5 分钟', minutes: 5 },
  { id: '10', label: '10 分钟', minutes: 10 },
  { id: '15', label: '15 分钟', minutes: 15 },
  { id: '20', label: '20 分钟', minutes: 20 },
];

/** 按 id 查时间限制 */
export function getFreeTimeLimit(id) {
  return FREE_TIME_LIMITS.find((t) => t.id === id);
}