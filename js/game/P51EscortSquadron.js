import * as THREE from 'three';
import { Enemy } from '../enemy.js';

/**
 * 第4关《柏林保卫战》P-51 护航编队（完全独立 AI，与其他关 Enemy AI 零共享）。
 *
 * 隔离原则：P51Escort extends Enemy 仅复用"模型加载/武器/校准/坠毁"底层
 * （MODEL_CONFIGS['/model/p51.glb']），永不调用 Enemy 的 think/updateAll——
 * 行为全部自管（运动学转向，不走街机物理），同 Wingman262Squadron 模式。
 *
 * 编制：8 架 = 2 中队 × 2 小队 × (长机+僚机)。小队编号 A1/A2（A 中队，上方）/ B1/B2（B 中队，下方）。
 *
 * 小队状态机：
 *   escort    伴飞：钉槽位随 B-17 编队平飞。A 中队 = 编队上方 +400m 靠前；B 中队 = 下方 -400m 靠后。
 *   intercept 拦截（一次性）：任一 262（玩家/AI 僚机一视同仁）与任一在编 B-17 最近距离
 *             ≤ triggerDist(2000m) → A1/A2/B1 同时爬升 interceptAlt(6500m) 对头冲锋
 *             （目标均匀分配、互不重目标）；B2 上移至 A1 原槽位继续伴飞（顶补位）。
 *   engage    猎杀循环：见下"追逐/驱逐规则"。
 *   patrol    无目标：patrolDist(1500m) 内无可选目标 → 编队上方大圈巡行，直到出现候选目标。
 *
 * 追逐/驱逐规则（engage）：
 *   (1) 选目标：selectDist(1000m) 内最近 262；四小队互不重目标（仲裁顺序 A1→A2→B1→B2）。
 *       1000-1500m 死带：接近但不锁定不开火（滞回防边界抖动）。
 *   (2) 开火：接近到 fireOpen(400m) 内且对准（含提前量 5.7°）→ 点射 burstSec + 冷却 cooldownSec。
 *       瞄准/弹道真实（子弹继承本机速度，与玩家炮同规则），但只对玩家结算伤害（2-6/发）；
 *       AI 僚机 262 无命中检测路径（与"僚机子弹无命中路径"的设计一致）。
 *   (3) 放弃：追击超 chaseMaxSec(30s)；目标持续 abandonSec(2s) 超出 abandonDist(600m)；
 *       目标高度出 altBand[3000,7000] 持续 1s（不追低不追高）；本机低于 3000m（自保拉起）。
 *   (4) 放弃后进入 reselectSec(3-6s) 自由盘旋（不锁定不开火）——留给玩家的攻击窗口。
 *
 * 小队协同（pairWeights，每 pairSwitchSec(6-12s) 重掷）：
 *   same  60%：双机同目标，攻击方式各自随机（headOn 对冲 / chase 追逐 / strafe 扫射）
 *   trail 20%：僚机尾随长机后方 100-150m（独立控制律 + 扰动，不镜像长机动作），不开火
 *   free  20%：双机各自自由选目标（释放小队认领，可与其他小队撞车）
 *
 * 对冲错开：越过目标后长僚分头转向（长左僚右 100-140°，2-2.6s）再各自回头接敌。
 *
 * B2 伴飞退出（一次性）：任一 262 距 B2 任一架 ≤ b2Join.selfDist(400m)，
 *   或任一 262 距任一在编 B-17 ≤ b2Join.bomberDist(500m) → B2 加入猎杀池。
 *
 * 防撞规避（最高优先级，任何状态，仅对玩家）：avoid{near/mid/midClosing/far/farClosing/dur}
 *   距离/接近率双阈值触发 → 本机立即放弃当前目标、侧向急转 + 爬升脱离 dur 秒
 *   （若为小队长机且持有小队目标：释放认领 + 小队进 reselect 重选窗口）——绝不追尾/相撞。
 *
 * 伤害/坠毁：玩家子弹命中走 GameRuntime 命中检测块（同波次敌机 <9m 单球近似），
 *   takeDamage → 基类坠毁/爆炸管线；击伤（损失 ≥ damagedAt=55% HP）/击落回流计分
 *   （intercept.p51Damaged/p51Kill）。爆炸计时归零后由 Squadron 统一释放（同 WaveDirector 约定）。
 *
 * GameRuntime 仅在 levelConfig.escortP51 存在时创建（第4关）；自由模式零接触。
 */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
// 姿态重建 scratch（_steerTo 每帧用，即用即弃）
const _e1 = new THREE.Euler();
// 编队质心/航向专用（_slotWorld 等辅助函数内部会用 _v1/_v2，禁止混用别名）
const _center = new THREE.Vector3();
const _dir = new THREE.Vector3();

const FLIGHT_IDS = ['A1', 'A2', 'B1', 'B2'];
const ATTACK_STYLES = ['headOn', 'chase', 'strafe'];

function _rand(range) { return range[0] + Math.random() * (range[1] - range[0]); }
function _rollStyle() { return ATTACK_STYLES[Math.floor(Math.random() * ATTACK_STYLES.length)]; }

/** 目标是否可交战（存活玩家/僚机通用） */
function _targetOk(t) {
  return !!(t && t.ready && t.root && !t.crashed && !t._exploded);
}
/** 取目标速度：运动学机（僚机262/P-51）用 _vel，玩家用 getVelocity()（forward×speed） */
function _targetVel(t, out) {
  if (t._vel) return out.copy(t._vel);
  if (t.getVelocity) return out.copy(t.getVelocity());
  return out.set(0, 0, 0);
}

