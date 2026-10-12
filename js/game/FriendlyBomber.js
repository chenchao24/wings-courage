/**
 * 友军 NPC 轰炸机（演出用，玩家护航目标）。
 *
 * 完全独立于 Enemy 的 AI/物理/武器系统，只复用 Aircraft 的模型加载/归一化/
 * 螺旋桨/起落架隐藏。行为脚本化：
 *   - 长机：按 _route 航线直线平飞，到达终点后脱离消失
 *   - 僚机：跟随长机保持 V 字编队偏移（位置 lerp + 朝向 slerp）
 *
 * 不走街机物理（updateFlight）、不走 AI 决策（think）、不开火、不坠毁。
 * 朝向用四元数直接计算（让机头 -Z 朝向航点），避免 Object3D.lookAt 的 +Z 约定
 * 导致机头朝反方向的问题。
 */
import * as THREE from 'three';
import { Aircraft } from '../aircraft.js';
import { MODEL_CONFIGS } from '../enemy.js';
import { Weapons } from '../weapons.js';

// 复用临时向量/四元数（避免每帧 new）
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _FWD = new THREE.Vector3(0, 0, -1); // body frame 机头方向
const _toEnemy = new THREE.Vector3();    // 轰炸机→敌机临时向量
const _invQ = new THREE.Quaternion();    // 轰炸机四元数逆（用于 body frame 转换）
const _localEnemy = new THREE.Vector3(); // 敌机在轰炸机 body frame 中的位置

export class FriendlyBomber extends Aircraft {
  constructor(scene, renderer) {
    super(scene, renderer);

    this.isFriendly = true;
    this.ready = false;

    // 模型校准默认值（_applyModelConfig 会按 URL 覆盖）
    this.autoOrient   = true;
    this.yawOffset    = 0;
    this.pitchOffset = 0;
    this.rollOffset  = 0;
    this.userScale   = 3.6;
    this.centerOffset = null;
    this._hideGear       = false;
    this._hideGearNodes  = null;
    this._propNodes      = null;
    this._propBlurOnly   = false;
    this._castShadow     = true;   // 模型阴影开关（_applyModelConfig 可按机型覆盖）

    // 飞行状态（Aircraft.update 需要这些属性存在）
    this.hp = 1;
    this.maxHp = 1;
    this.crashed = false;
    this.smokeThreshold = 0;
    this.throttle = 0.75;
    this.speed = 45;
    this.aiType = 'bomber';          // Weapons 用此判断子弹颜色（红橙曳光弹）

    // 脚本化飞行参数
    this._cruiseSpeed = 45;          // 巡航速度（单位/秒，街机化慢速方便玩家目视跟随）
    this._route = null;              // [{x,y,z}, ...] 航线点（长机用）
    this._routeIdx = 0;              // 当前目标航点索引
    this._despawnRequested = false;  // 到达终点请求脱离
    this._leader = null;             // 长机引用（僚机用）
    this._formationOffset = new THREE.Vector3(); // 相对长机的 body frame 偏移
    this._isFollowingPlayer = false; // 跟随玩家标志（平滑跟随模式开关）
    this._wobblePhase = Math.random() * Math.PI * 2;  // 摇摆随机相位（避免僚机同步晃动）
    // 不定时上下晃动（脉冲式，间隔3-5秒，持续1-2秒，幅度±2-3m）
    this._wobbleTimer = 2 + Math.random() * 3;   // 下次晃动倒计时（首次2-5s后）
    this._wobbleActive = false;                   // 当前是否在晃动
    this._wobbleDur = 0;                          // 当前晃动持续时长
    this._wobbleElapsed = 0;                      // 当前晃动已进行时长
    this._wobbleAmp = 0;                          // 当前晃动幅度
    this._targetAlt = null;           // 目标高度（分兵时升高用，null=不强制）
    this._combatMode = false;         // 战斗模式（Falke-2 接敌后散开前出追击敌机）

    // 自卫炮塔武器（表演性质：子弹只飞行视觉效果，不会命中敌机）
    // 命中检测在 GameRuntime._hitDetection 中跳过 friendlyBombers 的子弹
    this.weapons = new Weapons(scene, this);
    this.weapons.fireRate = 0.12;       // 慢射速（自卫炮塔）
    this.weapons.bulletSpeed = 600;
    this.weapons.life = 1.5;
    this.weapons.damageMin = 0;         // 表演性质，无伤害
    this.weapons.damageMax = 0;
    this.weapons.setAudio(null);        // 不播音效（避免嘈杂）
    this._turretFireTimer = 0;          // 开火持续计时
    this._turretFireCd = 0;             // 开火冷却
    this._turretFireReact = 0;          // 反应延迟计时
    this._enemyTargets = null;          // 敌机列表引用（由 GameRuntime 注入）
  }

