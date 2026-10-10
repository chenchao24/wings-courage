# 敌机机型性能差异化方案

## Context（背景与目标）

当前 [enemy.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js) 的性能体系分两层：
- `AI_TYPE_CONFIGS`（按 AI 类型 fighter/bomber/... 注入性能）
- `TIER_CONFIGS`（normal/elite 难度乘数）
- `MODEL_CONFIGS`（按模型 URL 注入**仅外观**：朝向/缩放/枪口）

**问题**：同角色同难度下，Yak-9 / I-153 / I-16 / Bf 109 飞行性能完全一致。这与历史事实严重不符——I-153 是双翼机，最大速度仅 426 km/h（Bf 109 的 76%），但低速机动性碾压所有机型。

**目标**：
1. 新增 `MODEL_SPECS` 机型性能注册表，按模型 URL 注入飞行性能覆盖，使每种机型拥有符合历史的差异化性能
2. 接入三种新机型 Yak-1 / Yak-3 / Yak-7（含起落架隐藏 + 螺旋桨模糊盘处理）
3. 巴巴罗萨关卡第 4-6 波替换为新机型（4/5 波 → Yak-1，6 波 → Yak-3 压轴）
4. 本次只动敌机，玩家飞机保持 [aircraft.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/aircraft.js) 构造函数写死的参数（玩家机型特调方案单独讨论）

## 方案设计

### 架构

```
注入顺序（_createEnemy 中）：
  new Enemy()                          → 构造函数调默认 _applyAiConfig('fighter','normal')
  e._applyAiConfig(type, tier)         → AI_TYPE_CONFIGS × TIER_CONFIGS（类型基线）
  e.load(url)                          → 内部 _applyModelConfig(url)
                                         ├─ MODEL_CONFIGS：外观覆盖（含 hideGear 标志）
                                         └─ MODEL_SPECS：性能覆盖（读 this.aiTier 施加 tier 乘数）
                                       → super.load() 内部加载模型
                                         └─ 若 hideGear=true → _hideLandingGear()
                                       → reset()（hp = maxHp）
```

**优先级**：`MODEL_SPECS`（机型特定）> `AI_TYPE_CONFIGS`（类型基线）> 构造函数默认值。

**tier 乘数处理**：MODEL_SPECS 设的是机型基础性能值，注入时乘以 `TIER_CONFIGS[this.aiTier]` 的对应乘数（maxSpeed×maxSpeed、pitch/roll/yaw×agility、maxHp×hp），保证 elite 仍比 normal 强。

### 性能参数表（基于历史数据，街机化调整）

换算比例：玩家 `maxSpeed`（最大速度）=165 单位 = 560 km/h → **0.2945 unit/km/h**

`userScale`（外观缩放）= 3.6 × 真实最长维 / 9.92（Bf 109 翼展基准）

| 机型 | 模型 URL | 服役年份 | 历史最大速度 | maxSpeed<br>最大速度 | cruiseSpeed<br>巡航速度 | pitchMax<br>俯仰角速度上限 | rollMax<br>滚转角速度上限 | yawMax<br>偏航角速度上限 | maxHp<br>最大血量 | stallThreshold<br>失速阈值 | liftK<br>升力系数 | userScale<br>外观缩放 | 风格定位 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Bf 109 E-4**（玩家基准） | `/model/bf109_opt.glb` | 1940 | 560 km/h | 165 | 90 | 1.3 | 2.6 | 0.7 | 100 | 12 | 0.026 | — | 速度+俯冲+滚转标杆 |
| I-153 海鸥 | `/model/i153.glb` | 1939 | 426 km/h | 125 | 80 | 1.3 | 2.2 | 0.7 | 80 | 8 | 0.034 | 3.54 | 第1波教学敌，最弱 |
| I-16 小毛驴 | `/model/i16.glb` | 1936 | 440 km/h | 130 | 90 | 1.25 | 2.3 | 0.7 | 90 | 9 | 0.028 | 3.27 | 第2-3波教学敌，次弱 |
| Yak-9 | `/model/yak9.glb` | 1942 | 591 km/h | 174 | 110 | 1.45 | 2.4 | 0.7 | 100 | 11 | 0.026 | 3.52 | 备用（关卡不再使用） |
| **Yak-1** | `/model/yak1.glb` | 1940 | 580 km/h | 171 | 105 | 1.35 | 2.5 | 0.7 | 100 | 11 | 0.026 | 3.63 | 第4-5波压力敌，与玩家同期 |
| **Yak-3** | `/model/yak3.glb` | 1943 ⚠ | 655 km/h | 193 | 120 | 1.5 | 2.7 | 0.75 | 90 | 11 | 0.028 | 3.34 | 备用机型（性能最强） |
| **Yak-7** | `/model/yak7.glb` | 1942 | 590 km/h | 174 | 110 | 1.45 | 2.4 | 0.7 | 100 | 11 | 0.026 | 3.63 | 第6波压力敌 |

