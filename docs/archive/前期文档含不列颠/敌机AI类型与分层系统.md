# 敌机 AI 类型与分层系统

## Context

当前所有敌机（I-153/I-16/Yak-9）共用同一套 AI 逻辑和同一组性能参数，行为完全一致。用户需要：
1. **类型分化**：5 种机型（战斗机/轰炸机/运输机/攻击机/俯冲轰炸机）各有独特行为模式
2. **难度分层**：精英 vs 普通，在机动性和进攻性上做出差异（但不要太难）
3. **战斗机立即增强**：当前开火太少，需提升攻击性
4. **框架优先**：搭建完整框架，后续逐步填充内容（如地面目标系统）

## 设计总览

在现有 `Enemy` 类上引入"类型 × 分层"二维配置，沿用 `MODEL_CONFIGS` 的注册表 + `_applyXxxConfig` 注入模式，与模型外观配置完全解耦。

- **类型决定行为分支**：5 种类型 → 3 套行为方法（fighter / bomber-transport / attacker-diveBomber）
- **分层决定数值倍率**：normal/elite 不改变行为结构，仅乘以系数
- **combatState 状态机**仅在 fighter 类型下保留，扩展为四态：`loiter` / `formation` / `engaged` / `solo`；其他类型用各自更简单的逻辑
- **现有巴巴罗萨关卡自动兼容**：wave 省略 type/tier 字段时默认 `fighter` + `normal`；省略 `spawn`/`loiter` 时 `combatState='solo'`（原逻辑）

## fighter combatState 四态机

| 状态 | 触发条件 | 行为 | 退出条件 |
|---|---|---|---|
| `loiter` | wave 配置了 `spawn`/`loiter`，reset 时设此状态 | 飞向 loiter 点，到达后绕圈盘旋（8 巡逻点画圆，半径=loiter.radius），**不主动开火** | 玩家距离<1200m → `engaged`；无 loiter 配置 → 退化 `solo` |
| `formation` | `formation==='pair'` 编队出生 | 长机按 waypoint 巡逻，僚机跟随保持 body frame 偏移 | 玩家<500m → `_breakFormation` 切 `engaged`；长机异常 → `solo` |
| `engaged` | 散开/接敌触发 | 战斗散开：被咬尾→规避，队友被咬尾→支援，否则单机攻击 | — |
| `solo` | `formation==='solo'` 默认；或编队解散 | 单机攻击/巡逻：玩家太远→靠近，飞出中央→回中央，否则按 waypoint 巡逻 + 开火 | — |

