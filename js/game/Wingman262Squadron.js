import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { WingmanJetTrail } from './WingmanJetTrail.js';

/**
 * 第4关《柏林保卫战》友军 Me 262 僚机小队（完全独立 AI，与其他关 Enemy AI 零共享）。
 *
 * 隔离原则：Wingman262 extends Enemy 仅复用"模型加载/武器/校准"底层
 * （MODEL_CONFIGS['/model/me_262.glb']），永不调用 Enemy 的 AI think/updateAll——
 * 行为全部自管（运动学转向，不走街机物理）。
 *
 * 行为两状态：
 *   formation 编队跟随：指尖编队槽位追踪（左1右2，玩家为长机）；
 *     任一敌军（B-17/敌机）距编队 < breakDist（1500m）→ 全小队永久解除（不恢复）。
 *   hunt 自由猎杀：优先 B-17、无视 P-51（仅规避）。6 种攻击模式按权重随机：
 *     dive      高空俯冲穿过编队到下方 500-700m → 外侧拉起重选（15%）
 *     lowGun    下方向上射击 → 随机横向飞走不穿越编队（20%）
 *     beam      横向 15-30° 掠过编队扫射 → 掠过后拉起（20%）
 *     crossRear 后方斜向穿越编队从上至下，前飞 800m+ 拉起（5%）
 *     hitRun    蜻蜓点水：单轮短点射，打完就跑（15%）
 *     orbit     编队上方 1000-1500m 盘旋觅敌 8-15s（25%）
 *   evade 规避：敌机在我后半球 < evadeDist（200m）→ 极速拉开 > evadeExit（600m）→ 重选模式。
 *
 * 表演性质：僚机子弹无任何命中检测路径（GameRuntime 只检测 玩家子弹vs敌机、
 * 敌机子弹vs玩家），僚机自身也不被检测受击；B-17 炮塔把僚机当正常目标（最近优先）。
 */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _pv = new THREE.Vector3();   // 僚机标记投影用

const PATTERN_KEYS = ['dive', 'lowGun', 'beam', 'crossRear', 'hitRun', 'orbit'];
const DEFAULT_WEIGHTS = { dive: 15, lowGun: 20, beam: 20, crossRear: 5, hitRun: 15, orbit: 25 };

function _pickWeighted(weights) {
  let total = 0;
  for (const k of PATTERN_KEYS) total += (weights[k] ?? 0);
  let r = Math.random() * total;
  for (const k of PATTERN_KEYS) {
    r -= (weights[k] ?? 0);
    if (r <= 0) return k;
  }
  return 'orbit';
}

/** 在编存活轰炸机（可攻击目标） */
function _attackable(b) {
  return b && b.ready && !b._falling && !b._rtb && !b._slowCrash && !b._despawnRequested;
}

export class Wingman262 extends Enemy {
  /**
   * @param opts { slot: THREE.Vector3（body frame 槽位）, cfg: wingmen262 配置 }
   */
  constructor(scene, renderer, player, opts) {
    super(scene, renderer, player);
    this._slot = opts.slot;
    this._cfg = opts.cfg || {};
    this._vel = new THREE.Vector3(0, 0, -150);
    this._speed = 150;
    this._roll = 0;
    this._maxSpeed = 240;
    this._minSpeed = 80;
    this._wmState = 'formation';   // formation | hunt | evade | trail
    this._pattern = null;
    this._phase = 'ingress';       // ingress | attack | exit | orbit
    this._phaseT = 0;
    this._target = null;
    this._wp = new THREE.Vector3();      // 当前航点
    this._exitWp = new THREE.Vector3();
    this._orbitUntil = 0;
    this._fireOn = false;
    this._fireT = 0;
    this._evadeFrom = new THREE.Vector3();
    // 高度微扰（262 飞行平稳，只叠低频小幅高度浮动；差量叠加防瞬跳）
    this._wt = Math.random() * 20;          // 扰动时钟（随机相位）
    this._wobF = 0.5 + Math.random() * 0.5; // 频率 rad/s
    this._wobAmp = 3 + Math.random() * 2;   // 幅度 ±3-5m
    // 首帧从 0 差量开始（防出生瞬间高度瞬跳；formation 幅度减半故 ×0.5）
    this._lastWob = Math.sin(this._wt * this._wobF) * this._wobAmp * 0.5;
    this._smoothWp = null;                  // 编队槽位平滑点（lazy）
    // 双发喷气尾流（简化版 WingmanJetTrail：纯软粒子喷流，无热浪锥/辉光，寿命加长）
    this._nozzleL = new THREE.Vector3(-7.30, -2.80, 6.04);  // 同机型 playerConfig.jetNozzles
    this._nozzleR = new THREE.Vector3(7.30, -2.80, 6.04);
    this._trail = null;
    this._trailCamera = opts.trailCamera || null;
    this._trailRenderer = opts.trailRenderer || null;
    this._rails = false;   // 过场轨载（Squadron 每帧写入）：编队钉死槽位，零调整零抖动
  }