// ════════════════════════════════════════════════════════════════════
// P51Escort：单机（长机/僚机共用；行为由所属 Flight 驱动，本类管运动学与开火）
// ════════════════════════════════════════════════════════════════════
export class P51Escort extends Enemy {
  /**
   * @param opts { cfg: escortP51 配置, callsign: 'A1-L' 等, isLeader: bool }
   */
  constructor(scene, renderer, player, opts) {
    super(scene, renderer, player);
    this._cfg = opts.cfg;
    this.callsign = opts.callsign || 'P51';
    this._isLeader = !!opts.isLeader;
    const perf = this._cfg.perf || {};
    this._maxSpeed = perf.maxSpeed ?? 195;      // P-51D 史实高空极速 ~703km/h
    this._cruise = perf.cruiseSpeed ?? 140;
    this._minSpeed = perf.minSpeed ?? 70;
    this._turnEscort = perf.turnEscort ?? 30;   // 伴飞转向 deg/s
    this._turnCombat = perf.turnCombat ?? 55;   // 格斗转向 deg/s
    this._vel = new THREE.Vector3(-50, 0, 0);   // 初始西飞（与 B-17 同向）
    this._speed = 50;
    this._roll = 0;
    // HP / 损伤（玩家 MK108 45-65/发 → 2-3 发击落）
    this.maxHp = this._cfg.hp ?? 120;
    this.hp = this.maxHp;
    this.smokeThreshold = Math.round(this.maxHp * 0.3);
    this._damagedNotified = false;              // 击伤计分已回流（GameRuntime 命中块置位）
    // 攻击微状态
    this._tgt = null;                 // 本机当前目标（玩家或僚机262）
    this._chaseT = 0;                 // 锁定时长（上限 chaseMaxSec）
    this._abandonT = 0;               // 目标持续超 abandonDist 的时长
    this._bandT = 0;                  // 目标高度出 altBand 的时长
    this._style = 'chase';            // headOn | chase | strafe
    this._runState = 'approach';      // approach | split（对冲错开后分头转向）
    this._splitT = 0;
    this._splitWp = new THREE.Vector3();
    this._splitDir = 1;
    this._wasClose = false;           // 进入过 500m 内（用于"错开"判定）
    this._strafeSide = Math.random() < 0.5 ? 1 : -1;  // 扫射侧向偏好
    // 点射/冷却
    this._fireOn = false;
    this._burstLeft = 0;
    this._cdLeft = 0;
    // 盘旋方向（自由盘旋/巡行用）
    this._orbitDir = Math.random() < 0.5 ? 1 : -1;
    // 高度微扰（同僚机262：差量叠加防瞬跳）
    this._wt = Math.random() * 20;
    this._wobF = 0.5 + Math.random() * 0.5;
    this._wobAmp = 2 + Math.random() * 2;
    this._lastWob = 0;
    // 伴飞槽位平滑点（lazy）
    this._escSmooth = null;
    // 防撞规避（对玩家；Squadron 统一检测与触发，本机只管飞规避航点）
    this._avoidUntil = 0;               // 规避机动截止时刻（squadron 时钟）
    this._avoidWp = new THREE.Vector3();
  }

  async load(url, onProgress) {
    const r = await super.load(url, onProgress);
    // 武器组：6×.50 M2 前射（真实弹道；伤害结算仅玩家侧，见 GameRuntime 命中块）
    const g = this._cfg.guns || {};
    this.weapons.setEnemyMuzzleGroups([{ name: 'mg50', indices: [0, 1, 2, 3, 4, 5], fireRate: g.fireRate ?? 0.09 }]);
    this.weapons.bulletSpeed = g.bulletSpeed ?? 750;
    this.weapons.life = g.life ?? 1.8;          // 750×1.8 = 1350m 有效航程
    this.weapons.damageMin = g.damageMin ?? 2;
    this.weapons.damageMax = g.damageMax ?? 6;
    // 高空关卡无阴影接收面（同 B-17 #63 / 僚机262 优化）
    this.model.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    return r;
  }

