import * as THREE from 'three';
import { Enemy } from '../enemy.js';

// 返航转向复用（避免每帧 new）
const _UP_Y = new THREE.Vector3(0, 1, 0);
const _rtbTargetQuat = new THREE.Quaternion();
// 热路径 scratch（即用即弃，不得跨语句持有）：姿态欧拉角 / 前向 / 目标速度 / 枪口世界坐标
const _tmpEuler = new THREE.Euler();
const _tmpFwd = new THREE.Vector3();
const _tmpVel = new THREE.Vector3();
const _tmpMuzzlePos = new THREE.Vector3();
// 大块零件几何（程序模拟：翼段/机身段/方块）
const _bigDebrisGeos = [
  new THREE.BoxGeometry(3.2, 0.5, 1.6),
  new THREE.BoxGeometry(2.0, 0.9, 1.2),
  new THREE.BoxGeometry(1.2, 1.2, 1.2),
  new THREE.BoxGeometry(4.5, 0.4, 1.0),
];
const _debrisColors = [0x2e2a26, 0x3a352e, 0x24211e, 0x46403a, 0x1c1a18];

// 烟色灰阶（乘在灰色烟纹理上做颜色层次）：
const _ENGINE_SMOKE_TINTS = [0.30, 0.38, 0.46];        // 发动机油烟：黑~深灰
const _CRASH_SMOKE_TINTS = [0.30, 0.42, 0.55, 0.72, 0.90];  // 坠毁烟：黑→深灰→浅灰层次
const _IMPACT_SMOKE_TINTS = [0.24, 0.30, 0.36];        // 命中崩落烟尘：近黑

/**
 * 重型轰炸机（第4关《柏林保卫战》B-17 机群，extends Enemy 复用加载/受击底层）。
 *
 * 与 He111/IL-2 的 bomber aiType 完全独立（那条路径一行未动）：
 *   - 直飞航线不规避：运动学直飞（不走街机物理），每机独立低频扰动
 *   - 损伤模型（2026-08-17 定案）：
 *       55% 阈值：35% 概率脱离编队返航 / 65% 带伤跟随编队（rtbChance 可配）
 *       发动机数量状态（不叠加，按数量切换）：1 发冒烟不减速 / 2 发 -10% /
 *         3 发 -20% + 持续掉血 2/s / 4 发 -25% + 掉血 10/s
 *       HP<40%：随机一个冒烟发动机燃大火（冒烟加重 + 每 3s 掉 2）
 *       HP<10%：缓慢坠毁（向下固定 15-20° 拉坠毁烟，炮塔停火）
 *   - 坠毁四式（HP=0 判定；过量伤害 hp<=-100 强制爆炸式）：
 *       ① 30° 俯冲（随机左右倾 20° 平滑压倾，加速到极速 90%）
 *       ② 缓慢滚转失控翻覆（30-45° 下坠，极速 70%）
 *       ③ 爆燃解体（40-60° 缓慢下坠+翻滚，大火黑烟 + 程序大块零件着火下落/小碎片散落）
 *       ④ 爆炸（闪光火光 + 白烟爆散 + 碎片拉小烟尘，主体同③继续下坠）
 *     全模式坠毁后：多点大烟团浓烟 + 机身大火（_bodyFxPoints 随机发烟/发火点）；
 *     大块零件/碎片一直下落，离玩家 >1000m 消失；触地爆炸后移除
 *   - 炮塔真威胁：射界内带提前量瞄准 + 短点射（缓慢坠毁/坠毁后停火）
 *   - 状态切换平滑：编队扰动残余偏移指数衰减（_residualWob），无位置/姿态瞬跳
 *
 * 命中：大机体用多球近似（hitSpheres：躯干/四发/翼尖/尾），由 GameRuntime 检测。
 */
