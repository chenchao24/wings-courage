/**
 * Page 基类：提供通用的 DOM 创建、事件绑定与卸载逻辑。
 * 子类需实现 _build(params) 返回 HTML 字符串，_onMount(params) 绑定事件。
 */
export class BasePage {
  constructor(shell) {
    this.shell = shell;
    this.router = shell.router;
    this.el = null;
    this._handlers = []; // [{target, type, fn}]
  }

  mount(root, params = {}) {
    this.el = document.createElement('div');
    this.el.className = 'page page-' + this.name;
    this.el.innerHTML = `<div class="page-bg"></div>` + this._build(params);
    root.appendChild(this.el);
    this._onMount(params);
  }

  unmount() {
    // 子类清理（停止预览、恢复状态等）
    this._onUnmount();
    // 移除所有事件监听
    for (const { target, type, fn } of this._handlers) {
      target.removeEventListener(type, fn);
    }
    this._handlers = [];
    if (this.el) this.el.remove();
    this.el = null;
  }

  /** 子类覆盖：返回页面主体 HTML（不含 .page-bg） */
  _build(_params) { return ''; }

  /** 子类覆盖：绑定事件（用 this._on / this._onClick） */
  _onMount(_params) {}

  /** 子类覆盖：卸载时清理（停止预览、恢复状态等） */
  _onUnmount() {}

  /** 便捷事件绑定（自动记录便于 unmount 清理） */
  _on(target, type, fn) {
    target.addEventListener(type, fn);
    this._handlers.push({ target, type, fn });
  }

  _onClick(selector, fn) {
    const el = this.el.querySelector(selector);
    if (el) this._on(el, 'click', fn);
  }

  /** 便捷选择器 */
  $(selector) { return this.el.querySelector(selector); }
  $$(selector) { return this.el.querySelectorAll(selector); }
}
