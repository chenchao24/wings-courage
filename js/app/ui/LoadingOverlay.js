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
 *
 * 看门狗两种模式（show 第 3 参区分，向后兼容）：
 *   数字 timeoutMs（旧行为）：超时强制 setProgress(100)+hide 并回调 onTimeout；
 *   选项对象（慢网友好）：slowMs 超时仅提示「网络较慢，仍在加载…（已等待 Xs）」继续等，
 *   hardMs 硬上限进失败态（标题「加载超时」+ 刷新按钮，回调 onHardTimeout），不强制进入。
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
    this._timeoutTimer = 0;  // 兜底超时定时器（旧数字模式）
    this._slowTimer = 0;     // 慢网提示定时器（选项模式）
    this._slowTicker = 0;    // 「已等待 Xs」每秒刷新
    this._hardTimer = 0;     // 硬上限定时器（选项模式）
    this._shownAt = 0;       // show 时刻（已等待秒数基准）
    this._onHardTimeout = null;
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
   * @param {number|object} [timeoutMs=8000] 数字=旧行为兜底超时；选项对象=慢网友好模式
   *   { slowMs=8000, hardMs=60000, onHardTimeout }（slowMs/hardMs 任一 ≤0 关闭对应看门狗）
   * @param {() => void} [onTimeout] 旧行为超时回调（仅第 3 参为数字时生效）
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
    this._clearWatchdogs();
    this._resetFailedUi();
    if (timeoutMs && typeof timeoutMs === 'object') {
      // 慢网友好模式：超时不强制进入，硬上限才进失败态
      const { slowMs = 8000, hardMs = 60000, onHardTimeout } = timeoutMs;
      this._shownAt = Date.now();
      this._onHardTimeout = typeof onHardTimeout === 'function' ? onHardTimeout : null;
      if (slowMs > 0) this._slowTimer = setTimeout(() => this._enterSlowWait(), slowMs);
      if (hardMs > 0) this._hardTimer = setTimeout(() => this._enterHardFail(), hardMs);
      return;
    }
    // 旧行为：兜底超时，超时后强制 hide 并 onTimeout（避免 onReady 久未触发卡死）
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
    this._clearWatchdogs();
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

  /** 慢网等待态：不强制进入，副标题改等待提示并每秒刷新已等待秒数 */
  _enterSlowWait() {
    this._slowTimer = 0;
    if (!this.el || this.el.classList.contains('hide')) return;
    const tick = () => {
      if (!this._sub) return;
      const sec = Math.max(1, Math.round((Date.now() - this._shownAt) / 1000));
      this._sub.textContent = `网络较慢，仍在加载…（已等待 ${sec}s）`;
    };
    tick();
    this._slowTicker = setInterval(tick, 1000);
  }

  /** 硬上限失败态：冻结进度条，显示超时文案 + 刷新按钮（不强制中止后台加载流程） */
  _enterHardFail() {
    this._hardTimer = 0;
    if (!this.el || this.el.classList.contains('hide')) return;
    if (this._slowTicker) { clearInterval(this._slowTicker); this._slowTicker = 0; }
    this._stopAnim();
    this.el.classList.add('failed');
    if (this._title) this._title.textContent = '加载超时';
    if (this._sub) this._sub.textContent = '请检查网络后刷新重试';
    if (!this.el.querySelector('.loader-retry')) {
      const btn = document.createElement('button');
      btn.className = 'bronze-button primary loader-retry';
      btn.textContent = '刷新页面';
      btn.style.marginTop = '28px';
      btn.addEventListener('click', () => location.reload());
      this.el.appendChild(btn);
    }
    const cb = this._onHardTimeout;
    this._onHardTimeout = null;
    if (cb) cb();
  }

  /** 复位失败态 UI（hide 过渡窗口内复用存活 el 时，清掉上轮残留的失败样式/按钮） */
  _resetFailedUi() {
    if (!this.el) return;
    this.el.classList.remove('failed');
    const btn = this.el.querySelector('.loader-retry');
    if (btn) btn.remove();
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

  /** 清全部看门狗（旧超时 + 慢网提示/秒表 + 硬上限） */
  _clearWatchdogs() {
    this._clearTimeout();
    if (this._slowTimer) { clearTimeout(this._slowTimer); this._slowTimer = 0; }
    if (this._slowTicker) { clearInterval(this._slowTicker); this._slowTicker = 0; }
    if (this._hardTimer) { clearTimeout(this._hardTimer); this._hardTimer = 0; }
    this._onHardTimeout = null;
  }

  _render(pct) {
    const p = Math.round(pct);
    if (this._bar) this._bar.style.width = p + '%';
    if (this._pct) this._pct.textContent = p + '%';
  }
}