export class HeavyBomber extends Enemy {
  /**
   * @param {object} opts {
   *   slot, speed, hp, damageThreshold, rtbChance,
   *   hitSpheres, engines, turrets, route, despawnX, rtbDespawnDist, onEvent,
   * }
   */
  constructor(scene, renderer, player, opts) {
    super(scene, renderer, player);
    this.slot = opts.slot || { x: 0, y: 0, z: 0 };
    this.cruise = opts.speed ?? 50;
    this.maxHp = this.hp = opts.hp ?? 450;
    this.damageThreshold = opts.damageThreshold ?? 0.55;
    this.rtbChance = opts.rtbChance ?? 0.35;       // 55% 阈值时返航概率（否则带伤跟随编队）
    this.hitSpheres = (opts.hitSpheres || []).map(s => ({
      offset: new THREE.Vector3(...s.offset), radius: s.radius, engine: s.engine ?? null,
    }));
    this.engines = (opts.engines || []).map(e => ({
      hitOffset: new THREE.Vector3(...e.hitOffset),
      smokeOffset: new THREE.Vector3(...e.smokeOffset),
      damaged: false, emitAcc: 0,
    }));
    this.turrets = (opts.turrets || []).map(t => ({
      ...t, state: 'idle', timer: 0, aimDir: new THREE.Vector3(),
    }));
    this.route = opts.route;
    this.despawnX = opts.despawnX ?? -38000;
    this.onEvent = opts.onEvent || (() => {});

    // 状态
    this.damaged = false;          // 55% 阈值已触发（计分/状态标记，一次性）
    this._rtb = false;             // 返航中
    this._rtbSpeed = this.cruise * 0.8;
    this._rtbTurnRate = 0.20;      // 返航转向速率（rad/s，重型机非常缓慢的大转弯）
    this._rtbSink = 6;             // 返航缓降速率（m/s）
    this._rtbDespawnDist = opts.rtbDespawnDist ?? 15000; // 返航后离玩家超过此距离（雾中不可见）即脱离
    this._routeDir = new THREE.Vector3();
    this._dist = 0;                // 沿航线已飞距离
    this._t = Math.random() * 100; // 扰动时钟（各自随机相位）
    this._wob = {
      f1: 0.35 + Math.random() * 0.30, f2: 0.28 + Math.random() * 0.25,
      f3: 0.20 + Math.random() * 0.20,
      p1: Math.random() * 6.283, p2: Math.random() * 6.283, p3: Math.random() * 6.283,
      amp: 2.0 + Math.random() * 2.0,
      rollAmp: 0.015 + Math.random() * 0.015,
    };
    this._baseQuat = new THREE.Quaternion();
    this._wobOffset = new THREE.Vector3();    // 本帧编队扰动偏移（_applyWobble 记录）
    this._residualWob = new THREE.Vector3();  // 状态切换时的残余扰动（固定初值）
    this._residualWobK = 0;                   // 残余扰动衰减系数 1→0（每帧只补衰减差量）

    // 发动机/损伤状态
    this._engineCount = 0;         // 受损发动机数（状态机：1不减速/2减10%/3减20%+DoT/4减25%+DoT）
    this._speedFactor = 1;
    this._engineFireIdx = -1;      // <40% 燃大火的发动机（-1=无）
    this._fireDotAcc = 0;          // 大火持续掉血计时（每3秒掉2）
    this._dotAcc = 0;              // 发动机 DoT 计时
    this._slowCrash = false;       // <10% 缓慢坠毁中
    this._slowPitch = 0;           // 缓慢坠毁俯角（15-20°）
    this._falling = false;         // 坠毁下坠中（HP=0 后）
    this._crash = null;            // 坠毁参数 {mode,yaw,speed,pitch,rollAngle,rollRate,targetSpeed,targetPitch}
    this._bodyFire = false;        // 爆燃/爆炸后机体大火
    this._bodyFireAcc = 0;
    this._crashSmokeAcc = 0;
    // 机身特效发烟/发火点（躯干/翼尖/尾 + 四发烟点，坠毁烟火多点随机取）
    this._bodyFxPoints = [
      ...this.hitSpheres.filter(s => s.engine == null).map(s => s.offset),
      ...this.engines.map(e => e.smokeOffset),
    ];

    // 粒子：发动机/坠毁烟（normal）+ 火光/闪光（additive）+ 大块零件
    this._smokeTex = this._makeSmokeTexture();
    this._fireTex = this._makeFireTexture();
    this._smokePool = [];
    this._smokes = [];
    this._fxSprites = [];          // 火光/闪光（additive 短寿命）
    this._bigDebris = [];          // 大块零件/小碎片（一直下落，>1000m 消失）

    // 复用临时向量
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._q1 = new THREE.Quaternion();
    this._qInv = new THREE.Quaternion();
  }

  async load(url, onProgress) {
    const r = await super.load(url, onProgress);
    // 高空机群不投影：交战在 5000m，阴影相机（far=1400）内没有任何可接收阴影的表面，
    // 关掉 castShadow 后 12 架不再每帧重绘进阴影图（纯省 draw call，视觉零损失）
    this.model.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    return r;
  }

  /** 航线基准位置 + 朝向（load 后由 GameRuntime 调用一次） */
  placeAtStart() {
    const r0 = this.route[0];
    const r1 = this.route[1];
    this._routeDir.set(r1.x - r0.x, r1.y - r0.y, r1.z - r0.z).normalize();
    this.root.position.set(r0.x + this.slot.x, r0.y + this.slot.y, r0.z + this.slot.z);
    // 机头朝 route[1]（lookAt + rotateY(π)，同 Enemy.reset 惯例）
    this.root.lookAt(r1.x + this.slot.x, r1.y + this.slot.y, r1.z + this.slot.z);
    this.root.rotateY(Math.PI);
    this._baseQuat.copy(this.root.quaternion);
  }

  // ---------- 主更新（运动学直飞，不走街机物理） ----------
  updateAll(dt, player, wingmen) {
    if (!this.ready) return;
    this._t += dt;
    if (player) this._player = player;

    if (this._falling) {
      this._updateCrash(dt);
    } else if (this._slowCrash) {
      this._updateSlowCrash(dt);
    } else {
      if (this._rtb) this._updateRtb(dt);
      else this._updateCruise(dt);
      this._applyWobble(dt);
      this._updateDamageStates(dt);
    }

    // 粒子推进（任何状态）
    this._updateEngineSmoke(dt);
    this._updateFxSprites(dt);
    this._updateBigDebris(dt);

    // 炮塔威胁（射程内才工作；缓慢坠毁/坠毁后停火；目标=玩家+僚机，每炮塔锁定最近）
    let anyFiring = false;
    if (!this._slowCrash && !this._falling) {
      const targets = this._turretTargets || (this._turretTargets = []);
      targets.length = 0;
      if (player && player.root && !player.crashed) targets.push(player);
      if (wingmen) for (const w of wingmen) { if (w && w.ready && w.root) targets.push(w); }
      let anyNear = false;
      for (const tg of targets) {
        if (this.root.position.distanceToSquared(tg.root.position) < 1100 * 1100) { anyNear = true; break; }
      }
      if (anyNear) anyFiring = this._updateTurrets(dt, targets);
    }
    this.weapons.update(dt, anyFiring);

    // 到达脱离点（西缘；仅巡航状态）
    if (!this._rtb && !this._falling && !this._slowCrash && this.root.position.x <= this.despawnX) {
      this._despawnRequested = true;
      this.onEvent('despawn', this);
    }
  }

