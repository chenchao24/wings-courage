# darkWil · 详细设计文档

> 本文记录 darkWil（Bf 109 E-4 空战游戏）的整体架构、模块职责、关键约定与核心算法。供后续迭代与排障时查阅。
> 配套：[README.md](../README.md)（项目概览）｜[DEBUG_BUG_LOG.md](./DEBUG_BUG_LOG.md)（Bug 修复记录）｜[CHANGELOG.md](./CHANGELOG.md)（迭代时间线）

---

## 1. 架构总览

纯原生 JS + Three.js 0.160，ES 模块 + importmap，无框架。`main.js` 作为入口串联所有模块，模块间通过 **getter 函数注入** 解耦（不直接互引）。

```
index.html
  └─ importmap → three / three/addons
  └─ js/main.js（入口）
       ├─ environment.js  → createEnvironment() → { sky, sun, sunLight, ground, grid, obstacles, obstacleCenters, terrain, buildings }
       ├─ clouds.js       → Clouds（程序化云层）
       ├─ aircraft.js     → Aircraft（玩家）
       ├─ enemy.js        → Enemy extends Aircraft（敌机）
       ├─ controls.js     → Controls（键盘 + 响应曲线）
       ├─ weapons.js      → Weapons（曳光弹 + 枪口特效 + 随机伤害）
       ├─ radar.js        → Radar（canvas 2D HUD）
       ├─ audio.js        → GameAudio（WebAudio 程序化合成）
       └─ 主循环 animate()：input → updateFlight → update → weapons → enemies → radar → render
```

### 层级结构（Aircraft 内部）

```
root (THREE.Group，承载位置/姿态)
  └─ modelYaw (Group，应用 yawOffset 朝向校准)
       └─ model (Group，GLB 场景，归一化后中心在原点)
            ├─ 螺旋桨节点（含 prop 关键字的 mesh）
            ├─ 控制面（升降舵/副翼/方向舵，按 mesh 名匹配）
            └─ 机身/机翼/座舱等
```

- **机头朝向约定**：飞行前方 = -Z（body frame）。`Aircraft.getForward() = (0,0,-1).applyQuaternion(root)`。
- **座舱相机偏移**：body frame `(0.00, 1.65, -0.70)`，按原模型位置校准。**修改 `model.position` 会破坏座舱视角**（见 [DEBUG_BUG_LOG.md](./DEBUG_BUG_LOG.md) #22）。

---

## 2. 模块职责

### 2.1 `aircraft.js` — Aircraft 类（核心）

玩家飞机基类，敌机继承复用。职责：

| 功能 | 实现 |
| --- | --- |
| 模型加载 | `load(url, onProgress)`，预置 DRACO + meshopt 解码器 |
| 归一化 | `_normalize()`：缩放到约 9 米、居中（`model.position = -center`）、自动朝向校准 |
| 自动朝向 | `_autoOrient()`：按螺旋桨节点质心对齐 -Z（玩家用）；敌机可设 `autoOrient=false` 用手动偏航 |
| 动画筛选 | 576 轨全烘焙进一个 clip，只抽取节点名含 `prop` 的 30 轨合成纯净螺旋桨片段 |
| 螺旋桨多状态 | Prop_Set 下 anim/slow/blur 三套重叠叶片，`propMode` 控制只显示一套 |
| 控制面 | 升降舵/副翼/方向舵随输入偏转（按 mesh 名匹配） |
| 街机飞行物理 | `updateFlight(dt, input)`：角速度模型 + 耦合 + 重力升力 + 失速 + G力 |
| 撞地/撞建筑 | 注入 `terrain`（`getHeight`）与 `obstacles`（`Box3[]`） |
| 损伤状态机 | HP ≤ 30 冒烟 / HP = 0 坠毁 / 坠毁中累计伤害 > 20 空爆 |
| 坠毁双模式 | `_startCrash()` 随机弹道/挣扎；`_updateCrash()` 推进 |
| 爆炸粒子 | `_explode()`：火光 Sprite + 深烟团 + 火星 Mesh + 旋转碎片 |
| 瞄准 | `getAimDirection()` 统一处理瞄准上抬量（`aimLift`），准星与子弹方向同源 |

