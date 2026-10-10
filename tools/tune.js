import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Sky } from 'three/addons/objects/Sky.js';

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
const sky = new Sky(); sky.scale.setScalar(450000); scene.add(sky);
const u = sky.material.uniforms;
u.turbidity.value = 8; u.rayleigh.value = 2.2; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
const elevation = 28, azimuth = 150;
const sun = new THREE.Vector3();
sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
u.sunPosition.value.copy(sun);
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x4a5d3a, 0.9));
const sunLight = new THREE.DirectionalLight(0xfff1d0, 2.8);
sunLight.position.copy(sun).multiplyScalar(500);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
const sc = 220;
sunLight.shadow.camera.left = -sc; sunLight.shadow.camera.right = sc;
sunLight.shadow.camera.top = sc; sunLight.shadow.camera.bottom = -sc;
sunLight.shadow.camera.far = 1400; sunLight.shadow.bias = -0.0004;
scene.add(sunLight); scene.add(sunLight.target);
scene.fog = new THREE.FogExp2(0xc4d2dc, 0.00020);
const grid = new THREE.GridHelper(2400, 120, 0x9fd6ff, 0x3a5a72);
grid.material.opacity = 0.32; grid.material.transparent = true; grid.position.y = 0.3;
scene.add(grid);

// ---------- 飞机 ----------
const root = new THREE.Group();
const modelYaw = new THREE.Group();
root.add(modelYaw);
scene.add(root);
let model = null, mixer = null, propAction = null;
let yawOffset = 0, baseScale = 1;
const userScale = 3.6; // 与主场景一致，调好的枪口位置可直接复用到 aircraft.js
const propBranches = { anim: [], blur: [], slow: [] };
let propMode = 'blur';

// ---------- 枪口位置（body frame，机头=-Z）----------
// 与 aircraft.js muzzleOffsets 初值一致；调红球贴合模型枪口即可
const muzzles = [
  { name: '右机翼', x: 7.80, y: -0.95, z: -6.15 },
  { name: '左机翼', x: -7.85, y: -0.95, z: -6.25 },
  { name: '右机头', x: 0.60, y: 1.35, z: -6.45 },
  { name: '左机头', x: -0.60, y: 1.35, z: -6.45 },
];
// 准星参数（与 main.js 对齐）
const aim = { dist: 1600, cockpitLift: 0.12 };
// 座舱视角（与 main.js cockpitCfg 一致，便于观察准星）
const cockpit = { x: 0, y: 1.65, z: -0.70, dist: 80 };

// 枪口标记球 + 弹道射线（射线沿 -Z 即机头方向，与子弹 getForward() 一致）
const muzzleMarkers = [];
const rayLines = [];
const RAY_LEN = 400;
muzzles.forEach((m) => {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff5a4d, depthTest: false })
  );
  ball.position.set(m.x, m.y, m.z);
  ball.renderOrder = 10;
  root.add(ball);
  muzzleMarkers.push(ball);

  const pts = [new THREE.Vector3(m.x, m.y, m.z), new THREE.Vector3(m.x, m.y, m.z - RAY_LEN)];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xff5a4d, transparent: true, opacity: 0.5, depthTest: false,
  }));
  line.renderOrder = 9;
  root.add(line);
  rayLines.push(line);
});

function updateMuzzles() {
  muzzles.forEach((m, i) => {
    muzzleMarkers[i].position.set(m.x, m.y, m.z);
    const arr = rayLines[i].geometry.attributes.position;
    arr.setXYZ(0, m.x, m.y, m.z);
    arr.setXYZ(1, m.x, m.y, m.z - RAY_LEN);
    arr.needsUpdate = true;
  });
}

