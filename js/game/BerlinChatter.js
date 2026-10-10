/**
 * BerlinChatter · 第 4 关柏林专属喊话系统（与战役模式全局喊话完全隔离）。
 *
 * 铁原则：仅第 4 关（levelConfig.id === 'berlin'）启用，其他关零影响。
 *   - 复用 DialogSystem（UI 组件，无模式语义）做输出通道
 *   - 事件驱动：由 GameRuntime 在第 4 关事件点调用 onXxx() 触发
 *   - 文案/角色/CD 全独立配置，不读 levelConfig.combatChatter / dialogs
 *
 * 生命周期：构造 → GameRuntime 每帧 update(dt) → dispose。
 *
 * 人物（姓名互换 + 军衔升级，匹配 Me 262 精英部队历史配置）：
 *   - 希尔克（地面引导员，女，德军防空指挥中心通讯兵）→ berlin_tower（随机 tw001/tw02）
 *   - 雨燕 1 号（长机/玩家）海因茨・贝尔格 上尉 → berlin_1
 *   - 雨燕 2 号 卡尔・霍夫曼 中尉 → berlin_2
 *   - 雨燕 3 号 京特・韦勒 中尉 → berlin_3
 *   - 雨燕 4 号 约阿希姆・科赫 少尉 → berlin_4
 */

/** 2/3/4 号飞行员信息（喊话者池，1 号玩家单独处理） */
const PILOTS = {
  2: { name: '霍夫曼', avatar: 'berlin_2', role: '雨燕2号' },
  3: { name: '韦勒',   avatar: 'berlin_3', role: '雨燕3号' },
  4: { name: '科赫',   avatar: 'berlin_4', role: '雨燕4号' },
};
const PLAYER = { name: '贝尔格', avatar: 'berlin_1', role: '雨燕1号' };

/** 各事件缺省 CD（秒）——触发间隔下限，避免刷屏 */
const DEFAULT_CD = {
  lockWarn: 10,       // 被咬尾警告
  b17Kill: 6,         // 击落 B-17 通报
  b17Damaged: 12,     // 击伤 B-17 通报
  p51Kill: 6,         // 击落 P-51 通报
  p51Damaged: 12,     // 击伤 P-51 通报
};

/** 随机报点间隔 / 随机战斗事件间隔 / 基地回复延迟（秒） */
const REPORT_INTERVAL = [35, 55];
const EVENT_INTERVAL = [55, 75];
const REPLY_DELAY = 1.5;

/** 随机战斗事件文案池（{n}=喊话者编号，{clock}=点钟） */
const EVENT_LINES = [
  '击伤轰炸机，{clock}点钟方向！',
  '击伤护航战斗机！',
  '我被咬住了！',
  '{n}号请求支援！',
];

export class BerlinChatter {
  /**
   * @param {{ dialogSystem, config, runtime }} opts
   *   - dialogSystem: DialogSystem 实例（输出通道，可选）
   *   - config: levelConfig.berlinChatter 配置块（cd 覆盖等，缺省=DEFAULT_CD）
   *   - runtime: GameRuntime 实例（读取态势：玩家/僚机/B-17/P-51 位置状态）
   */
  constructor({ dialogSystem, config, runtime }) {
    this.dialogSystem = dialogSystem || null;
    this.runtime = runtime || null;
    this.config = config || {};

    const cdOverride = this.config.cd || {};
    this._cd = {};      // 当前剩余 CD（≤0 可触发）
    this._cdMax = {};   // 各事件 CD 上限
    for (const k in DEFAULT_CD) {
      this._cd[k] = 0;
      this._cdMax[k] = cdOverride[k] != null ? cdOverride[k] : DEFAULT_CD[k];
    }

    // 内部定时器（随机报点 / 随机事件）
    this._reportT = REPORT_INTERVAL[0] + Math.random() * (REPORT_INTERVAL[1] - REPORT_INTERVAL[0]);
    this._eventT = EVENT_INTERVAL[0] + Math.random() * (EVENT_INTERVAL[1] - EVENT_INTERVAL[0]);

    // 延迟回复队列 [{t, fn}]
    this._pending = [];

    this._combatStarted = false;   // 战斗阶段已开始（P-51 拦截或玩家进入 B-17 空域）
    this._once = { playerDead: false };
    this._disposed = false;
  }

