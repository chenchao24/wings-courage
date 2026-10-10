/**
 * LoadingOverlay：进出关卡时的全屏加载遮罩。
 *
 * 复用 Theme.js 里 #loader 的样式（.title / .sub / .bar > i / .pct），
 * 挡住 GameRuntime 加载飞机模型、相机首帧摆位、关卡释放等过程中
 * 底层 #scene 3D 画面的裸露。
 *
 * z-index 220：高于 #app(100) / #hud(10)，低于结算层(250)，
 * 并避开暂停层(200)同级冲突。
 *
 * 进度策略：模型 await load 期间无精确百分比，用分阶段估算 +
 * 时间动画兜底（每帧逼近目标值），onReady 时跳 100% 再 hide。
 */
export class LoadingOverlay {
  constructor() {
    this.el = null;
    this._bar = null;
    this._pct = null;
    this._title = null;
    this._sub = null;
    this._rafId = 0;
    this._target = 0;        // 目标进度
    this._current = 0;       // 当前显示进度
    this._hideTimer = 0;     // hide 延时移除定时器
    this._timeoutTimer = 0;  // 兜底超时定时器
  }

  _ensure() {
    if (this.el) return;
    const el = document.createElement('div');
    el.id = 'loader';
    el.style.zIndex = '220'; // 覆盖 #loader 默认 200，避开暂停层同级
    el.innerHTML = `
      <div class="title"></div>
      <div class="sub"></div>
      <div class="bar"><i></i></div>
      <div class="pct">0%</div>
    `;
    document.body.appendChild(el);
    this.el = el;
    this._title = el.querySelector('.title');
    this._sub = el.querySelector('.sub');
    this._bar = el.querySelector('.bar > i');
    this._pct = el.querySelector('.pct');
  }

  /**
   * 显示加载遮罩。
   * @param {string} title 标题（如「加载任务中」）
   * @param {string} sub 副标题（如关卡名）
   * @param {number} [timeoutMs=8000] 兜底超时，超时后强制 hide 并 onTimeout
   * @param {() => void} [onTimeout] 超时回调
   */
  show(title, sub, timeoutMs = 8000, onTimeout) {
    this._ensure();
    this.el.classList.remove('hide');
    this._title.textContent = title || '';
    this._sub.textContent = sub || '';
    this._target = 0;
    this._current = 0;
    this._render(0);
    this._startAnim();
    // 兜底超时：避免 onReady 久未触发卡死
    this._clearTimeout();
    this._timeoutTimer = setTimeout(() => {
      if (this.el && !this.el.classList.contains('hide')) {

        this.setProgress(100);
        this.hide();
        if (onTimeout) onTimeout();
      }
    }, timeoutMs);
  }

  /** 设置目标进度（0-100），动画会平滑逼近 */
  setProgress(pct) {
    this._target = Math.max(0, Math.min(100, pct));
  }

  /** 隐藏遮罩（走 .hide 的 opacity 过渡，结束后 remove DOM）*/
  hide() {
    this._clearTimeout();
    this._stopAnim();
    if (!this.el) return;
    this.el.classList.add('hide');
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      if (this.el) this.el.remove();
      this.el = null;
      this._bar = null;
      this._pct = null;
      this._title = null;
      this._sub = null;
    }, 600); // Theme.js #loader transition .6s
  }

  _startAnim() {
    this._stopAnim();
    const tick = () => {
      // 平滑逼近目标值（每帧追近 1/8 差距，约 8 帧到位）
      const diff = this._target - this._current;
      if (Math.abs(diff) < 0.3) {
        this._current = this._target;
      } else {
        this._current += diff * 0.15;
      }
      this._render(this._current);
      if (this._current < 100 || this._target < 100) {
        this._rafId = requestAnimationFrame(tick);
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopAnim() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
  }

  _clearTimeout() {
    if (this._timeoutTimer) clearTimeout(this._timeoutTimer);
    this._timeoutTimer = 0;
  }

  _render(pct) {
    const p = Math.round(pct);
    if (this._bar) this._bar.style.width = p + '%';
    if (this._pct) this._pct.textContent = p + '%';
  }
}