// ---------- 模型加载 ----------
async function loadModel() {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/');
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);

  const gltf = await loader.loadAsync('/model/bf109_opt.glb', (e) => {
    if (e.lengthComputable) {
      const p = (e.loaded / e.total) * 100;
      document.getElementById('loader-fill').style.width = p + '%';
      document.getElementById('loader-pct').textContent = p.toFixed(0) + '%';
    }
  });
  model = gltf.scene;
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // 归一化 + 居中（userScale 与主场景一致）
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  baseScale = 9 / longest;
  model.scale.setScalar(baseScale * userScale);
  model.position.copy(center).multiplyScalar(-baseScale);
  modelYaw.add(model);

  // 自动朝向校准（按螺旋桨质心对齐 -Z）
  model.updateWorldMatrix(true, true);
  const propNodes = [];
  model.traverse((o) => { if (o.name && /prop/i.test(o.name)) propNodes.push(o); });
  if (propNodes.length) {
    const c = new THREE.Vector3(); const tmp = new THREE.Vector3();
    propNodes.forEach((o) => { o.getWorldPosition(tmp); c.add(tmp); });
    c.divideScalar(propNodes.length);
    if (Math.hypot(c.x, c.z) > 1e-3) {
      const phi = Math.atan2(c.x, c.z);
      yawOffset = THREE.MathUtils.radToDeg(Math.PI - phi);
    }
  }
  modelYaw.rotation.set(0, THREE.MathUtils.degToRad(yawOffset), 0);

  // 螺旋桨动画
  mixer = new THREE.AnimationMixer(model);
  if (gltf.animations && gltf.animations.length) {
    const propTracks = [];
    gltf.animations.forEach((clip) => {
      clip.tracks.forEach((t) => {
        const dot = t.name.lastIndexOf('.');
        const node = dot > 0 ? t.name.substring(0, dot) : t.name;
        if (/prop/i.test(node)) propTracks.push(t);
      });
    });
    if (propTracks.length) {
      const propClip = new THREE.AnimationClip('Prop', gltf.animations[0].duration, propTracks);
      propAction = mixer.clipAction(propClip);
      propAction.setLoop(THREE.LoopRepeat, Infinity);
      propAction.play();
      propAction.timeScale = 30;
    }
  }
  // 螺旋桨分支（默认模糊盘）
  let propSet = null;
  model.traverse((o) => { if (o.name && /^Prop_Set/i.test(o.name)) propSet = o; });
  const classify = (name) => (/blur/i.test(name) ? 'blur' : /slow/i.test(name) ? 'slow' : 'anim');
  if (propSet) propSet.children.forEach((c) => propBranches[classify(c.name || '')].push(c));
  applyPropMode();

  root.position.set(0, 60, 0);
  document.getElementById('topbar-sub').textContent = '就绪 · 调红球贴合枪口';
  setTimeout(() => document.getElementById('loader').classList.add('hide'), 300);
}

function applyPropMode() {
  const m = propMode;
  propBranches.anim.forEach((n) => (n.visible = m === 'all' || m === 'anim'));
  propBranches.blur.forEach((n) => (n.visible = m === 'all' || m === 'blur'));
  propBranches.slow.forEach((n) => (n.visible = m === 'all' || m === 'slow'));
}

function getForward() {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(root.quaternion);
}

// ---------- 相机（追尾 / 座舱 + 右键自由观察）----------
let camMode = 'chase';
const camOffsets = { chase: new THREE.Vector3(0, 3.4, 12.5) };
const freeView = { yaw: 0, pitch: 0, dist: 1, dragging: false, lx: 0, ly: 0 };
const cockpitView = { yaw: 0, pitch: 0 };
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousedown', (e) => {
  if (e.button === 0 && e.target.tagName === 'CANVAS') { freeView.dragging = true; freeView.lx = e.clientX; freeView.ly = e.clientY; e.preventDefault(); }
});
addEventListener('mouseup', (e) => { if (e.button === 0) freeView.dragging = false; });
addEventListener('mousemove', (e) => {
  if (!freeView.dragging) return;
  const dx = (e.clientX - freeView.lx) * 0.005;
  const dy = (e.clientY - freeView.ly) * 0.005;
  if (camMode === 'cockpit') {
    cockpitView.yaw += dx; cockpitView.pitch -= dy;
    cockpitView.pitch = Math.max(-0.9, Math.min(0.9, cockpitView.pitch));
  } else {
    freeView.yaw -= dx; freeView.pitch -= dy;
    freeView.pitch = Math.max(-1.4, Math.min(1.4, freeView.pitch));
  }
  freeView.lx = e.clientX; freeView.ly = e.clientY;
});
addEventListener('wheel', (e) => {
  if (camMode !== 'cockpit') {
    freeView.dist *= e.deltaY > 0 ? 1.08 : 0.92;
    freeView.dist = Math.max(0.3, Math.min(4, freeView.dist));
  }
}, { passive: true });

const fwd = new THREE.Vector3();
function updateCamera(dt) {
  const obs = new THREE.Quaternion().setFromEuler(new THREE.Euler(freeView.pitch, freeView.yaw, 0, 'YXZ'));
  if (camMode === 'cockpit') {
    const off = new THREE.Vector3(cockpit.x, cockpit.y, cockpit.z).applyQuaternion(root.quaternion).add(root.position);
    camera.position.copy(off);
    const lookDir = getForward();
    const cobs = new THREE.Quaternion().setFromEuler(new THREE.Euler(cockpitView.pitch, cockpitView.yaw, 0, 'YXZ'));
    lookDir.applyQuaternion(cobs).multiplyScalar(cockpit.dist).add(off);
    camera.lookAt(lookDir);
  } else {
    const baseOff = camOffsets.chase.clone().multiplyScalar(freeView.dist);
    const off = baseOff.applyQuaternion(obs).applyQuaternion(root.quaternion).add(root.position);
    camera.position.lerp(off, 1 - Math.exp(-dt * 6));
    fwd.copy(getForward()).multiplyScalar(8).add(root.position);
    camera.lookAt(fwd);
  }
}