派发入口：[`_thinkFighter()`](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js#L667-L673) 按 combatState 派发到 `_thinkLoiter`/`_thinkFormation`/`_thinkEngaged`/`_thinkSolo`。

### loiter 状态（本关专用，spawnBehavior 系统）

仅当 wave 配置了 `spawn`/`loiter` 字段时启用，由 [`setSpawnBehavior(cfg)`](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js#L390-L400) 注入（在 `load()` 前，reset 读取）。无配置时 `_spawnBehavior=null`，所有逻辑走原路径，**不影响其他关卡**。

- `reset()`：用 `spawn.{x,y,z}` 设位置，`lookAt(loiter)` 朝海方向，`combatState='loiter'`
- `_thinkLoiter()`：飞向 loiter 点（`dCenter > radius+200` 时直飞中心），到达后绕圈（缓存 8 巡逻点，半径变了才重建），玩家<1200m 切 `engaged`
- 盘旋阶段不主动开火（等待接敌）

## 关卡隔离机制（AI 不串台）

### 三层隔离架构

```
关卡配置 (level_xx.js)
  ├─ 环境参数 → environment.js 创建时重置全局状态（COAST_CONFIG/光照/天空/海洋/地形）
  └─ wave 配置 → WaveDirector._createEnemy 注入到 Enemy 实例
       ├─ spawn/loiter → _spawnBehavior（实例属性）
       ├─ type/tier    → _aiCfg（实例属性）
       └─ formation    → combatState/isLeader/wingman
```

### 关卡切换清理（[GameRuntime.stop](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/game/GameRuntime.js#L720)）

| 释放项 | 机制 |
|---|---|
| 敌机 | `waveDirector.dispose()` → `_releaseActive()` → 对每个敌机调 `_disposeAircraft` → 清空 `_activeEnemies=[]` |
| 玩家 | `_disposeAircraft(player)` |
| 教学/对话/地面目标/雷达/操控 | 各自 `dispose()` 置 null |
| 环境 | `disposeEnvironment(env)` 释放 sky/terrain/ocean/buildings |
| 全局状态 | 下次 `createEnvironment` 调 `setCoastConfig(null 或 cfg)` 重置地形模式 |

### Enemy 实例隔离

每个 `new Enemy()` 在构造函数初始化所有属性（[enemy.js:302-380](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js#L302-L380)）：

- `_spawnBehavior = null` — 本关专用出生行为，null=走原逻辑（玩家前方出生）
- `_aiCfg = null` — type/tier 配置
- `combatState = 'formation'` — 状态机
- `_loiterWp = []` — 盘旋巡逻点缓存（实例级，不共享）
- 所有 evade/fire 计时器都是实例属性

模块级临时向量（`_toP`/`_toT`/`_loiterTarget` 等）每帧 `set/copy` 重置，不持久化状态。

### 当前支持的本关独立设置

| 设置 | wave 字段 | 隔离方式 | 不配置时 |
|---|---|---|---|
| 出生点 | `spawn: {x,y,z}` | `_spawnBehavior.spawn` 实例属性 | 玩家前方 1400-1900 |
| 盘旋待敌 | `loiter: {x,z,radius,alt}` | `_spawnBehavior.loiter` + `combatState='loiter'` | `combatState='solo'` |
| AI 类型 | `type: fighter/bomber/...` | `_aiCfg` 实例属性 | `fighter` |
| 难度 | `tier: normal/elite` | `_aiCfg` 实例属性 | `normal` |
| 编队 | `formation: solo/pair` | `combatState`/`wingman`/`isLeader` | — |

**关键**：所有"本关专用行为"通过 wave 配置字段注入，无配置时走默认逻辑。巴巴罗萨关的 wave 没有 `spawn`/`loiter` 字段 → `_spawnBehavior=null` → 完全走原逻辑，不受不列颠关影响。

### 潜在改进点（当前不影响，未来扩展时注意）

1. **loiter 接敌距离写死 1200m**（[enemy.js _thinkLoiter](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js#L689)）。如果某关需要不同接敌距离，需参数化到 `loiter.engageRange`。

2. **pair 编队分支强制 `combatState='formation'`**（[WaveDirector.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/game/WaveDirector.js#L173-L174)），会覆盖 reset 设的 loiter。当前 loiter 只用于 solo，不影响；未来若 pair 也要盘旋待敌需改这分支。

3. **自定义行动脚本**（如"护航轰炸机""拦截""地面攻击脚本"）目前没有专门系统。如果某关需要复杂的多阶段行为脚本（伴飞→发现敌机→接敌→返航），需要扩展 `_spawnBehavior` 加 `behavior` 字段或引入 `_aiScript` 系统。

### 扩展模式（加新本关专用行为的推荐方式）

沿用 `setSpawnBehavior` 模式保持隔离：

1. wave 配置加新字段（如 `escort: {target, radius}`）
2. `_createEnemy` 检测字段调 `setSpawnBehavior({...escort})` 注入
3. Enemy 加新 `combatState`（如 `'escort'`）+ `_thinkEscort()` 方法
4. `_thinkFighter` 派发加 `if (combatState==='escort') return this._thinkEscort(...)`
5. 无配置时 `_spawnBehavior.escort=null`，不触发，走原逻辑

## 修改文件

### 1. `js/enemy.js` — 主要改造

#### 新增：`AI_TYPE_CONFIGS` 注册表（5 种类型完整配置）

| 类型 | maxSpeed | maxHp | 机动特点 | 火力 | 行为 |
|------|----------|-------|---------|------|------|
| fighter | 150 | 100 | 全机动（roll 2.0） | 对空开火 | 现有 combatState 三态机 |
| bomber | 100 | 220 | 极钝（roll 0.4, maxRoll=0） | 不开火 | 编队直飞，HP<20% 轻微偏航 |
| transport | 95 | 180 | 同 bomber | 不开火 | 同 bomber |
| attacker | 120 | 130 | 俯仰尚可/滚转受限 | 对地开火(stub) | 避免缠斗，低空侧滑规避 |
| diveBomber | 130 | 120 | 俯仰灵敏/滚转受限 | 对地开火(stub) | 避免缠斗，俯冲拉起规避 |

#### 新增：`TIER_CONFIGS`（normal/elite 乘数）

| 乘数 | normal | elite |
|------|--------|-------|
| agility（机动） | 1.0 | 1.15 |
| maxSpeed | 1.0 | 1.10 |
| hp | 1.0 | 1.20 |
| fireRate（冷却缩短） | 1.0 | 1.6 |
| fireCone（锥宽） | 1.0 | 1.15 |
| fireRange | 1.0 | 1.10 |
| fireBurst（连发） | 1.0 | 1.25 |
| evasionChance | 1.0 | 1.3 |

elite fighter vs 旧版对比：锥角 0.15→0.23rad，射程 500→770m，连发 0.5→1.0-1.5s，冷却 2.5-5→0.94-1.88s。

#### 新增：`_applyAiConfig(type, tier)` 方法

在 `WaveDirector._createEnemy` 中 `load(url)` 之前调用（与 `_applyModelConfig` 同时机）：
- 读取 `AI_TYPE_CONFIGS[type]` × `TIER_CONFIGS[tier]` 合成 `this._aiCfg`
- 覆盖 Aircraft 物理参数（maxSpeed/pitchMax/Resp 等）
- 覆盖 Weapons 火力参数（fireRate/damageMin/Max）
- 构造函数中给 `_aiCfg` 默认值（fighter × normal），保证未配置时退化

#### 重构：`think()` 加类型派发

```
think(dt, player)
  ├─ 撞地拉起（agl < _aiCfg.aglFloor）
  ├─ 高度上限（y > _aiCfg.patrolAltMax + 100）
  ├─ 队友死亡检测（仅 fighter）
  └─ switch (aiType)
       ├─ fighter    → _thinkFighter()（原 combatState 三派发搬入）
       ├─ bomber/transport → _thinkBomber()
       └─ attacker/diveBomber → _thinkAttacker()
```

#### 保留不动：`_thinkFormation` / `_thinkEngaged` / `_thinkSolo` / `_support` 方法体

仅将内部硬编码参数替换为读 `_aiCfg`：
- 火力：`angleOff < 0.15` → `angleOff < fc.angleOff`，`distP < 500` → `distP < fc.distMax` 等
- 规避：`Math.random() < 0.015` → `Math.random() < _aiCfg.evasionChance`
- 舵量 clamp：`clamp(..., -0.6, 0.6)` → `clamp(..., -_aiCfg.maxRoll, _aiCfg.maxRoll)`
- fighter 类型数值与现状一致，零行为变化

#### 新增行为方法

- `_thinkBomber()`：编队直飞 + HP<20% 轻微偏航 + 优先地面目标 + 不开火 + 不散开
- `_thinkAttacker()`：三子状态 `groundAttack | evasion | patrol`
  - `_attackerEvasion()`：侧滑(yaw) + 高度变化(pitch)，不桶滚
  - `_attackerGroundAttack()`：朝目标俯冲 + 对地开火(stub)
  - `_attackerPatrol()`：低空 waypoint 巡逻
- 共享辅助：`_flyToTarget()` / `_maintainThrottle()` / `_getNearestGroundTarget()`

#### 战斗机火力增强（normal tier 即生效）

| 指标 | 旧值 | 新值 |
|------|------|------|
| 触发锥角 | 0.15 rad | 0.20 rad |
| 触发距离 | 200-500m | 200-700m |
| 连发时长 | 0.5s 固定 | 0.8-1.2s |
| 冷却 | 2.5-5s | 1.5-3s |
| 期望 DPS | ~1x | ~3x |

#### takeDamage override 按类型判断

```javascript
takeDamage(d) {
  const dead = super.takeDamage(d);
  // 仅 fighter 受击散开；bomber/transport 保持编队
  if (!dead && this.aiType === 'fighter' && this.combatState === 'formation') {
    this._breakFormation();
  }
  return dead;
}
```

### 2. `js/groundTargets.js` — 新建 stub

空容器类，`getAliveTargets()` 返回空数组。AI 读取时自然回退到巡逻/规避。未来 P6 填充真实目标时 AI 零改动。

### 3. `js/game/WaveDirector.js` — 小改

`_createEnemy(wave)` 增加：
```javascript
e._applyAiConfig(wave.type || 'fighter', wave.tier || 'normal');
if (this.ctx.groundTargets) e.setGroundTargets(this.ctx.groundTargets);
```

### 4. `js/game/GameRuntime.js` — 小改

- `start()` 中创建 `GroundTargets` 实例
- `_initWaveDirector` 中传入 `groundTargets` 到 ctx
- `stop()` 中释放

### 5. `js/config/levels/level_02_barbarossa.js` — 可选

保持原样（默认 fighter/normal 自动兼容）。可选：最后两波加 `tier: 'elite'` 演示难度爬升。

## 实施顺序

1. `enemy.js` 配置层：`AI_TYPE_CONFIGS` + `TIER_CONFIGS` + `_applyAiConfig` + 构造函数默认值
2. `enemy.js` 行为层重构：`think()` 类型派发 + `_thinkFighter` 抽出 + 硬编码参数化
3. `enemy.js` 新类型方法：`_thinkBomber` / `_thinkAttacker` 及子方法
4. `groundTargets.js` stub + `Enemy.setGroundTargets` + GameRuntime 集成
5. `WaveDirector.js`：`_createEnemy` 加配置注入
6. `level_02_barbarossa.js`：保持原样或加 elite tier

## 验证方式

1. 启动本地服务器 `npx http-server -p 5173 -c-1 --cors`
2. Playwright 测试：
   - 加载关卡，验证所有敌机 `aiType='fighter'` + `aiTier='normal'`
   - 验证 `_aiCfg` 非空，火力参数正确（angleOff=0.20, distMax=700, cdMax=3.0）
   - 验证 0 控制台错误
3. 手动试玩：战斗机开火频率明显提升，elite 敌机更激进
4. 临时改某波为 `type:'bomber'` 验证轰炸机编队直飞行为
