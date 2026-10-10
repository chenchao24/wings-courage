# glTF 模型缓存克隆 与 战斗对话系统 文档

> **关卡**：Britain（英吉利海峡）/ 通用
> **日期**：2026-08-06
> **涉及文件**：`js/aircraft.js`、`js/game/GameRuntime.js`、`js/game/CinematicSystem.js`、`js/config/levels/level_01_britain.js`
> **来源**：`OPTIMIZATION.md` 优化建议第 1 项（glTF 缓存克隆）+ 用户对话需求

---

## 一、glTF 模型缓存与克隆复用

### 1.1 背景与问题

`WaveDirector` 按波次刷敌机时，每架敌机都调用 `Aircraft.load(url)` 加载同一个 `.glb` 模型文件。以第 1 关为例，一波 `double-pair` 编队 4 架喷火，加上友军轰炸机编队 3 架 Ju-88、剧情编队哈通组 3 架 + Adler 组 2 架 + Falke-2 1 架，同一模型 URL 被重复加载多达十余次。

每次 `load()` 都经历：
1. **网络请求**：`fetch` / `XMLHttpRequest` 下载 `.glb` 文件（4-5MB）
2. **GLTF 解析**：二进制解析 → 场景图构建 → 材质/纹理/动画轨道反序列化
3. **DRACO / meshopt 解码**：压缩模型需调用 WASM 解码器

重复加载导致：
- 卡顿：4 架敌机同时刷怪时，4 次网络 + 解析叠加，帧率骤降
- 带宽浪费：同一文件反复下载
- 内存峰值高：多个未共享的解析中间结果同时驻留

### 1.2 方案设计

**模块级缓存 Map + SkeletonUtils.clone() 克隆复用**

```
首次 load(url):
  网络下载 → GLTF 解析 → 模板后处理（提亮/阴影）→ 存入 _gltfCache
  → cloneGltfScene(gltf.scene) → 材质深拷贝 → 实例后处理

后续 load(url):
  _gltfCache.get(url) → cloneGltfScene(gltf.scene) → 材质深拷贝 → 实例后处理
```

#### 设计要点

| 决策 | 选择 | 原因 |
|------|------|------|
| 缓存层级 | 模块级 `const _gltfCache = new Map()` | 跨实例共享，关卡 stop() 不清空，下关同模型仍命中 |
| 缓存键 | 模型 URL 字符串 | 同 URL 即同模型，简单可靠 |
| 克隆方式 | `SkeletonUtils.clone()` | 正确处理骨骼绑定 / AnimationMixer 引用，比 `scene.clone(true)` 安全 |
| 模板修改 | 仅在首次加载时做一次 | SkeletonUtils.clone() 共享材质引用，模板上的修改克隆体自动继承 |
| 材质独立化 | 克隆后逐 mesh `material.clone()` | 解决 SkeletonUtils.clone() 共享材质引用导致的修改传播问题（详见第二章） |

### 1.3 实现细节

#### 1.3.1 导入 SkeletonUtils

```js
// js/aircraft.js 顶部
import { clone as cloneGltfScene } from 'three/addons/utils/SkeletonUtils.js';
```

> **陷阱**：Three.js r160 的 `SkeletonUtils.js` 导出的是 `clone` 函数（命名导出），而非 `SkeletonUtils` 命名空间。直接 `import { SkeletonUtils }` 会报 `does not provide an export named 'SkeletonUtils'`。正确写法是 `import { clone as cloneGltfScene }`。

#### 1.3.2 模块级缓存声明

```js
// glTF 模型缓存：url → gltf（原始模板，永不修改场景图）
// 首次 load 时缓存，后续实例用 SkeletonUtils.clone() 克隆，省去重复网络/解析开销
const _gltfCache = new Map();
```

