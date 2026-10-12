/**
 * DialogSystem：右上角无线电对话系统（雷达下方 #dialog-system）。
 *
 * 最多同时显示 3 条对话，每条带头像+说话人+文本，定时自动淡出。
 * 由 GameRuntime 在游戏事件（波次开始/击落/阵亡等）时调用 show() 触发。
 *
 * 样式见 Theme.js（.dialog-item / .dialog-avatar / .dialog-speaker / .dialog-text）。
 */
const AVATARS = {
  // 指挥官：头像图（commder.webp）
  commander: '<img src="/img/gem/commder.webp" alt="指挥官" class="avatar-img">',
  // 僚机/通讯兵：头像图（liao.webp）
  radio: '<img src="/img/gem/liao.webp" alt="通讯兵" class="avatar-img">',
  // 机械师：扳手图标（暂无头像图，用 SVG 占位）
  mechanic: '<svg viewBox="0 0 24 24" fill="rgba(255,184,77,0.85)"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1 .1-1.4z"/></svg>',
  // 玩家（长机 Falke-1）：飞行员头像（gp2.webp）
  player: '<img src="/img/gem/gp2.webp" alt="玩家" class="avatar-img">',
  // 僚机飞行员（Falke-2 等）：飞行员头像（gp1.webp）
  wingman: '<img src="/img/gem/gp1.webp" alt="僚机" class="avatar-img">',
  // 塔台/基地通讯兵：头像图（hh1.webp）
  tower: '<img src="/img/gem/hh1.webp" alt="塔台" class="avatar-img">',
  // 柏林关卡专属（第4关，仅 BerlinChatter / opening.dialogs 使用，其他关零影响）
  berlin_tower1: '<img src="/img/gem/bl/tw001.webp" alt="塔台" class="avatar-img">',
  berlin_tower2: '<img src="/img/gem/bl/tw02.webp" alt="塔台" class="avatar-img">',
  berlin_1: '<img src="/img/gem/bl/bl02.webp" alt="雨燕1号" class="avatar-img">',
  berlin_2: '<img src="/img/gem/bl/bl01.webp" alt="雨燕2号" class="avatar-img">',
  berlin_3: '<img src="/img/gem/bl/bl03.webp" alt="雨燕3号" class="avatar-img">',
  berlin_4: '<img src="/img/gem/bl/bl05.webp" alt="雨燕4号" class="avatar-img">',
};

/** 解析头像：berlin_tower 随机选 tw001/tw02；其他按 key 查（缺省 commander） */
function _resolveAvatar(type) {
  if (type === 'berlin_tower') return AVATARS[Math.random() < 0.5 ? 'berlin_tower1' : 'berlin_tower2'];
  return AVATARS[type] || AVATARS.commander;
}

export class DialogSystem {
  /**
   * @param {HTMLElement} container #dialog-system 容器
   * @param {object} [audio] GameAudio 实例（用于无线电提示音，可选）
   */
  constructor(container, audio) {
    this.container = container;
    this.audio = audio || null;
    this._items = []; // { el, timer(ms) }
    this._maxVisible = 3;
  }

  /**
   * 显示一条对话。
   * @param {string} speaker 说话人
   * @param {string} text 对话内容
   * @param {number} [duration=7000] 持续时间(ms)
   * @param {string} [avatarType='commander'] 头像类型
   * @param {string} [role] 职位标注（如"僚机""轰炸机一队长"），可选
   */
  show(speaker, text, duration = 7000, avatarType = 'commander', role) {
    if (!this.container) return;

    // 无线电提示音（每条对话出现时播放）
    if (this.audio && typeof this.audio.radioBeep === 'function') {
      this.audio.radioBeep();
    }

    const el = document.createElement('div');
    el.className = 'dialog-item';
    const roleHtml = role ? `<span class="dialog-role">${role}</span>` : '';
    el.innerHTML = `
      <div class="dialog-avatar">${_resolveAvatar(avatarType)}</div>
      <div class="dialog-body">
        <div class="dialog-speaker">${speaker}${roleHtml}</div>
        <div class="dialog-text">${text}</div>
      </div>
    `;
    this.container.appendChild(el);

    const item = { el, timer: duration };
    this._items.push(item);

    // 超出最大显示数时移除最旧的
    while (this._items.length > this._maxVisible) {
      this._removeOldest();
    }
  }

  /** 每帧推进定时器（dt 单位秒） */
  update(dt) {
    if (this._items.length === 0) return;
    const dtMs = dt * 1000;
    for (let i = this._items.length - 1; i >= 0; i--) {
      this._items[i].timer -= dtMs;
      if (this._items[i].timer <= 0) {
        this._removeItem(this._items[i]);
      }
    }
  }

  _removeOldest() {
    if (this._items.length === 0) return;
    this._removeItem(this._items[0]);
  }

  _removeItem(item) {
    const idx = this._items.indexOf(item);
    if (idx >= 0) this._items.splice(idx, 1);
    item.el.classList.add('leaving');
    setTimeout(() => { if (item.el.parentNode) item.el.remove(); }, 300);
  }

  clear() {
    for (const item of this._items) {
      if (item.el.parentNode) item.el.remove();
    }
    this._items = [];
  }

  dispose() {
    this.clear();
    this.container = null;
  }
}
