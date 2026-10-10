import { BasePage } from './_base.js';
import { FREE_MAPS } from '../../config/freemode/maps.js';
import { ICONS } from '../ui/icons.js';

/**
 * 自由模式 · 地图选择页：6 张地图卡片（3×2）。
 * 当前仅开放"巴巴罗萨"，其余 5 张显示"尚未开放"。
 * 点击开放卡片 → 机库页（free-hangar）配置对手后进入游戏。
 *
 * 与战役选关页 UI 模式一致，但数据来自 js/config/freemode/maps.js（隔离）。
 */
export class FreeMapSelectPage extends BasePage {
  get name() { return 'free-map-select'; }

  _build() {
    const cards = FREE_MAPS.map((m, idx) => {
      const unlocked = !m.locked;
      const status = unlocked ? '点击进入' : '尚未开放';
      const meta = unlocked ? (m.subtitle || '') : 'Coming Soon';
      const lockIcon = unlocked ? '' : `<span class="card-lock-icon">${ICONS.lock}</span>`;
      const banner = m.cardImage
        ? `<div class="card-banner" style="background-image:url('${m.cardImage}')"></div>`
        : '';
      return `
        <div class="level-card ${unlocked ? 'unlocked' : 'locked'}" data-id="${m.id}" data-unlocked="${unlocked}">
          ${lockIcon}
          ${banner}
          <div class="card-body">
            <div class="card-num">${String(idx + 1).padStart(2, '0')}</div>
            <div class="card-name">${m.name}</div>
            <div class="card-meta">${meta}</div>
          </div>
          <div class="card-status">${status}</div>
        </div>
      `;
    }).join('');

    return `
      <button class="bronze-button page-back-btn" data-action="back">返回菜单</button>
      <div class="page-header">
        <div class="page-title">自由模式</div>
        <div class="page-sub">FREE FLIGHT · 选择战场</div>
      </div>
      <div class="level-grid free-map-grid">${cards}</div>
    `;
  }

  _onMount() {
    this.$$('.level-card').forEach((card) => {
      this._on(card, 'click', () => {
        const id = card.dataset.id;
        const unlocked = card.dataset.unlocked === 'true';
        if (!unlocked) {
          this._toast('该地图尚未开放');
          return;
        }
        this.router.go('free-hangar', { mapId: id });
      });
    });
    this._onClick('[data-action="back"]', () => this.router.back());
  }

  _toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:60%;left:50%;transform:translateX(-50%);padding:10px 24px;background:rgba(12,16,20,0.95);border:1px solid var(--accent-amber);color:var(--accent-amber);border-radius:4px;font-size:13px;letter-spacing:2px;z-index:300;';
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 1500);
    setTimeout(() => t.remove(), 2000);
  }
}