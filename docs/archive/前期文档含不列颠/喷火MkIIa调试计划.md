# 喷火 Mk IIa 模型调试计划

> 第二关《风云不列颠》前置任务：调试新导入的喷火模型，替代 yak9 占位。
> 模型路径：`c:\Users\CC\Desktop\gameSpace727\darkWil\model\spitfire_mk_iia.glb`（5.57MB）

---

## 一、目标

在 `js/enemy.js` 的 `MODEL_CONFIGS` + `MODEL_SPECS` 中添加喷火 Mk IIa 完整配置，使其作为第二关敌机可用：
1. **朝向校准**：autoOrient + yawOffset（按螺旋桨质心对齐 -Z）
2. **缩放**：userScale（按翼展 11.23m）
3. **螺旋桨旋转**：propNodes 标记 → _setupPropPivot 固定 60rad/s 旋转（同 yak1/yak3）
4. **枪口位置**：8 挺 .303 机枪（4左+4右机翼前缘，历史真实 A翼配置）
5. **性能参数**：MODEL_SPECS（570km/h，接近玩家略快）

喷火为英国飞机，在第二关作为**敌机**（玩家是德国 Bf 109 E-4）。

---

## 二、历史参数依据

| 参数 | 喷火 Mk IIa | 玩家 Bf 109 E-4（对比） |
|---|---|---|
| 最大速度 | 570 km/h | 560 km/h |
| 翼展 | 11.23m | 9.92m |
| 长度 | 9.12m | 8.85m |
| 武器 | 8 × .303 勃朗宁（4左+4右机翼） | 4 × 7.92mm（2机翼+2机头） |
| 螺旋桨 | 3叶 de Havilland 恒速 | 2叶 VDM |
| userScale | 3.6 × 11.23/9.92 ≈ **4.08** | 3.6（基准） |

**火力平衡设计（符合历史真实 + 游戏性）**：
- 历史真实：8 挺 .303（7.7mm）机枪，4左机翼+4右机翼前缘
- 游戏性：8 个枪口位置（视觉 8 条弹道），单发伤害略低于玩家（.303 < 7.92mm），fireRate 适配 8 挺轮射
- 总投射量约玩家 1.5 倍（8挺×小口径 vs 4挺×中口径），作为敌机给合理压力

---

## 三、调试工具改造

### 现状分析
- `tune_enemy.html` + `js/tune_enemy.js`：**有枪口调试功能**（XYZ 滑块+标记球+弹道射线+参数输出），但写死 `yak9.glb`（L142）+ 默认 4 枪口（L67-72）
- `tune_yak_models.html`：有节点列表+螺旋桨标记+模型切换，但**无枪口功能**

### 改造方案：升级 `tune_enemy.html/js`

**改动 1：`js/tune_enemy.js` 模型切换**
- L142 `loader.loadAsync('/model/yak9.glb', ...)` → 改为读 `state.currentUrl`
- 顶部加模型下拉：`spitfire_mk_iia.glb` / `yak9.glb`（参考 yak9 已知值校准）
- 顶部 topbar 加 `<select id="model-select">`

**改动 2：枪口配置按模型切换**
- 抽取 `MUZZLE_PRESETS` 字典：
  - `yak9`：现有 4 挺（右机翼/左机翼/右机头/左机头）
  - `spitfire`：8 挺 .303（右机翼外/右机翼内×2/左机翼内×2/左机翼外，按翼展分布）
- 切换模型时重建 muzzles 数组 + UI 滑块 + 标记球

**改动 3：螺旋桨节点标记 + 导出**（从 tune_yak_models 移植）
- 左侧加节点列表（按 Y 排序，checkbox 显隐）
- "标记螺旋桨"按钮 → 高亮节点 + 加入 propNodes
- 导出参数含 propNodes 数组

**改动 4：autoYaw 用 PROP_KEYWORDS**（与 aircraft.js 一致）
- L224 `if (o.name && /prop/i.test(o.name))` → 改用 PROP_KEYWORDS 数组（prop/螺旋桨/airscrew/propeller/vint/винт）
- 加"应用 propNodes 自动偏航"按钮（用显式列表算质心，同 aircraft.js _autoOrient）

---

## 四、调试流程（实施时执行）

1. 启动 `npx http-server -p 5173 -c-1 --cors`
2. 用 Playwright 打开 `http://localhost:5173/tune_enemy.html?model=spitfire`
3. 截图分析：
   - 模型加载是否成功（5.57MB）
   - 节点列表查看螺旋桨节点命名（确认 "prop" 关键词能否匹配）
   - 朝向是否正确（autoOrient 后机头对齐绿色 -Z 箭头）
4. 标记螺旋桨节点（3 片桨叶）→ 导出 propNodes
5. 调试朝向（yaw/pitch/roll 滑块，参考 Bf 109 对比）→ 导出偏移值
6. 调试 8 个枪口位置（机翼前缘 4左+4右）→ 导出 muzzleOffsets
7. 截图确认：枪口标记球对齐机翼前缘、弹道射线平行前射

---

## 五、应用配置到 enemy.js

调试完成后，在 `js/enemy.js` 的 `MODEL_CONFIGS`（L33）添加：

```js
'/model/spitfire_mk_iia.glb': {
  autoOrient: true,          // 按螺旋桨质心自动对齐（调试后确认）
  userScale: 4.08,           // 11.23/9.92 * 3.6
  // propNodes: [...],       // 调试导出的螺旋桨节点（触发 _setupPropPivot 固定旋转）
  // yawOffset: ...,         // 若 autoOrient 不准则手动
  muzzleOffsets: [
    // 调试导出的 8 个枪口（4左+4右机翼前缘）
  ],
},
```

