import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ---------- 螺旋桨关键词（与 aircraft.js 同步）----------
const PROP_KEYWORDS = ['prop', '螺旋桨', 'airscrew', 'propeller', 'vint', 'винт'];
function isPropName(name) {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return PROP_KEYWORDS.some((k) => n.includes(k));
}

// ---------- 模型配置（与 enemy.js MODEL_CONFIGS 同步，供调试预填）----------
const MODEL_CONFIGS = {
  // Heinkel He 111 H-2（德国主力轰炸机）
  // 真实翼展 22.6m，userScale = 3.6 × 22.6 / 9.92 = 8.20
  // 朝向由 tune_enemy.html 调出：yawOffset=-51.0, autoOrient=false
  // centerOffset=[2.55,0,0.50]：几何中心微调
  // 4 自卫炮塔：1 前枪 + 3 炮塔（背/腹/侧后），含独立发射方向 muzzleDirs
  '/model/he111.glb': {
    autoOrient: false,
    yawOffset: -51.0, pitchOffset: 0.0, rollOffset: 0.0,
    userScale: 8.20,
    centerOffset: [2.55, 0.00, 0.50],
    muzzleOffsets: [
      new THREE.Vector3(-0.05, -1.90, -19.25),  // 前枪(机头固定)
      new THREE.Vector3(-0.30,  5.50,  4.65),   // 背炮塔(后上)
      new THREE.Vector3( 0.05, -4.60, 12.70),   // 腹炮塔(后下)
      new THREE.Vector3( 4.10,  1.05,  8.90),   // 侧后枪(右后)
    ],
    muzzleDirs: [
      new THREE.Vector3( 0.000,  0.000, -1.000),  // 前枪(朝前)
      new THREE.Vector3( 0.000,  0.500,  0.866),  // 背炮塔(后上)
      new THREE.Vector3( 0.000, -0.342,  0.940),  // 腹炮塔(后下)
      new THREE.Vector3( 0.819, -0.017,  0.573),  // 侧后枪(右后)
    ],
  },
  // Ju 88 A（德国多用途轰炸机，不列颠战役参战）
  // 真实翼展 18.3m，userScale = 3.6 × 18.3 / 9.92 = 6.64
  // 朝向待调校（当前用 yaw=129 占位，需用调校台调出真实值）
  '/model/ju88.glb': {
    autoOrient: false, yawOffset: 129, userScale: 6.64,
  },
  '/model/spitfire.glb': {
    autoOrient: false, yawOffset: -124.5, userScale: 4.08,
    hideGear: true,
    hideGearNodes: [
      'Object03-FACES_1','Cylinder07-FACES_1','Cylinder01-FACES_1','Cylinder06-FACES_1',
      'Torus01-FACES_1','Cylinder05-FACES_1','Cylinder82-FACES_1','Cylinder83-FACES_1',
      'Torus04-FACES_1','Cylinder84-FACES_1','Cylinder81-FACES_1','Object02-FACES_1',
      'Cylinder80-FACES_1','Cylinder20-FACES_1','Cylinder02-FACES_1','Torus03-FACES_1',
      'Cylinder16-FACES_1',
    ],
    propNodes: ['Cylinder78-FACES_1','Cylinder79-FACES_1','Cylinder77-FACES_1'],
  },
  '/model/yak9.glb': {
    autoOrient: false, yawOffset: -139, userScale: 3.52,
  },
  '/model/yak1.glb': {
    autoOrient: true, userScale: 3.63,
    propNodes: ['Line16-FACES_1', 'Line17-FACES_1', 'Line05-FACES_1'],
  },
  '/model/bf109_opt.glb': {
    autoOrient: true, userScale: 3.6,
  },
};

// ---------- 枪口预设 ----------
// 每个枪口含：位置 (x,y,z) + 方向 (yaw,pitch 度，body frame)
// yaw=0,pitch=0 → 朝机头 -Z；yaw=180 → 朝机尾；yaw=90 → 朝 +X（左翼）；pitch=90 → 朝上
const MUZZLE_PRESETS = {
  // 喷火 Mk IIa：8 × .303 勃朗宁（A翼），4左+4右机翼前缘，全部朝前
  spitfire: [
    { name: '右机翼外', x: 4.8,  y: -0.3, z: -3.0, yaw: 0, pitch: 0 },
    { name: '右机翼中外', x: 3.9,  y: -0.3, z: -3.0, yaw: 0, pitch: 0 },
    { name: '右机翼中内', x: 2.6,  y: -0.3, z: -3.0, yaw: 0, pitch: 0 },
    { name: '右机翼内', x: 1.3,  y: -0.3, z: -3.0, yaw: 0, pitch: 0 },
    { name: '左机翼内', x: -1.3,  y: -0.3, z: -3.0, yaw: 0, pitch: 0 },
    { name: '左机翼中内', x: -2.6,  y: -0.3, z: -3.0, yaw: 0, pitch: 0 },
    { name: '左机翼中外', x: -3.9,  y: -0.3, z: -3.0, yaw: 0, pitch: 0 },
    { name: '左机翼外', x: -4.8, y: -0.3, z: -3.0, yaw: 0, pitch: 0 },
  ],
  // Yak-9：4 挺（2机翼+2机头），全部朝前
  yak9: [
    { name: '右机翼', x: 6.50, y: -1.35, z: -4.15, yaw: 0, pitch: 0 },
    { name: '左机翼', x: -6.50, y: -1.35, z: -4.15, yaw: 0, pitch: 0 },
    { name: '右机头', x: 0.50, y: 1.00, z: -7.80, yaw: 0, pitch: 0 },
    { name: '左机头', x: -0.50, y: 1.00, z: -7.80, yaw: 0, pitch: 0 },
  ],
  // He 111 H-2：1 固定前枪 + 3 自卫炮塔（背/腹/侧后）
  // 朝向：前枪朝前；背塔朝后上；腹塔朝后下；侧后塔朝后斜
  he111: [
    { name: '前枪(机头固定)', x: 0, y: 0.5, z: -7.5, yaw: 0,   pitch: 0 },
    { name: '背炮塔(后上)',   x: 0, y: 1.8, z: 3.5, yaw: 180, pitch: 30 },
    { name: '腹炮塔(后下)',   x: 0, y: -1.2, z: 2.5, yaw: 180, pitch: -30 },
    { name: '侧后枪(右后)',   x: 1.5, y: 0.5, z: 4.0, yaw: 150, pitch: 0 },
  ],
  // Ju 88 A：1 前枪 + 3 自卫炮塔
  ju88: [
    { name: '前枪(座舱固定)', x: 0, y: 0.6, z: -5.5, yaw: 0,   pitch: 0 },
    { name: '背炮塔(后上)',   x: 0, y: 1.5, z: 2.5, yaw: 180, pitch: 25 },
    { name: '腹炮塔(后下)',   x: 0, y: -1.0, z: 2.0, yaw: 180, pitch: -25 },
    { name: '侧后枪(右后)',   x: 1.2, y: 0.4, z: 3.5, yaw: 145, pitch: 0 },
  ],
};

