import { BasePage } from './_base.js';

/**
 * 主菜单：战役模式 / 自由模式 / 设置 / 机库[锁]。
 * 自由模式已开放，机库暂不开放。
 * 背景图复用封面图（mb1/mb2 随机切换）。
 */
const MENU_BG = ['/img/mb1.webp', '/img/mb2.webp'];
export class MenuPage extends BasePage {
  get name() { return 'menu'; }

  _build() {
    return `
      <div class="menu-list">
        <div class="menu-item" data-action="campaign">
          <span class="mi-label"><span class="mi-icon">⚑</span>战役模式</span>
        </div>
        <div class="menu-item" data-action="free">
          <span class="mi-label"><span class="mi-icon">✈</span>自由模式</span>
        </div>
        <div class="menu-item" data-action="settings">
          <span class="mi-label"><span class="mi-icon">⚙</span>设置</span>
        </div>
        <div class="menu-item locked" data-action="hangar">
          <span class="mi-label"><span class="mi-icon">☰</span>机库</span>
          <span class="mi-lock">尚未开放</span>
        </div>
      </div>
      <div class="page-footer">
        <button class="bronze-button" data-action="back">返回封面</button>
      </div>
    `;
  }

  _onMount() {
    // 随机选择菜单背景图
    const bg = MENU_BG[Math.floor(Math.random() * MENU_BG.length)];
    const bgEl = this.el.querySelector('.page-bg');
    if (bgEl) {
      bgEl.classList.add('with-image');
      bgEl.style.backgroundImage = `url('${bg}')`;
    }

    this._onClick('[data-action="campaign"]', () => this.router.go('level-select'));
    this._onClick('[data-action="settings"]', () => this.router.go('settings'));
    this._onClick('[data-action="hangar"]', () => this._toast('机库尚未开放'));
    this._onClick('[data-action="free"]', () => this.router.go('free-map-select'));
    this._onClick('[data-action="back"]', () => this.router.back());
  }

  _toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:60%;left:50%;transform:translateX(-50%);padding:10px 24px;background:rgba(12,16,20,0.95);border:1px solid var(--accent-amber);color:var(--accent-amber);border-radius:4px;font-size:13px;letter-spacing:2px;z-index:300;animation:dialogIn .3s;';
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 1500);
    setTimeout(() => t.remove(), 2000);
  }
}