#### 1.3.3 load() 方法重写

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
    // SkeletonUtils.clone() 共享材质引用，所以只在模板上做一次，克隆体继承
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

  // 克隆场景图（每个实例独立，SkeletonUtils.clone 处理骨骼/动画绑定）
  this.model = cloneGltfScene(gltf.scene);

  // 深拷贝材质（详见第二章）
  this.model.traverse((o) => {
    if (o.isMesh && o.material) {
      if (Array.isArray(o.material)) {
        o.material = o.material.map((m) => m.clone());
      } else {
        o.material = o.material.clone();
      }
    }
  });

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

#### 1.3.4 关键时序：缓存 → 克隆 → 材质独立化 → 后处理

```
load(url)
  │
  ├─ 缓存命中？ ── 否 ──→ 网络下载 → 解析 → 模板后处理 → 存缓存
  │                │
  │                是
  │                │
  ├─ cloneGltfScene(gltf.scene)    ← 场景图克隆（骨骼/动画独立，材质共享）
  │
  ├─ material.clone() 逐 mesh      ← 材质独立化（断开共享引用）
  │
  └─ 后处理链路（_normalize / _setupPropPivot / _setupAnimations ...）
```

> **重要**：模板后处理（提亮、阴影）在缓存前做一次即可，因为 SkeletonUtils.clone() 共享材质引用，克隆体自动继承。但实例级修改（如桨叶透明度）必须在克隆后用独立材质做，否则会传播到所有克隆体。

### 1.4 性能收益

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 4 架同模型敌机加载 | 4 次网络 + 4 次解析 | 1 次网络 + 1 次解析 + 3 次克隆 |
| 网络请求 | 每架 4-5MB | 仅首架 |
| 解析开销 | 每架 full parse | 仅首架，后续克隆（微秒级） |
| 刷怪卡顿 | 明显帧率骤降 | 平滑 |

---

## 二、材质共享导致的透明 Bug 修复

### 2.1 现象

实现缓存克隆后，用户报告：**在最后一段剧情对话（敌机刷新之前），全部我方飞机变成半透明**。

具体表现：
- 剧情模式正常播放到 `splitChat3` 阶段
- 敌机尚未刷新（玩家仍在飞向 triggerZ 途中）
- 所有我方飞机（玩家、Falke-2 僚机、多林轰炸机编队）突然变为半透明
- 透明度约 0.22 左右

### 2.2 根因分析

#### 2.2.1 SkeletonUtils.clone() 的材质共享机制

Three.js 的 `SkeletonUtils.clone()` 在克隆场景图时，**故意共享材质引用**——多个克隆体指向同一个 `Material` 对象。这是一种优化：相同外观的物体不需要复制材质数据。

```
_gltfCache.get(url).scene
  └─ Mesh A (material: Mat_原)
  └─ Mesh B (material: Mat_桨叶)  ← 桨叶 mesh

克隆体1 = cloneGltfScene(scene)
  └─ Mesh A' (material: Mat_原)     ← 共享引用！
  └─ Mesh B' (material: Mat_桨叶)   ← 共享引用！

克隆体2 = cloneGltfScene(scene)
  └─ Mesh A'' (material: Mat_原)    ← 共享引用！
  └─ Mesh B'' (material: Mat_桨叶)  ← 共享引用！
```

#### 2.2.2 _setupPropPivot 修改桨叶材质

`Aircraft._setupPropPivot()` 在设置螺旋桨模糊盘状态时，会修改桨叶 mesh 的材质属性：

```js
// propMode = 'blur' 时，桨叶材质设为半透明模糊盘
mat.transparent = true;
mat.opacity = 0.22;  // ← 问题根源
```

#### 2.2.3 修改传播链

由于材质引用共享，修改任何一个克隆体的桨叶材质，会**同步影响所有克隆体**：

```
克隆体1._setupPropPivot()
  → Mat_桨叶.transparent = true
  → Mat_桨叶.opacity = 0.22
  → 克隆体2 的桨叶 Mesh B'' 也引用 Mat_桨叶 → 同步变透明
  → 克隆体3 同理
```

