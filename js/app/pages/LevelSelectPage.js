import { BasePage } from './_base.js';
import { LEVELS, isUnlocked } from '../../config/levels/index.js';
import { ICONS } from '../ui/icons.js';

/**
 * 战役选关页：9 关 3×3 卡片。
 * 本次仅开放《巴巴罗萨之鹰》（第 2 关），其余显示"尚未开放"。
 * 点击 unlocked 卡片 → 简报页 → 进入关卡（P2 接入 GameRuntime）。
 */
export class LevelSelectPage extends BasePage {
  get name() { return 'level-select'; }

  _build() {
    const cards = LEVELS.map((lv) => {
      const unlocked = isUnlocked(lv.id);
      const status = unlocked ? '点击进入' : '尚未开放';
      const waveCount = lv.displayWaves != null ? lv.displayWaves : (lv.waves?.length || 0);
      const meta = unlocked ? `${lv.totalEnemies || 0} 架 · ${waveCount} 波` : '';
      const lockIcon = unlocked ? '' : `<span class="card-lock-icon">${ICONS.lock}</span>`;
      const banner = lv.cardImage
        ? `<div class="card-banner" style="background-image:url('${lv.cardImage}')"></div>`
        : '';
      // 难度星标（显示对应颗数）
      const diff = lv.difficulty || 0;
      const stars = diff > 0
        ? `<span class="card-diff">${'★'.repeat(diff)}</span>`
        : '';
      // 新手关徽章
      const beginnerTag = lv.beginner ? '<span class="card-beginner">新手</span>' : '';
      return `
        <div class="level-card ${unlocked ? 'unlocked' : 'locked'}" data-id="${lv.id}" data-unlocked="${unlocked}">
          ${lockIcon}
          ${banner}
          <div class="card-body">
            <div class="card-num">${String(lv.index).padStart(2, '0')}${beginnerTag}</div>
            <div class="card-name">${lv.name}</div>
            ${stars}
            <div class="card-meta">${meta}</div>
          </div>
          <div class="card-status">${status}</div>
        </div>
      `;
    }).join('');

    return `
      <button class="bronze-button page-back-btn" data-action="back">返回菜单</button>
      <div class="page-header">
        <div class="page-title">战役模式</div>
        <div class="page-sub">CAMPAIGN · 东线战场 1941-1945</div>
      </div>
      <div class="level-grid">${cards}</div>
    `;
  }

  _onMount() {
    this.$$('.level-card').forEach((card) => {
      this._on(card, 'click', () => {
        const id = card.dataset.id;
        const unlocked = card.dataset.unlocked === 'true';
        if (!unlocked) {
          this._toast('该关卡尚未开放');
          return;
        }
        // 进入简报页（P2 阶段 BriefingPage 会调用 GameRuntime.start）
        this.router.go('briefing', { levelId: id });
      });
    });
    this._onClick('[data-action="back"]', () => this.router.go('menu'));
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
