import * as THREE from 'three';

/**
 * 僚机 Me 262 简化喷气尾流（仅第4关 Wingman262Squadron 使用）。
 *
 * 玩家版 JetExhaust 的简化：只保留"尾气粒子"一层——
 *   无喷口辉光、无热浪锥（无热抖动），纯软粒子喷流，寿命加长 → 可见喷流更长。
 *
 * 性能：一架飞机左右喷口共用 1 个 THREE.Points（世界坐标直写），
 *   每架仅 1 次 draw call（3 架共 3 次）；粒子数对 draw call 无影响。
 *
 * 发射采用空间节距（沿每帧喷口位移线段均匀铺点），高速下不按帧成团；
 * 速度模型沿用玩家版的游戏化强跟随（born 0.82×前速 + 轻度后喷 + 世界拖拽失速），
 * 喷流在机尾后方驻留延伸，而不是瞬间被甩出视野。
 */

const _noz = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _back = new THREE.Vector3();

export class WingmanJetTrail {
  /**
   * @param {THREE.Scene} scene
   * @param {Wingman262} aircraft 僚机（读 root/_vel；运动学无油门，强度固定）
   * @param {Array<THREE.Vector3|[number,number,number]>} nozzles 尾喷口 body frame 坐标
   * @param {object} cfg 可调参数（缺省按"比玩家更长"的观感调校）
   */
  constructor(scene, aircraft, nozzles, cfg = {}) {
    this.scene = scene;
    this.ac = aircraft;
    this.camera = cfg.camera || null;      // 近相机淡出 + 点尺寸换算
    this.renderer = cfg.renderer || null;  // 读画布高度换算点尺寸（缺省按 900px）
    this.nozzles = nozzles.map((v) => (v.clone ? v.clone() : new THREE.Vector3(v[0], v[1], v[2])));

    // 参数（对照玩家 JetExhaust：life 0.45-0.85s 短喷流 → 僚机 2.0-3.2s 长喷流）
    this.spacing = cfg.spacing ?? 2.0;          // 空间发射节距（m）
    this.followVel = cfg.followVel ?? 0.82;     // 出生跟随前速比例
    this.exhaustVel = cfg.exhaustVel ?? 26;     // 后喷缓速
    this.lifeRange = cfg.lifeRange ?? [2.0, 3.2];
    this.sizeStart = cfg.sizeStart ?? 1.15;     // 出生尺寸（m，世界尺寸）
    this.sizeGrow = cfg.sizeGrow ?? 3.4;        // 膨胀倍数
    this.opacity = cfg.opacity ?? 0.30;         // 单点不透明度（高密度重叠后连续）
    this.intensity = cfg.intensity ?? 0.9;      // 固定喷气强度（僚机无油门）
    this.maxPerNozzle = cfg.maxParticles ?? 230;

    const perN = this.maxPerNozzle;
    const N = perN * this.nozzles.length;
    this._perN = perN;
    this._N = N;
    this._cursor = this.nozzles.map(() => 0);   // 每喷口环形游标
    this._emit = this.nozzles.map(() => ({ prev: new THREE.Vector3(), has: false, carry: 0 }));

    // CPU 侧粒子数据
    this._life = new Float32Array(N);       // 剩余寿命（<=0 死）
    this._maxLife = new Float32Array(N);
    this._vel = new Float32Array(N * 3);
    this._size0 = new Float32Array(N);

    const g = new THREE.BufferGeometry();
    this._aPos = new Float32Array(N * 3);
    this._aSize = new Float32Array(N);
    this._aAlpha = new Float32Array(N);
    this._aTint = new Float32Array(N);
    for (let i = 0; i < N; i++) this._aPos[i * 3 + 1] = -100000;   // 死粒子藏到远处
    g.setAttribute('position', new THREE.BufferAttribute(this._aPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this._aSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this._aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTint', new THREE.BufferAttribute(this._aTint, 1).setUsage(THREE.DynamicDrawUsage));

    this._mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      uniforms: {
        uScale: { value: 780 },   // 画布高 × proj[1][1] / 2（update 内按相机刷新）
      },
      vertexShader: /* glsl */`
        attribute float aSize;
        attribute float aAlpha;
        attribute float aTint;
        uniform float uScale;
        varying float vAlpha;
        varying float vTint;
        void main() {
          vTint = aTint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float dist = max(0.1, -mv.z);
          gl_PointSize = min(aSize * uScale / dist, 96.0);
          // 近相机淡出（贴脸大颗粒是糊屏来源）
          vAlpha = aAlpha * smoothstep(5.0, 20.0, dist);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        varying float vAlpha;
        varying float vTint;
        void main() {
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float d2 = dot(uv, uv);
          if (d2 > 1.0) discard;
          float a = (1.0 - d2) * (1.0 - d2) * vAlpha;   // 平方软边圆斑
          if (a < 0.004) discard;
          // 白炽 → 中性灰（微偏暖收尾，对齐玩家版色谱）
          vec3 col = mix(vec3(0.96, 0.94, 0.88), vec3(0.56, 0.55, 0.52), vTint);
          gl_FragColor = vec4(col, a);
        }
      `,
    });

    this.points = new THREE.Points(g, this._mat);
    this.points.frustumCulled = false;   // 世界坐标直写，包围盒无意义
    this.points.renderOrder = 3;         // 云 renderOrder=1 之上（同玩家尾流约定）
    scene.add(this.points);
  }