### 2.2 `enemy.js` — Enemy extends Aircraft

敌机 Yak-9，复用基类全部能力，新增：

- **血量**：`maxHp = 100`
- **自带武器**：`new Weapons(scene, this)`，`setAudio(null)` 不播音（避免嘈杂）
- **编队 AI**：`think(dt, player)` 返回 input，`combatState` 状态机分派（见 §5）
- **编队属性**：`isLeader`、`wingman`（互引）、`formationOffset`（僚机 body frame 偏移）、`_supportDir`（支援方向）
- **重生**：`reset()` override，重生在玩家前方 1400-1900 单位外随机方位，机头朝玩家；`autoRespawn = false`（由 main.js 编队级管理）
- **Yak-9 校准参数**（由 `tune_enemy.html` 调出，写入构造函数）：
  - `autoOrient = false`，`yawOffset = -139`，`pitchOffset = 0`，`rollOffset = 0`，`userScale = 3.6`
  - `muzzleOffsets`：机翼 2 挺 + 机头 2 挺（body frame）
  - `aimLift = 0`（敌机用机头直接瞄准，无座舱上抬修正）

### 2.3 `controls.js` — Controls 类

键盘输入 + 街机式响应曲线。

- `tick(dt)`：累计每轴按下时长（0..1，0.08s 起步斜坡）
- `flightInput()`：返回归一化 -1..1 的 `{ pitch, roll, yaw, throttleUp, throttleDown, fire }`
- 灵敏度：`{ pitch: 0.40, roll: 0.35, yaw: 0.45 }`，可被 `setSensitivity()` 覆盖
- 松杆立即归零（街机要灵敏，不留长尾）
- `blur` 事件清空按键状态（防切后台后键卡死）

按键映射：

| 按键 | 输出 |
| --- | --- |
| `W` / `S` | pitch（W=推杆低头/俯冲+，S=拉杆抬头/拉升-） |
| `A` / `D` | roll（A=左滚+，D=右滚-） |
| `Q` / `E` | yaw（Q=左偏+，E=右偏-） |
| `Shift` / `Ctrl` | throttleUp / throttleDown |
| `Space` | fire |

### 2.4 `weapons.js` — Weapons 类

曳光弹对象池 + 粒子化枪口特效 + 随机伤害。

- **子弹**：沿 `aircraft.getAimDirection()` 高速射出，叠加飞机速度；4 挺机枪交替射击
- **枪口闪光**：Sprite（additive），0.05s 快速放大+淡出
- **火花**：1-2 颗小 Sprite，锥形飞溅 + 阻尼，0.05-0.09s
- **稀薄烟雾**：每 3 发一个，Sprite（normal），膨胀+减速+淡出，0.6-0.9s
- **随机伤害**：`damageMin/damageMax` + `getDamage()`，玩家 8-20，敌机 8-12
- **共享资源**：纹理（flash/smoke/spark）+ 几何/材质一次性创建，避免每发 new
- **解耦接口**：`getBulletPositions()` / `getBullets()` 供命中检测

### 2.5 `environment.js` — createEnvironment()

返回 `{ sky, sun, sunLight, ground, grid, obstacles, obstacleCenters, terrain, buildings }`。

- **天空**：自定义 ShaderMaterial 渐变天空球（半径 40000，BackSide，toneMapped=false）
  - 顶点着色器：球面法线作为视线方向
  - 片段着色器：三段渐变（地平线→中段→天顶）+ 太阳方向 pow 散射光晕
  - 主循环 `sky.position.copy(camera.position)` 跟随相机
