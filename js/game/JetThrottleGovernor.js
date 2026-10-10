/**
 * 喷气机油门管理器（仅配置 playerConfig.jetThrottle 的关卡启用，当前：第4关 Me 262）。
 *
 * Jumo 004 发动机脆弱性的游戏化模型：
 *   - 80% = 最大连续功率（maxContinuous），日常作战上限
 *   - 90% = 峰值功率线（peakLine），超过即进入"峰值计时"
 *   - 持续超过 90% 达 peakLimitSec（10s）→ 自动降频到 80%，并冷却 cooldownSec（30s），
 *     冷却期间油门硬限幅 80%，HUD 提示"发动机冷却中"
 *   - 松开 Shift（throttleUp=false）且油门高于 releaseTarget（50%）时，
 *     按 fallRate 线性回落（1.0→0.5 约 4s）
 *
 * 关卡隔离：GameRuntime 仅在 jetThrottle 配置存在时创建本模块；前三关无此配置。
 */
export class JetThrottleGovernor {
  /**
   * @param {Aircraft} aircraft 玩家飞机（直接读写 throttle）
   * @param {object} cfg { maxContinuous, peakLine, peakLimitSec, cooldownSec, fallRate }
   */
  constructor(aircraft, cfg) {
    this.ac = aircraft;
    this.maxContinuous = cfg.maxContinuous ?? 0.80;
    this.peakLine = cfg.peakLine ?? 0.90;
    this.peakLimitSec = cfg.peakLimitSec ?? 10;
    this.cooldownSec = cfg.cooldownSec ?? 30;
    this.releaseTarget = cfg.releaseTarget ?? 0.50;  // 松开 Shift 后的回落目标（50% 油门）
    this.fallRate = cfg.fallRate ?? 0.125;           // 回落速率（1.0→0.5 = 4s）

    this._peakTimer = 0;   // 连续超过峰值线的累计秒数
    this._cooldown = 0;    // 剩余冷却秒数（>0 = 冷却中）
  }

  /** 每帧调用（GameRuntime._update 内、玩家物理更新之后）。throttleUp = Shift 按下 */
  update(dt, throttleUp) {
    const ac = this.ac;
    if (!ac) return;

    // ── 冷却中：硬限幅 maxContinuous ──
    if (this._cooldown > 0) {
      this._cooldown -= dt;
      if (ac.throttle > this.maxContinuous) ac.throttle = this.maxContinuous;
      if (this._cooldown <= 0) { this._cooldown = 0; this._peakTimer = 0; }
      return;
    }

    // ── 峰值计时：超过峰值线持续累积，达限自动降频 + 进入冷却 ──
    if (ac.throttle > this.peakLine) {
      this._peakTimer += dt;
      if (this._peakTimer >= this.peakLimitSec) {
        ac.throttle = this.maxContinuous;
        this._cooldown = this.cooldownSec;
        this._peakTimer = 0;
        return;
      }
    } else {
      this._peakTimer = 0;
    }

    // ── 松开 Shift：高于 releaseTarget 时线性回落（1.0→0.5 约 4s）──
    if (!throttleUp && ac.throttle > this.releaseTarget) {
      ac.throttle = Math.max(this.releaseTarget, ac.throttle - this.fallRate * dt);
    }
  }

  /** HUD 状态（GameRuntime._updateHud 拼进 snap.jetThrottle） */
  hudState() {
    return {
      throttle: this.ac ? this.ac.throttle : 0,
      maxContinuous: this.maxContinuous,
      peakLine: this.peakLine,
      flashing: this._cooldown === 0 && this.ac && this.ac.throttle > this.peakLine,
      cooling: this._cooldown > 0,
      cooldownRemain: Math.max(0, Math.ceil(this._cooldown)),
    };
  }
}