更严重的是，部分模型的桨叶 mesh 与机身 mesh **共享同一个材质**（GLTF 导出时未拆分），导致整个飞机都变透明。

#### 2.2.4 为什么"敌机刷新前"才出现

剧情编队组（哈通/Adler/Falke-2）在 `_initCinematic` 中创建，每架飞机 `load()` 后都会调 `_setupPropPivot()`。第一架飞机修改桨叶材质时，所有后续克隆体尚未创建，但缓存中的模板材质已被修改。当第二架、第三架克隆出来时，它们共享的材质已经是 `opacity=0.22` 状态。

玩家飞机和多林轰炸机编队使用不同的模型 URL（`bf109_opt.glb` 和 `ju88.glb`），但 Falke-2 和 Adler 组都用 `bf109_opt.glb`，与玩家同模型。所以 Adler 组修改桨叶材质后，玩家的飞机也变透明了。

### 2.3 修复方案

**在 `cloneGltfScene()` 之后、后处理链路之前，对每个 mesh 的材质做深拷贝：**

```js
// 克隆场景图后，深拷贝材质
this.model = cloneGltfScene(gltf.scene);

// 深拷贝材质：SkeletonUtils.clone() 共享材质引用
// 后处理链路（_setupPropPivot 等）会修改桨叶材质的 transparent/opacity
// 若不独立化，修改会传播到所有克隆体（桨叶与机身共享材质时整架飞机变透明）
this.model.traverse((o) => {
  if (o.isMesh && o.material) {
    if (Array.isArray(o.material)) {
      o.material = o.material.map((m) => m.clone());
    } else {
      o.material = o.material.clone();
    }
  }
});
```

修复后材质关系：

```
克隆体1: Mesh A' (material: Mat_原_1)  ← 独立副本
         Mesh B' (material: Mat_桨_1)  ← 独立副本

克隆体2: Mesh A'' (material: Mat_原_2) ← 独立副本
         Mesh B'' (material: Mat_桨_2) ← 独立副本

克隆体1._setupPropPivot() → Mat_桨_1.opacity = 0.22 → 不影响克隆体2 ✓
```

### 2.4 验证

修复后，剧情模式全程我方飞机保持不透明，敌机刷新后桨叶模糊盘正常显示，各实例材质修改互不影响。

---

## 三、战斗对话系统

### 3.1 需求

用户要求添加两段特定战斗对话：

**① 接敌时（敌军刚刷新，玩家接手控制后）：**

| 顺序 | 说话人 | 台词 |
|------|--------|------|
| 1 | Falke-2（僚机） | Falke-1！陌生编队高速逼近！ |
| 2 | Falke-1（玩家） | Falke队，前出！自由猎时间！ |
| 3 | Falke-2（僚机） | 收到，长官！ |
| 4 | Falke-1（玩家） | 迎面威慑射击，驱散他们的队形！ |
| 5 | Falke-2（僚机） | 跟着你。 |
| 6 | 多林（轰炸机一队长） | 各机紧密队形，机枪手准备射击！ |

**② 胜利时（击落最后一架敌机 4/4 后）：**

| 顺序 | 说话人 | 台词 |
|------|--------|------|
| 1 | Falke-1（玩家） | 击落全部敌机，Falke队重组，返航，祝你好运 去干活吧多林 |
| 2 | 多林（轰炸机一队长） | 干的好伙计，下面是我们的活了，汇合点见！ |

**附加要求：**
- 击落最后一架后关闭所有随机喊话
- 胜利对话全部播完后才显示任务胜利界面

### 3.2 技术挑战

#### 3.2.1 DialogSystem 的追加显示机制

`DialogSystem.show()` 不是替换当前对话，而是**追加显示**（最多 3 条同屏）。如果连续快速调用 `show()`，多条对话会同时堆叠在屏幕上，而非逐句播放。

因此需要一个**对话队列**机制：逐句入队，等上一句的 `duration` 到期后再播下一句。

#### 3.2.2 触发时机

