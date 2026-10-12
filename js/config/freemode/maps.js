/**
 * 自由模式 · 地图列表（与战役模式完全隔离）。
 *
 * 6 个选项：第 1 个巴巴罗萨（开放），其余 5 个待开放占位。
 * 地图实际配置（环境/出生点等）在 js/freemode/FreeModeMaps.js 独立维护，
 * 本文件仅提供元数据供地图选择页 UI 展示。
 */
export const FREE_MAPS = [
  {
    id: 'barbarossa',
    name: '巴巴罗萨',
    subtitle: '东线平原 · 1941',
    locked: false,
    cardImage: '/img/stg2.webp',
    desc: '东线夏季晴天，广阔平原与稀疏村庄',
  },
  { id: 'locked2', name: '不列颠海峡', subtitle: 'Coming Soon', locked: true, desc: '英吉利海峡多云天气' },
  { id: 'locked3', name: '库尔斯克',   subtitle: 'Coming Soon', locked: true, desc: '突出部坦克会战战场' },
  { id: 'locked4', name: '柏林',       subtitle: 'Coming Soon', locked: true, desc: '帝国首都防空' },
  { id: 'locked5', name: '中途岛',     subtitle: 'Coming Soon', locked: true, desc: '太平洋海战' },
  { id: 'locked6', name: '北非',       subtitle: 'Coming Soon', locked: true, desc: '沙漠上空缠斗' },
];

/** 按 id 查地图元数据 */
export function getFreeMap(id) {
  return FREE_MAPS.find((m) => m.id === id);
}