  _updateCruise(dt) {
    this._dist += this.cruise * this._speedFactor * dt;
    const r0 = this.route[0];
    this._v1.copy(this._routeDir).multiplyScalar(this._dist);
    this.root.position.set(
      r0.x + this.slot.x + this._v1.x,
      r0.y + this.slot.y + this._v1.y,
      r0.z + this.slot.z + this._v1.z,
    );
  }

  _updateRtb(dt) {
    // 限速缓慢转向返航方向（东 = +X）：恒定角速度转向（指数 slerp 在低帧率 dt 限幅
    // 下会变慢成"原地盘旋悬停"假象；rotateTowards 保证按 _rtbTurnRate 收敛）
    _rtbTargetQuat.setFromAxisAngle(_UP_Y, -Math.PI / 2);
    this.root.quaternion.rotateTowards(_rtbTargetQuat, this._rtbTurnRate * dt);
    this.root.position.addScaledVector(this.getForward(_tmpFwd), this._rtbSpeed * this._speedFactor * dt);
    this.root.position.y -= this._rtbSink * dt;
    this._applyResidualWobble(dt);
    if (this.root.position.y < 1200) this.root.position.y = 1200;
    // 远离玩家到雾中不可见 → 脱离（不查东缘 x：出生线 x=38000+slot.x，
    // 东缘判定会在返航第一帧即触发，导致伤员机当场凭空消失）
    if (this._player && this._player.root
      && this.root.position.distanceToSquared(this._player.root.position) > this._rtbDespawnDist * this._rtbDespawnDist) {
      this._despawnRequested = true;
      this.onEvent('despawn', this);
    }
  }

  /** 每机独立扰动：位置小幅度 + 姿态微晃（相位/频率各自随机，互不相关） */
  _applyWobble(dt) {
    if (this._rtb) return; // 返航状态不再叠编队扰动（伤员直飞）
    const w = this._wob, t = this._t;
    const oy = Math.sin(t * w.f1 + w.p1) * w.amp;
    const ox = Math.cos(t * w.f2 + w.p2) * w.amp * 0.6;
    const oz = Math.sin(t * w.f3 + w.p3) * w.amp * 0.5;
    this._v1.set(1, 0, 0).applyQuaternion(this.root.quaternion);
    this._v2.set(0, 1, 0).applyQuaternion(this.root.quaternion);
    this._v3.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    this.root.position.addScaledVector(this._v1, ox).addScaledVector(this._v2, oy).addScaledVector(this._v3, oz);
    // 记录本帧扰动偏移（状态切换时转入 _residualWob 衰减，防位置跳变）
    this._wobOffset.copy(this._v1).multiplyScalar(ox)
      .addScaledVector(this._v2, oy).addScaledVector(this._v3, oz);
    this._q1.setFromEuler(_tmpEuler.set(
      Math.sin(t * 0.23 + w.p2) * w.rollAmp * 0.5,
      0,
      Math.sin(t * 0.31 + w.p1) * w.rollAmp,
      'YXZ',
    ));
    this.root.quaternion.copy(this._baseQuat).multiply(this._q1);
  }

  // ---------- 受击 / 损伤 ----------
  /**
   * 命中结算（GameRuntime 调用）。
   * @param d 伤害值
   * @param hitDir 命中方向（归一化）
   * @param sphereIdx 命中的 hitSpheres 索引（发动机定位用；-1=未定位）
   * @param explosive 是否机炮（30mm 高爆）
   * @param hitPos 命中点世界坐标（机炮命中反馈特效用，可空）
   */
  onBulletHit(d, hitDir, sphereIdx = -1, explosive = false, hitPos = null) {
    // 30mm 高爆命中反馈：火团 + 黑烟（坠毁中的机体命中也照常放，先结算特效）
    if (explosive && hitPos) this._spawnImpactFx(hitPos);
    if (this._falling) return false;

    // 发动机子损伤：命中发动机球且该发未受损 → 受损冒烟
    if (sphereIdx >= 0 && this.hitSpheres[sphereIdx]) {
      const engIdx = this.hitSpheres[sphereIdx].engine;
      if (engIdx != null && this.engines[engIdx] && !this.engines[engIdx].damaged) {
        this.engines[engIdx].damaged = true;
      }
    }

    this.hp -= d;
    // 55% 阈值（一次性）：35% 概率脱离编队返航，65% 带伤跟随编队
    if (!this.damaged && this.hp <= this.maxHp * (1 - this.damageThreshold)) {
      this.damaged = true;
      if (Math.random() < this.rtbChance) this._enterRtb();
      this.onEvent('damaged', this);
    }
    // 阈值派生状态立即结算（大火/缓慢坠毁/死亡）
    this._updateDamageStates(0);
    this._checkDeath();
    return this._falling;
  }

