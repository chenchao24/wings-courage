import * as THREE from 'three';
import { Aircraft } from '../aircraft.js';
import { Enemy } from '../enemy.js';
import { Weapons } from '../weapons.js';
import { Controls } from '../controls.js';
import { Radar } from '../radar.js';
import { HudController } from './HudController.js';
import { WaveDirector } from './WaveDirector.js';
import { DialogSystem } from './DialogSystem.js';
import { Tutorial } from './Tutorial.js';
import { GroundTargets } from '../groundTargets.js';
import { FriendlyBomber } from './FriendlyBomber.js';
import { CinematicSystem } from './CinematicSystem.js';
import { LevelMusic } from './LevelMusic.js';
import { CombatAltRule } from './CombatAltRule.js';
import { JetThrottleGovernor } from './JetThrottleGovernor.js';
import { JetExhaust } from '../JetExhaust.js';
import { HeavyBomber } from './HeavyBomber.js';
import { BerlinOpening } from './BerlinOpening.js';
import { Wingman262Squadron } from './Wingman262Squadron.js';
import { P51EscortSquadron } from './P51EscortSquadron.js';
import { BerlinChatter } from './BerlinChatter.js';
import { BerlinMusic } from './BerlinMusic.js';

// 复用临时向量（避免每帧 new）
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _camOff = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _aimPt = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _upOffset = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
// 指示器用
const _camFwd = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _toE = new THREE.Vector3();
const _eiProj = new THREE.Vector3();
// 锁定警告用：敌机→玩家向量
const _toP = new THREE.Vector3();

// ---------- 相机模式 ----------
// C 键：追尾(chase) ↔ 座舱(cockpit) 二选一
// V 键：循环观察视角(OBSERVE_MODES)，纯观察无准星，可操纵飞机
const OBSERVE_MODES = ['rearLeft', 'frontRight', 'top'];
const CAM_OFFSETS = {
  // body frame 偏移（机头 = -Z）
  chase:      new THREE.Vector3(0, 3.4, 12.5),
  rearLeft:   new THREE.Vector3(-8, 3.0, 10),
  frontRight: new THREE.Vector3(7, 2.0, -10),
  top:        new THREE.Vector3(0, 16, 0.5),
};
const COCKPIT_CFG = { x: 0.00, y: 1.65, z: -0.70, lookDist: 80 }; // #22 约定
const AIM_LIFT_COCKPIT = 0.12;

/**
 * GameRuntime：关卡级游戏运行时。
 *
 * 飞行/相机/控制/指示器/准星/音效逻辑严格对齐原版 main.js（手感基线），
 * 其上叠加 P4 WaveDirector 波次导演与 HudController UI。
 *
 * 生命周期：start → _animate 循环 → stop（释放关卡资源）。
 * 共享资源（renderer/scene/camera/env/clouds/audio）由 AppShell 注入，不在 stop 中释放。
 * 关卡级资源（player/enemies/controls/radar/hud/waveDirector）在 stop 中全部释放。
 *
 * 回调接口（callbacks）：
 *   onReady()                 玩家加载完成，主循环已启动
 *   onEnemySmoking(enemy)     敌机首次冒烟（HP≤smokeThreshold）
 *   onEnemyKilled(enemy)      敌机被击落（HP 归零开始坠毁）
 *   onPlayerDead()            玩家阵亡
 *   onAllClear()              全部敌机清除（WaveDirector 触发）
 *   onStop()                  GameRuntime 已停止（AppShell 据此返回菜单）
 */
export class GameRuntime {
  constructor(ctx) {
    /** @type {{renderer,scene,camera,env,clouds,audio,settings,shell}} */
    this.ctx = ctx;
    this.player = null;
    this.controls = null;
    this.radar = null;
    this.hud = null;
    this.levelConfig = null;
    this.callbacks = {};
    this.waveDirector = null;          // P4 波次导演
    this.groundTargets = null;         // 地面目标系统（stub，供 bomber/attacker AI 读取）
    this.friendlyBombers = [];         // 友军 NPC 轰炸机编队（玩家护航目标，演出用，不走 WaveDirector）
    this.wingman = null;               // 玩家僚机（Falke-2，CinematicSystem 创建后回传，HUD 标记用）
    this._wingmanEngagePending = false; // 僚机待交战标志（接敌后置 true，玩家首次距敌<1000m 时触发 engageEnemies）
    this.cinematic = null;             // 开场剧情系统（可选，由关卡配置 cinematic.enabled 驱动）
    this._cinematicActive = false;     // 剧情模式进行中（锁操纵、视角受控）
    this._cinematicFormations = [];    // 剧情编队组 [{id, leader, wingmen[], followPlayer?, followOffset?}]

    this.clock = new THREE.Clock();
    this._disposed = false;
    this._running = false;
    this._rafId = 0;

    this._camMode = 'chase';           // 'chase' | 'cockpit' | 'observe'
    this._observeIdx = 0;              // 观察视角索引（OBSERVE_MODES）
    this._camInited = false;           // 相机首次定位标志（避免从 AppShell 背景位置 lerp 飞过来）
    // 座舱/相机参数（默认用全局常量；playerConfig.cockpit 存在时关卡级覆盖，保证关卡隔离）
    this._cockpitCfg = { ...COCKPIT_CFG };
    this._camOffsets = { ...CAM_OFFSETS };
    this._aimLiftCockpit = AIM_LIFT_COCKPIT;
    this._aimDist = 1600;
    this._playerDeadNotified = false;
    this._downedT = -1;                // 击落流程计时（仅 levelConfig.downed 关卡；-1=未触发）
    this._paused = false;              // 用户 ESC 暂停标志（区别于玩家阵亡的 _running=false）
    this._pauseOverlay = null;         // 暂停菜单 DOM
    this.dialogSystem = null;          // P5 无线电对话系统
    this.tutorial = null;              // P5 教学系统
    this._altRule = null;              // 交战高度规则（仅 combatAlt 关卡，如第4关柏林）
    this._jetExhaust = null;           // 喷气尾流特效（仅 jetNozzles 关卡，如第4关 Me 262）
    this._jetGov = null;               // 喷气油门管理器（仅 jetThrottle 关卡，如第4关 Me 262）
    this.bomberStream = [];            // B-17 轰炸机群（仅 bomberStream 关卡，如第4关柏林）
    this.wingmen262 = null;            // 友军 Me 262 僚机小队（仅 wingmen262 关卡，如第4关柏林）
    this.p51Escort = null;             // P-51 护航编队（仅 escortP51 关卡，如第4关柏林）
    this.berlinChatter = null;         // 柏林专属喊话系统（仅第4关，与全局 combatChatter/dialogs 隔离）
    this._score = 0;                   // 拦截积分
    this._victoryFired = false;        // 拦截胜利已触发标志
    this._damagedNotified = false;     // 玩家受损对话已触发标志
    this._lockWarnCd = 0;              // 后方锁定警告冷却（避免刷屏）
    this._sideCd = 0;                  // 子弹擦过音效冷却（1-3s 随机，避免刷屏）
    this._tailLocked = false;          // 当前是否被咬尾（每帧更新，无冷却，驱动 HUD 顶端提示）
    this._chatterCd = 0;               // 战斗随机喊话冷却（轰炸机开火期间触发，3-8s）
    this._chatterDisabled = false;     // 战斗随机喊话关闭标志（击落最后一架敌机后置 true）

    // 对话序列队列：逐句按时长播放（接敌对话序列 / 胜利对话序列）
    this._dialogQueue = [];            // 待播放对话列表 [{speaker,text,duration,avatar,role}]
    this._dialogQueueTimer = 0;        // 当前句剩余时长（ms），≤0 时取下一句播放
    this._victoryPending = false;      // 胜利对话播放中，队列播完后触发 callbacks.onAllClear

    // 长机离场演出状态（第2波全灭后触发，库尔斯克专属）
    this._leaderDeparting = false;     // 长机正在离场
    this._leaderDepartElapsed = 0;   // 离场累计时间（超10s强制渐隐）
    this._leaderFadeTimer = 0;         // 长机渐隐倒计时（秒，>0 时开始降透明度）

    // IL-2 首次进入标记范围已通报标志（去重，只触发一次）
    this._il2SpottedNotified = false;

    // 关卡音乐管理器（主题曲间隔循环 + 战斗高潮曲切换）
    this.levelMusic = null;
    // 柏林专属多段序列音乐（仅第4关，与 levelMusic 互斥）
    this.berlinMusic = null;

    // 音效状态（检测变化才播，避免每帧重复触发）—— 原版 main.js
    this._lastCrashed = false;
    this._lastExploded = false;

    // 座舱右键视野（驾驶员视角，仅 cockpit 模式生效）—— 原版 main.js
    this._cockpitView = { yaw: 0, pitch: 0, dragging: false, lx: 0, ly: 0 };

    this._onKeyDown = null;
    this._onResize = null;
    this._onContextMenu = null;
    this._onMouseDown = null;
    this._onMouseUp = null;
    this._onMouseMove = null;
  }

  /** 当前活跃敌机（含坠毁中未释放的）；供命中检测/雷达/指示器统一读取 */
  get enemies() {
    return this.waveDirector ? this.waveDirector.activeEnemies : [];
  }