在 `MODEL_SPECS`（L198）添加：

```js
'/model/spitfire_mk_iia.glb': {
  maxSpeed: 168,       // 570km/h × 0.2945（略快于玩家 165=560km/h）
  cruiseSpeed: 105,
  maxHp: 110,          // 喷火略耐打（机身比 Bf 109 大）
  pitchMax: 1.4, pitchResp: 5.8,   // 椭圆翼优秀机动
  rollMax: 2.7, rollResp: 6.5,     // 喷火滚转优秀
  yawMax: 0.7, yawResp: 3.5,
  stallThreshold: 11,
},
```

**火力参数**（敌机 weapons，在 Enemy 构造或 _createEnemy 适配）：
- 8 个枪口 → weapons 自动按 muzzleOffsets 数量发射
- fireRate 略降（8 挺轮射）：0.08（玩家 0.07，敌机默认 0.06）
- 单发伤害：damageMin=6, damageMax=9（.303 弱于 7.92mm，8 挺总量平衡）

---

## 六、实施顺序

1. **改造调试工具**：tune_enemy.html/js 加模型切换 + 8枪口预设 + 螺旋桨节点标记 + PROP_KEYWORDS autoYaw
2. **启动服务器 + Playwright 调试**：截图分析节点 → 标记螺旋桨 → 调朝向 → 调枪口
3. **导出参数 + 应用到 enemy.js**：MODEL_CONFIGS + MODEL_SPECS
4. **验证**：Playwright 加载喷火模型截图，确认朝向+枪口+螺旋桨旋转
5. **更新第二关配置**：level_01_britain.js 的 waves 第一波 model 改为 spitfire_mk_iia.glb

---

## 七、假设与决策

1. **喷火作为敌机**（非玩家）：第二关玩家是德国 Bf 109，喷火是英国敌机，配置入 enemy.js
2. **螺旋桨用 _setupPropPivot 固定旋转**（同 yak1/yak3）：模型螺旋桨静态，标记 propNodes 后 aircraft.js 自动处理 60rad/s 旋转 + 半透明模糊盘
3. **8 挺枪口历史真实**：4左机翼+4右机翼前缘，视觉 8 条弹道；武器参数适配平衡（.303 小口径）
4. **无需起落架处理**：用户确认模型无起落架，跳过 hideGear
5. **调试后第二关 waves 第一波改用 spitfire**：替代原 yak9 占位

---

## 八、实施记录

### 已完成（截至 2026-08-07）

| 项目 | 状态 | 说明 |
|---|---|---|
| 模型路径 | ✅ | 实际使用 `model/spitfire.glb`（非 `_mk_iia`），2.3MB 精细版（66 节点） |
| 朝向校准 | ✅ | `autoOrient: false` + `yawOffset: -124.091`（手工调，类似 yak9 处理） |
| 缩放 | ✅ | `userScale: 4.08`（11.23/9.92 × 3.6） |
| 起落架 | ✅ | `hideGear: true` + 17 个 hideGearNodes（模型导出时展开需隐藏） |
| 螺旋桨 | ✅ | 3 个 propNodes（`Cylinder78/79/77-FACES_1`）+ `propSpinSpeed: 95` + `propBlurDisc: true` |
| 枪口位置 | ✅ 精调 | 8×.303 A 翼布局，沿机翼前缘分布（见下表） |
| 性能参数 | ✅ | MODEL_SPECS 中配置（maxSpeed 168 ≈ 570km/h） |

### 枪口位置精调结果（2026-08-07）

用 `model_tuner.html` 校准台对 8 个枪口精调，旧参数集中在翼根（X ±4.80），新参数沿机翼前缘外移到翼尖（X ±12.05），符合 A 翼历史真实布局：

```js
muzzleOffsets: [
  new THREE.Vector3( 12.05, -0.30, -6.80),  // 右翼外
  new THREE.Vector3(  9.20, -0.60, -7.00),  // 右翼中外
  new THREE.Vector3(  8.40, -0.70, -7.05),  // 右翼中内
  new THREE.Vector3(  6.50, -0.90, -7.05),  // 右翼内
  new THREE.Vector3(-6.35, -0.95, -6.85),  // 左翼内
  new THREE.Vector3(-8.30, -0.75, -6.70),  // 左翼中内
  new THREE.Vector3(-9.05, -0.70, -6.65),  // 左翼中外
  new THREE.Vector3(-11.85, -0.30, -6.30),  // 左翼外
],
```

**与计划的差异**：
- 计划用 `spitfire_mk_iia.glb`（5.57MB），实际用 `spitfire.glb`（2.3MB，66 节点精细版）
- 计划 `autoOrient: true`，实际 `autoOrient: false` + 手动 yawOffset（模型导出朝向偏 124°，需手工校准）
- 起落架：计划"无需处理"，实际模型导出时起落架展开，需 `hideGear: true` + 17 节点列表

**配置位置**：`js/enemy.js` MODEL_CONFIGS['/model/spitfire.glb']（L100-130）

### 调试工具

枪口精调使用 `model_tuner.html`（通用模型预处理工具，2026-08-07 创建），Tab② 机枪炮口校准台：
- 战斗机模式：8 个枪口标记球 + 弹道射线，滑块调 XYZ
- 导出格式直接粘贴到 enemy.js MODEL_CONFIGS
- 工具与游戏共享同一套校准算法，所见即游戏渲染
