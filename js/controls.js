/**
 * 键盘输入管理：持续按键状态查询 + 街机式响应曲线。
 *
 * 响应曲线设计：
 *   - 按键时长 0..ramp 秒内，舵量从 0 线性爬升到目标值（起步斜坡，避免瞬时满舵抽搐）
 *   - 叠加可调灵敏度（灵敏度直接乘到目标舵量上）
 *   - 松杆立即归零（街机要灵敏，不留长尾）
 *   - 接口 flightInput() 仍返回归一化 -1..1，调用方无感
 */
export class Controls {
  constructor() {
    this.keys = Object.create(null);
    /** 每个方向轴的累计按下时长（秒），松开清零 */
    this.hold = { pitchUp: 0, pitchDown: 0, rollLeft: 0, rollRight: 0, yawLeft: 0, yawRight: 0 };

    // 灵敏度（直接乘到目标舵量），可被外部 setSensitivity 覆盖
    this.sens = { pitch: 0.40, roll: 0.35, yaw: 0.45 };
    // 起步斜坡时长（秒），到点后即满偏
    this.ramp = 0.08;

    this._onDown = (e) => {
      this.keys[e.code] = true;
      this._prevent(e);
    };
    this._onUp = (e) => {
      this.keys[e.code] = false;
      this._prevent(e);
    };
    this._onBlur = () => {
      this.keys = Object.create(null);
      this.hold = { pitchUp: 0, pitchDown: 0, rollLeft: 0, rollRight: 0, yawLeft: 0, yawRight: 0 };
    };
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
  }

  _prevent(e) {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  }

  down(code) {
    return !!this.keys[code];
  }

  /** 设置三轴灵敏度（0..1+） */
  setSensitivity(pitch, roll, yaw) {
    if (pitch != null) this.sens.pitch = pitch;
    if (roll != null) this.sens.roll = roll;
    if (yaw != null) this.sens.yaw = yaw;
  }

  /** 由主循环驱动累计按下时长；dt 由外部传入 */
  tick(dt) {
    const k = this.keys;
    const r = Math.min(1, dt / Math.max(1e-4, this.ramp)); // 单帧步进
    const accum = (cur, pressed) => pressed ? Math.min(1, cur + r) : 0;
    this.hold.pitchUp   = accum(this.hold.pitchUp,   k['KeyW'] || k['ArrowUp']);
    this.hold.pitchDown = accum(this.hold.pitchDown, k['KeyS'] || k['ArrowDown']);
    this.hold.rollLeft  = accum(this.hold.rollLeft,  k['KeyA'] || k['ArrowLeft']);
    this.hold.rollRight = accum(this.hold.rollRight, k['KeyD'] || k['ArrowRight']);
    this.hold.yawLeft   = accum(this.hold.yawLeft,   k['KeyQ']);
    this.hold.yawRight  = accum(this.hold.yawRight,  k['KeyE']);
  }

  /** 读取飞行输入快照（带响应曲线） */
  flightInput() {
    const k = this.keys;
    const h = this.hold;

    // 目标舵量 = hold 斜坡值 * 灵敏度，松杆为 0
    const pu = h.pitchUp   * this.sens.pitch;   // W = 推杆低头
    const pd = h.pitchDown * this.sens.pitch;   // S = 拉杆抬头
    const rl = h.rollLeft  * this.sens.roll;
    const rr = h.rollRight * this.sens.roll;
    const yl = h.yawLeft   * this.sens.yaw;
    const yr = h.yawRight  * this.sens.yaw;

    return {
      pitch: pd - pu, // 真实操纵：W=推杆低头(俯冲+)，S=拉杆抬头(拉升-)
      roll:  rl - rr, // A = 左滚(+), D = 右滚(-)
      yaw:   yl - yr, // Q = 左偏(+), E = 右偏(-)
      throttleUp: k['ShiftLeft'] || k['ShiftRight'],
      throttleDown: k['ControlLeft'] || k['ControlRight'],
      fire: k['Space'],          // 空格：全部武器齐射
      fireMg: k['KeyZ'],         // Z：只用机枪（非爆炸武器）
      fireCannon: k['KeyX'],     // X：只用机炮（爆炸武器）
    };
  }

  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
  }
}