| 对话段 | 触发时机 | 触发位置 |
|--------|---------|---------|
| interceptChat | 玩家飞到 triggerZ 或跳过剧情 | `CinematicSystem._triggerIntercept()` / `_finishSkip()` |
| victoryChat | WaveDirector 全灭回调 | `GameRuntime._initWaveDirector` 的 `onAllClear` 回调 |

#### 3.2.3 胜利界面延迟

原逻辑在 `onAllClear` 回调中直接调用 `callbacks.onAllClear()`（显示任务胜利界面）。现在需要等胜利对话播完后才显示，即**延迟回调**。

### 3.3 对话队列机制实现

在 `GameRuntime` 中新增对话序列队列：

#### 3.3.1 状态字段（构造函数）

```js
// 对话序列队列：逐句按时长播放（接敌对话序列 / 胜利对话序列）
this._dialogQueue = [];            // 待播放对话列表 [{speaker,text,duration,avatar,role}]
this._dialogQueueTimer = 0;        // 当前句剩余时长（ms），≤0 时取下一句播放
this._victoryPending = false;      // 胜利对话播放中，队列播完后触发 callbacks.onAllClear
this._chatterDisabled = false;     // 战斗随机喊话关闭标志（击落最后一架敌机后置 true）
```

#### 3.3.2 入队方法

```js
/**
 * 对话序列队列：逐句按时长播放（接敌对话序列 / 胜利对话序列）。
 * 由 CinematicSystem._triggerIntercept / _finishSkip / onAllClear 回调通过 _queueDialogs 入队。
 * 队列播空且 _victoryPending=true 时，触发 callbacks.onAllClear（任务胜利界面）。
 */
_queueDialogs(arr) {
  if (!arr || !arr.length) return;
  for (const d of arr) {
    this._dialogQueue.push({ ...d });
  }
}
```

#### 3.3.3 队列推进（每帧调用）

```js
_updateDialogQueue(dt) {
  if (!this._dialogQueue.length) {
    // 队列空：若胜利对话播放完毕，触发任务胜利
    if (this._victoryPending) {
      this._victoryPending = false;
      if (this.callbacks.onAllClear) this.callbacks.onAllClear();
    }
    return;
  }
  // 当前句时长未到，继续等
  if (this._dialogQueueTimer > 0) {
    this._dialogQueueTimer -= dt * 1000;
    return;
  }
  // 取下一句播放
  const d = this._dialogQueue.shift();
  if (this.dialogSystem) {
    this.dialogSystem.show(d.speaker, d.text, d.duration, d.avatar || 'commander', d.role);
  }
  this._dialogQueueTimer = d.duration;
}
```

**推进逻辑说明：**
1. 队列为空时：检查 `_victoryPending`，若为 true 则触发任务胜利回调
2. 队列非空且当前句未到期：递减计时器
3. 当前句到期（`_dialogQueueTimer ≤ 0`）：取出下一句调用 `dialogSystem.show()`，设置新的计时器
4. 初始状态 `_dialogQueueTimer = 0`，所以入队后第一句在**下一帧立即播放**

#### 3.3.4 在主循环中调用

```js
// GameRuntime._update 中
// 5.55 战斗随机喊话
this._updateCombatChatter(dt);

// 5.56 对话序列队列推进（接敌对话序列 / 胜利对话序列，逐句按时长播放）
this._updateDialogQueue(dt);
```

### 3.4 接敌对话（interceptChat）触发

#### 3.4.1 CinematicSystem._triggerIntercept() 修改

原逻辑只播一句 intercept 告警，新逻辑改为队列播放整段 interceptChat：

