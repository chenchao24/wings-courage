/**
 * CinematicSystem：开场剧情导演系统。
 *
 * 职责：
 *   - 按时间轴推进剧情节点，触发对白（注入 DialogSystem.show）
 *   - 控制视角指令输出（座舱自由 / 第三方自动环视 / 第三方固定看分兵）
 *   - 触发分兵演出（哈通/Adler 组 despawnNow 驶离淡出）
 *   - 检测玩家 z 坐标触发接敌（调 waveDirector.skipStartDelay）
 *   - 处理跳过（黑屏读条 -> 切 z -> 恢复操纵）
 *
 * 视角状态机（camMode getter 由 GameRuntime._updateCamera 读取）：
 *   intro(0-8s)        : 'cockpit'       座舱，玩家可右键左右看（pitch 锁 0）
 *   8s 提示后按C/15s自动: 'cinematicAuto'  第三方自动环视（以玩家为中心环绕）
 *   briefing~farewell  : 玩家可自由切 cockpit <-> cinematicAuto
 *   splitStart 后       : 'cinematicFixed' 第三方固定侧后方看分兵（不可转，可切座舱）
 *   farewell 结束后     : 恢复 cinematicAuto + 玩家自由切
 *   接敌时              : 强制 'cockpit'，解锁操纵
 *
 * 编队组（formationGroups）：由 GameRuntime 创建并注入，每组含 { id, leader, wingmen[] }
 *   - 多林组（friendlyBombers）：不驶离，全程护航
 *   - 哈通组/Adler 组：分兵时 despawnNow 驶离
 *   - Falke-2：跟随玩家，不驶离，开战后留作友军 NPC
 */
import * as THREE from 'three';

// 复用临时向量（避免每帧 new）
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

// 第三方自动环视参数（默认值；关卡可在 cinematic.camAuto 覆盖）
const CINEMATIC_AUTO = {
  radius: 25,        // 环绕半径（比追尾略远，便于看全编队）
  height: 5,         // 相机相对玩家的高度（默认5；第3关配 camAuto.height=11 抬高俯瞰）
  yawFreq: 0.12,     // 摆动频率（rad/s，仅无鼠标输入时自动摆动）
  yawAmp: 0.6,       // 自动摆动幅度（rad）
  lerpK: 6,          // 位置 lerp 平滑系数
  freeLook: true,    // 允许鼠标右键自由视野（以飞机为圆心）
  lookAhead: 0,      // lookAt 前移距离（默认0=看玩家正下方；第3关配12看前方）
};

// 第三方固定（分兵演出）视角偏移：body frame，机头=-Z
const CINEMATIC_FIXED_OFFSET = new THREE.Vector3(-18, 5, 22);

