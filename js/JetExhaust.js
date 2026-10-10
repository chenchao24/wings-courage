import * as THREE from 'three';

/**
 * 喷气尾流特效（仅配置 playerConfig.jetNozzles 的喷气机关卡启用，当前：第4关 Me 262）。
 *
 * 每个尾喷口三层效果，强度随油门（throttle）：
 *   1. 喷口辉光：加色小 sprite，白炽→暗橙，全油门最亮
 *   2. 尾气粒子：sprite 池，白→灰→淡褐随寿命渐变，向后扩散淡出
 *   3. 热浪锥：自定义 shader 长锥（噪声流动 + 顶点摆动），模拟热流扰动空气的观感
 *
 * 关卡隔离：GameRuntime 仅在 jetNozzles 配置存在时创建本模块；前三关无此配置。
 * 纯视觉，无任何 gameplay 影响。
 */
const _CONE_FORWARD = new THREE.Vector3(0, 0, 1); // 热浪锥几何轴向（机尾方向）

export class JetExhaust {
  /**
   * @param {THREE.Scene} scene
   * @param {Aircraft} aircraft 玩家飞机（读 root/throttle/speed/getForward）
   * @param {Array<[number,number,number]>} nozzles 尾喷口 body frame 坐标（机头=-Z，机尾=+Z）
   * @param {object} cfg 可调参数（尺寸/速率/颜色），缺省按 Me 262 调校
   */
  constructor(scene, aircraft, nozzles, cfg = {}) {
    this.scene = scene;
    this.ac = aircraft;
    this.nozzles = nozzles.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
    this.camera = cfg.camera || null;   // 近相机淡出用（追尾相机贴脸粒子不糊屏）

    // 参数
    this.maxParticlesPerNozzle = cfg.maxParticles ?? 220;  // 每喷口粒子池（空间发射铺满航迹）
    this.spacingFull = cfg.spacingFull ?? 0.7;             // 全油门发射节距（米）
    this.spacingIdle = cfg.spacingIdle ?? 2.4;             // 怠速发射节距（米）
    this.exhaustVel = cfg.exhaustVel ?? 40;                // 排气后向缓速（贴航迹，不冲散）
    this.lifeRange = cfg.lifeRange ?? [0.45, 0.85];        // 粒子寿命（秒）
    this.sizeStart = cfg.sizeStart ?? 1.35;                // 出生尺寸（大颗粒+低透明=连续感）
    this.sizeGrow = cfg.sizeGrow ?? 4.0;                   // 膨胀倍数
    this.heatLen = cfg.heatLen ?? 9.0;                     // 热浪锥长度

    // 尾气色谱：白 → 灰 → 淡褐（用户指定）
    this._colHot = new THREE.Color(0xfff8ea);   // 白炽
    this._colMid = new THREE.Color(0x9aa0a4);   // 灰
    this._colEnd = new THREE.Color(0xb8a488);   // 淡褐

    this._tex = this._makePuffTexture();
    this._glowTex = this._makeGlowTexture();

    // 每喷口一组：辉光 sprite + 粒子池 + 热浪锥
    this._units = this.nozzles.map(() => ({
      glow: null,
      cone: null,
      particles: [],   // { sp, vel, life, maxLife, size }
      prevNoz: null,   // 上一帧喷口世界坐标（空间发射线段起点）
      carry: 0,        // 空间发射的跨帧余量（米）
    }));
    this._buildUnits();

    // 复用临时变量
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._c = new THREE.Color();
    this._time = 0;
  }