```js
/** 触发接敌：刷怪、解锁操纵、排队播放接敌对话序列 */
_triggerIntercept() {
  if (this._intercepted) return;
  this._intercepted = true;

  // 触发首波
  if (this.waveDirector && this.waveDirector.skipStartDelay) {
    this.waveDirector.skipStartDelay(0);
  }

  // Falke-2 接敌后不立即散开，待玩家首次距敌<1000m 再自由交战
  this.runtime._wingmanEngagePending = true;

  // 结束剧情：切座舱、解锁操纵（玩家接手控制）
  this._endCinematic();

  // 排队播放接敌对话序列（告警 → 玩家指令 → 僚机/轰炸机回应，逐句按时长播放）
  const chat = this.config.dialogs?.interceptChat;
  if (chat && chat.length && this.runtime._queueDialogs) {
    this.runtime._queueDialogs(chat);
  }
}
```

#### 3.4.2 跳过剧情同步处理

`_finishSkip()` 末尾同样入队 interceptChat，确保跳过剧情后也能播放接敌对话：

```js
// 结束剧情
this._skipping = false;
this._endCinematic();

// 排队播放接敌对话序列（与正常接敌一致）
const chat = this.config.dialogs?.interceptChat;
if (chat && chat.length && this.runtime._queueDialogs) {
  this.runtime._queueDialogs(chat);
}
```

> **注意**：`_endCinematic()` 先执行（解锁操纵），再入队对话。玩家接手控制后，对话在飞行中逐句播放，不阻塞操作。

### 3.5 胜利对话（victoryChat）触发

#### 3.5.1 onAllClear 回调修改

```js
onAllClear: () => {
  // 关闭战斗随机喊话
  this._chatterDisabled = true;
  // 排队播放胜利对话，播完后由 _updateDialogQueue 触发 callbacks.onAllClear（任务胜利界面）
  const victoryChat = dialogs.victoryChat;
  if (victoryChat && victoryChat.length && this.dialogSystem) {
    this._victoryPending = true;
    this._queueDialogs(victoryChat);
  } else {
    // 无胜利对话配置，直接触发任务胜利
    if (this.callbacks.onAllClear) this.callbacks.onAllClear();
  }
},
```

**关键变化：**
- 原逻辑：`onAllClear` 回调中直接 `dialogSystem.show()` 播一句 + 立即调 `callbacks.onAllClear()`
- 新逻辑：入队 victoryChat + 设 `_victoryPending = true`，**不立即调** `callbacks.onAllClear()`
- `callbacks.onAllClear()` 延迟到 `_updateDialogQueue` 检测到队列空 + `_victoryPending` 时才触发

#### 3.5.2 onEnemyKilled 回调修改

击落最后一架敌机时（`killed >= target`），关闭随机喊话并跳过随机击落台词：

```js
onEnemyKilled: (en) => {
  if (this.callbacks.onEnemyKilled) this.callbacks.onEnemyKilled(en);
  // 最后一架击落时关闭随机喊话、跳过随机击落台词（紧接胜利对话）
  if (this.waveDirector.killed >= this.waveDirector.target) {
    this._chatterDisabled = true;
    return;
  }
  if (this.dialogSystem && dialogs.onEnemyKilled) {
    const arr = dialogs.onEnemyKilled;
    const d = arr[Math.floor(Math.random() * arr.length)];
    this.dialogSystem.show(d.speaker, d.text, 5000, d.avatar || 'radio', d.role);
  }
},
```

> **时序说明**：`WaveDirector.notifyKilled()` 先递增 `killed` 再调 `onEnemyKilled` 回调，所以回调内 `this.waveDirector.killed` 已是最新值。第 4 架击落时 `killed=4, target=4`，条件成立。

#### 3.5.3 _updateCombatChatter 关闭检查

```js
_updateCombatChatter(dt) {
  if (this._chatterDisabled) return;  // 胜利阶段关闭随机喊话
  // ... 原有逻辑
}
```

### 3.6 完整时序流程