  // ---------- 运动学转向核心（与 Wingman262 同款：限速转向 + 姿态由速度方向重建） ----------
  _steerTo(dt, targetPos, speed, turnDeg) {
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
      _v5.copy(_v2).cross(_v1);
      sign = _v5.y >= 0 ? 1 : -1;
      _v2.lerp(_v1, Math.min(1, maxTurn / angle)).normalize();
    }
    this._speed += THREE.MathUtils.clamp(speed - this._speed, -35 * dt, 28 * dt);
    this._vel.copy(_v2).multiplyScalar(this._speed);
    this.speed = this._speed;   // 同步基类 speed：getVelocity()/子弹速度继承据此
    pos.addScaledVector(this._vel, dt);
    const yaw = Math.atan2(-_v2.x, -_v2.z);
    const pitch = Math.asin(THREE.MathUtils.clamp(_v2.y, -1, 1));
    const turnRate = applied / Math.max(dt, 1e-4);
    const targetRoll = THREE.MathUtils.clamp(-sign * turnRate * 0.9, -0.85, 0.85);
    this._roll += THREE.MathUtils.clamp(targetRoll - this._roll, -0.6 * dt, 0.6 * dt);
    this.root.quaternion.setFromEuler(_e1.set(pitch, yaw, this._roll, 'YXZ'));
    return dist;
  }

  /** 目标提前量点（真实弹速估算；子弹实际飞行中还会叠加本机速度，与玩家炮同规则） */
  _leadPoint(t, out) {
    out.copy(t.root.position);
    const dist = out.distanceTo(this.root.position);
    const tof = dist / (this.weapons.bulletSpeed || 750);
    _targetVel(t, _v6);
    out.addScaledVector(_v6, tof);
    return out;
  }

  /** 开火窗口控制：对准（提前量方向 5.7° 内）且进入射程 → 点射 + 冷却（"持续但有冷却间隔"） */
  _updateFireControl(dt, aimPos, dist) {
    const eg = this._cfg.engage || {};
    const fireOpen = eg.fireOpen ?? 400;
    _v4.copy(aimPos).sub(this.root.position).normalize();
    const cosA = this.getForward().dot(_v4);
    if (dist <= fireOpen && dist > 30 && cosA > 0.995) {
      if (this._cdLeft > 0) {
        this._cdLeft -= dt;
        this._fireOn = false;
      } else {
        if (this._burstLeft <= 0) this._burstLeft = _rand(eg.burstSec || [0.8, 1.6]);
        this._burstLeft -= dt;
        this._fireOn = true;
        if (this._burstLeft <= 0) this._cdLeft = _rand(eg.cooldownSec || [1.2, 2.4]);
      }
    } else {
      this._fireOn = false;
      this._burstLeft = 0;
      if (this._cdLeft > 0) this._cdLeft -= dt;
    }
  }

  _stopFire() { this._fireOn = false; }

  /** 锁定新目标（重置追击计时与微状态；攻击方式重掷） */
  _lockTarget(t) {
    this._tgt = t;
    this._chaseT = 0;
    this._abandonT = 0;
    this._bandT = 0;
    this._wasClose = false;
    this._runState = 'approach';
    this._style = _rollStyle();
  }

  /** 放弃目标（本机） */
  _dropTarget() {
    if (!this._tgt) return;
    this._tgt = null;
    this._runState = 'approach';
    this._stopFire();
  }

  /**
   * 放弃判定（规则 3 + 不追低/高 + 本机高度自保）。返回 true = 应放弃。
   * 调用时机：本机持有目标时每帧。目标已毁也返回 true（由调用方走重选）。
   */
  _checkAbandon(dt) {
    const eg = this._cfg.engage || {};
    const t = this._tgt;
    if (!t) return false;
    if (!_targetOk(t)) return true;
    this._chaseT += dt;
    const dist = this.root.position.distanceTo(t.root.position);
    if (dist > (eg.abandonDist ?? 600)) this._abandonT += dt; else this._abandonT = 0;
    const band = eg.altBand || [3000, 7000];
    const ty = t.root.position.y;
    if (ty < band[0] || ty > band[1]) this._bandT += dt; else this._bandT = 0;
    return (
      this._chaseT > (eg.chaseMaxSec ?? 30) ||
      this._abandonT > (eg.abandonSec ?? 2) ||
      this._bandT > 1 ||
      this.root.position.y < band[0]        // 本机低于 3000m：放弃拉起（不追低）
    );
  }

  /**
   * 攻击执行（approach/split 两态）：转向提前量点 + 开火窗口 + 错开后分头转向。
   * aimBias: null | 'climb'（intercept 爬升偏置，远距离开火点前压到 interceptAlt 高度）
   */
  _flyAttack(dt, t, aimBias) {
    const eg = this._cfg.engage || {};
    const dist = this.root.position.distanceTo(t.root.position);

    if (this._runState === 'split') {
      // 分头转向：绕开本机前方 100-140° 侧向航点 2-2.6s，再回头接敌
      this._splitT -= dt;
      this._steerTo(dt, this._splitWp, this._maxSpeed * 0.9, this._turnCombat);
      if (this._splitT <= 0) { this._runState = 'approach'; this._style = _rollStyle(); }
      return;
    }

    // 提前量瞄准点（按攻击方式整形）
    this._leadPoint(t, _v3);
    if (aimBias === 'climb' && dist > 1200 && this.root.position.y < (eg.interceptAlt ?? 6500) - 100) {
      _v3.y = eg.interceptAlt ?? 6500;      // 边接近边爬升到 6500m
    } else if (this._style === 'strafe' && dist > 600) {
      // 扫射：侧向偏置接近（±150m），近距离收敛到提前量点
      _v4.set(0, 1, 0).cross(this.getForward()).normalize();
      _v3.addScaledVector(_v4, this._strafeSide * 150);
    }
    // 速度：追逐限速跟随目标速度防冲过头；对冲/扫射全速
    let spd = this._maxSpeed;
    if (this._style === 'chase') {
      _targetVel(t, _v6);
      const tSpd = _v6.length();
      spd = THREE.MathUtils.clamp(tSpd + (dist - 250) * 0.2, this._cruise, this._maxSpeed);
    }
    this._steerTo(dt, _v3, spd, this._turnCombat);
    this._updateFireControl(dt, _v3, dist);

    // 错开判定：进入过 500m 后目标落到后半球 → 分头转向（长左僚右）
    if (dist < 500) this._wasClose = true;
    if (this._wasClose) {
      _v4.copy(t.root.position).sub(this.root.position).normalize();
      if (this.getForward().dot(_v4) < -0.1) {
        this._runState = 'split';
        this._splitDir = this._isLeader ? 1 : -1;
        this._splitT = 2 + Math.random() * 0.6;
        _v5.copy(this.getForward());
        _v6.set(0, 1, 0);
        _v5.applyAxisAngle(_v6, THREE.MathUtils.degToRad(this._splitDir * (100 + Math.random() * 40)));
        _v5.y = 0.15;   // 边转边带一点爬升（防掉高度触 3000m 自保线）
        _v5.normalize();
        this._splitWp.copy(this.root.position).addScaledVector(_v5, 600);
        this._wasClose = false;
        this._stopFire();
      }
    }
  }

  /** 防撞规避机动（仅对玩家）：极速满转冲向规避航点（侧向拉开 + 爬升），不开火 */
  _flyAvoid(dt) {
    this._steerTo(dt, this._avoidWp, this._maxSpeed, this._turnCombat);
    this._stopFire();
  }

  /** 僚机尾随长机（trail 协同模式）：长机后方 trailDist，独立控制律 + 侧向/高度扰动 */
  _flyTrail(dt, leader, trailDist) {
    const fwd = leader.getForward();
    _v3.copy(leader.root.position).addScaledVector(fwd, -trailDist);
    // 扰动偏移（各自逻辑，不镜像）：侧向 ±40m / 高度 ±20m 慢变
    _v4.set(0, 1, 0).cross(fwd).normalize();
    _v3.addScaledVector(_v4, Math.sin(this._wt * 0.4) * 40);
    _v3.y += Math.sin(this._wt * 0.31 + 1.7) * 20;
    // 带符号速度修正（同僚机262编队：纯距离正反馈会跑飞）
    _v4.copy(_v3).sub(this.root.position);
    const along = _v4.dot(fwd);
    const spd = THREE.MathUtils.clamp((leader._speed || 140) + along * 0.6, this._minSpeed, this._maxSpeed * 0.95);
    this._steerTo(dt, _v3, spd, 45);
  }

  /** 自由盘旋（重选窗口/玩家攻击窗口）：浅坡度连续转弯大圈（限速转向 12°/s，
      盘旋半径 ≈ v/ω ≈ 670m，非原地急转），低高度时缓慢爬回交战带 */
  _flyOrbit(dt) {
    const eg = this._cfg.engage || {};
    const band = eg.altBand || [3000, 7000];
    _v5.copy(this.getForward());
    _v6.set(0, 1, 0);
    _v5.applyAxisAngle(_v6, this._orbitDir * Math.PI / 2);   // 侧向 90° 绕圈
    _v5.y = 0; _v5.normalize();
    _v3.copy(this.root.position).addScaledVector(_v5, 900);
    const minY = band[0] + 400;
    if (this.root.position.y < minY) _v3.y = minY + 200;     // 爬回交战带
    this._steerTo(dt, _v3, this._cruise, 12);
  }

  /** 每帧收尾：高度微扰 + 基类视觉更新（损伤冒烟/翼尖拉烟/mixer）+ 武器推进 */
  postUpdate(dt) {
    this._wt += dt;
    const wob = Math.sin(this._wt * this._wobF) * this._wobAmp;
    this.root.position.y += wob - this._lastWob;
    this._lastWob = wob;
    this.update(dt);   // Aircraft.update：mixer/损伤冒烟/翼尖拉烟（P-51 无舵面匹配节点，近零开销）
    this.weapons.setGroupFiring('mg50', this._fireOn);
    this.weapons.update(dt, this._fireOn);
  }
}