- **太阳**：多层 Sprite 叠加（核心亮盘 + 中层光晕 + 外层弥散光），挂到天空球下随相机移动
- **光照**：HemisphereLight（天蓝/地绿）+ DirectionalLight（暖白，带阴影 2048²，范围 ±220）
- **雾**：FogExp2，地平线浅蓝色（0xc8e0f4），密度 0.00016，隐藏大地方形边界
- **地形**：`new Terrain(18000, 320)`
- **建筑**：`new Buildings(terrain)`，`obstacleBoxes` 供坠毁，`centers` 供雷达
- **调试网格**：GridHelper 2400² / 120 段

### 2.6 `terrain.js` — Terrain 类

fbm 噪声高度 + 顶点着色（草/土/麦田/森林/岩石按高度坡度）。

- 大地 18000² / 320 segments（东欧平原缓起伏，0-9m）
- `getHeight(x, z)`：解析 fbm 噪声返回高度（供飞机撞地判断）
- `getHeightCached`：缓存查询结果
- 灵感来自 fateLand 项目
- 顶点着色策略：
  - 草地为主，h > 45 才岩石为主，灰岩占比降至 6%
  - 森林颜色改为草色略深绿（0x3e5a2e）
  - smoothstep 平滑过渡 + 中尺度 fbm 噪声消除大色块感
  - 河流：噪声频率降低，带宽减小，减少数量和宽度

### 2.7 `buildings.js` — Buildings 类

程序化平房村庄 + 松树。

- 小屋/谷仓/教堂尖顶（box + 棱锥屋顶）+ 松树（圆锥堆叠）
- 共享几何体/材质
- `obstacleBoxes`（`Box3[]`）供坠毁，`centers`（`Vector3[]`）供雷达
- 贴地 `y = terrainHeight`
- 颜色：土色系 + 增加 roughness 以融入环境
- 森林：120-200 棵/片的茂密区域

### 2.8 `clouds.js` — Clouds 类

程序化云层。

- 28 团，每团 4-7 个 Sprite 错位叠加成不规则大云团（非独立小方块）
- 高度 1000-1700 高空带
- 5 种程序化纹理 + 随机 rotation/翻转
- `alphaTest 0.02` + 边缘 alpha 严格归零消除方块边
- 跟随玩家循环回收（`recycleR 2000`）

### 2.9 `radar.js` — Radar 类

右下角圆形雷达 HUD（canvas 2D）。

- 玩家居中、机头朝上
- 注入 `aircraft` + `getEnemies`/`getObstacles` getter 解耦
- 敌机显示为红点、建筑为灰点
- 超出 1.5km 范围的目标在边缘显示指示三角
- 带缓慢旋转扫描线

### 2.10 `audio.js` — GameAudio 类

WebAudio 程序化合成（无外部音频文件）。

| 音效 | 合成方式 |
| --- | --- |
| 引擎 | 锯齿波（V12 粗糙感）+ 三角波（低频脉动）+ 气流噪声，音调随油门（48-158 Hz） |
| 机枪 | 噪声 burst（枪口爆裂）+ 低频 sine thump（机械撞击，140→45 Hz） |
| 命中 | 方波下扫（1400→320 Hz，清脆金属 ping） |
| 爆炸 | 低通噪声长衰减（900→60 Hz）+ 低频冲击波（80→30 Hz） |

- `init()` 必须在用户首次交互后调用（浏览器 AudioContext 策略）
- `resume()` 每次用户手势调用一次（防挂起）
- `toggleMute()`：M 键切换，master gain 0/0.55

### 2.11 `tune_enemy.js` / `tune.js` — 调试页

- `tune_enemy.html` + `tune_enemy.js`：敌机模型朝向调试台（三轴朝向滑条、缩放、枪口位置、参数输出）
- `tune.html` + `tune.js`：玩家火炮位置调试台（仅保留火炮设计位置调整）

---

## 3. 关键约定（务必保持）

### 3.1 动画筛选
模型 576 轨全烘焙进一个 `Animation` clip。**只抽取节点名含 `prop` 的 30 轨**合成纯净螺旋桨片段播放；起落架/座舱盖/座舱开关轨道一律不播。

### 3.2 螺旋桨多状态
Prop_Set 下有 anim/slow/blur 三套重叠叶片，`propMode` 控制只显示一套（默认 blur 模糊盘）。

