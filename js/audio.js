/**
 * WebAudio 程序化音效引擎（无外部音频文件，全部合成）。
 *   - 引擎：锯齿波(活塞粗糙感) + 三角波(低频脉动) + 气流噪声，音调随油门变化
 *   - 机枪：噪声 burst(枪口爆裂) + 低频 sine thump(机械撞击)
 *   - 命中：方波下扫(清脆金属 ping)
 *   - 爆炸：低通噪声长衰减 + 低频冲击波
 *
 * 浏览器策略：AudioContext 必须在用户首次交互(按键/点击)后创建。
 * main.js 会在首次 keydown/mousedown/touchstart 时调用 init()。
 */
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this.muted = false;
    this._lastFire = 0;
    this._lastFlak = 0;    // 防空爆炸声限频时间戳

    // 关卡级射击音效文件（替代合成机枪声，仅配置了 fireSounds 的关卡启用）
    // 截断播放模式：每次开火只播 buffer 前 fireFileDuration 秒（爆裂段），配合限频连发
    this._fireBuffers = [];              // AudioBuffer 列表（关卡级，stop 时清空）
    this.fireFileDuration = 0.35;        // 单次开火播放时长（秒，保留主体+部分衰减，可调）
    this._flakBuffers = [];              // 防空爆炸音效文件（替代合成，后续替换用）

    // 按武器组的射击音效（按组区分，替代关卡级共用 _fireBuffers）
    //   loopBuffer = 去掉最后一秒（回声段）的循环段，按住键时 src.loop=true 无缝循环
    //   fullBuffer = 完整原始 buffer（含回声），松开键时补一次完整播放收尾
    //   _groupFireLoops 记录当前正在循环的源，按组名索引
    this._groupFireSounds = {};          // groupName → { loopBuffer, fullBuffer, loopDuration, fullDuration }
    this._groupFireLoops = {};           // groupName → { src, gain }（当前循环源，stop 时清）

    // 引擎节点（updateEngine 每帧调节）
    this._engOsc = null;
    this._engOsc2 = null;
    this._engGain = null;
    this._engGain2 = null;
    this._engFilter = null;
    this._engNoiseGain = null;
    // 喷气引擎节点（engineSound:'jet' 关卡启用；缺省 'piston'）
    this._engineType = 'piston';
    this._jetOsc = null;
    this._jetOsc2 = null;
    this._jetGain = null;
    this._jetGain2 = null;
    this._jetNoiseFilter = null;
    this._jetNoiseGain = null;
    this._jetRumbleOsc = null;
    this._jetRumbleFilter = null;
    this._jetRumbleGain = null;
    // 文件引擎节点（playerConfig.engineSoundFile 关卡启用，优先级最高）
    this._fileEngSrc = null;
    this._fileEngGain = null;
    this._fileEngActive = false;

    // 预生成噪声 buffer（机枪/爆炸复用）
    this._noiseBuf = null;

    // 音量总线（各类音效独立调节）
    this._engineBus = null;  // 引擎总线
    this._gunBus = null;     // 机枪总线
    this._sfxBus = null;     // 音效总线（命中/爆炸）
    // 0-100 → 0-2.0 线性映射，50 = 1.0（当前默认音量）
    this._engineVolume = 1.0;
    this._gunVolume = 1.0;
    this._sfxVolume = 1.0;

    // 预览播放定时器
    this._previewTimers = {};

    // 背景音乐
    this._musicGain = null;       // 当前音乐增益节点（每轨独立，支持交叉淡入淡出）
    this._musicSource = null;     // 当前播放的 BufferSourceNode
    this._musicName = null;       // 当前曲目名
    this._musicBuffers = new Map(); // name → AudioBuffer 缓存
    this._musicVolume = 0.35;     // 音乐基础音量（slider 50% → 0.35）
    this._musicEnabled = true;    // 音乐开关（由 Settings 同步）

    // 全局玩家被命中音效（beHit01-03.mp3 随机播放，替代合成 hit；所有关卡共用）
    this._playerHitBuffers = [];
    // 全局子弹擦过音效（side1-3.mp3 随机播放；被咬尾且敌机开火时 30% 概率触发）
    this._sideBuffers = [];
    // 全局音效加载标志（避免每次 start 重复 fetch/decode）
    this._globalSfxLoaded = false;
  }

  init() {
    if (this.enabled) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
    } catch (e) {
      console.warn('[audio] AudioContext 不可用', e);
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);
    // 创建音量总线（各类音效独立调节）
    this._engineBus = this.ctx.createGain();
    this._engineBus.gain.value = this._engineVolume;
    this._engineBus.connect(this.master);
    this._gunBus = this.ctx.createGain();
    this._gunBus.gain.value = this._gunVolume;
    this._gunBus.connect(this.master);
    this._sfxBus = this.ctx.createGain();
    this._sfxBus.gain.value = this._sfxVolume;
    this._sfxBus.connect(this.master);
    this._buildNoiseBuffer();
    this._startEngine();
    this.enabled = true;
  }

  /** 恢复被浏览器挂起的 AudioContext（每次用户手势都调用一次，安全）*/
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }

  _buildNoiseBuffer() {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 0.4);
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
  }

  _startEngine() {
    const t = this.ctx.currentTime;

    // 主引擎：锯齿波（V12 活塞粗糙感）
    this._engOsc = this.ctx.createOscillator();
    this._engOsc.type = 'sawtooth';
    this._engOsc.frequency.value = 55;
    this._engFilter = this.ctx.createBiquadFilter();
    this._engFilter.type = 'lowpass';
    this._engFilter.frequency.value = 380;
    this._engFilter.Q.value = 0.8;
    this._engGain = this.ctx.createGain();
    this._engGain.gain.value = 0;  // 初始静音，仅 updateEngine 调用时才渐入
    this._engOsc.connect(this._engFilter);
    this._engFilter.connect(this._engGain);
    this._engGain.connect(this._engineBus);
    this._engOsc.start(t);

    // 次谐音：三角波（低频脉动，厚重感）
    this._engOsc2 = this.ctx.createOscillator();
    this._engOsc2.type = 'triangle';
    this._engOsc2.frequency.value = 27;
    this._engGain2 = this.ctx.createGain();
    this._engGain2.gain.value = 0;  // 初始静音
    this._engOsc2.connect(this._engGain2);
    this._engGain2.connect(this._engineBus);
    this._engOsc2.start(t);

    // 气流噪声层（高速嗖嗖声，随油门增强）
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuf;
    noise.loop = true;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1200;
    nf.Q.value = 0.5;
    this._engNoiseGain = this.ctx.createGain();
    this._engNoiseGain.gain.value = 0;
    noise.connect(nf);
    nf.connect(this._engNoiseGain);
    this._engNoiseGain.connect(this._engineBus);
    noise.start(t);

    // ── 喷气引擎层（仅 engineSound:'jet' 关卡启用，默认静音不影响活塞路径）──
    // Jumo 004 轴流涡喷：高频涡轮啸叫 + 压气机宽频气流 + 低频燃烧轰鸣
    // 保留已设类型（setEngineType 可能先于 init 调用）
    this._engineType = this._engineType || 'piston'; // 'piston' | 'jet'

    // 涡轮主啸叫（正弦，300→1700Hz 随油门）
    this._jetOsc = this.ctx.createOscillator();
    this._jetOsc.type = 'sine';
    this._jetOsc.frequency.value = 300;
    this._jetGain = this.ctx.createGain();
    this._jetGain.gain.value = 0;
    this._jetOsc.connect(this._jetGain);
    this._jetGain.connect(this._engineBus);
    this._jetOsc.start(t);

    // 涡轮次谐音（轻微失谐，双机/拍频丰富感）
    this._jetOsc2 = this.ctx.createOscillator();
    this._jetOsc2.type = 'sine';
    this._jetOsc2.frequency.value = 462; // ≈主啸叫×1.54
    this._jetGain2 = this.ctx.createGain();
    this._jetGain2.gain.value = 0;
    this._jetOsc2.connect(this._jetGain2);
    this._jetGain2.connect(this._engineBus);
    this._jetOsc2.start(t);

    // 压气机宽频气流（带通噪声，中心频率随油门上移）
    const jetNoise = this.ctx.createBufferSource();
    jetNoise.buffer = this._noiseBuf;
    jetNoise.loop = true;
    const jnf = this.ctx.createBiquadFilter();
    jnf.type = 'bandpass';
    jnf.frequency.value = 2000;
    jnf.Q.value = 1.2;
    this._jetNoiseFilter = jnf;
    this._jetNoiseGain = this.ctx.createGain();
    this._jetNoiseGain.gain.value = 0;
    jetNoise.connect(jnf);
    jnf.connect(this._jetNoiseGain);
    this._jetNoiseGain.connect(this._engineBus);
    jetNoise.start(t);

    // 低频燃烧轰鸣（锯齿波深度低通，全油门段的胸腔震感）
    this._jetRumbleOsc = this.ctx.createOscillator();
    this._jetRumbleOsc.type = 'sawtooth';
    this._jetRumbleOsc.frequency.value = 65;
    this._jetRumbleFilter = this.ctx.createBiquadFilter();
    this._jetRumbleFilter.type = 'lowpass';
    this._jetRumbleFilter.frequency.value = 140;
    this._jetRumbleFilter.Q.value = 0.5;
    this._jetRumbleGain = this.ctx.createGain();
    this._jetRumbleGain.gain.value = 0;
    this._jetRumbleOsc.connect(this._jetRumbleFilter);
    this._jetRumbleFilter.connect(this._jetRumbleGain);
    this._jetRumbleGain.connect(this._engineBus);
    this._jetRumbleOsc.start(t);
  }

  /**
   * 切换引擎音类型（关卡隔离：仅 playerConfig.engineSound 配置的关卡调用，
   * 缺省 'piston' 走原活塞引擎路径，行为不变）。
   * @param {'piston'|'jet'} type
   */
  setEngineType(type) {
    this._engineType = type === 'jet' ? 'jet' : 'piston';
    // 切换瞬间清零两路增益，避免残留（updateEngine 下一帧按新类型渐入）
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const zeros = [this._engGain, this._engGain2, this._engNoiseGain,
                   this._jetGain, this._jetGain2, this._jetNoiseGain, this._jetRumbleGain];
    for (const g of zeros) if (g) g.gain.setTargetAtTime(0, t, 0.05);
  }

  /**
   * 停止引擎音（淡出到静音）。离开战斗画面时调用，
   * 避免菜单/封面页听到引擎低频杂音。
   */
  stopEngine() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const tc = 0.3;
    this._engGain.gain.setTargetAtTime(0, t, tc);
    this._engGain2.gain.setTargetAtTime(0, t, tc);
    this._engNoiseGain.gain.setTargetAtTime(0, t, tc);
    // 喷气层（如有）一并淡出
    if (this._jetGain) {
      this._jetGain.gain.setTargetAtTime(0, t, tc);
      this._jetGain2.gain.setTargetAtTime(0, t, tc);
      this._jetNoiseGain.gain.setTargetAtTime(0, t, tc);
      this._jetRumbleGain.gain.setTargetAtTime(0, t, tc);
    }
    // 文件引擎（如有）一并淡出
    if (this._fileEngGain) this._fileEngGain.gain.setTargetAtTime(0, t, tc);
  }

  /** 合成引擎层（活塞+喷气）全部静音（文件引擎接管时调用） */
  _muteSynthEngines(t) {
    if (this._engGain) this._engGain.gain.setTargetAtTime(0, t, 0.1);
    if (this._engGain2) this._engGain2.gain.setTargetAtTime(0, t, 0.1);
    if (this._engNoiseGain) this._engNoiseGain.gain.setTargetAtTime(0, t, 0.1);
    if (this._jetGain) {
      this._jetGain.gain.setTargetAtTime(0, t, 0.1);
      this._jetGain2.gain.setTargetAtTime(0, t, 0.1);
      this._jetNoiseGain.gain.setTargetAtTime(0, t, 0.1);
      this._jetRumbleGain.gain.setTargetAtTime(0, t, 0.1);
    }
  }

  /**
   * 文件引擎音（关卡级，playerConfig.engineSoundFile 配置）：
   * 实录引擎循环，playbackRate/gain 随油门映射。优先级高于合成引擎（活塞/喷气）。
   * 关卡隔离：stop 时 clearEngineSound 清除，回到合成默认。
   */
  async setEngineSoundFile(url) {
    if (!this.ctx) return;
    try {
      const res = await fetch(url);
      if (!res.ok) { console.warn('[audio] engine sound fetch failed:', url, res.status); return; }
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      this.clearEngineSound(); // 清旧文件引擎（如有）
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;   // 循环文件已离线烘焙为无缝（scripts/make_engine_loops.py），无需偏移
      const gain = this.ctx.createGain();
      gain.gain.value = 0; // 初始静音，updateEngine 渐入
      src.connect(gain);
      gain.connect(this._engineBus);
      src.start();
      this._fileEngSrc = src;
      this._fileEngGain = gain;
      this._fileEngActive = true;
    } catch (e) {
      console.warn('[audio] engine sound decode failed:', url, e);
    }
  }

  /** 清除文件引擎音（回退合成引擎路径） */
  clearEngineSound() {
    if (this._fileEngSrc) {
      try { this._fileEngSrc.stop(); } catch (e) { /* 未启动/已停止 */ }
      try { this._fileEngSrc.disconnect(); } catch (e) { /* ignore */ }
      this._fileEngSrc = null;
    }
    if (this._fileEngGain) {
      try { this._fileEngGain.disconnect(); } catch (e) { /* ignore */ }
      this._fileEngGain = null;
    }
    this._fileEngActive = false;
  }

  /** 每帧更新引擎音调/音量。throttle 0-1 */
  updateEngine(throttle) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const tc = 0.15; // 平滑时间常数
    // ── 文件引擎（playerConfig.engineSoundFile 关卡，如 bf109/fw190/me262 实录）──
    // 优先级最高：接管时合成层（活塞/喷气）全部静音
    if (this._fileEngActive && this._fileEngSrc) {
      this._fileEngSrc.playbackRate.setTargetAtTime(0.75 + throttle * 0.55, t, tc);
      this._fileEngGain.gain.setTargetAtTime(0.22 + throttle * 0.55, t, tc);
      this._muteSynthEngines(t);
      return;
    }
    if (this._engineType === 'jet' && this._jetGain) {
      // ── 喷气引擎（Jumo 004）：涡轮啸叫 + 压气机气流 + 低频轰鸣，随油门爬升 ──
      this._jetOsc.frequency.setTargetAtTime(300 + throttle * 1400, t, tc);
      this._jetOsc2.frequency.setTargetAtTime((300 + throttle * 1400) * 1.54, t, tc);
      this._jetGain.gain.setTargetAtTime(0.012 + throttle * 0.038, t, tc);
      this._jetGain2.gain.setTargetAtTime(0.008 + throttle * 0.024, t, tc);
      this._jetNoiseFilter.frequency.setTargetAtTime(1600 + throttle * 2600, t, tc);
      this._jetNoiseGain.gain.setTargetAtTime(0.015 + throttle * 0.075, t, tc);
      this._jetRumbleOsc.frequency.setTargetAtTime(60 + throttle * 30, t, tc);
      this._jetRumbleGain.gain.setTargetAtTime(0.02 + throttle * 0.05, t, tc);
      return;
    }
    // ── 活塞引擎（原路径，前三关不变）──
    const base = 48 + throttle * 110; // 48-158 Hz
    this._engOsc.frequency.setTargetAtTime(base, t, tc);
    this._engOsc2.frequency.setTargetAtTime(base * 0.5, t, tc);
    this._engFilter.frequency.setTargetAtTime(300 + throttle * 900, t, tc);
    this._engGain.gain.setTargetAtTime(0.05 + throttle * 0.07, t, tc);
    this._engGain2.gain.setTargetAtTime(0.04 + throttle * 0.05, t, tc);
    this._engNoiseGain.gain.setTargetAtTime(throttle * 0.05, t, tc);
  }

  /**
   * 预加载关卡射击音效文件并缓存为 AudioBuffer。
   * 关卡配置 fireSounds 时由 GameRuntime.start 调用，stop 时调 clearFireSamples 清空。
   * 截掉音频尾部 0.2s 空白，使循环播放接缝更自然。
   * @param {string} url 音频文件 URL
   */
  async loadFireSound(url) {
    if (!this.ctx) return;
    try {
      const res = await fetch(url);
      if (!res.ok) { console.warn('[audio] fire sound fetch failed:', url, res.status); return; }
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      // 截掉头部 0.2s + 尾部 0.7s 空白（循环接缝更自然）
      const headTrimSec = 0.2;
      const tailTrimSec = 0.7;
      const sr = buf.sampleRate;
      const headLen = Math.floor(headTrimSec * sr);
      const tailLen = Math.floor(tailTrimSec * sr);
      const totalLen = buf.length;
      const startOff = headLen;
      const newLen = Math.max(1, totalLen - headLen - tailLen);
      const trimmed = this.ctx.createBuffer(buf.numberOfChannels, newLen, sr);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch);
        const dst = trimmed.getChannelData(ch);
        dst.set(src.subarray(startOff, startOff + newLen));
      }
      this._fireBuffers.push(trimmed);
    } catch (e) {
      console.warn('[audio] fire sound decode failed:', url, e);
    }
  }

  /** 清空关卡射击音效（关卡结束时调用，恢复默认合成机枪声） */
  clearFireSamples() {
    this._fireBuffers = [];
  }

  /** 射击键状态更新（占位，截断播放模式下无需处理，循环播放已废弃） */
  updateFiring(_active) {
    // 截断播放模式：每次开火独立播放，无需循环管理
  }

  /**
   * 加载武器组射击音效（按组区分，替代关卡级共用 fireSounds）。
   * 解码后生成两份 buffer：
   *   loopBuffer = 循环枪声段，用于按住键时无缝循环
   *   tailBuffer = 回响尾段，用于松开键时收尾播放
   * @param {string} groupName 武器组名（如 'mg17'/'mg151'）
   * @param {string|object} soundCfg 音频文件 URL（字符串，兼容旧去尾1s）或 {file, loopStart, loopEnd}
   */
  async loadGroupFireSound(groupName, soundCfg) {
    if (!this.ctx) return;
    // 兼容字符串形式（旧：去尾1s，收尾播完整）与对象形式（新：指定循环段范围）
    const isObj = typeof soundCfg === 'object' && soundCfg !== null;
    const url = isObj ? soundCfg.file : soundCfg;
    const loopStart = isObj ? (soundCfg.loopStart || 0) : 0;
    const loopEnd = isObj ? soundCfg.loopEnd : null;  // null = 旧模式去尾1s
    try {
      const res = await fetch(url);
      if (!res.ok) { console.warn('[audio] group fire sound fetch failed:', groupName, url, res.status); return; }
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      const sr = buf.sampleRate;
      const totalLen = buf.length;
      const startIdx = Math.floor(loopStart * sr);
      let loopLen, tailStartIdx;
      if (loopEnd !== null && loopEnd !== undefined) {
        // 对象模式：loopBuffer = [loopStart, loopEnd]，tailBuffer = [loopEnd, 结尾]
        const endIdx = Math.min(totalLen, Math.floor(loopEnd * sr));
        loopLen = Math.max(1, endIdx - startIdx);
        tailStartIdx = endIdx;
      } else {
        // 字符串兼容模式：loopBuffer = 去尾1s，tailBuffer = 完整 buf
        loopLen = Math.max(Math.floor(0.1 * sr), totalLen - Math.floor(1.0 * sr));
        tailStartIdx = 0;  // 收尾用完整 buffer
      }
      // 截取 loopBuffer
      const loopBuffer = this.ctx.createBuffer(buf.numberOfChannels, loopLen, sr);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch);
        const dst = loopBuffer.getChannelData(ch);
        dst.set(src.subarray(startIdx, startIdx + loopLen));
      }
      // 截取 tailBuffer（回响尾段；兼容模式下用完整 buf）
      let tailBuffer;
      if (tailStartIdx > 0 && tailStartIdx < totalLen) {
        const tailLen = totalLen - tailStartIdx;
        tailBuffer = this.ctx.createBuffer(buf.numberOfChannels, tailLen, sr);
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const src = buf.getChannelData(ch);
          const dst = tailBuffer.getChannelData(ch);
          dst.set(src.subarray(tailStartIdx, totalLen));
        }
      } else {
        tailBuffer = buf;  // 兼容模式：完整 buffer
      }
      this._groupFireSounds[groupName] = {
        loopBuffer,
        tailBuffer,
        loopDuration: loopLen / sr,
        tailDuration: tailBuffer.duration,
      };
    } catch (e) {
      console.warn('[audio] group fire sound decode failed:', groupName, url, e);
    }
  }

  /** 清空所有武器组射击音效（关卡结束时调用，停止所有循环不补收尾） */
  clearGroupFireSamples() {
    for (const name in this._groupFireLoops) {
      const loop = this._groupFireLoops[name];
      try { loop.src.stop(); } catch (e) {}
    }
    this._groupFireLoops = {};
    this._groupFireSounds = {};
  }

  /**
   * 开始某武器组的循环射击音效（按住射击键时调用）。
   * 用 loopBuffer + src.loop=true 无缝循环；已在循环则跳过。
   * @param {string} groupName 武器组名
   */
  startGroupFire(groupName) {
    if (!this.enabled) return;
    const snd = this._groupFireSounds[groupName];
    if (!snd) return;
    if (this._groupFireLoops[groupName]) return; // 已在循环
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = snd.loopBuffer;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    src.connect(g); g.connect(this._gunBus);
    src.start(t);
    this._groupFireLoops[groupName] = { src, gain: g };
  }

  /**
   * 停止某武器组的循环射击音效（松开射击键时调用）。
   * 循环源 50ms 淡出停止，随后补一次完整播放（含回声）作为收尾。
   * @param {string} groupName 武器组名
   */
  stopGroupFire(groupName) {
    if (!this.enabled) return;
    const loop = this._groupFireLoops[groupName];
    if (!loop) return; // 未在循环，无需收尾
    const t = this.ctx.currentTime;
    // 停止循环（50ms 淡出防咔嗒）
    loop.gain.gain.cancelScheduledValues(t);
    loop.gain.gain.setValueAtTime(loop.gain.gain.value, t);
    loop.gain.gain.linearRampToValueAtTime(0, t + 0.05);
    loop.src.stop(t + 0.06);
    delete this._groupFireLoops[groupName];
    // 补一次回响尾播放（收尾；10ms 淡入防回响段开头突变）
    const snd = this._groupFireSounds[groupName];
    if (snd && snd.tailBuffer) {
      const src2 = this.ctx.createBufferSource();
      src2.buffer = snd.tailBuffer;
      const g2 = this.ctx.createGain();
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(0.8, t + 0.01);
      src2.connect(g2); g2.connect(this._gunBus);
      src2.start(t);
      src2.stop(t + snd.tailBuffer.duration + 0.02);
    }
  }

  /**
   * 机枪开火：噪声 burst + 低频 thump。
   * 玩家有文件音效时播放文件前 fireFileDuration 秒（爆裂段），敌机/友军走合成音。
   * @param {boolean} isPlayer 是否玩家飞机开火
   * @param {boolean} useFile 是否使用文件音效（false=强制合成音，用于机枪区分机炮）
   */
  fire(isPlayer = false, useFile = true) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    if (t - this._lastFire < 0.035) return; // 限频防叠加爆音
    this._lastFire = t;

    // 关卡文件音效：播放 buffer 前 fireFileDuration 秒（尾部 20ms 线性淡出防咔嗒）
    if (useFile && isPlayer && this._fireBuffers.length > 0) {
      const dur = this.fireFileDuration;
      for (const buf of this._fireBuffers) {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.8, t);
        g.gain.setValueAtTime(0.8, t + Math.max(0, dur - 0.02));
        g.gain.linearRampToValueAtTime(0, t + dur);
        src.connect(g); g.connect(this._gunBus);
        src.start(t);
        src.stop(t + dur + 0.02);
      }
      return; // 文件音效替代合成
    }

    // 噪声 burst（枪口爆裂感）
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuf;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900 + Math.random() * 500;
    nf.Q.value = 1.2;
    const ng = this.ctx.createGain();
    const dur = 0.07;
    ng.gain.setValueAtTime(0.22, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(nf); nf.connect(ng); ng.connect(this._gunBus);
    noise.start(t);
    noise.stop(t + dur);

    // 低频 thump（机械撞击感）
    const th = this.ctx.createOscillator();
    th.type = 'sine';
    th.frequency.setValueAtTime(140, t);
    th.frequency.exponentialRampToValueAtTime(45, t + 0.05);
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0.28, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    th.connect(tg); tg.connect(this._gunBus);
    th.start(t); th.stop(t + 0.07);
  }

  /** 命中靶标：清脆金属 ping */
  hit() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(320, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g); g.connect(this._sfxBus);
    o.start(t); o.stop(t + 0.15);
  }

  /** 加载全局玩家被命中音效（beHit01-03.mp3，随机播放替代合成 hit） */
  async loadPlayerHitSounds(urls) {
    if (!this.ctx) return;
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) { console.warn('[audio] player hit sound fetch failed:', url, res.status); continue; }
        const arr = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(arr);
        this._playerHitBuffers.push(buf);
      } catch (e) {
        console.warn('[audio] player hit sound decode failed:', url, e);
      }
    }
  }

  /** 加载全局子弹擦过音效（side1-3.mp3，随机播放） */
  async loadSideSounds(urls) {
    if (!this.ctx) return;
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) { console.warn('[audio] side sound fetch failed:', url, res.status); continue; }
        const arr = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(arr);
        this._sideBuffers.push(buf);
      } catch (e) {
        console.warn('[audio] side sound decode failed:', url, e);
      }
    }
  }

  /** 加载全局音效（玩家被命中 + 擦过），仅加载一次，所有关卡共用 */
  async loadGlobalSfx() {
    if (this._globalSfxLoaded) return;
    this._globalSfxLoaded = true;
    await Promise.all([
      this.loadPlayerHitSounds([
        'sound/hit/beHit01.mp3',
        'sound/hit/beHit02.mp3',
        'sound/hit/beHit03.mp3',
      ]),
      this.loadSideSounds([
        'sound/hit/side1.mp3',
        'sound/hit/side2.mp3',
        'sound/hit/side3.mp3',
      ]),
    ]);
  }

  /** 玩家被命中：随机播 beHit01-03.mp3（无文件时回退合成 hit） */
  playPlayerHit() {
    if (!this.enabled) return;
    if (!this._playerHitBuffers.length) { this.hit(); return; }
    const buf = this._playerHitBuffers[Math.floor(Math.random() * this._playerHitBuffers.length)];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 1.0;
    src.connect(g); g.connect(this._sfxBus);
    src.start();
  }

  /** 子弹擦过：随机播 side1-3.mp3 */
  playSidePassBy() {
    if (!this.enabled || !this._sideBuffers.length) return;
    const buf = this._sideBuffers[Math.floor(Math.random() * this._sideBuffers.length)];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 1.0;
    src.connect(g); g.connect(this._sfxBus);
    src.start();
  }

  /** 爆炸（坠毁）：低通噪声长衰减 + 低频冲击波 */
  explosion() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const dur = 1.0;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(f); f.connect(g); g.connect(this._sfxBus);
    noise.start(t); noise.stop(t + dur);

    // 低频冲击波
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(80, t);
    sub.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.4, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    sub.connect(sg); sg.connect(this._sfxBus);
    sub.start(t); sub.stop(t + 0.5);
  }

  /** 防空火力爆炸声（空中闷响，按距离衰减）。
   *  距离超过 200m 不播放；0-200m 按 (1-d/200)^1.5 衰减。
   *  有文件缓冲时播放文件，否则程序化合成（低通噪声 + 低频冲击）。后续可 loadFlakSound 替换。
   *  @param {number} distance 爆炸点到玩家的距离（米） */
  flakExplosion(distance) {
    if (!this.enabled) return;
    const maxDist = 200;
    if (distance >= maxDist) return;
    const t = this.ctx.currentTime;
    if (t - this._lastFlak < 0.05) return; // 限频防叠加爆音
    this._lastFlak = t;
    const atten = Math.pow(1 - distance / maxDist, 1.5); // 距离衰减

    // 文件音效（若已加载）
    if (this._flakBuffers.length > 0) {
      const buf = this._flakBuffers[Math.floor(Math.random() * this._flakBuffers.length)];
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      const dur = 0.6;
      g.gain.setValueAtTime(0.7 * atten, t);
      g.gain.setValueAtTime(0.7 * atten, t + Math.max(0, dur - 0.05));
      g.gain.linearRampToValueAtTime(0, t + dur);
      src.connect(g); g.connect(this._sfxBus);
      src.start(t); src.stop(t + dur + 0.02);
      return;
    }

    // 程序化合成：闷响噪声（低通 350→40Hz，空中爆炸更闷）
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(350, t);
    f.frequency.exponentialRampToValueAtTime(40, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3 * atten, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    noise.connect(f); f.connect(g); g.connect(this._sfxBus);
    noise.start(t); noise.stop(t + 0.5);

    // 低频冲击波（50→20Hz sine，闷）
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(50, t);
    sub.frequency.exponentialRampToValueAtTime(20, t + 0.3);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.25 * atten, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    sub.connect(sg); sg.connect(this._sfxBus);
    sub.start(t); sub.stop(t + 0.35);
  }

  /** 预加载防空爆炸音效文件（替代合成，后续替换用） */
  async loadFlakSound(url) {
    if (!this.ctx) return;
    try {
      const res = await fetch(url);
      if (!res.ok) { console.warn('[audio] flak sound fetch failed:', url, res.status); return; }
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      this._flakBuffers.push(buf);
    } catch (e) {
      console.warn('[audio] flak sound decode failed:', url, e);
    }
  }

  /** 清空防空爆炸音效文件（恢复程序化合成） */
  clearFlakSamples() {
    this._flakBuffers = [];
  }

  /** 无线电提示音（嘟）：对话出现时的短促蜂鸣，模拟无线电接通 */
  radioBeep() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(this._sfxBus);
    o.start(t); o.stop(t + 0.09);
  }

  // ---------- 背景音乐 ----------

  /**
   * 预加载音乐文件并缓存为 AudioBuffer。
   * @param {string} name 曲目标识（如 'menu' / 'combat'）
   * @param {string} url 音频文件 URL
   */
  async loadMusic(name, url) {
    if (!this.ctx) return;
    if (this._musicBuffers.has(name)) return;
    try {
      const res = await fetch(url);
      if (!res.ok) { console.warn('[audio] music fetch failed:', url, res.status); return; }
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      this._musicBuffers.set(name, buf);
    } catch (e) {
      console.warn('[audio] music decode failed:', name, e);
    }
  }

  /**
   * 播放指定曲目（交叉淡入淡出）。若已在播放同名曲目则跳过。
   * @param {string} name 曲目标识
   * @param {number} [fadeSec=1.5] 淡入淡出时长（秒）
   */
  playMusic(name, fadeSec = 1.5) {
    if (!this.enabled) return;
    const buffer = this._musicBuffers.get(name);
    if (!buffer) { console.warn('[audio] music not loaded:', name); return; }
    if (this._musicName === name && this._musicSource) return; // 已在播放

    const t = this.ctx.currentTime;
    const targetVol = this._musicEnabled ? this._musicVolume : 0;

    // 淡出并停止旧曲目
    if (this._musicSource && this._musicGain) {
      const oldSource = this._musicSource;
      const oldGain = this._musicGain;
      oldGain.gain.cancelScheduledValues(t);
      oldGain.gain.setValueAtTime(oldGain.gain.value, t);
      oldGain.gain.linearRampToValueAtTime(0, t + fadeSec);
      oldSource.stop(t + fadeSec + 0.05);
      setTimeout(() => { try { oldGain.disconnect(); } catch (e) {} }, (fadeSec + 0.2) * 1000);
    }

    // 创建新曲目的独立增益节点（支持交叉淡入淡出）
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(targetVol, t + fadeSec);
    gain.connect(this.master);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start(t);

    this._musicGain = gain;
    this._musicSource = source;
    this._musicName = name;
  }

  /**
   * 停止当前音乐（淡出）。
   * @param {number} [fadeSec=1.5] 淡出时长（秒）
   */
  stopMusic(fadeSec = 1.5) {
    if (!this.enabled || !this._musicSource || !this._musicGain) return;
    const t = this.ctx.currentTime;
    const oldSource = this._musicSource;
    const oldGain = this._musicGain;
    oldGain.gain.cancelScheduledValues(t);
    oldGain.gain.setValueAtTime(oldGain.gain.value, t);
    oldGain.gain.linearRampToValueAtTime(0, t + fadeSec);
    oldSource.stop(t + fadeSec + 0.05);
    setTimeout(() => { try { oldGain.disconnect(); } catch (e) {} }, (fadeSec + 0.2) * 1000);
    this._musicSource = null;
    this._musicGain = null;
    this._musicName = null;
  }

  /**
   * 音乐开关（由 Settings 同步）。淡入/淡出 0.5s。
   * 即使音频未初始化也可调用（仅存储标志，init 后生效）。
   */
  setMusicEnabled(enabled) {
    this._musicEnabled = enabled;
    if (!this.enabled || !this._musicGain) return;
    const t = this.ctx.currentTime;
    this._musicGain.gain.cancelScheduledValues(t);
    this._musicGain.gain.setValueAtTime(this._musicGain.gain.value, t);
    this._musicGain.gain.linearRampToValueAtTime(
      enabled ? this._musicVolume : 0, t + 0.5
    );
  }

  // ---------- 音量控制 ----------
  // slider 0-100 → gain 0-2.0（50 = 1.0 = 当前默认音量）

  /** 设置音乐音量。v 为 0-100。 */
  setMusicVolume(v) {
    this._musicVolume = (v / 100) * 0.7;  // 50 → 0.35
    if (!this.enabled || !this._musicGain) return;
    const t = this.ctx.currentTime;
    this._musicGain.gain.cancelScheduledValues(t);
    this._musicGain.gain.setValueAtTime(this._musicGain.gain.value, t);
    this._musicGain.gain.linearRampToValueAtTime(
      this._musicEnabled ? this._musicVolume : 0, t + 0.1
    );
  }

  /** 设置音效音量（命中/爆炸）。v 为 0-100。 */
  setSfxVolume(v) {
    this._sfxVolume = (v / 100) * 2.0;
    if (!this.enabled || !this._sfxBus) return;
    this._sfxBus.gain.setTargetAtTime(this._sfxVolume, this.ctx.currentTime, 0.1);
  }

  /** 设置机枪音量。v 为 0-100。 */
  setGunVolume(v) {
    this._gunVolume = (v / 100) * 2.0;
    if (!this.enabled || !this._gunBus) return;
    this._gunBus.gain.setTargetAtTime(this._gunVolume, this.ctx.currentTime, 0.1);
  }

  /** 设置引擎音量。v 为 0-100。 */
  setEngineVolume(v) {
    this._engineVolume = (v / 100) * 2.0;
    if (!this.enabled || !this._engineBus) return;
    this._engineBus.gain.setTargetAtTime(this._engineVolume, this.ctx.currentTime, 0.1);
  }

  // ---------- 预览播放 ----------
  // 试听按钮：点击开始周期性播放，再点停止。用于"边调边听"。

  /**
   * 开始预览播放。
   * @param {string} type 'music' | 'gun' | 'engine' | 'sfx'
   */
  previewStart(type) {
    if (!this.enabled) return;
    this.previewStop(type); // 先清理上一次
    switch (type) {
      case 'music':
        this.playMusic('menu', 0.5);
        break;
      case 'gun':
        this.fire(); // 立即响一声
        this._previewTimers.gun = setInterval(() => this.fire(), 0.18);
        break;
      case 'engine':
        this.updateEngine(0.45);
        break;
      case 'sfx':
        this.hit();
        this._previewTimers.sfx = setInterval(() => {
          this.hit();
          // 每隔一次换成爆炸声，丰富预览
          if (Math.random() < 0.3) this.explosion();
        }, 0.9);
        break;
    }
  }

  /**
   * 停止预览播放。
   * @param {string} type 'music' | 'gun' | 'engine' | 'sfx'
   */
  previewStop(type) {
    switch (type) {
      case 'music':
        this.stopMusic(0.5);
        break;
      case 'gun':
        if (this._previewTimers.gun) { clearInterval(this._previewTimers.gun); this._previewTimers.gun = null; }
        break;
      case 'engine':
        this.stopEngine();
        break;
      case 'sfx':
        if (this._previewTimers.sfx) { clearInterval(this._previewTimers.sfx); this._previewTimers.sfx = null; }
        break;
    }
  }

  /** 停止所有预览（离开设置页时调用） */
  previewStopAll() {
    for (const t of ['music', 'gun', 'engine', 'sfx']) this.previewStop(t);
  }
}
