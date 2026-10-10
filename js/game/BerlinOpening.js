import * as THREE from 'three';

/**
 * 柏林开场导演（仅第4关《柏林保卫战》，levelConfig.opening.enabled 时由 GameRuntime 创建）。
 *
 * 鸭式兼容 CinematicSystem 接口（active/camMode/update/skip/toggleView/dispose +
 * computeCinematicFixedCam），GameRuntime 现有剧情接线（锁输入/相机委托/HUD 准星/
 * ESC/C 键转发）零改动复用；与 1/3 关 CinematicSystem 互不影响。
 *
 * 流程：镜头从编队上方 500m/后方 300m（camFrom 可配）出发，
 * duration（默认 15s）内 smoothstep 推进到玩家追尾视角；期间玩家不可操控，
 * 可配 dialogs 时间轴播对话；结束/ESC 跳过 → 交还操控（chase 视角）。
 */

const _off = new THREE.Vector3();
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();

const _smooth01 = (t) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };

export class BerlinOpening {
  /**
   * @param {object} opts { runtime, config(levelConfig.opening), dialogSystem, player }
   */
  constructor({ runtime, config, dialogSystem, player }) {
    this.runtime = runtime;
    this.config = config || {};
    this.dialogSystem = dialogSystem;
    this.player = player;

    this._active = false;
    this._skipping = false;
    this._time = 0;
    this._duration = this.config.duration ?? 15;
    this._camMode = 'cinematicFixed';   // 全程由本类算相机（GameRuntime 委托 computeCinematicFixedCam）
    this._dlgIdx = 0;

    // 相机路径：body frame 起始偏移（默认编队上方 500m / 后方 300m）→ 追尾偏移
    const cf = this.config.camFrom || {};
    this._startOff = new THREE.Vector3(cf.x ?? 0, cf.y ?? 500, cf.z ?? 300);
    this._endOff = new THREE.Vector3(0, 6.5, 12.5);  // start() 时用 runtime._camOffsets.chase 覆盖
    this._lookAheadStart = cf.lookAhead ?? 120;      // 起始看编队前方 120m
    this._lookAheadEnd = 8;                          // 结束对齐 chase 的 lookAt（fwd*8）

    this._skipEl = null;
    this._loaderEl = null;
  }

  get active() { return this._active && !this._skipping; }
  get camMode() { return this._camMode; }

  start() {
    this._active = true;
    this._time = 0;
    this.runtime._cinematicActive = true;
    if (this.player) this.player.ready = true;
    // 剧情模式拟真波动基准（_update 的 cinematic 分支读这两个值做 ±3m/s、±5m 波动；
    // 不记录会退化成以当前速度为基准的积分漂移，60fps 下十几秒冲上千 km/h）
    this.runtime._cinematicBaseSpeed = this.player.speed;
    this.runtime._cinematicBaseAlt = this.player.root.position.y;
    // 对齐本关追尾偏移（playerConfig.cockpit.chase 已在 GameRuntime 应用过）
    const chase = this.runtime._camOffsets && this.runtime._camOffsets.chase;
    if (chase) this._endOff.copy(chase);

    this._skipEl = document.createElement('div');
    this._skipEl.id = 'cinematic-skip';
    this._skipEl.textContent = '按 ESC 跳过剧情';
    document.body.appendChild(this._skipEl);
  }

  /** 每帧推进（GameRuntime._update 调用） */
  update(dt) {
    if (!this._active) return;
    this._time += dt;

    // 对话时间轴：dialogs: [{t, speaker, role, text, duration, avatar}]（内容后续补充）
    const dialogs = this.config.dialogs || [];
    while (this._dlgIdx < dialogs.length && this._time >= dialogs[this._dlgIdx].t) {
      const d = dialogs[this._dlgIdx];
      if (this.dialogSystem) {
        this.dialogSystem.show(d.speaker, d.text, d.duration ?? 4000, d.avatar || 'commander', d.role);
      }
      this._dlgIdx++;
    }

    if (this._time >= this._duration) this._finish();
  }

  /** 相机：编队后上方 → 玩家追尾（smoothstep 推进，随编队移动） */
  computeCinematicFixedCam(camera) {
    const player = this.player;
    if (!player || !player.root) return;
    const k = _smooth01(this._time / this._duration);
    _off.copy(this._startOff).lerp(this._endOff, k).applyQuaternion(player.root.quaternion);
    camera.position.copy(player.root.position).add(_off);
    _fwd.copy(player.getForward());
    _look.copy(player.root.position).addScaledVector(_fwd, this._lookAheadStart + (this._lookAheadEnd - this._lookAheadStart) * k);
    camera.lookAt(_look);
  }

  /** ESC 跳过：黑屏读条（仿 CinematicSystem.skip 的 #loader 模式）→ 直接到结束态 */
  skip() {
    if (!this._active || this._skipping) return;
    this._skipping = true;   // active 变 false → 立即解锁操控（与 CinematicSystem.skip 同行为）
    this._time = this._duration;          // 相机路径直接到结束位
    this.runtime._camMode = 'chase';      // 读条期间即恢复正常追尾分支（'cinematicFixed' 不在 _camOffsets）
    if (this.dialogSystem && this.dialogSystem.clear) this.dialogSystem.clear();

    this._loaderEl = document.createElement('div');
    this._loaderEl.id = 'loader';
    this._loaderEl.innerHTML = `
      <div class="title">跳过剧情</div>
      <div class="sub">SKIPPING CINEMATIC</div>
      <div class="bar"><i style="width:0%"></i></div>
      <div class="pct">0%</div>
    `;
    document.body.appendChild(this._loaderEl);
    const fill = this._loaderEl.querySelector('.bar > i');
    const pct = this._loaderEl.querySelector('.pct');
    const t0 = performance.now();
    const DUR = 1000;
    const tick = (now) => {
      if (!this._loaderEl) return;
      const p = Math.min(1, (now - t0) / DUR);
      fill.style.width = (p * 100).toFixed(0) + '%';
      pct.textContent = Math.round(p * 100) + '%';
      if (p < 1) { requestAnimationFrame(tick); return; }
      this._time = this._duration;   // 相机直接到结束位（跳过推进过程）
      this._finish();
      this._loaderEl.classList.add('hide');
      setTimeout(() => { if (this._loaderEl) { this._loaderEl.remove(); this._loaderEl = null; } }, 600);
    };
    requestAnimationFrame(tick);
  }

  /** 结束过场：交还操控（chase 视角），清理 UI */
  _finish() {
    if (!this._active) return;
    this._active = false;
    this._skipping = false;
    this.runtime._cinematicActive = false;
    this.runtime._camMode = 'chase';
    if (this._skipEl) { this._skipEl.remove(); this._skipEl = null; }
  }

  /** C 键：过场期间不切换视角（保持推镜） */
  toggleView() {}

  onMouseDown() { return false; }
  onMouseUp() { return false; }
  onMouseMove() { return false; }

  dispose() {
    this._active = false;
    if (this._skipEl) { this._skipEl.remove(); this._skipEl = null; }
    if (this._loaderEl) { this._loaderEl.remove(); this._loaderEl = null; }
  }
}