export class CinematicSystem {
  /**
   * @param {object} opts
   * @param {object} opts.runtime       GameRuntime 实例（读 player/clock/ctx）
   * @param {object} opts.config        levelConfig.cinematic
   * @param {object} opts.dialogSystem  DialogSystem 实例
   * @param {Array}  opts.formationGroups  编队组 [{id, leader, wingmen[], followPlayer?}]
   * @param {object} opts.player        玩家 Aircraft
   * @param {object} opts.waveDirector  WaveDirector 实例
   */
  constructor({ runtime, config, dialogSystem, formationGroups, player, waveDirector, friendlyBombers }) {
    this.runtime = runtime;
    this.config = config;
    this.dialogSystem = dialogSystem;
    this.formationGroups = formationGroups || [];
    this.player = player;
    this.waveDirector = waveDirector;
    this.friendlyBombers = friendlyBombers || [];  // 多林组（算 Falke-2 升高目标高度用）

    // 关卡级相机参数覆盖（cinematic.camAuto）：默认值=原行为，第3关配 camAuto 覆盖
    // 不配 → 全部走 CINEMATIC_AUTO 默认值，第1/2关行为完全不变
    const camOverride = config?.camAuto;
    this._camAuto = {
      radius:      camOverride?.radius      ?? CINEMATIC_AUTO.radius,
      height:      camOverride?.height      ?? CINEMATIC_AUTO.height,
      yawFreq:     camOverride?.yawFreq     ?? CINEMATIC_AUTO.yawFreq,
      yawAmp:      camOverride?.yawAmp      ?? CINEMATIC_AUTO.yawAmp,
      lerpK:       camOverride?.lerpK       ?? CINEMATIC_AUTO.lerpK,
      freeLook:    camOverride?.freeLook    ?? CINEMATIC_AUTO.freeLook,
      lookAhead:   camOverride?.lookAhead   ?? CINEMATIC_AUTO.lookAhead,
    };

    this._active = false;
    this._time = 0;                    // 剧情累计时间（秒）
    this._tlIdx = 0;                   // 时间轴推进索引
    this._camMode = 'cockpit';         // 'cockpit' | 'cinematicAuto' | 'cinematicFixed'
    this._phase = 'intro';             // 当前剧情阶段
    this._hintShown = false;           // 8s 提示已显示
    this._autoSwitchedAt15 = false;    // 15s 自动切第三方标志
    this._splitStarted = false;        // 分兵演出已开始
    this._splitTime = 0;               // 分兵累计时间
    this._splitStage = 0;              // 分兵阶段：0升高右靠 1晃翼 2追随加速 3渐隐 4完成
    this._hartungGrp = null;           // 哈通组引用（分兵用）
    this._adlerGrp = null;             // Adler 组引用（分兵用）
    this._dolinBaseY = 2100;           // 多林组长机基础高度（算玩家升高目标用，与 friendlyBombers.spawn.y 一致）
    this._playerTargetAlt = null;      // 玩家目标高度（分兵30s后升高用）
    this._splitCenter = new THREE.Vector3(); // 分兵编队中心（cinematicFixed 的 lookAt 目标）
    this._farewellDone = false;        // farewell 阶段对白播完
    this._intercepted = false;         // 接敌已触发
    this._skipping = false;            // 跳过流程进行中
    this._userViewToggle = false;      // 玩家手动切换视角标志（intro 阶段用于判断是否已切过）
    this._freeView = { yaw: 0, pitch: 0, dragging: false, lx: 0, ly: 0, active: 0 }; // 第三方鼠标自由视野（active=最近输入后秒数，>2s 恢复自动摆动）

    // 剧情阶段对白播放状态：{ [phase]: { idx, timer } }
    this._dialogState = {};

    // UI 元素
    this._hintEl = null;               // "按 C 切换视角" 提示
    this._skipEl = null;               // "按 ESC 跳过剧情" 提示
    this._loaderEl = null;             // 跳过读条
    this._rotateHintEl = null;         // 屏幕上方"鼠标右键可旋转视角"提示


    // 分兵演出后清理计时（despawn 后延迟释放资源）
    this._despawnCleanTimer = 0;
    this._pendingDespawnGroups = [];

    this._onKeyDown = null;
  }

  /** 剧情是否进行中 */
  get active() { return this._active && !this._skipping; }

  /** 当前视角指令（GameRuntime._updateCamera 读取） */
  get camMode() { return this._camMode; }

  /** 分兵编队中心点（cinematicFixed 视角 lookAt 用） */
  get splitCenter() { return this._splitCenter; }