  /**
   * 应用模型校准配置（读 MODEL_CONFIGS，注入外观参数）。
   * 复用 Enemy 的 MODEL_CONFIGS 注册表，保证 He 111 的朝向/缩放/起落架/螺旋桨配置一致。
   * 必须在 load(url) 之前调用。
   */
  _applyModelConfig(url) {
    const cfg = MODEL_CONFIGS[url];
    if (!cfg) return;
    if (cfg.autoOrient  !== undefined) this.autoOrient  = cfg.autoOrient;
    if (cfg.yawOffset   !== undefined) this.yawOffset   = cfg.yawOffset;
    if (cfg.pitchOffset !== undefined) this.pitchOffset = cfg.pitchOffset;
    if (cfg.rollOffset  !== undefined) this.rollOffset  = cfg.rollOffset;
    if (cfg.userScale   !== undefined) this.userScale   = cfg.userScale;
    if (cfg.centerOffset)  this.centerOffset  = cfg.centerOffset.slice();
    if (cfg.muzzleOffsets) this.muzzleOffsets = cfg.muzzleOffsets.map((v) => v.clone());
    if (cfg.muzzleDirs)    this.muzzleDirs    = cfg.muzzleDirs.map((v) => v.clone());
    if (cfg.hideGear    !== undefined) this._hideGear  = cfg.hideGear;
    if (cfg.hideGearNodes) this._hideGearNodes = cfg.hideGearNodes.slice();
    if (cfg.propNodes)    this._propNodes    = cfg.propNodes.slice();
    if (cfg.propBlurOnly !== undefined) this._propBlurOnly = cfg.propBlurOnly;
    if (cfg.noVaporTrail !== undefined) this.noVaporTrail = cfg.noVaporTrail;
    if (cfg.castShadow    !== undefined) this._castShadow  = cfg.castShadow;
  }

  async load(url) {
    this._applyModelConfig(url);
    await super.load(url);
    // 性能优化：按机型配置关闭阴影（高空编队演出，阴影 pass 开销巨大但视觉贡献极小）
    if (this._castShadow === false) {
      this.model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    }
    this.ready = true;
    this._initPosition();
  }

  /**
   * 初始化位置和朝向：长机定位到 route[0] 并朝向 route[1]。
   * 僚机的位置由外部（_initFriendlyBombers）设置。
   */
  _initPosition() {
    if (this._route && this._route.length > 1) {
      const r0 = this._route[0];
      this.root.position.set(r0.x, r0.y, r0.z);
      this._faceTo(this._route[1]);
      this._routeIdx = 1;
    }
  }

  /** 让机头(-Z)朝向 target 世界坐标点 */
  _faceTo(target) {
    _v1.copy(target).sub(this.root.position).normalize();
    _q1.setFromUnitVectors(_FWD, _v1);
    this.root.quaternion.copy(_q1);
  }

  /** 设置航线（长机用）。route = [{x,y,z}, ...] */
  setRoute(route) {
    this._route = (route && route.length) ? route.map((p) => ({ x: p.x, y: p.y, z: p.z })) : null;
  }

  /** 立即开始脱离（剧情分兵用）：触发 _despawn，模型隐藏，由 GameRuntime 检测后释放 */
  despawnNow() { this._despawn(); }

  /** 运行时修改巡航速度（剧情同步用） */
  setCruiseSpeed(v) { this._cruiseSpeed = v; this.speed = v; }

  /**
   * 设置转向航线（剧情分兵用）：长机改按这条航线飞行，僚机继续跟随。
   * 调用后 _updateLeader 切到 detour 航线，原 _route 被替换。
   * route = [{x,y,z}, ...]，最后一个点应远离视野（飞到后自动 despawn）
   */
  setDetourRoute(route) {
    this._route = (route && route.length) ? route.map((p) => ({ x: p.x, y: p.y, z: p.z })) : null;
    this._routeIdx = 0;  // 从新航线第一段开始
  }

  /** 分兵时升高到指定相对高度（世界 y 坐标） */
  setTargetAltitude(y) { this._targetAlt = y; }