  /** 每帧推进（Wingman262.updateAll 调用） */
  update(dt) {
    const ac = this.ac;
    if (!ac || !ac.root) return;
    const q = ac.root.quaternion;
    const pos = ac.root.position;
    _fwd.set(0, 0, -1).applyQuaternion(q);
    _back.copy(_fwd).negate();
    // 僚机速度（运动学自管 _vel；兜底 speed×fwd）
    const speed = ac._vel ? ac._vel.length() : (ac.speed || 0);
    const I = this.intensity;

    // 点尺寸换算系数：uScale = 画布高(px) × projectionMatrix[1][1] / 2
    if (this.camera) {
      const h = this.renderer ? this.renderer.domElement.height : 900;
      this._mat.uniforms.uScale.value = h * this.camera.projectionMatrix.elements[5] * 0.5;
    }

    // 1) 空间发射：沿每帧喷口位移线段按节距铺点
    for (let i = 0; i < this.nozzles.length; i++) {
      _noz.copy(this.nozzles[i]).applyQuaternion(q).add(pos);
      const e = this._emit[i];
      if (!e.has) { e.prev.copy(_noz); e.has = true; continue; }
      const segLen = _noz.distanceTo(e.prev);
      if (segLen > 0.01) {
        const total = segLen + e.carry;
        const count = Math.floor(total / this.spacing);
        for (let k = 1; k <= count; k++) {
          const d = total - k * this.spacing;
          const frac = Math.max(0, Math.min(1, 1 - d / segLen));
          this._spawn(
            i,
            e.prev.x + (_noz.x - e.prev.x) * frac,
            e.prev.y + (_noz.y - e.prev.y) * frac,
            e.prev.z + (_noz.z - e.prev.z) * frac,
            speed,
          );
        }
        e.carry = total - count * this.spacing;
      }
      e.prev.copy(_noz);
    }

    // 2) 推进粒子
    const drag = 1 - dt * 0.7;
    for (let i = 0; i < this._N; i++) {
      if (this._life[i] <= 0) continue;
      this._life[i] -= dt;
      const i3 = i * 3;
      if (this._life[i] <= 0) {
        this._aAlpha[i] = 0;
        this._aPos[i3 + 1] = -100000;
        continue;
      }
      this._vel[i3] *= drag; this._vel[i3 + 1] *= drag; this._vel[i3 + 2] *= drag;
      this._aPos[i3] += this._vel[i3] * dt;
      this._aPos[i3 + 1] += this._vel[i3 + 1] * dt;
      this._aPos[i3 + 2] += this._vel[i3 + 2] * dt;
      const t = 1 - this._life[i] / this._maxLife[i];   // 0=出生 → 1=消亡
      this._aSize[i] = this._size0[i] * (1 + t * this.sizeGrow);
      this._aAlpha[i] = this.opacity * (1 - t) * (0.45 + 0.55 * I);
      this._aTint[i] = t * 0.85;
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
    this.points.geometry.attributes.aTint.needsUpdate = true;
  }

  _spawn(nozzleIdx, px, py, pz, speed) {
    const base = nozzleIdx * this._perN;
    const cur = this._cursor[nozzleIdx];
    const i = base + cur;
    this._cursor[nozzleIdx] = (cur + 1) % this._perN;
    const lr = this.lifeRange;
    this._maxLife[i] = lr[0] + Math.random() * (lr[1] - lr[0]);
    this._life[i] = this._maxLife[i];
    this._size0[i] = this.sizeStart * (0.85 + Math.random() * 0.4);
    const i3 = i * 3;
    // 出生点微抖（避免机械感直线）
    this._aPos[i3] = px + (Math.random() - 0.5) * 0.16;
    this._aPos[i3 + 1] = py + (Math.random() - 0.5) * 0.16;
    this._aPos[i3 + 2] = pz + (Math.random() - 0.5) * 0.16;
    // 速度 = 强跟随前速 + 轻度后喷 + 微散
    const bk = this.exhaustVel * (0.55 + 0.45 * this.intensity);
    this._vel[i3] = _back.x * bk + _fwd.x * speed * this.followVel + (Math.random() - 0.5) * 1.2;
    this._vel[i3 + 1] = _back.y * bk + _fwd.y * speed * this.followVel + (Math.random() - 0.5) * 1.2;
    this._vel[i3 + 2] = _back.z * bk + _fwd.z * speed * this.followVel + (Math.random() - 0.5) * 1.2;
    this._aAlpha[i] = 0.001;   // 首帧淡入
    this._aTint[i] = 0;
    this._aSize[i] = this._size0[i];
  }

  dispose() {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this._mat.dispose();
      this.points = null;
    }
  }
}
