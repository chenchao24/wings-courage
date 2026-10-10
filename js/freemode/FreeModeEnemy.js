/**
 * FreeModeEnemy · 自由模式敌机（与战役模式 Enemy 完全隔离）。
 *
 * 铁原则：不 extends Enemy，仅 extends Aircraft（纯机制基类）。
 *   - AI 逻辑独立实现（单机巡逻 + 规避 + 开火，本次迭代先复制 Enemy._thinkSolo 核心行为）
 *   - 模型校准/性能从 js/config/freemode/enemy-aircraft.js 独立读取
 *   - AI 配置（_aiCfg）独立维护，不从 enemy.js 读取
 *
 * 后续迭代可在此文件独立调整 AI 行为，不影响战役三关。
 */

import * as THREE from 'three';
import { Aircraft } from '../aircraft.js';
import { Weapons } from '../weapons.js';
import { getEnemyModelConfig, getEnemyModelSpecs } from '../config/freemode/enemy-aircraft.js';

// 复用临时向量（避免每帧 new）
const _UP = new THREE.Vector3(0, 1, 0);
const _toP = new THREE.Vector3();
const _local = new THREE.Vector3();
const _toT = new THREE.Vector3();
const _localT = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _loiterTarget = new THREE.Vector3();

/**
 * 自由模式单机 AI 基线配置（独立维护，复制自 enemy.js AI_TYPE_CONFIGS.fighter normal）。
 * 未来可在此独立调整，不影响战役模式。
 */
const FREE_AI_BASE = {
  // 舵量上限（AI 输出 clamp）
  maxRoll: 0.7,
  maxPitch: 0.6,
  maxYaw: 0.25,
  // 开火参数
  fire: {
    angleOff: 0.20,      // 正面锥宽（rad），机头基本对准即开火
    distMin: 200,        // 最小开火距离
    distMax: 700,        // 最大开火距离
    burstMin: 0.8,       // 连发最短（秒）
    burstMax: 1.2,       // 连发最长
    cdMin: 1.5,          // 冷却最短
    cdMax: 3.0,          // 冷却最长
  },
  // 巡逻高度
  patrolAltMin: 400,
  patrolAltMax: 1000,
  // 撞地保护
  aglFloor: 120,
  // 规避
  pursuedDist: 350,     // 被咬尾触发规避距离
  evasionChance: 0.015, // 每帧触发概率
  evasionCdMin: 7,      // 规避冷却
  evasionCdMax: 12,
};

export class FreeModeEnemy extends Aircraft {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {Aircraft} player 玩家飞机引用（AI 感知用）
   * @param {object} [difficultyCfg] 难度乘数 {enemyAgilityMul, enemyFireRateMul, enemyDamageMul}
   */
  constructor(scene, renderer, player, difficultyCfg = {}) {
    super(scene, renderer);
    this._player = player;
    this._difficulty = difficultyCfg;

    // ── 性能默认值（fighter normal；load 时由 _applyModelSpecs 覆盖）──
    this.maxSpeed = 150;
    this.pitchMax = 1.0; this.pitchResp = 5.0;
    this.rollMax = 2.0; this.rollResp = 6.0;
    this.yawMax = 0.6; this.yawResp = 3.5;
    this.cruiseSpeed = 80;

    // ── 血量（基础值；FreeModeRuntime 创建后按"原模式一半"规则覆盖 maxHp）──
    this.maxHp = 100;
    this.hp = 100;

    // ── 校准默认值（未知模型用 autoOrient 自动校准）──
    this.autoOrient = true;
    this.yawOffset = 0;
    this.pitchOffset = 0;
    this.rollOffset = 0;
    this.userScale = 3.6;
    this.aimLift = 0; // 敌机用机头直接瞄准

    // 默认枪口（body frame，机头=-Z）：通用 4 挺
    this.muzzleOffsets = [
      new THREE.Vector3( 6.50, -1.35, -4.15),
      new THREE.Vector3(-6.50, -1.35, -4.15),
      new THREE.Vector3( 0.50,  1.00, -7.80),
      new THREE.Vector3(-0.50,  1.00, -7.80),
    ];

    // ── 自带武器（火力略高：射速快于玩家，单发伤害 8-12）──
    this.weapons = new Weapons(scene, this);
    this.weapons.fireRate = 0.06;
    this.weapons.bulletSpeed = 720;
    this.weapons.life = 2.0;
    this.weapons.damageMin = 8;
    this.weapons.damageMax = 12;
    this.weapons.setAudio(null); // 敌机开火不播玩家音效

    // ── AI 状态 ──
    this._waypoints = [];
    this._wpIdx = 0;
    this._wpReady = false;
    this._patrolCenter = new THREE.Vector3();
    this._evadeTimer = 0;
    this._evadeCd = 0;
    this._evadeRoll = 1;
    this._fireTimer = 0;
    this._fireCd = 0;
    this.ready = false;
    this.autoRespawn = false; // 自由模式：坠毁后不自动重生，由 FreeModeRuntime 管理

    // ── AI 配置（合成：基线 × 难度乘数）──
    this._aiCfg = this._buildAiCfg();
  }

