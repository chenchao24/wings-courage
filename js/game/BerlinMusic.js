/**
 * 柏林关卡多段序列音乐管理器（仅第 4 关使用，与 LevelMusic 互斥）。
 *
 * 播放流程：
 *   m1（一遍）→ elg（一遍）→ m2（一遍）→ [gapSec 静默] → 交替循环(elg ↔ m2)
 *   → 拦截进度 ≥ progressThreshold（0.9）→ 循环 m3
 *
 * 所有切换淡入淡出；序列内衔接为"前段自然播完 + 后段淡入"。
 * 直接操作 audio.ctx 与 audio.master，自管理增益节点，
 * 每帧同步 audio._musicVolume / _musicEnabled（音量/开关）。
 */
export class BerlinMusic {
  constructor(audio) {
    this.audio = audio;
    this.ctx = null;
    this.bus = null;
    this.config = null;
    this.state = 'idle';       // 'idle'|'m1'|'elg1'|'m2a'|'gap'|'loop'|'m3'
    this._buffers = {};        // name → AudioBuffer
    this._src = null;
    this._gain = null;
    this._gapTimer = 0;
    this._loopToggle = 0;      // 0=elg, 1=m2
    this._fadeSec = 1.5;
    this._progress = 0;
    this._m3Started = false;
  }

  /** 启动。config = { m1, elg, m2, m3, gapSec?, fadeSec?, progressThreshold? } */
  async start(config) {
    if (!this.audio || !this.audio.enabled || !config) return;
    this.ctx = this.audio.ctx;
    this.config = config;
    this._fadeSec = config.fadeSec || 1.5;
    this.bus = this.ctx.createGain();
    this.bus.gain.value = this.audio._musicEnabled ? this.audio._musicVolume : 0;
    this.bus.connect(this.audio.master);
    for (const name of ['m1', 'elg', 'm2', 'm3']) {
      if (config[name]) await this._load(name, config[name]);
    }
    this.state = 'm1';
    this._play('m1', false, 0, () => {
      this.state = 'elg1';
      this._play('elg', false, 0, () => {
        this.state = 'm2a';
        this._play('m2', false, 0, () => {
          this.state = 'gap';
          this._gapTimer = config.gapSec || 6;
        });
      });
    });
  }

  async _load(name, url) {
    try {
      const res = await fetch(url);
      if (!res.ok) { console.warn('[BerlinMusic] fetch failed:', url, res.status); return; }
      const arr = await res.arrayBuffer();
      this._buffers[name] = await this.ctx.decodeAudioData(arr);
    } catch (e) {
      console.warn('[BerlinMusic] decode failed:', url, e);
    }
  }

  /**
   * 播放指定曲目。
   * @param {string} name 曲目标识
   * @param {boolean} loop 是否循环
   * @param {number} fadeOutSec 淡出旧曲时长（0=立即切，序列内衔接用 0）
   * @param {function} [onEnded] 单次播完回调（loop=true 时不触发）
   */
  _play(name, loop, fadeOutSec, onEnded) {
    const buf = this._buffers[name];
    if (!buf) { if (onEnded) onEnded(); return; }
    const t = this.ctx.currentTime;
    const fade = this._fadeSec;
    this._stopCurrent(fadeOutSec);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + fade);
    g.connect(this.bus);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    s.connect(g);
    s.start(t);
    const self = this;
    if (!loop) {
      s.onended = () => {
        if (self._src !== s) return;
        try { g.disconnect(); } catch (e) {}
        self._src = null;
        self._gain = null;
        if (onEnded) onEnded();
      };
    }
    this._src = s;
    this._gain = g;
  }

  _stopCurrent(fadeSec) {
    if (!this._src) return;
    const t = this.ctx.currentTime;
    const s = this._src, g = this._gain;
    this._src = null;
    this._gain = null;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + fadeSec);
    try { s.stop(t + fadeSec + 0.05); } catch (e) {}
    setTimeout(() => { try { g.disconnect(); } catch (e) {} }, (fadeSec + 0.15) * 1000);
  }

  _playLoopStep() {
    const name = this._loopToggle === 0 ? 'elg' : 'm2';
    this._play(name, false, 0, () => {
      if (this.state !== 'loop') return;
      this._loopToggle = 1 - this._loopToggle;
      this._playLoopStep();
    });
  }

  /**
   * 每帧更新。
   * @param {number} dt 帧间隔（秒）
   * @param {number} progress 拦截进度 0~1（_score / target）
   */
  update(dt, progress) {
    if (!this.ctx || this.state === 'idle') return;
    this._progress = progress || 0;
    const targetVol = this.audio._musicEnabled ? this.audio._musicVolume : 0;
    this.bus.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.1);

    if (this.state === 'gap') {
      this._gapTimer -= dt;
      if (this._gapTimer <= 0) {
        this.state = 'loop';
        this._loopToggle = 0;
        this._playLoopStep();
      }
    }

    const threshold = this.config.progressThreshold || 0.9;
    if (this._progress >= threshold && this.state === 'loop' && !this._m3Started) {
      this._m3Started = true;
      this.state = 'm3';
      this._play('m3', true, this._fadeSec);
    }
  }

  /** 停止所有音乐（淡出），关卡结束时调用 */
  stop(fadeSec = 1.5) {
    if (!this.ctx) return;
    this.state = 'idle';
    this._stopCurrent(fadeSec);
    if (this.bus) {
      const t = this.ctx.currentTime;
      const b = this.bus;
      this.bus = null;
      b.gain.cancelScheduledValues(t);
      b.gain.setValueAtTime(b.gain.value, t);
      b.gain.linearRampToValueAtTime(0, t + fadeSec);
      setTimeout(() => { try { b.disconnect(); } catch (e) {} }, (fadeSec + 0.15) * 1000);
    }
  }
}