  /**
   * 启动剧情：挂载 UI 提示、进入初始视角、注册按键。
   * 编队组模型加载由 GameRuntime 负责（在 start 前完成），这里只接管控制。
   */
  start() {
    this._active = true;
    this._time = 0;

    // 初始视角：默认座舱 cockpit，关卡可配 initialCam:'cinematicAuto' 第三人称出场
    const initialCam = this.config?.initialCam === 'cinematicAuto' ? 'cinematicAuto' : 'cockpit';
    this._camMode = initialCam;
    this._phase = 'intro';

    // 玩家标记 ready（供 Falke-2 的 _updateWingman 检查 leader.ready 通过）
    if (this.player) this.player.ready = true;

    // 视角 + aimLift（座舱 0.12 抬枪线，第三方 0）
    this.runtime._camMode = initialCam;
    this.player.aimLift = initialCam === 'cockpit' ? 0.12 : 0;

    // 初始即第三方时标记自动切换已完成（避免后续 _maybeAutoSwitch 重复处理）
    if (initialCam === 'cinematicAuto') {
      this._autoSwitchedAt15 = true;
      this._userViewToggle = true;
    }

    // 挂载 UI 提示
    this._mountHints();

    // 屏幕上方"鼠标右键可旋转视角"提示（关卡配置 showRotateHint 开启时显示，剧情结束隐藏）
    this._showRotateHint(!!this.config?.showRotateHint);


    // 注册按键（C 切视角由 GameRuntime._handleKey 转发 toggleView，ESC 转发 skip）
    // 这里不重复注册，由 GameRuntime 在 _handleKey 中判断 cinematic.active 后转发

    // Falke-2 绑定玩家为 leader（followPlayer 模式）
    for (const grp of this.formationGroups) {
      if (grp.followPlayer) {
        grp.leader.setLeader(this.player, grp.followOffset || new THREE.Vector3(50, 0, 60));
        // 回传僚机引用给 runtime（HUD 标记用）
        this.runtime.wingman = grp.leader;
      }
    }
  }

  /** 挂载底部提示（"按 ESC 跳过"常驻，"按 C 切换视角"按需显示） */
  _mountHints() {
    this._skipEl = document.createElement('div');
    this._skipEl.id = 'cinematic-skip';
    this._skipEl.textContent = '按 ESC 跳过剧情';
    document.body.appendChild(this._skipEl);
  }

  /** 显示/隐藏"按 C 切换视角"提示 */
  _showHint(show) {
    if (show && !this._hintEl) {
      this._hintEl = document.createElement('div');
      this._hintEl.id = 'cinematic-hint';
      this._hintEl.textContent = '按 C 切换视角';
      document.body.appendChild(this._hintEl);
    } else if (!show && this._hintEl) {
      this._hintEl.remove();
      this._hintEl = null;
    }
  }

  /** 显示/隐藏屏幕上方"鼠标右键可旋转视角"提示（剧情阶段常驻） */
  _showRotateHint(show) {
    if (show && !this._rotateHintEl) {
      this._rotateHintEl = document.createElement('div');
      this._rotateHintEl.id = 'cinematic-rotate-hint';
      this._rotateHintEl.textContent = '鼠标右键可旋转视角';
      document.body.appendChild(this._rotateHintEl);
    } else if (!show && this._rotateHintEl) {
      this._rotateHintEl.remove();
      this._rotateHintEl = null;
    }
  }


  /**
   * 主循环推进：由 GameRuntime._update 每帧调用。
   * @param {number} dt 秒
   */
  update(dt) {
    if (!this._active) return;

    this._time += dt;

    // 1. 推进时间轴节点
    this._advanceTimeline();

    // 2. 推进当前阶段对白
    this._advanceDialogs(dt);

    // 3. 分兵演出时间轴推进
    if (this._splitStarted) this._updateSplitTimeline(dt);

    // 3.5 intro 阶段自动切第三方视角（默认 15s，关卡可配 autoSwitchSec）
    this._maybeAutoSwitch();

    // 4. 检测接敌
    //    默认 triggerDir='neg'：玩家朝 -Z 飞，z 减小，z <= triggerZ 触发（Britain）
    //    triggerDir='pos'：玩家朝 +Z 飞，z 增大，z >= triggerZ 触发（Kursk 等）
    if (!this._intercepted && this.player && this.player.root) {
      const z = this.player.root.position.z;
      const tz = this.config.triggerZ;
      const reached = this.config.triggerDir === 'pos' ? (z >= tz) : (z <= tz);
      if (reached) {
        this._triggerIntercept();
      }
    }
  }

  /** 推进时间轴：触发到点的节点 */
  _advanceTimeline() {
    const tl = this.config.timeline;
    while (this._tlIdx < tl.length && this._time >= tl[this._tlIdx].t) {
      const node = tl[this._tlIdx];
      this._handleTimelineNode(node);
      this._tlIdx++;
    }
  }

