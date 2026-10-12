import * as THREE from 'three';

const _UP = new THREE.Vector3(0, 1, 0);
const _RIGHT = new THREE.Vector3(1, 0, 0);

const TRAIL_VERT = `
  attribute float aOpacity;
  attribute float aU;
  varying float vOpacity;
  varying float vU;
  void main() {
    vOpacity = aOpacity;
    vU = aU;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const TRAIL_FRAG = `
  varying float vOpacity;
  varying float vU;
  void main() {
    // 边缘羽化：u=0/1（带边缘）时 edge=0，u=0.5（中心）时 edge=1
    float edge = sin(vU * 3.14159265359);
    // 消散时（vOpacity 低）边缘羽化加强，烟气更柔和收束
    edge = pow(edge, mix(5.0, 8.0, 1.0 - clamp(vOpacity, 0.0, 1.0)));
    gl_FragColor = vec4(1.0, 1.0, 1.0, vOpacity * edge);
  }
`;

/**
 * 翼尖拉烟系统（带状 mesh ribbon）：
 *   高 G 机动时在翼尖生成连续白色带状烟，松杆 0.5s 淡出，烟存留 30s 膨胀到 2.0-3.0 倍。
 *   透明度从生成就线性衰减；边缘强羽化（pow 5.0→8.0）模拟云雾感。
 *   宽度扰动随时间增大（±0.3→±0.9），让烟带越往后越不规则。
 *   随机拉烟：满足触发条件后按 30% 概率决定（敌我相同）。
 * 触发：G ≥ 2.0、速度 ≥ 300km/h、高度 600-4500m、非坠毁。
 */
export class VaporTrail {
  constructor(scene, aircraft, opts = {}) {
    this.scene = scene;
    this.aircraft = aircraft;

    // 触发阈值
    this.gThreshold = 2.0;
    this.minSpeed = 83.3;       // 300 km/h ÷ 3.6
    this.minAlt = opts.minAlt ?? 600;
    this.maxAlt = opts.maxAlt ?? 4500;   // opts 覆盖（柏林高空关 6000-8000m）

    // 消散参数
    this.fadeOutTime = 0.5;     // 松杆后淡出时间
    this.particleLife = 30;     // 截面空中存留时间（秒）
    this.peakOpacity = 0.4;     // 峰值透明度
    this.initialWidth = 0.6;    // 初始带宽（米）

    // 膨胀倍数（每段机动随机 2.0-3.0）
    this.expandTo = 2.5;

    // 状态
    this.active = false;
    this.fadeTimer = 0;

    // 随机拉烟状态机：进入触发条件时随机决定是否拉烟
    this._decided = false;      // 当前机动段是否已决定
    this._willTrail = false;    // 决定结果

    // 截面生成间隔
    this.spawnInterval = 0.04;
    this.spawnTimer = 0;

    // 两条带（左右翼尖）
    this.trails = [this._newTrail(), this._newTrail()];

    // 临时向量
    this._fwd = new THREE.Vector3();
    this._side = new THREE.Vector3();
  }

  _newTrail() {
    const maxSections = 800;
    const maxVerts = maxSections * 2;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
    geometry.setAttribute('aOpacity', new THREE.BufferAttribute(new Float32Array(maxVerts), 1));
    // aU：横向坐标（左顶点 0，右顶点 1），固定不变，一次性初始化
    const uArr = new Float32Array(maxVerts);
    for (let i = 0; i < maxSections; i++) { uArr[i*2] = 0; uArr[i*2+1] = 1; }
    geometry.setAttribute('aU', new THREE.BufferAttribute(uArr, 1));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array((maxSections - 1) * 6), 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.scene.add(mesh);
    return { mesh, geometry, sections: [], maxSections };
  }

  update(dt) {
    const ac = this.aircraft;
    if (!ac || !ac.root) { this._halt(); return; }

    // 坠毁：停止生成，已有截面自然消散
    if (ac.crashed || ac._exploded) {
      this.active = false;
      this.fadeTimer = 0;
      this._decided = false;
      this._willTrail = false;
      this._ageAndRebuild(dt);
      return;
    }

    // 触发判断：G ≥ 2.0、速度 ≥ 300km/h、高度 600-4500m
    const g = ac.gForce || 1;
    const speed = ac.speed || 0;
    const alt = ac.root.position.y;
    const inTrigger = g >= this.gThreshold
      && speed >= this.minSpeed
      && alt >= this.minAlt && alt <= this.maxAlt;

    if (inTrigger) {
      // 进入触发条件：随机决定是否拉烟（每段机动决定一次）
      if (!this._decided) {
        this._decided = true;
        // 敌我双方拉烟概率均为 30%
        this._willTrail = Math.random() < 0.3;
        // 膨胀随机化 2.0-3.0
        this.expandTo = 2.0 + Math.random() * 1.0;
      }
      if (this._willTrail && !this.active) {
        this.active = true;
        this.fadeTimer = 0;
      }
    } else {
      // 退出触发条件：重置随机决定
      this._decided = false;
      this._willTrail = false;
      if (this.active) {
        this.active = false;
        this.fadeTimer = this.fadeOutTime;
      }
    }

    // 生成新截面
    if (this.active || this.fadeTimer > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = this.spawnInterval;
        this._spawnSection();
      }
    }
    if (this.fadeTimer > 0) this.fadeTimer -= dt;

    this._ageAndRebuild(dt);
  }

  _spawnSection() {
    const ac = this.aircraft;
    const tips = ac.getWingTipWorldPositions ? ac.getWingTipWorldPositions() : null;
    if (!tips) return;
    ac.getForward(this._fwd);
    // 宽度方向：垂直于飞行方向，在水平面（forward × up）；近垂直时回退 forward × right
    this._side.crossVectors(this._fwd, _UP);
    if (this._side.lengthSq() < 0.01) this._side.crossVectors(this._fwd, _RIGHT);
    this._side.normalize();

    const fadeOp = this.active ? 1.0 : Math.max(0, this.fadeTimer / this.fadeOutTime);
    for (let i = 0; i < 2; i++) {
      // 宽度随机扰动（0.7-1.3 倍），让带宽不规则有变化
      const widthFactor = 0.7 + Math.random() * 0.6;
      this.trails[i].sections.push({
        pos: tips[i].clone(),
        side: this._side.clone(),
        age: 0,
        fadeOp,
        widthFactor,
      });
    }
  }

  _ageAndRebuild(dt) {
    for (const trail of this.trails) {
      for (const s of trail.sections) s.age += dt;
      // 删除过老截面（从头部批量删，避免逐个 splice）
      if (trail.sections.length && trail.sections[0].age >= this.particleLife) {
        let cut = 0;
        while (cut < trail.sections.length && trail.sections[cut].age >= this.particleLife) cut++;
        trail.sections.splice(0, cut);
      }
      this._rebuildGeometry(trail);
    }
  }

  _rebuildGeometry(trail) {
    const sections = trail.sections;
    if (sections.length < 2) { trail.mesh.visible = false; return; }
    trail.mesh.visible = true;
    const n = Math.min(sections.length, trail.maxSections);
    const posArr = trail.geometry.attributes.position.array;
    const opArr = trail.geometry.attributes.aOpacity.array;
    const idxArr = trail.geometry.index.array;

    for (let i = 0; i < n; i++) {
      const s = sections[i];
      const ageRatio = s.age / this.particleLife;
      // 扰动随时间增加：初始 ±0.3，末期增至 ±0.9
      const widthFactor = 1.0 + (s.widthFactor - 1.0) * (1.0 + ageRatio * 2.0);
      const width = this.initialWidth * widthFactor * (1 + ageRatio * (this.expandTo - 1));
      const halfW = width * 0.5;
      const off = i * 6;
      posArr[off]   = s.pos.x - s.side.x * halfW;
      posArr[off+1] = s.pos.y - s.side.y * halfW;
      posArr[off+2] = s.pos.z - s.side.z * halfW;
      posArr[off+3] = s.pos.x + s.side.x * halfW;
      posArr[off+4] = s.pos.y + s.side.y * halfW;
      posArr[off+5] = s.pos.z + s.side.z * halfW;
      // 线性透明度：从生成就线性衰减
      const op = this.peakOpacity * s.fadeOp * (1 - s.age / this.particleLife);
      opArr[i*2] = op;
      opArr[i*2+1] = op;
    }
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i+1) * 2, d = (i+1) * 2 + 1;
      const ii = i * 6;
      idxArr[ii]   = a; idxArr[ii+1] = c; idxArr[ii+2] = b;
      idxArr[ii+3] = b; idxArr[ii+4] = c; idxArr[ii+5] = d;
    }

    trail.geometry.attributes.position.needsUpdate = true;
    trail.geometry.attributes.aOpacity.needsUpdate = true;
    trail.geometry.index.needsUpdate = true;
    trail.geometry.setDrawRange(0, (n - 1) * 6);
  }

  _halt() { this.active = false; this.fadeTimer = 0; this._decided = false; this._willTrail = false; }

  /** 清空所有截面（重生/关卡结束时调用） */
  dispose() {
    for (const trail of this.trails) {
      trail.sections = [];
      trail.mesh.visible = false;
    }
    this.active = false;
    this.fadeTimer = 0;
    this._decided = false;
    this._willTrail = false;
  }
}