  /** 每帧推进 CD / 延迟回复 / 随机喊话定时器。事件触发由 GameRuntime 显式调用 onXxx()。 */
  update(dt) {
    if (this._disposed) return;
    // CD 推进
    for (const k in this._cd) {
      if (this._cd[k] > 0) this._cd[k] -= dt;
    }
    // 延迟回复推进
    for (let i = this._pending.length - 1; i >= 0; i--) {
      this._pending[i].t -= dt;
      if (this._pending[i].t <= 0) {
        const fn = this._pending[i].fn;
        this._pending.splice(i, 1);
        fn();
      }
    }
    // 开场期间不触发随机喊话（避免和开场对话重叠）
    if (this.runtime && this.runtime._cinematicActive && this.runtime.cinematic && this.runtime.cinematic.active) return;
    // 战斗阶段门控：P-51 已触发拦截 或 玩家进入 B-17 空域（≤2000m）才开始随机喊话
    if (!this._combatStarted) {
      if (!this._checkCombatStarted()) return;
      this._combatStarted = true;
    }
    // 随机报点
    this._reportT -= dt;
    if (this._reportT <= 0) {
      this._reportT = REPORT_INTERVAL[0] + Math.random() * (REPORT_INTERVAL[1] - REPORT_INTERVAL[0]);
      this._randomReport();
    }
    // 随机战斗事件
    this._eventT -= dt;
    if (this._eventT <= 0) {
      this._eventT = EVENT_INTERVAL[0] + Math.random() * (EVENT_INTERVAL[1] - EVENT_INTERVAL[0]);
      this._randomEvent();
    }
  }

  // ---------- 内部工具 ----------

  /**
   * 时钟方位（12=正前，3=右翼，6=正后，9=左翼）。
   * @param {THREE.Vector3} targetPos 目标位置
   * @param {THREE.Vector3} playerPos 玩家位置
   * @param {THREE.Vector3} playerFwd 玩家前向（单位）
   */
  _clockDir(targetPos, playerPos, playerFwd) {
    const fx = playerFwd.x, fz = playerFwd.z;
    const rx = -fz, rz = fx;  // 右向 = 前向绕 Y 逆时针 90°（前向 -Z 时右向 +X）
    const dx = targetPos.x - playerPos.x, dz = targetPos.z - playerPos.z;
    const along = dx * fx + dz * fz;   // 前向分量
    const right = dx * rx + dz * rz;   // 右向分量
    const ang = Math.atan2(right, along);
    let hour = Math.round(ang / (Math.PI / 6));  // 12 等分，每份 30°
    if (hour < 0) hour += 12;
    return hour === 0 ? 12 : hour;
  }

  /** 随机选一架活跃敌机（B-17 或 P-51）位置，无则 null */
  _randomHostilePos() {
    const r = this.runtime;
    if (!r) return null;
    const cands = [];
    for (const b of (r.bomberStream || [])) {
      if (b && b.ready && !b.crashed && !b._exploded) cands.push(b.root.position);
    }
    if (r.p51Escort) {
      for (const p of (r.p51Escort.planes || [])) {
        if (p && p.ready && !p.crashed && !p._exploded) cands.push(p.root.position);
      }
    }
    if (!cands.length) return null;
    return cands[Math.floor(Math.random() * cands.length)];
  }

  /** 战斗是否已开始：P-51 已触发拦截 或 玩家进入 B-17 空域（≤2000m） */
  _checkCombatStarted() {
    const r = this.runtime;
    if (!r) return false;
    // P-51 已触发首次拦截
    if (r.p51Escort && r.p51Escort._intercepted) return true;
    // 玩家进入 B-17 空域
    const pp = r.player && r.player.root && r.player.root.position;
    if (!pp) return false;
    return (r.bomberStream || []).some((b) =>
      b && b.ready && !b._exploded && !b._falling && !b._rtb && !b._slowCrash && !b._despawnRequested &&
      b.root.position.distanceToSquared(pp) <= 2000 * 2000
    );
  }

  /** 触发一条喊话（key 给定则带 CD 判定） */
  _emit(key, speaker, text, duration, avatar, role) {
    if (this._disposed || !this.dialogSystem) return;
    if (key && this._cd[key] > 0) return;  // CD 中
    this.dialogSystem.show(speaker, text, duration, avatar, role);
    if (key) this._cd[key] = this._cdMax[key];
  }

  /** 塔台喊话（希尔克，随机头像 berlin_tower） */
  _emitTower(text, duration = 3500) {
    if (this._disposed || !this.dialogSystem) return;
    this.dialogSystem.show('希尔克', text, duration, 'berlin_tower', '塔台');
  }

  /** 延迟回复（t 秒后执行 fn） */
  _delay(t, fn) { this._pending.push({ t, fn }); }

