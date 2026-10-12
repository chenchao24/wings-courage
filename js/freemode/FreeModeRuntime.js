/**
 * FreeModeRuntime · 自由模式运行时（与战役模式 GameRuntime 完全隔离）。
 *
 * 铁原则：不 extends GameRuntime。主循环/相机/命中检测/敌机管理独立实现。
 *   - 复用纯机制模块：Aircraft / Weapons / Controls / Radar / HudController / audio / clouds / environment
 *     （这些模块无模式语义，共享安全）
 *   - 敌机用 FreeModeEnemy（独立 AI，不继承 Enemy）
 *   - 配置从 js/config/freemode/* 独立读取，不引用 js/config/levels/*
 *
 * 生命周期：start → _animate 循环 → stop（释放资源）。
 */

import * as THREE from 'three';
import { Aircraft } from '../aircraft.js';
import { Weapons } from '../weapons.js';
import { Controls } from '../controls.js';
import { Radar } from '../radar.js';
import { HudController } from '../game/HudController.js';
import { FreeModeEnemy } from './FreeModeEnemy.js';
import { getFreeMapConfig } from './FreeModeMaps.js';
import { JetExhaust } from '../JetExhaust.js';
import { JetThrottleGovernor } from '../game/JetThrottleGovernor.js';

// 复用临时向量
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _camOff = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _aimPt = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _upOffset = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _eiProj = new THREE.Vector3();