⚠ **历史注记**：Yak-7 实际 1942 年末服役，巴巴罗萨行动（1941.06.22）时尚未问世。本次作为第 6 波压力敌机使用，后续若做严谨历史关卡可替换为 Yak-1。

**游戏性调整说明**（从历史严格值向教学体验倾斜）：
- 玩家 `rollMax`=2.6 为标杆，**I-153/I-16 滚转均降到 2.6 以下**（2.2/2.3），让玩家容易咬尾、教学敌机更容易打
- I-153/I-16 的 `pitchMax` 也压到玩家之下或持平（1.3/1.25 vs 玩家 1.3），整体机动弱于玩家
- I-153 保留双翼机特色：低失速阈值（8）+ 高升力系数（0.034），仍能低速贴地飞行
- **Yak-1**（第4-5波）：与玩家 Bf 109 E-4 同时期，性能接近略强（171 vs 165），开始给玩家压力
- **Yak-7**（第6波）：与 Yak-9 性能一致（174 vs 165），作为第 6 波压力敌机
- **Yak-3**：性能最强（193 vs 165，pitch 1.5 vs 1.3，roll 2.7 vs 2.6），备用机型，本次关卡不使用
- **Yak-9**：保留注册表配置，本次关卡不再出现，作为后续关卡备用

**响应速度同步调整**（`pitchResp` 俯仰响应 / `rollResp` 滚转响应 / `yawResp` 偏航响应，与对应 Max 同方向微调，保证手感连贯）：
- Bf 109 E-4（玩家基准，当前值）：`pitchResp` 6.0 / `rollResp` 7.0 / `yawResp` 4.0
- I-153：`pitchResp` 5.5 / `rollResp` 6.5 / `yawResp` 4.0（教学敌机响应略迟钝）
- I-16：`pitchResp` 5.0 / `rollResp` 6.0 / `yawResp` 3.5（教学敌机响应略迟钝）
- Yak-9：`pitchResp` 5.5 / `rollResp` 5.5 / `yawResp` 3.5
- **Yak-1**：`pitchResp` 5.5 / `rollResp` 6.0 / `yawResp` 3.5
- **Yak-3**：`pitchResp` 6.0 / `rollResp` 6.5 / `yawResp` 4.0（Boss 级响应灵敏）
- **Yak-7**：`pitchResp` 5.5 / `rollResp` 5.5 / `yawResp` 3.5

