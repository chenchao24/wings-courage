import * as THREE from 'three';

/**
 * 交战高度规则（仅配置了 levelConfig.combatAlt 的关卡启用，当前：第4关柏林）。
 *
 * 状态机（每帧 update 驱动）：
 *   正常 → 低于 warnAlt：HUD 软警告
 *        → 低于 floorAlt：15s 倒计时（HUD 醒目提示"请返回作战高度，您的任务将失败"）
 *        → 倒计时归零：CHOICE 弹窗（冻结模拟）二选一
 *             · 任务失败 → 走阵亡结算路径（自定义文案"任务失败"）
 *             · 重置高度 → 黑屏读条遮罩 → 原地（x/z 不变）重置到 resetAlt，姿态拉平
 *        → 高于 ceilingSoft：HUD 软提示（不惩罚）
 * 任一时刻回到安全高度，倒计时自动复位。
 *
 * 关卡隔离：GameRuntime 仅在 levelConfig.combatAlt 存在时创建本模块；
 * 前三关无此配置，update/hudState 永不执行。
 */
export class CombatAltRule {
  /**
   * @param {object} runtime GameRuntime 引用（读 player、冻结/恢复主循环、触发失败结算）
   * @param {object} cfg { warnAlt, floorAlt, countdownSec, resetAlt, ceilingSoft }
   */
  constructor(runtime, cfg) {
    this.rt = runtime;
    this.warnAlt = cfg.warnAlt ?? 2200;
    this.floorAlt = cfg.floorAlt ?? 2000;
    this.countdownSec = cfg.countdownSec ?? 15;
    this.resetAlt = cfg.resetAlt ?? 4000;
    this.ceilingSoft = cfg.ceilingSoft ?? 7000;

    this._remain = this.countdownSec;  // 倒计时剩余秒数
    this._busy = false;                // 弹窗/重置遮罩流程中（主循环已冻结）
    this._choiceEl = null;
    this._maskEl = null;
  }

  /** 每帧调用（GameRuntime._update 内、_updateHud 之前）。 */
  update(dt) {
    if (this._busy) return;
    const player = this.rt.player;
    if (!player || !player.root) return;
    if (player.crashed) { this._remain = this.countdownSec; return; }

    const alt = player.root.position.y; // 柏林纯平地面（getHeight=0），海拔=AGL
    if (alt < this.floorAlt) {
      this._remain -= dt;
      if (this._remain <= 0) this._showChoice();
    } else {
      this._remain = this.countdownSec; // 回到安全高度即复位
    }
  }

  /** HUD 状态（null=不显示警告）。GameRuntime._updateHud 拼进 snap.altFence。 */
  hudState() {
    if (this._busy) return null;
    const player = this.rt.player;
    if (!player || !player.root || player.crashed) return null;
    const alt = player.root.position.y;
    if (alt < this.floorAlt) {
      return { level: 'countdown', text: `请返回作战高度，您的任务将失败 ${Math.max(0, Math.ceil(this._remain))}` };
    }
    if (alt < this.warnAlt) {
      return { level: 'warn', text: '接近作战高度下限 · 请拉起' };
    }
    if (alt > this.ceilingSoft) {
      return { level: 'ceiling', text: '高度过高，发动机功率将受限' };
    }
    return null;
  }

  // ---------- CHOICE 弹窗 ----------
  _showChoice() {
    this._busy = true;
    this.rt._running = false; // 冻结模拟（同阵亡/胜利路径，rAF 继续但 _update 停摆）

    const el = document.createElement('div');
    el.id = 'alt-choice-overlay';
    el.innerHTML = `
      <div class="ac-mask"></div>
      <div class="ac-card">
        <div class="ac-stamp">ALTITUDE VIOLATION</div>
        <div class="ac-title">你已脱离作战空域</div>
        <div class="ac-text">高度低于 ${this.floorAlt}m 超过 ${this.countdownSec} 秒。选择任务失败，或重置回作战高度继续任务。</div>
        <div class="ac-actions">
          <button class="bronze-button" data-a="fail">任务失败</button>
          <button class="bronze-button primary" data-a="reset">重置高度</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    this._choiceEl = el;

    el.querySelector('[data-a="fail"]').addEventListener('click', () => {
      this._removeChoice();
      // 走阵亡结算路径，reason='altFence' → AppShell 结算页显示"任务失败"
      this.rt._onPlayerDead('altFence');
    });
    el.querySelector('[data-a="reset"]').addEventListener('click', () => {
      this._removeChoice();
      this._doReset();
    });
  }

  _removeChoice() {
    if (this._choiceEl) { this._choiceEl.remove(); this._choiceEl = null; }
  }

  // ---------- 重置高度（黑屏读条遮罩，仿 CinematicSystem.skip 的 #loader 模式） ----------
  _doReset() {
    const el = document.createElement('div');
    el.id = 'alt-reset-mask';
    el.innerHTML = `
      <div class="title">重置高度</div>
      <div class="sub">RESETTING ALTITUDE</div>
      <div class="bar"><i></i></div>
      <div class="pct">0%</div>
    `;
    document.body.appendChild(el);
    this._maskEl = el;

    const fill = el.querySelector('.bar > i');
    const pct = el.querySelector('.pct');
    const t0 = performance.now();
    const DUR = 1200; // 读条时长（与跳过剧情一致）
    const tick = (now) => {
      if (!this._maskEl) return; // 已被 dispose（关卡退出）
      const p = Math.min(1, (now - t0) / DUR);
      fill.style.width = (p * 100).toFixed(0) + '%';
      pct.textContent = Math.round(p * 100) + '%';
      if (p < 1) { requestAnimationFrame(tick); return; }
      this._applyReset();
      el.classList.add('hide');
      setTimeout(() => { el.remove(); if (this._maskEl === el) this._maskEl = null; }, 600);
      this._remain = this.countdownSec;
      this._busy = false;
      this.rt._running = true; // 恢复模拟
    };
    requestAnimationFrame(tick);
  }

  /** 原地重置：x/z 不变，高度到 resetAlt，姿态拉平（保留当前航向），角速度清零 */
  _applyReset() {
    const player = this.rt.player;
    if (!player || !player.root) return;
    player.root.position.y = this.resetAlt;
    // 姿态拉平：从当前前向提取航向 yaw，重建仅含 yaw 的四元数（俯仰/滚转归零）
    const fwd = player.getForward();
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    player.root.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    if (player.angVel) player.angVel.set(0, 0, 0);
  }

  /** 关卡退出时清理残留 DOM（GameRuntime.stop 调用） */
  dispose() {
    this._removeChoice();
    if (this._maskEl) { this._maskEl.remove(); this._maskEl = null; }
    this._busy = false;
  }
}