  /** 设置长机引用和编队偏移（僚机用） */
  setLeader(leader, offset) {
    this._leader = leader;
    this._formationOffset = offset ? offset.clone() : null;
    // 跟随玩家时启用平滑跟随模式（连续低频浮动 + 更紧的 lerp）
    // 轰炸机僚机保持原脉冲式 wobble（前两关不变）
    this._isFollowingPlayer = !!(leader && leader.isPlayer);
  }

  /**
   * 注入敌机列表（自卫炮塔用，表演性质还击）。
   * 由 GameRuntime 在关卡启动后调用。
   */
  setEnemyTargets(enemies) {
    this._enemyTargets = enemies || null;
  }

  /**
   * 脚本化更新：不走 think/updateFlight，直接驱动位置和朝向。
   * 自卫炮塔开火为表演性质（子弹视觉效果，不会命中敌机）。
   * 复用 Aircraft.update 处理舵面/螺旋桨动画。
   */
  updateAll(dt) {
    if (!this.ready || this._despawnRequested) return;
    if (this._combatMode) {
      this._updateCombat(dt);
    } else if (this._leader) {
      this._updateWingman(dt);
    } else if (this._route && this._route.length) {
      this._updateLeader(dt);
    }
    // 自卫炮塔还击（表演性质）
    const firing = this._turretFire(dt) || this._combatFiring;
    if (this.weapons) this.weapons.update(dt, firing);
    this.update(dt);
  }

  /**
   * 进入战斗模式（友军战斗机用，如 Falke-2 接敌后散开前出）。
   * 脱离编队跟随，改为追击最近敌机 + 开火（表演性质，子弹不命中敌机，自身不被击落）。
   * 攻击动作脚本化为 climb（拉升占位）-> dive（俯冲突击+开火）-> egress（脱离）循环，
   * 表现凶猛的高空俯冲突击，速度冲到 400-500km/h。
   * @param {Function} getEnemies 返回当前活跃敌机列表的 getter
   */
  engageEnemies(getEnemies) {
    this._combatMode = true;
    this._leader = null;              // 脱离编队跟随
    this._getEnemies = getEnemies;    // 敌机列表 getter
    this._combatTarget = null;        // 当前追击目标
    this._combatFiring = false;       // 当前是否开火（_updateCombat 设置）
    this._retargetCd = 0;             // 重新选目标冷却
    // 战斗巡航提速：105 单位/s ≈ 378km/h，俯冲时 *1.3 ≈ 493km/h（落在 400-500km/h 区间）
    this._cruiseSpeed = 105;
    this.speed = this._cruiseSpeed;
    // 攻击动作状态机
    this._combatPhase = 'climb';      // 'climb' | 'dive' | 'egress' | 'chase'
    this._phaseTimer = 0;             // 当前阶段计时
    this._climbTargetY = 0;           // climb 阶段目标高度
    this._egressDir = new THREE.Vector3(); // egress 阶段脱离方向
    this._chaseDuration = 0;          // chase 阶段持续时长（随机 5-8s）
  }