**关于玩家飞机**：本次**不注入** `MODEL_SPECS`，Bf 109 E-4 性能继续写在 [aircraft.js:87-143](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/aircraft.js#L87-L143) 构造函数中。表中的玩家行仅作对比基准，方便后续讨论玩家机型特调方案时参考。玩家机型特调注册表（支持多机型特调）单独讨论。

## 实现步骤

### 1. 扩展 `MODEL_CONFIGS` 注册表（[enemy.js:33-55](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js#L33-L55)）

追加 Yak-1 / Yak-3 / Yak-7 三机型配置。`hideGear: true` 触发起落架隐藏逻辑（仅 yak1/yak3 需要）。

```js
// Yak-1（1940 苏联主力，与 Bf 109 E-4 同期）
'/model/yak1.glb': {
  autoOrient: true,
  userScale: 3.63,     // 10.0/9.92 * 3.6
  hideGear: true,      // 模型带展开起落架，需隐藏
},
// Yak-3（1943 轻量化高机动，第6波 Boss）
'/model/yak3.glb': {
  autoOrient: true,
  userScale: 3.34,     // 9.2/9.92 * 3.6
  hideGear: true,
},
// Yak-7（1942，备用机型，模型自带模糊盘类似 Yak-9）
'/model/yak7.glb': {
  autoOrient: true,
  userScale: 3.63,     // 10.0/9.92 * 3.6
},
```

**注**：`autoOrient: true` 让模型按螺旋桨节点质心自动对齐 -Z。若 Playwright 验证发现朝向偏，再用 [tune_enemy.html](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/tune_enemy.html) 调出 yawOffset 改为手动偏航（参考 Yak-9 的 -139° 处理）。

### 2. 扩展 `_applyModelConfig`（[enemy.js:234-243](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js#L234-L243)）

在原有外观注入后追加 `hideGear` 标志读取 + `_applyModelSpecs(url)` 调用：

```js
_applyModelConfig(url) {
  const cfg = MODEL_CONFIGS[url];
  if (cfg) {
    if (cfg.autoOrient  !== undefined) this.autoOrient  = cfg.autoOrient;
    if (cfg.yawOffset   !== undefined) this.yawOffset   = cfg.yawOffset;
    if (cfg.pitchOffset !== undefined) this.pitchOffset = cfg.pitchOffset;
    if (cfg.rollOffset  !== undefined) this.rollOffset  = cfg.rollOffset;
    if (cfg.userScale   !== undefined) this.userScale   = cfg.userScale;
    if (cfg.muzzleOffsets) this.muzzleOffsets = cfg.muzzleOffsets.map((v) => v.clone());
    if (cfg.hideGear    !== undefined) this._hideGear  = cfg.hideGear;  // 新增
  }
  this._applyModelSpecs(url);  // 新增性能覆盖
}
```

### 3. 新增起落架隐藏逻辑（[aircraft.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/aircraft.js)）

**背景**：现有代码仅通过 `classifyClip` 把起落架动画分类为 'skip' 不播放，但模型 mesh 本身仍可见。yak1/yak3 模型起落架是展开状态，需要隐藏 mesh。

在 `Aircraft` 基类新增 `_hideGear` 标志（默认 false）和 `_hideLandingGear()` 方法：

```js
// Aircraft 构造函数追加（约 L100 附近）
this._hideGear = false;  // 模型加载后是否隐藏起落架 mesh

/** 隐藏起落架 mesh（按 GEAR_KEYWORDS 节点名识别）。仅 _hideGear=true 时调用。 */
_hideLandingGear() {
  this.model.traverse((o) => {
    if (!o.name) return;
    const n = String(o.name).toLowerCase();
    if (GEAR_KEYWORDS.some((k) => n.includes(k))) {
      o.visible = false;
    }
  });
}
```

在 `Aircraft.load()` 内 `_setupControlSurfaces()` 之后调用（[aircraft.js:209-211](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/aircraft.js#L209-L211)）：

```js
this._setupAnimations(gltf.animations);
this._setupControlSurfaces();
if (this._hideGear) this._hideLandingGear();  // 新增
```

**注**：玩家 Bf 109 不设 `_hideGear`，起落架保持模型默认状态（飞行姿态收起）。

### 4. 螺旋桨模糊盘处理

现有逻辑（[aircraft.js:422-461](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/aircraft.js#L422-L461)）默认 `propMode='blur'`：
- 若模型有 `Prop_Set` 节点且含 blur 子分支 → 显示模糊盘
- 若模型无 `Prop_Set` 但有命名含 'blur' 的螺旋桨节点 → 退化分支识别为 blur
- 若模型螺旋桨是纯静态 mesh（无 blur 节点）→ blur 分支为空，propMode='blur' 会隐藏 anim 分支导致螺旋桨不可见

**Yak-1 / Yak-3 处理策略**：先假设模型自带模糊盘节点（如 I-153/I-16 模式），用 `propMode='blur'` 默认显示。
- 若 Playwright 验证发现螺旋桨不可见 → 补 `_createPropBlurDisc()` 手动创建 canvas 纹理 Sprite 作为模糊盘
- 若螺旋桨可见但旋转效果不对 → 调 `propMultiplier` 或改 `propMode='auto'`

**Yak-7**：用户确认自带模糊盘，无需特殊处理。

### 5. 新增 `MODEL_SPECS` 性能注册表（[enemy.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js)）

位置：在 `MODEL_CONFIGS` 定义之后（约 L55 后）。

```js
/**
 * 机型性能注册表：按模型 URL 注入飞行性能覆盖（在 _applyModelConfig 中应用）。
 * - 设的是机型基础值，注入时乘以 TIER_CONFIGS[this.aiTier] 对应乘数。
 * - 未列出的机型沿用 AI_TYPE_CONFIGS 基线。
 * - 玩家飞机不走此注册表（本次不动玩家）。
 *
 * 真实数据（1941 巴巴罗萨）：
 *   Bf 109 E-4(560) | I-153(426) | I-16(440) | Yak-1(580) | Yak-3(655) | Yak-7(590) | Yak-9(591)
 * 换算：0.2945 unit/km/h，玩家 165=560km/h 为基准
 */
const MODEL_SPECS = {
  // ---- 教学敌机（第1-3波）----
  '/model/i153.glb': {
    maxSpeed: 125, cruiseSpeed: 80, maxHp: 80,
    pitchMax: 1.3, pitchResp: 5.5,
    rollMax: 2.2, rollResp: 6.5,
    yawMax: 0.7, yawResp: 4.0,
    stallThreshold: 8, liftK: 0.034,
  },
  '/model/i16.glb': {
    maxSpeed: 130, cruiseSpeed: 90, maxHp: 90,
    pitchMax: 1.25, pitchResp: 5.0,
    rollMax: 2.3, rollResp: 6.0,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 9, liftK: 0.028,
  },
  // ---- 压力敌机（第4-5波）----
  '/model/yak1.glb': {
    maxSpeed: 171, cruiseSpeed: 105, maxHp: 100,
    pitchMax: 1.35, pitchResp: 5.5,
    rollMax: 2.5, rollResp: 6.0,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 11,
  },
  // ---- 压力敌机（第6波）----
  '/model/yak7.glb': {
    maxSpeed: 174, cruiseSpeed: 110, maxHp: 100,
    pitchMax: 1.45, pitchResp: 5.5,
    rollMax: 2.4, rollResp: 5.5,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 11,
  },
  // ---- 备用机型（性能最强，本次关卡不使用）----
  '/model/yak3.glb': {
    maxSpeed: 193, cruiseSpeed: 120, maxHp: 90,
    pitchMax: 1.5, pitchResp: 6.0,
    rollMax: 2.7, rollResp: 6.5,
    yawMax: 0.75, yawResp: 4.0,
    stallThreshold: 11, liftK: 0.028,
  },
  '/model/yak9.glb': {
    maxSpeed: 174, cruiseSpeed: 110, maxHp: 100,
    pitchMax: 1.45, pitchResp: 5.5,
    rollMax: 2.4, rollResp: 5.5,
    yawMax: 0.7, yawResp: 3.5,
    stallThreshold: 11,
  },
};

/**
 * 按模型 URL 注入性能覆盖。读 this.aiTier（已由 _applyAiConfig 设置）施加 tier 乘数。
 */
_applyModelSpecs(url) {
  const specs = MODEL_SPECS[url];
  if (!specs) return;
  const tier = this.aiTier || 'normal';
  const tierCfg = TIER_CONFIGS[tier] || TIER_CONFIGS.normal;

  if (specs.maxSpeed     !== undefined) this.maxSpeed     = specs.maxSpeed * tierCfg.maxSpeed;
  if (specs.cruiseSpeed  !== undefined) this.cruiseSpeed  = specs.cruiseSpeed;
  if (specs.maxHp        !== undefined) this.maxHp        = Math.round(specs.maxHp * tierCfg.hp);
  if (specs.pitchMax     !== undefined) this.pitchMax     = specs.pitchMax * tierCfg.agility;
  if (specs.pitchResp    !== undefined) this.pitchResp    = specs.pitchResp * tierCfg.agility;
  if (specs.rollMax      !== undefined) this.rollMax      = specs.rollMax * tierCfg.agility;
  if (specs.rollResp     !== undefined) this.rollResp     = specs.rollResp * tierCfg.agility;
  if (specs.yawMax       !== undefined) this.yawMax       = specs.yawMax * tierCfg.agility;
  if (specs.yawResp      !== undefined) this.yawResp      = specs.yawResp * tierCfg.agility;
  if (specs.stallThreshold !== undefined) this.stallThreshold = specs.stallThreshold;
  if (specs.liftK        !== undefined) this.liftK        = specs.liftK;
}
```

### 6. 修改巴巴罗萨关卡 waves（[level_02_barbarossa.js:26-33](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/config/levels/level_02_barbarossa.js#L26-L33)）

第 4-6 波替换为新机型：

```js
waves: [
  { formation: 'solo', count: 1, entry: 'NW', label: '西北方向单机', model: '/model/i153.glb' }, // 第1波 I-153
  { formation: 'solo', count: 1, entry: 'E',  label: '东方单机',     model: '/model/i16.glb' },  // 第2波 I-16
  { formation: 'pair', count: 2, entry: 'S',  label: '南方双机编队', model: '/model/i16.glb' },  // 第3波 I-16
  { formation: 'solo', count: 1, entry: 'W',  label: '西方单机', model: '/model/yak1.glb' },     // 第4波 Yak-1（替换默认）
  { formation: 'pair', count: 2, entry: 'N',  label: '北方双机编队', model: '/model/yak1.glb' }, // 第5波 Yak-1（替换默认）
  { formation: 'pair', count: 2, entry: 'SE', label: '东南双机编队', model: '/model/yak7.glb' }, // 第6波 Yak-7（替换默认）
],
```

**难度建议**（可选，未强制）：第 6 波 Yak-7 可加 `tier: 'elite'` 提升压力。当前关卡 waves 未设 tier，默认 normal；如需加可在第 6 波对象追加 `tier: 'elite'`。

### 7. 不需要改动的地方

- [WaveDirector.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/game/WaveDirector.js)：`_createEnemy` 调用顺序天然支持（先 `_applyAiConfig` 再 `load`）
- [GameRuntime.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/game/GameRuntime.js)：玩家飞机路径不动

## 影响范围

改动 3 个文件：

1. [js/enemy.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js)
   - `MODEL_CONFIGS` 追加 3 机型配置（约 15 行）
   - 新增 `MODEL_SPECS` 常量（约 50 行）
   - 扩展 `_applyModelConfig`（追加 hideGear 读取 + 1 行调用）
   - 新增 `_applyModelSpecs` 方法（约 18 行）

2. [js/aircraft.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/aircraft.js)
   - 构造函数追加 `this._hideGear = false`（1 行）
   - `load()` 内追加 `if (this._hideGear) this._hideLandingGear()`（1 行）
   - 新增 `_hideLandingGear()` 方法（约 8 行）

3. [js/config/levels/level_02_barbarossa.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/config/levels/level_02_barbarossa.js)
   - waves 数组第 4-6 波追加 `model` 字段（3 处单行修改）

## 验证方法

### 1. 现有关卡回归（巴巴罗萨）

启动服务器 `npx http-server -p 5173 -c-1 --cors`，进入巴巴罗萨关卡：
- 第 1 波 I-153：速度明显慢于玩家（125 vs 165），滚转最弱（2.2），最易击落
- 第 2-3 波 I-16：速度略慢（130），滚转次弱（2.3），教学敌
- 第 4-5 波 Yak-1：速度略快于玩家（171 vs 165），开始有压力
- 第 6 波 Yak-7：速度略快于玩家（174 vs 165），与 Yak-9 性能相当，作为压力敌机

### 2. 起落架 + 螺旋桨视觉验证

新建 `test_shots/test_yak_models.py`，分别加载 Yak-1 / Yak-3 / Yak-7 单机模型截图验证：
- Yak-1 / Yak-3：起落架 mesh 已隐藏（无可见起落架）
- Yak-1 / Yak-3：螺旋桨显示模糊盘（若不可见 → 补 `_createPropBlurDisc()` 手动创建逻辑）
- Yak-7：螺旋桨模糊盘正常显示
- 三种机型机头朝向正确（机头对齐 -Z 飞行前方）

### 3. Playwright 性能数值验证

新建 `test_shots/test_model_specs.py`，分别截取各机型飞行中的速度/HP，验证：
- I-153 巡航速度 ≈ 80，HP=80
- Yak-1 巡航速度 ≈ 105，HP=100
- Yak-7 巡航速度 ≈ 110，HP=100
- 失速判定：I-153 低失速阈值（8）应能更慢飞行不抖动
- 坠毁/重生：reset() 后 hp = maxHp 正确同步

### 4. 现有功能回归

- 编队飞行：僚机跟随长机性能差异不影响编队（offset 是位置而非速度）
- 玩家飞机性能不受影响（未注入 MODEL_SPECS）
- 已有 Yak-9 关卡兼容（注册表保留 Yak-9 配置）

## 后续（本次不做）

- 玩家飞机机型特调注册表（单独讨论）
- 轰炸机炮塔开火（fire: null stub）
- 攻击机对地攻击跑次细化
- Yak-3 接入后续关卡（性能最强，可作为后期 Boss）
- Yak-7 历史不严谨（1942 服役 vs 1941 巴巴罗萨）——若做严谨历史关卡可替换为 Yak-1

---

## 实现更新（2026-08-04 · 与原方案的偏差）

原方案在接入 Yak-1/Yak-3 时部分假设被推翻，实际实现记录如下，供后续机型接入参考。

### 偏差 1：起落架隐藏 — 显式节点列表替代关键词匹配

**原方案**：用 `GEAR_KEYWORDS`（gear/landing/wheel/起落架/轮）关键词匹配节点名隐藏。

**实际问题**：Yak-1/Yak-3 起落架节点是泛化命名（`Line27-FACES_1`/`Cylinder28-FACES_1`/`Torus08-FACES_1` 等），关键词一个都匹配不到，隐藏逻辑完全失效。

**实际实现**（[aircraft.js _hideLandingGear](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/aircraft.js)）：
- `MODEL_CONFIGS` 追加 `hideGearNodes` 字段，显式列出全部起落架节点名（Yak-1 共 22 个、Yak-3 共 22 个）
- `_hideLandingGear()` 优先用显式列表精准匹配隐藏，退化才用 `GEAR_KEYWORDS`（向后兼容 I-153/I-16 等历史机型）
- `MODEL_CONFIGS` 中 Yak-1 / Yak-3 配置见 [enemy.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js)

**Yak-1 hideGearNodes**（22 个，用户用 tune_yak_models.html 视觉识别）：
```
Line27 Line26 Line25 Torus08 Cylinder28 Line08 Line09 Line03 Torus06
stv_gl1 stv_gl2 Line20 Line04 Line19 Line02 stv_gl04 Line24 Line23
Line22 Line21 stv_gl03 Cylinder26
```
（节点名后缀均为 `-FACES_1`）

**Yak-3 hideGearNodes**（22 个）：`Object06 Object05 stvgl01 stvgl Object04 Object03 Line45 Line44 Line43 Cylinder32 Line42 Line41 Line40 Torus09 Line26 Line21 Line27 Torus08 Cylinder28 Line24 Line22 Line25`

### 偏差 2：螺旋桨 — 固定旋转 + 半透明（替代"模糊盘假设"）

**原方案**：假设 Yak-1/Yak-3 自带模糊盘节点，`propMode='blur'` 默认显示。

**实际问题**：模型螺旋桨节点也是泛化命名（`Line16-FACES_1` 等），`PROP_KEYWORDS`（prop/螺旋桨/vint/винт...）匹配不到，`propBranches.blur` 为空 → **螺旋桨完全不可见**。

**实际实现**（[aircraft.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/aircraft.js)）：

1. `MODEL_CONFIGS.propNodes` 显式声明桨叶节点
   - Yak-1：`Line16-FACES_1, Line17-FACES_1, Line05-FACES_1`（3 片）
   - Yak-3：`Line30-FACES_1, Line29-FACES_1, Line05-FACES_1`（3 片）
2. `_applyPropNodes()`：把桨叶加入 `propBranches.blur` 并 `_applyPropMode()` 让其可见
3. `_setupPropPivot()`：算桨叶世界质心作为桨毂位置（3 片对称分布时质心≈桨毂轴心），创建 `THREE.Group` pivot 挂到 model 下，用 `Group.attach` 把 3 片桨叶 reparent 进去（保持世界变换不变），这样旋转 pivot 时 3 片桨叶绕桨毂**同步**转，而非各自绕自身原点翻滚
4. `update()` 每帧：`if (this._propPivot && !this.crashed) this._propPivot.rotateZ(PROP_SPIN * dt)`
5. 常量 `PROP_SPIN = 60`（rad/s，约 9.5 圈/s）— **固定转速不随油门**（敌机远距离观看，呈现高速模糊感即可）
6. 桨叶材质半透明 `opacity = 0.6`：高速旋转多帧视觉暂留叠加成模糊圆盘

**频闪（wagon-wheel）规避**：3 片桨叶间隔 120°，60fps 下每帧转角 = `PROP_SPIN/60`。60 rad/s → 57°/帧，接近 60° 频闪临界但半透明掩盖。**切勿提到 62.8 rad/s**（60°/帧临界点，桨叶看起来倒转/抖动）；也不要取 125.6 rad/s（120°/帧，桨叶每帧回到原位看似静止）。

**坠毁停转**：`!this.crashed` 保护，坠毁后桨叶停转（更真实，模型随后爆炸隐藏）。

**影响范围**：仅 Yak-1 / Yak-3 走此路径（配置了 `_propNodes`）。
| 机型 | 螺旋桨方案 |
|---|---|
| Bf 109（玩家） | 螺旋桨动画轨道，`propAction` 由 `mixer.update` 推进旋转 |
| I-153 / I-16 | 模型自带预制模糊盘贴图，静态显示 |
| Yak-7 | 模型自带模糊盘（未配 propNodes），静态显示 |
| **Yak-1 / Yak-3** | **`_propPivot` 固定旋转 + 半透明**（本次新增） |

### 偏差 3：自动朝向 _autoOrient 改造

**原方案**：`autoOrient=true` 时用 `PROP_KEYWORDS` 匹配螺旋桨节点算质心定机头方向。

**实际问题**：Yak-1/Yak-3 桨叶节点泛化命名，`PROP_KEYWORDS` 匹配不到 → `_autoOrient` 退化使用 `yawOffset=0` → **朝向错误**。

**实际实现**（[aircraft.js _autoOrient](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/aircraft.js)）：
- 优先用 `this._propNodes` 显式列表收集桨叶节点算质心，退化才用 `PROP_KEYWORDS`
- 算法：质心 (cx, cz) → `phi = atan2(cx, cz)` → `yawOffset = radToDeg(π - phi)`，对齐机头到 -Z（飞行前方）
- 验证：4.6 圈旋转测试 `quatChanged=true`，桨叶世界 quaternion 角度变化与 pivot 一致

### 调试与验证工具

| 工具 | 路径 | 用途 |
|---|---|---|
| 模型调整台 | [tune_yak_models.html](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/tune_yak_models.html) | 交互式 yaw/pitch/roll 滑块、参考飞机叠加（Yak-9/Bf 109）、节点显隐标记、机头方向箭头。启动挂 `window.__debug`（state/camera/controls/computeAutoOrient）供 F12 console 调试 |
| 桨叶 pivot 验证 | [test_prop_pivot.html](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/test_shots/test_prop_pivot.html) + [.py](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/test_shots/test_prop_pivot.py) | 运行时验证 pivotOk/bladeCount/reparentedOk/quatChanged |
| 朝向诊断 | [diag_yak1_orient.py](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/test_shots/diag_yak1_orient.py) | 顶视/侧视/前视截图 + 质心坐标 + 叠加参考飞机 |

### 关卡机型替换最终结果

巴巴罗萨关卡第 4-6 波最终机型（[level_02_barbarossa.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/config/levels/level_02_barbarossa.js)）：
- 第 1 波 I-153（教学，最弱）
- 第 2 波 I-16（教学）
- 第 3 波 I-16 双机（教学）
- 第 4 波 Yak-1（压力，与玩家同期）
- 第 5 波 Yak-1 双机（压力）
- 第 6 波 Yak-7 双机（压轴压力）

> **注**：第 6 波原方案是 Yak-3，用户改定为 Yak-7（Yak-3 备用，性能最强可作后期 Boss）。Yak-9 本次关卡不再出现，注册表配置保留供后续关卡。

---

## 第二关机型规划（风云不列颠）

第二关《风云不列颠》（1940 不列颠空战）机型策略已由用户明确：

| 阵营 | 机型 | 模型 URL | 状态 | 说明 |
|---|---|---|---|---|
| 玩家（德军） | Bf 109 E-4 | `/model/bf109_opt.glb` | ✅ 复用 | 与第一关相同，不改 |
| 英军（占位） | Yak-9 | `/model/yak9.glb` | ✅ 占位 | 备用机型，验证地图用 |
| 英军（主力） | 喷火 Spitfire | `/model/spitfire.glb` | ✅ 已接入 | 第二关正式英军战斗机，8×.303 A翼布局，枪口已精调 |
| 英军（迭代） | 飓风 Hurricane | 待建模 | ❌ 未接入 | 第二关辅助英军战斗机 |

### 策略

**喷火已接入并精调完成**（2026-08-07），作为第二关主力英军敌机。Yak-9 保留为备用占位机型。飓风待后续迭代。

### 喷火 / 飓风接入路径

喷火 / 飓风作为新机型接入需走本规范"实现步骤"全流程：

1. 把 `.glb` 放进 `model/` 目录
2. 在 [enemy.js MODEL_CONFIGS](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js) 加配置：
   - `autoOrient` / `userScale`（缩放公式 `3.6 × 真实最长维 / 9.92`）
   - 若起落架展开 → 加 `hideGear: true` + `hideGearNodes` 显式节点列表
   - 若螺旋桨泛化命名 → 加 `propNodes` 显式桨叶节点列表
3. 在 [enemy.js MODEL_SPECS](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js) 加性能参数（参考真实历史数据：喷火 605 km/h、飓风 547 km/h）
4. 用 [model_tuner.html](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/model_tuner.html) 通用校准台视觉校准朝向 / 缩放 / 起落架节点 / 桨叶节点 / 枪口位置（2026-08-07 起整合 4 个历史调试页面为单一工具）
5. 用 [test_prop_pivot](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/test_shots/test_prop_pivot.py) 验证桨叶旋转（若需 pivot 系统）
6. 参考 [偏差章节](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/.trae/documents/enemy_aircraft_specs.md) 的 hideGearNodes / propNodes / _autoOrient 实战流程

### 历史性能参考（供 MODEL_SPECS 填写）

| 机型 | 服役 | 最大速度 | 翼展 | 定位 |
|---|---|---|---|---|
| 喷火 Mk.I | 1938 | 605 km/h | 11.23 m | 主力制空战斗机，与 Bf 109 E-4 同级略优 |
| 飓风 Mk.I | 1937 | 547 km/h | 12.19 m | 辅助战斗机，机动好但速度略慢 |

**换算**：玩家 `maxSpeed=165` 单位 = 560 km/h → 0.2945 unit/km/h
- 喷火：`605 × 0.2945 ≈ 178`
- 飓风：`547 × 0.2945 ≈ 161`