  /** 合成本机 AI 配置（基线 × 难度乘数） */
  _buildAiCfg() {
    const d = this._difficulty;
    const agi = d.enemyAgilityMul || 1.0;
    const fireRateMul = d.enemyFireRateMul || 1.0;
    const base = FREE_AI_BASE;
    return {
      maxRoll: base.maxRoll,
      maxPitch: base.maxPitch,
      maxYaw: base.maxYaw,
      fire: {
        angleOff: base.fire.angleOff,
        distMin: base.fire.distMin,
        distMax: base.fire.distMax,
        burstMin: base.fire.burstMin,
        burstMax: base.fire.burstMax,
        cdMin: base.fire.cdMin * fireRateMul,
        cdMax: base.fire.cdMax * fireRateMul,
      },
      patrolAltMin: base.patrolAltMin,
      patrolAltMax: base.patrolAltMax,
      aglFloor: base.aglFloor,
      pursuedDist: base.pursuedDist,
      evasionChance: base.evasionChance,
      evasionCdMin: base.evasionCdMin,
      evasionCdMax: base.evasionCdMax,
      // 难度乘数（_applyModelSpecs 时用）
      _agiMul: agi,
    };
  }

  async load(url) {
    this._applyModelConfig(url);
    this._applyModelSpecs(url);
    await super.load(url);
    this.ready = true;
    this.reset();
  }

  /** 应用模型校准参数（外观：朝向/缩放/枪口/起落架），从自由模式独立配置读取 */
  _applyModelConfig(url) {
    const cfg = getEnemyModelConfig(url);
    if (!cfg) return;
    if (cfg.autoOrient !== undefined) this.autoOrient = cfg.autoOrient;
    if (cfg.noVaporTrail !== undefined) this.noVaporTrail = cfg.noVaporTrail;
    if (cfg.yawOffset !== undefined) this.yawOffset = cfg.yawOffset;
    if (cfg.pitchOffset !== undefined) this.pitchOffset = cfg.pitchOffset;
    if (cfg.rollOffset !== undefined) this.rollOffset = cfg.rollOffset;
    if (cfg.userScale !== undefined) this.userScale = cfg.userScale;
    if (cfg.centerOffset) this.centerOffset = cfg.centerOffset.slice();
    if (cfg.muzzleOffsets) this.muzzleOffsets = cfg.muzzleOffsets.map((v) => v.clone());
    if (cfg.hideGear !== undefined) this._hideGear = cfg.hideGear;
    if (cfg.hideGearNodes) this._hideGearNodes = cfg.hideGearNodes.slice();
    if (cfg.propNodes) this._propNodes = cfg.propNodes.slice();
    if (cfg.propSpinSpeed !== undefined) this._propSpinSpeed = cfg.propSpinSpeed;
    if (cfg.propOpacity !== undefined) this._propOpacity = cfg.propOpacity;
    if (cfg.propBlurDisc !== undefined) this._propBlurDisc = cfg.propBlurDisc;
    if (cfg.propBlurStrength !== undefined) this._propBlurStrength = cfg.propBlurStrength;
    if (cfg.propAxisTilt) this._propAxisTilt = { ...cfg.propAxisTilt };
    if (cfg.propPivotOffset) this._propPivotOffset = { ...cfg.propPivotOffset };
  }

