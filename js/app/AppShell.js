import * as THREE from 'three';
import { createEnvironment, disposeEnvironment } from '../environment.js';
import { Clouds } from '../clouds.js';
import { GameAudio } from '../audio.js';
import { Settings } from '../game/Settings.js';
import { Router } from './Router.js';
import { THEME_CSS } from './Theme.js';
import { CoverPage } from './pages/CoverPage.js';
import { MenuPage } from './pages/MenuPage.js';
import { LevelSelectPage } from './pages/LevelSelectPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { HangarPage } from './pages/HangarPage.js';
import { BriefingPage } from './pages/BriefingPage.js';
import { FreeMapSelectPage } from './pages/FreeMapSelectPage.js';
import { FreeHangarPage } from './pages/FreeHangarPage.js';
import { GameRuntime } from '../game/GameRuntime.js';
import { FreeModeRuntime } from '../freemode/FreeModeRuntime.js';
import { getFreeMapConfig } from '../freemode/FreeModeMaps.js';
import { getLevel } from '../config/levels/index.js';
import { LoadingOverlay } from './ui/LoadingOverlay.js';

/**
 * AppShell：应用层单例，持有跨关卡共享资源 + 路由。
 *
 * 共享资源（整个 SPA 期间常驻）：
 *   renderer / scene / camera / env / clouds / audio / settings
 * 关卡级资源（GameRuntime 持有，stop 时释放）：
 *   aircraft / controls / weapons / enemies / radar / hud
 *
 * 背景渲染循环：非游戏页面时渲染空场景（相机缓慢绕场），作为动态背景。
 * 游戏运行时由 GameRuntime 自己渲染，AppShell 跳过避免双重渲染。
 */
export class AppShell {
  constructor() {
    this.router = null;
    this.settings = null;
    this.audio = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.env = null;
    this.clouds = null;
    this.runtime = null;          // 当前 GameRuntime 实例（P2）
    this._gameRunning = false;
    this._appRafId = 0;
    this._audioEnsured = false;
    this._resizeHandler = null;
    this.loader = new LoadingOverlay(); // 进出关卡加载遮罩
  }

  boot() {
    // 1. 注入主题 CSS
    const style = document.createElement('style');
    style.id = 'theme-css';
    style.textContent = THEME_CSS;
    document.head.appendChild(style);

    // 2. 创建共享 Three.js 资源（保留旧测试场的渲染参数）
    const canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 50000);
    this.camera.position.set(0, 120, 220);
    this.camera.lookAt(0, 80, 0);

    // 3. 环境 + 云层（程序化生成，跨关卡共享；不加载飞机模型）
    this.env = createEnvironment(this.scene, this.renderer);
    this.clouds = new Clouds(this.scene, { count: 55 });

    // 4. 音频 + 设置
    this.audio = new GameAudio();
    this.settings = new Settings();
    this._syncAudioSettings();

    // 5. 路由 + 注册页面
    this.router = new Router(this);
    this.router
      .register('cover', CoverPage)
      .register('menu', MenuPage)
      .register('level-select', LevelSelectPage)
      .register('settings', SettingsPage)
      .register('hangar', HangarPage)
      .register('briefing', BriefingPage)
      .register('free-map-select', FreeMapSelectPage)
      .register('free-hangar', FreeHangarPage);

    // 6. 窗口 resize（AppShell 级，GameRuntime 内部有自己的 resize 处理）
    this._resizeHandler = () => this._onResize();
    window.addEventListener('resize', this._resizeHandler);

    // 7. 启动背景渲染循环
    this._appLoop();

    // 8. 进入封面页
    this.router.go('cover');