  /**
   * 损伤状态机（每帧/受击时结算）：
   *   发动机数量 → 减速 + DoT；HP<40% 发动机大火 + 每3s掉2；HP<10% 缓慢坠毁；HP=0 坠毁
   */
  _updateDamageStates(dt) {
    // 发动机数量状态（不叠加，按数量切换）
    let cnt = 0;
    for (const e of this.engines) if (e.damaged) cnt++;
    this._engineCount = cnt;
    this._speedFactor = cnt >= 4 ? 0.75 : cnt >= 3 ? 0.80 : cnt >= 2 ? 0.90 : 1;

    // 发动机持续掉血：3 发 2/s；4 发 10/s
    const dotRate = cnt >= 4 ? 10 : cnt >= 3 ? 2 : 0;
    if (dotRate > 0 && dt > 0) this.hp -= dotRate * dt;

    // HP<40%：随机一个冒烟发动机燃大火（冒烟加重 + 每 3s 掉 2）
    if (this._engineFireIdx < 0 && this.hp <= this.maxHp * 0.4 && this.hp > 0) {
      const smoking = [];
      this.engines.forEach((e, i) => { if (e.damaged) smoking.push(i); });
      if (smoking.length) this._engineFireIdx = smoking[Math.floor(Math.random() * smoking.length)];
    }
    if (this._engineFireIdx >= 0 && dt > 0) {
      this._fireDotAcc += dt;
      while (this._fireDotAcc >= 3) { this._fireDotAcc -= 3; this.hp -= 2; }
    }

    // HP<10%：缓慢坠毁（向下固定 15-20°，炮塔停火）
    if (!this._slowCrash && this.hp > 0 && this.hp <= this.maxHp * 0.1) {
      this._enterSlowCrash();
    }

    if (dt > 0) this._checkDeath();
  }

  /** 死亡判定：HP=0 → 坠毁四式；过量伤害（hp<=-100）强制爆炸式 */
  _checkDeath() {
    if (this._falling || this.hp > 0) return;
    const overkill = this.hp <= -100;
    this._enterCrash(overkill ? 4 : 1 + Math.floor(Math.random() * 3));
    this.onEvent('killed', this);
  }

  _enterRtb() {
    this._rtb = true;
    this._residualWob.copy(this._wobOffset);   // 编队扰动残余偏移 → 平滑抹平，消除位置跳变
    this._residualWobK = 1;
    // 脱离编队：扰动停加，姿态自然回正由 _updateRtb 的 rotateTowards 接管
  }

  // ---------- 缓慢坠毁（HP<10%） ----------
  _enterSlowCrash() {
    this._slowCrash = true;
    this._rtb = false;
    this._residualWob.copy(this._wobOffset);   // 编队扰动残余偏移 → 平滑抹平，消除位置跳变
    this._residualWobK = 1;
    this._slowPitch = THREE.MathUtils.degToRad(15 + Math.random() * 5); // 向下固定 15-20°
    for (const t of this.turrets) this.weapons.setGroupFiring(t.name, false); // 机枪不再射击
  }

  _updateSlowCrash(dt) {
    // 减速下坠：固定俯角，拉坠毁浓烟
    const spd = this.cruise * this._speedFactor * 0.7;
    const fwd = this.getForward(_tmpFwd);
    this.root.position.addScaledVector(fwd, spd * Math.cos(this._slowPitch) * dt);
    this.root.position.y -= spd * Math.sin(this._slowPitch) * dt;
    this._applyResidualWobble(dt);
    // 姿态非常缓慢地压到俯角（保持航向；0.10 rad/s ≈ 5.7°/s，重型轰炸机无突兀姿态变化）
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    this._q1.setFromEuler(_tmpEuler.set(-this._slowPitch, yaw, 0, 'YXZ'));
    this.root.quaternion.rotateTowards(this._q1, 0.10 * dt);
    // 坠毁浓烟（机身后拖，大烟团；灰阶随机层次，0.7 不透明度防过浓失真）
    this._crashSmokeAcc += dt * 24;
    while (this._crashSmokeAcc >= 1) {
      this._crashSmokeAcc -= 1;
      this._spawnSmoke(this.hitSpheres[0] ? this.hitSpheres[0].offset : this._v1.set(0, 5, 0), {
        heavy: true, size: 6 + Math.random() * 3, life: 2.5 + Math.random() * 1.0,
        opacity: 0.7, tints: _CRASH_SMOKE_TINTS,
      });
    }
    // DoT 继续结算（发动机/大火）；触地按坠毁处理
    this._updateDamageStates(dt);
    if (this._slowCrash && this.root.position.y <= 60) {
      this.hp = Math.min(this.hp, 0);
      this._checkDeath();
    }
  }

  // ---------- 坠毁四式（HP=0） ----------
  _enterCrash(mode) {
    if (this._falling) return;
    this._falling = true;
    this._slowCrash = false;
    this._rtb = false;
    this._residualWob.copy(this._wobOffset);   // 编队扰动残余偏移 → 平滑抹平，消除位置跳变
    this._residualWobK = 1;
    const diveMax = this.cruise * 1.8;   // 坠毁极速基准
    // 姿态初值直接取当前四元数（含扰动残量），进入坠毁零瞬跳
    const e0 = _tmpEuler.setFromQuaternion(this.root.quaternion, 'YXZ');
    const c = this._crash = {
      mode,
      yaw: e0.y,
      speed: this.cruise * this._speedFactor,
      pitch: e0.x,
      rollAngle: e0.z, rollRate: 0, rollTarget: 0,
      targetSpeed: 0, targetPitch: 0,
    };
    if (mode === 1) {
      // ① 30° 俯冲：随机左右倾 20°（滚转平滑压到目标值，不瞬跳），加速到极速 90%
      c.targetPitch = -THREE.MathUtils.degToRad(30);
      c.rollTarget = THREE.MathUtils.degToRad((Math.random() < 0.5 ? -1 : 1) * 20);
      c.targetSpeed = diveMax * 0.9;
    } else if (mode === 2) {
      // ② 翻覆：缓慢滚转失控，30-45° 下坠，加速到极速 70%
      c.targetPitch = -THREE.MathUtils.degToRad(30 + Math.random() * 15);
      c.rollRate = THREE.MathUtils.degToRad((Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 8));
      c.targetSpeed = diveMax * 0.7;
    } else {
      // ③ 爆燃解体 / ④ 爆炸：40-60° 缓慢下坠 + 缓慢翻滚，大火黑烟 + 零件散落
      c.targetPitch = -THREE.MathUtils.degToRad(40 + Math.random() * 20);
      c.rollRate = THREE.MathUtils.degToRad((Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 10));
      c.targetSpeed = diveMax * 0.5;
      if (mode === 4) this._explosionBurst();   // 爆炸瞬间：闪光 + 火光 + 白烟爆散
      this._spawnBigDebris(mode);               // 大块零件着火下落 + 小碎片散落
    }
    this._bodyFire = true;                      // 全模式坠毁后机身大火（③④ 另有零件飞散）
    for (const t of this.turrets) this.weapons.setGroupFiring(t.name, false);
  }

