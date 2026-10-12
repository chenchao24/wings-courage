import * as THREE from 'three';

// 玩家前向 scratch（update 内即用即弃，不存储引用）
const _fwdR = new THREE.Vector3();

/**
 * 雷达 HUD：右下角圆形雷达，玩家居中、机头朝上。
 *
 * 坐标系约定：
 *   - 雷达上方 = 玩机机头前方（前向在屏幕上方）
 *   - 把世界坐标的目标转到“以玩家为中心、前向朝上”的雷达坐标：
 *       1) 减去玩家位置得到相对向量
 *       2) 旋转使玩家前向对齐 +Y（屏幕上方）
 *   - 距离按 range 映射到雷达半径；超出 range 的目标夹到边缘并显示指示三角
 *
 * 数据源通过注入的 getter 函数获取，保持与场景模块解耦。
 */
export class Radar {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.range = opts.range || 1500;        // 雷达探测半径（世界单位）
    this.ac = opts.aircraft;                // Aircraft 实例
    this.getEnemies = opts.getEnemies || (() => []); // 返回敌机位置数组

    // 高分辨率适配
    this._resize();
    this._onResize = () => this._resize();
    addEventListener('resize', this._onResize);

    this.visible = true;
  }

  /** 释放内部监听（GameRuntime.stop 时调用）*/
  dispose() {
    removeEventListener('resize', this._onResize);
  }

  _resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    const size = 170; // CSS 像素直径
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssSize = size;
    this.r = size / 2;
  }

  setVisible(v) { this.visible = v; this.canvas.style.display = v ? '' : 'none'; }

  /** 前向方位角（atan2(x,z)），用于把世界目标旋到雷达“朝上”坐标 */
  _forwardAngle(fwd) {
    return Math.atan2(fwd.x, fwd.z);
  }

  /** 扫描线渐变（按半径缓存，与底色渐变同理避免每帧 createLinearGradient） */
  _getSweepGrad(r) {
    if (!this._sweepGrad || this._sweepGradR !== r) {
      const sg = this.ctx.createLinearGradient(0, 0, 0, -r);
      sg.addColorStop(0, 'rgba(111,208,255,0.32)');
      sg.addColorStop(1, 'rgba(111,208,255,0)');
      this._sweepGrad = sg;
      this._sweepGradR = r;
    }
    return this._sweepGrad;
  }

  update() {
    if (!this.visible) return;
    const ctx = this.ctx;
    const r = this.r;
    const cx = r, cy = r;
    ctx.clearRect(0, 0, this.cssSize, this.cssSize);

    // ---------- 背景 ----------
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.clip();
    // 底色渐变（按半径缓存，仅 resize 后 r 变化才重建；渐变对象随 ctx 长期有效）
    if (!this._bgGrad || this._bgGradR !== r) {
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      bg.addColorStop(0, 'rgba(10,30,28,0.82)');
      bg.addColorStop(1, 'rgba(6,16,18,0.82)');
      this._bgGrad = bg;
      this._bgGradR = r;
    }
    ctx.fillStyle = this._bgGrad;
    ctx.fillRect(0, 0, this.cssSize, this.cssSize);

    // ---------- 网格：距离圈 + 十字线 ----------
    ctx.strokeStyle = 'rgba(111,208,255,0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (r * i) / 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, this.cssSize);
    ctx.moveTo(0, cy); ctx.lineTo(this.cssSize, cy);
    ctx.stroke();

    // 扫描线（缓慢旋转的亮扇，营造雷达感）
    const t = performance.now() / 1000;
    const sweep = (t * 1.1) % (Math.PI * 2); // 0..2π，0 = 屏幕上方
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sweep);
    const sg = this._getSweepGrad(r);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r - 1, -Math.PI / 2 - 0.5, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // ---------- 玩家与前向 ----------
    if (!this.ac || !this.ac.model) { ctx.restore(); return; }
    const acp = this.ac.root.position;
    const fwd = this.ac.getForward(_fwdR);
    const fa = this._forwardAngle(fwd);

    // 玩家朝向三角（中心，指向上方=机头前）
    ctx.fillStyle = '#6fd0ff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx - 4, cy + 4);
    ctx.lineTo(cx + 4, cy + 4);
    ctx.closePath();
    ctx.fill();

    // ---------- 敌机（红色实心点 + 光环；IL-2 攻击机用土黄色）----------
    const enemies = this.getEnemies() || [];
    for (const ep of enemies) {
      // 兼容两种返回：纯 Vector3（旧）或 {pos, il2}（新）
      const pos = ep.pos || ep;
      const color = ep.il2 ? '#c8a050' : '#ff5a4d';
      this._drawContact(ctx, cx, cy, r, acp, fa, pos, color, 4.2, true);
    }

    ctx.restore();

    // ---------- 外框 ----------
    ctx.strokeStyle = 'rgba(111,208,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * 在雷达上画一个接触点。
   * 世界->雷达：相对向量旋转 -fa，使前向对齐 +Y（屏幕上）。
   * 超出 range 的夹到边缘并画指示三角。
   */
  _drawContact(ctx, cx, cy, r, acp, fa, worldPos, color, size, isTarget) {
    let dx = worldPos.x - acp.x;
    let dz = worldPos.z - acp.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1) return;

    // 把目标相对向量旋到“前向对齐 +Z(屏幕上方)”坐标系。
    // fa = atan2(fwd.x, fwd.z) 是前向从 +Z 轴量的方位角；
    // 旋转 -fa 后前向 (sin fa, cos fa) -> (0, 1)，即 rz>0 对应前方。
    // 正确变换：rx = dx·cos fa - dz·sin fa ; rz = dz·cos fa + dx·sin fa
    const c = Math.cos(fa), s = Math.sin(fa);
    const rx = dx * c - dz * s;
    const rz = dz * c + dx * s;

    const overRange = dist > this.range;
    // 范围内按距离比例，范围外夹到边缘
    const scale = overRange ? (r - 10) / dist : (r - 10) / this.range;
    const px = cx + rx * scale;
    const py = cy - rz * scale; // 屏幕上方 = 前向

    if (overRange) {
      // 边缘指示三角（朝向目标方向）
      const ang = Math.atan2(py - cy, px - cx);
      ctx.fillStyle = color;
      ctx.save();
      ctx.translate(cx + Math.cos(ang) * (r - 8), cy + Math.sin(ang) * (r - 8));
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-3, -3.5);
      ctx.lineTo(-3, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = color;
      if (isTarget) {
        // 目标：实心圆 + 轻微光晕
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(px, py, size + 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        // 障碍物：小方块
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }
    }
  }
}