  /**
   * 启动关卡。
   * @param {object} levelConfig 关卡配置（见 config/levels/）
   * @param {object} callbacks 回调集合
   */
  async start(levelConfig, callbacks = {}) {
    this.levelConfig = levelConfig;
    this.callbacks = callbacks;

    try {
      // 1. 挂载 HUD（返回雷达 canvas）
      this.hud = new HudController(this.ctx.shell);
      const radarCanvas = this.hud.mount(levelConfig.name);

      // 2. 输入
      this.controls = new Controls();

      // 3. 玩家飞机
      const playerModelUrl = levelConfig.playerModel || '/model/bf109_opt.glb';
      this.player = new Aircraft(this.ctx.scene, this.ctx.renderer);
      this.player.autoRespawn = false; // 关卡模式：死则结束，不自动重生
      this.player.isPlayer = true;     // 玩家标记（Weapons 据此恢复原版枪口火光参数）

      // 关卡级玩家参数覆盖（load 前注入）：
      // 第3关 Fw 190 等非默认机型通过 levelConfig.playerConfig 覆盖构造函数默认值；
      // 第1/2关无 playerConfig 字段则跳过，完全走 Bf 109 构造函数默认值，零影响。
      // 必须在 load() 前注入：userScale/centerOffset/propNodes/autoOrient 被 load 内的
      // _normalize/_autoOrient/_applyCalibration/_applyPropNodes 读取。
      const pc = levelConfig.playerConfig;
      if (pc) {
        // 校准（load 内 _normalize/_autoOrient/_applyCalibration 用）
        if (pc.autoOrient !== undefined) this.player.autoOrient = pc.autoOrient;
        if (pc.yawOffset !== undefined) this.player.yawOffset = pc.yawOffset;
        if (pc.userScale !== undefined) this.player.userScale = pc.userScale;
        if (pc.centerOffset) this.player.centerOffset = pc.centerOffset.slice();
        if (pc.propNodes) this.player._propNodes = pc.propNodes.slice();
        if (pc.hideGear !== undefined) this.player._hideGear = pc.hideGear;
        if (pc.hideGearNodes) this.player._hideGearNodes = pc.hideGearNodes.slice();
        if (pc.glassNodes) this.player._glassNodes = pc.glassNodes.slice();
        // 螺旋桨视觉覆盖（load 内 _applyPropNodes/_setupProceduralProp 用）
        if (pc.propBlurDisc !== undefined) this.player._propBlurDisc = pc.propBlurDisc;
        if (pc.propSpinSpeed !== undefined) this.player._propSpinSpeed = pc.propSpinSpeed;
        if (pc.propOpacity !== undefined) this.player._propOpacity = pc.propOpacity;
        if (pc.propBlurStrength !== undefined) this.player._propBlurStrength = pc.propBlurStrength;
        if (pc.propBlurStyle !== undefined) this.player._propBlurStyle = pc.propBlurStyle;
        // 程序化螺旋桨（模型无独立桨叶节点，桨叶几何与机身合并时使用）
        if (pc.propProcedural !== undefined) this.player._propProcedural = pc.propProcedural;
        if (pc.propHubOffset) this.player._propHubOffset = pc.propHubOffset.slice();
        if (pc.propRadius !== undefined) this.player._propRadius = pc.propRadius;
        if (pc.propBladeCount !== undefined) this.player._propBladeCount = pc.propBladeCount;
        if (pc.propBladeChord !== undefined) this.player._propBladeChord = pc.propBladeChord;
        if (pc.propBladeTwist !== undefined) this.player._propBladeTwist = pc.propBladeTwist;
        // 静态桨叶透明切割（shader discard，桨叶与机身合并的机型如 Fw 190）
        if (pc.propCut) this.player._propCut = { ...pc.propCut };
        // 座舱内部光源（隐藏玻璃后座舱内漆黑，加 PointLight 照亮仪表）
        if (pc.cockpitLight) this.player._cockpitLight = { ...pc.cockpitLight };
        // 枪口（load 内 _addMuzzleHelpers 用，兼容 Vector3 数组或 [x,y,z] 纯数组）
        if (pc.muzzleOffsets) this.player.muzzleOffsets = pc.muzzleOffsets.map((v) =>
          v.clone ? v.clone() : new THREE.Vector3(v[0], v[1], v[2]));
        // 飞行物理（load 不用，load 后生效）
        if (pc.maxSpeed !== undefined) this.player.maxSpeed = pc.maxSpeed;
        if (pc.minSpeed !== undefined) this.player.minSpeed = pc.minSpeed;
        if (pc.cruiseSpeed !== undefined) this.player.cruiseSpeed = pc.cruiseSpeed;
        if (pc.pitchMax !== undefined) this.player.pitchMax = pc.pitchMax;
        if (pc.pitchResp !== undefined) this.player.pitchResp = pc.pitchResp;
        if (pc.rollMax !== undefined) this.player.rollMax = pc.rollMax;
        if (pc.rollResp !== undefined) this.player.rollResp = pc.rollResp;
        if (pc.yawMax !== undefined) this.player.yawMax = pc.yawMax;
        if (pc.yawResp !== undefined) this.player.yawResp = pc.yawResp;
        if (pc.gravity !== undefined) this.player.gravity = pc.gravity;
        if (pc.liftK !== undefined) this.player.liftK = pc.liftK;
        if (pc.diveAccel !== undefined) this.player.diveAccel = pc.diveAccel;
        if (pc.stallThreshold !== undefined) this.player.stallThreshold = pc.stallThreshold;
        // 翼尖拉烟高度窗覆盖（高空关卡如柏林：默认 600-4500m 不覆盖，高空关调高上限）
        if (pc.vaporAltMin !== undefined) this.player._vaporAltMin = pc.vaporAltMin;
        if (pc.vaporAltMax !== undefined) this.player._vaporAltMax = pc.vaporAltMax;
        // 座舱/相机参数（关卡级覆盖，默认走全局常量；FW 190 等机型座舱位置与 Bf 109 不同时用）
        if (pc.cockpit) {
          const ck = pc.cockpit;
          if (ck.x !== undefined) this._cockpitCfg.x = ck.x;
          if (ck.y !== undefined) this._cockpitCfg.y = ck.y;
          if (ck.z !== undefined) this._cockpitCfg.z = ck.z;
          if (ck.lookDist !== undefined) this._cockpitCfg.lookDist = ck.lookDist;
          if (ck.aimLift !== undefined) this._aimLiftCockpit = ck.aimLift;
          if (ck.aimDist !== undefined) this._aimDist = ck.aimDist;
          if (ck.chase) {
            if (ck.chase.x !== undefined) this._camOffsets.chase.x = ck.chase.x;
            if (ck.chase.y !== undefined) this._camOffsets.chase.y = ck.chase.y;
            if (ck.chase.z !== undefined) this._camOffsets.chase.z = ck.chase.z;
          }
        }
      }

      this.player.setTerrain(this.ctx.env.terrain);
      this.player.setObstacles(this.ctx.env.obstacles);
      await this.player.load(playerModelUrl);
      this.player.reset();
      // 关卡级玩家初始位置/朝向/速度覆盖（如 Britain 玩家在海上靠近海岸）
      const ps = levelConfig.playerStart;
      if (ps) {
        if (ps.position) {
          const [px, py, pz] = ps.position;
          this.player.root.position.set(px, py != null ? py : 700, pz);
        }
        if (ps.yaw != null) {
          this.player.root.quaternion.setFromAxisAngle(_up, ps.yaw);
        }
        // 初始速度覆盖（如护航编队需要与轰炸机同步速度）
        if (ps.speed != null) {
          this.player.speed = ps.speed;
        }
      }
      this.player.aimLift = 0; // 默认追尾，aimLift=0（切到座舱时设 0.12）

      // 4. 雷达：注入飞机与数据源 getter（保持模块解耦）
      this.radar = new Radar(radarCanvas, {
        aircraft: this.player,
        getEnemies: () => this._getRadarEnemies(),
      });

      // 5. 玩家武器（Aircraft 基类不自带武器，需外部创建）
      this.player.weapons = new Weapons(this.ctx.scene, this.player, this.ctx.camera);
      this.player.weapons.setAudio(this.ctx.audio);
      // 武器组配置（关卡级，与飞机绑定；FW190 用 MG17+MG151/20 不同射速/初速/伤害）
      // 注意：pc 可能为 undefined（第1/2关无 playerConfig），需先判断 pc 存在
      // 优先走新接口 setWeaponGroups；旧 heavyMuzzles 配置保留兼容（第1/2关若用旧配置仍生效）
      if (pc && pc.weapons && pc.weapons.groups) {
        this.player.weapons.setWeaponGroups(pc.weapons.groups);
      } else if (pc && pc.heavyMuzzles) {
        this.player.weapons.setHeavyMuzzles(pc.heavyMuzzles.indices, pc.heavyMuzzles.scale);
      }

      // 5.1 喷气尾流特效（仅配置 jetNozzles 的喷气机关卡，如第4关 Me 262；前三关无此字段）
      if (pc && pc.jetNozzles && pc.jetNozzles.length) {
        this._jetExhaust = new JetExhaust(this.ctx.scene, this.player, pc.jetNozzles, { camera: this.ctx.camera });
      }
      // 5.2 引擎音类型（仅配置 engineSound 的关卡；缺省活塞引擎，前三关不变）
      if (pc && pc.engineSound === 'jet') {
        this.ctx.audio.setEngineType('jet');
      }
      // 5.2.1 文件引擎音（仅配置 engineSoundFile 的关卡：bf109/fw190/me262 实录循环，优先级最高）
      if (pc && pc.engineSoundFile) {
        this.ctx.audio.setEngineSoundFile(pc.engineSoundFile);
      }
      // 5.3 喷气油门管理器（仅配置 jetThrottle 的关卡；峰值功率限制/冷却逻辑）
      if (pc && pc.jetThrottle) {
        this._jetGov = new JetThrottleGovernor(this.player, pc.jetThrottle);
      }

      // 6. 对话系统（P5：在波次导演之前创建，供回调使用）
      this.dialogSystem = new DialogSystem(this.hud.el.querySelector('#dialog-system'), this.ctx.audio);

      // 6.1 柏林专属喊话系统（仅第 4 关；与全局 combatChatter/dialogs 隔离，文案待填）
      if (levelConfig.id === 'berlin') {
        this.berlinChatter = new BerlinChatter({
          dialogSystem: this.dialogSystem,
          config: levelConfig.berlinChatter,
          runtime: this,
        });
      }

      // 7. 波次导演（P4：按关卡 waves 配置刷有限波次）
      this.groundTargets = new GroundTargets(this.ctx.scene, this.ctx.env.terrain);
      await this._initWaveDirector(levelConfig);

      // 7.5 友军 NPC 轰炸机编队（玩家护航目标，演出用，独立于 WaveDirector）
      if (levelConfig.friendlyBombers) {
        await this._initFriendlyBombers(levelConfig.friendlyBombers);
      }

      // 7.55 开场剧情系统（可选）：创建剧情编队组 + 启动剧情，剧情模式用大 startDelay 由剧情位置触发接敌
      if (levelConfig.cinematic?.enabled) {
        await this._initCinematic(levelConfig);
      }

      // 7.6 注入轰炸机/敌机互引（护航模式：敌机优先攻击轰炸机，轰炸机自卫还击）
      // 延迟到 WaveDirector 刷怪后执行：在 _onWaveSpawned 回调中注入
      this._needsBomberInjection = !!levelConfig.friendlyBombers;

      // 8. 教学系统（P5：全屏覆盖，关闭后 3s 开始首波）
      this._initTutorial(levelConfig);

      // 8.5 关卡级射击音效文件（仅配置了 fireSounds 的关卡启用，如 FW190）
      // stop 时 clearFireSamples 清空，其他关卡走默认合成机枪声
      this.ctx.audio.loadGlobalSfx(); // 全局音效（玩家被命中 + 擦过，所有关卡共用，仅加载一次）
      if (Array.isArray(levelConfig.fireSounds) && levelConfig.fireSounds.length > 0) {
        const audio = this.ctx.audio;
        for (const url of levelConfig.fireSounds) audio.loadFireSound(url);
      }
      // 8.55 武器组级射击音效（按组区分，按住键循环播放去尾段，松开键补完整收尾）
      if (pc && pc.weapons && pc.weapons.groups) {
        const audio = this.ctx.audio;
        for (const groupName in pc.weapons.groups) {
          const g = pc.weapons.groups[groupName];
          if (g.sound) audio.loadGroupFireSound(groupName, g.sound);
        }
      }

      // 8.6 关卡音乐系统（主题曲间隔循环 + 战斗高潮曲切换）
      if (levelConfig.levelMusic) {
        this.levelMusic = new LevelMusic(this.ctx.audio);
        this.levelMusic.start(levelConfig.levelMusic);
      }
      // 8.65 柏林专属多段序列音乐（仅第4关配置 berlinMusic 时启用，与 levelMusic 互斥）
      if (levelConfig.berlinMusic) {
        this.berlinMusic = new BerlinMusic(this.ctx.audio);
        this.berlinMusic.start(levelConfig.berlinMusic);
      }

      // 9. 事件
      this._wireEvents();

      // 9.5 交战高度规则（仅配置 combatAlt 的关卡启用，如第4关柏林；前三关无此字段，不创建）
      if (levelConfig.combatAlt) {
        this._altRule = new CombatAltRule(this, levelConfig.combatAlt);
      }

      // 9.6 友军 Me 262 僚机小队（仅配置 wingmen262 的关卡，如第4关；AI 完全独立隔离）
      if (levelConfig.wingmen262) {
        this.wingmen262 = new Wingman262Squadron(this, levelConfig.wingmen262);
        await this.wingmen262.init();
      }

      // 9.65 P-51 护航编队（仅配置 escortP51 的关卡，如第4关；AI 完全独立隔离）
      //   须在 bomberStream 之后创建（出生槽位锚定编队质心）
      if (levelConfig.escortP51) {
        this.p51Escort = new P51EscortSquadron(this, levelConfig.escortP51);
        await this.p51Escort.init();
      }

      // 9.7 柏林开场过场（仅配置 opening 的关卡；鸭式复用 CinematicSystem 接线，1/3 关不受影响）
      if (levelConfig.opening?.enabled) {
        this.cinematic = new BerlinOpening({
          runtime: this, config: levelConfig.opening,
          dialogSystem: this.dialogSystem, player: this.player,
        });
        this.cinematic.start();
        this._cinematicActive = true;
      }

      // 10. 启动主循环
      this._running = true;
      this.ctx.shell.setGameRunning(true);
      this.clock.start();
      this._animate();

      // 开场对话（剧情模式由 CinematicSystem 接管，跳过原 onStart）
      if (!this.cinematic && levelConfig.dialogs?.onStart) {
        const d = levelConfig.dialogs.onStart;
        this.dialogSystem.show(d.speaker, d.text, 8000, d.avatar || 'commander', d.role);
      }

      // 调试接口
      window.__aircraft = this.player;
      window.__debug = {
        clouds: this.ctx.clouds,
        camera: this.ctx.camera,
        renderer: this.ctx.renderer,
        env: this.ctx.env,
        enemies: this.enemies,
        waveDirector: this.waveDirector,
        runtime: this,
      };

      if (this.callbacks.onReady) this.callbacks.onReady();
    } catch (err) {
      console.error('[GameRuntime] start 失败:', err);
      this.stop();
      throw err;
    }
  }