// ---------- 基础设施 ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 50000);
camera.position.set(0, 70, 30);

// ---------- 环境 ----------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(40000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, toneMapped: false, depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3a7fd6) },
      midColor: { value: new THREE.Color(0x7fb8e8) },
      botColor: { value: new THREE.Color(0xc8e0f4) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec3 vP; uniform vec3 topColor; uniform vec3 midColor; uniform vec3 botColor;
      void main(){ float h=normalize(vP).y; vec3 c=h>0.0?mix(midColor,topColor,smoothstep(0.0,0.6,h)):mix(midColor,botColor,smoothstep(0.0,-0.3,h)); gl_FragColor=vec4(c,1.0);}`,
  })
);
scene.add(sky);
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x4a5d3a, 0.9));
const sunLight = new THREE.DirectionalLight(0xfff1d0, 2.8);
sunLight.position.set(300, 500, 200);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -150; sunLight.shadow.camera.right = 150;
sunLight.shadow.camera.top = 150; sunLight.shadow.camera.bottom = -150;
sunLight.shadow.camera.far = 1400; sunLight.shadow.bias = -0.0004;
scene.add(sunLight); scene.add(sunLight.target);
scene.fog = new THREE.FogExp2(0xc4d2dc, 0.0001);
const grid = new THREE.GridHelper(2400, 120, 0x9fd6ff, 0x3a5a72);
grid.material.opacity = 0.25; grid.material.transparent = true; grid.position.y = 0.3;
scene.add(grid);

// ---------- 飞机 ----------
const root = new THREE.Group();
const modelRot = new THREE.Group(); // YXZ 三轴校准组
root.add(modelRot);
scene.add(root);
let model = null;
let baseScale = 1;
const modelCenter = new THREE.Vector3();

// 参考飞机
let refModel = null, refModelRot = null;

// ---------- 朝向参数 ----------
// cx/cy/cz = 中心偏移（body frame 世界单位，缩放后）
// 用于微调模型几何中心与视觉中心的对齐（如垂尾导致 Y 偏高）
const orient = { yaw: 0, pitch: 0, roll: 0, scale: 4.08, cx: 0, cy: 0, cz: 0 };

// ---------- 枪口（动态，按预设切换）----------
let muzzles = [];
const muzzleMarkers = [];
const rayLines = [];
const RAY_LEN = 400;

function clearMuzzleObjects() {
  muzzleMarkers.forEach((b) => { root.remove(b); b.geometry.dispose(); b.material.dispose(); });
  rayLines.forEach((l) => { root.remove(l); l.geometry.dispose(); l.material.dispose(); });
  muzzleMarkers.length = 0;
  rayLines.length = 0;
}

// 由 yaw/pitch（度，body frame）计算方向向量
// yaw=0,pitch=0 → (0,0,-1) 朝机头；yaw=180 → 朝机尾；pitch=90 → 朝上
function muzzleDir(m) {
  const ya = THREE.MathUtils.degToRad(m.yaw || 0);
  const pi = THREE.MathUtils.degToRad(m.pitch || 0);
  return new THREE.Vector3(
    Math.sin(ya) * Math.cos(pi),
    Math.sin(pi),
    -Math.cos(ya) * Math.cos(pi)
  );
}

function buildMuzzleObjects() {
  clearMuzzleObjects();
  muzzles.forEach((m) => {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff5a4d, depthTest: false })
    );
    ball.position.set(m.x, m.y, m.z);
    ball.renderOrder = 10;
    root.add(ball);
    muzzleMarkers.push(ball);

    const dir = muzzleDir(m);
    const end = new THREE.Vector3(m.x + dir.x * RAY_LEN, m.y + dir.y * RAY_LEN, m.z + dir.z * RAY_LEN);
    const pts = [new THREE.Vector3(m.x, m.y, m.z), end];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xff5a4d, transparent: true, opacity: 0.45, depthTest: false,
    }));
    line.renderOrder = 9;
    root.add(line);
    rayLines.push(line);
  });
}

// 前方指示线（绿色，标识 -Z 机头方向）
const fwdRay = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -RAY_LEN)]),
  new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.8, depthTest: false })
);
fwdRay.renderOrder = 8;
root.add(fwdRay);

// 坐标轴（标识 body frame 原点）
const axisLen = 12;
[
  { dir: [1, 0, 0], color: 0xff4444 },
  { dir: [0, 1, 0], color: 0x44ff44 },
  { dir: [0, 0, -1], color: 0x4488ff },
].forEach(({ dir, color }) => {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(dir[0] * axisLen, dir[1] * axisLen, dir[2] * axisLen),
  ]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 2 }));
  line.renderOrder = 7;
  root.add(line);
});

// ---------- 方向标签（Canvas Sprite，始终面向相机）----------
function makeLabelSprite(text, color = '#6fff8a') {
  const cv = document.createElement('canvas');
  cv.width = 320; cv.height = 80;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, cv.width - 4, cv.height - 4);
  ctx.fillStyle = color;
  ctx.font = 'bold 42px Consolas, "Microsoft YaHei", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cv.width / 2, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(10, 2.5, 1);
  sp.renderOrder = 20;
  return sp;
}
// 5 个方向标签：机头/机尾/左/右/上
const LABEL_R = 45; // 标签距原点距离（拉远避免遮挡模型）
const labels = [
  { text: '机头 -Z', pos: [0, 0, -LABEL_R], color: '#6fff8a' },
  { text: '机尾 +Z', pos: [0, 0, LABEL_R], color: '#ff5a4d' },
  { text: '左翼 +X', pos: [LABEL_R, 0, 0], color: '#ffd84d' },
  { text: '右翼 -X', pos: [-LABEL_R, 0, 0], color: '#ffd84d' },
  { text: '上 +Y', pos: [0, LABEL_R, 0], color: '#6fd0ff' },
];
labels.forEach((l) => {
  const sp = makeLabelSprite(l.text, l.color);
  sp.position.set(l.pos[0], l.pos[1], l.pos[2]);
  root.add(sp);
});

function updateMuzzles() {
  muzzles.forEach((m, i) => {
    if (!muzzleMarkers[i]) return;
    muzzleMarkers[i].position.set(m.x, m.y, m.z);
    const dir = muzzleDir(m);
    const arr = rayLines[i].geometry.attributes.position;
    arr.setXYZ(0, m.x, m.y, m.z);
    arr.setXYZ(1, m.x + dir.x * RAY_LEN, m.y + dir.y * RAY_LEN, m.z + dir.z * RAY_LEN);
    arr.needsUpdate = true;
  });
}

// ---------- 全局状态 ----------
const state = {
  currentUrl: '/model/spitfire_mk_iia.glb',
  nodes: [],            // [{ name, mesh, y, x, z, size, visible, markedProp, markedGear }]
  selectedName: null,
  sortOrder: 'y',
  markedPropNames: [],  // 用户标记的螺旋桨节点名
  markedGearNames: [],  // 用户标记的起落架节点名（→ hideGearNodes）
};

// ---------- 模型加载 ----------
const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/');
loader.setDRACOLoader(draco);
loader.setMeshoptDecoder(MeshoptDecoder);

async function loadModel(url) {
  const loaderEl = document.getElementById('loader');
  loaderEl.classList.remove('hide');
  document.getElementById('loader-fill').style.width = '0%';
  document.getElementById('loader-pct').textContent = '0%';
  document.getElementById('loader-err').textContent = '';
  document.getElementById('topbar-sub').textContent = '加载 ' + url.split('/').pop() + ' …';

  // 清理旧模型
  if (model) {
    modelRot.remove(model);
    model.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { Array.isArray(o.material) ? o.material.forEach((m) => m.dispose()) : o.material.dispose(); }
    });
    model = null;
  }
  state.nodes = [];
  state.selectedName = null;
  state.markedPropNames = [];
  state.markedGearNames = [];
  state.currentUrl = url;

  // 应用该模型的预设配置
  const cfg = MODEL_CONFIGS[url] || {};
  orient.scale = cfg.userScale || 4.08;
  // 中心偏移：优先用配置，否则重置为 0
  orient.cx = cfg.centerOffset ? (cfg.centerOffset[0] || 0) : 0;
  orient.cy = cfg.centerOffset ? (cfg.centerOffset[1] || 0) : 0;
  orient.cz = cfg.centerOffset ? (cfg.centerOffset[2] || 0) : 0;

  try {
    const gltf = await loader.loadAsync(url, (e) => {
      if (e.lengthComputable) {
        const p = (e.loaded / e.total) * 100;
        document.getElementById('loader-fill').style.width = p + '%';
        document.getElementById('loader-pct').textContent = p.toFixed(0) + '%';
      }
    });
    model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });

    // 归一化 + 居中（与 aircraft.js _normalize 一致）
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    modelCenter.copy(center);
    const longest = Math.max(size.x, size.y, size.z) || 1;
    baseScale = 9 / longest;
    const s0 = baseScale * orient.scale;
    model.scale.setScalar(s0);
    model.position.copy(center).multiplyScalar(-s0);
    modelRot.add(model);

    // 收集节点
    const meshNodes = [];
    model.traverse((o) => {
      if (o.isMesh && o.name) {
        const mbox = new THREE.Box3().setFromObject(o);
        const msize = mbox.getSize(new THREE.Vector3());
        const mcenter = mbox.getCenter(new THREE.Vector3());
        if (!isFinite(mcenter.y) || msize.length() < 0.001) return;
        meshNodes.push({
          name: o.name, mesh: o, y: mcenter.y, x: mcenter.x, z: mcenter.z,
          size: msize, visible: o.visible, markedProp: false, markedGear: false,
          isPropName: isPropName(o.name),
        });
      }
    });
    state.nodes = meshNodes;
    // 预填已配置的 propNodes 标记（螺旋桨）
    if (cfg.propNodes) {
      const set = new Set(cfg.propNodes);
      meshNodes.forEach((n) => { if (set.has(n.name)) { n.markedProp = true; state.markedPropNames.push(n.name); } });
    }
    // 预填已配置的 hideGearNodes 标记（起落架）
    if (cfg.hideGearNodes) {
      const set = new Set(cfg.hideGearNodes);
      meshNodes.forEach((n) => {
        if (set.has(n.name)) {
          n.markedGear = true;
          state.markedGearNames.push(n.name);
          n.mesh.material.transparent = false;
          n.mesh.material.opacity = 1.0;
          n.mesh.material.emissive = new THREE.Color(0xff5a4d);
          n.mesh.material.emissiveIntensity = 0.5;
        }
      });
    }
    renderNodeList();

    // 自动偏航
    const autoYaw = computeAutoOrient(model, cfg);
    orient.yaw = autoYaw;
    orient.pitch = 0;
    orient.roll = 0;
    updateOrientSliders();
    applyOrient();

    root.position.set(0, 60, 0);
    document.getElementById('topbar-sub').textContent = '就绪 · ' + url.split('/').pop() + ' · 调三轴使机头对齐绿线';
    setTimeout(() => loaderEl.classList.add('hide'), 300);
  } catch (err) {
    document.getElementById('loader-err').textContent = '加载失败：' + (err.message || err) +
      '\n请确认通过本地 HTTP 服务器打开。';
    loaderEl.classList.remove('hide');
  }
}

// ---------- 参考飞机 ----------
function loadReference(url) {
  if (refModel) {
    if (refModelRot) { modelRot.parent.remove(refModelRot); }
    refModel.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { Array.isArray(o.material) ? o.material.forEach((m) => m.dispose()) : o.material.dispose(); }
    });
    refModel = null; refModelRot = null;
  }
  if (!url) return;

  loader.load(url, (gltf) => {
    const m = gltf.scene;
    refModel = m;
    const cfg = MODEL_CONFIGS[url] || {};
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const s = 9 / longest * (cfg.userScale || 3.6) / 3.6;
    m.scale.setScalar(s);
    m.position.copy(center).multiplyScalar(-s);

    const refYaw = computeAutoOrient(m, cfg);
    refModelRot = new THREE.Group();
    refModelRot.add(m);
    refModelRot.rotation.set(
      THREE.MathUtils.degToRad(cfg.pitchOffset || 0),
      THREE.MathUtils.degToRad(cfg.autoOrient === false ? (cfg.yawOffset || 0) : refYaw),
      THREE.MathUtils.degToRad(cfg.rollOffset || 0),
      'YXZ'
    );
    root.add(refModelRot);
    applyRefOpacity();
  });
}

function applyRefOpacity() {
  if (!refModel) return;
  const opacity = parseFloat(document.getElementById('ref-opacity').value);
  refModel.traverse((o) => {
    if (o.isMesh) {
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = opacity;
      o.material.depthWrite = false;
    }
  });
}

// ---------- _autoOrient 算法（与 aircraft.js 同步）----------
function computeAutoOrient(m, cfg) {
  if (!cfg || cfg.autoOrient === false) return cfg ? cfg.yawOffset || 0 : 0;
  m.updateWorldMatrix(true, true);
  const propNodes = [];
  // 优先用显式 propNodes（标记的或预配置的）
  const explicit = (state.markedPropNames && state.markedPropNames.length) ? state.markedPropNames
                  : (cfg.propNodes || null);
  if (explicit && explicit.length) {
    const set = new Set(explicit);
    m.traverse((o) => { if (o.name && set.has(o.name)) propNodes.push(o); });
  } else {
    // 退化：PROP_KEYWORDS 关键词匹配
    m.traverse((o) => { if (isPropName(o.name)) propNodes.push(o); });
  }
  if (!propNodes.length) return cfg.yawOffset || 0;
  // 用几何中心而非 transform 原点（与 aircraft.js _autoOrient 同步）
  // 部分模型（如喷火 Object_4）节点 transform 原点远离几何中心
  const c = new THREE.Vector3();
  const tmpBox = new THREE.Box3();
  const tmpCenter = new THREE.Vector3();
  propNodes.forEach((o) => {
    tmpBox.setFromObject(o);
    tmpBox.getCenter(tmpCenter);
    c.add(tmpCenter);
  });
  c.divideScalar(propNodes.length);
  const nx = c.x, nz = c.z;
  if (Math.hypot(nx, nz) < 1e-3) return cfg.yawOffset || 0;
  const phi = Math.atan2(nx, nz);
  return THREE.MathUtils.radToDeg(Math.PI - phi);
}

// ---------- 应用朝向 + 缩放 ----------
function applyOrient() {
  modelRot.rotation.set(
    THREE.MathUtils.degToRad(orient.pitch),
    THREE.MathUtils.degToRad(orient.yaw),
    THREE.MathUtils.degToRad(orient.roll),
    'YXZ'
  );
  if (model) {
    const s = baseScale * orient.scale;
    model.scale.setScalar(s);
    // Box3 几何中心居中 + 用户中心偏移（body frame 世界单位）
    model.position.copy(modelCenter).multiplyScalar(-s).add(
      new THREE.Vector3(orient.cx, orient.cy, orient.cz)
    );
  }
  updateOutput();
}

function updateOrientSliders() {
  $('r-yaw').value = orient.yaw;
  $('r-pitch').value = orient.pitch;
  $('r-roll').value = orient.roll;
  $('r-scale').value = orient.scale;
  $('r-cx').value = orient.cx;
  $('r-cy').value = orient.cy;
  $('r-cz').value = orient.cz;
  $('r-yaw-v').value = orient.yaw.toFixed(1);
  $('r-pitch-v').value = orient.pitch.toFixed(1);
  $('r-roll-v').value = orient.roll.toFixed(1);
  $('r-scale-v').value = orient.scale.toFixed(2);
  $('r-cx-v').value = orient.cx.toFixed(2);
  $('r-cy-v').value = orient.cy.toFixed(2);
  $('r-cz-v').value = orient.cz.toFixed(2);
}

// ---------- 相机 ----------
let camMode = 'chase';
const camOffsets = {
  chase: new THREE.Vector3(0, 3.4, 12.5),
  side:  new THREE.Vector3(18, 3, 0),
  top:   new THREE.Vector3(0, 24, 0.5),
  front: new THREE.Vector3(0, 2, -18),
};
const freeView = { yaw: 0, pitch: 0, dist: 1, dragging: false, lx: 0, ly: 0 };
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousedown', (e) => {
  if (e.button === 0 && e.target.tagName === 'CANVAS') { freeView.dragging = true; freeView.lx = e.clientX; freeView.ly = e.clientY; e.preventDefault(); }
});
addEventListener('mouseup', (e) => { if (e.button === 0) freeView.dragging = false; });
addEventListener('mousemove', (e) => {
  if (!freeView.dragging) return;
  const dx = (e.clientX - freeView.lx) * 0.005;
  const dy = (e.clientY - freeView.ly) * 0.005;
  freeView.yaw -= dx; freeView.pitch -= dy;
  freeView.pitch = Math.max(-1.4, Math.min(1.4, freeView.pitch));
  freeView.lx = e.clientX; freeView.ly = e.clientY;
});
addEventListener('wheel', (e) => {
  freeView.dist *= e.deltaY > 0 ? 1.08 : 0.92;
  freeView.dist = Math.max(0.3, Math.min(4, freeView.dist));
}, { passive: true });

const _fwd = new THREE.Vector3();
function updateCamera(dt) {
  const obs = new THREE.Quaternion().setFromEuler(new THREE.Euler(freeView.pitch, freeView.yaw, 0, 'YXZ'));
  const baseOff = camOffsets[camMode].clone().multiplyScalar(freeView.dist);
  const off = baseOff.applyQuaternion(obs).add(root.position);
  camera.position.lerp(off, 1 - Math.exp(-dt * 6));
  _fwd.copy(root.position);
  camera.lookAt(_fwd);
}

// ---------- 主循环 ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  sky.position.copy(camera.position);
  updateCamera(dt);
  renderer.render(scene, camera);
}

// ---------- UI 绑定 ----------
const $ = (id) => document.getElementById(id);
function bindSlider(rangeId, numId, onChange) {
  const r = $(rangeId), n = $(numId);
  const apply = (val) => {
    val = +val; if (Number.isNaN(val)) return;
    r.value = val;
    if (n.tagName === 'INPUT') n.value = val; else n.textContent = val;
    onChange(val);
  };
  r.addEventListener('input', (e) => apply(e.target.value));
  if (n.tagName === 'INPUT') {
    n.addEventListener('input', (e) => apply(e.target.value));
    n.addEventListener('change', (e) => apply(e.target.value));
  }
}

// 朝向三轴 + 缩放 + 中心偏移
bindSlider('r-yaw', 'r-yaw-v', (v) => { orient.yaw = v; $('r-yaw-v').value = v.toFixed(1); applyOrient(); });
bindSlider('r-pitch', 'r-pitch-v', (v) => { orient.pitch = v; $('r-pitch-v').value = v.toFixed(1); applyOrient(); });
bindSlider('r-roll', 'r-roll-v', (v) => { orient.roll = v; $('r-roll-v').value = v.toFixed(1); applyOrient(); });
bindSlider('r-scale', 'r-scale-v', (v) => { orient.scale = v; $('r-scale-v').value = v.toFixed(2); applyOrient(); });
bindSlider('r-cx', 'r-cx-v', (v) => { orient.cx = v; $('r-cx-v').value = v.toFixed(2); applyOrient(); });
bindSlider('r-cy', 'r-cy-v', (v) => { orient.cy = v; $('r-cy-v').value = v.toFixed(2); applyOrient(); });
bindSlider('r-cz', 'r-cz-v', (v) => { orient.cz = v; $('r-cz-v').value = v.toFixed(2); applyOrient(); });

$('btn-auto-yaw').addEventListener('click', () => {
  if (!model) return;
  const cfg = MODEL_CONFIGS[state.currentUrl] || {};
  orient.yaw = computeAutoOrient(model, cfg);
  orient.pitch = 0;
  orient.roll = 0;
  updateOrientSliders();
  applyOrient();
});
$('btn-reset-orient').addEventListener('click', () => {
  orient.yaw = 0; orient.pitch = 0; orient.roll = 0;
  orient.cx = 0; orient.cy = 0; orient.cz = 0;
  updateOrientSliders();
  applyOrient();
});

// 模型切换
function pickPresetByUrl(url) {
  if (url.includes('he111')) return 'he111';
  if (url.includes('ju88')) return 'ju88';
  if (url.includes('spitfire')) return 'spitfire';
  return 'yak9';
}
$('model-select').addEventListener('change', (e) => {
  loadModel(e.target.value).then(() => {
    const presetKey = pickPresetByUrl(e.target.value);
    $('muz-preset').value = presetKey;
    applyMuzzlePreset(presetKey);
  });
});

// 参考飞机
$('ref-select').addEventListener('change', (e) => loadReference(e.target.value));
bindSlider('ref-opacity', 'ref-opacity-v', (v) => { $('ref-opacity-v').value = v.toFixed(2); applyRefOpacity(); });

// ---------- 节点列表 ----------
const nodeListEl = document.getElementById('node-list');
function sortedNodes() {
  const arr = [...state.nodes];
  if (state.sortOrder === 'y') arr.sort((a, b) => a.y - b.y);
  else arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return arr;
}
function renderNodeList() {
  nodeListEl.innerHTML = '';
  sortedNodes().forEach((n) => {
    const row = document.createElement('div');
    row.className = 'node-row';
    if (n.markedProp) row.classList.add('prop');
    if (n.name === state.selectedName) row.classList.add('selected');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = n.visible;
    cb.addEventListener('change', () => { n.visible = cb.checked; n.mesh.visible = cb.checked; });
    const name = document.createElement('span'); name.className = 'name'; name.textContent = n.name;
    const info = document.createElement('span'); info.className = 'info';
    info.textContent = `Y=${n.y.toFixed(1)} ${n.size.x.toFixed(1)}×${n.size.y.toFixed(1)}×${n.size.z.toFixed(1)}${n.isPropName ? ' ⚡' : ''}`;
    row.appendChild(cb); row.appendChild(name); row.appendChild(info);
    if (n.markedProp) { const t = document.createElement('span'); t.className = 'tag prop'; t.textContent = '桨'; row.appendChild(t); }
    if (n.markedGear) { const t = document.createElement('span'); t.className = 'tag gear'; t.textContent = '架'; row.appendChild(t); }
    row.addEventListener('click', (e) => { if (e.target === cb) return; selectNode(n.name); });
    nodeListEl.appendChild(row);
  });
}
function selectNode(name) {
  state.selectedName = name;
  state.nodes.forEach((n) => {
    if (n.name === name) {
      n.mesh.material = Array.isArray(n.mesh.material) ? n.mesh.material[0] : n.mesh.material;
      n.mesh.material.transparent = false;
      n.mesh.material.opacity = 1.0;
      n.mesh.material.emissive = new THREE.Color(0x6fd0ff);
      n.mesh.material.emissiveIntensity = 0.4;
    } else if (n.markedProp) {
      // 螺旋桨标记保留绿色高亮
      n.mesh.material.transparent = false;
      n.mesh.material.opacity = 1.0;
      n.mesh.material.emissive = new THREE.Color(0x6fff8a);
      n.mesh.material.emissiveIntensity = 0.5;
    } else if (n.markedGear) {
      // 起落架标记保留红色高亮
      n.mesh.material.transparent = false;
      n.mesh.material.opacity = 1.0;
      n.mesh.material.emissive = new THREE.Color(0xff5a4d);
      n.mesh.material.emissiveIntensity = 0.5;
    } else {
      n.mesh.material.transparent = true;
      n.mesh.material.opacity = 0.12;
      n.mesh.material.emissive = new THREE.Color(0x000000);
      n.mesh.material.emissiveIntensity = 0;
    }
  });
  renderNodeList();
}
$('btn-sort-y').addEventListener('click', () => { state.sortOrder = 'y'; renderNodeList(); });
$('btn-sort-name').addEventListener('click', () => { state.sortOrder = 'name'; renderNodeList(); });
$('btn-show-all').addEventListener('click', () => {
  state.nodes.forEach((n) => { n.visible = true; n.mesh.visible = true; });
  renderNodeList();
});
$('btn-hide-low').addEventListener('click', () => {
  state.nodes.forEach((n) => { if (n.y < 0.3) { n.visible = false; n.mesh.visible = false; } });
  renderNodeList();
});

// 螺旋桨标记
$('btn-mark-prop').addEventListener('click', () => {
  if (!state.selectedName) { alert('请先点击节点列表选中一个节点'); return; }
  const n = state.nodes.find((x) => x.name === state.selectedName);
  if (!n) return;
  n.markedProp = !n.markedProp;
  if (n.markedProp) {
    if (!state.markedPropNames.includes(n.name)) state.markedPropNames.push(n.name);
    // 标记的节点高亮绿色
    n.mesh.material.transparent = false;
    n.mesh.material.opacity = 1.0;
    n.mesh.material.emissive = new THREE.Color(0x6fff8a);
    n.mesh.material.emissiveIntensity = 0.5;
  } else {
    state.markedPropNames = state.markedPropNames.filter((x) => x !== n.name);
    n.mesh.material.emissive = new THREE.Color(0x000000);
    n.mesh.material.emissiveIntensity = 0;
  }
  renderNodeList();
  updateOutput();
});
$('btn-clear-prop').addEventListener('click', () => {
  state.nodes.forEach((n) => {
    n.markedProp = false;
    n.mesh.material.emissive = new THREE.Color(0x000000);
    n.mesh.material.emissiveIntensity = 0;
  });
  state.markedPropNames = [];
  renderNodeList();
  updateOutput();
});

// 起落架标记
$('btn-mark-gear').addEventListener('click', () => {
  if (!state.selectedName) { alert('请先点击节点列表选中一个节点'); return; }
  const n = state.nodes.find((x) => x.name === state.selectedName);
  if (!n) return;
  n.markedGear = !n.markedGear;
  if (n.markedGear) {
    if (!state.markedGearNames.includes(n.name)) state.markedGearNames.push(n.name);
    // 标记的节点高亮红色
    n.mesh.material.transparent = false;
    n.mesh.material.opacity = 1.0;
    n.mesh.material.emissive = new THREE.Color(0xff5a4d);
    n.mesh.material.emissiveIntensity = 0.5;
  } else {
    state.markedGearNames = state.markedGearNames.filter((x) => x !== n.name);
    n.mesh.material.emissive = new THREE.Color(0x000000);
    n.mesh.material.emissiveIntensity = 0;
  }
  renderNodeList();
  updateOutput();
});
$('btn-clear-gear').addEventListener('click', () => {
  state.nodes.forEach((n) => {
    n.markedGear = false;
    n.mesh.material.emissive = new THREE.Color(0x000000);
    n.mesh.material.emissiveIntensity = 0;
  });
  state.markedGearNames = [];
  renderNodeList();
  updateOutput();
});

// ---------- 枪口预设 + 动态 UI ----------
function applyMuzzlePreset(key) {
  if (key === 'custom') { updateOutput(); return; }
  // 优先用 MODEL_CONFIGS 里已调好的 muzzleOffsets/muzzleDirs（与 enemy.js 同步）
  // 没有配置时才退化用 MUZZLE_PRESETS 占位预设
  const url = state.currentUrl;
  const cfg = MODEL_CONFIGS[url];
  if (cfg && cfg.muzzleOffsets && cfg.muzzleOffsets.length) {
    const dirs = cfg.muzzleDirs || [];
    muzzles = cfg.muzzleOffsets.map((m, i) => {
      // 从方向向量反推 yaw/pitch（度）用于 UI 显示
      let yaw = 0, pitch = 0;
      if (dirs[i]) {
        const d = dirs[i];
        pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)));
        yaw = THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z));
      }
      return {
        name: MUZZLE_PRESETS[key] && MUZZLE_PRESETS[key][i] ? MUZZLE_PRESETS[key][i].name : `枪口${i+1}`,
        x: m.x, y: m.y, z: m.z,
        yaw, pitch,
      };
    });
  } else {
    const preset = MUZZLE_PRESETS[key];
    if (!preset) return;
    muzzles = preset.map((m) => ({ ...m }));
  }
  buildMuzzleObjects();
  buildMuzzleUI();
  // 显隐标记/射线
  const showMarkers = $('btn-markers').classList.contains('active');
  const showRays = $('btn-rays').classList.contains('active');
  muzzleMarkers.forEach((b) => (b.visible = showMarkers));
  rayLines.forEach((l) => (l.visible = showRays));
  updateOutput();
}
$('muz-preset').addEventListener('change', (e) => applyMuzzlePreset(e.target.value));

function buildMuzzleUI() {
  const muzList = $('muz-list');
  muzList.innerHTML = '';
  muzzles.forEach((m, i) => {
    const group = document.createElement('div');
    group.className = 'muz-group';
    group.innerHTML = `<div class="muz-title">${i + 1}. ${m.name}</div>` +
      ['x', 'y', 'z'].map((c) =>
        `<div class="ctrl"><label>${c.toUpperCase()}</label>` +
        `<input type="range" id="mz${i}-${c}" min="-20" max="20" step="0.05" value="${m[c]}">` +
        `<input type="number" id="mz${i}-${c}-n" min="-20" max="20" step="0.05" value="${m[c]}" class="val" style="width:56px"></div>`
      ).join('') +
      `<div class="ctrl"><label>Yaw</label>` +
      `<input type="range" id="mz${i}-yaw" min="-180" max="180" step="1" value="${m.yaw || 0}">` +
      `<input type="number" id="mz${i}-yaw-n" min="-180" max="180" step="1" value="${m.yaw || 0}" class="val" style="width:56px"></div>` +
      `<div class="ctrl"><label>Pitch</label>` +
      `<input type="range" id="mz${i}-pitch" min="-90" max="90" step="1" value="${m.pitch || 0}">` +
      `<input type="number" id="mz${i}-pitch-n" min="-90" max="90" step="1" value="${m.pitch || 0}" class="val" style="width:56px"></div>`;
    muzList.appendChild(group);
  });
  muzzles.forEach((m, i) => {
    ['x', 'y', 'z'].forEach((c) => {
      bindSlider('mz' + i + '-' + c, 'mz' + i + '-' + c + '-n', (v) => { m[c] = v; updateMuzzles(); updateOutput(); });
    });
    bindSlider('mz' + i + '-yaw', 'mz' + i + '-yaw-n', (v) => { m.yaw = v; updateMuzzles(); updateOutput(); });
    bindSlider('mz' + i + '-pitch', 'mz' + i + '-pitch-n', (v) => { m.pitch = v; updateMuzzles(); updateOutput(); });
  });
}

$('btn-markers').addEventListener('click', () => {
  const btn = $('btn-markers');
  btn.classList.toggle('active');
  const show = btn.classList.contains('active');
  muzzleMarkers.forEach((b) => (b.visible = show));
});
$('btn-rays').addEventListener('click', () => {
  const btn = $('btn-rays');
  btn.classList.toggle('active');
  const show = btn.classList.contains('active');
  rayLines.forEach((l) => (l.visible = show));
});

// 视角
function setCam(m) {
  camMode = m;
  ['chase', 'side', 'top', 'front'].forEach((k) => $('btn-cam-' + k).classList.toggle('active', k === m));
  freeView.yaw = 0; freeView.pitch = 0; freeView.dist = 1;
}
['chase', 'side', 'top', 'front'].forEach((m) => $('btn-cam-' + m).addEventListener('click', () => setCam(m)));

// ---------- 参数输出 ----------
function updateOutput() {
  const url = state.currentUrl;
  const propArr = state.markedPropNames;
  const lines = muzzles.map((m) => {
    const fx = m.x.toFixed(2), fy = m.y.toFixed(2), fz = m.z.toFixed(2);
    const sx = (m.x >= 0 ? ' ' : '') + fx, sz = (m.z >= 0 ? ' ' : '') + fz;
    return `  new THREE.Vector3(${sx}, ${fy}, ${sz}), // ${m.name}`;
  });
  // 方向向量输出（body frame，单位向量）
  const dirLines = muzzles.map((m) => {
    const d = muzzleDir(m);
    const dx = (d.x >= 0 ? ' ' : '') + d.x.toFixed(3);
    const dy = (d.y >= 0 ? ' ' : '') + d.y.toFixed(3);
    const dz = (d.z >= 0 ? ' ' : '') + d.z.toFixed(3);
    return `  new THREE.Vector3(${dx}, ${dy}, ${dz}), // ${m.name} (yaw=${(m.yaw||0).toFixed(0)}° pitch=${(m.pitch||0).toFixed(0)}°)`;
  });
  const yawLine = `yawOffset: ${orient.yaw.toFixed(1)},`;
  const pitchLine = `pitchOffset: ${orient.pitch.toFixed(1)},`;
  const rollLine = `rollOffset: ${orient.roll.toFixed(1)},`;
  const propLine = propArr.length ? `propNodes: ${JSON.stringify(propArr)},` : '// 无螺旋桨标记（PROP_KEYWORDS 自动匹配）';
  const gearArr = state.markedGearNames;
  const gearLine = gearArr.length ? `hideGear: true,\n  hideGearNodes: ${JSON.stringify(gearArr)},` : '';
  // 中心偏移（非零时输出，需同步到 aircraft.js _normalize）
  const hasOffset = Math.abs(orient.cx) + Math.abs(orient.cy) + Math.abs(orient.cz) > 0.01;
  const offsetLine = hasOffset
    ? `centerOffset: [${orient.cx.toFixed(2)}, ${orient.cy.toFixed(2)}, ${orient.cz.toFixed(2)}], // body frame 世界单位`
    : '';
  // 若所有枪口都是 yaw=0,pitch=0（朝前），则不输出 muzzleDirs（兼容旧结构）
  const allForward = muzzles.every((m) => Math.abs(m.yaw || 0) < 0.5 && Math.abs(m.pitch || 0) < 0.5);
  const dirSection = allForward ? '' :
