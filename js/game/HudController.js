import * as THREE from 'three';
import { hudTemplate } from './hud-template.js';

// 敌机标记颜色集（战斗机红色 / IL-2 攻击机土黄色）
const _ENEMY_CLR = {
  normal: '#ff5a4d', dim: 'rgba(255,90,77,0.45)',
  shadow: 'rgba(255,90,77,0.6)', shadowDim: 'rgba(255,90,77,0.2)',
};
const _IL2_CLR = {
  normal: '#c8a050', dim: 'rgba(200,160,80,0.45)',
  shadow: 'rgba(200,160,80,0.6)', shadowDim: 'rgba(200,160,80,0.2)',
};

/**
 * HudController：HUD DOM 挂载与每帧刷新。
 *
 * 职责：
 *   - mount(levelName)：注入 HUD 模板，缓存 DOM 引用，返回雷达 canvas 供 Radar 实例使用
 *   - update(snapshot)：每帧刷新读数/油门/HP/G力/警告/准星位置
 *   - updateIndicator(player, enemies, camera)：在 #indicator 上绘制屏幕敌机指示三角
 *   - setWave/setCameraMode：任务监控与视角模式
 *   - unmount()：移除 HUD DOM，清理监听
 *
 * 性能：mount 时缓存所有 DOM 引用，update 只读写 textContent/style，不 querySelector。
 */
export class HudController {
  constructor(shell) {
    this.shell = shell;
    this.el = null;                 // #hud 根容器
    this._radarCanvas = null;       // #radar（供外部 Radar 实例使用）
    this._indicator = null;         // #indicator（全屏敌机指示器）
    this._ictx = null;
    // 缓存 DOM 引用
    this._els = {};
    this._hintOpen = false;
    this._onHintToggle = null;
  }

  /**
   * 挂载 HUD。
   * @param {string} levelName 关卡名（顶栏显示）
   * @returns {HTMLCanvasElement} 雷达 canvas（供 Radar 实例）
   */
  mount(levelName) {
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = hudTemplate(levelName);
    document.body.appendChild(this.el);

    // 缓存引用
    const $ = (s) => this.el.querySelector(s);
    this._els = {
      // 任务面板
      kills: $('[data-ro="kills"]'),
      target: $('[data-ro="target"]'),
      waves: $('[data-ro="waves"]'),
      // HP + 读数
      hpBar: $('.hp-bar > i'),
      hpVal: $('[data-ro="hp"]'),
      speed: $('[data-ro="speed"]'),
      alt: $('[data-ro="alt"]'),
      throttleFill: $('#throttle-bar > i'),
      throttlePct: $('.th-pct'),
      throttleBar: $('#throttle-bar'),
      // 262 专用喷气油门条
      jetThrottle: $('#hud-jet-throttle'),
      jetFill: $('#hud-jet-throttle .jt-fill'),
      jetPct: $('#hud-jet-throttle .jt-pct'),
      jetCooling: $('#hud-jet-throttle .jt-cooling'),
      jetPeakLine: $('#hud-jet-throttle .jt-peak-line'),
      // 拦截进度条（仅 intercept 关卡）
      intercept: $('#hud-intercept'),
      interceptFill: $('#hud-intercept .ic-track > i'),
      interceptPctNum: $('#hud-intercept .ic-pct-num'),
      interceptScore: $('#hud-intercept .ic-score'),
      interceptTarget: $('#hud-intercept .ic-target'),
      // 准星 / 警告
      crosshair: $('#crosshair'),
      stall: $('#hud-stall'),
      crash: $('#hud-crash'),
      altitude: $('#hud-altitude'),
      altFence: $('#hud-alt-fence'),
      tailWarn: $('#hud-tail-warn'),
      // 机炮温度条（竖向，右下角）
      cannonHeat: $('#cannon-heat'),
      cannonFill: $('#cannon-heat .ch-fill'),
      // 按键提示
      hint: $('#controls-hint'),
      hintToggle: $('.ch-toggle'),
      // FPS 帧数显示
      fps: $('#hud-fps'),
    };
    this._fpsLast = 0;
    this._fpsSmooth = 60;
    this._fpsLastText = 0;

    this._radarCanvas = $('#radar');
    this._posReadout = document.getElementById('pos-readout');
    this._indicator = document.getElementById('indicator');
    this._ictx = this._indicator.getContext('2d');
    this._resizeIndicator();

    // 按键提示折叠
    this._onHintToggle = () => {
      this._hintOpen = !this._hintOpen;
      this._els.hint.classList.toggle('open', this._hintOpen);
    };
    this._els.hintToggle.addEventListener('click', this._onHintToggle);

    return this._radarCanvas;
  }