  /** P4 初始化 WaveDirector 并启动波次序列（async：内含 B-17 机群 await 加载） */
  async _initWaveDirector(levelConfig) {
    const dialogs = levelConfig.dialogs || {};
    // 有教学时设大 startDelay，等教学关闭后 skipStartDelay 接管
    const hasTutorial = levelConfig.tutorial && levelConfig.tutorial.length > 0;
    this.waveDirector = new WaveDirector(
      { scene: this.ctx.scene, renderer: this.ctx.renderer, env: this.ctx.env, player: this.player, groundTargets: this.groundTargets },
      {
        onWaveStart: (idx) => {
          this._syncWaveHud();
          if (this.dialogSystem && dialogs.onWaveStart?.[idx]) {
            const d = dialogs.onWaveStart[idx];
            // 支持数组：多句入队逐条播放；单条：直接 show（向后兼容）
            if (Array.isArray(d)) {
              this._queueDialogs(d);
            } else {
              this.dialogSystem.show(d.speaker, d.text, 7000, d.avatar || 'commander', d.role);
            }
          }
        },
        onWaveSpawned: () => {
          this._syncWaveHud();
          // 注入轰炸机/敌机互引（护航模式：敌机可攻击轰炸机，轰炸机可自卫还击）
          if (this._needsBomberInjection) {
            this._injectBomberTargets();
          }
        },
        onWaveCleared: (idx) => {
          // 波次全灭后的剧情窗口对白（嵌套数组入队逐条播放）
          const cleared = dialogs.onWaveCleared?.[idx];
          if (cleared && this.dialogSystem) {
            this._queueDialogs(cleared);
          }
          // 第2波全灭：核心转折——长机负伤离场演出
          if (idx === 1) {
            this._startLeaderDeparture();
            // 拉长 clearing 窗口给演出腾时间（对白约37s + 长机飞远 + 余量）
            if (this.waveDirector) this.waveDirector._timer = 42;
          }
        },
        onAllClear: () => {
          // 沙盒关卡（sandbox:true，如第4关地图调试期）：不触发胜利结算
          if (this.levelConfig && this.levelConfig.sandbox) return;
          // 关闭战斗随机喊话
          this._chatterDisabled = true;
          // 排队播放胜利对话，播完后由 _updateDialogQueue 触发 callbacks.onAllClear（任务胜利界面）
          const victoryChat = dialogs.victoryChat;
          if (victoryChat && victoryChat.length && this.dialogSystem) {
            this._victoryPending = true;
            this._queueDialogs(victoryChat);
          } else {
            // 无胜利对话配置，直接触发任务胜利
            if (this.callbacks.onAllClear) this.callbacks.onAllClear();
          }
        },
        onEnemySmoking: (en) => { if (this.callbacks.onEnemySmoking) this.callbacks.onEnemySmoking(en); },
        onEnemyKilled: (en) => {
          if (this.callbacks.onEnemyKilled) this.callbacks.onEnemyKilled(en);
          // 最后一架击落时关闭随机喊话、跳过随机击落台词（紧接胜利对话）
          if (this.waveDirector.killed >= this.waveDirector.target) {
            this._chatterDisabled = true;
            return;
          }
          if (this.dialogSystem) {
            // 第3波 IL-2：按击落序号取台词（地面指挥按序推进紧张感）
            const wave3Lines = dialogs.onEnemyKilledWave3;
            const isWave3 = this.waveDirector.currentWaveIdx === 2 && wave3Lines;
            if (isWave3) {
              // _il2Killed 在 notifyKilled 里已 ++，第1架击落时=1，取 idx=0
              const idx = Math.min(this.waveDirector._il2Killed - 1, wave3Lines.length - 1);
              if (idx >= 0 && idx < wave3Lines.length) {
                const d = wave3Lines[idx];
                this.dialogSystem.show(d.speaker, d.text, 5000, d.avatar || 'tower', d.role);
              }
            } else if (dialogs.onEnemyKilled) {
              // 第1/2波：随机抽一条
              const arr = dialogs.onEnemyKilled;
              const d = arr[Math.floor(Math.random() * arr.length)];
              this.dialogSystem.show(d.speaker, d.text, 5000, d.avatar || 'radio', d.role);
            }
          }
        },
        disposeEnemy: (en) => this._disposeAircraft(en),
      },
    );
    this.waveDirector.start(
      levelConfig.waves || [],
      {
        startDelay: hasTutorial ? 99999 : (levelConfig.waveStartDelay || 0),
        delayAfterWave: levelConfig.delayAfterWave != null ? levelConfig.delayAfterWave : 1.5,
      },
      levelConfig.enemyModel,
    );

    // B-17 轰炸机群（仅 bomberStream 关卡，如第4关柏林；不走 WaveDirector）
    if (levelConfig.bomberStream) {
      await this._initBomberStream(levelConfig.bomberStream);
    }
  }

  /**
   * 创建 B-17 轰炸机群：按 formation 槽位逐架 spawn（HeavyBomber，直接 spawn 先例同 friendlyBombers）。
   * 命中积分经 onEvent 回流到 _onBomberEvent。
   */
  async _initBomberStream(cfg) {
    const slots = [];
    for (const vic of cfg.formation.vics) {
      slots.push({ x: vic.x, y: vic.alt, z: vic.lat });                                                    // 长机
      slots.push({ x: vic.x + cfg.formation.trailOffset, y: vic.alt - 15, z: vic.lat - cfg.formation.wingSpacing });  // 左僚
      slots.push({ x: vic.x + cfg.formation.trailOffset, y: vic.alt - 15, z: vic.lat + cfg.formation.wingSpacing });  // 右僚
    }
    for (const slot of slots) {
      const b = new HeavyBomber(this.ctx.scene, this.ctx.renderer, this.player, {
        slot,
        speed: cfg.speed,
        hp: cfg.hp,
        damageThreshold: cfg.damageThreshold,
        rtbChance: cfg.rtbChance,
        hitSpheres: cfg.hitSpheres,
        engines: cfg.engines,
        turrets: cfg.turrets,
        route: cfg.route,
        despawnX: cfg.despawnX,
        onEvent: (type, bb) => this._onBomberEvent(type, bb),
      });
      b._route = cfg.route; // Enemy.reset 初始定位用
      // 枪口/炮塔方向必须在 load 前设置（muzzleHelpers 在 load 时按 muzzleOffsets 创建）
      b.muzzleOffsets = cfg.muzzles.map((m) => new THREE.Vector3(...m.pos));
      b.muzzleDirs = cfg.muzzles.map(() => new THREE.Vector3(0, 0, 1)); // 初始朝后，运行时由瞄准改写
      await b.load(cfg.model);
      // 炮塔分组（load 后设置 weapons）
      b.weapons.setEnemyMuzzleGroups(cfg.turrets.map((t) => ({
        name: t.name, indices: t.muzzles, fireRate: t.fireRate ?? 0.13,
      })));
      b.weapons.bulletSpeed = cfg.bulletSpeed ?? 650;
      b.weapons.life = 2.5;
      b.weapons.damageMin = cfg.turretDamage ? cfg.turretDamage[0] : 2;
      b.weapons.damageMax = cfg.turretDamage ? cfg.turretDamage[1] : 4;
      b.placeAtStart();
      this.bomberStream.push(b);
    }
  }

  /** 轰炸机事件回流：击落/击伤积分；达到 target 直接触发胜利（不受 sandbox 门控） */
  _onBomberEvent(type, b) {
    const tbl = this.levelConfig.intercept;
    if (!tbl) return;
    // 击落：未击伤过的 +b17Kill；已击伤过的（拿过一次击伤分）只再 +b17KillAfterDamaged
    if (type === 'killed') {
      this._score += b.damaged ? (tbl.b17KillAfterDamaged ?? tbl.b17Kill) : tbl.b17Kill;
      if (this.berlinChatter) this.berlinChatter.onB17Killed();
    } else if (type === 'damaged') {
      this._score += tbl.b17Damaged;
      if (this.berlinChatter) this.berlinChatter.onB17Damaged();
    } else return;
    if (this._score >= tbl.target && !this._victoryFired) {
      this._victoryFired = true;
      if (this.callbacks.onAllClear) this.callbacks.onAllClear();
    }
  }

  /** P-51 护航事件回流：击落 +p51Kill / 首次击伤 +p51Damaged（仅 escortP51 关卡） */
  _onP51Event(type, p) {
    const tbl = this.levelConfig && this.levelConfig.intercept;
    if (!tbl) return;
    if (type === 'killed') {
      this._score += tbl.p51Kill ?? 0;
      if (this.berlinChatter) this.berlinChatter.onP51Killed();
    } else if (type === 'damaged') {
      this._score += tbl.p51Damaged ?? 0;
      if (this.berlinChatter) this.berlinChatter.onP51Damaged();
    } else return;
    if (this._score >= tbl.target && !this._victoryFired) {
      this._victoryFired = true;
      if (this.callbacks.onAllClear) this.callbacks.onAllClear();
    }
  }

  /**
   * 初始化友军 NPC 轰炸机编队（玩家护航目标，演出用）。
   * - 完全独立于 Enemy 的 AI/物理/武器系统，使用 FriendlyBomber 脚本化平飞
   * - V 字三角形编队：长机居中前按航线直飞，左右僚机跟随保持偏移
   * - 到达航线终点自动脱离消失（_despawnRequested）
   * - 不被玩家子弹命中（命中检测跳过 friendlyBombers）
   * 关卡隔离：每关独立创建，stop() 释放全部资源，无跨关状态
   */
  async _initFriendlyBombers(cfg) {
    const { model, spacing = 130, trailOffset = 70, spawn, route } = cfg;
    if (!model || !spawn || !route || !route.length) return;

    // 三机 V 字编队偏移（body frame: 长机原点，左僚机 -spacing/后撤，右僚机 +spacing/后撤）
    const offsets = [
      new THREE.Vector3(0, 0, 0),                    // 长机
      new THREE.Vector3(-spacing, 0, trailOffset),  // 左僚机
      new THREE.Vector3(spacing, 0, trailOffset),    // 右僚机
    ];

    // 长机：按航线直飞（FriendlyBomber._updateLeader）
    const leader = await this._createFriendlyBomber(model, route);
    this.friendlyBombers.push(leader);

    // 僚机：不设航线，通过 setLeader 跟随长机保持 V 字偏移
    for (let i = 1; i < offsets.length; i++) {
      const wing = await this._createFriendlyBomber(model, null);
      wing.setLeader(leader, offsets[i]);
      // 初始位置：长机位置 + 长机朝向 × body frame 偏移
      const off = offsets[i].clone().applyQuaternion(leader.root.quaternion);
      wing.root.position.copy(leader.root.position).add(off);
      wing.root.quaternion.copy(leader.root.quaternion);
      this.friendlyBombers.push(wing);
    }
  }

  async _createFriendlyBomber(modelUrl, route) {
    const fb = new FriendlyBomber(this.ctx.scene, this.ctx.renderer);
    fb.isFriendly = true;                 // 友军标记（命中检测/雷达据此区分）
    if (route) fb.setRoute(route);
    await fb.load(modelUrl);
    return fb;
  }