  _updateCrash(dt) {
    const c = this._crash;
    if (!c) return;
    // 速度/姿态推进：俯仰/压倾全部限速线性逼近（重型机无突兀姿态，事件过程拉长）
    if (c.targetSpeed > c.speed) c.speed = Math.min(c.targetSpeed, c.speed + 20 * dt);
    else c.speed = Math.max(c.targetSpeed, c.speed - 12 * dt);
    const pr = THREE.MathUtils.degToRad(6.5) * dt;   // 俯仰 ≤6.5°/s（30° 目标约 5s 压满）
    c.pitch += THREE.MathUtils.clamp(c.targetPitch - c.pitch, -pr, pr);
    if (c.rollRate !== 0) c.rollAngle += c.rollRate * dt;              // 失控翻滚（②③④持续）
    else if (c.rollTarget) {                                            // ① 压倾 ≤5°/s（20° 约 4s）
      const rr = THREE.MathUtils.degToRad(5) * dt;
      c.rollAngle += THREE.MathUtils.clamp(c.rollTarget - c.rollAngle, -rr, rr);
    }
    this._q1.setFromEuler(_tmpEuler.set(c.pitch, c.yaw, c.rollAngle, 'YXZ'));
    this.root.quaternion.copy(this._q1);
    const fwd = this.getForward(_tmpFwd);
    this.root.position.addScaledVector(fwd, c.speed * dt);
    this._applyResidualWobble(dt);

    // 坠毁浓烟（全模式：每拍两个随机机身发烟点，16/s×2 保证烟迹连续不断续；
    // 灰阶随机层次，0.7 不透明度防过浓失真；③④ 另有零件散落）
    this._crashSmokeAcc += dt * 16;
    while (this._crashSmokeAcc >= 1) {
      this._crashSmokeAcc -= 1;
      this._spawnSmoke(this._randBodyPoint(), {
        heavy: true, size: 7 + Math.random() * 4, life: 3.0 + Math.random() * 1.5,
        opacity: 0.7, tints: _CRASH_SMOKE_TINTS,
      });
      this._spawnSmoke(this._randBodyPoint(), {
        heavy: true, size: 6 + Math.random() * 3, life: 2.5 + Math.random() * 1.2,
        opacity: 0.7, tints: _CRASH_SMOKE_TINTS,
      });
    }
    // 机身大火（全模式坠毁状态：机身多发火点随机闪燃）
    if (this._bodyFire) {
      this._bodyFireAcc += dt * 16;
      while (this._bodyFireAcc >= 1) {
        this._bodyFireAcc -= 1;
        this._spawnFx(this._randBodyPoint(), {
          size: 5.5 + Math.random() * 4.5, life: 0.25 + Math.random() * 0.2,
          color: [0xffaa44, 0xff7722, 0xffcc66, 0xff5518][Math.floor(Math.random() * 4)],
        });
      }
    }
    // 触地爆炸 → 移除
    if (this.root.position.y <= 60) this._groundImpact();
  }

  /** 机身特效点随机取一个（躯干/翼尖/尾/发动机烟点，body frame） */
  _randBodyPoint() {
    return this._bodyFxPoints.length
      ? this._bodyFxPoints[Math.floor(Math.random() * this._bodyFxPoints.length)]
      : this._v1.set(0, 5, 0);
  }

