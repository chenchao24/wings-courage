/**
 * Tutorial：4 步教学提示框。
 *
 * 游戏开始时全屏覆盖，引导玩家学习飞行/油门/武器/视角操作。
 * 关闭后调用 onClose → GameRuntime 调 waveDirector.skipStartDelay(delay) 开始首波。
 *
 * 样式见 Theme.js（#tutorial-overlay / .tutorial-box / .tutorial-title 等）。
 */
export class Tutorial {
  /**
   * @param {HTMLElement} mount 挂载点（document.body）
   * @param {Array<{title:string, body:string}>} steps 教学步骤
   * @param {Function} onClose 全部完成/跳过时回调
   */
  constructor(mount, steps, onClose) {
    this.mount = mount;
    this.steps = steps || [];
    this.onClose = onClose;
    this._step = 0;
    this._overlay = null;
    this._disposed = false;
  }

  start() {
    if (this.steps.length === 0) {
      if (this.onClose) this.onClose();
      return;
    }
    this._showStep(0);
  }

  _showStep(idx) {
    if (this._disposed) return;
    this._step = idx;
    const step = this.steps[idx];
    if (!step) { this._close(); return; }

    if (this._overlay) this._overlay.remove();

    const ov = document.createElement('div');
    ov.id = 'tutorial-overlay';
    ov.innerHTML = `
      <div class="tutorial-box bronze-frame">
        <div class="tutorial-step">步骤 ${idx + 1} / ${this.steps.length}</div>
        <div class="tutorial-title">${step.title}</div>
        <div class="tutorial-body">${step.body}</div>
        <div class="tutorial-actions" style="display:flex;gap:12px;justify-content:center;">
          ${idx > 0 ? '<button class="bronze-button" data-action="prev">上一步</button>' : ''}
          ${idx < this.steps.length - 1
            ? '<button class="bronze-button primary" data-action="next">下一步</button>'
            : '<button class="bronze-button primary" data-action="close">开始任务</button>'}
          <button class="bronze-button" data-action="skip">跳过教学</button>
        </div>
      </div>
    `;
    this.mount.appendChild(ov);
    this._overlay = ov;

    const prev = ov.querySelector('[data-action="prev"]');
    if (prev) prev.addEventListener('click', () => this._showStep(idx - 1));
    const next = ov.querySelector('[data-action="next"]');
    if (next) next.addEventListener('click', () => this._showStep(idx + 1));
    const close = ov.querySelector('[data-action="close"]');
    if (close) close.addEventListener('click', () => this._close());
    const skip = ov.querySelector('[data-action="skip"]');
    if (skip) skip.addEventListener('click', () => this._close());
  }

  _close() {
    if (this._disposed) return;
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
    if (this.onClose) {
      const cb = this.onClose;
      this.onClose = null; // 防止重复调用
      cb();
    }
  }

  dispose() {
    this._disposed = true;
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
    this.onClose = null;
  }
}