  async load(url, onProgress) {
    const r = await super.load(url, onProgress);
    // 武器组：4×MK108 前射（纯表演曳光，无命中路径）
    this.weapons.setEnemyMuzzleGroups([{ name: 'mk108', indices: [0, 1, 2, 3], fireRate: 0.15 }]);
    this.weapons.bulletSpeed = 650;
    this.weapons.life = 1.6;
    if (this.muzzleDirs) for (const d of this.muzzleDirs) d.set(0, 0, -1);
    // 高空关卡无阴影接收面（同 B-17 #63 优化）
    this.model.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    // 双发喷气尾流：一架飞机左右喷口共 1 个 THREE.Points = 1 次 draw call
    this._trail = new WingmanJetTrail(this.scene, this, [this._nozzleL, this._nozzleR],
      Object.assign({ camera: this._trailCamera, renderer: this._trailRenderer }, this._cfg.trail || {}));
    return r;
  }

  // ---------- 主更新（自管，永不走 Enemy AI） ----------
  updateAll(dt, player, env) {
    if (!this.ready || !this.root) return;
    if (player) this._player = player;
    this._fireOn = false;
    this._wt += dt;

    // 过场轨载（开场推镜期间且仍在编队状态）：钉死槽位，不做任何动态修正
    const rails = this._rails && this._wmState === 'formation';
    if (rails) {
      this._updateRails(dt);
    } else if (this._wmState === 'formation') {
      this._updateFormation(dt);
    } else if (this._wmState === 'evade') {
      this._updateEvade(dt, env);
    } else if (this._wmState === 'trail') {
      this._updateTrail(dt);
    } else {
      this._updateHunt(dt, env);
    }

    // 高度微扰（差量叠加；仅 hunt/trail 等自由状态施加——编队/轨载状态平飞钉队形零扰动。
    // _lastWob 始终跟踪当前全幅值：解除编队瞬间差量从 0 连续起步，不瞬跳）
    if (!rails) {
      const wob = Math.sin(this._wt * this._wobF) * this._wobAmp;
      if (this._wmState !== 'formation') {
        this.root.position.y += wob - this._lastWob;
      }
      this._lastWob = wob;
    }

    // 双发喷气尾流（纯粒子，常开）
    if (this._trail) this._trail.update(dt);
    this.weapons.setGroupFiring('mk108', this._fireOn);
    this.weapons.update(dt, this._fireOn);
  }

  /** 资源清理（Squadron.dispose 在 _disposeAircraft 前调用） */
  dispose() {
    if (this._trail) { this._trail.dispose(); this._trail = null; }
  }