  /**
   * 30mm 高爆命中反馈（打击感但克制）：命中点 1-3 团 3.5-5.5m 火光外抛 + 1 团近黑烟。
   */
  _spawnImpactFx(pos) {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      this._spawnFx(null, {
        at: pos, size: 3.5 + Math.random() * 2, life: 0.22 + Math.random() * 0.18,
        color: [0xffcc66, 0xffaa44, 0xff7722][Math.floor(Math.random() * 3)],
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 12, (Math.random() - 0.3) * 12, (Math.random() - 0.5) * 12),
        growth: 2.2,
      });
    }
    this._spawnSmoke(null, {
      at: pos, dark: true, size: 3 + Math.random() * 1.5, life: 1.4 + Math.random() * 0.8,
    });
  }

  /** 编队扰动残余偏移平滑抹平：位置增量式更新中偏移已含在 position 里，
   *  每帧加 O×(kNew-kOld)（负增量），累计恰为 -O —— 零瞬跳也无过冲漂移。 */
  _applyResidualWobble(dt) {
    if (this._residualWobK <= 0.002) { this._residualWobK = 0; return; }
    const kNew = this._residualWobK * Math.exp(-2.2 * dt);
    this.root.position.addScaledVector(this._residualWob, kNew - this._residualWobK);
    this._residualWobK = kNew;
  }

  _groundImpact() {
    if (this._despawnRequested) return;
    this._explosionBurst(0.8);
    this._despawnRequested = true;
    this.onEvent('despawn', this);
  }

  /** 爆炸瞬间效果（模式④/触地）：中心闪光 + 火光团 + 白烟爆散 */
  _explosionBurst(scale = 1) {
    const pos = this.root.position;
    // 中心闪光
    this._spawnFx(null, {
      at: pos, size: (8 + Math.random() * 4) * scale, life: 0.14,
      color: 0xffffff, growth: 3.0,
    });
    // 火光团（additive）
    for (let i = 0; i < 12; i++) {
      this._spawnFx(null, {
        at: pos, size: (3 + Math.random() * 4) * scale, life: 0.4 + Math.random() * 0.3,
        color: [0xffaa44, 0xff8822, 0xffcc66, 0xff6633][i % 4],
        vel: this._v1.set((Math.random() - 0.5) * 30, (Math.random() - 0.3) * 30, (Math.random() - 0.5) * 30).clone(),
        growth: 2.5,
      });
    }
    // 白烟爆散（normal blending，向四周）
    for (let i = 0; i < 10; i++) {
      const s = this._smokePool.pop() || { sp: null, vel: new THREE.Vector3(), life: 0, maxLife: 0, size: 1, opacity: 0.7 };
      if (!s.sp) {
        s.sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this._smokeTex, transparent: true, depthWrite: false, fog: true,
        }));
        s.sp.renderOrder = 3;
      }
      s.sp.material.color.setHex(0xcccccc);   // 白烟
      s.sp.position.copy(pos);
      s.vel.set((Math.random() - 0.5) * 45, (Math.random() - 0.3) * 45, (Math.random() - 0.5) * 45);
      s.maxLife = 1.2 + Math.random() * 0.8;
      s.life = s.maxLife;
      s.size = (2.5 + Math.random() * 2.5) * scale;
      s.opacity = 0.7;
      s.sp.scale.setScalar(s.size);
      s.sp.material.opacity = s.opacity;
      this.scene.add(s.sp);
      this._smokes.push(s);
    }
    // 碎片向四周爆散（拉小烟尘）
    this._spawnSmallDebris(14, 70, true);
  }

  // ---------- 大块零件/小碎片（一直下落，>1000m 消失） ----------
  _spawnBigDebris(mode) {
    const pos = this.root.position;
    const fwd = this.getForward(_tmpFwd);
    const baseSpeed = this._crash ? this._crash.speed : this.cruise;
    // 大块零件 6-10（全部着火下落）
    const nLarge = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < nLarge; i++) {
      this._spawnDebrisPiece(pos, fwd, baseSpeed, true, mode);
    }
    // 小碎片 16-24（部分着火，爆散范围更大）
    this._spawnSmallDebris(16 + Math.floor(Math.random() * 8), 40, false);
  }

  _spawnSmallDebris(n, spread, withTrail) {
    const pos = this.root.position;
    const fwd = this.getForward(_tmpFwd);
    const baseSpeed = this._crash ? this._crash.speed : this.cruise;
    for (let i = 0; i < n; i++) {
      this._spawnDebrisPiece(pos, fwd, baseSpeed, false, withTrail ? 4 : 0, spread);
    }
  }

  _spawnDebrisPiece(pos, fwd, baseSpeed, large, mode, spread = 26) {
    const geo = _bigDebrisGeos[Math.floor(Math.random() * _bigDebrisGeos.length)];
    const mat = new THREE.MeshBasicMaterial({
      color: _debrisColors[Math.floor(Math.random() * _debrisColors.length)],
      transparent: true, opacity: 1.0,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    const sz = large ? 1.2 + Math.random() * 1.6 : 0.25 + Math.random() * 0.5;
    m.scale.setScalar(sz);
    m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    this.scene.add(m);
    const spd = large ? 0.5 : 1.0;
    const d = {
      mesh: m, mat,
      vel: new THREE.Vector3(
        fwd.x * baseSpeed * spd + (Math.random() - 0.5) * spread,
        fwd.y * baseSpeed * spd + (Math.random() - 0.2) * spread * 0.6,
        fwd.z * baseSpeed * spd + (Math.random() - 0.5) * spread,
      ),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * (large ? 4 : 12),
        (Math.random() - 0.5) * (large ? 4 : 12),
        (Math.random() - 0.5) * (large ? 4 : 12),
      ),
      large,
      fireSprite: null,
      smokeAcc: 0,
      trailT: large ? 99999 : (mode === 4 ? 1.2 : 0), // 爆炸式小碎片拉 1.2s 小烟尘
    };
    // 大块零件全部着火；小碎片 30% 着火
    if (large || Math.random() < 0.3) {
      const fmat = new THREE.SpriteMaterial({
        map: this._fireTex, color: 0xff8830, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      d.fireSprite = new THREE.Sprite(fmat);
      d.fireSprite.scale.setScalar(sz * (1.5 + Math.random()));
      d.fireSprite.renderOrder = 18;
      this.scene.add(d.fireSprite);
    }
    this._bigDebris.push(d);
  }

  _updateBigDebris(dt) {
    const p = this._player && this._player.root ? this._player.root.position : null;
    for (let i = this._bigDebris.length - 1; i >= 0; i--) {
      const d = this._bigDebris[i];
      d.vel.y -= 8 * dt;                      // 重力下坠
      d.vel.multiplyScalar(1 - dt * 0.15);    // 轻微空气阻尼
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (d.fireSprite) {
        d.fireSprite.position.copy(d.mesh.position);
        d.fireSprite.material.opacity = 0.7 + Math.random() * 0.3; // 火光闪烁
      }
      // 小烟尘尾迹（爆炸式小碎片 / 大块零件拖烟）
      if (d.trailT > 0) {
        d.trailT -= dt;
        d.smokeAcc += dt * (d.large ? 6 : 10);
        while (d.smokeAcc >= 1) {
          d.smokeAcc -= 1;
          this._spawnSmoke(null, { at: d.mesh.position, size: d.large ? 1.6 : 0.9, life: 0.8, dark: true });
        }
      }
      // 消失条件：落地，或离玩家 >1000m（"一直下落，超过1000米外消失"）
      const tooFar = p && d.mesh.position.distanceToSquared(p) > 1000 * 1000;
      if (d.mesh.position.y <= 0 || tooFar) {
        this.scene.remove(d.mesh);
        d.mat.dispose();
        if (d.fireSprite) { this.scene.remove(d.fireSprite); d.fireSprite.material.dispose(); }
        this._bigDebris.splice(i, 1);
      }
    }
  }

  // ---------- 发动机发烟 / 火光 ----------
  _makeSmokeTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    // 中性灰底（明度交给材质 tint 灰阶调制，单纹理覆盖 黑~浅灰 全色域）
    grd.addColorStop(0, 'rgba(110,105,100,0.95)');
    grd.addColorStop(0.4, 'rgba(95,90,85,0.7)');
    grd.addColorStop(0.75, 'rgba(80,76,72,0.25)');
    grd.addColorStop(1, 'rgba(75,71,68,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  _makeFireTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,245,210,1)');
    grd.addColorStop(0.45, 'rgba(255,170,60,0.95)');
    grd.addColorStop(0.75, 'rgba(255,100,25,0.45)');
    grd.addColorStop(1, 'rgba(255,60,10,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  _updateEngineSmoke(dt) {
    // 排放：受损发动机 14/s 长拖烟；燃大火的发动机 30/s 浓烟 + 火光
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i];
      if (!e.damaged) continue;
      const onFire = i === this._engineFireIdx;
      e.emitAcc += dt * (onFire ? 30 : 14);
      while (e.emitAcc >= 1) {
        e.emitAcc -= 1;
        this._spawnSmoke(e.smokeOffset, { heavy: onFire });
        if (onFire) {
          this._spawnFx(e.smokeOffset, {
            size: 4.5 + Math.random() * 2.5, life: 0.18 + Math.random() * 0.12,
            color: [0xffaa44, 0xff7722, 0xffcc66][Math.floor(Math.random() * 3)],
          });
        }
      }
    }
    // 推进
    for (let i = this._smokes.length - 1; i >= 0; i--) {
      const s = this._smokes[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.sp);
        s.sp.material.dispose();
        this._smokePool.push(s);
        this._smokes.splice(i, 1);
        continue;
      }
      s.sp.position.addScaledVector(s.vel, dt);
      const k = 1 - s.life / s.maxLife;
      s.sp.scale.setScalar(s.size * (1 + k * 3.5));
      s.sp.material.opacity = s.opacity * (1 - k);
    }
  }

  /**
   * 排放一个烟 sprite。
   * offset：body frame 发烟点；opts: {at:世界坐标(优先于offset), heavy, dark, size, life, vel, opacity, tints}
   * tints：灰阶数组随机取一（颜色层次）；dark=true 等价于 tints=_IMPACT_SMOKE_TINTS
   */
  _spawnSmoke(offset, opts = {}) {
    const s = this._smokePool.pop() || { sp: null, vel: new THREE.Vector3(), life: 0, maxLife: 0, size: 1, opacity: 0.8 };
    if (!s.sp) {
      s.sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._smokeTex, transparent: true, depthWrite: false, fog: true,
      }));
      s.sp.renderOrder = 3;
    }
    const pal = opts.tints || (opts.dark ? _IMPACT_SMOKE_TINTS : _ENGINE_SMOKE_TINTS);
    const gray = pal[(Math.random() * pal.length) | 0];
    s.sp.material.color.setRGB(gray, gray, gray);
    if (opts.at) s.sp.position.copy(opts.at);
    else s.sp.position.copy(offset).applyQuaternion(this.root.quaternion).add(this.root.position);
    // 默认：烟向后拖（相对飞机后向 + 微上飘 + 随机）
    const backSpd = (this._falling && this._crash ? this._crash.speed : this.cruise) * 0.85;
    s.vel.set(0, 0, 1).applyQuaternion(this.root.quaternion).multiplyScalar(backSpd);
    s.vel.y += 2;
    s.vel.x += (Math.random() - 0.5) * 3;
    s.vel.y += (Math.random() - 0.5) * 3;
    s.vel.z += (Math.random() - 0.5) * 3;
    const heavyK = opts.heavy ? 1.8 : 1;
    s.maxLife = (opts.life ?? (2.0 + Math.random() * 0.8)) * heavyK;
    s.life = s.maxLife;
    s.size = (opts.size ?? (3.2 + Math.random() * 1.6)) * heavyK;
    s.opacity = opts.opacity ?? 0.8;
    s.sp.scale.setScalar(s.size);
    s.sp.material.opacity = s.opacity;
    this.scene.add(s.sp);
    this._smokes.push(s);
  }

  /** 排放一个火光/闪光 sprite（additive，短寿命）。offset 为 body frame；opts.at 可指定世界坐标 */
  _spawnFx(offset, opts = {}) {
    const mat = new THREE.SpriteMaterial({
      map: this._fireTex, color: opts.color ?? 0xffaa44, transparent: true, opacity: 1.0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sp = new THREE.Sprite(mat);
    if (opts.at) sp.position.copy(opts.at);
    else sp.position.copy(offset).applyQuaternion(this.root.quaternion).add(this.root.position);
    sp.scale.setScalar(opts.size ?? 2);
    sp.renderOrder = 18;
    this.scene.add(sp);
    this._fxSprites.push({
      sp, vel: opts.vel || null,
      life: opts.life ?? 0.25, maxLife: opts.life ?? 0.25,
      growth: opts.growth ?? 1.2,
    });
  }

  _updateFxSprites(dt) {
    for (let i = this._fxSprites.length - 1; i >= 0; i--) {
      const f = this._fxSprites[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.scene.remove(f.sp);
        f.sp.material.dispose();
        this._fxSprites.splice(i, 1);
        continue;
      }
      if (f.vel) f.sp.position.addScaledVector(f.vel, dt);
      const k = 1 - f.life / f.maxLife;
      f.sp.scale.multiplyScalar(1 + f.growth * dt);
      f.sp.material.opacity = 1 - k;
    }
  }

  // ---------- 炮塔真威胁 ----------
  /**
   * 射界内带提前量瞄准（运行时改写 muzzleDirs 指向预测命中点）+ 短点射节奏。
   * 目标列表 targets = 玩家 + 僚机（第4关僚机表演性质：只被瞄准不受击）；
   * 每炮塔独立锁定"射界射程内最近"的目标。返回是否有任一炮塔开火中。
   */
  _updateTurrets(dt, targets) {
    this._qInv.copy(this.root.quaternion).invert();
    let anyFiring = false;
    for (const t of this.turrets) {
      // 选最近且在射界/射程内的目标
      let best = null, bestDist = Infinity;
      for (const tgt of targets) {
        this._v1.copy(tgt.root.position).sub(this.root.position);
        const dist = this._v1.length();
        if (dist > t.range || dist >= bestDist) continue;
        this._v1.applyQuaternion(this._qInv).normalize();
        const yaw = THREE.MathUtils.radToDeg(Math.atan2(this._v1.x, this._v1.z));   // 后向 180°
        const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(this._v1.y, -1, 1)));
        const inArc = this._angDiff(yaw, t.yawCenter) <= t.yawRange / 2
          && Math.abs(pitch - t.pitchCenter) <= t.pitchRange / 2;
        if (inArc) { best = tgt; bestDist = dist; }
      }
      const inArc = !!best;

      t.timer -= dt;
      if (t.state === 'idle') {
        if (inArc && t.timer <= 0) {
          t.state = 'burst';
          t.timer = t.burst[0] + Math.random() * (t.burst[1] - t.burst[0]);
        }
      } else {
        if (!inArc || t.timer <= 0) {
          t.state = 'idle';
          t.timer = t.cd[0] + Math.random() * (t.cd[1] - t.cd[0]);
          this.weapons.setGroupFiring(t.name, false);
        }
      }

      if (t.state === 'burst' && inArc) {
        // 提前量：弹丸飞行时间 × 目标速度矢量 → 预测命中点
        const tof = bestDist / (this.weapons.bulletSpeed || 650);
        this._v2.copy(best.root.position)
          .addScaledVector(best.getVelocity ? best.getVelocity(_tmpVel) : this._v3.set(0, 0, 0), tof);
        for (const idx of t.muzzles) {
          this.getMuzzleWorldPosition(idx, _tmpMuzzlePos);
          this._v3.copy(this._v2).sub(_tmpMuzzlePos).normalize().applyQuaternion(this._qInv);
          const spread = THREE.MathUtils.degToRad(t.spreadDeg ?? 1.5) * (0.5 + bestDist / t.range);
          this._v3.x += (Math.random() - 0.5) * spread;
          this._v3.y += (Math.random() - 0.5) * spread;
          this._v3.z += (Math.random() - 0.5) * spread;
          this._v3.normalize();
          if (this.muzzleDirs && this.muzzleDirs[idx]) this.muzzleDirs[idx].copy(this._v3);
        }
        this.weapons.setGroupFiring(t.name, true);
        anyFiring = true;
      } else if (t.state !== 'burst') {
        this.weapons.setGroupFiring(t.name, false);
      }
    }
    return anyFiring;
  }

  _angDiff(a, b) {
    let d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  /** 机体命中球（GameRuntime 玩家子弹检测用）：返回命中的球索引或 -1 */
  testBulletHit(bulletPos) {
    for (let i = 0; i < this.hitSpheres.length; i++) {
      const s = this.hitSpheres[i];
      this._v1.copy(s.offset).applyQuaternion(this.root.quaternion).add(this.root.position);
      if (bulletPos.distanceToSquared(this._v1) < s.radius * s.radius) return i;
    }
    return -1;
  }

  /** 碰撞检测（GameRuntime 玩家撞机判定用）：命中球半径外扩 extraR */
  testCollision(pos, extraR = 0) {
    for (let i = 0; i < this.hitSpheres.length; i++) {
      const s = this.hitSpheres[i];
      this._v1.copy(s.offset).applyQuaternion(this.root.quaternion).add(this.root.position);
      const r = s.radius + extraR;
      if (pos.distanceToSquared(this._v1) < r * r) return true;
    }
    return false;
  }

  dispose() {
    for (const s of this._smokes) { this.scene.remove(s.sp); s.sp.material.dispose(); }
    for (const s of this._smokePool) if (s.sp) { this.scene.remove(s.sp); s.sp.material.dispose(); }
    this._smokes = [];
    this._smokePool = [];
    for (const f of this._fxSprites) { this.scene.remove(f.sp); f.sp.material.dispose(); }
    this._fxSprites = [];
    for (const d of this._bigDebris) {
      this.scene.remove(d.mesh);
      d.mat.dispose();
      if (d.fireSprite) { this.scene.remove(d.fireSprite); d.fireSprite.material.dispose(); }
    }
    this._bigDebris = [];
    if (this._smokeTex) { this._smokeTex.dispose(); this._smokeTex = null; }
    if (this._fireTex) { this._fireTex.dispose(); this._fireTex = null; }
  }
}