  /** 应用机型性能参数（飞行：速度/机动/HP），从自由模式独立配置读取 */
  _applyModelSpecs(url) {
    const specs = getEnemyModelSpecs(url);
    if (!specs) return;
    const agi = this._aiCfg._agiMul || 1.0;
    if (specs.maxSpeed !== undefined) this.maxSpeed = specs.maxSpeed;
    if (specs.cruiseSpeed !== undefined) this.cruiseSpeed = specs.cruiseSpeed;
    if (specs.maxHp !== undefined) this.maxHp = specs.maxHp; // 基础值；FreeModeRuntime 会再按"一半"规则覆盖
    if (specs.pitchMax !== undefined) this.pitchMax = specs.pitchMax * agi;
    if (specs.pitchResp !== undefined) this.pitchResp = specs.pitchResp * agi;
    if (specs.rollMax !== undefined) this.rollMax = specs.rollMax * agi;
    if (specs.rollResp !== undefined) this.rollResp = specs.rollResp * agi;
    if (specs.yawMax !== undefined) this.yawMax = specs.yawMax * agi;
    if (specs.yawResp !== undefined) this.yawResp = specs.yawResp * agi;
    if (specs.stallThreshold !== undefined) this.stallThreshold = specs.stallThreshold;
    if (specs.liftK !== undefined) this.liftK = specs.liftK;
    // 应用难度伤害乘数到武器
    const dmgMul = this._difficulty.enemyDamageMul || 1.0;
    if (this.weapons && dmgMul !== 1.0) {
      this.weapons.damageMin = 8 * dmgMul;
      this.weapons.damageMax = 12 * dmgMul;
    }
  }

  /** 重置敌机状态（出生位置 + 清理 AI 计时）*/
  reset() {
    // 清理残留粒子（与 Aircraft.reset 一致）
    for (const p of this._explosions) this.scene.remove(p.mesh);
    this._explosions = [];
    for (const s of this._damageSmoke) this.scene.remove(s.mesh);
    this._damageSmoke = [];
    for (const f of this._damageFire) this.scene.remove(f.mesh);
    this._damageFire = [];
    for (const d of this._debris) this.scene.remove(d.mesh);
    this._debris = [];
    this.crashed = false;
    this._exploded = false;
    this._crashTimer = 0;
    this._crashDamage = 0;
    this._crashFallTime = 0;
    this._crashMode = 'ballistic';
    this._crashSpeed = 0;
    this._crashSinkRate = 0;
    this.crashShake = 0;
    this.hp = this.maxHp;
    if (this.model) this.model.visible = true;
    this.angVel.set(0, 0, 0);
    this.gForce = 1.0;
    this.stall = false;
    this._stallTimer = 0;
    this.throttle = 0.75;
    this.speed = this.cruiseSpeed;

    // 出生位置：玩家前方 3000 米随机方位，高度 2000 附近
    const p = this._player;
    if (p && p.model) {
      const ang = (Math.random() - 0.5) * 1.6;
      const dist = 3000;
      const dir = p.getForward().clone().applyAxisAngle(_UP, ang);
      this.root.position.copy(p.root.position).addScaledVector(dir, dist);
      this.root.position.y = Math.max(800, Math.min(2800, p.root.position.y + (Math.random() - 0.5) * 400));
      this.root.lookAt(p.root.position);
      this.root.rotateY(Math.PI); // 机头(-Z)朝玩家
    } else {
      this.root.position.set(0, 2000, -3000);
      this.root.quaternion.identity();
    }

    this._evadeTimer = 0;
    this._evadeCd = 0;
    this._fireTimer = 0;
    this._fireCd = 0;
    this._wpIdx = 0;
    this._wpReady = false;
  }