  /**
   * 初始化开场剧情系统。
   * - 按 levelConfig.cinematicFormations 创建剧情编队组（哈通/Adler/Falke-2）
   * - 创建 CinematicSystem 并启动
   * - 剧情模式：WaveDirector 用大 startDelay，由剧情系统在玩家飞到 triggerZ 时调 skipStartDelay(0) 触发接敌
   * 编队组结构：{ id, leader, wingmen[], followPlayer?, followOffset? }
   */
  async _initCinematic(levelConfig) {
    const cfg = levelConfig.cinematic;
    const formationsCfg = levelConfig.cinematicFormations || [];

    // 创建剧情编队组
    for (const fc of formationsCfg) {
      const grp = { id: fc.id, leader: null, wingmen: [], followPlayer: !!fc.followPlayer, followOffset: fc.followOffset ? new THREE.Vector3(fc.followOffset.x, fc.followOffset.y, fc.followOffset.z) : null };

      if (fc.formation === 'single') {
        // 单机（如 Falke-2、库尔斯克玩家长机）
        const fb = new FriendlyBomber(this.ctx.scene, this.ctx.renderer);
        fb.isFriendly = true;
        // 关卡级模型校准注入（load 前注入；库尔斯克长机用 FW-190 需要玩家级校准参数）
        if (fc.modelConfig === 'playerConfig' && this.levelConfig.playerConfig) {
          this._injectPlayerConfigToBomber(fb, this.levelConfig.playerConfig);
        }
        await fb.load(fc.model);
        fb.root.position.set(fc.spawn.x, fc.spawn.y, fc.spawn.z);
        // 朝向：配置级 yaw（默认 0 朝 -Z；库尔斯克玩家朝 +Z 时配 yaw=π）
        fb.root.quaternion.setFromAxisAngle(_up, fc.yaw || 0);
        grp.leader = fb;
        this._cinematicFormations.push(grp);
      } else {
        // V 字 / pair / four 编队
        const spacing = fc.spacing || 105;
        const trailOffset = fc.trailOffset || 60;
        // 编队偏移（body frame：机头=-Z，+z=后方，+x=右）
        // pair: 长机+右僚机 | v: 长机+左右僚机 | four: 长机+左右僚机+尾机
        let offsets;
        if (fc.formation === 'pair') {
          offsets = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(spacing, 0, trailOffset)];
        } else if (fc.formation === 'four') {
          // 4 机 Schwarm：长机 + 左僚机 + 右僚机 + 尾机（V 字扩展）
          offsets = [
            new THREE.Vector3(0, 0, 0),                        // 长机
            new THREE.Vector3(-spacing, 0, trailOffset),        // 左僚机
            new THREE.Vector3(spacing, 0, trailOffset),         // 右僚机
            new THREE.Vector3(0, 0, trailOffset * 2),           // 尾机（左+右后方中间）
          ];
        } else {
          // 默认 V 字三机（britain 等不传 formation='four' 时走此分支，行为不变）
          offsets = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-spacing, 0, trailOffset), new THREE.Vector3(spacing, 0, trailOffset)];
        }

        // 长机航线：优先用配置级 route（库尔斯克斯图卡交汇用），
        //          无 route 时自动生成 spawn→z=-24000（britain 等原有行为不变）
        const route = fc.route || [
          { x: fc.spawn.x, y: fc.spawn.y, z: fc.spawn.z },
          { x: fc.spawn.x, y: fc.spawn.y, z: -24000 },
        ];
        const leader = await this._createFriendlyBomber(fc.model, route);
        // 巡航速度：配置级覆盖（默认 45，FriendlyBomber 构造函数值）
        if (fc.cruiseSpeed) leader.setCruiseSpeed(fc.cruiseSpeed);
        leader.root.position.set(fc.spawn.x, fc.spawn.y, fc.spawn.z);
        leader._initPosition();
        grp.leader = leader;