// ---------- 准星（投影机头前方瞄准点到屏幕，与 main.js 逻辑一致）----------
const _aimP = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _upOff = new THREE.Vector3();
function updateCrosshair() {
  const cross = document.getElementById('crosshair');
  if (!cross) return;
  _aimP.set(0, 0, -aim.dist).applyQuaternion(root.quaternion).add(root.position);
  if (camMode === 'cockpit') {
    _upOff.set(0, 1, 0).applyQuaternion(root.quaternion).multiplyScalar(aim.dist * aim.cockpitLift);
    _aimP.add(_upOff);
  }
  _proj.copy(_aimP).project(camera);
  if (_proj.z > 1 || _proj.z < -1) { cross.style.display = 'none'; return; }
  cross.style.display = '';
  cross.style.left = ((_proj.x * 0.5 + 0.5) * innerWidth) + 'px';
  cross.style.top = ((-_proj.y * 0.5 + 0.5) * innerHeight) + 'px';
}

// ---------- 主循环 ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mixer) mixer.update(dt);
  updateCamera(dt);
  updateCrosshair();
  renderer.render(scene, camera);
}

// ---------- UI 绑定 ----------
const $ = (id) => document.getElementById(id);
function bindSlider(rangeId, numId, onChange) {
  const r = $(rangeId), n = $(numId);
  const apply = (val) => {
    val = +val; if (Number.isNaN(val)) return;
    r.value = val; n.value = val; onChange(val); updateOutput();
  };
  r.addEventListener('input', (e) => apply(e.target.value));
  n.addEventListener('input', (e) => apply(e.target.value));
  n.addEventListener('change', (e) => apply(e.target.value));
}

// 4 枪口 × XYZ
muzzles.forEach((m, i) => {
  ['x', 'y', 'z'].forEach((c) => {
    bindSlider('mz' + i + '-' + c, 'mz' + i + '-' + c + '-n', (v) => { m[c] = v; updateMuzzles(); });
  });
});
// 准星参数
bindSlider('aim-dist', 'aim-dist-n', (v) => { aim.dist = v; });
bindSlider('aim-lift', 'aim-lift-n', (v) => { aim.cockpitLift = v; });

// 标记 / 射线显隐
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
  ['chase', 'cockpit'].forEach((k) => $('btn-cam-' + k).classList.toggle('active', k === m));
  if (m === 'cockpit') { cockpitView.yaw = 0; cockpitView.pitch = 0; }
  freeView.yaw = 0; freeView.pitch = 0; freeView.dist = 1;
}
['chase', 'cockpit'].forEach((m) => $('btn-cam-' + m).addEventListener('click', () => setCam(m)));
addEventListener('keydown', (e) => { if (e.code === 'KeyC') setCam(camMode === 'chase' ? 'cockpit' : 'chase'); });

// ---------- 参数输出 ----------
function updateOutput() {
  const lines = muzzles.map((m) => {
    const fx = m.x.toFixed(2), fy = m.y.toFixed(2), fz = m.z.toFixed(2);
    const sx = (m.x >= 0 ? ' ' : '') + fx, sz = (m.z >= 0 ? ' ' : '') + fz;
    return `  new THREE.Vector3(${sx}, ${fy}, ${sz}), // ${m.name}`;
  });
  $('out-pre').textContent =
`// 枪口位置（body frame，机头=-Z；userScale=${userScale}）
this.muzzleOffsets = [
${lines.join('\n')}
];

// 准星参数（main.js）
aimDist = ${aim.dist.toFixed(0)};
cockpitLift = ${aim.cockpitLift.toFixed(2)};`;
}
$('btn-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('out-pre').textContent).then(() => {
    $('btn-copy').textContent = '已复制 ✓';
    setTimeout(() => ($('btn-copy').textContent = '复制参数'), 1500);
  });
});

// ---------- 自适应 ----------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// 启动
loadModel().then(() => { updateMuzzles(); updateOutput(); animate(); }).catch((err) => {
  document.getElementById('loader-err').textContent = '加载失败：' + (err.message || err);
});