// ════════════════════════════════════════════════════════════════════
// Flight：小队（长机+僚机），持有小队级状态机与共享目标
// ════════════════════════════════════════════════════════════════════
class Flight {
  constructor(id, leader, wingman, slot, cfg) {
    this.id = id;
    this.pair = [leader, wingman];  // 固定成员表（坠毁换长机不改成员）
    this.leader = leader;
    this.slot = slot;               // { fwd, lat, alt } 相对编队质心（B2 触发后换顶补位）
    this.cfg = cfg;
    this.state = 'escort';          // escort | intercept | engage | patrol
    this.target = null;             // 小队声明的目标（唯一性仲裁对象；free 模式下为 null）
    this.pairMode = 'same';         // same | trail | free
    this.pairUntil = 0;             // 协同模式重掷时刻（squadron 时钟）
    this.reselectUntil = 0;         // 重选窗口截止时刻（此期间自由盘旋不锁定）
    this.trailDist = _rand(cfg.wingTrail || [100, 150]);
    this.approachCand = null;       // 死带（1000-1500m）接近中的未锁定候选
    this.patrolPhase = FLIGHT_IDS.indexOf(id) * Math.PI / 2;  // 巡行相位错开防叠机
  }

  planes() { return this.pair; }
  wingman() { return this.pair.find((p) => p !== this.leader); }

  /** 重掷协同模式（进入猎杀/定时切换时） */
  rollPairMode(now) {
    const w = this.cfg.pairWeights || { same: 60, trail: 20, free: 20 };
    let r = Math.random() * ((w.same ?? 0) + (w.trail ?? 0) + (w.free ?? 0));
    if ((r -= w.same ?? 0) <= 0) this.pairMode = 'same';
    else if ((r -= w.trail ?? 0) <= 0) this.pairMode = 'trail';
    else this.pairMode = 'free';
    this.pairUntil = now + _rand(this.cfg.pairSwitchSec || [6, 12]);
    this.trailDist = _rand(this.cfg.wingTrail || [100, 150]);
  }
}

// ════════════════════════════════════════════════════════════════════
// P51EscortSquadron：编队管理器（创建/触发/仲裁/每帧推进/计分事件/清理）
// ════════════════════════════════════════════════════════════════════
export class P51EscortSquadron {
  constructor(runtime, cfg) {
    this.runtime = runtime;
    this.cfg = cfg;
    this.planes = [];       // 全部 8 架（GameRuntime 命中检测/雷达用）
    this.flights = [];      // 4 个小队
    this._intercepted = false;   // 首次拦截已触发
    this._b2Joined = false;      // B2 已退出伴飞加入猎杀
    this._claims = new Map();    // target → flight（唯一性仲裁）
    this._now = 0;               // 编队时钟（pair 重掷/重选窗口用）
  }