```
═══ 接敌阶段 ═══

玩家飞到 triggerZ
  ↓
CinematicSystem._triggerIntercept()
  ├─ waveDirector.skipStartDelay(0)        ← 敌机开始刷新
  ├─ _wingmanEngagePending = true
  ├─ _endCinematic()                        ← 切座舱、解锁操纵（玩家接手控制）
  └─ _queueDialogs(interceptChat)           ← 6 句对话入队
     ↓
  _updateDialogQueue 每帧推进，逐句播放：
  ① "Falke-1！陌生编队高速逼近！"          (4s)  — Falke-2
  ② "Falke队，前出！自由猎时间！"          (4s)  — Falke-1
  ③ "收到，长官！"                        (3s)  — Falke-2
  ④ "迎面威慑射击，驱散他们的队形！"       (4.5s) — Falke-1
  ⑤ "跟着你。"                           (2.5s) — Falke-2
  ⑥ "各机紧密队形，机枪手准备射击！"       (5s)  — 多林
     ↓
  队列空，_victoryPending=false → 无动作

═══ 战斗阶段 ═══

轰炸机自卫炮塔开火 → _updateCombatChatter 随机喊话（3-8s CD）
玩家击落敌机 1/4 → onEnemyKilled → 随机击落台词
玩家击落敌机 2/4 → onEnemyKilled → 随机击落台词
玩家击落敌机 3/4 → onEnemyKilled → 随机击落台词

═══ 胜利阶段 ═══

玩家击落敌机 4/4
  ↓
WaveDirector.notifyKilled() → killed=4
  ↓
onEnemyKilled 回调
  ├─ killed(4) >= target(4) → _chatterDisabled = true  ← 关闭随机喊话
  └─ return（跳过随机击落台词）
  ↓
敌机坠毁倒计时 → WaveDirector.update 检测全灭
  ↓
onWaveCleared → _releaseActive → clearing → delayAfterWave(1.5s)
  ↓
onAllClear 回调
  ├─ _chatterDisabled = true（确保关闭）
  ├─ _victoryPending = true
  └─ _queueDialogs(victoryChat)           ← 2 句胜利对话入队
     ↓
  _updateDialogQueue 逐句播放：
  ① "击落全部敌机，Falke队重组，返航..."  (6.5s) — Falke-1
  ② "干的好伙计，下面是我们的活了..."     (5.5s) — 多林
     ↓
  队列空 + _victoryPending=true
  ↓
  callbacks.onAllClear()                   ← 任务胜利界面显示
```

### 3.7 stop() 清理

`stop()` 中清理对话队列状态，防止关卡卸载后延迟回调触发：

```js
// 清理对话系统
if (this.dialogSystem) { this.dialogSystem.dispose(); this.dialogSystem = null; }
// 清理对话队列状态（防止 stop 后 _updateDialogQueue 触发延迟回调）
this._dialogQueue = [];
this._dialogQueueTimer = 0;
this._victoryPending = false;
this._chatterDisabled = false;
```

---

## 四、关卡配置变更

### 4.1 cinematic.dialogs.interceptChat（新增）

`level_01_britain.js` 的 `cinematic.dialogs` 中，原 `intercept`（单句告警）替换为 `interceptChat`（6 句序列）：

```js
// 接敌对话序列：告警 → 玩家指令 → 僚机回应 → 轰炸机下令（由 GameRuntime 对话队列逐句播放）
interceptChat: [
  { speaker: 'Falke-2',  role: '僚机',     text: 'Falke-1！陌生编队高速逼近！',      duration: 4000, avatar: 'radio' },
  { speaker: 'Falke-1',  role: '长机·你',  text: 'Falke队，前出！自由猎时间！',     duration: 4000, avatar: 'player' },
  { speaker: 'Falke-2',  role: '僚机',     text: '收到，长官！',                   duration: 3000, avatar: 'radio' },
  { speaker: 'Falke-1',  role: '长机·你',  text: '迎面威慑射击，驱散他们的队形！',   duration: 4500, avatar: 'player' },
  { speaker: 'Falke-2',  role: '僚机',     text: '跟着你。',                       duration: 2500, avatar: 'radio' },
  { speaker: '多林',     role: '轰炸机一队长', text: '各机紧密队形，机枪手准备射击！', duration: 5000, avatar: 'wingman' },
],
```

