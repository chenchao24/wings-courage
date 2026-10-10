/**
 * 关卡音乐管理器：主题曲间隔循环 + 战斗高潮曲切换。
 *
 * 行为：
 *   - 主题曲播完 → 静默 gapMin~gapMax 秒 → 重新播放（淡入淡出）
 *   - 敌机进入 triggerRadius 时，淡出主题曲，播放一次战斗高潮曲（淡入）
 *   - 战斗高潮曲播完 → 淡出 → 恢复主题曲循环
 *   - 所有切换均淡入淡出
 *
 * 直接操作 audio.ctx 与 audio.master，自管理增益节点，
 * 每帧同步 audio._musicVolume / _musicEnabled（音量/开关）。
 */
export class LevelMusic {
  constructor(audio) {
    this.audio = audio;
    this.ctx = null;
    this.bus = null;           // 输出总线（连到 audio.master）
    this.config = null;
    this.state = 'idle';       // 'idle' | 'theme' | 'gap' | 'combat'
    this.themeBuf = null;
    this.combatBuf = null;
    this.themeSrc = null;
    this.themeGain = null;
    this.combatSrc = null;
    this.combatGain = null;
    this.gapTimer = 0;
    this.combatTriggered = false;  // 战斗曲播放中，防止重复触发
    this._fadeSec = 1.5;
  }

  /** 启动关卡音乐。config = { theme, combat, gapMin, gapMax, triggerRadius, fadeSec? } */
  async start(config) {
    if (!this.audio || !this.audio.enabled || !config || !config.theme) return;
    this.ctx = this.audio.ctx;
    this.config = config;
    this._fadeSec = config.fadeSec || 1.5;
    this.bus = this.ctx.createGain();
    this.bus.gain.value = this.audio._musicEnabled ? this.audio._musicVolume : 0;
    this.bus.connect(this.audio.master);
    await this._load('theme', config.theme);
    if (config.combat) await this._load('combat', config.combat);
    this._playTheme();
  }

  async _load(key, url) {
    try {
      const res = await fetch(url);
      if (!res.ok) { console.warn('[LevelMusic] fetch failed:', url, res.status); return; }
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      if (key === 'theme') this.themeBuf = buf;
      else this.combatBuf = buf;
    } catch (e) { console.warn('[LevelMusic] decode failed:', url, e); }
  }

  /** 播放主题曲一次（不循环），播完自然进入 gap 间隔 */
  _playTheme() {
    if (!this.themeBuf) return;
    const t = this.ctx.currentTime;
    const fade = this._fadeSec;
    this._stopTheme(0);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + fade);
    g.connect(this.bus);
    const s = this.ctx.createBufferSource();
    s.buffer = this.themeBuf;
    s.loop = false;
    s.connect(g);
    s.start(t);
    const self = this;
    s.onended = () => {
      if (self.themeSrc !== s) return;  // 被强制停止，已清理
      try { g.disconnect(); } catch (e) {}
      self.themeSrc = null;
      self.themeGain = null;
      if (self.state !== 'theme') return;
      self.state = 'gap';
      self.gapTimer = self.config.gapMin + Math.random() * (self.config.gapMax - self.config.gapMin);
    };
    this.themeSrc = s;
    this.themeGain = g;
    this.state = 'theme';
  }

  /** 停止主题曲（淡出 fadeSec 秒） */
  _stopTheme(fadeSec) {
    if (!this.themeSrc) return;
    const t = this.ctx.currentTime;
    const s = this.themeSrc, g = this.themeGain;
    this.themeSrc = null;
    this.themeGain = null;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + fadeSec);
    try { s.stop(t + fadeSec + 0.05); } catch (e) {}
    setTimeout(() => { try { g.disconnect(); } catch (e) {} }, (fadeSec + 0.15) * 1000);
  }

  /** 播放战斗高潮曲一次（不循环），播完恢复主题曲 */
  _playCombat() {
    if (!this.combatBuf) { this.combatTriggered = false; return; }
    const t = this.ctx.currentTime;
    const fade = this._fadeSec;
    this._stopTheme(fade);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + fade);
    g.connect(this.bus);
    const s = this.ctx.createBufferSource();
    s.buffer = this.combatBuf;
    s.loop = false;
    s.connect(g);
    s.start(t);
    const self = this;
    s.onended = () => {
      if (self.combatSrc !== s) return;
      try { g.disconnect(); } catch (e) {}
      self.combatSrc = null;
      self.combatGain = null;
      if (self.state !== 'combat') return;
      self.combatTriggered = false;
      self._playTheme();
    };
    this.combatSrc = s;
    this.combatGain = g;
    this.state = 'combat';
  }

  /** 停止战斗曲（淡出） */
  _stopCombat(fadeSec) {
    if (!this.combatSrc) return;
    const t = this.ctx.currentTime;
    const s = this.combatSrc, g = this.combatGain;
    this.combatSrc = null;
    this.combatGain = null;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + fadeSec);
    try { s.stop(t + fadeSec + 0.05); } catch (e) {}
    setTimeout(() => { try { g.disconnect(); } catch (e) {} }, (fadeSec + 0.15) * 1000);
  }

  /**
   * 每帧更新。
   * @param {number} dt 帧间隔（秒）
   * @param {number|null} nearestEnemyDist 最近敌机距离（米），null=无敌机
   */
  update(dt, nearestEnemyDist) {
    if (!this.ctx || this.state === 'idle') return;
    const targetVol = this.audio._musicEnabled ? this.audio._musicVolume : 0;
    this.bus.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.1);
    if (this.state === 'gap') {
      this.gapTimer -= dt;
      if (this.gapTimer <= 0) this._playTheme();
    }
    if (!this.combatTriggered && this.config.triggerRadius && this.combatBuf) {
      if (nearestEnemyDist != null && nearestEnemyDist < this.config.triggerRadius) {
        this.combatTriggered = true;
        this._playCombat();
      }
    }
  }

  /** 停止所有音乐（淡出），关卡结束时调用 */
  stop(fadeSec = 1.5) {
    if (!this.ctx) return;
    this.state = 'idle';
    this._stopTheme(fadeSec);
    this._stopCombat(fadeSec);
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