### 3.3 机头朝向
飞行前方 = -Z（body frame）。`Aircraft.getForward() = (0,0,-1).applyQuaternion(root)`。

### 3.4 模块解耦
跨模块数据通过 getter 函数注入（如雷达读 targets 位置），不直接互引。

### 3.5 调试接口
- `window.__aircraft` — 玩家飞机实例
- `window.__debug` — `{ clouds, camera, renderer, env, enemies }` getters

### 3.6 性能策略
- `renderer.setPixelRatio(min(dpr, 2))`
- `dt = Math.min(clock.getDelta(), 0.05)` 防切后台大跳
- 共享几何/材质避免每发子弹创建
- 子弹/粒子对象池复用
- 地形 `getHeightCached` 缓存

### 3.7 天空方案（重要决策）
**已弃用 Preetham Sky**（在 ACES 下天顶恒为淡蓝，蓝差仅 +20~33，调不出饱和蓝天）。改用自定义 ShaderMaterial 渐变天空球：
- 半径 40000，BackSide，`toneMapped = false` 保留饱和度
- 天顶 0x3a7fd6 → 中段 0x7fb8e8 → 地平线 0xc8e0f4 三段渐变 + 太阳方向 pow 散射光晕
- 天空球在主循环 `sky.position.copy(camera.position)` 跟随相机
- **颜色直接给 sRGB 值**（`convertSRGBToLinear` 在 `toneMapped=false` 下会双重处理变暗）

### 3.8 Tone Mapping
- `renderer.toneMapping = ACESFilmicToneMapping`，`exposure = 1.0`
- 天空材质 `toneMapped = false` 跳过 ACES，模型/大地走 ACES 正常亮度

### 3.9 屏幕敌机指示器判定
使用 Three.js 的 `.project()` 返回的 NDC 坐标（范围 -1 到 +1），判定条件为：
```
_eiProj.x > -1.05 && _eiProj.x < 1.05 && _eiProj.y > -1.05 && _eiProj.y < 1.05
```
确保全屏范围内正确显示三角框。

### 3.10 座舱位置约定（重要）
`Aircraft._applyCalibration()` **只设缩放，不动 `model.position`**（位置在 `_normalize()` 中一次性设好，座舱偏移据此校准）。曾因在 `_applyCalibration()` 中改 `model.position` 导致主游戏座舱视角偏移，详见 [DEBUG_BUG_LOG.md](./DEBUG_BUG_LOG.md)。

---

## 4. 飞行物理（`aircraft.js updateFlight`）

### 4.1 角速度模型
- 指数趋近目标：`angVel += (target - angVel) * (1 - exp(-k * dt))`，帧率无关
- `k` 由 `pitchResp/rollResp/yawResp` 决定
- 松杆回零

### 4.2 滚转-偏航耦合
- 滚转角带偏航（转弯自动带舵，不用手动蹬舵）
- **俯仰角速度大时（筋斗中）禁用**，避免倒飞跳变

### 4.3 G 力软限
- `pitchMax * 1.6` 封顶
- G 力 = `1 + |angVel.x| / pitchMax * 5` 供 HUD 显示
- 超 6G 时 HUD 数值变红（纯视觉）

### 4.4 重力 / 升力
- `lift = speed * liftK`
- 高速平飞净零，低速下沉
- 失速：`speed < minSpeed * 1.5` 时机身抖动 + 顶部红色 `STALL` 警告

### 4.5 撞地
- `y < terrainHeight + 2` 且 `speed > minSpeed * 1.5` 才坠毁
- 低速轻触地不坠毁

### 4.6 巡航漂移
- 松开油门后速度缓慢回到巡航速度，不会一直维持极端值

---

## 5. 敌机 AI（`enemy.js think`）

### 5.1 状态机总览

双机编队 AI，`combatState` 三态切换：