    // 调试接口
    window.__shell = this;
  }

  /** 首次用户交互初始化音频（浏览器 AudioContext 策略） */
  ensureAudio() {
    if (this._audioEnsured) return;
    this._audioEnsured = true;
    if (!this.audio.enabled) this.audio.init();
    this.audio.resume();
    // 加载并播放菜单音乐
    this._playMenuMusic();
  }

  /** 加载并播放菜单配乐（封面/菜单/选关等非战斗页面） */
  async _playMenuMusic() {
    await this.audio.loadMusic('menu', '/sound/mainTitle.mp3');
    this.audio.playMusic('menu', 2.0);
  }

  /** 加载并播放战斗配乐 */
  async _playCombatMusic(levelConfig) {
    // 关卡音乐系统由 LevelMusic / BerlinMusic 接管（GameRuntime 创建并驱动），此处跳过旧 playMusic
    if (levelConfig.levelMusic || levelConfig.berlinMusic) {
      this.audio.stopMusic(2.0);  // 淡出菜单音乐，避免与关卡主题曲重叠
      return;
    }
    const url = levelConfig.music || '/sound/adevnAs.mp3';
    await this.audio.loadMusic('combat', url);
    this.audio.playMusic('combat', 2.0);
  }

  /** 同步设置到音频系统（P3 扩展 audio 方法后生效） */
  _syncAudioSettings() {
    const audio = this.audio;
    const s = this.settings;
    // 安全调用：P1 阶段 audio 尚无这些方法，typeof 检查兼容
    if (typeof audio.setHitSoundEnabled === 'function') audio.setHitSoundEnabled(s.get('hitSound'));
    if (typeof audio.setSoundEnabled === 'function') audio.setSoundEnabled(s.get('soundEnabled'));
    audio.setMusicEnabled(s.get('musicEnabled'));
    // 音量滑块（0-100 → audio 内部转换）
    audio.setMusicVolume(s.get('musicVolume'));
    audio.setSfxVolume(s.get('sfxVolume'));
    audio.setGunVolume(s.get('gunVolume'));
    audio.setEngineVolume(s.get('engineVolume'));
    // 订阅变更
    this.settings.onChange('hitSound', (v) => {
      if (typeof audio.setHitSoundEnabled === 'function') audio.setHitSoundEnabled(v);
    });
    this.settings.onChange('soundEnabled', (v) => {
      if (typeof audio.setSoundEnabled === 'function') audio.setSoundEnabled(v);
    });
    this.settings.onChange('musicEnabled', (v) => audio.setMusicEnabled(v));
    this.settings.onChange('musicVolume', (v) => audio.setMusicVolume(v));
    this.settings.onChange('sfxVolume', (v) => audio.setSfxVolume(v));
    this.settings.onChange('gunVolume', (v) => audio.setGunVolume(v));
    this.settings.onChange('engineVolume', (v) => audio.setEngineVolume(v));
  }

  /**
   * 进入关卡：创建 GameRuntime 并启动。
   * 关卡运行期间隐藏 #app（页面 DOM），交还时恢复并返回选关页。
   * 进出关卡全程用 LoadingOverlay 遮罩挡住飞机模型加载、相机摆位、
   * 关卡释放等过程中的裸 3D 场景，避免玩家看到未就位的画面。
   */
  startLevel(levelId) {
    const levelConfig = getLevel(levelId);
    if (!levelConfig) {
      console.warn('[AppShell] 未找到关卡配置:', levelId);
      return;
    }

    // 1. 先显示加载遮罩（盖住 #app 与 #scene），再隐藏页面 DOM
    this.loader.show('加载任务中', levelConfig.name || '', 8000, () => {
      this._toast('加载超时，已强制进入');
    });
    this.loader.setProgress(15);

    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    // 2. 关卡级环境重建（不同主题时释放旧环境 + 按关卡配置重建）
    this._rebuildEnvironmentFor(levelConfig);
    this.loader.setProgress(35);

    this.runtime = new GameRuntime({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      env: this.env,
      clouds: this.clouds,
      audio: this.audio,
      settings: this.settings,
      shell: this,
    });

    // 进度推进：飞机模型 await load 期间无法精确插桩，
    // 用阶段逼近 90%，等 onReady 跳 100%
    let prog = 35;
    const progTimer = setInterval(() => {
      prog = Math.min(90, prog + 8);
      this.loader.setProgress(prog);
    }, 200);

    this.runtime.start(levelConfig, {
      onReady: () => {
        clearInterval(progTimer);
        // 飞机已加载、相机首帧已 copy 到位，跳满进度后隐藏遮罩
        this.loader.setProgress(100);
        setTimeout(() => this.loader.hide(), 250); // 让 100% 短暂可见再淡出
      },
      onPlayerDead: (reason) => {
        clearInterval(progTimer);
        this.loader.hide(); // 兜底：若 onReady 未触发就阵亡（理论不会），确保遮罩关闭
        const stats = this.runtime.getStats();
        this.audio.stopEngine();
        // reason='altFence'（脱离作战高度判负）→ 自定义"任务失败"文案；其余走原阵亡文案
        this._showResult(false, stats, '返回任务选择',
          reason === 'altFence' ? '任务失败 · MISSION FAILED' : null);
      },
      onAllClear: () => {
        this.runtime.pause(); // 冻结游戏（避免获胜后继续飞行）
        this.audio.stopEngine();
        const stats = this.runtime.getStats();
        this._showResult(true, stats);
      },
      onStop: () => {
        clearInterval(progTimer);
        this.runtime = null;
        // 兜底：确保 loading 遮罩关闭（如 start 失败走 catch->stop，onReady 未触发）
        this.loader.hide();
        // 出关：#app 恢复显示时仍是简报页（不透明 .page-bg 盖住 #scene），
        // 随后 router.go 走交叉淡入（机制 A）切到选关页，全程无空帧，无需 loading 遮罩。
        if (app) app.style.display = '';
        // 停止引擎音 + 切回菜单配乐
        this.audio.stopEngine();
        this._playMenuMusic();
        this.router.go('level-select');
      },
    });

    // 切换到战斗配乐（与 runtime.start 并行加载）
    this._playCombatMusic(levelConfig);
  }

  /**
   * 进入自由模式：创建 FreeModeRuntime 并启动。
   * 与战役模式完全隔离：使用 FreeModeRuntime（不继承 GameRuntime），
   * 配置来自 js/config/freemode/*，结算后返回地图选择页。
   * @param {object} config {mapId, playerAircraft, enemyAircraftList, difficulty, timeLimitMinutes}
   */
  startFreeMode(config) {
    const mapCfg = getFreeMapConfig(config.mapId);
    if (!mapCfg) {
      console.warn('[AppShell] 未找到自由模式地图:', config.mapId);
      return;
    }

    this.loader.show('加载任务中', mapCfg.name || '自由模式', 8000, () => {
      this._toast('加载超时，已强制进入');
    });
    this.loader.setProgress(15);

    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    // 环境重建（用自由模式地图的 environment/clouds 配置）
    this._rebuildEnvironmentFor({ environment: mapCfg.environment, clouds: mapCfg.clouds });
    this.loader.setProgress(35);

    this.runtime = new FreeModeRuntime({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      env: this.env,
      clouds: this.clouds,
      audio: this.audio,
      settings: this.settings,
      shell: this,
    });

    let prog = 35;
    const progTimer = setInterval(() => {
      prog = Math.min(90, prog + 8);
      this.loader.setProgress(prog);
    }, 200);

    this.runtime.start(config, {
      onReady: () => {
        clearInterval(progTimer);
        this.loader.setProgress(100);
        setTimeout(() => this.loader.hide(), 250);
      },
      onPlayerDead: () => {
        clearInterval(progTimer);
        this.loader.hide();
        const stats = this.runtime.getStats();
        this.audio.stopEngine();
        this._showResult(false, stats, '返回地图选择');
      },
      onAllClear: () => {
        this.runtime.pause();
        this.audio.stopEngine();
        const stats = this.runtime.getStats();
        this._showResult(true, stats, '返回地图选择');
      },
      onTimeOver: () => {
        this.runtime.pause();
        this.audio.stopEngine();
        const stats = this.runtime.getStats();
        this._showResult(true, stats, '返回地图选择', 'TIME UP · 任务完成');
      },
      onStop: () => {
        clearInterval(progTimer);
        this.runtime = null;
        this.loader.hide();
        if (app) app.style.display = '';
        this.audio.stopEngine();
        this._playMenuMusic();
        this.router.go('free-map-select');
      },
    });

    // 自由模式战斗配乐（暂用默认战斗曲）
    this._playCombatMusic({ music: '/sound/adevnAs.mp3' });
  }

  /**
   * 关卡级环境重建：不同主题时释放旧环境 + 按关卡配置重建 env/clouds。
   * boot 为中性默认环境（无 theme），任何关卡首次进入都重建一次让 environment 完整生效；
   * 同主题重玩时跳过加速（barbarossa→barbarossa / britain→britain）。
   */
  _rebuildEnvironmentFor(levelConfig) {
    const desiredTheme = levelConfig.environment?.theme || 'barbarossa';
    // boot 时 envConfig 为空对象（无 theme 字段）→ bootTheme=undefined 表示中性默认环境
    // 任何关卡首次进入都需重建一次，让关卡 environment（如 skyClouds）完整生效
    const bootTheme = this.env?.envConfig?.theme;
    const currentTheme = bootTheme || 'barbarossa';
    if (bootTheme && desiredTheme === currentTheme) return; // 同主题跳过（重玩加速）

    // 不同主题：释放旧环境 + 重建
    disposeEnvironment(this.env, this.scene);
    this.clouds.dispose?.(this.scene); // 可选链兼容旧版

    // 创建新环境（传入关卡 environment 配置）
    this.env = createEnvironment(this.scene, this.renderer, levelConfig.environment);
    // 重建云层（用关卡 clouds 配置或默认）
    this.clouds = new Clouds(this.scene, levelConfig.clouds || { count: 55 });
  }

  /** GameRuntime 启动/停止时通知 AppShell 切换渲染权 */
  setGameRunning(running) {
    this._gameRunning = running;
  }

  /** 背景渲染循环：非游戏页面时渲染场景作为动态背景 */
  _appLoop() {
    this._appRafId = requestAnimationFrame(() => this._appLoop());
    if (this._gameRunning) return; // 游戏运行时由 GameRuntime 渲染
    // 封面/菜单页：相机缓慢绕场，展示天空+地形
    const t = performance.now() * 0.00008;
    this.camera.position.x = Math.sin(t) * 260;
    this.camera.position.z = Math.cos(t) * 260;
    this.camera.position.y = 130;
    this.camera.lookAt(0, 80, 0);
    if (this.env.sky) this.env.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    if (this._gameRunning) return; // 游戏运行时由 GameRuntime 处理 resize
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  /**
   * 关卡结算覆盖层（简易版，P7 将扩展为完整结算页）。
   * @param {boolean} success true=任务成功 false=玩家阵亡
   * @param {{killed,target,time,hp,maxHp}} stats
   * @param {string} [backLabel='返回任务选择'] 返回按钮文字
   * @param {string} [customStamp] 自定义印章文字（默认按 success 自动选择）
   */
  _showResult(success, stats, backLabel = '返回任务选择', customStamp = null) {
    // 移除已有覆盖层
    const old = document.getElementById('result-overlay');
    if (old) old.remove();

    const t = Math.max(0, stats.time || 0);
    const mm = Math.floor(t / 60).toString().padStart(2, '0');
    const ss = Math.floor(t % 60).toString().padStart(2, '0');
    const hpPct = stats.maxHp > 0 ? Math.max(0, Math.round(stats.hp)) : 0;
    const stamp = customStamp || (success ? 'MISSION ACCOMPLISHED' : "YOU'RE DOWN, CAPTAIN");
    const title = customStamp ? customStamp.split('·')[0].trim() : (success ? '任务成功' : '你已阵亡，上尉');

    const ov = document.createElement('div');
    ov.id = 'result-overlay';
    ov.innerHTML = `
      <div class="result-mask"></div>
      <div class="result-card ${success ? '' : 'fail'}">
        <div class="result-stamp">${stamp}</div>
        <div class="result-title">${title}</div>
        <div class="result-stats">
          <div class="rs-cell"><span class="rs-l">击落</span><span class="rs-v">${stats.killed}<i>/${stats.target}</i></span></div>
          <div class="rs-cell"><span class="rs-l">用时</span><span class="rs-v">${mm}:${ss}</span></div>
          <div class="rs-cell"><span class="rs-l">残余HP</span><span class="rs-v">${hpPct}</span></div>
        </div>
        <button class="bronze-button primary" data-action="back">${backLabel}</button>
      </div>
    `;
    document.body.appendChild(ov);
    ov.querySelector('[data-action="back"]').addEventListener('click', () => {
      ov.remove();
      if (this.runtime) this.runtime.stop(); // stop → onStop → 回选关
    });
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