### 4.2 dialogs.victoryChat（新增）

`level_01_britain.js` 的顶层 `dialogs` 中新增 `victoryChat`：

```js
// 胜利对话序列：击落全部敌机后逐句播放，播完后才触发任务胜利界面
victoryChat: [
  { speaker: 'Falke-1', role: '长机·你',    text: '击落全部敌机，Falke队重组，返航，祝你好运 去干活吧多林', duration: 6500, avatar: 'player' },
  { speaker: '多林',    role: '轰炸机一队长', text: '干的好伙计，下面是我们的活了，汇合点见！',             duration: 5500, avatar: 'wingman' },
],
```

> 原 `dialogs.onAllClear` 配置保留未删除（向后兼容），但新逻辑不再使用它，改用 `victoryChat`。

---

## 五、修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `js/aircraft.js` | ① 导入 SkeletonUtils.clone ② 模块级 `_gltfCache` Map ③ 重写 `load()` 实现缓存+克隆 ④ 克隆后材质深拷贝 |
| `js/game/GameRuntime.js` | ① 构造函数加队列状态字段 ② 新增 `_queueDialogs()` / `_updateDialogQueue()` ③ `_update` 中调队列推进 ④ `_updateCombatChatter` 加 `_chatterDisabled` 检查 ⑤ `onAllClear` 改为队列+延迟胜利 ⑥ `onEnemyKilled` 最后一架跳过随机台词 ⑦ `stop()` 清理队列状态 |
| `js/game/CinematicSystem.js` | ① `_triggerIntercept()` 改为队列播放 interceptChat ② `_finishSkip()` 同步入队 |
| `js/config/levels/level_01_britain.js` | ① `cinematic.dialogs.intercept` → `interceptChat`（6句） ② `dialogs` 新增 `victoryChat`（2句） |

---

## 六、关键技术要点

### 6.1 SkeletonUtils.clone() 的材质共享陷阱

`SkeletonUtils.clone()` 设计目的是正确克隆骨骼动画绑定（`SkinnedMesh` 的 `skeleton` 属性），它**故意共享材质引用**以节省内存。这意味着：

- **适合**：只读场景（克隆体不改材质属性）
- **不适合**：需要独立修改材质属性的场景（如本项目的桨叶透明度）

解决方案是克隆后立即 `material.clone()` 断开引用。代价是每架飞机多一份材质内存（几十 KB 级别，可忽略）。

### 6.2 对话队列的帧驱动推进

对话队列不使用 `setTimeout`，而是由主循环 `_update(dt)` 每帧推进。优势：
- **暂停安全**：ESC 暂停时 `_running=false`，主循环停止，队列自然冻结
- **dt 一致**：与游戏逻辑用同一 `dt`，暂停恢复后无跳变
- **无回调地狱**：所有时序在 `_update` 中线性推进，调试简单

### 6.3 胜利回调的延迟触发

`_victoryPending` 标志实现"对话播完才显示胜利"：
- `onAllClear` 回调设 `_victoryPending=true` + 入队 victoryChat，**不调** `callbacks.onAllClear()`
- `_updateDialogQueue` 检测队列空 + `_victoryPending=true` 时才调 `callbacks.onAllClear()`
- `stop()` 清理 `_victoryPending=false`，防止关卡卸载后误触发

> **安全性**：`callbacks.onAllClear()` 可能触发 `stop()`，但 `_updateDialogQueue` 在调用后直接 `return`，不访问已被清理的资源，无空指针风险。

### 6.4 随机喊话的关闭时机

`_chatterDisabled` 在两个位置设置：
1. **`onEnemyKilled`**（最后一架击落时）：立即关闭，避免坠毁过程中轰炸机继续喊话
2. **`onAllClear`**（全灭回调时）：确保关闭（覆盖敌机坠毁非玩家击杀的情况）

两层保障，无论最后一架是玩家击落还是自行坠毁，随机喊话都会在胜利对话前关闭。