  /** 处理单个时间轴节点 */
  _handleTimelineNode(node) {
    switch (node.type) {
      case 'phase':
        this._enterPhase(node.phase);
        break;
      case 'hint':
        this._hintShown = true;
        this._showHint(true);
        break;
      case 'splitStart':
        this._startSplit();
        break;
    }
  }

  /** 进入剧情阶段 */
  _enterPhase(phase) {
    this._phase = phase;
    // 初始化该阶段对白播放状态
    const dialogs = this.config.dialogs?.[phase];
    if (dialogs && dialogs.length) {
      this._dialogState[phase] = { idx: 0, timer: 0 };
    }

    // 阶段切换时的视角处理
    if (phase === 'intro') {
      // intro 阶段：座舱，等 8s 提示或玩家按键切第三方
      // 不强制改 camMode，保持 cockpit
    }
    // 15s 自动切第三方在 update 中检测（见 _maybeAutoSwitch）
  }

  /** 推进当前阶段对白（按句定时播放） */
  _advanceDialogs(dt) {
    const phase = this._phase;
    const state = this._dialogState[phase];
    if (!state) return;
    const dialogs = this.config.dialogs?.[phase];
    if (!dialogs || state.idx >= dialogs.length) {
      // 该阶段对白播完
      if (phase === 'farewell') this._farewellDone = true;
      return;
    }

    // 阶段刚进入（idx=0 且未播过）：立即播第一句
    if (state.idx === 0 && !state.playing) {
      this._playDialog(dialogs[0]);
      state.playing = true;
      state.timer = 0;
    }

    state.timer += dt * 1000; // 对白 duration 单位 ms
    // 当前句播放时长到了，播下一句
    if (state.timer >= dialogs[state.idx].duration) {
      state.idx++;
      state.timer = 0;
      if (state.idx < dialogs.length) {
        this._playDialog(dialogs[state.idx]);
      } else {
        state.playing = false; // 该阶段全部播完
      }
    }
  }

  /** 播放一条对白 */
  _playDialog(d) {
    if (this.dialogSystem) {
      this.dialogSystem.show(d.speaker, d.text, d.duration, d.avatar || 'commander', d.role);
    }
  }

  /** 玩家按 C：切换视角（座舱 <-> 第三方） */
  toggleView() {
    if (!this._active) return;
    if (this._camMode === 'cockpit') {
      this._camMode = 'cinematicAuto';
      this.player.aimLift = 0;
      this._userViewToggle = true;
      this._showHint(false); // 切走后隐藏提示
    } else if (this._camMode === 'cinematicAuto') {
      this._camMode = 'cockpit';
      this.player.aimLift = 0.12;
    } else if (this._camMode === 'cinematicFixed') {
      // 分兵固定视角时，C 切回座舱
      this._camMode = 'cockpit';
      this.player.aimLift = 0.12;
    }
    // 从座舱再按 C：如果当前是分兵阶段，回到固定视角；否则回到自动环视
    // （上面 cinematicAuto 分支已处理；这里补 cockpit -> 第三方的回切）
  }

  /** intro 阶段自动切第三方（默认 15s，关卡可配 autoSwitchSec；未手动切时触发） */
  _maybeAutoSwitch() {
    if (this._autoSwitchedAt15) return;
    const sec = this.config?.autoSwitchSec ?? 15;
    if (this._time >= sec && this._camMode === 'cockpit' && this._phase === 'intro') {
      this._camMode = 'cinematicAuto';
      this.player.aimLift = 0;
      this._showHint(false);
      this._autoSwitchedAt15 = true;
    }
  }