  /** 初始化巡逻点（以出生位置为中心半径 850，高度起伏）*/
  _initWaypoints() {
    this._waypoints = [];
    this._patrolCenter = this.root.position.clone();
    const cx = this._patrolCenter.x, cz = this._patrolCenter.z;
    const R = 850, N = 8;
    const altMin = this._aiCfg.patrolAltMin;
    const altMax = this._aiCfg.patrolAltMax;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const alt = altMin + Math.random() * (altMax - altMin);
      this._waypoints.push(new THREE.Vector3(cx + Math.cos(a) * R, alt, cz + Math.sin(a) * R));
    }
    this._wpIdx = 0;
    this._wpReady = true;
  }

  /**
   * AI 大脑：单机巡逻 + 规避 + 开火。
   * 优先级：撞地拉起 > 高度上限下降 > 规避 > 巡逻/靠近 > 开火
   */
  think(dt, player) {
    const input = { pitch: 0, yaw: 0, roll: 0, throttleUp: false, throttleDown: false, fire: false };
    if (this.crashed || !player || !player.model) return input;
    if (!this._wpReady) this._initWaypoints();

    const myPos = this.root.position;
    const groundH = this.terrain ? this.terrain.getHeight(myPos.x, myPos.z) : 0;
    const agl = myPos.y - groundH;
    const cfg = this._aiCfg;
    const fc = cfg.fire;

    // ── 最高优先级：撞地拉起 ──
    if (agl < cfg.aglFloor) {
      input.pitch = 1.0;
      input.throttleUp = true;
      return input;
    }

    // ── 高度上限：超过巡逻高度 +100 强制下降 ──
    if (myPos.y > cfg.patrolAltMax + 100) {
      input.pitch = -0.6;
      return input;
    }

    // ── 玩家相对位置 ──
    _toP.copy(player.root.position).sub(myPos);
    const distP = _toP.length();
    _invQ.copy(this.root.quaternion).invert();
    _local.copy(_toP).applyQuaternion(_invQ);
    const playerBehind = _local.z > 0; // 玩家在身后 = 被咬尾

    // ── 规避冷却 / 规避中 ──
    if (this._evadeCd > 0) this._evadeCd -= dt;
    if (this._evadeTimer > 0) {
      this._evadeTimer -= dt;
      input.roll = this._evadeRoll;
      input.pitch = 0.6;
      input.throttleUp = true;
      return input;
    }
    if (this._evadeCd <= 0 && playerBehind && distP < cfg.pursuedDist && Math.random() < cfg.evasionChance) {
      this._evadeTimer = 1.2 + Math.random() * 0.8;
      this._evadeRoll = Math.random() < 0.5 ? 0.9 : -0.9;
      this._evadeCd = cfg.evasionCdMin + Math.random() * (cfg.evasionCdMax - cfg.evasionCdMin);
      input.roll = this._evadeRoll;
      input.pitch = 0.6;
      input.throttleUp = true;
      return input;
    }

    // ── 选择目标点 ──
    let target;
    const dCenter = Math.hypot(myPos.x - this._patrolCenter.x, myPos.z - this._patrolCenter.z);
    if (distP > 1500) {
      target = player.root.position;            // 玩家太远，向玩家靠近
    } else if (dCenter > 1300) {
      _loiterTarget.set(this._patrolCenter.x, myPos.y, this._patrolCenter.z);
      target = _loiterTarget;                    // 飞离巡逻中心，返回
    } else {
      const wp = this._waypoints[this._wpIdx];
      if (myPos.distanceTo(wp) < 250) {
        this._wpIdx = (this._wpIdx + 1) % this._waypoints.length;
      }
      target = this._waypoints[this._wpIdx];
    }

    // ── 朝目标点飞（巡逻盘旋，温和舵量）──
    _toT.copy(target).sub(myPos);
    const distT = _toT.length();
    _localT.copy(_toT).applyQuaternion(_invQ);
    input.pitch = THREE.MathUtils.clamp(_localT.y / Math.max(80, distT * 0.35), -cfg.maxPitch, cfg.maxPitch);
    input.roll = THREE.MathUtils.clamp(-_localT.x / Math.max(80, distT * 0.5), -cfg.maxRoll, cfg.maxRoll);
    input.yaw = THREE.MathUtils.clamp(-_localT.x / Math.max(120, distT * 0.7), -cfg.maxYaw, cfg.maxYaw);
    // 油门维持巡航
    if (this.speed < this.cruiseSpeed * 0.85) input.throttleUp = true;
    else if (this.speed > this.cruiseSpeed * 1.15) input.throttleDown = true;

    // ── 开火判定 ──
    if (!fc) return input;
    if (this._fireCd > 0) this._fireCd -= dt;
    if (this._fireTimer > 0) this._fireTimer -= dt;
    if (this._fireTimer > 0) {
      input.fire = true;
    } else if (this._fireCd <= 0) {
      if (_local.z < 0 && distP > fc.distMin && distP < fc.distMax) {
        _fwd.copy(this.getForward());
        const angleOff = Math.acos(Math.max(-1, Math.min(1, _fwd.dot(_toP) / distP)));
        if (angleOff < fc.angleOff) {
          input.fire = true;
          this._fireTimer = fc.burstMin + Math.random() * (fc.burstMax - fc.burstMin);
          this._fireCd = fc.cdMin + Math.random() * (fc.cdMax - fc.cdMin);
        }
      }
    }

    return input;
  }

  /** 每帧统一推进：AI 决策 → 物理 → 舵面/动画 → 武器 */
  updateAll(dt, player) {
    if (!this.ready) return;
    const input = this.think(dt, player);
    this.updateFlight(dt, input);   // crashed 时内部自处理坠毁
    this.update(dt);                // 舵面 + 螺旋桨动画
    this.weapons.update(dt, !!input.fire && !this.crashed);
  }

  /** 返回敌机位置（供雷达/碰撞）*/
  getPosition() { return this.root.position; }
}