// 调试全局挂载门控：仅本地（localhost/127.0.0.1）或 URL 带 ?debug 时暴露
// window.__aircraft/__freeRuntime（Playwright 回归打 127.0.0.1 依赖这些全局；线上不暴露内部引用）
const _DEBUG_GLOBALS = typeof location !== 'undefined'
  && (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    || /(?:\?|&)debug(?:[=&#]|$)/.test(location.search));

// 相机模式
const OBSERVE_MODES = ['rearLeft', 'frontRight', 'top'];
const CAM_OFFSETS = {
  chase:      new THREE.Vector3(0, 3.4, 12.5),
  rearLeft:   new THREE.Vector3(-8, 3.0, 10),
  frontRight: new THREE.Vector3(7, 2.0, -10),
  top:        new THREE.Vector3(0, 16, 0.5),
};
const COCKPIT_CFG = { x: 0.00, y: 1.65, z: -0.70, lookDist: 80 };
const AIM_LIFT_COCKPIT = 0.12;

export class FreeModeRuntime {
  /**
   * @param {{renderer,scene,camera,env,clouds,audio,settings,shell}} ctx 共享上下文（由 AppShell 注入）
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.player = null;
    this.controls = null;
    this.radar = null;
    this.hud = null;
    this.config = null;
    this.callbacks = {};

    this.enemies = [];              // 自由模式敌机列表（独立管理，不用 WaveDirector）
    this.killed = 0;                // 已击落数
    this.target = 0;                // 目标击落数（= 敌机总数）
    this._smokingNotified = new WeakSet();

    this._jetExhaust = null;        // 喷气尾流特效（仅 jetNozzles 机型，如 Me 262）
    this._jetGov = null;            // 喷气油门管理器（仅 jetThrottle 机型）

    this.clock = new THREE.Clock();
    this._disposed = false;
    this._running = false;
    this._rafId = 0;
    this._elapsed = 0;              // 累计游戏时间（秒，用于时间限制）

    this._camMode = 'chase';
    this._observeIdx = 0;
    this._camInited = false;
    this._cockpitCfg = { ...COCKPIT_CFG };
    this._camOffsets = { ...CAM_OFFSETS };
    this._aimLiftCockpit = AIM_LIFT_COCKPIT;
    this._aimDist = 1600;
    this._cockpitView = { yaw: 0, pitch: 0, dragging: false, lx: 0, ly: 0 };

    this._playerDeadNotified = false;
    this._paused = false;
    this._pauseOverlay = null;
    this._timeOver = false;

    this._onKeyDown = null;
    this._onResize = null;
    this._onContextMenu = null;
    this._onMouseDown = null;
    this._onMouseUp = null;
    this._onMouseMove = null;
  }

  /**
   * 启动自由模式。
   * @param {object} config 自由模式配置
   *   - mapId: 地图 id
   *   - playerAircraft: 玩家机型配置（来自 config/freemode/aircraft.js）
   *   - enemyAircraftList: 敌机机型列表 [{model, ...}, ...]
   *   - difficulty: 难度配置（来自 config/freemode/difficulty.js）
   *   - timeLimitMinutes: 时间限制（0=无限制）
   * @param {object} callbacks {onReady, onPlayerDead, onAllClear, onTimeOver, onStop}
   */
  async start(config, callbacks = {}) {
    this.config = config;
    this.callbacks = callbacks;

    try {
      // 1. 地图配置
      const mapCfg = getFreeMapConfig(config.mapId);
      if (!mapCfg) throw new Error('[FreeModeRuntime] 未知地图: ' + config.mapId);

      // 2. HUD + 输入
      this.hud = new HudController(this.ctx.shell);
      const radarCanvas = this.hud.mount('自由模式');
      this.controls = new Controls();

      // 3. 玩家飞机
      const pa = config.playerAircraft;
      this.player = new Aircraft(this.ctx.scene, this.ctx.renderer);
      this.player.autoRespawn = false;
      this.player.isPlayer = true;

      // 注入玩家配置（复制 GameRuntime.start 的 playerConfig 注入逻辑）
      const pc = pa.playerConfig;
      if (pc) {
        if (pc.autoOrient !== undefined) this.player.autoOrient = pc.autoOrient;
        if (pc.yawOffset !== undefined) this.player.yawOffset = pc.yawOffset;
        if (pc.userScale !== undefined) this.player.userScale = pc.userScale;
        if (pc.centerOffset) this.player.centerOffset = pc.centerOffset.slice();
        if (pc.propNodes) this.player._propNodes = pc.propNodes.slice();
        if (pc.hideGear !== undefined) this.player._hideGear = pc.hideGear;
        if (pc.hideGearNodes) this.player._hideGearNodes = pc.hideGearNodes.slice();
        if (pc.glassNodes) this.player._glassNodes = pc.glassNodes.slice();
        if (pc.propBlurDisc !== undefined) this.player._propBlurDisc = pc.propBlurDisc;
        if (pc.propSpinSpeed !== undefined) this.player._propSpinSpeed = pc.propSpinSpeed;
        if (pc.propOpacity !== undefined) this.player._propOpacity = pc.propOpacity;
        if (pc.propBlurStrength !== undefined) this.player._propBlurStrength = pc.propBlurStrength;
        if (pc.propBlurStyle !== undefined) this.player._propBlurStyle = pc.propBlurStyle;
        if (pc.propProcedural !== undefined) this.player._propProcedural = pc.propProcedural;
        if (pc.propHubOffset) this.player._propHubOffset = pc.propHubOffset.slice();
        if (pc.propRadius !== undefined) this.player._propRadius = pc.propRadius;
        if (pc.propBladeCount !== undefined) this.player._propBladeCount = pc.propBladeCount;
        if (pc.propBladeChord !== undefined) this.player._propBladeChord = pc.propBladeChord;
        if (pc.propBladeTwist !== undefined) this.player._propBladeTwist = pc.propBladeTwist;
        if (pc.propCut) this.player._propCut = { ...pc.propCut };
        if (pc.cockpitLight) this.player._cockpitLight = { ...pc.cockpitLight };
        if (pc.muzzleOffsets) this.player.muzzleOffsets = pc.muzzleOffsets.map((v) =>
          v.clone ? v.clone() : new THREE.Vector3(v[0], v[1], v[2]));
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
        if (pc.vaporAltMin !== undefined) this.player._vaporAltMin = pc.vaporAltMin;
        if (pc.vaporAltMax !== undefined) this.player._vaporAltMax = pc.vaporAltMax;
      }

      // 喷气机专属配置（仅 Me 262 等喷气机型有此字段，活塞机型无此字段 = 原行为不变）
      if (pc && pc.jetNozzles && pc.jetNozzles.length) {
        this._jetExhaust = new JetExhaust(this.ctx.scene, this.player, pc.jetNozzles, { camera: this.ctx.camera });
      }
      if (pc && pc.engineSound === 'jet') {
        this.ctx.audio.setEngineType('jet');
      }
      if (pc && pc.engineSoundFile) {
        this.ctx.audio.setEngineSoundFile(pc.engineSoundFile);
      }
      if (pc && pc.jetThrottle) {
        this._jetGov = new JetThrottleGovernor(this.player, pc.jetThrottle);
      }

      this.player.setTerrain(this.ctx.env.terrain);
      this.player.setObstacles(this.ctx.env.obstacles);
      await this.player.load(pa.model);
      this.player.reset();

      // 玩家出生位置（地图配置）
      const ps = mapCfg.playerStart;
      if (ps) {
        if (ps.position) {
          const [px, py, pz] = ps.position;
          this.player.root.position.set(px, py != null ? py : 700, pz);
        }
        if (ps.speed != null) this.player.speed = ps.speed;
      }
      this.player.aimLift = 0;

      // 玩家 HP 难度乘数
      const playerHpMul = config.difficulty?.playerHpMul || 1.0;
      if (playerHpMul !== 1.0) {
        this.player.maxHp = Math.round(this.player.maxHp * playerHpMul);
        this.player.hp = this.player.maxHp;
      }

      // 4. 雷达
      this.radar = new Radar(radarCanvas, {
        aircraft: this.player,
        getEnemies: () => this.enemies,
      });

      // 5. 玩家武器
      this.player.weapons = new Weapons(this.ctx.scene, this.player, this.ctx.camera);
      this.player.weapons.setAudio(this.ctx.audio);
      if (pc && pc.weapons && pc.weapons.groups) {
        this.player.weapons.setWeaponGroups(pc.weapons.groups);
      }

      // 6. 武器组级射击音效
      if (pc && pc.weapons && pc.weapons.groups) {
        const audio = this.ctx.audio;
        for (const groupName in pc.weapons.groups) {
          const g = pc.weapons.groups[groupName];
          if (g.sound) audio.loadGroupFireSound(groupName, g.sound);
        }
      }

      // 7. 创建敌机（HP 减半 = 原模式一半 × 难度乘数）
      await this._spawnEnemies(config, mapCfg);

      // 8. 事件
      this._wireEvents();

      // 9. 启动主循环
      this._running = true;
      this.ctx.shell.setGameRunning(true);
      this.clock.start();
      this._elapsed = 0;
      this._animate();

      // 调试接口（仅本地/带 ?debug 时挂载，见模块级 _DEBUG_GLOBALS 门控）
      if (_DEBUG_GLOBALS) {
        window.__aircraft = this.player;
        window.__freeRuntime = this;
      }

      if (this.callbacks.onReady) this.callbacks.onReady();
    } catch (err) {
      console.error('[FreeModeRuntime] start 失败:', err);
      this.stop();
      throw err;
    }
  }

  /** 创建敌机列表（HP = 原模式一半 × 难度乘数）*/
  async _spawnEnemies(config, mapCfg) {
    const diff = config.difficulty || {};
    const enemyHpMul = diff.enemyHpMul || 1.0;
    const player = this.player;

    for (const ea of config.enemyAircraftList) {
      const enemy = new FreeModeEnemy(this.ctx.scene, this.ctx.renderer, player, diff);
      enemy.setTerrain(this.ctx.env.terrain);
      enemy.setObstacles(this.ctx.env.obstacles);
      await enemy.load(ea.model);
      // HP 规则：原模式一半 × 难度乘数
      // FreeModeEnemy._applyModelSpecs 已设 maxHp 为机型基础值，此处覆盖
      const baseHp = enemy.maxHp;
      enemy.maxHp = Math.round(baseHp * 0.5 * enemyHpMul);
      enemy.hp = enemy.maxHp;
      this.enemies.push(enemy);
    }
    this.target = this.enemies.length;
  }

  // ---------- 主循环 ----------
  _animate() {
    if (this._disposed) return;
    this._rafId = requestAnimationFrame(() => this._animate());
    if (!this._running) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._elapsed += dt;
    this._update(dt);
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
  }

  _update(dt) {
    const { camera, env, clouds, audio } = this.ctx;
    const player = this.player;

    // 1. 输入
    this.controls.tick(dt);
    const input = this.controls.flightInput();

    // 2. 玩家
    if (player.model) {
      player.updateFlight(dt, input);
      player.update(dt);
      audio.updateEngine(player.throttle);
      const crashed = !!player.crashed;
      if (crashed && !this._lastCrashed) audio.hit();
      const exploded = !!player._exploded;
      if (exploded && !this._lastExploded) audio.explosion();
      this._lastCrashed = crashed;
      this._lastExploded = exploded;
    }
    if (player.weapons) {
      player.weapons.update(dt, !!input.fire, !!input.fireMg, !!input.fireCannon);
    }
    if (audio) audio.updateFiring(!!input.fire || !!input.fireMg || !!input.fireCannon);

    // 喷气尾流 + 油门管理（仅喷气机型有此实例，活塞机型为 null = 原行为不变）
    if (this._jetExhaust) this._jetExhaust.update(dt);
    if (this._jetGov) this._jetGov.update(dt, !!input.throttleUp);

    // 3. 敌机推进
    for (const en of this.enemies) {
      if (!en.ready) continue;
      en.updateAll(dt, player);
      if (en._exploded && !en._wasExploded) audio.explosion();
      en._wasExploded = en._exploded;
    }

    // 4. 命中检测
    this._hitDetection();

    // 5. 云层 + 天空 + 海洋
    if (player.model) {
      clouds.update(player.root.position, player.getForward(_fwd), camera);
    }
    if (env.sky) env.sky.position.copy(camera.position);
    if (env.ocean) env.ocean.update(dt, camera);
    if (env.updateSkyClouds) env.updateSkyClouds(dt);

    // 6. 相机
    this._updateCamera(dt);

    // 7. 雷达
    if (this.radar) this.radar.update();

    // 8. HUD
    this._updateHud();
    if (this.hud) {
      this.hud.updateIndicator(player, this.enemies, camera);
    }

    // 9. 玩家阵亡检测
    if (player.crashed && player._exploded && player._crashTimer <= 0) {
      this._onPlayerDead();
    }

    // 10. 全灭胜利检测
    if (this.enemies.length > 0 && this.enemies.every((e) => e._exploded && e._crashTimer <= 0)) {
      if (!this._allClearNotified) {
        this._allClearNotified = true;
        this._running = false;
        if (this.callbacks.onAllClear) this.callbacks.onAllClear();
      }
    }

    // 11. 时间限制检测
    const timeLimit = this.config.timeLimitMinutes || 0;
    if (timeLimit > 0 && this._elapsed >= timeLimit * 60 && !this._timeOver) {
      this._timeOver = true;
      this._running = false;
      if (this.callbacks.onTimeOver) this.callbacks.onTimeOver();
    }
  }

  // ---------- 命中检测 ----------
  _hitDetection() {
    const player = this.player;
    const audio = this.ctx.audio;
    const pBullets = player.weapons.getBullets();

    // 玩家子弹 vs 敌机
    for (const en of this.enemies) {
      if (!en.ready || en._exploded) continue;
      for (const b of pBullets) {
        if (b.life <= 0) continue;
        const d = b.mesh.position.distanceTo(en.root.position);
        if (d < 9) {
          b.life = 0;
          const dmg = player.weapons.getDamage(b.muzzleIdx);
          const wasSmoking = en.hp <= en.smokeThreshold;
          const dead = en.takeDamage(dmg);
          audio.hit();
          if (!wasSmoking && en.hp <= en.smokeThreshold && !this._smokingNotified.has(en)) {
            this._smokingNotified.add(en);
          }
          if (dead) {
            this.killed++;
          }
          break;
        }
      }
    }

    // 敌机子弹 vs 玩家
    if (!player.crashed) {
      for (const en of this.enemies) {
        if (!en.ready || en.crashed) continue;
        for (const b of en.weapons.getBullets()) {
          if (b.life <= 0) continue;
          const d = b.mesh.position.distanceTo(player.root.position);
          if (d < 9) {
            b.life = 0;
            const dmg = en.weapons.getDamage(b.muzzleIdx);
            player.takeDamage(dmg);
            audio.hit();
            break;
          }
        }
      }
    }
  }

  // ---------- 相机 ----------
  _updateCamera(dt) {
    const player = this.player;
    const camera = this.ctx.camera;
    if (!player.model) return;
    const ac = player.root;

    if (this._camMode === 'cockpit') {
      const ck = this._cockpitCfg;
      _camOff.set(ck.x, ck.y, ck.z).applyQuaternion(ac.quaternion).add(ac.position);
      camera.position.copy(_camOff);
      player.getForward(_fwd);
      _quat.setFromEuler(_euler.set(this._cockpitView.pitch, this._cockpitView.yaw, 0, 'YXZ'));
      _fwd.applyQuaternion(_quat).multiplyScalar(ck.lookDist).add(_camOff);
      camera.lookAt(_fwd);
    } else {
      const offKey = (this._camMode === 'observe') ? OBSERVE_MODES[this._observeIdx] : this._camMode;
      _camOff.copy(this._camOffsets[offKey]).applyQuaternion(ac.quaternion).add(ac.position);
      if (this._camInited) {
        camera.position.lerp(_camOff, 1 - Math.exp(-dt * 4.5));
      } else {
        camera.position.copy(_camOff);
        this._camInited = true;
      }
      _lookAt.copy(player.getForward(_lookAt)).multiplyScalar(8).add(ac.position);
      camera.lookAt(_lookAt);
    }

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
    if (!this.hud) return;

    let crosshair = { x: innerWidth / 2, y: innerHeight / 2, visible: false };
    if (player.model && !player.crashed && this._camMode !== 'observe') {
      const aimDist = this._aimDist;
      _aimPt.copy(player.getForward(_aimPt)).multiplyScalar(aimDist).add(player.root.position);
      if (player.aimLift) {
        _upOffset.set(0, 1, 0).applyQuaternion(player.root.quaternion).multiplyScalar(aimDist * player.aimLift);
        _aimPt.add(_upOffset);
      }
      _proj.copy(_aimPt).project(camera);
      if (_proj.z <= 1 && _proj.z >= -1) {
        crosshair = {
          x: (_proj.x * 0.5 + 0.5) * innerWidth,
          y: (-_proj.y * 0.5 + 0.5) * innerHeight,
          visible: true,
        };
      }
    }

    const terrain = this.ctx.env.terrain;
    const groundH = terrain ? terrain.getHeight(player.root.position.x, player.root.position.z) : 0;
    const agl = player.root.position.y - groundH;

    this.hud.update({
      speed: player.speed * 3.6,
      alt: player.root.position.y,
      throttle: player.throttle,
      hp: player.hp,
      maxHp: player.maxHp,
      gForce: player.gForce,
      stall: player.stall,
      crashed: player.crashed,
      lowAltitude: agl < 200,
      crosshair,
      posX: player.root.position.x,
      posZ: player.root.position.z,
      cannonHeat: player.weapons ? player.weapons.getCannonHeat() : 0,
      cannonOverheated: player.weapons ? player.weapons.isCannonOverheated() : false,
      jetThrottle: this._jetGov ? this._jetGov.hudState() : null,
    });

    // 波次进度（复用 HUD 的 setWave 显示击落数/目标）
    this.hud.setWave(1, 1, this.killed, this.target, this.enemies.length > 0 ? 'active' : 'done');
  }

  // ---------- 事件 ----------
  _wireEvents() {
    this._onKeyDown = (e) => this._handleKey(e);
    window.addEventListener('keydown', this._onKeyDown);
    this._onResize = () => this._onResizeFn();
    window.addEventListener('resize', this._onResize);

    this._onContextMenu = (e) => e.preventDefault();
    this._onMouseDown = (e) => {
      // 左键拖拽调整座舱视野（原右键，用户反馈右键触发浏览器事件；仅画布上空按生效）
      if (e.button === 0 && this._camMode === 'cockpit' && e.target.tagName === 'CANVAS') {
        this._cockpitView.dragging = true;
        this._cockpitView.lx = e.clientX;
        this._cockpitView.ly = e.clientY;
        e.preventDefault();
      }
    };
    this._onMouseUp = (e) => { if (e.button === 0) this._cockpitView.dragging = false; };
    this._onMouseMove = (e) => {
      if (!this._cockpitView.dragging) return;
      const dx = e.clientX - this._cockpitView.lx;
      const dy = e.clientY - this._cockpitView.ly;
      this._cockpitView.lx = e.clientX;
      this._cockpitView.ly = e.clientY;
      this._cockpitView.yaw   -= dx * 0.005;
      this._cockpitView.pitch -= dy * 0.005;
      this._cockpitView.pitch = THREE.MathUtils.clamp(this._cockpitView.pitch, -0.6, 0.6);
      this._cockpitView.yaw   = THREE.MathUtils.clamp(this._cockpitView.yaw, -0.9, 0.9);
    };
    window.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
  }

  _onResizeFn() {
    this.ctx.camera.aspect = innerWidth / innerHeight;
    this.ctx.camera.updateProjectionMatrix();
    this.ctx.renderer.setSize(innerWidth, innerHeight);
  }

  _handleKey(e) {
    switch (e.code) {
      case 'KeyC': if (!this._paused) this._toggleMainCam(); break;
      case 'KeyV': if (!this._paused) this._cycleObserve(); break;
      case 'KeyM': this.ctx.audio.toggleMute(); break;
      case 'Escape': this._togglePause(); break;
    }
  }

  _toggleMainCam() {
    if (this._camMode === 'cockpit') {
      this._camMode = 'chase';
      this.player.aimLift = 0;
    } else {
      this._camMode = 'cockpit';
      this.player.aimLift = this._aimLiftCockpit;
    }
  }

  _cycleObserve() {
    if (this._camMode !== 'observe') {
      this._camMode = 'observe';
      this._observeIdx = 0;
    } else {
      this._observeIdx = (this._observeIdx + 1) % OBSERVE_MODES.length;
    }
  }

  // ---------- 暂停 ----------
  _togglePause() {
    if (this._paused) this._doResume();
    else if (this._running) this._doPause();
  }

  _doPause() {
    this._paused = true;
    this._running = false;
    this.ctx.audio.stopEngine();
    this.ctx.audio.updateFiring(false);
    this._showPauseMenu();
  }

  _doResume() {
    this._paused = false;
    this._hidePauseMenu();
    this._running = true;
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
    ov.querySelectorAll('.toggle').forEach((t) => {
      t.addEventListener('click', () => {
        const key = t.dataset.setting;
        const newVal = !t.classList.contains('on');
        t.classList.toggle('on', newVal);
        s.set(key, newVal);
      });
    });
    ov.querySelector('[data-action="resume"]').addEventListener('click', () => this._doResume());
    ov.querySelector('[data-action="quit"]').addEventListener('click', () => {
      this._hidePauseMenu();
      this.stop();
    });
  }

  _hidePauseMenu() {
    if (this._pauseOverlay) { this._pauseOverlay.remove(); this._pauseOverlay = null; }
  }

  _onPlayerDead() {
    if (this._playerDeadNotified) return;
    this._playerDeadNotified = true;
    this._running = false;
    if (this.callbacks.onPlayerDead) this.callbacks.onPlayerDead();
  }

  /** 关卡统计数据 */
  getStats() {
    return {
      killed: this.killed,
      target: this.target,
      time: this._elapsed || 0,
      hp: this.player ? this.player.hp : 0,
      maxHp: this.player ? this.player.maxHp : 100,
    };
  }

  pause() { this._running = false; }
  resume() { this._running = true; }

  // ---------- 生命周期 ----------
  stop() {
    if (this._disposed) return;
    this._disposed = true;
    this._running = false;
    cancelAnimationFrame(this._rafId);

    this._hidePauseMenu();
    if (this.ctx.audio) { this.ctx.audio.clearFireSamples(); this.ctx.audio.clearGroupFireSamples(); }

    // 清理喷气尾流特效（如有，jetNozzles 机型）
    if (this._jetExhaust) { this._jetExhaust.dispose(); this._jetExhaust = null; }
    // 清理喷气油门管理器（如有，jetThrottle 机型；无 DOM，仅引用）
    this._jetGov = null;
    // 恢复引擎音类型为活塞 + 清除文件引擎音（隔离：jet/文件引擎仅喷气机型生效）
    if (this.ctx.audio && this.ctx.audio.setEngineType) this.ctx.audio.setEngineType('piston');
    if (this.ctx.audio && this.ctx.audio.clearEngineSound) this.ctx.audio.clearEngineSound();

    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._onContextMenu) window.removeEventListener('contextmenu', this._onContextMenu);
    if (this._onMouseDown) window.removeEventListener('mousedown', this._onMouseDown);
    if (this._onMouseUp) window.removeEventListener('mouseup', this._onMouseUp);
    if (this._onMouseMove) window.removeEventListener('mousemove', this._onMouseMove);

    // 释放敌机
    for (const en of this.enemies) this._disposeAircraft(en);
    this.enemies = [];
    // 释放玩家
    this._disposeAircraft(this.player);

    if (this.hud) { this.hud.unmount(); this.hud = null; }
    if (this.controls) { this.controls.dispose(); this.controls = null; }
    if (this.radar) { this.radar.dispose(); this.radar = null; }

    this.ctx.camera.up.set(0, 1, 0);
    delete window.__aircraft;
    delete window.__freeRuntime;

    this.ctx.shell.setGameRunning(false);
    if (this.callbacks.onStop) this.callbacks.onStop();
  }

  /** 释放单个飞机实例资源（独立实现，与 GameRuntime._disposeAircraft 同模式）*/
  _disposeAircraft(ac) {
    if (!ac) return;
    if (ac.mixer) ac.mixer.stopAllAction();
    for (const p of ac._explosions) ac.scene.remove(p.mesh);
    for (const s of ac._damageSmoke) ac.scene.remove(s.mesh);
    for (const f of ac._damageFire) ac.scene.remove(f.mesh);
    for (const d of ac._debris) ac.scene.remove(d.mesh);
    if (ac.weapons) {
      for (const b of ac.weapons.bullets) ac.scene.remove(b.mesh);
      for (const f of ac.weapons.flashes) ac.scene.remove(f.sprite);
      for (const s of ac.weapons.sparks) ac.scene.remove(s.sprite);
      for (const s of ac.weapons.smokes) ac.scene.remove(s.sprite);
      for (const d of ac.weapons.debris) ac.scene.remove(d.mesh);
      ac.weapons.bulletGeo?.dispose();
      ac.weapons.bulletMat?.dispose();
      ac.weapons.flashTex?.dispose();
      ac.weapons.smokeTex?.dispose();
      ac.weapons.sparkTex?.dispose();
      ac.weapons.debrisGeo?.dispose();
    }
    // model 材质壳：仅 dispose 实例克隆的材质本身（material.dispose() 不影响共享贴图）。
    // geometry 与 .map 贴图是 SkeletonUtils.clone 共享资源（同型存活机与 _gltfCache 模板共用），
    // 实例释放时不得 dispose（与 GameRuntime._disposeAircraft 同模式；共享资源由模型缓存统一管）。
    if (ac.model) {
      ac.model.traverse((o) => {
        if (o.isMesh && o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
    }
    ac.scene.remove(ac.root);
  }
}