  // ---------- 运动学转向核心 ----------
  /**
   * 朝目标点限速转向飞行。turnDeg/s 限制航向变化率（重型喷气机不做急转），
   * 速度限速加减速；姿态（俯仰/偏航/压坡）由实际速度方向重建——视觉永远跟运动一致。
   */
  _steerTo(dt, targetPos, speed, turnDeg = 40) {
    const pos = this.root.position;
    _v1.copy(targetPos).sub(pos);
    const dist = _v1.length();
    if (dist < 1) return 0;
    _v1.multiplyScalar(1 / dist);

    _v2.copy(this._vel).normalize();
    const angle = _v2.angleTo(_v1);
    let applied = 0, sign = 0;
    if (angle > 1e-4) {
      const maxTurn = THREE.MathUtils.degToRad(turnDeg) * dt;
      applied = Math.min(angle, maxTurn);
      _v5.copy(_v2).cross(_v1);                     // 转向轴（y 符号=左右转）
      sign = _v5.y >= 0 ? 1 : -1;
      _v2.lerp(_v1, Math.min(1, maxTurn / angle)).normalize();
    }
    // 速度大小限速逼近
    this._speed += THREE.MathUtils.clamp(speed - this._speed, -35 * dt, 28 * dt);
    this._vel.copy(_v2).multiplyScalar(this._speed);
    pos.addScaledVector(this._vel, dt);

    // 姿态重建：偏航/俯仰随速度方向，压坡随实际转弯率
    const yaw = Math.atan2(-_v2.x, -_v2.z);
    const pitch = Math.asin(THREE.MathUtils.clamp(_v2.y, -1, 1));
    const turnRate = applied / Math.max(dt, 1e-4);  // rad/s
    const targetRoll = THREE.MathUtils.clamp(-sign * turnRate * 0.9, -0.85, 0.85);
    this._roll += THREE.MathUtils.clamp(targetRoll - this._roll, -0.6 * dt, 0.6 * dt);
    this.root.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, this._roll, 'YXZ'));
    return dist;
  }

  // ---------- formation：指尖编队槽位跟随（平滑点带平移前馈 + 带符号速度修正 + 到位死区） ----------
  _updateFormation(dt) {
    const p = this._player;
    if (!p || !p.root) return;
    const fwd = p.getForward();
    const base = p.speed || 150;
    _v3.copy(this._slot).applyQuaternion(p.root.quaternion).add(p.root.position);
    // 槽位点低通平滑（λ=5/s，滤长机姿态微动）+ 平移前馈：指数低通追踪以 150m/s
    // 平移的槽位会沿航向稳态滞后 ≈ v/λ（~30m），僚机追滞后点永远坠在槽位后
    // 持续修正（开局"调整位置"+微震根因）；前馈 v×(1/λ) 后平滑点不滞后。
    if (!this._smoothWp) this._smoothWp = new THREE.Vector3().copy(_v3);
    _v3.addScaledVector(fwd, base * 0.2);   // 前馈 = v × (1/λ)，1/λ = 0.2s
    this._smoothWp.lerp(_v3, 1 - Math.exp(-dt * 5));
    _v4.copy(this._smoothWp).sub(this.root.position);
    const dist = _v4.length();
    if (dist < 12) {
      // 到位死区：不再追"槽位前方延伸点"（追点会对扰动残差持续修姿态 = 微震源）。
      // 速度方向对齐长机前向 + 残差极缓回拉（err/83 弧度量级，秒级收敛、姿态近似不动）。
      _v5.copy(this.root.position).addScaledVector(fwd, 100).addScaledVector(_v4, 1.2);
      this._steerTo(dt, _v5, base, 6);
    } else {
      // 沿航向带符号修正：落后(along>0)加速追 / 超前(along<0)减速回——纯距离正修正会跑飞
      const along = _v4.dot(fwd);
      const spd = THREE.MathUtils.clamp(base + along * 0.6, this._minSpeed, this._maxSpeed * 0.92);
      this._steerTo(dt, this._smoothWp, spd, 30);
    }
  }

  /**
   * 过场轨载（开场推镜期间）：僚机钉死在指尖槽位——位置/姿态/速度全同步长机，
   * 无任何动态修正（开场就是固定编队）；平滑点与扰动时钟同步到当前值，交还动态后零跳变。
   */
  _updateRails(dt) {
    const p = this._player;
    if (!p || !p.root) return;
    _v3.copy(this._slot).applyQuaternion(p.root.quaternion).add(p.root.position);
    this.root.position.copy(_v3);
    this.root.quaternion.copy(p.root.quaternion);
    this._speed = p.speed || this._speed;
    this._vel.copy(p.getForward()).multiplyScalar(this._speed);
    this._roll = 0;
    if (!this._smoothWp) this._smoothWp = new THREE.Vector3();
    this._smoothWp.copy(_v3);
    this._lastWob = Math.sin(this._wt * this._wobF) * this._wobAmp * 0.5;
  }

  // ---------- trail：无 B-17 可打时松散跟随玩家（不恢复指尖编队） ----------
  _updateTrail(dt) {
    const p = this._player;
    if (!p || !p.root) return;
    _v3.copy(this._slot).multiplyScalar(2.5).applyQuaternion(p.root.quaternion).add(p.root.position);
    const dist = _v3.distanceTo(this.root.position);
    this._steerTo(dt, _v3, dist > 400 ? this._maxSpeed * 0.9 : (p.speed || 150), 35);
  }

  // ---------- evade：被敌机尾随 <200m → 极速拉开 >600m ----------
  _checkEvade(env) {
    // 威胁源：波次敌机 + P-51 护航编队（escorts 仅 escortP51 关卡注入，其他关为空）
    const enemies = env.enemies || [];
    const escorts = env.escorts || [];
    const cfg = this._cfg;
    const evadeDistSq = (cfg.evadeDist ?? 200) ** 2;
    const fwd = this.getForward();
    for (const list of [enemies, escorts]) {
      for (const e of list) {
        if (!e || !e.ready || !e.root || e.crashed || e._exploded) continue;
        _v1.copy(e.root.position).sub(this.root.position);
        const d2 = _v1.lengthSq();
        if (d2 > evadeDistSq) continue;
        // 后半球：敌机方向与本机前向点积 < 0.2（正后方扇区）
        _v1.normalize();
        if (fwd.dot(_v1) < 0.2) {
          this._wmState = 'evade';
          this._evadeFrom.copy(e.root.position);
          this._stopFire();
          return true;
        }
      }
    }
    return false;
  }

  _updateEvade(dt, env) {
    // 直线拉开（方向 = 远离威胁点，保持当前高度带）
    _v1.copy(this.root.position).sub(this._evadeFrom);
    _v1.y = 0;
    if (_v1.lengthSq() < 1) _v1.copy(this.getForward());
    _v1.normalize();
    _v3.copy(this.root.position).addScaledVector(_v1, 800);
    this._steerTo(dt, _v3, this._maxSpeed, 50);
    const d2 = this.root.position.distanceToSquared(this._evadeFrom);
    const exit = this._cfg.evadeExit ?? 600;
    if (d2 > exit * exit) {
      this._wmState = 'hunt';
      this._rollPattern(env);
    }
  }

  // ---------- hunt：自由猎杀（6 模式加权随机） ----------
  _updateHunt(dt, env) {
    // 规避判定优先
    if (this._checkEvade(env)) return;
    // 目标有效性
    if (!_attackable(this._target)) {
      const next = this._pickTarget(env);
      if (!next) { this._wmState = 'trail'; this._pattern = null; return; }
      this._target = next;
      if (!this._pattern) this._rollPattern(env);
    }
    if (!this._pattern) this._rollPattern(env);

    this._phaseT += dt;
    // 全局超时兜底：任何模式 14s 未完结强制重选（防卡死/越飞越远）
    if (this._phaseT > 14) { this._finishPattern(env); return; }
    switch (this._pattern) {
      case 'dive': this._pDive(dt, env); break;
      case 'lowGun': this._pLowGun(dt, env); break;
      case 'beam': this._pBeam(dt, env); break;
      case 'crossRear': this._pCrossRear(dt, env); break;
      case 'hitRun': this._pHitRun(dt, env); break;
      default: this._pOrbit(dt, env); break;
    }
  }

  _pickTarget(env) {
    const list = (env.bombers || []).filter(_attackable);
    if (!list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  _rollPattern(env) {
    this._pattern = _pickWeighted(this._cfg.patternWeights || DEFAULT_WEIGHTS);
    this._phase = 'ingress';
    this._phaseT = 0;
    this._fireT = 0;
    this._setupIngress(env);
  }

  _finishPattern(env) {
    this._pattern = null;
    this._phase = 'ingress';
    this._phaseT = 0;
    this._target = null;
  }

  _stopFire() { this._fireOn = false; }

  /** 编队中心与航向（在编存活机均值；无则返回 false） */
  _formationCenter(env, out, outDir) {
    const list = (env.bombers || []).filter(_attackable);
    if (!list.length) return false;
    out.set(0, 0, 0);
    for (const b of list) out.add(b.root.position);
    out.multiplyScalar(1 / list.length);
    if (outDir) list[0].getForward && outDir.copy(list[0].getForward());
    return true;
  }

  /** 各模式进入点计算（紧凑版：全部收在编队周边几百米内，保证攻击循环 8-15s 一轮） */
  _setupIngress(env) {
    const t = this._target;
    if (!t) return;
    const tp = t.root.position;
    const cOk = this._formationCenter(env, _v4, _v5);
    const center = cOk ? _v4 : tp;
    const dir = cOk ? _v5 : _v1.set(-1, 0, 0);   // 编队航向（西飞 ≈ -x）
    switch (this._pattern) {
      case 'dive':        // 目标前上方 650m（紧凑俯冲入口）
        this._wp.copy(tp).addScaledVector(dir, 350).add(_v1.set(0, 650, 0));
        break;
      case 'lowGun':      // 目标前下方 450m
        this._wp.copy(tp).addScaledVector(dir, 300).add(_v1.set(0, -450, 0));
        break;
      case 'beam': {      // 编队侧方 650m（同高度，随机左右舷）
        const side = Math.random() < 0.5 ? 1 : -1;
        _v1.set(0, 1, 0).cross(dir).normalize();  // 侧向
        this._wp.copy(center).addScaledVector(_v1, side * 650);
        this._wp.y = tp.y;
        break;
      }
      case 'crossRear':   // 编队后方 600m + 上方 400m
        this._wp.copy(center).addScaledVector(dir, -600).add(_v1.set(0, 400, 0));
        break;
      case 'hitRun':      // 直接从当前位置进击
        this._wp.copy(tp);
        break;
      default:            // orbit：编队上方 600-900m
        this._wp.copy(center).add(_v1.set(0, 600 + Math.random() * 300, 0));
        this._orbitUntil = 5 + Math.random() * 3;
        break;
    }
  }

  /** 开火窗口判定：对准目标（含提前量）且 80-900m 内 → 表演射击 */
  _tryFire(dt, aimPos) {
    _v1.copy(aimPos).sub(this.root.position);
    const dist = _v1.length();
    _v1.multiplyScalar(1 / Math.max(dist, 1e-4));
    const cosA = this.getForward().dot(_v1);
    if (cosA > 0.994 && dist < 900 && dist > 80) this._fireOn = true;
  }

  /** 目标提前量点（弹速 650 估算；纯表演，粗略即可） */
  _leadPoint(t, out) {
    out.copy(t.root.position);
    const dist = out.distanceTo(this.root.position);
    const tof = dist / 650;
    if (t.getVelocity) out.addScaledVector(t.getVelocity(), tof);
    return out;
  }

  // ---------- 六模式（紧凑尺度：攻击循环 8-15s 一轮，编队周边高密度穿梭） ----------
  /** (1) 高空俯冲：穿过编队到下方 ~350m → 外侧拉起重选 */
  _pDive(dt, env) {
    const t = this._target;
    if (this._phase === 'ingress') {
      if (this._steerTo(dt, this._wp, this._maxSpeed * 0.9, 45) < 250) this._phase = 'attack';
    } else if (this._phase === 'attack') {
      this._leadPoint(t, _v3);
      this._steerTo(dt, _v3, this._maxSpeed, 60);
      this._tryFire(dt, _v3);
      // 穿过编队到下方 350m → 脱离
      if (this.root.position.y < t.root.position.y - 350) {
        this._phase = 'exit';
        _v1.set(0, 1, 0).cross(this.getForward()).normalize();
        this._exitWp.copy(this.root.position).addScaledVector(_v1, (Math.random() < 0.5 ? 1 : -1) * 500);
        this._exitWp.y += 200;
      }
    } else {
      if (this._steerTo(dt, this._exitWp, this._maxSpeed * 0.85, 40) < 200) this._finishPattern(env);
    }
  }

  /** (2) 下方向上射击：拉起仰射 → 随机横向飞走（不穿越编队） */
  _pLowGun(dt, env) {
    const t = this._target;
    if (this._phase === 'ingress') {
      if (this._steerTo(dt, this._wp, this._maxSpeed * 0.85, 45) < 250) this._phase = 'attack';
    } else if (this._phase === 'attack') {
      this._leadPoint(t, _v3);
      this._steerTo(dt, _v3, this._maxSpeed * 0.9, 55);
      this._tryFire(dt, _v3);
      // 接近到目标 350m 内 → 横向随机脱离（保持低于编队，不穿越）
      if (this.root.position.distanceToSquared(t.root.position) < 350 * 350) {
        this._phase = 'exit';
        const turn = (Math.random() < 0.5 ? 1 : -1) * (90 + Math.random() * 60);
        _v1.copy(this.getForward());
        _v2.set(0, 1, 0);
        _v1.applyAxisAngle(_v2, THREE.MathUtils.degToRad(turn));
        _v1.y = -0.1;  // 略向下，保证不穿越编队
        _v1.normalize();
        this._exitWp.copy(this.root.position).addScaledVector(_v1, 500);
      }
    } else {
      if (this._steerTo(dt, this._exitWp, this._maxSpeed * 0.85, 50) < 200) this._finishPattern(env);
    }
  }

  /** (3) 横向 15-30° 掠过编队扫射 → 掠过后拉起 */
  _pBeam(dt, env) {
    const t = this._target;
    if (this._phase === 'ingress') {
      if (this._steerTo(dt, this._wp, this._maxSpeed * 0.9, 45) < 250) this._phase = 'attack';
    } else if (this._phase === 'attack') {
      this._leadPoint(t, _v3);
      this._steerTo(dt, _v3, this._maxSpeed, 55);
      this._tryFire(dt, _v3);
      // 掠过目标后（已在目标侧后方）→ 拉起脱离
      _v1.copy(t.root.position).sub(this.root.position);
      if (this.getForward().dot(_v1.normalize()) < 0.2) {
        this._phase = 'exit';
        this._exitWp.copy(this.root.position).addScaledVector(this.getForward(), 450);
        this._exitWp.y += 250;   // 拉起
      }
    } else {
      if (this._steerTo(dt, this._exitWp, this._maxSpeed * 0.85, 40) < 200) this._finishPattern(env);
    }
  }

  /** (4) 后方斜向穿越编队（从上至下），前飞 500m 拉起 */
  _pCrossRear(dt, env) {
    const t = this._target;
    if (this._phase === 'ingress') {
      if (this._steerTo(dt, this._wp, this._maxSpeed * 0.9, 45) < 300) this._phase = 'attack';
    } else if (this._phase === 'attack') {
      _v3.copy(t.root.position);
      _v3.y -= 250;   // 从上向下斜穿
      this._steerTo(dt, _v3, this._maxSpeed, 55);
      this._tryFire(dt, _v3);
      if (this.root.position.y < t.root.position.y - 250) {
        this._phase = 'exit';
        this._exitWp.copy(this.root.position).addScaledVector(this.getForward(), 500);
        this._exitWp.y += 250;   // 前飞 500m 后拉起
      }
    } else {
      if (this._steerTo(dt, this._exitWp, this._maxSpeed * 0.85, 40) < 220) this._finishPattern(env);
    }
  }

  /** (5) 蜻蜓点水：直接进击，短点射一轮即跑 */
  _pHitRun(dt, env) {
    const t = this._target;
    if (this._phase === 'ingress') this._phase = 'attack';
    if (this._phase === 'attack') {
      this._leadPoint(t, _v3);
      this._steerTo(dt, _v3, this._maxSpeed, 55);
      this._tryFire(dt, _v3);
      if (this._fireOn) this._fireT += dt;
      // 点射 ~0.7s 或逼近到 300m → 立即脱离
      if (this._fireT > 0.7 || this.root.position.distanceToSquared(t.root.position) < 300 * 300) {
        this._phase = 'exit';
        _v1.copy(this.getForward());
        _v2.set(0, 1, 0);
        _v1.applyAxisAngle(_v2, THREE.MathUtils.degToRad((Math.random() < 0.5 ? 1 : -1) * (100 + Math.random() * 40)));
        _v1.y = 0.25;  // 边转边拉
        _v1.normalize();
        this._exitWp.copy(this.root.position).addScaledVector(_v1, 450);
      }
    } else {
      if (this._steerTo(dt, this._exitWp, this._maxSpeed * 0.9, 55) < 180) this._finishPattern(env);
    }
  }

  /** (6) 编队上方 600-900m 盘旋觅敌 5-8s（半径 400m） */
  _pOrbit(dt, env) {
    if (!this._formationCenter(env, _v4, _v5)) { this._finishPattern(env); return; }
    if (this._phase === 'ingress') {
      if (this._steerTo(dt, this._wp, this._maxSpeed * 0.8, 40) < 350) { this._phase = 'orbit'; this._phaseT = 0; }
    } else {
      const ang = this._phaseT * (this._cruise || 150) / 400;
      _v3.set(_v4.x + Math.cos(ang) * 400, this._wp.y, _v4.z + Math.sin(ang) * 400);
      this._steerTo(dt, _v3, this._cruise || 150, 35);
      if (this._phaseT > this._orbitUntil) this._finishPattern(env);
    }
  }

  /** 小队解除编队（Squadron 调用，一次性） */
  breakFormation(env) {
    if (this._wmState === 'formation') {
      this._wmState = 'hunt';
      this._rollPattern(env);
    }
  }
}

/**
 * 僚机小队管理：spawn/编队解除判定/每帧推进/清理。
 * GameRuntime 仅 levelConfig.wingmen262 存在时创建（第4关）。
 */
export class Wingman262Squadron {
  constructor(runtime, cfg) {
    this.runtime = runtime;
    this.cfg = cfg;
    this.members = [];
    this.formed = true;   // 编队状态（解除后永久 false）
    this._markerEl = null; // 视野外最近僚机的方块标记（DOM）
  }

  async init() {
    const rt = this.runtime;
    const player = rt.player;
    const cfg = this.cfg;
    const slots = cfg.slots || [[-40, 0, 50], [40, 0, 50], [85, 10, 100]];
    for (let i = 0; i < (cfg.count ?? 3); i++) {
      const slotArr = slots[i % slots.length];
      const w = new Wingman262(rt.ctx.scene, rt.ctx.renderer, player, {
        slot: new THREE.Vector3(slotArr[0], slotArr[1], slotArr[2]),
        cfg,
        trailCamera: rt.ctx.camera,
        trailRenderer: rt.ctx.renderer,
      });
      await w.load(cfg.model);
      // 出生：玩家对应槽位（body frame → 世界）
      const slot = new THREE.Vector3(slotArr[0], slotArr[1], slotArr[2])
        .applyQuaternion(player.root.quaternion).add(player.root.position);
      w.root.position.copy(slot);
      w.root.quaternion.copy(player.root.quaternion);
      w._speed = player.speed || 150;
      w._vel.copy(player.getForward()).multiplyScalar(w._speed);
      this.members.push(w);
    }

    // 视野外僚机方块标记（空心方框，只标"离开视野的最近一架"）
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;width:14px;height:14px;border:2px solid rgba(140,210,255,0.95);'
      + 'box-sizing:border-box;display:none;pointer-events:none;z-index:60;transform:translate(-50%,-50%);';
    document.body.appendChild(el);
    this._markerEl = el;
  }

  /** 视野外最近僚机标记：投影屏幕外才显示，贴屏幕边缘指示方向 */
  _updateMarker() {
    const el = this._markerEl;
    if (!el) return;
    const rt = this.runtime;
    const player = rt.player;
    const cam = rt.ctx.camera;
    if (!player || !player.root || !cam) { el.style.display = 'none'; return; }
    let bestD2 = Infinity, found = false;
    let sx = 0, sy = 0;
    for (const m of this.members) {
      if (!m.ready || !m.root) continue;
      _pv.copy(m.root.position).project(cam);
      const behind = _pv.z > 1;
      const onScreen = !behind && Math.abs(_pv.x) <= 1 && Math.abs(_pv.y) <= 1;
      if (onScreen) continue;   // 在视野内不标
      const d2 = m.root.position.distanceToSquared(player.root.position);
      if (d2 < bestD2) {
        bestD2 = d2;
        let x = _pv.x, y = _pv.y;
        if (behind) { x = -x; y = -y; }   // 背后目标翻正到屏幕对侧方向
        sx = (x * 0.5 + 0.5) * innerWidth;
        sy = (-y * 0.5 + 0.5) * innerHeight;
        found = true;
      }
    }
    if (!found) { el.style.display = 'none'; return; }
    // 贴边内缩 36px
    const cx = Math.max(36, Math.min(innerWidth - 36, sx));
    const cy = Math.max(36, Math.min(innerHeight - 36, sy));
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.display = 'block';
  }

  update(dt) {
    if (!this.members.length) return;
    const rt = this.runtime;
    const player = rt.player;
    const env = { bombers: rt.bomberStream, enemies: rt.enemies, escorts: rt.p51Escort ? rt.p51Escort.planes : null };

    // 编队解除判定（全局一次）：玩家或任一僚机距任一敌军 < breakDist
    if (this.formed) {
      const breakSq = (this.cfg.breakDist ?? 1500) ** 2;
      const aircraft = [player, ...this.members];
      // P-51 护航编队同样触发解除（escortP51 关卡；其他关为空）
      const hostiles = env.escorts ? [...rt.enemies, ...env.escorts] : rt.enemies;
      let broken = false;
      for (const ac of aircraft) {
        if (!ac || !ac.root) continue;
        for (const b of rt.bomberStream) {
          if (_attackable(b) && ac.root.position.distanceToSquared(b.root.position) < breakSq) { broken = true; break; }
        }
        if (broken) break;
        for (const e of hostiles) {
          if (e && e.ready && !e.crashed && !e._exploded
            && ac.root.position.distanceToSquared(e.root.position) < breakSq) { broken = true; break; }
        }
        if (broken) break;
      }
      if (broken) {
        this.formed = false;
        for (const m of this.members) m.breakFormation(env);
      }
    }

    // 过场轨载标志：开场推镜期间僚机钉死槽位（零调整零抖动），过场结束自动交还动态
    const rails = !!(rt._cinematicActive && rt.cinematic && rt.cinematic.active);
    for (const m of this.members) { m._rails = rails; m.updateAll(dt, player, env); }
    this._updateMarker();
  }

  dispose() {
    for (const m of this.members) { m.dispose(); this.runtime._disposeAircraft(m); }
    this.members = [];
    if (this._markerEl) { this._markerEl.remove(); this._markerEl = null; }
  }
}
