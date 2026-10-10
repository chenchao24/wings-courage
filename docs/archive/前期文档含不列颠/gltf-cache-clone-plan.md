# glTF 缓存 + 克隆复用 实现计划

## Context

当前项目中同一 `.glb` 模型文件被反复完整加载（网络请求 + GLTF 解析 + 纹理解码）。例如 3 机 V 字编队 = 同一文件加载 3 次，刷波瞬间卡顿、内存暴涨。需要实现按 URL 缓存已解析的 glTF，后续实例用 `SkeletonUtils.clone()` 克隆场景图，省去重复网络/解析开销。

## 涉及文件

- `js/aircraft.js` — 核心修改：`Aircraft.load()` 方法（L196-232）
- `js/game/WaveDirector.js` — 调用方（L278 `e.load(modelUrl)`），无需修改
- `js/game/GameRuntime.js` — 调用方（L324 友军编队），无需修改
- `js/game/FriendlyBomber.js` — 调用方（L105 `super.load()`），无需修改
- `js/enemy.js` — 调用方（`Enemy.load()` 调 `super.load()`），无需修改

## 实现方案

### 核心思路

在 `aircraft.js` 中创建模块级缓存 Map（`url → gltf`），修改 `load()` 方法：

1. **首次加载某 URL**：`loadAsync` → 对原始 `gltf.scene` 做一次性处理（材质+阴影）→ 缓存 gltf → `SkeletonUtils.clone()` → 走后处理链路
2. **后续加载同一 URL**：从缓存取 gltf → `SkeletonUtils.clone()` → 走后处理链路

### 关键设计点

1. **原始 gltf.scene 永不修改**：首次加载也克隆，原始作为模板缓存。后续实例都从模板克隆，互不影响。

2. **材质/阴影只在模板上做一次**：当前 `load()` 的 `traverse` 修改 `roughness` 和 `castShadow`。SkeletonUtils.clone() 共享材质引用，所以这些修改只在首次加载时对模板做，克隆体继承。

3. **gltf.animations 共享**：AnimationClip 是纯数据对象，不绑定 Object3D，可安全共享。每个实例的 `_setupAnimations()` 用各自独立的 `AnimationMixer` 绑定到克隆体。

4. **后处理链路完整重跑**：每个克隆体独立执行 `_normalize()`、`_setupPropPivot()`、`_setupAnimations()` 等，确保每个实例状态独立。

### 修改代码（aircraft.js）

**步骤 1**：添加 SkeletonUtils 导入（L2 附近）

```js
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';
```

**步骤 2**：添加模块级缓存（L5 附近，常量区）

```js
const _gltfCache = new Map();  // url → gltf（原始模板，永不修改）
```

**步骤 3**：重写 `load()` 方法（L196-232）

```js
async load(url, onProgress) {
  let gltf;

  if (_gltfCache.has(url)) {
    // 缓存命中：跳过网络/解析，直接克隆
    gltf = _gltfCache.get(url);
  } else {
    // 首次加载：网络请求 + GLTF 解析
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/');
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);

    gltf = await loader.loadAsync(url, (e) => onProgress && onProgress(e));

    // 对原始模板做一次性处理（材质提亮 + 阴影设置）
    // SkeletonUtils.clone() 共享材质引用，所以只在模板上做一次即可
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
            if (m.roughness !== undefined) m.roughness = Math.min(1, m.roughness + 0.05);
          });
        }
      }
    });

    _gltfCache.set(url, gltf);
  }

  // 克隆场景图（每个实例独立， SkeletonUtils 处理骨骼/动画绑定）
  this.model = SkeletonUtils.clone(gltf.scene);

  // 后处理链路（每个实例独立执行）
  this._normalize();
  this.modelYaw.add(this.model);
  this._autoOrient();
  this._addMuzzleHelpers();
  this._setupAnimations(gltf.animations);
  this._setupControlSurfaces();
  if (this._hideGear) this._hideLandingGear();
  this._applyPropNodes();

  return gltf;
}
```

### 调用方无需修改

`WaveDirector._createEnemy()`、`GameRuntime._createFriendlyBomber()`、`Enemy.load()`、`FriendlyBomber.load()` 都调用 `Aircraft.load(url)`，接口签名不变（`url, onProgress` 参数不变），向后兼容。

## 验证方法

1. 启动本地服务器，进入 Britain 关卡
2. 观察刷波时是否卡顿减轻（多架敌机加载同一模型时应有明显改善）
3. 检查敌机/友军模型是否正常显示（外观、动画、阴影）
4. 检查螺旋桨动画是否正常（`_setupPropPivot` 对克隆体执行）
5. 检查枪口位置是否正确（`_addMuzzleHelpers` 对克隆体执行）
6. 打开 DevTools Network 面板，确认同一 .glb 文件只请求一次
7. 多次进出关卡，确认无内存泄漏或累积问题
