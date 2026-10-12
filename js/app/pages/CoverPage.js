import { BasePage } from './_base.js';

/**
 * 封面页：背景图（mb1/mb2 随机切换）。
 * 任意键或鼠标点击屏幕进入主菜单（无按钮）。
 * 右下角显示当前版本号。
 * 背景图已含游戏名称，不再重复显示标题。
 */
const COVER_BG = ['/img/mb1.webp', '/img/mb2.webp'];
const APP_VERSION = '0.72.8.20';

export class CoverPage extends BasePage {
  get name() { return 'cover'; }

  _build() {
    return `
      <div class="cover-hint">按任意键开始</div>
      <div class="cover-version">v${APP_VERSION}</div>
    `;
  }

  _onMount() {
    // 随机选择封面背景图
    const bg = COVER_BG[Math.floor(Math.random() * COVER_BG.length)];
    const bgEl = this.el.querySelector('.page-bg');
    if (bgEl) {
      bgEl.classList.add('with-image');
      bgEl.style.backgroundImage = `url('${bg}')`;
    }

    // 进入主菜单的统一入口（去重：只触发一次）
    let entered = false;
    const enter = () => {
      if (entered) return;
      entered = true;
      this.shell.ensureAudio();
      this.router.go('menu');
    };

    // 任意键进入
    this._on(window, 'keydown', enter);
    // 鼠标点击屏幕进入（含 .page-bg 与页面任意元素）
    this._on(this.el, 'click', enter);
    // 兜底：监听整个 document 点击（封面铺满全屏，el 即可覆盖，此处冗余保险）
    this._on(document, 'pointerdown', (e) => {
      // 仅在封面仍挂载时响应（避免卸载后误触发）
      if (!this.el || !this.el.isConnected) return;
      enter();
    });
  }
}
