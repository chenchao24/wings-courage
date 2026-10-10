# 敌机 AI 逻辑详解

> 本文档完整描述敌机截击逻辑（单机/双机编队）、AI 类型参数、状态机流转，
> 供参数调优和行为修改参考。代码位置：[enemy.js](../../js/enemy.js)、[WaveDirector.js](../../js/game/WaveDirector.js)。

---

## 一、AI 类型与分层

敌机由 `aiType`（类型）× `aiTier`（难度分层）合成最终配置 `_aiCfg`，
在 `_applyAiConfig` 中注入。代码位置：[enemy.js AI_TYPE_CONFIGS L171](../../js/enemy.js#L171)。

### 1.1 fighter（战斗机）参数

| 参数 | 值 | 说明 |
|---|---|---|
| maxSpeed | 150 | 最大速度（单位/秒） |
| cruiseSpeed | 80 | 巡航速度 |
| maxHp | 100 | 血量 |
| pitchMax / pitchResp | 1.0 / 5.0 | 俯仰响应速率 / 回正速率 |
| rollMax / rollResp | 2.0 / 6.0 | 滚转响应速率 / 回正速率 |
| yawMax / yawResp | 0.6 / 3.5 | 偏航响应速率 / 回正速率 |
| maxRoll / maxPitch / maxYaw | 0.7 / 0.6 / 0.25 | 舵量上限（行为方法读取） |
| fire.angleOff | 0.20 rad (≈11°) | 开火锥宽 |
| fire.distMin / distMax | 200 / 700 m | 开火距离区间 |
| fire.burstMin / burstMax | 0.8 / 1.2 s | 连发时长 |
| fire.cdMin / cdMax | 1.5 / 3.0 s | 开火冷却 |
| supportFire.angleOff | 0.25 rad (≈14°) | 支援开火锥宽（更宽） |
| supportFire.distMin / distMax | 200 / 800 m | 支援开火距离 |
| supportFire.burstMin / burstMax | 0.8 / 1.0 s | 支援连发时长 |
| supportFire.cdMin / cdMax | 1.0 / 2.5 s | 支援开火冷却 |
| patrolAltMin / patrolAltMax | 600 / 900 m | 巡逻高度区间 |
| aglFloor | 200 m | 撞地拉起阈值 |
| evasionChance | （由 tier 控制） | 被咬尾时规避概率 |
| evasionCdMin / evasionCdMax | （由 tier 控制） | 规避冷却区间 |

### 1.2 难度分层（tier）

| 分层 | evasionChance | evasionCdMin/Max | 说明 |
|---|---|---|---|
| normal | 0.20 | 8 / 14 | 规避概率低，冷却长 |
| elite | 0.35 | 6 / 10 | 规避更积极，冷却更短 |

### 1.3 其他类型（ bomber / transport / attacker / diveBomber ）

- **bomber**（He 111/Ju 88）：maxSpeed 95、cruiseSpeed 55、maxHp 260、机动性极差、自带机身炮塔
- **transport**：与 bomber 相同，无火力
- **attacker**：低空规避或左右摇摆，有 groundFire（对地开火）
- **diveBomber**：与 attacker 相同行为

---

## 二、战斗机 AI 状态机（combatState 四态）

代码位置：[_thinkFighter L808](../../js/enemy.js#L808)。

```
                  玩家接近 < 1200m
    loiter ────────────────────────► engaged
      │                                │
      │ 飞向 loiter 点                  │ 被咬尾 → 规避
      │ 到达后绕圈盘旋                  │ 队友被咬尾 → _support 包抄
      │                                │ 否则 → _thinkSolo 攻击
      │                                │
      │ 玩家远离                        │ 队友被击落
      ◄──────────────────────────────│
                                       ▼
                                     solo（单机攻击/巡逻）
```

### 2.1 loiter（盘旋待敌）

代码：[_thinkLoiter L820](../../js/enemy.js#L820)。

**触发条件**：本关 wave 配置含 `loiter` 字段时，reset 设置 `combatState='loiter'`。

**行为**：
1. 飞向 `loiter` 点（如海边 z=-4500）
2. 到达盘旋区（距离中心 < radius+200）→ 绕 8 边形巡逻路径盘旋
3. **玩家接近 < 1200m → 切 `engaged`**
4. 盘旋阶段不开火

**本关配置**：
```js
loiter: { x: 0, z: -4500, radius: 700, alt: 2200 }
// 盘旋点：海边，半径 700m，高度 2200m
```

### 2.2 formation（编队飞行）

代码：[_thinkFormation L874](../../js/enemy.js#L874)。

**触发条件**：双机编队（`formation: 'pair'`）创建时设置 `combatState='formation'`。

**长机行为**：
- 按 8 边形 waypoint 绕原点巡逻（半径 850，高度 600-850 起伏）
- 飞离中央 > 1300m → 飞回中央
- 不攻击，保持编队

**僚机行为**：
- 跟随长机保持 body frame 偏移：`formationOffset = (40, -10, 30)`（右40/下10/后30）
- 目标点 = 长机位置 + 长机朝向 × 偏移
- 舵量比长机略大（distT 系数 0.4/0.6/0.8 vs 0.35/0.5/0.7）

**散开条件**：玩家距离 < 500m → `_breakFormation()`，双方切 `engaged`

### 2.3 engaged（战斗散开）

代码：[_thinkEngaged L931](../../js/enemy.js#L931)。

**优先级**：
1. **被咬尾规避**（最高）：玩家在身后（`_local.z > 0`）且 < 350m
   - 概率 evasionChance × 1.3（engaged 状态更积极）
   - 规避动作：roll=±0.9 + pitch=0.6 + 油门全开，持续 1.2-2s
   - 冷却 5-9s
2. **队友支援**：僚机被玩家咬尾（玩家在僚机身后 400m 内）
   - 调用 `_support` 从 4 方向包抄：rear（后方300m）/ top（上方200m）/ left（左侧250m）/ right（右侧250m）
   - 每 4s 重选方向
   - 到达支援点附近且玩家在窄锥内 → 开火（supportFire 参数）
3. **单机攻击**：以上都不满足 → 转入 `_thinkSolo`

### 2.4 solo（单机攻击/巡逻）

代码：[_thinkSolo L1047](../../js/enemy.js#L1047)。

**目标选择**：
- 玩家距离 > 1500m → 追玩家
- 飞离中央 > 1300m → 回中央
- 否则 → 按 8 边形 waypoint 巡逻

**规避**：被咬尾且 < 350m → 滚转拉起（概率 evasionChance，冷却 evasionCdMin/Max）

**开火逻辑**（[L1102-L1118](../../js/enemy.js#L1102)）：
1. 玩家在机头前方（`_local.z < 0`）
2. 距离 200-700m
3. 机头朝向偏差 < 11°（angleOff < fire.angleOff）
4. → 连发 0.8-1.2s，冷却 1.5-3s

---

## 三、双机编队截击流程（pair）

代码：[WaveDirector.js L185-L199](../../js/game/WaveDirector.js#L185)。

### 3.1 编队创建

```
长机(isLeader=true) ←—wingman—→ 僚机(isLeader=false)
  combatState='formation'           combatState='formation'
```

- 长机 `wingman = 僚机`（_thinkEngaged 据此判断支援）
- 僚机 `wingman = 长机`（_thinkFormation 据此跟随）
- 僚机定位：长机位置 + 长机朝向 × formationOffset(40,-10,30)

### 3.2 截击流程

```
1. 编队巡航
   长机：按 waypoint 巡逻（不攻击）
   僚机：跟随保持偏移

2. 玩家靠近 < 500m
   → _breakFormation() 散开
   → 双方切 engaged

3. engaged 散开战斗
   被咬尾 → 规避
   队友被咬尾 → _support 包抄射击
   否则 → solo 攻击

4. 队友被击落
   → _think 检测 wingman._exploded
   → 切 solo
```

---

## 四、单机截击流程（solo）

代码：[WaveDirector.js L200-L207](../../js/game/WaveDirector.js#L200)。

### 4.1 创建

- `isLeader = false`
- 无 `wingman` 引用
- 若无 `_spawnBehavior` 和 `_route` → `combatState = 'solo'`
- 若有 `loiter` 配置 → `combatState = 'loiter'`（本关喷火走此路径）

### 4.2 本关喷火实际流程

```
出生 (z=-8000, y=2200)
  ↓ combatState='loiter'
飞向海边 loiter 点 (z=-4500)
  ↓ 到达后绕圈盘旋（半径 700m）
  ↓ 玩家接近 < 1200m
切 engaged
  ↓
被咬尾 → 规避
否则 → solo 攻击（追玩家/巡逻/开火）
  ↓
被击落 或 玩家被击落
结束
```

---

## 五、飞行控制逻辑

所有状态最终都调用 `_flyToTarget` 或内联舵量计算，代码：[L1351](../../js/enemy.js#L1351)。

### 5.1 舵量计算（通用模式）

```js
// 目标方向转机身局部坐标
_invQ.copy(this.root.quaternion).invert();
_localT.copy(_toT).applyQuaternion(_invQ);

// 舵量 = 局部偏差 / 距离系数，钳制到 maxRoll/Pitch/Yaw
input.pitch = clamp(_localT.y / max(80, distT * 0.35), -maxPitch, maxPitch);
input.roll  = clamp(-_localT.x / max(80, distT * 0.5), -maxRoll, maxRoll);
input.yaw   = clamp(-_localT.x / max(120, distT * 0.7), -maxYaw, maxYaw);
```

- `pitch`：目标在上方 → 正值（抬头）
- `roll`：目标在右侧 → 负值（右滚转向）
- `yaw`：目标在右侧 → 负值（右偏航）

### 5.2 油门控制

`_maintainThrottle`（[L1361](../../js/enemy.js#L1361)）：维持速度在 cruiseSpeed 附近，被咬尾时 `throttleUp=true` 加速脱离。

---

## 六、轰炸机/运输机 AI（bomber/transport）

代码：[_thinkBomber L1134](../../js/enemy.js#L1134)。

### 6.1 航线直飞模式（本关友军轰炸机走此路径，但友军已改用 FriendlyBomber 独立类）

1. 按 `_route` 航点顺序飞越
2. 到达航点 < 250m → 切下一个
3. 最后一个航点到达 → `_despawnRequested = true`（脱离消失）
4. 平飞不盘旋、不追玩家，仅俯仰/偏航微调保持航向

### 6.2 编队巡逻模式（无 _route 时）

- 长机：绕中央 waypoint 巡逻
- 僚机：跟随长机保持 formationOffset
- HP < 20% → 轻微偏航摇摆（模拟受损）

### 6.3 自卫炮塔开火

`_bomberTurretFire`（[L1187](../../js/enemy.js#L1187)）：
- 雷达式扫描所有炮塔方向（muzzleDirs）
- 玩家进入任一炮塔射击锥（30°）且在距离内 → 反应延迟 → 短连发 → 长冷却
- 不要求机体朝向玩家，只看玩家方位 vs 各炮塔方向夹角

---

## 七、关卡隔离机制

### 7.1 三层隔离架构

```
关卡配置 (level_xx.js)
    ↓ 注入
环境参数重置 (GameRuntime.start)
    ↓ 注入
wave 配置 → Enemy 实例属性 (_spawnBehavior / _aiCfg / combatState)
```

### 7.2 关卡切换清理

`GameRuntime.stop()` 释放：
- 所有敌机（_disposeAircraft：模型/几何/材质/武器/粒子）
- 友军轰炸机
- 玩家
- 波次导演
- 环境（地形/海洋/天空/光照/建筑）
- HUD/雷达/对话/教学

### 7.3 Enemy 实例隔离

- 每个敌机实例独立初始化所有属性
- 模块级临时向量（_toP/_toT/_local 等）每帧重置，不跨实例共享状态
- `_spawnBehavior`（本关专用）注入出生点/盘旋点，无配置时走默认逻辑

### 7.4 本关可独立配置的字段

| 字段 | 作用 | 本关值 |
|---|---|---|
| spawn | 出生点 | `{x:0, y:2200, z:-8000}` |
| loiter | 盘旋点+半径+高度 | `{x:0, z:-4500, radius:700, alt:2200}` |
| type | AI 类型 | `fighter`（默认） |
| tier | 难度分层 | `normal`（默认） |
| formation | 编队形式 | `solo`（单机） |
| route | 航线直飞 | 无（战斗机不用） |

---

## 八、修改建议入口点

### 8.1 调整开火难度

修改 [AI_TYPE_CONFIGS.fire](../../js/enemy.js#L178)：
```js
fire: { angleOff: 0.20, distMin: 200, distMax: 700, burstMin: 0.8, burstMax: 1.2, cdMin: 1.5, cdMax: 3.0 }
//       ↑ 锥宽       ↑↑↑↑↑↑↑↑↑↑↑↑↑↑ 距离区间 ↑↑↑↑↑↑↑↑↑↑↑↑ 连发 ↑↑↑↑↑↑↑↑↑↑ 冷却
```

### 8.2 调整接敌距离

修改 [_thinkLoiter L829](../../js/enemy.js#L829)：
```js
if (distP < 1200) {  // ← 修改此值
  this.combatState = 'engaged';
}
```

### 8.3 调整编队散开距离

修改 [_thinkFormation L881](../../js/enemy.js#L881)：
```js
if (distP < 500) {  // ← 修改此值
  this._breakFormation();
}
```

### 8.4 调整规避频率

修改 [AI_TYPE_CONFIGS + TIER_CONFIGS](../../js/enemy.js#L171)：
```js
// tier normal
evasionChance: 0.20,  // ← 调大更激进
evasionCdMin: 8, evasionCdMax: 14,  // ← 调小冷却更短
```

### 8.5 启用双机编队

修改关卡配置 wave：
```js
{
  formation: 'pair', count: 2, model: '/model/spitfire.glb',
  spawn: { x: 0, y: 2200, z: -8000 },
  loiter: { x: 0, z: -4500, radius: 700, alt: 2200 },
}
```

### 8.6 调整编队偏移

修改 [Enemy 构造函数 L429](../../js/enemy.js#L429)：
```js
this.formationOffset = new THREE.Vector3(40, -10, 30);
//                                        ↑右  ↑下  ↑后
```