  _buildUnits() {
    for (const u of this._units) {
      // 喷口辉光（加色，白炽核心）
      const glowMat = new THREE.SpriteMaterial({
        map: this._glowTex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      u.glow = new THREE.Sprite(glowMat);
      u.glow.scale.setScalar(1.4);
      u.glow.renderOrder = 3;
      this.scene.add(u.glow);

      // 热浪锥（自定义 shader：噪声流动 + 顶点摆动）
      const coneGeo = new THREE.ConeGeometry(1.05, this.heatLen, 12, 6, true);
      // ConeGeometry 锥轴 +Y、锥尖在 +Y 端；翻转让锥尖在喷口、喇叭口朝后（+Z）
      coneGeo.rotateX(-Math.PI / 2); // +Y → +Z：锥尖朝 +Z？见下：rotateX(-90°) 使 +Y→+Z
      coneGeo.translate(0, 0, this.heatLen / 2); // 锥底落在喷口处，向 +Z 延伸
      const coneMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },   // 油门强度 0-1
        },
        vertexShader: /* glsl */`
          uniform float uTime, uIntensity;
          varying vec2 vUv;
          varying float vFlick;
          varying vec3 vNormalW;
          varying vec3 vViewW;
          void main() {
            vUv = uv;
            vec3 p = position;
            // 顶点摆动：离喷口越远摆幅越大（热浪摇曳感）
            float t = clamp(position.z / ${this.heatLen.toFixed(2)}, 0.0, 1.0);
            float wob = t * t * 0.55 * (0.4 + 0.6 * uIntensity);
            p.x += sin(uTime * 21.0 + position.z * 2.3) * wob;
            p.y += cos(uTime * 17.0 + position.z * 2.9) * wob;
            vFlick = 0.75 + 0.25 * sin(uTime * 33.0 + position.z * 5.0);
            vec4 wp = modelMatrix * vec4(p, 1.0);
            vNormalW = normalize(mat3(modelMatrix) * normal);
            vViewW = wp.xyz - cameraPosition;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */`
          uniform float uTime, uIntensity;
          varying vec2 vUv;
          varying float vFlick;
          varying vec3 vNormalW;
          varying vec3 vViewW;
          float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vnoise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p);
            float a = hash21(i);
            float b = hash21(i + vec2(1.0, 0.0));
            float c = hash21(i + vec2(0.0, 1.0));
            float d = hash21(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
          }
          void main() {
            // 沿锥长流动的噪声条纹（向后滚动 = 热流）
            vec2 p = vec2(vUv.x * 3.0, vUv.y * 5.0 - uTime * 6.0);
            float n = vnoise(p) * 0.6 + vnoise(p * 2.3) * 0.4;
            // 沿长度大幅羽化（两端完全透明，中段缓慢浮现）
            float len = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
            // 轮廓羽化：视线与法线垂直处（剪影边缘）alpha 归零，消除硬边
            float fresnel = abs(dot(normalize(vNormalW), normalize(vViewW)));
            float soft = smoothstep(0.0, 0.55, fresnel);
            float alpha = n * len * soft * vFlick * 0.30 * uIntensity;
            // 淡暖灰（热流在阳光下略偏暖），近喷口处略亮（热核心）
            vec3 col = mix(vec3(0.82, 0.78, 0.72), vec3(1.0, 0.92, 0.78), (1.0 - vUv.y) * 0.6);
            gl_FragColor = vec4(col, alpha);
          }
        `,
      });
      u.cone = new THREE.Mesh(coneGeo, coneMat);
      u.cone.renderOrder = 2;
      u.cone.frustumCulled = false;
      this.scene.add(u.cone);

      // 粒子池
      for (let i = 0; i < this.maxParticlesPerNozzle; i++) {
        const mat = new THREE.SpriteMaterial({
          map: this._tex, transparent: true, opacity: 0,
          depthWrite: false, fog: true,
        });
        const sp = new THREE.Sprite(mat);
        sp.visible = false;
        sp.renderOrder = 3;
        this.scene.add(sp);
        u.particles.push({ sp, vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 1 });
      }
    }
  }

  /** 每帧推进（GameRuntime._update 调用） */
  update(dt) {
    const ac = this.ac;
    if (!ac || !ac.root) return;
    this._time += dt;
    const throttle = Math.max(0, Math.min(1, ac.throttle || 0));
    const fwd = ac.getForward();          // 机头方向（单位向量）
    const speed = ac.speed || 0;
    const q = ac.root.quaternion;

    for (let i = 0; i < this._units.length; i++) {
      const u = this._units[i];
      // 喷口世界坐标 + 后向（世界系）
      const noz = this._v1.copy(this.nozzles[i]).applyQuaternion(q).add(ac.root.position);
      const back = this._v2.copy(fwd).negate();

      // 1) 辉光：随油门增强，位置贴喷口
      u.glow.position.copy(noz);
      const glowI = 0.18 + throttle * 0.95;
      u.glow.material.opacity = glowI;
      u.glow.scale.setScalar(1.0 + throttle * 1.4);

      // 2) 热浪锥：贴喷口、朝后、随油门显现
      u.cone.position.copy(noz);
      u.cone.quaternion.setFromUnitVectors(_CONE_FORWARD, back);
      u.cone.material.uniforms.uTime.value = this._time;
      u.cone.material.uniforms.uIntensity.value = throttle;

      // 3) 尾气粒子：空间发射——沿本帧喷口位移线段按节距均匀铺粒子。
      //    按时间发射会在高速下按帧成团（240m/s×60fps 每帧 4m 一坨 = 一串圆球），
      //    按空间发射则沿航迹均匀分布，任意速度下都连续。
      const spacing = this.spacingIdle + (this.spacingFull - this.spacingIdle) * throttle;
      if (!u.prevNoz) u.prevNoz = noz.clone();
      const segLen = noz.distanceTo(u.prevNoz);
      if (segLen > 0.01) {
        const total = segLen + u.carry;
        const count = Math.floor(total / spacing);
        for (let k = 1; k <= count; k++) {
          const d = total - k * spacing;              // 距当前位置的反向距离（米）
          const frac = Math.max(0, Math.min(1, 1 - d / segLen));
          // 沿线段插值得到发射点（世界系）
          const px = u.prevNoz.x + (noz.x - u.prevNoz.x) * frac;
          const py = u.prevNoz.y + (noz.y - u.prevNoz.y) * frac;
          const pz = u.prevNoz.z + (noz.z - u.prevNoz.z) * frac;
          this._spawn(u, px, py, pz, back, fwd, speed, throttle);
        }
        u.carry = total - count * spacing;
      }
      u.prevNoz.copy(noz);
      // 推进
      const camPos = this.camera ? this.camera.position : null;
      for (const p of u.particles) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { p.sp.visible = false; p.sp.material.opacity = 0; continue; }
        p.sp.position.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(1 - dt * 0.8);   // 轻度拖拽：逐渐失速落后（先驻留后消散）
        const t = 1 - p.life / p.maxLife;      // 0=出生 → 1=消亡
        const scale = p.size * (1 + t * this.sizeGrow);
        p.sp.scale.setScalar(scale);
        // 颜色：白 → 灰 → 淡褐
        if (t < 0.35) {
          this._c.copy(this._colHot).lerp(this._colMid, t / 0.35);
        } else {
          this._c.copy(this._colMid).lerp(this._colEnd, (t - 0.35) / 0.65);
        }
        p.sp.material.color.copy(this._c);
        // 低单颗粒透明度：空间发射高密度重叠后连续无球感
        let alpha = 0.30 * (1 - t) * (0.35 + 0.65 * throttle);
        // 近相机淡出（贴脸大颗粒是球感来源）：3.5m 内全隐、9m 外全显。
        // 注意范围不能过大——喷口距追尾相机仅 ~6.5m，淡出带太宽会把新生亮段整个吞掉
        if (camPos) {
          const d2 = p.sp.position.distanceToSquared(camPos);
          if (d2 < 81) {
            const d = Math.sqrt(d2);
            alpha *= Math.max(0, Math.min(1, (d - 3.5) / 5.5));
          }
        }
        p.sp.material.opacity = alpha;
      }
    }
  }

  _spawn(u, px, py, pz, back, fwd, speed, throttle) {
    for (const p of u.particles) {
      if (p.life > 0) continue;
      p.maxLife = this.lifeRange[0] + Math.random() * (this.lifeRange[1] - this.lifeRange[0]);
      p.life = p.maxLife;
      p.size = this.sizeStart * (0.8 + Math.random() * 0.5);
      // 出生点 = 航迹线段上的插值点 + 微抖（避免机械感直线）
      p.sp.position.set(
        px + (Math.random() - 0.5) * 0.18,
        py + (Math.random() - 0.5) * 0.18,
        pz + (Math.random() - 0.5) * 0.18,
      );
      // 速度模型（游戏化处理）：出生强跟随飞机（0.85×前速）+ 轻度后喷，
      // 之后世界拖拽逐渐失速 → 相对飞机先慢后快地后移。
      // 若按真实物理（尾气相对世界近静止），240m/s 下尾流几帧内就甩出追尾相机视野，
      // 看不到任何尾流；强跟随让亮段在喷口后驻留 ~0.3s，形成可见的连续喷流。
      p.vel.copy(back).multiplyScalar(this.exhaustVel * (0.55 + 0.45 * throttle));
      p.vel.addScaledVector(fwd, speed * 0.85);
      p.vel.x += (Math.random() - 0.5) * 1.5;
      p.vel.y += (Math.random() - 0.5) * 1.5;
      p.vel.z += (Math.random() - 0.5) * 1.5;
      p.sp.visible = true;
      return;
    }
  }

  _makePuffTexture() {
    // 超软烟团：无中心亮点（避免"一个球一个球"的颗粒感）
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.38)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.13)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  _makeGlowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,250,235,1)');
    grd.addColorStop(0.3, 'rgba(255,220,160,0.75)');
    grd.addColorStop(0.7, 'rgba(255,160,80,0.25)');
    grd.addColorStop(1, 'rgba(255,140,60,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  dispose() {
    for (const u of this._units) {
      if (u.glow) { this.scene.remove(u.glow); u.glow.material.dispose(); }
      if (u.cone) { this.scene.remove(u.cone); u.cone.geometry.dispose(); u.cone.material.dispose(); }
      for (const p of u.particles) { this.scene.remove(p.sp); p.sp.material.dispose(); }
      u.particles.length = 0;
    }
    this._units.length = 0;
    if (this._tex) { this._tex.dispose(); this._tex = null; }
    if (this._glowTex) { this._glowTex.dispose(); this._glowTex = null; }
  }
}