        // 僚机：跟随长机
        const smokingSet = new Set(fc.smokingIndices || []);
        for (let i = 1; i < offsets.length; i++) {
          const wing = await this._createFriendlyBomber(fc.model, null);
          wing.setLeader(leader, offsets[i]);
          const off = offsets[i].clone().applyQuaternion(leader.root.quaternion);
          wing.root.position.copy(leader.root.position).add(off);
          wing.root.quaternion.copy(leader.root.quaternion);
          // 冒烟僚机（对地攻击受损返航）：设 smokeThreshold=hp 触发轻度冒烟
          if (smokingSet.has(i)) wing.smokeThreshold = wing.hp;
          grp.wingmen.push(wing);
        }
        this._cinematicFormations.push(grp);
      }
    }

    // 创建 CinematicSystem 并启动
    this.cinematic = new CinematicSystem({
      runtime: this,
      config: cfg,
      dialogSystem: this.dialogSystem,
      formationGroups: this._cinematicFormations,
      player: this.player,
      waveDirector: this.waveDirector,
      friendlyBombers: this.friendlyBombers,
    });
    this.cinematic.start();
    this._cinematicActive = true;

    // 记录玩家基础速度/高度（剧情模式拟真波动基准）
    this._cinematicBaseSpeed = this.player.speed;
    this._cinematicBaseAlt = this.player.root.position.y;

    // 剧情模式：WaveDirector 用大 startDelay，由剧情系统位置触发 skipStartDelay(0)
    // 覆盖 _initWaveDirector 里设置的 startDelay（hasTutorial ? 99999 : waveStartDelay）
    if (this.waveDirector) {
      this.waveDirector._timer = 99999;
    }
  }

  /**
   * 将关卡 playerConfig 的校准参数注入 FriendlyBomber（load 前调用）。
   * 用于剧情长机使用与玩家相同机型时（如库尔斯克长机 FW-190），
   * 保证朝向/缩放/起落架隐藏/程序化螺旋桨等与玩家一致。
   * 关卡隔离：仅注入 load 前需要的校准字段，不注入飞行物理/座舱/枪口等。
   */
  _injectPlayerConfigToBomber(fb, pc) {
    if (pc.autoOrient !== undefined) fb.autoOrient = pc.autoOrient;
    if (pc.yawOffset !== undefined) fb.yawOffset = pc.yawOffset;
    if (pc.userScale !== undefined) fb.userScale = pc.userScale;
    if (pc.centerOffset) fb.centerOffset = pc.centerOffset.slice();
    if (pc.propNodes) fb._propNodes = pc.propNodes.slice();
    if (pc.hideGear !== undefined) fb._hideGear = pc.hideGear;
    if (pc.hideGearNodes) fb._hideGearNodes = pc.hideGearNodes.slice();
    if (pc.glassNodes) fb._glassNodes = pc.glassNodes.slice();
    if (pc.propBlurDisc !== undefined) fb._propBlurDisc = pc.propBlurDisc;
    if (pc.propSpinSpeed !== undefined) fb._propSpinSpeed = pc.propSpinSpeed;
    if (pc.propOpacity !== undefined) fb._propOpacity = pc.propOpacity;
    if (pc.propBlurStrength !== undefined) fb._propBlurStrength = pc.propBlurStrength;
    if (pc.propBlurStyle !== undefined) fb._propBlurStyle = pc.propBlurStyle;
    if (pc.propProcedural !== undefined) fb._propProcedural = pc.propProcedural;
    if (pc.propHubOffset) fb._propHubOffset = pc.propHubOffset.slice();
    if (pc.propRadius !== undefined) fb._propRadius = pc.propRadius;
    if (pc.propBladeCount !== undefined) fb._propBladeCount = pc.propBladeCount;
    if (pc.propBladeChord !== undefined) fb._propBladeChord = pc.propBladeChord;
    if (pc.propBladeTwist !== undefined) fb._propBladeTwist = pc.propBladeTwist;
    if (pc.propCut) fb._propCut = { ...pc.propCut };
    if (pc.cockpitLight) fb._cockpitLight = { ...pc.cockpitLight };
  }

  /**
   * 注入轰炸机/敌机互引（护航模式专用）。
   * - 敌机注入 setBomberTargets：敌机可进入 attackBomber 状态优先攻击轰炸机
   * - 友军轰炸机注入 setEnemyTargets：轰炸机自卫炮塔可扫描敌机还击（表演性质）
   * 在 WaveDirector 刷怪完成后调用（敌机和轰炸机都已就位）。
   */
  _injectBomberTargets() {
    if (!this.friendlyBombers.length) return;
    // 敌机注入轰炸机列表 + 分配攻击方向槽位
    // 加权随机：top（上方俯冲）概率更高，符合喷火从高处俯冲攻击轰炸机的战术
    const ATTACK_SLOTS = ['top', 'top', 'top', 'front', 'left', 'right']; // top 占 3/6=50%
    for (const en of this.enemies) {
      if (en.setBomberTargets) en.setBomberTargets(this.friendlyBombers);
      en._attackSlot = ATTACK_SLOTS[Math.floor(Math.random() * ATTACK_SLOTS.length)];
      en._attackPhase = 'approach';  // approach -> strike -> egress -> reposition
    }
    // 轰炸机注入敌机列表
    for (const fb of this.friendlyBombers) {
      if (fb.setEnemyTargets) fb.setEnemyTargets(this.enemies);
    }
  }

  /** P5 初始化教学系统 */
  _initTutorial(levelConfig) {
    if (!levelConfig.tutorial || levelConfig.tutorial.length === 0) return;
    this.tutorial = new Tutorial(document.body, levelConfig.tutorial, () => {
      this.tutorial = null;
      // 教学关闭后 3s 开始首波
      if (this.waveDirector) this.waveDirector.skipStartDelay(3);
    });
    this.tutorial.start();
  }

  _syncWaveHud() {
    if (!this.waveDirector || !this.hud) return;
    const ws = this.waveDirector.getState();
    this.hud.setWave(Math.max(1, ws.currentWave), ws.totalWaves, ws.killed, ws.target);
  }

  _getRadarEnemies() {
    const list = this.enemies
      .filter((e) => e.model && e.model.visible)
      .map((e) => ({ pos: e.root.position, il2: !!e._il2State }));
    // P-51 护航编队上雷达（仅 escortP51 关卡；红色敌机点）
    if (this.p51Escort) {
      for (const p of this.p51Escort.planes) {
        if (p.ready && p.root && !p._exploded && p.model && p.model.visible) {
          list.push({ pos: p.root.position, il2: false });
        }
      }
    }
    return list;
  }

  _wireEvents() {
    this._onKeyDown = (e) => this._handleKey(e);
    window.addEventListener('keydown', this._onKeyDown);
    this._onResize = () => this._onResizeFn();
    window.addEventListener('resize', this._onResize);

    // 座舱左键视野拖拽（原版为右键，用户反馈右键触发浏览器事件；左键与开火/交互无冲突）+ 剧情第三方自由视野
    this._onContextMenu = (e) => e.preventDefault();
    this._onMouseDown = (e) => {
      // 剧情模式第三方自由视野优先（由 CinematicSystem 处理）
      if (this._cinematicActive && this.cinematic && this.cinematic.active) {
        if (this.cinematic.onMouseDown(e)) return;
      }
      // 只在 3D 画布上空按左键才进入拖拽（避免点 HUD 按钮/面板时也转视角）
      if (e.button === 0 && this._camMode === 'cockpit' && e.target.tagName === 'CANVAS') {
        this._cockpitView.dragging = true;
        this._cockpitView.lx = e.clientX;
        this._cockpitView.ly = e.clientY;
        e.preventDefault();
      }
    };
    this._onMouseUp = (e) => {
      if (this._cinematicActive && this.cinematic && this.cinematic.active) {
        if (this.cinematic.onMouseUp(e)) return;
      }
      if (e.button === 0) this._cockpitView.dragging = false;
    };
    this._onMouseMove = (e) => {
      if (this._cinematicActive && this.cinematic && this.cinematic.active) {
        if (this.cinematic.onMouseMove(e)) return;
      }
      if (!this._cockpitView.dragging) return;
      this._cockpitView.yaw += (e.clientX - this._cockpitView.lx) * 0.004;
      this._cockpitView.pitch -= (e.clientY - this._cockpitView.ly) * 0.004;
      this._cockpitView.pitch = Math.max(-0.8, Math.min(0.8, this._cockpitView.pitch));
      this._cockpitView.lx = e.clientX;
      this._cockpitView.ly = e.clientY;
    };
    window.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
  }

  _onResizeFn() {
    const c = this.ctx.camera;
    c.aspect = innerWidth / innerHeight;
    c.updateProjectionMatrix();
    this.ctx.renderer.setSize(innerWidth, innerHeight);
    if (this.hud) this.hud.onResize();
  }

  _handleKey(e) {
    // 剧情模式：C 切视角、ESC 跳过，转发给 CinematicSystem，不走暂停/原视角逻辑
    if (this._cinematicActive && this.cinematic && this.cinematic.active) {
      if (e.code === 'KeyC') this.cinematic.toggleView();
      else if (e.code === 'Escape') this.cinematic.skip();
      return;
    }
    switch (e.code) {
      case 'KeyC': if (!this._paused) this._toggleMainCam(); break;   // 追尾 ↔ 座舱
      case 'KeyV': if (!this._paused) this._cycleObserve(); break;    // 循环观察视角
      case 'KeyM': this.ctx.audio.toggleMute(); break;
      case 'Escape': this._togglePause(); break;                      // ESC 暂停/继续
    }
  }

  // ---------- 暂停菜单 ----------
  _togglePause() {
    if (this._paused) {
      this._doResume();
    } else if (this._running) {
      this._doPause();
    }
  }

  _doPause() {
    this._paused = true;
    this._running = false;
    this.ctx.audio.stopEngine(); // 暂停时淡出引擎音
    this.ctx.audio.updateFiring(false); // 暂停时停止射击循环
    this._showPauseMenu();
  }

  _doResume() {
    this._paused = false;
    this._hidePauseMenu();
    this._running = true;
    // updateEngine 会在下一帧自动将引擎音渐入
    // 不调 clock.start()（会重置 elapsedTime），靠 dt 限幅处理暂停间隔
  }

  _showPauseMenu() {
    if (this._pauseOverlay) return;
    const s = this.ctx.settings;
    const items = [
      { key: 'soundEnabled', label: '音效', value: s.get('soundEnabled') },
      { key: 'hitSound', label: '击中音效', value: s.get('hitSound') },
      { key: 'musicEnabled', label: '音乐', value: s.get('musicEnabled') },
    ];

    const ov = document.createElement('div');
    ov.id = 'pause-overlay';
    ov.innerHTML = `
      <div class="pause-mask"></div>
      <div class="pause-card">
        <div class="pause-title">暂停</div>
        <div class="pause-sub">PAUSE</div>
        <div class="pause-settings">
          ${items.map(it => `
            <div class="pause-setting-row">
              <span class="ps-label">${it.label}</span>
              <div class="toggle ${it.value ? 'on' : ''}" data-setting="${it.key}"></div>
            </div>
          `).join('')}
        </div>
        <div class="pause-actions">
          <button class="bronze-button primary" data-action="resume">继续游戏</button>
          <button class="bronze-button" data-action="quit">返回主菜单</button>
        </div>
        <div class="pause-hint">按 ESC 继续</div>
      </div>
    `;
    document.body.appendChild(ov);
    this._pauseOverlay = ov;

    // 设置开关：点击切换并实时同步到 audio
    ov.querySelectorAll('.toggle').forEach((t) => {
      t.addEventListener('click', () => {
        const key = t.dataset.setting;
        const newVal = !t.classList.contains('on');
        t.classList.toggle('on', newVal);
        s.set(key, newVal);
      });
    });

    // 按钮
    ov.querySelector('[data-action="resume"]').addEventListener('click', () => this._doResume());
    ov.querySelector('[data-action="quit"]').addEventListener('click', () => {
      this._hidePauseMenu();
      this.stop();
    });
  }

  _hidePauseMenu() {
    if (this._pauseOverlay) {
      this._pauseOverlay.remove();
      this._pauseOverlay = null;
    }
  }

  /** C 键：追尾(chase) ↔ 座舱(cockpit) 二选一切换 */
  _toggleMainCam() {
    this._camMode = (this._camMode === 'cockpit') ? 'chase' : 'cockpit';
    if (this._camMode === 'cockpit') {
      this._cockpitView.yaw = 0;
      this._cockpitView.pitch = 0;
    }
    // aimLift 同时驱动准星抬高与 getAimDirection(子弹方向)，保证两者重合（#14）
    this.player.aimLift = (this._camMode === 'cockpit') ? this._aimLiftCockpit : 0;
  }

  /** V 键：循环观察视角（纯观察无准星，可操纵飞机）*/
  _cycleObserve() {
    if (this._camMode === 'observe') {
      this._observeIdx = (this._observeIdx + 1) % OBSERVE_MODES.length;
    } else {
      this._camMode = 'observe';
    }
    this.player.aimLift = 0; // 观察视角无瞄准上抬
  }

  // ---------- 主循环 ----------
  _animate() {
    if (this._disposed) return;
    this._rafId = requestAnimationFrame(() => this._animate());
    if (!this._running) return;
    const dt = Math.min(this.clock.getDelta(), 0.05); // 限幅防切后台大跳
    this._update(dt);
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
  }

  _update(dt) {
    const { camera, env, clouds, audio } = this.ctx;
    const player = this.player;
    const cinematicActive = this._cinematicActive && this.cinematic && this.cinematic.active;

    // 1. 输入（推进响应曲线，必须在读取 flightInput 之前）
    this.controls.tick(dt);
    // 剧情模式：吞掉飞行输入（飞机不响应操纵），但仍 tick 以响应 C/ESC 视角键
    const input = cinematicActive ? { pitch: 0, roll: 0, yaw: 0, throttleUp: false, throttleDown: false, fire: false, fireMg: false, fireCannon: false } : this.controls.flightInput();

    // 2. 玩家：物理 -> 舵面/动画 -> 引擎音效 -> 坠毁/爆炸音效（原版 main.js）
    if (player.model) {
      if (cinematicActive) {
        // 剧情中：不走 updateFlight 操纵，直飞 + 螺旋桨/舵面动画
        // 拟真：速度和高度小幅波动（低频正弦，模拟飞行员修正）
        const t = this.clock.elapsedTime;
        const baseSpd = this._cinematicBaseSpeed || player.speed;
        const baseAlt = this._cinematicBaseAlt || player.root.position.y;
        player.speed = baseSpd + Math.sin(t * 0.3) * 3;        // 速度 ±3 小幅波动
        player.root.position.addScaledVector(player.getForward(), player.speed * dt);
        const targetY = baseAlt + Math.sin(t * 0.15) * 5;       // 高度 ±5 小幅波动
        player.root.position.y += (targetY - player.root.position.y) * Math.min(1, dt * 2);
        player.update(dt);
      } else {
        player.updateFlight(dt, input);
        player.update(dt);
      }
      audio.updateEngine(player.throttle);
      // 坠毁/爆炸音效：HP=0 开始冒烟坠毁播命中音，真正爆炸(_exploded)播爆炸音
      const crashed = !!player.crashed;
      if (crashed && !this._lastCrashed) audio.hit();
      const exploded = !!player._exploded;
      if (exploded && !this._lastExploded) audio.explosion();
      this._lastCrashed = crashed;
      this._lastExploded = exploded;
    }
    // 武器（空格全部 / Z 只机枪 / X 只机炮）
    if (player.weapons) {
      player.weapons.update(dt, !!input.fire, !!input.fireMg, !!input.fireCannon);
    }
    // 喷气尾流（仅喷气机关卡有此实例）
    if (this._jetExhaust) this._jetExhaust.update(dt);
    // 喷气油门管理（仅 jetThrottle 关卡；在玩家物理后钳制油门）
    if (this._jetGov) this._jetGov.update(dt, !!input.throttleUp);
    // 文件音效关卡：射击键循环播放管理（任一射击键按下即触发）
    if (this.ctx.audio) this.ctx.audio.updateFiring(!!input.fire || !!input.fireMg || !!input.fireCannon);

    // 3. 敌机推进 + 空中爆炸音
    for (const en of this.enemies) {
      if (!en.ready) continue;
      en.updateAll(dt, player);
      // 敌机空中爆炸音（_exploded false→true：含坠毁中被打爆 / 撞地爆炸）
      if (en._exploded && !en._wasExploded) audio.explosion();
      en._wasExploded = en._exploded;
    }

    // 3.5 友军轰炸机编队推进（演出 NPC，无战斗逻辑，仅按航线平飞）
    for (const fb of this.friendlyBombers) {
      if (!fb.ready) continue;
      fb.updateAll(dt, player);
    }
    // 清理已脱离的友军轰炸机（飞抵航线终点 _despawnRequested=true）
    if (this.friendlyBombers.some((fb) => fb._despawnRequested)) {
      for (const fb of this.friendlyBombers) {        if (fb._despawnRequested) this._disposeAircraft(fb);
      }
      this.friendlyBombers = this.friendlyBombers.filter((fb) => !fb._despawnRequested);
    }

    // 3.55 B-17 轰炸机群推进（仅 bomberStream 关卡；直飞/受伤返航/炮塔，脱离后释放）
    if (this.bomberStream.length) {
      const wmList = this.wingmen262 ? this.wingmen262.members : null;
      for (const b of this.bomberStream) {
        if (b.ready) b.updateAll(dt, player, wmList);
      }
      if (this.bomberStream.some((b) => b._despawnRequested)) {
        for (const b of this.bomberStream) {
          if (b._despawnRequested) { b.dispose(); this._disposeAircraft(b); }
        }
        this.bomberStream = this.bomberStream.filter((b) => !b._despawnRequested);
      }
    }

    // 3.555 P-51 护航编队推进（仅 escortP51 关卡；伴飞/拦截/猎杀/巡行）
    //   先于僚机小队推进：僚机当帧即可读到 P-51 最新位置做规避
    if (this.p51Escort) this.p51Escort.update(dt);

    // 3.56 友军僚机小队推进（仅 wingmen262 关卡；编队跟随/自由猎杀/规避）
    if (this.wingmen262) this.wingmen262.update(dt);

    // 3.6 剧情编队组推进（哈通/Adler/Falke-2，分兵后驶离组 despawn 由 CinematicSystem 管理）
    for (const grp of this._cinematicFormations) {
      const members = [grp.leader, ...(grp.wingmen || [])].filter(Boolean);
      for (const m of members) {
        if (!m.ready || m._despawnRequested) continue;
        m.updateAll(dt, player);
      }
    }
    // 清理已 despawn 的剧情编队组成员资源
    for (const grp of this._cinematicFormations.slice()) {
      const members = [grp.leader, ...(grp.wingmen || [])].filter(Boolean);
      if (members.every((m) => m._despawnRequested)) {
        for (const m of members) this._disposeAircraft(m);
        const i = this._cinematicFormations.indexOf(grp);
        if (i >= 0) this._cinematicFormations.splice(i, 1);
      }
    }

    // 3.65 长机离场渐隐（库尔斯克第2波全灭后，长机负伤返航飞远渐隐）
    this._updateLeaderDeparture(dt, player);

    // 3.7 剧情系统推进（时间轴/对白/分兵/接敌检测）
    if (this.cinematic && this.cinematic.active) {
      this.cinematic.update(dt);
    }

    // 4. 命中检测
    this._hitDetection();

    // 4.1 IL-2 首次进入标记范围通报（指挥部转发观察哨报告，去重只触发一次）
    this._updateIl2SpotReport(player);

    // 4.5 僚机交战检测
    //     第3关配 cinematic.wingmanImmediateEngage=true：玩家恢复控制后立即脱离跟随
    //     第1关（默认）：等玩家距最近敌机 < 1000m 才脱离跟随（原逻辑）
    if (this._wingmanEngagePending && this.wingman && !this.wingman._combatMode) {
      const immediateEngage = this.levelConfig?.cinematic?.wingmanImmediateEngage;
      if (immediateEngage) {
        // 第3关：立即脱离
        this.wingman.engageEnemies(() => this.enemies);
        this._wingmanEngagePending = false;
      } else {
        // 第1关：等距敌 < 1000m（原逻辑）
        let nearest = Infinity;
        for (const en of this.enemies) {
          if (!en || !en.ready || en.crashed || en._exploded) continue;
          const d = player.root.position.distanceTo(en.root.position);
          if (d < nearest) nearest = d;
        }
        if (nearest < 1000) {
          this.wingman.engageEnemies(() => this.enemies);
          this._wingmanEngagePending = false;
        }
      }
    }

    // 5. 波次推进（P4：WaveDirector 状态机）
    if (this.waveDirector) this.waveDirector.update(dt);

    // 5.5 对话系统推进（P5：定时器递减，过期自动淡出）
    if (this.dialogSystem) this.dialogSystem.update(dt);
    // 5.5b 柏林专属喊话系统 CD 推进（仅第 4 关）
    if (this.berlinChatter) this.berlinChatter.update(dt);

    // 5.55 战斗随机喊话：仅在轰炸机自卫炮塔开火期间触发，内置 3-8s CD
    this._updateCombatChatter(dt);

    // 5.56 对话序列队列推进（接敌对话序列 / 胜利对话序列，逐句按时长播放）
    this._updateDialogQueue(dt);

    // 5.6 玩家受损对话（HP < 50% 首次触发）
    if (!this._damagedNotified && player.hp > 0 && player.hp < player.maxHp * 0.5) {
      this._damagedNotified = true;
      if (this.dialogSystem && this.levelConfig.dialogs?.onPlayerDamaged && !this._leaderDeparting) {
        const d = this.levelConfig.dialogs.onPlayerDamaged;
        this.dialogSystem.show(d.speaker, d.text, 6000, d.avatar || 'mechanic', d.role);
      }
    }

    // 5.7 后方锁定警告（僚机提示：敌机从六点钟方向咬尾进入射击锥）
    this._updateLockWarning(dt);

    // 6. 云层跟随玩家循环回收 + 天空球跟随相机 + 海洋波浪
    if (player.model) {
      clouds.update(player.root.position, player.getForward(), camera);
    }
    if (env.sky) env.sky.position.copy(camera.position);
    if (env.ocean) env.ocean.update(dt, camera);
    if (env.updateSkyClouds) env.updateSkyClouds(dt);
    if (env.battlefield) env.battlefield.update(dt, this.player?.position);   // 库尔斯克战场物件（含距离剔除）
    if (env.flak) env.flak.update(dt, this.player?.root?.position, this.ctx.camera, this.player?.getForward?.(), this.ctx.audio, this.bomberStream); // 防空火力 Flak 视觉+音效（corridor 模式用机群位置）

    // 6.5 关卡音乐：计算最近敌机距离，驱动主题曲/战斗高潮曲切换
    //     用距离平方比较避免开方（triggerRadius 在 update 内平方比较）
    if (this.levelMusic) {
      let nearestSq = Infinity;
      for (const en of this.enemies) {
        if (!en || !en.ready || en.crashed || en._exploded) continue;
        const dSq = player.root.position.distanceToSquared(en.root.position);
        if (dSq < nearestSq) nearestSq = dSq;
      }
      this.levelMusic.update(dt, nearestSq === Infinity ? null : Math.sqrt(nearestSq));
    }

    // 6.55 柏林专属音乐：按拦截进度驱动多段序列切换（进度 = _score / target）
    if (this.berlinMusic) {
      const tbl = this.levelConfig.intercept;
      const progress = tbl && tbl.target ? this._score / tbl.target : 0;
      this.berlinMusic.update(dt, progress);
    }

    // 7. 相机
    this._updateCamera(dt);

    // 8. 雷达
    if (this.radar) this.radar.update();

    // 8.9 交战高度规则（仅 combatAlt 关卡；在 _updateHud 前推进，HUD 读取最新状态）
    if (this._altRule) this._altRule.update(dt);

    // 9. HUD（读数 + 准星 + 波次）
    this._updateHud();

    // 10. 屏幕敌机指示器（原版三角框，由 HudController 绘制）
    if (this.hud) {
      this.hud.updateIndicator(player, this.enemies, camera);
      // 友军轰炸机长机识别框（浅绿色，只标长机，<500m 不显示）
      if (this.friendlyBombers.length) {
        this.hud.updateBomberIndicator(player, [this.friendlyBombers[0]], camera);
      }
      // 玩家僚机（Falke-2）识别标记（淡黄方形框，入屏消失，只标屏外方位）
      if (this.wingman) {
        this.hud.updateWingmanIndicator(player, [this.wingman], camera);
      }
    }

    // 11. 玩家阵亡检测
    //   downed 关卡（如第4关）：坠毁 → graceSec(3s) 演出宽限 → HUD 闪动倒计时 countdownSec(8s) → 任务失败
    //   其他关：爆炸粒子倒计时归零即结算（原行为不变）
    const downedCfg = this.levelConfig && this.levelConfig.downed;
    if (downedCfg) {
      if (player.crashed && this._downedT < 0) this._downedT = 0;
      if (this._downedT >= 0) {
        this._downedT += dt;
        if (this._downedT >= (downedCfg.graceSec ?? 3) + (downedCfg.countdownSec ?? 8)) {
          this._onPlayerDead();
        }
      }
    } else if (player.crashed && player._exploded && player._crashTimer <= 0) {
      this._onPlayerDead();
    }
  }

  // ---------- 命中检测（原版 main.js：距离 9，takeDamage 返回值驱动音效）----------
  _hitDetection() {
    const player = this.player;
    const audio = this.ctx.audio;
    const pBullets = player.weapons.getBullets();

    // 玩家子弹 vs 敌机：坠毁中仍可受击以触发空中爆炸，仅已爆炸跳过
    for (const en of this.enemies) {
      if (!en.ready || en._exploded) continue;
      for (const b of pBullets) {
        if (b.life <= 0) continue;
        const d = b.mesh.position.distanceTo(en.root.position);
        if (d < 9) {
          b.life = 0; // 子弹退役
          const dmg = player.weapons.getDamage(b.muzzleIdx);
          const wasSmoking = en.hp <= en.smokeThreshold;
          // 命中方向（子弹飞行方向，归一化）→ takeDamage 装甲分区减伤
          const hitDir = b.vel.clone().normalize();
          // 机炮命中触发碎片飞溅（20mm 高爆弹崩裂效果）
          if (b.explosive) {
            player.weapons.spawnHitDebris(b.mesh.position, hitDir);
          }
          const dead = en.takeDamage(dmg, hitDir);
          // 记录击落武器类型（机炮击落 → _startCrash 生成大块碎片）
          if (dead && b.explosive) en._killedByExplosive = true;
          audio.hit(); // 命中音（空中爆炸音由 _exploded 状态切换触发）
          // 冒烟通知（首次 HP≤smokeThreshold，由 WaveDirector 去重并转发）
          if (!wasSmoking && !en.crashed && en.hp <= en.smokeThreshold) {
            this.waveDirector.notifySmoking(en);
          }
          if (dead) this.waveDirector.notifyKilled(en);
          break;
        }
      }
    }

    // 玩家子弹 vs B-17 机群（仅 bomberStream 关卡；多球命中近似 + 发动机定位）
    if (this.bomberStream.length) {
      for (const hb of this.bomberStream) {
        if (!hb.ready || hb._exploded) continue;
        for (const b of pBullets) {
          if (b.life <= 0) continue;
          const si = hb.testBulletHit(b.mesh.position);
          if (si >= 0) {
            b.life = 0;
            const dmg = player.weapons.getDamage(b.muzzleIdx);
            const hitDir = b.vel.clone().normalize();
            if (b.explosive) {
              // 30mm 高爆命中 B-17：大碎片 + 命中闪光（克制尺寸，60% 概率）
              player.weapons.spawnHitDebris(b.mesh.position, hitDir, {
                count: [5, 8], scale: [1.2, 2.4], life: [0.7, 1.2],
                flash: 0.6, flashSize: [3.5, 5.0], flashLife: [0.16, 0.26],
              });
            }
            audio.hit();
            hb.onBulletHit(dmg, hitDir, si, !!b.explosive, b.mesh.position);
            break;
          }
        }
      }
    }

    // 玩家子弹 vs P-51 护航编队（仅 escortP51 关卡；同波次敌机 <9m 单球近似）
    //   击伤/击落积分回流 _onP51Event（intercept.p51Damaged/p51Kill）
    if (this.p51Escort) {
      const eCfg = this.levelConfig.escortP51 || {};
      const dmgLine = (eCfg.hp ?? 120) * (1 - (eCfg.damagedAt ?? 0.55));  // 击伤阈值线（剩余 HP）
      for (const p of this.p51Escort.planes) {
        if (!p.ready || p._exploded) continue;
        for (const b of pBullets) {
          if (b.life <= 0) continue;
          const d = b.mesh.position.distanceTo(p.root.position);
          if (d < 9) {
            b.life = 0;
            const dmg = player.weapons.getDamage(b.muzzleIdx);
            const hitDir = b.vel.clone().normalize();
            if (b.explosive) player.weapons.spawnHitDebris(b.mesh.position, hitDir);
            const dead = p.takeDamage(dmg, hitDir);
            if (dead && b.explosive) p._killedByExplosive = true;
            audio.hit();
            if (!p._damagedNotified && !dead && p.hp > 0 && p.hp <= dmgLine) {
              p._damagedNotified = true;
              this._onP51Event('damaged', p);
            }
            if (dead) this._onP51Event('killed', p);
            break;
          }
        }
      }
    }

    // 敌机子弹 vs 玩家（敌机坠毁/爆炸后不再开火）
    if (!player.crashed) {
      for (const en of this.enemies) {
        if (!en.weapons || en.crashed) continue;
        for (const b of en.weapons.getBullets()) {
          if (b.life <= 0) continue;
          if (b.mesh.position.distanceTo(player.root.position) < 9) {
            b.life = 0;
            const dmg = en.weapons.getDamage();
            // takeDamage 返回 false=仍在承受伤害（播命中音）；true=HP 归零开始坠毁（爆炸音由 _exploded 触发）
            if (!player.takeDamage(dmg)) {
              audio.playPlayerHit();
            }
            break;
          }
        }
      }
      // P-51 护航编队子弹 vs 玩家（仅 escortP51 关卡；不伤 AI 僚机——僚机无命中检测路径）
      //   命中按 guns.hitChance 骰点：未中骰子弹静默消失（视作擦过），中骰才结算伤害+音效
      if (this.p51Escort) {
        const hitChance = ((this.levelConfig.escortP51 || {}).guns || {}).hitChance ?? 1;
        for (const p of this.p51Escort.planes) {
          if (!p.weapons || p.crashed || p._exploded) continue;
          for (const b of p.weapons.getBullets()) {
            if (b.life <= 0) continue;
            if (b.mesh.position.distanceTo(player.root.position) < 9) {
              b.life = 0;
              if (Math.random() < hitChance) {
                const dmg = p.weapons.getDamage();
                if (!player.takeDamage(dmg)) {
                  audio.playPlayerHit();
                }
              }
              break;
            }
          }
        }
      }
      // B-17 炮塔子弹 vs 玩家（仅 bomberStream 关卡；命中半径略大覆盖座舱）
      for (const hb of this.bomberStream) {
        if (!hb.weapons || hb.crashed || hb._exploded) continue;
        for (const b of hb.weapons.getBullets()) {
          if (b.life <= 0) continue;
          if (b.mesh.position.distanceTo(player.root.position) < 10) {
            b.life = 0;
            const dmg = hb.weapons.getDamage();
            if (!player.takeDamage(dmg)) {
              audio.playPlayerHit();
            }
            break;
          }
        }
      }
      // 玩家 vs B-17 撞机（仅 bomberStream 关卡）：双方爆炸坠毁，玩家任务失败
      for (const hb of this.bomberStream) {
        if (!hb.ready || hb._falling || hb._exploded) continue;
        // 粗筛：命中球最远偏移 ~40m + 半径，260m 外不可能接触
        if (hb.root.position.distanceToSquared(player.root.position) > 260 * 260) continue;
        if (hb.testCollision(player.root.position, 6)) {
          hb._enterCrash(4);
          hb.onEvent('killed', hb);
          player._explode();
          break;
        }
      }
    }
  }

  // ---------- 后方锁定警告（僚机通讯提示 + 子弹擦过音效）----------
  // 检测是否有敌机从玩家六点钟方向咬尾并进入射击锥：
  //   1) 喊话"被咬尾，小心规避"，带 10s 冷却避免刷屏（原行为）
  //   2) 子弹擦过音效：被咬尾且敌机开火时 30% 概率播放，独立 1-3s 冷却
  _updateLockWarning(dt) {
    if (this._lockWarnCd > 0) this._lockWarnCd -= dt;
    if (this._sideCd > 0) this._sideCd -= dt;
    const player = this.player;
    if (!player || !player.model || player.crashed) { this._tailLocked = false; return; }

    const pPos = player.root.position;
    _fwd.copy(player.getForward()); // 玩家前向（机头 = -Z）

    let lockEnemy = null;
    // P-51 护航编队同样触发咬尾警告（仅 escortP51 关卡；其他关 hostiles = enemies 原行为）
    const hostiles = this.p51Escort ? [...this.enemies, ...this.p51Escort.planes] : this.enemies;
    for (const en of hostiles) {
      if (!en.ready || en.crashed || en._exploded) continue;
      _toE.copy(en.root.position).sub(pPos); // 玩家→敌机
      const dist = _toE.length();
      if (dist < 5 || dist > 700) continue;   // 超出战斗机射程上限则忽略
      _toE.divideScalar(dist);
      // 敌机须位于玩家后方（玩家前向与"玩家→敌机"夹角 > 96°，即点积 < -0.1）
      if (_toE.dot(_fwd) > -0.1) continue;
      // 敌机机头朝向玩家（敌机前向与"敌机→玩家"夹角 < ~18°，进入射击锥）
      _toP.copy(pPos).sub(en.root.position).normalize();
      if (en.getForward().dot(_toP) > 0.95) {
        lockEnemy = en;
        break;
      }
    }

    // 被咬尾状态（每帧更新，无冷却）：驱动 HUD 顶端"FEIND HINTER HECK!"闪动提示
    this._tailLocked = !!lockEnemy;
    if (!this.dialogSystem) return;
    if (lockEnemy) {
      // 子弹擦过音效：被咬尾且敌机开火时 30% 概率，独立 1-3s 冷却避免刷屏
      if (this._sideCd <= 0) {
        const firing = lockEnemy.weapons && lockEnemy.weapons.getBullets().some(b => b.life > 0);
        if (firing && Math.random() < 0.3) {
          this.ctx.audio.playSidePassBy();
          this._sideCd = 1 + Math.random() * 2; // 1-3s 冷却
        }
      }
      // 喊话：10s 冷却（原行为）
      if (this._lockWarnCd <= 0) {
        this._lockWarnCd = 10;
        if (this.berlinChatter) {
          // 第 4 关柏林：走专属喊话系统（与全局 fallback 隔离）
          this.berlinChatter.onLockedOn(lockEnemy);
        } else {
          // 说话人按关卡配置：有 combatChatter.leader 的关（库尔斯克）用长机身份喊，
          // 否则（第1关有 Falke-2 僚机）走原"僚机"喊话。第3关无真正僚机，避免身份错乱。
          const leaderLines = this.levelConfig.combatChatter?.leader;
          if (leaderLines && leaderLines.length && !this._leaderDeparting) {
            const l = leaderLines[0];
            this.dialogSystem.show(l.speaker, '被咬尾，小心规避！', 4000, l.avatar || 'commander', l.role);
          } else {
            this.dialogSystem.show('僚机', '被咬尾，小心规避！', 4000, 'radio', '你的僚机');
          }
        }
      }
    }
  }

  /**
   * 对话序列队列：逐句按时长播放（接敌对话序列 / 胜利对话序列）。
   * 由 CinematicSystem._triggerIntercept / _finishSkip / onAllClear 回调通过 _queueDialogs 入队。
   * 队列播空且 _victoryPending=true 时，触发 callbacks.onAllClear（任务胜利界面）。
   */
  _queueDialogs(arr) {
    if (!arr || !arr.length) return;
    for (const d of arr) {
      this._dialogQueue.push({ ...d });
    }
  }

  _updateDialogQueue(dt) {
    if (!this._dialogQueue.length) {
      // 队列空：若胜利对话播放完毕，触发任务胜利
      if (this._victoryPending) {
        this._victoryPending = false;
        if (this.callbacks.onAllClear) this.callbacks.onAllClear();
      }
      return;
    }
    // 当前句时长未到，继续等
    if (this._dialogQueueTimer > 0) {
      this._dialogQueueTimer -= dt * 1000;
      return;
    }
    // 取下一句播放
    const d = this._dialogQueue.shift();
    if (this.dialogSystem) {
      this.dialogSystem.show(d.speaker, d.text, d.duration, d.avatar || 'commander', d.role);
    }
    this._dialogQueueTimer = d.duration;
  }

  /**
   * 长机负伤离场演出（库尔斯克第2波全灭后触发）。
   * - 触发引擎冒烟（现成 smokeThreshold 机制）
   * - 脱离跟随玩家，改走朝南（德军方向）返航航线
   * - 受伤减速，降至低空
   * - 飞远后渐隐透明度，完成后 despawn（由 _updateLeaderDeparture 驱动）
   */
  _startLeaderDeparture() {
    const grp = this._cinematicFormations.find((g) => g.id === 'leader');
    if (!grp || !grp.leader) return;
    const leader = grp.leader;
    // 引擎白色轻烟（_whiteSmoke=true → _spawnDamageSmoke 发白烟；smokeThreshold<=hp 触发自动冒烟）
    leader._whiteSmoke = true;
    leader.smokeThreshold = leader.hp;
    // 脱离跟随玩家：清 _leader，改走 _route 航线
    leader.setLeader(null, null);
    // 生成朝南（z 负，德军方向）返航航线，从长机当前位置出发
    const pos = leader.root.position;
    const route = [
      { x: pos.x,       y: 1800, z: pos.z - 3000  },  // 先降至 1800m 朝南飞
      { x: pos.x + 400, y: 1200, z: pos.z - 8000  },  // 继续下降，略偏东
      { x: pos.x + 800, y: 800,  z: pos.z - 16000 },  // 低空飞远
    ];
    leader.setDetourRoute(route);
    leader.setCruiseSpeed(70);  // 受伤减速
    this._leaderDeparting = true;
    this._leaderFadeTimer = 0;
    this._leaderDepartElapsed = 0;
    // 清除 wingman 引用（HUD 不再标记长机）
    if (this.wingman === leader) this.wingman = null;
  }

  /**
   * 长机离场渐隐更新（每帧调用）。
   * 长机飞远（距玩家 > 5000m）或航线快走完时开始渐隐，3s 内透明度降到 0，然后 despawn。
   */
  _updateLeaderDeparture(dt, player) {
    if (!this._leaderDeparting) return;
    const grp = this._cinematicFormations.find((g) => g.id === 'leader');
    if (!grp || !grp.leader || !grp.leader.ready) {
      this._leaderDeparting = false;
      return;
    }
    const leader = grp.leader;
    const distToPlayer = leader.root.position.distanceTo(player.root.position);
    // 飞远或航线最后一段时开始渐隐
    const routeEnd = !leader._route || leader._routeIdx >= leader._route.length - 1;
    this._leaderDepartElapsed += dt;
    if (distToPlayer > 2500 || routeEnd || this._leaderDepartElapsed > 10) {
      this._leaderFadeTimer += dt;
      const fadeDur = 3.0;
      const alpha = Math.max(0, 1 - this._leaderFadeTimer / fadeDur);
      if (leader.model) {
        leader.model.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.transparent = true;
            child.material.opacity = alpha;
          }
        });
      }
      if (alpha <= 0) {
        leader.despawnNow();
        this._leaderDeparting = false;
      }
    }
  }

  /**
   * IL-2 首次进入标记范围（<12000m）通报（库尔斯克第3波专属）。
   * 指挥部转发地面观察哨报告，含罗盘方位，去重只触发一次。
   */
  _updateIl2SpotReport(player) {
    if (this._il2SpottedNotified) return;
    if (!this.waveDirector || this.waveDirector.currentWaveIdx !== 2) return;
    for (const e of this.enemies) {
      if (!e.ready || e.crashed || !e._il2State) continue;
      const dist = e.root.position.distanceTo(player.root.position);
      if (dist < 12000) {
        const dx = e.root.position.x - player.root.position.x;
        const dz = e.root.position.z - player.root.position.z;
        const dir = this._compassDir(dx, dz);
        if (this.dialogSystem) {
          this.dialogSystem.show(
            '地面指挥',
            `地面观察哨报告，${dir}方向低空发现伊尔-2编队，正在突入战线！`,
            6000, 'tower', '装甲矛头指挥',
          );
        }
        this._il2SpottedNotified = true;
        break;
      }
    }
  }

  /** 罗盘八方位文字（地图坐标 z+北 x+东） */
  _compassDir(dx, dz) {
    const a = Math.atan2(dx, dz);
    const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    let idx = Math.round(a / (Math.PI / 4));
    if (idx < 0) idx += 8;
    return dirs[idx % 8];
  }

  /**
   * 战斗随机喊话：仅在轰炸机自卫炮塔开火期间触发。
   * 检测 friendlyBombers 是否有 _turretFireTimer>0（正在连发自卫炮塔），
   * 满足条件且 CD 到期时，随机喊一条轰炸机或僚机台词。
   * CD 3-8s 随机，避免刷屏。配置在 levelConfig.combatChatter。
   * 击落最后一架敌机后 _chatterDisabled=true，关闭随机喊话。
   */
  _updateCombatChatter(dt) {
    if (this._chatterDisabled) return;  // 胜利阶段关闭随机喊话
    // 剧情模式中或无活跃敌机时不喊话（避免开场就触发战斗提醒）
    if (this._cinematicActive && this.cinematic && this.cinematic.active) return;
    if (!this.enemies || !this.enemies.length) return;
    if (this._chatterCd > 0) this._chatterCd -= dt;
    if (this._chatterCd > 0) return;
    if (!this.dialogSystem) return;
    const chatter = this.levelConfig.combatChatter;
    if (!chatter) return;

    // 长机喊话（仅靠 CD 定时触发，不依赖轰炸机开火；库尔斯克等关用）
    const leaderLines = chatter.leader || [];
    if (leaderLines.length && !this._leaderDeparting) {
      const d = leaderLines[Math.floor(Math.random() * leaderLines.length)];
      this.dialogSystem.show(d.speaker, d.text, 3500, d.avatar || 'commander', d.role);
      this._chatterCd = 20 + Math.random() * 15;  // 20-35s 间隔（长机提醒低频，避免刷屏）
      return;
    }

    // 轰炸机/僚机喊话（需轰炸机开火触发）
    // 检测轰炸机是否在开火（自卫炮塔连发中）
    let bomberFiring = false;
    for (const fb of this.friendlyBombers) {
      if (!fb || !fb.ready || fb._despawnRequested) continue;
      if (fb._turretFireTimer > 0) { bomberFiring = true; break; }
    }
    if (!bomberFiring) return;

    // 随机选轰炸机喊话或僚机喊话
    const bomberLines = chatter.bomber || [];
    const wingmanLines = chatter.wingman || [];
    if (!bomberLines.length && !wingmanLines.length) return;

    // 60% 轰炸机喊话，40% 僚机喊话（轰炸机正在被攻击，喊话更多）
    const useBomber = wingmanLines.length === 0 || (bomberLines.length > 0 && Math.random() < 0.6);
    const pool = useBomber ? bomberLines : wingmanLines;
    const d = pool[Math.floor(Math.random() * pool.length)];

    // 方位随机化：文本里的"点钟"替换成 1-12 点钟（如"点钟方向"->"3 点钟方向"）
    let text = d.text;
    if (text.includes('点钟')) {
      const hour = 1 + Math.floor(Math.random() * 12);
      text = text.replace('点钟', hour + ' 点钟');
    }

    // 喊话时长 3.5s（短促，战斗中不挡视线）
    this.dialogSystem.show(d.speaker, text, 3500, d.avatar || (useBomber ? 'commander' : 'radio'), d.role);

    // 重置 CD：3-8s 随机
    this._chatterCd = 3 + Math.random() * 5;
  }

  // ---------- 相机（原版 main.js：body frame 偏移 + lerp 平滑 + 座舱右键视野）----------
  _updateCamera(dt) {
    const player = this.player;
    const camera = this.ctx.camera;
    if (!player.model) return;
    const ac = player.root;

    // 剧情模式：视角指令由 CinematicSystem 驱动，同步到本类 _camMode
    if (this._cinematicActive && this.cinematic && this.cinematic.active) {
      this._camMode = this.cinematic.camMode;
      // cinematicAuto / cinematicFixed：委托 CinematicSystem 计算相机位置
      if (this._camMode === 'cinematicAuto') {
        this.cinematic.computeCinematicAutoCam(dt, camera);
        return;
      } else if (this._camMode === 'cinematicFixed') {
        this.cinematic.computeCinematicFixedCam(camera);
        return;
      }
      // cockpit 走下面的座舱分支
    }

    if (this._camMode === 'cockpit') {
      // 座舱视角（body frame，机头=-Z）：参数由 this._cockpitCfg 控制（支持关卡级覆盖）
      const ck = this._cockpitCfg;
      _camOff.set(ck.x, ck.y, ck.z)
        .applyQuaternion(ac.quaternion).add(ac.position);
      camera.position.copy(_camOff);
      // 前视方向 + 右键视野偏移（视线从相机位置出发，沿机头前方 lookDist 远）
      _fwd.copy(player.getForward());
      _quat.setFromEuler(_euler.set(this._cockpitView.pitch, this._cockpitView.yaw, 0, 'YXZ'));
      _fwd.applyQuaternion(_quat).multiplyScalar(ck.lookDist).add(_camOff);
      camera.lookAt(_fwd);
    } else {
      // 外部视角（chase / observe）：body frame 偏移 + lerp 平滑
      const offKey = (this._camMode === 'observe') ? OBSERVE_MODES[this._observeIdx] : this._camMode;
      _camOff.copy(this._camOffsets[offKey]).applyQuaternion(ac.quaternion).add(ac.position);
      // 首帧直接 copy 到位（避免从 AppShell 背景位置 lerp 飞过来），之后 lerp 平滑跟随
      if (this._camInited) {
        camera.position.lerp(_camOff, 1 - Math.exp(-dt * 4.5));
      } else {
        camera.position.copy(_camOff);
        this._camInited = true;
      }
      _lookAt.copy(player.getForward()).multiplyScalar(8).add(ac.position);
      camera.lookAt(_lookAt);
    }

    // 坠毁镜头震动（原版：0.8 系数 + 三轴）
    if (player.crashShake > 0) {
      const s = player.crashShake * 0.8;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.position.z += (Math.random() - 0.5) * s;
    }
  }

  // ---------- HUD ----------
  _updateHud() {
    const player = this.player;
    const camera = this.ctx.camera;

    // 准星：投影飞机前方瞄准点（原版 main.js updateCrosshair）
    // 瞄准点 = 飞机位置 + 前方远距离点（拉远到 1600，减少飞机模型自身遮挡，便于瞄准远方目标）
    let crosshair = { x: innerWidth / 2, y: innerHeight / 2, visible: false };
    // 观察视角(V键)无准星；剧情模式无准星；追尾/座舱显示
    const cinematicActive = this._cinematicActive && this.cinematic && this.cinematic.active;
    if (player.model && !player.crashed && this._camMode !== 'observe' && !cinematicActive) {
      const aimDist = this._aimDist;
      _aimPt.copy(player.getForward()).multiplyScalar(aimDist).add(player.root.position);
      // 座舱模式：瞄准点向上抬高，让准星落在视野中上部（aimLift 同时驱动子弹方向，保证重合 #14）
      if (player.aimLift) {
        _upOffset.set(0, 1, 0).applyQuaternion(player.root.quaternion).multiplyScalar(aimDist * player.aimLift);
        _aimPt.add(_upOffset);
      }
      _proj.copy(_aimPt).project(camera);
      // 在屏幕内才显示（z 范围 -1~1）
      if (_proj.z <= 1 && _proj.z >= -1) {
        crosshair = {
          x: (_proj.x * 0.5 + 0.5) * innerWidth,
          y: (-_proj.y * 0.5 + 0.5) * innerHeight,
          visible: true,
        };
      }
    }

    // AGL（离地高度）：用于低空警告。地形未注入时按 0 处理。
    const terrain = this.ctx.env.terrain;
    const groundH = terrain ? terrain.getHeight(player.root.position.x, player.root.position.z) : 0;
    const agl = player.root.position.y - groundH;

    this.hud.update({
      speed: player.speed * 3.6, // 单位/s -> km/h
      alt: player.root.position.y,
      throttle: player.throttle,
      hp: player.hp,
      maxHp: player.maxHp,
      gForce: player.gForce,
      stall: player.stall,
      crashed: player.crashed,
      tailLocked: this._tailLocked,
      lowAltitude: agl < 200, // 离地低于 200m 触发屏幕中央警告
      // 击落倒计时（downed 关卡）/ 交战高度规则警告（combatAlt 关卡）——击落倒计时优先，
      //   玩家坠毁后 altRule.hudState 恒 null 通道自动让出；前三关恒 null → HUD 永不显示
      altFence: this._downedHudState() || (this._altRule ? this._altRule.hudState() : null),
      // 喷气油门条状态（仅 jetThrottle 关卡有此字段；HUD 据此显示专用油门条并隐藏通用条）
      jetThrottle: this._jetGov ? this._jetGov.hudState() : null,
      // 拦截进度（仅 intercept 关卡有此字段；B-17 击落/击伤积分）
      intercept: this.levelConfig && this.levelConfig.intercept
        ? { value: this._score, target: this.levelConfig.intercept.target } : null,
      crosshair,
      posX: player.root.position.x,
      posZ: player.root.position.z,
      cannonHeat: player.weapons ? player.weapons.getCannonHeat() : 0,
      cannonOverheated: player.weapons ? player.weapons.isCannonOverheated() : false,
    });

    // 波次进度（每帧刷新 kills）
    if (this.waveDirector) {
      const ws = this.waveDirector.getState();
      this.hud.setWave(Math.max(1, ws.currentWave), ws.totalWaves, ws.killed, ws.target, ws.state);
    }
  }

  /** 击落倒计时 HUD 状态（仅 levelConfig.downed 关卡）：坠毁 graceSec 宽限后开始 countdownSec 闪动倒计时 */
  _downedHudState() {
    const cfg = this.levelConfig && this.levelConfig.downed;
    if (!cfg || this._downedT < 0) return null;
    const grace = cfg.graceSec ?? 3;
    if (this._downedT < grace) return null;
    const remain = Math.max(0, Math.ceil(grace + (cfg.countdownSec ?? 8) - this._downedT));
    return { level: 'countdown', text: `你被击落了 · 任务结束倒计时 ${remain}` };
  }

  _onPlayerDead(reason) {
    if (this._playerDeadNotified) return;
    this._playerDeadNotified = true;
    this._running = false; // 暂停主循环（等用户点返回再 stop 释放）
    if (this.dialogSystem && this.levelConfig.dialogs?.onPlayerDead) {
      const d = this.levelConfig.dialogs.onPlayerDead;
      this.dialogSystem.show(d.speaker, d.text, 10000, d.avatar || 'commander', d.role);
    }
    if (this.berlinChatter) this.berlinChatter.onPlayerDead();
    // reason 可选：'altFence'=脱离作战高度判负（AppShell 结算页显示"任务失败"）；缺省=阵亡原文案
    if (this.callbacks.onPlayerDead) this.callbacks.onPlayerDead(reason);
  }

  /** 关卡统计数据（供结算页展示）*/
  getStats() {
    return {
      killed: this.waveDirector ? this.waveDirector.killed : 0,
      target: this.waveDirector ? this.waveDirector.target : 0,
      time: this.clock.elapsedTime || 0,
      hp: this.player ? this.player.hp : 0,
      maxHp: this.player ? this.player.maxHp : 100,
    };
  }

  // ---------- 生命周期 ----------
  pause() { this._running = false; }
  resume() { this._running = true; } // 不调 clock.start()，靠 dt 限幅处理暂停间隔

  /** 停止并释放关卡级资源 */
  stop() {
    if (this._disposed) return;
    this._disposed = true;
    this._running = false;
    cancelAnimationFrame(this._rafId);

    // 清理暂停菜单（如有）
    this._hidePauseMenu();

    // 清理教学系统（如有）
    if (this.tutorial) { this.tutorial.dispose(); this.tutorial = null; }

    // 清理交战高度规则（如有，combatAlt 关卡）
    if (this._altRule) { this._altRule.dispose(); this._altRule = null; }

    // 清理喷气尾流特效（如有，jetNozzles 关卡）
    if (this._jetExhaust) { this._jetExhaust.dispose(); this._jetExhaust = null; }

    // 清理喷气油门管理器（如有，jetThrottle 关卡；无 DOM，仅引用）
    this._jetGov = null;

    // 清理关卡级射击音效文件（恢复默认合成机枪声，关卡隔离）
    if (this.ctx.audio) { this.ctx.audio.clearFireSamples(); this.ctx.audio.clearGroupFireSamples(); this.ctx.audio.clearFlakSamples(); }
    // 恢复引擎音类型为活塞 + 清除文件引擎音（关卡隔离：jet/文件引擎仅配置关卡生效）
    if (this.ctx.audio && this.ctx.audio.setEngineType) this.ctx.audio.setEngineType('piston');
    if (this.ctx.audio && this.ctx.audio.clearEngineSound) this.ctx.audio.clearEngineSound();

    // 停止关卡音乐（淡出）
    if (this.levelMusic) { this.levelMusic.stop(1.0); this.levelMusic = null; }
    if (this.berlinMusic) { this.berlinMusic.stop(1.0); this.berlinMusic = null; }

    // 清理对话系统
    if (this.dialogSystem) { this.dialogSystem.dispose(); this.dialogSystem = null; }
    // 清理柏林专属喊话系统
    if (this.berlinChatter) { this.berlinChatter.dispose(); this.berlinChatter = null; }
    // 清理对话队列状态（防止 stop 后 _updateDialogQueue 触发延迟回调）
    this._dialogQueue = [];
    this._dialogQueueTimer = 0;
    this._victoryPending = false;
    this._chatterDisabled = false;

    // 移除事件
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._onContextMenu) window.removeEventListener('contextmenu', this._onContextMenu);
    if (this._onMouseDown) window.removeEventListener('mousedown', this._onMouseDown);
    if (this._onMouseUp) window.removeEventListener('mouseup', this._onMouseUp);
    if (this._onMouseMove) window.removeEventListener('mousemove', this._onMouseMove);

    // 释放波次导演（含所有活跃敌机资源，通过 disposeEnemy 回调调 _disposeAircraft）
    if (this.waveDirector) { this.waveDirector.dispose(); this.waveDirector = null; }
    // 释放友军轰炸机编队
    for (const fb of this.friendlyBombers) this._disposeAircraft(fb);
    this.friendlyBombers = [];
    // 释放 B-17 轰炸机群（仅 bomberStream 关卡；含发动机烟粒子清理）
    for (const b of this.bomberStream) { b.dispose(); this._disposeAircraft(b); }
    this.bomberStream = [];
    // 释放友军僚机小队（仅 wingmen262 关卡）
    if (this.wingmen262) { this.wingmen262.dispose(); this.wingmen262 = null; }
    // 释放 P-51 护航编队（仅 escortP51 关卡）
    if (this.p51Escort) { this.p51Escort.dispose(); this.p51Escort = null; }
    this.wingman = null; // 清理僚机引用（Falke-2 由下面 _cinematicFormations 释放）
    this._wingmanEngagePending = false;
    // 释放剧情编队组（哈通/Adler/Falke-2，未驶离的残留成员）
    for (const grp of this._cinematicFormations) {
      for (const m of [grp.leader, ...(grp.wingmen || [])].filter(Boolean)) this._disposeAircraft(m);
    }
    this._cinematicFormations = [];
    // 释放剧情系统（清理 UI 提示/读条 DOM）
    if (this.cinematic) { this.cinematic.dispose(); this.cinematic = null; }
    this._cinematicActive = false;
    // 释放地面目标系统
    if (this.groundTargets) { this.groundTargets.dispose(); this.groundTargets = null; }
    // 释放玩家
    this._disposeAircraft(this.player);

    // HUD 卸载
    if (this.hud) { this.hud.unmount(); this.hud = null; }

    // 输入释放
    if (this.controls) { this.controls.dispose(); this.controls = null; }

    // 雷达释放
    if (this.radar) { this.radar.dispose(); this.radar = null; }

    // 相机姿态复位（交还 AppShell 背景循环）
    this.ctx.camera.up.set(0, 1, 0);

    // 调试接口清理
    delete window.__aircraft;
    delete window.__debug;

    // 通知 AppShell 取回渲染权
    this.ctx.shell.setGameRunning(false);

    if (this.callbacks.onStop) this.callbacks.onStop();
  }

  /** 释放单个飞机实例的资源（geometry/material/粒子/场景节点）*/
  _disposeAircraft(ac) {
    if (!ac) return;
    if (ac.mixer) ac.mixer.stopAllAction();
    // 粒子
    for (const p of ac._explosions) ac.scene.remove(p.mesh);
    for (const s of ac._damageSmoke) ac.scene.remove(s.mesh);
    for (const f of ac._damageFire) ac.scene.remove(f.mesh);
    for (const d of ac._debris) ac.scene.remove(d.mesh);
    // 武器粒子 + 共享资源
    if (ac.weapons) {
      for (const b of ac.weapons.bullets) ac.scene.remove(b.mesh);
      for (const f of ac.weapons.flashes) ac.scene.remove(f.sprite);
      for (const s of ac.weapons.sparks) ac.scene.remove(s.sprite);
      for (const s of ac.weapons.smokes) ac.scene.remove(s.sprite);
      for (const d of ac.weapons.debris) ac.scene.remove(d.mesh);   // 机炮命中碎片
      ac.weapons.bulletGeo?.dispose();
      ac.weapons.bulletMat?.dispose();
      ac.weapons.flashTex?.dispose();
      ac.weapons.smokeTex?.dispose();
      ac.weapons.sparkTex?.dispose();
      ac.weapons.debrisGeo?.dispose();                              // 碎片几何体
    }
    // model geometry/material
    if (ac.model) {
      ac.model.traverse((o) => {
        if (o.isMesh) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          }
        }
      });
    }
    ac.scene.remove(ac.root);
  }
}