`  // 自卫炮塔方向（body frame 单位向量，与 muzzleOffsets 一一对应）
  muzzleDirs: [
${dirLines.join('\n')}
  ],`;
  $('out-pre').textContent =
`// ${url} 调试结果 → 粘贴到 enemy.js MODEL_CONFIGS
'/model/${url.split('/').pop()}': {
  autoOrient: ${MODEL_CONFIGS[url]?.autoOrient ?? true},
  ${yawLine}
  ${pitchLine}
  ${rollLine}
  userScale: ${orient.scale.toFixed(2)},
  ${offsetLine}
  ${propLine}
  ${gearLine}
  muzzleOffsets: [
${lines.join('\n')}
  ],
${dirSection}
},

// → MODEL_SPECS 性能（参考历史参数，需按机型调整）
'/model/${url.split('/').pop()}': {
  maxSpeed: 168, cruiseSpeed: 105, maxHp: 110,
  pitchMax: 1.4, pitchResp: 5.8,
  rollMax: 2.7, rollResp: 6.5,
  yawMax: 0.7, yawResp: 3.5,
  stallThreshold: 11,
},`;
}
$('btn-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('out-pre').textContent).then(() => {
    $('btn-copy').textContent = '已复制 ✓';
    setTimeout(() => ($('btn-copy').textContent = '复制参数'), 1500);
  });
});
$('btn-screenshot').addEventListener('click', () => {
  renderer.render(scene, camera);
  const link = document.createElement('a');
  link.download = 'tune_' + state.currentUrl.split('/').pop().replace('.glb', '') + '_' + camMode + '.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ---------- 自适应 ----------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- 调试钩子（用 getter 保证 model 等变量始终取最新值）----------
Object.defineProperty(window, '__debug', {
  get: () => ({ state, orient, muzzles, scene, camera, renderer, model, loadModel, computeAutoOrient }),
});
window.THREE = THREE;  // 暴露给验证脚本（pivot 旋转测试）使用

// ---------- 启动 ----------
const initialUrl = new URLSearchParams(location.search).get('model') || '/model/he111.glb';
$('model-select').value = initialUrl;
const initialPreset = pickPresetByUrl(initialUrl);
$('muz-preset').value = initialPreset;
applyMuzzlePreset(initialPreset);
loadModel(initialUrl).then(() => { updateMuzzles(); updateOutput(); animate(); });