  async init() {
    const rt = this.runtime;
    const player = rt.player;
    const cfg = this.cfg;
    const sp = cfg.slotSpacing || { fwd: 350, lat: 260, alt: 400 };
    // 槽位：A 中队上方靠前（fwd+），B 中队下方靠后（fwd-）；小队一左一右
    const slotDefs = {
      A1: { fwd: sp.fwd, lat: -sp.lat, alt: sp.alt },
      A2: { fwd: sp.fwd, lat: sp.lat, alt: sp.alt },
      B1: { fwd: -sp.fwd, lat: -sp.lat, alt: -sp.alt },
      B2: { fwd: -sp.fwd, lat: sp.lat, alt: -sp.alt },
    };
    // 编队质心/航向（出生时刻：B-17 已 placeAtStart）
    const center = this._streamCenter(new THREE.Vector3());
    const dir = this._streamDir(new THREE.Vector3());

    for (const id of FLIGHT_IDS) {
      const slot = slotDefs[id];
      const flightPlanes = [];
      for (let k = 0; k < 2; k++) {
        const isLeader = k === 0;
        const p = new P51Escort(rt.ctx.scene, rt.ctx.renderer, player, {
          cfg, callsign: `${id}-${isLeader ? 'L' : 'W'}`, isLeader,
        });
        await p.load(cfg.model);
        // 出生：长机在槽位，僚机在槽位后 120m 外侧 60m
        const pos = this._slotWorld(center, dir, slot, new THREE.Vector3());
        if (!isLeader) {
          _v1.set(0, 1, 0).cross(dir).normalize();
          pos.addScaledVector(dir, -120).addScaledVector(_v1, (slot.lat >= 0 ? 1 : -1) * 60);
        }
        p.root.position.copy(pos);
        p.root.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(-dir.x, -dir.z), 0, 'YXZ'));
        p._vel.copy(dir).multiplyScalar(50);
        p._speed = 50; p.speed = 50;
        flightPlanes.push(p);
        this.planes.push(p);
      }
      this.flights.push(new Flight(id, flightPlanes[0], flightPlanes[1], slot, cfg));
    }
  }

  // ---------- 编队参照 ----------
  _aliveBombers() {
    return this.runtime.bomberStream.filter((b) =>
      b && b.ready && !b._exploded && !b._falling && !b._rtb && !b._slowCrash && !b._despawnRequested);
  }
  _streamCenter(out) {
    const list = this._aliveBombers();
    if (!list.length) return out.set(0, 5000, 0);
    out.set(0, 0, 0);
    for (const b of list) out.add(b.root.position);
    return out.multiplyScalar(1 / list.length);
  }
  _streamDir(out) {
    const list = this._aliveBombers();
    if (list.length && list[0].getForward) {
      out.copy(list[0].getForward());
      out.y = 0;
      if (out.lengthSq() > 0.01) return out.normalize();
    }
    return out.set(-1, 0, 0);   // 航线默认朝西（-x）
  }
  /** 槽位世界坐标：质心 + 航向×fwd + 侧向×lat + 高度×alt（内部用 _v1/_v2，入出参勿传这两个） */
  _slotWorld(center, dir, slot, out) {
    _v1.set(0, 1, 0).cross(dir).normalize();   // 右侧向量
    return out.copy(center)
      .addScaledVector(dir, slot.fwd)
      .addScaledVector(_v1, slot.lat)
      .add(_v2.set(0, slot.alt, 0));
  }

  // ---------- 目标池：玩家 + 僚机262（一视同仁） ----------
  _targetPool() {
    const rt = this.runtime;
    const pool = [];
    if (_targetOk(rt.player)) pool.push(rt.player);
    if (rt.wingmen262) for (const w of rt.wingmen262.members) if (_targetOk(w)) pool.push(w);
    return pool;
  }

  /** 唯一性仲裁：认领 1000m 内最近未认领目标（调用顺位即 A1→A2→B1→B2） */
  _claimTarget(flight) {
    const eg = this.cfg.engage || {};
    const band = eg.altBand || [3000, 7000];
    const selectSq = (eg.selectDist ?? 1000) ** 2;
    let best = null, bestD2 = Infinity;
    for (const t of this._targetPool()) {
      if (this._claims.has(t)) continue;                     // 已被其他小队认领
      const ty = t.root.position.y;
      if (ty < band[0] || ty > band[1]) continue;            // 高度带外不选
      const d2 = flight.leader.root.position.distanceToSquared(t.root.position);
      if (d2 > selectSq) continue;
      if (d2 < bestD2) { bestD2 = d2; best = t; }
    }
    if (!best) return null;
    this._claims.set(best, flight);
    flight.target = best;
    for (const p of flight.planes()) p._lockTarget(best);
    return best;
  }

  _releaseTarget(flight) {
    if (flight.target && this._claims.get(flight.target) === flight) this._claims.delete(flight.target);
    flight.target = null;
  }

  /** 死带候选：1500m 内最近的可接近目标（不锁定、不仲裁、不开火） */
  _nearestCandidate(pos) {
    const eg = this.cfg.engage || {};
    const band = eg.altBand || [3000, 7000];
    const patrolSq = (eg.patrolDist ?? 1500) ** 2;
    let best = null, bestD2 = Infinity;
    for (const t of this._targetPool()) {
      const ty = t.root.position.y;
      if (ty < band[0] || ty > band[1]) continue;
      const d2 = pos.distanceToSquared(t.root.position);
      if (d2 > patrolSq) continue;
      if (d2 < bestD2) { bestD2 = d2; best = t; }
    }
    return best ? { target: best, d2: bestD2 } : null;
  }

  // ---------- 每帧推进 ----------
  update(dt) {
    if (!this.flights.length) return;
    const rt = this.runtime;
    const eg = this.cfg.engage || {};
    this._now += dt;

    const center = this._streamCenter(_center);
    const dir = this._streamDir(_dir);
    const pool = this._targetPool();
    const ctx = { center, dir, pool, now: this._now };

    // 首次拦截触发（一次性）：任一 262 与任一在编 B-17 最近距离 ≤ triggerDist
    //   （质心参照对箱式队形偏保守：队尾距质心 >1km，262 咬尾时质心判据迟迟不触发）
    if (!this._intercepted && pool.length) {
      const trigSq = (eg.triggerDist ?? 2000) ** 2;
      const bombers = this._aliveBombers();
      const triggered = bombers.length > 0 && pool.some((t) =>
        bombers.some((b) => b.root.position.distanceToSquared(t.root.position) <= trigSq));
      if (triggered) {
        this._intercepted = true;
        // 均匀分配：目标按距质心排序，A1→A2→B1 依次认领最近未分配者
        const sorted = pool.slice().sort((a, b) =>
          a.root.position.distanceToSquared(center) - b.root.position.distanceToSquared(center));
        const assigned = new Set();
        for (const id of ['A1', 'A2', 'B1']) {
          const flight = this.flights.find((f) => f.id === id);
          flight.state = 'intercept';
          const t = sorted.find((x) => !assigned.has(x));
          if (t) {
            assigned.add(t);
            this._claims.set(t, flight);
            flight.target = t;
            for (const p of flight.planes()) p._lockTarget(t);
          }
          flight.rollPairMode(this._now);
        }
        // B2 上移至 A1 原槽位继续伴飞（顶补位）
        const b2 = this.flights.find((f) => f.id === 'B2');
        const a1 = this.flights.find((f) => f.id === 'A1');
        b2.slot = { ...a1.slot };
      }
    }

    // B2 伴飞退出（一次性）：262 逼近 B2 ≤400m，或任意 262 距任一在编 B-17 ≤500m
    if (this._intercepted && !this._b2Joined) {
      const bj = this.cfg.b2Join || { selfDist: 400, bomberDist: 500 };
      const b2 = this.flights.find((f) => f.id === 'B2');
      const selfSq = (bj.selfDist ?? 400) ** 2;
      const bomberSq = (bj.bomberDist ?? 500) ** 2;
      let join = pool.some((t) =>
        b2.planes().some((p) => !p.crashed && p.root.position.distanceToSquared(t.root.position) <= selfSq));
      if (!join) {
        const bombers = this._aliveBombers();
        join = bombers.some((b) =>
          pool.some((t) => b.root.position.distanceToSquared(t.root.position) <= bomberSq));
      }
      if (join) {
        this._b2Joined = true;
        b2.state = 'engage';
        b2.rollPairMode(this._now);
      }
    }

    // 防撞规避（最高优先级，任何状态，仅对玩家）：触发/进行中的飞机本帧由 Squadron 直接接管
    const avoiding = this._updatePlayerAvoid(dt);

    // 逐小队推进（规避中的飞机跳过状态机分发）
    for (const flight of this.flights) this._updateFlight(dt, flight, ctx, avoiding);

    // 逐机收尾 + 坠毁/爆炸管理
    const audio = rt.ctx.audio;
    for (let i = this.planes.length - 1; i >= 0; i--) {
      const p = this.planes[i];
      if (!p.ready || !p.root) continue;
      if (p.crashed) {
        // 坠毁分支：基类坠毁物理 + 视觉更新，不再 AI/开火
        p.updateFlight(dt, null);
        p.update(dt);
        p.weapons.update(dt, false);
      } else {
        p.postUpdate(dt);
      }
      // 爆炸音（_exploded 边沿，同 GameRuntime 敌机循环）
      if (p._exploded && !p._wasExploded && audio) audio.explosion();
      p._wasExploded = p._exploded;
      // 爆炸计时归零 → 释放（同 WaveDirector 约定）
      if (p._exploded && (p._crashTimer ?? 0) <= 0) {
        rt._disposeAircraft(p);
        this.planes.splice(i, 1);
      }
    }
  }

  /**
   * 防撞规避（仅对玩家）：每帧检测全部存活机的玩家接近态势，返回本帧规避中的飞机集合。
   *   触发条件（命中其一）：dist < near（贴身兜底）；
   *     dist < mid 且接近率 > midClosing（中距中速）；dist < far 且接近率 > farClosing（高速对头提前量）。
   *   触发后：放弃本机目标（小队目标由长机持有时 → 释放认领 + 小队进 reselect 重选窗口），
   *   向远离玩家一侧满转 + 爬升 dur 秒——绝不追尾/相撞。规避中飞机本帧由此直接接管（跳过状态机）。
   */
  _updatePlayerAvoid(dt) {
    const avoiding = new Set();
    const player = this.runtime.player;
    if (!player || !player.root || player.crashed || player._exploded) return avoiding;
    const av = this.cfg.avoid || {};
    const near = av.near ?? 90;
    const mid = av.mid ?? 170, midClosing = av.midClosing ?? 35;
    const far = av.far ?? 260, farClosing = av.farClosing ?? 120;
    const dur = av.dur ?? 1.15;
    for (const p of this.planes) {
      if (!p.ready || !p.root || p.crashed || p._exploded) continue;
      if (p._avoidUntil > this._now) { p._flyAvoid(dt); avoiding.add(p); continue; }
      const d2 = p.root.position.distanceToSquared(player.root.position);
      if (d2 > far * far) continue;                     // 粗筛
      const dist = Math.sqrt(d2);
      // 接近率 = n̂·(vP51 − vPlayer)（>0 = 距离在缩短）
      _v1.copy(player.root.position).sub(p.root.position).multiplyScalar(1 / Math.max(dist, 1e-3));
      _v2.copy(p._vel);
      _targetVel(player, _v3);
      const closing = _v2.sub(_v3).dot(_v1);
      if (!(dist < near || (dist < mid && closing > midClosing) || closing > farClosing)) continue;
      // 触发：放弃当前目标 + 侧向急转脱离
      p._avoidUntil = this._now + dur;
      p._dropTarget();
      const flight = this.flights.find((f) => f.pair.includes(p));
      if (flight && flight.target && p === flight.leader) {
        this._releaseTarget(flight);
        const eg2 = this.cfg.engage || {};
        flight.reselectUntil = this._now + _rand(eg2.reselectSec || [3, 6]);
      }
      // 规避航点：远离玩家一侧 500m + 前 200m + 爬升 120m
      const fwd = p.getForward();
      _v4.copy(fwd).cross(_v6.set(0, 1, 0)).normalize();   // 右向量（fwd×up：机头-Z 时得 +X 右）
      const side = _v1.dot(_v4) > 0 ? -1 : 1;              // 玩家在右侧 → 往左规避
      p._avoidWp.copy(p.root.position).addScaledVector(_v4, side * 500).addScaledVector(fwd, 200);
      p._avoidWp.y += 120;
      p._flyAvoid(dt);
      avoiding.add(p);
    }
    return avoiding;
  }

  // ---------- 小队级状态机 ----------
  _updateFlight(dt, flight, ctx, avoiding) {
    // 长机坠毁 → 僚机接管长机角色（成员表不变；原长机由 squadron 层走坠毁分支）
    const L = flight.leader;
    if (L.crashed) {
      const other = flight.wingman();
      if (other && !other.crashed) {
        flight.leader = other;
        other._isLeader = true;
        this._releaseTarget(flight);
      }
    }
    switch (flight.state) {
      case 'escort': this._flightEscort(dt, flight, ctx, avoiding); break;
      case 'intercept': this._flightIntercept(dt, flight, ctx, avoiding); break;
      case 'engage': this._flightEngage(dt, flight, ctx, avoiding); break;
      case 'patrol': this._flightPatrol(dt, flight, ctx, avoiding); break;
    }
  }

  /** escort 伴飞：钉槽位（僚机在长机槽位后 120m 外侧 60m），速度跟机群 50m/s + 纵向修正 */
  _flightEscort(dt, flight, ctx, avoiding) {
    const { center, dir } = ctx;
    for (const p of flight.planes()) {
      if (p.crashed || avoiding.has(p)) continue;
      this._slotWorld(center, dir, flight.slot, _v3);
      if (!p._isLeader) {
        _v4.set(0, 1, 0).cross(dir).normalize();
        _v3.addScaledVector(dir, -120).addScaledVector(_v4, (flight.slot.lat >= 0 ? 1 : -1) * 60);
      }
      // 槽位平滑（λ=4/s）+ 平移前馈（机群 50m/s 西飞，防稳态滞后，同僚机262 #73 教训）
      if (!p._escSmooth) p._escSmooth = new THREE.Vector3().copy(_v3);
      _v3.addScaledVector(dir, 50 * 0.25);
      p._escSmooth.lerp(_v3, 1 - Math.exp(-dt * 4));
      _v4.copy(p._escSmooth).sub(p.root.position);
      const dist = _v4.length();
      if (dist < 12) {
        _v5.copy(p.root.position).addScaledVector(dir, 100).addScaledVector(_v4, 1.2);
        p._steerTo(dt, _v5, 50, 8);
      } else {
        const along = _v4.dot(dir);
        const spd = THREE.MathUtils.clamp(50 + along * 0.6, 40, 120);
        p._steerTo(dt, p._escSmooth, spd, p._turnEscort);
      }
    }
  }

  /** intercept 拦截（一次性）：爬升 6500m 对头冲锋锁定目标；长机首次错开后转 engage */
  _flightIntercept(dt, flight, ctx, avoiding) {
    const t = flight.target;
    if (!t || !_targetOk(t)) {
      flight.state = 'engage';
      this._releaseTarget(flight);
      return;
    }
    for (const p of flight.planes()) {
      if (p.crashed || avoiding.has(p)) continue;
      if (!p._tgt) p._lockTarget(t);
      p._flyAttack(dt, t, 'climb');
    }
    // 长机完成首次对冲错开（或已贴近缠斗）→ 小队转 engage 猎杀循环
    if (flight.leader._runState === 'split' || flight.leader._wasClose) {
      flight.state = 'engage';
      flight.rollPairMode(ctx.now);
    }
  }

  /** engage 猎杀循环：选目标/放弃/重选窗口/协同模式 */
  _flightEngage(dt, flight, ctx, avoiding) {
    const { now } = ctx;
    const eg = this.cfg.engage || {};
    const L = flight.leader;
    const W = flight.wingman();
    if (!L || L.crashed) return;   // 全小队坠毁

    // 协同模式定时重掷（切换时清理认领/个人目标）
    if (now >= flight.pairUntil) {
      const prev = flight.pairMode;
      flight.rollPairMode(now);
      if (flight.pairMode === 'free') {
        this._releaseTarget(flight);              // 自由模式不占小队认领
        if (L._tgt) L._dropTarget();
        if (W && W._tgt) W._dropTarget();
      } else if (prev === 'free') {
        if (L._tgt) L._dropTarget();              // 回归小队制，等重新仲裁
        if (W && W._tgt) W._dropTarget();
      }
    }

    // 小队目标失效（被击落/坠毁）→ 释放 + 短重选窗口
    if (flight.target && !_targetOk(flight.target)) {
      this._releaseTarget(flight);
      flight.reselectUntil = now + _rand([1.5, 3]);
    }

    // 逐机放弃判定（规则 3/不追低高/本机自保；规避中的飞机本帧已由 Squadron 接管，跳过）
    for (const p of flight.planes()) {
      if (p.crashed || avoiding.has(p) || !p._tgt) continue;
      if (p._checkAbandon(dt)) {
        const wasFlight = p._tgt === flight.target;
        p._dropTarget();
        if (wasFlight) {
          this._releaseTarget(flight);
          flight.reselectUntil = now + _rand(eg.reselectSec || [3, 6]);  // 玩家攻击窗口
        }
      }
    }

    const inReselect = now < flight.reselectUntil;

    // ── free 模式：双机各自自由选目标（可与其他小队撞车） ──
    if (flight.pairMode === 'free') {
      for (const p of flight.planes()) {
        if (p.crashed || avoiding.has(p)) continue;
        if (inReselect) { p._stopFire(); p._flyOrbit(dt); continue; }
        if (!p._tgt) {
          const cand = this._nearestCandidate(p.root.position);
          if (cand && cand.d2 <= (eg.selectDist ?? 1000) ** 2) p._lockTarget(cand.target);
        }
        if (p._tgt) p._flyAttack(dt, p._tgt, null);
        else { p._stopFire(); p._flyOrbit(dt); }
      }
      return;
    }

    // ── same / trail 模式：小队目标驱动 ──
    if (!flight.target && !inReselect) {
      if (!this._claimTarget(flight)) {
        const cand = this._nearestCandidate(L.root.position);
        if (cand) {
          flight.approachCand = cand.target;      // 死带接近（不锁定不开火）
        } else {
          flight.approachCand = null;
          flight.state = 'patrol';                // 1500m 内无候选 → 回编队巡行
          return;
        }
      } else {
        flight.approachCand = null;
      }
    }

    if (inReselect) {
      for (const p of flight.planes()) if (!p.crashed && !avoiding.has(p)) { p._stopFire(); p._flyOrbit(dt); }
      return;
    }

    // 长机（规避中的长机本帧已由 Squadron 接管；僚机不受其影响继续按模式行动）
    if (!avoiding.has(L)) {
      const ft = flight.target;
      if (ft) {
        if (L._tgt !== ft) L._lockTarget(ft);
        L._flyAttack(dt, ft, null);
      } else if (flight.approachCand) {
        // 死带接近：转向候选目标方向（不开火），进入 1000m 后下帧认领
        L._leadPoint(flight.approachCand, _v3);
        L._steerTo(dt, _v3, L._maxSpeed * 0.9, L._turnCombat * 0.8);
        L._stopFire();
      } else {
        L._stopFire();
        L._flyOrbit(dt);
      }
    }

    // 僚机按协同模式
    if (W && !W.crashed && !avoiding.has(W)) {
      if (flight.pairMode === 'same' && flight.target) {
        if (W._tgt !== flight.target) W._lockTarget(flight.target);
        W._flyAttack(dt, flight.target, null);
      } else {
        // trail 或无小队目标：尾随长机 100-150m（各自控制律 + 扰动），不开火
        W._stopFire();
        W._flyTrail(dt, L, flight.trailDist);
      }
    }
  }

  /** patrol 无目标巡行：编队上方浅坡度大圈（默认 R=1800m，限速转向 ~5°/s 连续浅转弯，
      一圈 ~78s 符合空气动力学观感，非原地兜圈；圆心随编队质心西漂，高度 +550m 封顶交战带上限下方） */
  _flightPatrol(dt, flight, ctx, avoiding) {
    const { center } = ctx;
    const L = flight.leader;
    if (!L || L.crashed) return;
    // 出现 1500m 内候选 → 回 engage（下帧走死带接近/锁定）
    if (this._nearestCandidate(L.root.position)) {
      flight.state = 'engage';
      return;
    }
    const eg = this.cfg.engage || {};
    const band = eg.altBand || [3000, 7000];
    const pc = this.cfg.patrol || {};
    const R = pc.radius ?? 1800;
    const spd = pc.speed ?? 145;
    const alt = Math.min(center.y + (pc.alt ?? 550), band[1] - 300);
    flight.patrolPhase += (spd / R) * dt;   // 角速度 = v/R ≈ 4.6°/s（浅坡度大圈）
    for (const p of flight.planes()) {
      if (p.crashed || avoiding.has(p)) continue;
      // 僚机错固定弧长跟随（~300m 弧距换算相位），不叠机
      const phase = flight.patrolPhase - (p._isLeader ? 0 : Math.min(0.35, 300 / R));
      _v3.set(center.x + Math.cos(phase) * R, alt, center.z + Math.sin(phase) * R);
      p._steerTo(dt, _v3, spd, 12);   // 限速转向留 2.6× 余量，轨迹平滑收敛到圆
      p._stopFire();
    }
  }

  dispose() {
    for (const p of this.planes) this.runtime._disposeAircraft(p);
    this.planes = [];
    this.flights = [];
    this._claims.clear();
  }
}