  /** 开始分兵演出：分走机组同时上升200+右倾偏航，加速80，80s后渐隐；不强制视角 */
  _startSplit() {
    if (this._splitStarted) return;
    this._splitStarted = true;
    this._splitTime = 0;
    this._splitStage = 0;   // 0:上升+偏航 1:渐隐 2:完成

    // 记录关键引用
    this._hartungGrp = this.formationGroups.find((g) => g.id === 'hartung');
    this._adlerGrp = this.formationGroups.find((g) => g.id === 'adler');
    const dolinLeader = this.friendlyBombers && this.friendlyBombers[0];
    this._dolinBaseY = dolinLeader ? dolinLeader.root.position.y : 2100;

    this._showHint(false);

    // 阶段 0（t=0）：哈通+Adler 同时上升 200 + 右倾偏航 + 加速 80
    // 偏航用密集的平滑弧线航点（每段小步递增 +X，避免航点切换时的生硬变向）
    const liftY = this._dolinBaseY + 200;
    for (const grp of [this._hartungGrp, this._adlerGrp]) {
      if (!grp || !grp.leader) continue;
      const c = grp.leader.root.position;
      // 平滑弧线：从起步到远离，+X 逐步递增，-Z 同步推进，共 8 段（每段 ~2500m，超过切航点阈值 250m）
      const detour = [];
      for (let i = 1; i <= 8; i++) {
        const k = i / 8;  // 0.125 -> 1.0
        detour.push({
          x: c.x + 14000 * k * k,        // +X 二次曲线递增（起步慢，后期快，自然的右倾弧）
          y: liftY,
          z: c.z - 14000 * k,            // -Z 线性推进
        });
      }
      grp.leader.setDetourRoute(detour);
      grp.leader.setTargetAltitude(liftY);
      grp.leader.setCruiseSpeed(80);
    }
  }

  /** 推进分兵演出时间轴（由 update 调用） */
  _updateSplitTimeline(dt) {
    if (!this._splitStarted || this._splitStage >= 3) return;
    this._splitTime += dt;
    const t = this._splitTime;

    // 阶段 0 -> 1（t>=120）：开始渐隐（透明度递减）
    if (this._splitStage === 0 && t >= 120) {
      this._splitStage = 1;
      this._fadeStartT = t;
    }
    // 阶段 1：逐渐透明（2s 内 opacity 0->0），透明度归零后销毁
    if (this._splitStage === 1) {
      const fadeK = Math.min(1, (t - this._fadeStartT) / 2.0);
      const opacity = 1 - fadeK;
      for (const grp of [this._hartungGrp, this._adlerGrp]) {
        if (!grp) continue;
        for (const m of [grp.leader, ...(grp.wingmen || [])].filter(Boolean)) {
          if (!m.model) continue;
          m.model.traverse((o) => {
            if (o.isMesh && o.material) {
              (Array.isArray(o.material) ? o.material : [o.material]).forEach((mat) => {
                mat.transparent = true;
                mat.opacity = opacity;
              });
            }
          });
        }
      }
      if (fadeK >= 1) {
        this._splitStage = 2;
        for (const grp of [this._hartungGrp, this._adlerGrp]) {
          if (!grp) continue;
          for (const m of [grp.leader, ...(grp.wingmen || [])].filter(Boolean)) {
            if (m.despawnNow) m.despawnNow();
          }
        }
      }
    }
    // 阶段 2 -> 3（完成）
    if (this._splitStage === 2) {
      this._splitStage = 3;
    }
  }

  /** 清理已 despawn 的编队组资源（保留方法，实际清理由 GameRuntime._update 检测 _despawnRequested 完成） */
  _cleanupDespawned() {
    this._pendingDespawnGroups = [];
  }

  /** 触发接敌：刷怪、解锁操纵、排队播放接敌对话序列 */
  _triggerIntercept() {
    if (this._intercepted) return;
    this._intercepted = true;

    // 接敌流程：雷达预警 → 敌机刷新 → 长机喊话（逐句）
    // 1. 先播雷达预警（第一句 interceptChat），5s 后刷怪 + 播后续长机指令
    const chat = this.config.dialogs?.interceptChat;
    if (chat && chat.length && this.runtime._queueDialogs) {
      // 全部入队，逐句按时长播放（雷达预警播完后队列自动推进到长机指令）
      this.runtime._queueDialogs(chat);
    }

    // 2. 延迟 5s（雷达预警播完后）刷新敌机
    //    期间玩家仍可操控（剧情已结束），但敌机尚未出现
    setTimeout(() => {
      if (this.waveDirector && this.waveDirector.skipStartDelay) {
        this.waveDirector.skipStartDelay(0);
      }
    }, 5000);

    // Falke-2 接敌后不立即散开，仍跟随玩家；待玩家首次距敌<1000m 再自由交战（由 GameRuntime 检测触发）
    this.runtime._wingmanEngagePending = true;

    // 结束剧情：切座舱、解锁操纵
    this._endCinematic();
  }

