/**
 * SVG 图标占位（头像 / 锁 / 菜单图标等）。
 * 资源到位后可替换为 <img src="/img/...">，函数签名保持不变。
 */

// 角色头像剪影（二战风格占位）
export const AVATARS = {
  cmdr: `<svg viewBox="0 0 24 24" fill="none" stroke="#d4a85a" stroke-width="1.5">
    <path d="M6 8c0-3 2.5-5 6-5s6 2 6 5v2H6V8z" fill="#3a3024"/>
    <circle cx="12" cy="13" r="4" fill="#d4a85a"/>
    <path d="M4 21c0-4 3.5-7 8-7s8 3 8 7" fill="#3a3024"/>
    <path d="M9 7l3-2 3 2" stroke="#d4a85a" stroke-width="1"/>
  </svg>`,
  wingman: `<svg viewBox="0 0 24 24" fill="none" stroke="#d4a85a" stroke-width="1.5">
    <path d="M7 9c0-2.5 2-4 5-4s5 1.5 5 4v1H7V9z" fill="#3a3024"/>
    <circle cx="12" cy="13" r="3.5" fill="#d4a85a"/>
    <path d="M5 21c0-3.5 3-6 7-6s7 2.5 7 6" fill="#3a3024"/>
    <circle cx="12" cy="6" r="2" fill="none"/>
  </svg>`,
  ground: `<svg viewBox="0 0 24 24" fill="none" stroke="#d4a85a" stroke-width="1.5">
    <rect x="6" y="5" width="12" height="4" rx="1" fill="#3a3024"/>
    <circle cx="12" cy="13" r="3.5" fill="#d4a85a"/>
    <path d="M5 21c0-3.5 3-6 7-6s7 2.5 7 6" fill="#3a3024"/>
  </svg>`,
  player: `<svg viewBox="0 0 24 24" fill="none" stroke="#d4a85a" stroke-width="1.5">
    <circle cx="12" cy="8" r="4" fill="#d4a85a"/>
    <path d="M4 21c0-4.5 3.5-8 8-8s8 3.5 8 8" fill="#3a3024"/>
    <path d="M8 6l4-2 4 2" stroke="#d4a85a"/>
  </svg>`,
};

/** 获取头像 SVG 字符串（未知 key 退化为 player） */
export function getAvatar(key) {
  return AVATARS[key] || AVATARS.player;
}

/** 通用小图标 */
export const ICONS = {
  lock: '🔒',
  menu: '☰',
  back: '◀',
  gear: '⚙',
  flag: '⚑',
  star: '★',
};