```
formation（编队飞行）
  │ 受击 / 玩家靠近 < 500m → _breakFormation()
  ▼
engaged（战斗散开）
  │ 队友被击落 → wingman = null
  ▼
solo（单机战斗）
  │ 编队重生（main.js 检测两架都死）
  ▼
formation（恢复编队）
```

### 5.2 通用优先级（所有状态共享）

1. **撞地拉起**（最高）：`agl < 120m` → `pitch = 1.0` + 油门
2. **高度上限下降**：`y > 1000m` → `pitch = -0.6`
3. **队友被击落检测**：`wingman._exploded` → 切 `solo`，`wingman = null`
4. **状态分派**：`formation` / `engaged` / `solo`

### 5.3 formation（编队飞行）

- **长机**：按 8 个 waypoint 巡逻（半径 850，高度 600-850m），飞出中央 > 1300m 回中央；不攻击，保持编队
- **僚机**：跟随长机保持 body frame 偏移（`formationOffset = (40, -10, 30)` = 右40/下10/后30）
  - 目标点 = `leader.position + leader.quaternion × formationOffset`
  - 朝目标点飞（温和舵量：pitch ±0.5、roll ±0.6、yaw ±0.25）
- **散开触发**：玩家距离 < 500m → `_breakFormation()` 切 `engaged`
- **散开触发**：受击（`takeDamage` 未死）→ `_breakFormation()` 切 `engaged`

### 5.4 engaged（战斗散开）

- **自己被咬尾**（玩家在身后 `_local.z > 0`，距离 < 350m）→ 规避（桶滚急转，冷却 5-9s，概率 0.02/帧）
- **队友被咬尾**（玩家在队友身后，距离 < 400m）→ `_support()` 包抄射击
- **否则** → `_thinkSolo()` 单机攻击/巡逻

### 5.5 support（支援包抄）

队友被咬尾时，从玩家后方/上方/左侧/右侧随机选一个方向包抄射击：

| 方向 | 支援目标点 |
| --- | --- |
| `rear` | 玩家后方 300m |
| `top` | 玩家上方 200m + 略后 100m |
| `left` | 玩家左侧 250m |
| `right` | 玩家右侧 250m |

- 每 4s 重选一次方向（`_engageTimer`，避免频繁切换）
- 高度钳制 `groundH + 200 ~ 1100`（避免撞地或过高）
- 朝支援目标点飞（加速就位）
- 到达附近且玩家在前方窄锥（`angleOff < 0.2rad`，200-700m）→ 开火

### 5.6 solo（单机战斗）

即原有巡逻 AI 逻辑：

1. **规避中**：执行桶滚急转（`roll = ±0.9`，`pitch = 0.6`），持续 1.2-2.0s
2. **规避触发**：被咬尾 + 距离 < 350m + 概率 0.015/帧 → 触发规避，冷却 7-12s
3. **巡逻/靠近**：
   - 玩家距离 > 1500m → 向玩家靠近
   - 飞出中央（>1300m）→ 回中央
   - 否则沿 8 个 waypoint 巡逻，到达 250m 内切换下一个
4. **开火判定**（低欲望）：
   - 玩家在前方窄锥（`_local.z < 0`，200-500m，`angleOff < 0.15rad`）
   - 开火 0.5s + 冷却 2.5-5s

### 5.7 编队散开与重生

- **散开**（`_breakFormation()`）：自身切 `engaged`，通知队友一起切 `engaged` 并随机选 `_supportDir`
- **编队级重生**（`main.js` 主循环检测）：
  - 条件：两架都 `_exploded && _crashTimer <= 0`（爆炸粒子淡出完成）
  - 操作：两架都 `reset()` → 僚机对齐长机编队偏移 → 恢复 `combatState = 'formation'` + 互引
  - 敌机 `autoRespawn = false`，不自动 `reset()`，由 main.js 统一管理

### 5.8 机动参数（敌机略低于玩家）
- `maxSpeed = 150`，`pitchMax = 1.0`，`rollMax = 2.0`，`yawMax = 0.6`
- `cruiseSpeed = 80`