  // ---------- 随机喊话（内部定时器驱动）----------

  /** 随机报点：2/3/4 号汇报敌机方位 "X号，X点钟 注意！" */
  _randomReport() {
    const player = this.runtime && this.runtime.player;
    if (!player || !player.root || player.crashed) return;
    const hostilePos = this._randomHostilePos();
    if (!hostilePos) return;
    const n = 2 + Math.floor(Math.random() * 3);  // 2/3/4
    const p = PILOTS[n];
    const clock = this._clockDir(hostilePos, player.root.position, player.getForward());
    this._emit(null, p.name, `${n}号，${clock}点钟 注意！`, 3500, p.avatar, p.role);
  }

  /** 随机战斗事件：2/3/4 号喊事件池一条（每次只触发一条） */
  _randomEvent() {
    const player = this.runtime && this.runtime.player;
    if (!player || !player.root || player.crashed) return;
    const n = 2 + Math.floor(Math.random() * 3);  // 喊话者
    const p = PILOTS[n];
    let line = EVENT_LINES[Math.floor(Math.random() * EVENT_LINES.length)];
    if (line.includes('{n}')) line = line.replace('{n}', n);
    if (line.includes('{clock}')) {
      const hostilePos = this._randomHostilePos();
      const clock = hostilePos ? this._clockDir(hostilePos, player.root.position, player.getForward()) : 12;
      line = line.replace('{clock}', clock);
    }
    this._emit(null, p.name, line, 3500, p.avatar, p.role);
  }

  // ---------- 事件入口（GameRuntime 显式调用）----------

  /** 玩家被咬尾（enemy: 咬尾敌机，2 号霍夫曼喊 "队长，X点钟，敌机，注意规避！"） */
  onLockedOn(enemy) {
    const player = this.runtime && this.runtime.player;
    if (!player || !player.root || player.crashed) return;
    let clock = 6;  // 默认正后
    if (enemy && enemy.root) {
      clock = this._clockDir(enemy.root.position, player.root.position, player.getForward());
    }
    const p = PILOTS[2];  // 霍夫曼（2 号）
    this._emit('lockWarn', p.name, `队长，${clock}点钟，敌机，注意规避！`, 4000, p.avatar, p.role);
  }

  /** 击落 B-17：1 号喊 + 基地回复 */
  onB17Killed() {
    this._emit('b17Kill', PLAYER.name, '雨燕1号，击落一架轰炸机！', 4000, PLAYER.avatar, PLAYER.role);
    this._delay(REPLY_DELAY, () => this._emitTower('收到，指挥官！干的漂亮！'));
  }

  /** 击伤 B-17：1 号喊 + 基地回复 */
  onB17Damaged() {
    this._emit('b17Damaged', PLAYER.name, '雨燕1号，击伤轰炸机一架！已脱离编队！', 4000, PLAYER.avatar, PLAYER.role);
    this._delay(REPLY_DELAY, () => this._emitTower('收到，指挥官！干的漂亮！'));
  }

  /** 击落 P-51：1 号喊 + 基地回复 */
  onP51Killed() {
    this._emit('p51Kill', PLAYER.name, '雨燕1号，击落一架战斗机！', 4000, PLAYER.avatar, PLAYER.role);
    this._delay(REPLY_DELAY, () => this._emitTower('收到，指挥官！干的漂亮！'));
  }

  /** 击伤 P-51：1 号喊 + 基地回复 */
  onP51Damaged() {
    this._emit('p51Damaged', PLAYER.name, '雨燕1号，击伤战斗机，已脱离战场！', 4000, PLAYER.avatar, PLAYER.role);
    this._delay(REPLY_DELAY, () => this._emitTower('收到，指挥官！干的漂亮！'));
  }

  /** 玩家阵亡：1 号喊跳伞 "雨燕1号，飞机受损，我将跳伞，2号接管指挥权！" */
  onPlayerDead() {
    if (this._once.playerDead) return;
    this._once.playerDead = true;
    this._emit(null, PLAYER.name, '雨燕1号，飞机受损，我将跳伞，2号接管指挥权！', 6000, PLAYER.avatar, PLAYER.role);
  }

  // 保留接口（文案暂无，后续按需填充）
  onAltViolation() {}
  onThrottleOverheat() {}
  onPlayerDamaged() {}

  /** 释放资源 */
  dispose() {
    this._disposed = true;
    this.dialogSystem = null;
    this.runtime = null;
    this._pending = [];
  }
}