  /**
   * 战斗模式更新：climb/dive/egress/chase 四态攻击动作（脚本化，不走街机物理）。
   *
   * climb（拉升）：飞到目标上方 200-400m，加速接近，到位后切 dive
   * dive（俯冲）：压机头冲目标，高速俯冲，dist<600m 开火（表演曳光弹），
   *              加 roll 摆动模拟压坡度，dist<250m 或 >4s 切 egress
   * egress（脱离）：沿脱离方向直线飞 4-6s，减速回巡航，计时结束切 chase
   * chase（平飞追击）：追击敌机，保持高度，dist<500m 偶尔开火，持续 5-8s 后切 climb
   *                    （避免反复拉起俯冲，增加平飞追击的机动多样性）
   *
   * 开火为表演性质：_combatFiring 标志驱动 weapons（伤害0、命中跳过，不改命中检测）。
   */
  _updateCombat(dt) {
    if (!this._getEnemies) return;
    const enemies = this._getEnemies();

    // 选目标：每 2s 重选最近存活敌机
    this._retargetCd -= dt;
    if (this._retargetCd <= 0 || !this._combatTarget || this._combatTarget.crashed || this._combatTarget._exploded) {
      this._retargetCd = 2.0;
      this._combatTarget = this._pickNearestEnemy(enemies);
    }

    // 无目标：保持当前朝向平飞巡航，不开火
    if (!this._combatTarget) {
      this.root.position.addScaledVector(this.getForward(), this._cruiseSpeed * dt);
      this._combatFiring = false;
      return;
    }

    this._phaseTimer += dt;
    const target = this._combatTarget;
    _v1.copy(target.root.position).sub(this.root.position);
    const dist = _v1.length();
    _v1.normalize(); // 自己->目标 方向

    if (this._combatPhase === 'climb') {
      // 拉升占位：飞到目标上方 200-400m（首次进入时记录目标高度）
      if (this._climbTargetY === 0) {
        this._climbTargetY = target.root.position.y + 250 + Math.random() * 150; // +250~400m
      }
      // 朝目标水平方向飞（保持机头大致对准目标，便于后续俯冲转向）
      _v2.copy(target.root.position);
      _v2.y = this.root.position.y; // 水平方向，不靠朝向爬升
      _v2.sub(this.root.position).normalize();
      _q1.setFromUnitVectors(_FWD, _v2);
      this.root.quaternion.slerp(_q1, Math.min(1, dt * 2.5));
      // 加速接近（巡航 *1.15）
      this.speed = this._cruiseSpeed * 1.15;
      this.root.position.addScaledVector(this.getForward(), this.speed * dt);
      // 强制爬升到目标高度（不依赖朝向 y 分量，直接 lerp 拉升，避免水平距离大时爬不上去）
      const yDiff = this._climbTargetY - this.root.position.y;
      if (yDiff > 0) {
        this.root.position.y += yDiff * Math.min(1, dt * 0.5); // 约 2s 爬升到位
      }
      this._combatFiring = false;
      // 高度到位即切 dive（俯冲过程本身会快速接近目标，不再卡距离条件）
      const aboveOk = this.root.position.y > target.root.position.y + 180;
      if (aboveOk) {
        this._combatPhase = 'dive';
        this._phaseTimer = 0;
      }
    } else if (this._combatPhase === 'dive') {
      // 俯冲突击：压机头冲目标，高速俯冲
      _q1.setFromUnitVectors(_FWD, _v1);
      this.root.quaternion.slerp(_q1, Math.min(1, dt * 3.5)); // 凌厉转向
      // 俯冲加速到 cruiseSpeed*1.3 ≈ 493km/h
      this.speed = this._cruiseSpeed * 1.3;
      this.root.position.addScaledVector(this.getForward(), this.speed * dt);
      // 压坡度 roll 摆动（模拟凶猛机动）
      const rollWobble = Math.sin(this._phaseTimer * 8) * 0.18; // ±10° 快速摆动
      this.root.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(_FWD, rollWobble * dt * 3));
      // 开火：距离 < 600 且大致对准目标（表演曳光弹）
      const aiming = this.getForward().dot(_v1) > 0.92;
      this._combatFiring = dist < 600 && aiming;
      // 距离 < 250 或俯冲超过 4s -> 切 egress
      if (dist < 250 || this._phaseTimer > 4) {
        this._combatPhase = 'egress';
        this._phaseTimer = 0;
        // 脱离方向：当前前向 + 偏上（拉起脱离，避免撞地）
        this._egressDir.copy(this.getForward());
        this._egressDir.y = Math.max(this._egressDir.y, 0.3); // 至少 30% 上仰
        this._egressDir.normalize();
        this._combatFiring = false;
      }
    } else if (this._combatPhase === 'egress') {
      // 脱离：沿脱离方向直线飞，减速回巡航
      _q1.setFromUnitVectors(_FWD, this._egressDir);
      this.root.quaternion.slerp(_q1, Math.min(1, dt * 2.0));
      this.speed = this._cruiseSpeed * 1.5; // 略快脱离
      this.root.position.addScaledVector(this.getForward(), this.speed * dt);
      this._combatFiring = false;
      // 脱离 4-6s 后切平飞追击（不再立即拉升，增加机动多样性）
      if (this._phaseTimer > 4 + Math.random() * 2) {
        this._combatPhase = 'chase';
        this._phaseTimer = 0;
        this._chaseDuration = 5 + Math.random() * 3; // 追击 5-8s
      }
    } else if (this._combatPhase === 'chase') {
      // 平飞追击：朝目标水平追击，保持当前高度，接近时偶尔开火
      _v2.copy(target.root.position);
      _v2.y = this.root.position.y; // 水平方向追击，不爬升不俯冲
      _v2.sub(this.root.position).normalize();
      _q1.setFromUnitVectors(_FWD, _v2);
      this.root.quaternion.slerp(_q1, Math.min(1, dt * 2.5));
      // 巡航速度追击（不加速，平飞状态）
      this.speed = this._cruiseSpeed;
      this.root.position.addScaledVector(this.getForward(), this.speed * dt);
      // 轻微 roll 摆动（模拟追击中的细微修正）
      const rollWobble = Math.sin(this._phaseTimer * 3) * 0.06;
      this.root.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(_FWD, rollWobble * dt * 2));
      // 接近 < 500 且对准则开火（表演曳光弹，频率比 dive 低）
      const aiming = this.getForward().dot(_v1) > 0.95;
      this._combatFiring = dist < 500 && aiming && Math.sin(this._phaseTimer * 2) > 0.3;
      // 追击时长到 -> 切 climb 重新占位俯冲
      if (this._phaseTimer > this._chaseDuration) {
        this._combatPhase = 'climb';
        this._phaseTimer = 0;
        this._climbTargetY = 0;
        this._combatFiring = false;
      }
    }
  }

  /** 选最近的存活敌机 */
  _pickNearestEnemy(enemies) {
    let best = null, bestD = Infinity;
    for (const en of enemies) {
      if (!en || !en.ready || en.crashed || en._exploded) continue;
      _v2.copy(en.root.position).sub(this.root.position);
      const d = _v2.lengthSq();
      if (d < bestD) { bestD = d; best = en; }
    }
    return best;
  }

  /**
   * 自卫炮塔开火逻辑（纯表演性质，减轻负担）：
   * - 后/侧炮塔（背炮塔/腹炮塔/侧后枪）在敌机位于轰炸机后方 500-1000m 时开火
   * - 前枪不参与（正面不生效，自卫炮塔只防御后方）
   * - 不判断命中、不扣血（纯视觉曳光弹效果）
   * - 子弹不会命中敌机（GameRuntime 命中检测跳过 friendlyBombers 子弹）
   * @returns {boolean} 是否开火
   */
  _turretFire(dt) {
    if (!this._enemyTargets || !this.muzzleDirs || !this.muzzleDirs.length) return false;

    // 计算轰炸机 body frame 逆四元数（用于判断敌机在前还是在后）
    _invQ.copy(this.root.quaternion).invert();

    // 扫描是否有敌机位于后方 500-1000m 范围内
    let hasRearTarget = false;
    for (const en of this._enemyTargets) {
      if (!en || !en.ready || en.crashed || en._exploded) continue;
      _toEnemy.copy(en.root.position).sub(this.root.position);
      const dist = _toEnemy.length();
      if (dist < 500 || dist > 1000) continue;
      // 转换到 body frame：z > 0 表示敌机在轰炸机后方（机头=-Z，后方=+Z）
      _localEnemy.copy(_toEnemy).applyQuaternion(_invQ);
      if (_localEnemy.z > 0) { hasRearTarget = true; break; }
    }
    if (!hasRearTarget) {
      this._turretFireReact = 0;
      return false;
    }

    // 开火计时：短连发 + 冷却
    if (this._turretFireCd > 0) this._turretFireCd -= dt;
    if (this._turretFireTimer > 0) {
      this._turretFireTimer -= dt;
      return this._turretFireTimer > 0;
    }
    if (this._turretFireCd <= 0) {
      // 开火
      this._turretFireTimer = 1.5 + Math.random() * 0.5;  // 连发 1.5-2s
      this._turretFireCd = 3.0 + Math.random() * 2.0;     // 冷却 3-5s
      return true;
    }
    return false;
  }

  /** 长机：按航线直飞，到达终点后脱离 */
  _updateLeader(dt) {
    if (this._routeIdx >= this._route.length) {
      this._despawn();
      return;
    }
    const wp = this._route[this._routeIdx];
    _v1.copy(wp).sub(this.root.position);
    const dist = _v1.length();
    if (dist < 250) {
      this._routeIdx++;
      if (this._routeIdx >= this._route.length) {
        this._despawn();
        return;
      }
    }
    // 朝向：slerp 平滑过渡到航点方向（让机头 -Z 朝向航点）
    _v1.normalize();
    _q1.setFromUnitVectors(_FWD, _v1);
    this.root.quaternion.slerp(_q1, Math.min(1, dt * 2.5));
    // 位置：沿当前朝向以巡航速度前进
    this.root.position.addScaledVector(this.getForward(), this._cruiseSpeed * dt);
    // 分兵升高：朝目标高度平滑过渡（lerp，约 3s 到位）
    if (this._targetAlt != null) {
      this.root.position.y += (this._targetAlt - this.root.position.y) * Math.min(1, dt * 0.6);
    }
  }

  /** 僚机：跟随长机保持 V 字编队偏移 + 轻度摇摆/上下浮动（增加真实感） */
  _updateWingman(dt) {
    const leader = this._leader;
    if (!leader || !leader.ready || leader._despawnRequested) {
      this._despawn();
      return;
    }
    // 目标位置 = 长机位置 + 长机朝向 × body frame 偏移
    _v1.copy(this._formationOffset).applyQuaternion(leader.root.quaternion).add(leader.root.position);
    const t = performance.now() * 0.001;

    if (this._isFollowingPlayer) {
      // ---- 跟随玩家（库尔斯克长机）：连续低频正弦浮动，平滑无突变 ----
      // 玩家本身有街机物理波动，长机只需极轻微浮动增加真实感
      // 0.18Hz 低频 + 0.8m 小幅度，连续正弦无触发/结束突变
      _v1.y += Math.sin(t * 1.1 + this._wobblePhase) * 0.8;
      // lerp 更紧（dt*5）：玩家机动快，需紧追避免滞后颠簸
      this.root.position.lerp(_v1, Math.min(1, dt * 5));
      // 朝向：与玩家一致，roll 摇摆幅度更小（±1°）
      _q1.copy(leader.root.quaternion);
      const rollWobble = Math.sin(t * 0.3 * Math.PI * 2 + this._wobblePhase) * 0.018;
      _q1.multiply(new THREE.Quaternion().setFromAxisAngle(_FWD, rollWobble));
      this.root.quaternion.slerp(_q1, Math.min(1, dt * 5));
    } else {
      // ---- 轰炸机僚机（前两关）：脉冲式 wobble（原逻辑不变）----
      this._wobbleTimer -= dt;
      if (this._wobbleTimer <= 0 && !this._wobbleActive) {
        this._wobbleActive = true;
        this._wobbleDur = 1.0 + Math.random();        // 持续 1-2s
        this._wobbleElapsed = 0;
        this._wobbleAmp = 2.0 + Math.random() * 1.5;  // 幅度 2-3.5m
      }
      let wobbleY = 0;
      if (this._wobbleActive) {
        this._wobbleElapsed += dt;
        if (this._wobbleElapsed >= this._wobbleDur) {
          this._wobbleActive = false;
          this._wobbleTimer = 3.0 + Math.random() * 2.0;  // 下次 3-5s 后
        } else {
          // 衰减正弦：开始幅度大，逐渐收敛回基准高度
          const decay = 1.0 - (this._wobbleElapsed / this._wobbleDur);
          wobbleY = Math.sin(this._wobbleElapsed * 7 + this._wobblePhase) * this._wobbleAmp * decay;
        }
      }
      _v1.y += wobbleY;
      // 位置：平滑插值到目标位置（保持队形，不抖动）
      this.root.position.lerp(_v1, Math.min(1, dt * 3));
      // 朝向：与长机一致 + 轻度 roll 摇摆（低频 0.3Hz，幅度 ±2°，自然晃动）
      _q1.copy(leader.root.quaternion);
      const rollWobble = Math.sin(t * 0.3 * Math.PI * 2 + this._wobblePhase) * 0.035; // ±2°
      _q1.multiply(new THREE.Quaternion().setFromAxisAngle(_FWD, rollWobble));
      this.root.quaternion.slerp(_q1, Math.min(1, dt * 3));
    }
  }

  /** 到达终点/长机脱离 → 请求消失（GameRuntime 检测后释放） */
  _despawn() {
    this._despawnRequested = true;
    if (this.model) this.model.visible = false;
  }

  getForward(target = new THREE.Vector3()) {
    return target.set(0, 0, -1).applyQuaternion(this.root.quaternion);
  }

  /** 速度向量（Weapons 子弹发射时叠加飞机速度用）；target 可选输出向量（同 Aircraft 约定） */
  getVelocity(target = new THREE.Vector3()) {
    return this.getForward(target).multiplyScalar(this._cruiseSpeed);
  }

  /** 瞄准方向（退化用机头前向，自卫炮塔有 muzzleDirs 时 Weapons 优先用独立方向） */
  getAimDirection(target = new THREE.Vector3()) {
    return this.getForward(target);
  }
}