### 5.9 火力参数（敌机略高于玩家）
- `fireRate = 0.06`（玩家 0.07）
- `bulletSpeed = 720`
- `damageMin = 8`，`damageMax = 12`（玩家 8-20）

---

## 6. 损伤状态机

```
正常 (HP=100)
  │ takeDamage
  ▼
冒烟 (HP ≤ 30)：机身中段冒轻度黑灰透明烟（_damageSmoke Sprite）
  │ takeDamage
  ▼
坠毁 (HP = 0)：_startCrash()
  ├─ 加重烟雾 + 火焰（_damageFire Sprite）
  ├─ 停止机动（crashed=true，禁用输入与物理）
  ├─ 随机选模式：30% struggle / 70% ballistic
  └─ _updateCrash() 推进
       │ 坠毁中累计 _crashDamage > 20
       ▼
   _explode()：空中爆炸
       ├─ 模型隐藏
       ├─ 火光 Sprite + 深烟团 + 火星 Mesh + 旋转碎片
       └─ 3s 粒子淡出 → reset() 重生
       │ 触地
       ▼
   _explode()：地面爆炸（同上）
```

### 关键属性（`aircraft.js` 构造函数）

```javascript
this.crashed = false;        // 坠毁期间禁用输入与物理
this._exploded = false;      // 已爆炸（模型隐藏，仅爆炸粒子）
this._crashTimer = 0;        // 已爆炸后粒子倒计时（坠毁触地前不计时，与重生解耦）
this._crashDamage = 0;       // 坠毁中累计受击伤害（>20 触发空中爆炸）
this._crashVel = Vector3();  // 坠毁速度向量（弹道模式用）
this._crashSpeed = 0;        // 坠毁前飞标量速度（挣扎模式用）
this._crashMode = 'ballistic'; // 'ballistic' | 'struggle'
this._crashSinkRate = 0;     // 坠毁下沉速率
this._crashPitchRate = 0;    // 坠毁低头角速度
this._crashRollRate = 0;     // 坠毁滚转角速度
this._crashYawRate = 0;      // 坠毁偏航角速度
this._crashFallTime = 0;     // 坠毁已持续时间（安全阀，超时强制爆炸）
this.smokeThreshold = 30;    // HP ≤ 此值开始冒轻度烟
```

---

## 7. 坠毁双模式（`_startCrash` / `_updateCrash`）

### 7.1 弹道模式（ballistic，70%）
完全失控，保留前向动量沿抛物线下坠，机头缓慢下垂。

```javascript
this._crashVel.copy(this.getForward()).multiplyScalar(this.speed);
if (this._crashVel.y > 0) this._crashVel.y *= 0.3;  // 限制向上分量，保留部分惯性
this._crashSinkRate = this.gravity * 1.5;           // 1.5 倍重力（抛物线下坠）
this._crashPitchRate = 0.25 + Math.random() * 0.15; // 缓慢低头（4-6s 到近垂直）
this._crashRollRate  = (±1) * (0.15 + Math.random() * 0.15);
this._crashYawRate   = (Math.random() - 0.5) * 0.1;
```

每帧：
- 整体空气阻力（`_crashVel.multiplyScalar(1 - dt * 0.05)`，轻微，保留前飞动量）
- 垂直 1.5 倍重力加速（`_crashVel.y -= _crashSinkRate * dt`）
- 位置 += `_crashVel * dt`
- 机头缓慢低头：`noseDown = -getForward().y`，`< 0.9` 时 `rotateX(-_crashPitchRate * dt)`
- 轻微滚转/偏航 **sin 振荡**（不累积翻转）：`rotateZ(sin(t*2.5) * rate * dt)`

### 7.2 挣扎模式（struggle，30%）
保留大部分前飞速度，机头大致水平摇晃，高度快速下降坠地。

```javascript
this._crashSpeed = this.speed * 0.9;                // 保留 90% 前飞（惯性）
this._crashSinkRate = this.gravity * 1.5;           // 1.5 倍重力快速下降
this._crashPitchRate = 0.12 + Math.random() * 0.08; // 缓慢低头
this._crashRollRate  = (Math.random() - 0.5) * 0.4;
this._crashYawRate   = (Math.random() - 0.5) * 0.25;
```