  /** 结束剧情（接敌或跳过共用）：切座舱、解锁、清理 UI */
  _endCinematic() {
    this._active = false;
    this._camMode = 'cockpit';
    this.player.aimLift = 0.12;
    this.runtime._camMode = 'cockpit';
    this.runtime._cinematicActive = false;

    // 清理 UI
    this._showHint(false);
    this._showRotateHint(false);
    if (this._skipEl) { this._skipEl.remove(); this._skipEl = null; }

  }

  /**
   * 跳过剧情：黑屏读条 -> 切 z -> 恢复操纵。
   * 一次性，直接跳过所有剩余开场。
   */
  skip() {
    if (!this._active || this._skipping) return;
    this._skipping = true;

    // 1. 显示黑屏读条（复用 Theme.js #loader CSS）
    this._loaderEl = document.createElement('div');
    this._loaderEl.id = 'loader';
    this._loaderEl.innerHTML = `
      <div class="title">跳过剧情</div>
      <div class="sub">SKIPPING CINEMATIC</div>
      <div class="bar"><i style="width:0%"></i></div>
      <div class="pct">0%</div>
    `;
    document.body.appendChild(this._loaderEl);

    // 2. 清对白
    if (this.dialogSystem && this.dialogSystem.clear) this.dialogSystem.clear();

    // 3. 假进度读条（~1.2s）
    const startT = performance.now();
    const dur = 1200;
    const fill = this._loaderEl.querySelector('.bar > i');
    const pct = this._loaderEl.querySelector('.pct');
    const tick = () => {
      const e = performance.now() - startT;
      const p = Math.min(100, (e / dur) * 100);
      fill.style.width = p + '%';
      pct.textContent = Math.floor(p) + '%';
      if (p < 100) {
        requestAnimationFrame(tick);
      } else {
        this._finishSkip();
      }
    };
    requestAnimationFrame(tick);
  }

  /** 跳过读条完成：切位置、despawn 分兵组、解锁 */
  _finishSkip() {
    // despawn 哈通/Adler 组（跳过时直接清理，不演分兵）
    const detachingIds = this.config.split?.detachingGroups || [];
    for (const grp of this.formationGroups.slice()) {
      if (detachingIds.includes(grp.id)) {
        if (grp.leader && grp.leader.despawnNow) grp.leader.despawnNow();
        for (const w of (grp.wingmen || [])) if (w.despawnNow) w.despawnNow();
        const i = this.formationGroups.indexOf(grp);
        if (i >= 0) this.formationGroups.splice(i, 1);
      }
    }

    // 移动玩家到 z=skipToZ，保持 x/y
    if (this.player && this.player.root) {
      this.player.root.position.z = this.config.skipToZ;
    }
    // Falke-2 跟随移动到玩家僚机位
    for (const grp of this.formationGroups) {
      if (grp.followPlayer && grp.leader && this.player) {
        const off = (grp.followOffset || new THREE.Vector3(50, 0, 60))
          .clone().applyQuaternion(this.player.root.quaternion).add(this.player.root.position);
        grp.leader.root.position.copy(off);
      }
    }

    // 隐藏读条
    if (this._loaderEl) {
      this._loaderEl.classList.add('hide');
      setTimeout(() => {
        if (this._loaderEl) { this._loaderEl.remove(); this._loaderEl = null; }
      }, 600);
    }

    // 触发接敌流程（与正常接敌一致：雷达预警 → 5s后刷怪 → 长机喊话）
    const chat = this.config.dialogs?.interceptChat;
    if (chat && chat.length && this.runtime._queueDialogs) {
      this.runtime._queueDialogs(chat);
    }

    // 延迟 5s 刷新敌机（雷达预警播完后）
    setTimeout(() => {
      if (this.waveDirector && this.waveDirector.skipStartDelay) {
        this.waveDirector.skipStartDelay(0);
      }
    }, 5000);

    // Falke-2 跳过剧情后同样不立即散开，待玩家首次距敌<1000m 再自由交战（由 GameRuntime 检测触发）
    this.runtime._wingmanEngagePending = true;

    // 结束剧情
    this._skipping = false;
    this._endCinematic();
  }