  _resizeIndicator() {
    const dpr = Math.min(devicePixelRatio, 2);
    this._indicator.width = innerWidth * dpr;
    this._indicator.height = innerHeight * dpr;
    this._indicator.style.width = innerWidth + 'px';
    this._indicator.style.height = innerHeight + 'px';
    this._ictx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  onResize() {
    this._resizeIndicator();
  }

  /**
   * 每帧刷新 HUD 读数。
   * @param {object} snap {
   *   speed, alt, throttle, hp, maxHp, gForce, stall, crashed,
   *   crosshair: {x, y, visible}  // 屏幕像素坐标
   * }
   */
  update(snap) {
    const e = this._els;
    // FPS 计算（基于 update 调用频率，指数平滑 + 200ms 节流更新文字）
    if (e.fps) {
      const now = performance.now();
      if (this._fpsLast) {
        const dt = now - this._fpsLast;
        if (dt > 0) this._fpsSmooth = this._fpsSmooth * 0.9 + (1000 / dt) * 0.1;
        if (now - this._fpsLastText > 200) {
          e.fps.textContent = Math.round(this._fpsSmooth);
          this._fpsLastText = now;
        }
      }
      this._fpsLast = now;
    }
    if (e.speed) e.speed.textContent = Math.round(snap.speed);
    if (e.alt) e.alt.textContent = Math.round(snap.alt);
    if (e.throttleFill) e.throttleFill.style.height = (snap.throttle * 100).toFixed(0) + '%';
    if (e.throttlePct) e.throttlePct.textContent = Math.round(snap.throttle * 100);

    // 262 专用喷气油门条（仅 jetThrottle 关卡 snap 携带该字段；此时隐藏通用油门条）
    if (e.jetThrottle) {
      const jt = snap.jetThrottle;
      e.jetThrottle.style.display = jt ? '' : 'none';
      if (e.throttleBar) e.throttleBar.style.display = jt ? 'none' : '';
      if (jt) {
        // 填充高度用 clip-path 裁切（渐变锚定整条轨道：80% 以上进入红区）
        e.jetFill.style.clipPath = `inset(${((1 - jt.throttle) * 100).toFixed(1)}% 0 0 0)`;
        e.jetPct.textContent = Math.round(jt.throttle * 100);
        e.jetPeakLine.style.bottom = (jt.peakLine * 100).toFixed(1) + '%';
        e.jetThrottle.classList.toggle('flash', !!jt.flashing);
        e.jetThrottle.classList.toggle('cooling', !!jt.cooling);
        e.jetCooling.textContent = jt.cooling ? `发动机冷却中 ${jt.cooldownRemain}s` : '';
      }
    }

    // 拦截进度条（仅 intercept 关卡 snap 携带该字段；其他关卡恒隐藏）
    if (e.intercept) {
      const ic = snap.intercept;
      e.intercept.style.display = ic ? '' : 'none';
      if (ic) {
        if (!this._interceptMode) {
          this._interceptMode = true;
          this.el.classList.add('intercept-mode');
        }
        const pct = Math.min(100, Math.round((ic.value / ic.target) * 100));
        e.interceptFill.style.width = pct + '%';
        e.interceptPctNum.textContent = pct;
        e.interceptScore.textContent = ic.value;
        e.interceptTarget.textContent = ic.target;
      }
    }

    // HP 条 + 数字
    if (e.hpBar && snap.maxHp > 0) {
      const pct = Math.max(0, snap.hp / snap.maxHp);
      e.hpBar.style.width = (pct * 100).toFixed(0) + '%';
      e.hpBar.className = pct > 0.6 ? 'hp-high' : pct > 0.3 ? 'hp-mid' : 'hp-low';
    }
    if (e.hpVal) e.hpVal.textContent = Math.max(0, Math.round(snap.hp));

    // 警告
    if (e.stall) e.stall.classList.toggle('show', !!snap.stall && !snap.crashed);
    if (e.crash) e.crash.classList.toggle('show', !!snap.crashed);
    if (e.altitude) e.altitude.classList.toggle('show', !!snap.lowAltitude && !snap.crashed);
    // 交战高度规则警告（仅 combatAlt 关卡 snap 携带 altFence；其他关卡恒 undefined → 永不显示）
    if (e.altFence) {
      const af = snap.altFence;
      e.altFence.classList.toggle('show', !!af);
      if (af) {
        if (e.altFence.textContent !== af.text) e.altFence.textContent = af.text;
        e.altFence.dataset.level = af.level;
      }
    }
    // 被咬尾警告（顶端中央红框，持续咬尾中闪动；无追击者消失；坠毁后不显示）
    if (e.tailWarn) e.tailWarn.classList.toggle('show', !!snap.tailLocked && !snap.crashed);

    // 机炮温度条（竖向渐变：底绿→中橙→顶红，用 scaleY 控制填充比例，动画更平滑）
    if (e.cannonFill && snap.cannonHeat != null) {
      const ratio = Math.max(0, Math.min(1, snap.cannonHeat / 100));
      e.cannonFill.style.transform = 'scaleY(' + ratio.toFixed(3) + ')';
      e.cannonHeat.classList.toggle('overheated', !!snap.cannonOverheated);
    }

    // 准星
    if (e.crosshair && snap.crosshair) {
      const c = snap.crosshair;
      e.crosshair.style.display = c.visible ? '' : 'none';
      if (c.visible) {
        e.crosshair.style.left = c.x + 'px';
        e.crosshair.style.top = c.y + 'px';
      }
    }

    // 当前位置坐标（小地图下方，供参考）
    if (this._posReadout && snap.posX != null) {
      this._posReadout.textContent = 'X ' + Math.round(snap.posX) + ' · Z ' + Math.round(snap.posZ);
    }
  }

  /**
   * 更新任务面板波次信息 + 对号列表。
   * @param {number} current 当前波（1-based）
   * @param {number} total 总波数
   * @param {number} kills 击落数
   * @param {number} target 目标总数
   * @param {string} [state] WaveDirector 状态（'done' 时全部打对号）
   */
  setWave(current, total, kills, target, state) {
    const e = this._els;
    if (e.kills) e.kills.textContent = kills;
    if (e.target) e.target.textContent = target;
    if (e.wave) e.wave.textContent = Math.min(current, total);
    if (e.wavetotal) e.wavetotal.textContent = total;
    // 波次对号列表：✓完成 ◆当前 ○待办
    if (e.waves) {
      const allDone = state === 'done';
      let html = '';
      for (let i = 1; i <= total; i++) {
        let cls, mark;
        if (allDone || i < current) { cls = 'done'; mark = '✓'; }
        else if (i === current) { cls = 'active'; mark = '◆'; }
        else { cls = 'pending'; mark = '○'; }
        html += `<span class="mw ${cls}">${mark}</span>`;
      }
      e.waves.innerHTML = html;
    }
  }

  /** 设置视角模式提示（可选，P2 暂不用） */
  setCameraMode(_mode) {}

  /**
   * 在 #indicator 全屏 canvas 上绘制敌机屏幕指示器（原版 main.js 三角框逻辑）。
   * 前方敌机：三角框 + 距离；前方视锥外：边缘方向箭头；身后：底部朝下箭头。
   * @param {Aircraft} player
   * @param {Array<Enemy>} enemies
   * @param {THREE.Camera} camera
   */
  updateIndicator(player, enemies, camera) {
    const ctx = this._ictx;
    const w = innerWidth, h = innerHeight;
    ctx.clearRect(0, 0, w, h);
    if (!player || !player.model || !enemies || !enemies.length) return;

    camera.getWorldDirection(_camFwd);
    _camRight.crossVectors(_camFwd, _UP_IND).normalize();
    const cx = w / 2, cy = h / 2;

    for (const e of enemies) {
      if (!e.ready || e.crashed) continue;
      // IL-2 攻击机用土黄色标记，且距离 > 12000m 不显示（远距弱化）
      const isIL2 = !!e._il2State;
      const c = isIL2 ? _IL2_CLR : _ENEMY_CLR;
      _toE.copy(e.root.position).sub(camera.position);
      const dist = _toE.length();
      if (dist < 1) continue;
      if (isIL2 && dist > 12000) continue;
      _toE.divideScalar(dist);
      const fwdDot = _toE.dot(_camFwd); // >0 前方, <0 身后

      if (fwdDot > 0) {
        // 前方：project 到屏幕
        _eiProj.copy(e.root.position).project(camera);
        const sx = (_eiProj.x * 0.5 + 0.5) * w;
        const sy = (-_eiProj.y * 0.5 + 0.5) * h;
        // NDC 全屏范围 [-1,+1]，留 5% 余量使三角框略提前于敌机进入屏幕时出现
        const onScreen = _eiProj.z > -1 && _eiProj.z < 1 &&
          _eiProj.x > -1.05 && _eiProj.x < 1.05 && _eiProj.y > -1.05 && _eiProj.y < 1.05;
        if (onScreen) {
          // 距离 > 3000m 颜色变淡（远景识别弱化，减轻视觉干扰）
          const dim = dist > 3000;
          this._drawTriFrame(ctx, sx, sy, 24, dim, c);
          ctx.fillStyle = dim ? c.dim : c.normal;
          ctx.font = 'bold 11px Consolas, monospace';
          ctx.fillText(Math.round(dist) + 'm', sx + 30, sy + 4);
        } else {
          // 前方但视锥外：屏幕边缘箭头
          const dx = sx - cx, dy = sy - cy;
          const margin = 50;
          const halfW = w / 2 - margin, halfH = h / 2 - margin;
          const scale = Math.min(halfW / Math.max(1, Math.abs(dx)), halfH / Math.max(1, Math.abs(dy)));
          const ex = cx + dx * scale, ey = cy + dy * scale;
          const dim = dist > 3000;
          this._drawEdgeArrow(ctx, ex, ey, Math.atan2(dy, dx), dim, c);
          ctx.fillStyle = dim ? c.dim : c.normal;
          ctx.font = 'bold 11px Consolas, monospace';
          ctx.fillText(Math.round(dist) + 'm', ex + 14, ey + 4);
        }
      } else {
        // 身后：屏幕底部箭头朝下，左右按相对相机右向偏移
        const rightDot = _toE.dot(_camRight);
        const ex = cx + THREE.MathUtils.clamp(rightDot * 300, -w * 0.35, w * 0.35);
        const ey = h - 50;
        const dim = dist > 3000;
        this._drawEdgeArrow(ctx, ex, ey, Math.PI / 2, dim, c); // 朝下
        ctx.fillStyle = dim ? c.dim : c.normal;
        ctx.font = 'bold 11px Consolas, monospace';
        ctx.fillText(Math.round(dist) + 'm', ex - 14, ey - 16);
      }
    }
  }

  /**
   * 绘制友军轰炸机长机识别框（淡淡的浅绿色，方便玩家找到编队）。
   * - 距离玩家 < 500m 不显示（近距时无需指示）
   * - 屏内：浅绿三角框；视锥外：浅绿边缘箭头；身后：底部箭头
   * @param {Aircraft} player
   * @param {Array<FriendlyBomber>} bombers 长机列表（通常 1 个）
   * @param {THREE.Camera} camera
   */
  updateBomberIndicator(player, bombers, camera) {
    const ctx = this._ictx;
    if (!ctx || !player || !player.model || !bombers || !bombers.length) return;
    const w = innerWidth, h = innerHeight;
    const cx = w / 2, cy = h / 2;

    for (const b of bombers) {
      if (!b || !b.ready || b._despawnRequested) continue;
      _toE.copy(b.root.position).sub(camera.position);
      const dist = _toE.length();
      if (dist < 1) continue;
      // 距离玩家 < 500m 不显示
      if (dist < 500) continue;
      _toE.divideScalar(dist);
      const fwdDot = _toE.dot(_camFwd);

      if (fwdDot > 0) {
        _eiProj.copy(b.root.position).project(camera);
        const sx = (_eiProj.x * 0.5 + 0.5) * w;
        const sy = (-_eiProj.y * 0.5 + 0.5) * h;
        const onScreen = _eiProj.z > -1 && _eiProj.z < 1 &&
          _eiProj.x > -1.05 && _eiProj.x < 1.05 && _eiProj.y > -1.05 && _eiProj.y < 1.05;
        if (onScreen) {
          this._drawBomberFrame(ctx, sx, sy, 20);
        } else {
          const dx = sx - cx, dy = sy - cy;
          const margin = 50;
          const halfW = w / 2 - margin, halfH = h / 2 - margin;
          const scale = Math.min(halfW / Math.max(1, Math.abs(dx)), halfH / Math.max(1, Math.abs(dy)));
          const ex = cx + dx * scale, ey = cy + dy * scale;
          this._drawBomberArrow(ctx, ex, ey, Math.atan2(dy, dx));
        }
      } else {
        const rightDot = _toE.dot(_camRight);
        const ex = cx + THREE.MathUtils.clamp(rightDot * 300, -w * 0.35, w * 0.35);
        const ey = h - 50;
        this._drawBomberArrow(ctx, ex, ey, Math.PI / 2);
      }
    }
  }

  /** 屏内敌机三角框（dim=true 时颜色变淡，用于距离 > 3000m）*/
  _drawTriFrame(ctx, x, y, size, dim = false, c) {
    c = c || _ENEMY_CLR;
    ctx.strokeStyle = dim ? c.dim : c.normal;
    ctx.lineWidth = dim ? 1.2 : 2;
    ctx.shadowColor = dim ? c.shadowDim : c.shadow;
    ctx.shadowBlur = dim ? 3 : 6;
    ctx.beginPath();
    ctx.moveTo(x, y + size);                       // 下顶点
    ctx.lineTo(x - size * 0.866, y - size * 0.5);  // 左上
    ctx.lineTo(x + size * 0.866, y - size * 0.5);  // 右上
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /** 边缘方向箭头（dim=true 时颜色变淡，用于距离 > 3000m）*/
  _drawEdgeArrow(ctx, x, y, ang, dim = false, c) {
    c = c || _ENEMY_CLR;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = dim ? c.dim : c.normal;
    ctx.shadowColor = dim ? c.shadowDim : c.shadow;
    ctx.shadowBlur = dim ? 3 : 6;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-7, -8);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  /** 友军轰炸机识别框（浅绿色，与敌机红色区分）*/
  _drawBomberFrame(ctx, x, y, size) {
    ctx.strokeStyle = 'rgba(120,255,180,0.65)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(120,255,180,0.4)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(x, y + size);
    ctx.lineTo(x - size * 0.866, y - size * 0.5);
    ctx.lineTo(x + size * 0.866, y - size * 0.5);
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /** 友军轰炸机边缘箭头（浅绿色）*/
  _drawBomberArrow(ctx, x, y, ang) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(120,255,180,0.65)';
    ctx.shadowColor = 'rgba(120,255,180,0.4)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-6, -7);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  /**
   * 绘制玩家僚机（Falke-2）识别标记：淡黄色方形框。
   * 与轰炸机标记的区别：①方形（轰炸机是三角）②淡黄色（轰炸机浅绿）
   * ③入屏消失（onScreen 时不绘制，只在屏外画方形框提示方位），
   *    避免屏内标记干扰瞄准视线。
   * @param {Aircraft} player
   * @param {Array<FriendlyBomber>} wingmen 僚机列表（通常 1 个，即 Falke-2）
   * @param {THREE.Camera} camera
   */
  updateWingmanIndicator(player, wingmen, camera) {
    const ctx = this._ictx;
    if (!ctx || !player || !player.model || !wingmen || !wingmen.length) return;
    const w = innerWidth, h = innerHeight;
    const cx = w / 2, cy = h / 2;
    camera.getWorldDirection(_camFwd);
    _camRight.crossVectors(_camFwd, _UP_IND).normalize();

    for (const wm of wingmen) {
      if (!wm || !wm.ready || wm._despawnRequested) continue;
      _toE.copy(wm.root.position).sub(camera.position);
      const dist = _toE.length();
      if (dist < 1) continue;
      _toE.divideScalar(dist);
      const fwdDot = _toE.dot(_camFwd);

      if (fwdDot > 0) {
        _eiProj.copy(wm.root.position).project(camera);
        const sx = (_eiProj.x * 0.5 + 0.5) * w;
        const sy = (-_eiProj.y * 0.5 + 0.5) * h;
        const onScreen = _eiProj.z > -1 && _eiProj.z < 1 &&
          _eiProj.x > -1.05 && _eiProj.x < 1.05 && _eiProj.y > -1.05 && _eiProj.y < 1.05;
        // 入屏消失：屏内不绘制，只在视锥外画方形框
        if (!onScreen) {
          const dx = sx - cx, dy = sy - cy;
          const margin = 50;
          const halfW = w / 2 - margin, halfH = h / 2 - margin;
          const scale = Math.min(halfW / Math.max(1, Math.abs(dx)), halfH / Math.max(1, Math.abs(dy)));
          const ex = cx + dx * scale, ey = cy + dy * scale;
          this._drawWingmanBox(ctx, ex, ey, Math.atan2(dy, dx));
        }
      } else {
        // 身后：底部方形框
        const rightDot = _toE.dot(_camRight);
        const ex = cx + THREE.MathUtils.clamp(rightDot * 300, -w * 0.35, w * 0.35);
        const ey = h - 50;
        this._drawWingmanBox(ctx, ex, ey, Math.PI / 2);
      }
    }
  }

  /** 僚机方形框（淡黄色，与轰炸机浅绿三角区分；屏外方位指示用）*/
  _drawWingmanBox(ctx, x, y, ang) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.strokeStyle = 'rgba(212,168,90,0.7)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(212,168,90,0.4)';
    ctx.shadowBlur = 4;
    const s = 9; // 半边长，方形 18×18
    ctx.strokeRect(-s, -s, s * 2, s * 2);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  unmount() {
    if (this._els.hintToggle && this._onHintToggle) {
      this._els.hintToggle.removeEventListener('click', this._onHintToggle);
    }
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    // 清空 indicator
    if (this._ictx) this._ictx.clearRect(0, 0, innerWidth, innerHeight);
    this._els = {};
    this._radarCanvas = null;
    this._posReadout = null;
  }
}

// 复用临时向量（避免每帧 new）—— 指示器用（原版 main.js updateIndicator）
const _UP_IND = new THREE.Vector3(0, 1, 0);
const _camFwd = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _toE = new THREE.Vector3();
const _eiProj = new THREE.Vector3();