每帧：
- 缓慢减速（`_crashSpeed *= (1 - dt * 0.04)`，保留前飞动量）
- 仅水平前飞（`x/z` 分量，不跟随俯仰上下分量）
- **加速下降**（`_crashVel.y += _crashSinkRate * dt` 累积，`position.y -= _crashVel.y * dt`）
- 小幅度振荡机动（sin 振荡不累积翻转）：滚转 ±5-9°、偏航 ±、俯仰振荡 ±0.15

### 7.3 触地与重生
- 触地（`y < terrainHeight + 2`）→ `_explode()` → 3s 粒子淡出 → `reset()` 重生
- 30s 安全阀：超长时间未触地（异常情况）强制爆炸，避免永不重生
- **坠落过程与重生解耦**：仅 `_exploded` 且计时器归零才 `reset()`，不会半空消失

### 7.4 为什么用 sin 振荡而非恒定角速度
恒定滚转率（`rotateZ(rate * dt)`）会累积翻转，10 秒翻 172°，机头朝上导致飞机向上飞。改用 `rotateZ(sin(t*2.5) * rate * dt)` 不累积，总滚转仅 ±5-9°。详见 [DEBUG_BUG_LOG.md](./DEBUG_BUG_LOG.md) #29。

---

## 8. 视角系统（`main.js`）

5 种固定视角，C 键循环切换：

| 模式 | 偏移（body frame） | 说明 |
| --- | --- | --- |
| chase | (0, 3.4, 12.5) | 追尾 |
| rearLeft | (-8, 3.0, 10) | 斜后 |
| frontRight | (7, 2.0, -10) | 斜前 |
| top | (0, 16, 0.5) | 正上方 |
| cockpit | (0, 1.65, -0.70) | 座舱（右键拖拽自由视野） |

座舱模式 `aimLift = 0.12`（准星上抬避免被机头遮挡），其它模式 `aimLift = 0`。`aircraft.aimLift` 同时驱动 `updateCrosshair`（准星）与 `getAimDirection`（子弹方向），保证两者重合。

---

## 9. 命中检测（`main.js` 主循环）

```javascript
// 玩家子弹 vs 敌机：坠毁中仍可受击以触发空中爆炸（累计伤害>20），仅已爆炸跳过
if (weapons && !e._exploded) {
  for (const b of weapons.getBullets()) {
    if (b.life <= 0) continue;
    // ... 球形命中检测，命中则 e.takeDamage(weapons.getDamage())，b.life = 0
  }
}

// 敌机子弹 vs 玩家：同理
```

- 玩家子弹命中敌机：调 `e.takeDamage(weapons.getDamage())`
- 敌机子弹命中玩家：调 `aircraft.takeDamage(e.weapons.getDamage())`
- 坠毁中仍可受击：累计 `_crashDamage > 20` 触发 `_explode()` 空中爆炸

---

## 10. 模型优化（离线一次性）

`messerschmitt_bf109_e4.glb`（23.5 MB）→ `bf109_opt.glb`（4.4 MB，18.6%）：

```bash
npx @gltf-transform/cli optimize model/messerschmitt_bf109_e4.glb model/bf109_opt.glb \
  --texture-compress webp --texture-size 2048 \
  --compress meshopt --meshopt-level medium \
  --simplify true --simplify-ratio 0.5 --simplify-error 0.0008 \
  --weld true --prune true
```

- 纹理：66 张 JPEG/PNG → WebP
- 几何：meshopt 压缩 + weld 顶点合并 + simplify 温和减面（保留螺旋桨叶片与机身曲线）
- 清理：prune 删除未引用节点/材质，dedup 去重

加载侧：`aircraft.js` 注册 `MeshoptDecoder`（`EXT_meshopt_compression` 必须）；WebP 纹理 three 0.160 内置支持。URL 加 `?model=raw` 回退原版对比。