  /** 计算第三方自动环视相机位置（GameRuntime._updateCamera 调用） */
  computeCinematicAutoCam(dt, camera) {
    const player = this.player;
    const center = player.root.position;
    const q = player.root.quaternion;
    const ca = this._camAuto;
    // 自由视野活跃（最近 2s 有鼠标输入）时用用户 yaw/pitch，否则自动摆动
    let yaw, pitch;
    if (ca.freeLook && this._freeView.active > 0) {
      yaw = this._freeView.yaw;
      pitch = this._freeView.pitch;
      this._freeView.active -= dt;
    } else {
      const t = this.runtime.clock.elapsedTime;
      yaw = Math.sin(t * ca.yawFreq) * ca.yawAmp;
      pitch = 0;
    }
    // body frame 偏移：基础位置在玩家后方（+Z=后方，机头=-Z），yaw/pitch 绕玩家 up 轴环视
    // 应用玩家四元数 → 世界空间，保证任何飞行方向相机都在后方
    const r = ca.radius;
    const cp = Math.cos(pitch);
    _v1.set(
      Math.sin(yaw) * cp * r,
      ca.height + Math.sin(pitch) * r,
      Math.cos(yaw) * cp * r
    ).applyQuaternion(q).add(center);
    camera.position.lerp(_v1, 1 - Math.exp(-dt * ca.lerpK));
    // lookAt：lookAhead>0 时看玩家前方（俯瞰构图），=0 时看玩家正下方（原行为）
    if (ca.lookAhead > 0) {
      _v2.copy(player.getForward()).multiplyScalar(ca.lookAhead).add(center);
    } else {
      _v2.copy(center);
    }
    camera.lookAt(_v2);
  }

  /** 第三方自由视野：鼠标右键拖拽（由 GameRuntime 鼠标事件转发） */
  onMouseDown(e) {
    if (!this._camAuto.freeLook || !this._active) return false;
    if (e.button !== 2 || this._camMode !== 'cinematicAuto') return false;
    this._freeView.dragging = true;
    this._freeView.lx = e.clientX;
    this._freeView.ly = e.clientY;
    return true;
  }
  onMouseUp(e) {
    if (e.button !== 2) return false;
    this._freeView.dragging = false;
    return this._camMode === 'cinematicAuto';
  }
  onMouseMove(e) {
    if (!this._freeView.dragging) return false;
    this._freeView.yaw += (e.clientX - this._freeView.lx) * 0.005;
    this._freeView.pitch -= (e.clientY - this._freeView.ly) * 0.005;
    this._freeView.pitch = Math.max(-0.9, Math.min(0.9, this._freeView.pitch));
    this._freeView.lx = e.clientX;
    this._freeView.ly = e.clientY;
    this._freeView.active = 2.0;  // 标记自由视野活跃，2s 后恢复自动摆动
    return true;
  }

  /** 计算第三方固定（分兵）相机位置（GameRuntime._updateCamera 调用） */
  computeCinematicFixedCam(camera) {
    _v1.copy(CINEMATIC_FIXED_OFFSET).applyQuaternion(this.player.root.quaternion).add(this.player.root.position);
    camera.position.copy(_v1);
    camera.lookAt(this._splitCenter);
  }

  dispose() {
    this._active = false;
    this._showHint(false);
    this._showRotateHint(false);
    if (this._skipEl) { this._skipEl.remove(); this._skipEl = null; }
    if (this._loaderEl) { this._loaderEl.remove(); this._loaderEl = null; }

  }
}
