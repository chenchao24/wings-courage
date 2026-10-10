# 敌机编队 AI 实现方案

## Context

当前游戏只有 1 架敌机（Yak-9）做最初级巡逻 AI。用户希望制作 **2 架敌机编队**，提升空战体验：

1. **编队飞行**：2 架保持一定距离飞行（长机+僚机阵型）
2. **被攻击散开**：被玩家攻击后分开各自机动
3. **协同支援**：当一架被玩家追逐攻击时，另一架从玩家**后方/上方/侧方**随机选一个方向包抄射击
4. **编队重生**：2 架都被击落后一起重生（本次专注测试编队 AI）

现有架构已支持多敌机（`enemies` 数组、命中检测遍历、雷达 `getEnemies`），但缺少：编队关系、协同状态机、编队级重生管理。

## 设计方案

### 状态机（Enemy 新增 `combatState` 属性）

```
formation（编队飞行）
  ├─ 长机：按 waypoint 巡逻
  └─ 僚机：跟随长机保持 body frame 偏移（右40/低10/后30 m）
  │
  │ 触发：受击 / 玩家距离 < 500m
  ▼
engaged（战斗散开）
  ├─ 自己被咬尾 → 规避（桶滚急转，复用现有 evade 逻辑）
  ├─ 队友被咬尾 → 支援（随机选后方/上方/左侧/右侧包抄）
  └─ 否则 → 单机攻击/巡逻（复用现有 think 逻辑）
  │
  │ 队友被击落
  ▼
solo（单机战斗到死）
  └─ 回到最初级 AI（现有 think 逻辑），不重生
```

**编队级重生**：main.js 检测 2 架都 `_exploded` 且粒子淡出（`_crashTimer <= 0`）→ 一起 `reset()` → 僚机位置对齐长机 + 偏移 → 两者 `combatState = 'formation'`。

### 关键决策（已与用户确认）
- 阵型：长机 + 僚机（僚机在长机右后下方）
- 队友被击落：幸存者变 solo 战斗到死，不重组
- 支援方向：随机选 rear/top/left/right

## 实现步骤

### 1. `aircraft.js` — 新增 `autoRespawn` 标志

**目的**：禁用敌机自动重生，改由 main.js 编队管理。

- 构造函数加 `this.autoRespawn = true;`（玩家默认 true）
- [aircraft.js:766](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/aircraft.js#L766) 改为：
  ```javascript
  if (this._exploded && this._crashTimer <= 0 && this.autoRespawn) this.reset();
  ```

### 2. `enemy.js` — 编队属性 + 状态机

**构造函数新增属性**：
```javascript
this.autoRespawn = false;                          // 编队级重生由 main.js 管理
this.combatState = 'formation';                    // 'formation' | 'engaged' | 'solo'
this.isLeader = false;
this.wingman = null;                               // 编队伙伴引用
this.formationOffset = new THREE.Vector3(40, -10, 30); // 僚机相对长机偏移（body frame: 右/下/后）
this._supportDir = null;                           // 'rear' | 'top' | 'left' | 'right'
this._supportPoint = new THREE.Vector3();          // 支援目标点
this._engageTimer = 0;                             // engaged 持续时间（用于支援方向重选）
```

**reset() 保留编队属性**：reset 不清空 `wingman`/`isLeader`/`formationOffset`（这些是外部设置的）。但 `combatState` 重置为 `'formation'`（由 main.js 编队重生时设置）。

**think() 重构为状态分支**：
```javascript
think(dt, player) {
  const input = { pitch:0, yaw:0, roll:0, throttleUp:false, throttleDown:false, fire:false };
  if (this.crashed || !player || !player.model) return input;
  if (!this._wpReady) this._initWaypoints();

  // 撞地拉起 / 高度上限（最高优先级，保留现有逻辑）
  // ... agl<120 拉起 / y>1000 下降

  // 队友死了 → solo
  if (this.wingman && (this.wingman._exploded || !this.wingman.ready)) {
    this.combatState = 'solo';
    this.wingman = null;
  }

  if (this.combatState === 'formation') return this._thinkFormation(dt, player, input);
  if (this.combatState === 'engaged')   return this._thinkEngaged(dt, player, input);
  return this._thinkSolo(dt, player, input);  // solo = 现有巡逻/攻击逻辑
}
```

**`_thinkFormation(dt, player, input)`**：
- 长机：按 waypoint 巡逻（复用现有巡逻逻辑）+ 检查散开触发（玩家距离<500 或受击）→ `_breakFormation()`
- 僚机：计算目标点 = 长机位置 + 长机姿态 × formationOffset，朝目标点飞（温和舵量）

**`_breakFormation()`**：
```javascript
_breakFormation() {
  this.combatState = 'engaged';
  this._engageTimer = 0;
  if (this.wingman && !this.wingman.crashed && this.wingman.combatState === 'formation') {
    this.wingman.combatState = 'engaged';
    this.wingman._engageTimer = 0;
    // 僚机随机选支援方向
    const dirs = ['rear', 'top', 'left', 'right'];
    this.wingman._supportDir = dirs[Math.floor(Math.random() * dirs.length)];
  }
}
```

**`_thinkEngaged(dt, player, input)`**：
- 计算自己是否被咬尾（玩家在身后 + 距离<350）
- 计算队友是否被咬尾（wingman 存在且 !crashed 且被咬尾）
- 分支：
  - 自己被咬尾 → 规避（复用现有 evade 逻辑）
  - 队友被咬尾 → `_support(dt, player, input)`
  - 否则 → `_thinkSolo`（单机攻击/巡逻）

**`_support(dt, player, input)`**：随机方向包抄
```javascript
// 每 4s 重选一次方向（避免频繁切换）
this._engageTimer += dt;
if (this._engageTimer > 4) { this._supportDir = 随机; this._engageTimer = 0; }

const playerPos = player.root.position;
const playerFwd = player.getForward();
const playerRight = new THREE.Vector3(1,0,0).applyQuaternion(player.root.quaternion);
let target;
switch (this._supportDir) {
  case 'rear':  target = playerPos.clone().addScaledVector(playerFwd, -300); break;           // 后方 300m
  case 'top':   target = playerPos.clone().add(new THREE.Vector3(0, 200, 0)).addScaledVector(playerFwd, -100); break;
  case 'left':  target = playerPos.clone().addScaledVector(playerRight, -250); break;
  case 'right': target = playerPos.clone().addScaledVector(playerRight, 250); break;
}
// 朝 target 飞（复用现有"朝目标点飞"逻辑）+ 开火判定（玩家在前方窄锥内）
```

**`_thinkSolo(dt, player, input)`**：现有 think 逻辑（巡逻 + 规避 + 低欲望攻击）原样搬过来。

**takeDamage 触发散开**：override takeDamage，调父类后检查：
```javascript
takeDamage(d) {
  const dead = super.takeDamage(d);
  if (!dead && this.combatState === 'formation') this._breakFormation();
  return dead;
}
```

### 3. `main.js` — 编队生成 + 编队级重生

**替换 `spawnEnemy()` 为 `spawnFormation()`**：
```javascript
let formation = null;  // { leader, wingman }

function spawnFormation() {
  const leader = new Enemy(scene, renderer, aircraft);
  leader.isLeader = true;
  leader.setObstacles(env.obstacles);
  leader.setTerrain(env.terrain);
  leader.load('/model/yak9.glb').then(() => {
    const wingman = new Enemy(scene, renderer, aircraft);
    wingman.isLeader = false;
    wingman.wingman = leader;
    leader.wingman = wingman;
    wingman.setObstacles(env.obstacles);
    wingman.setTerrain(env.terrain);
    wingman.load('/model/yak9.glb').then(() => {
      // 僚机初始位置 = 长机位置 + 编队偏移
      const off = leader.formationOffset.clone().applyQuaternion(leader.root.quaternion);
      wingman.root.position.copy(leader.root.position).add(off);
      formation = { leader, wingman };
      enemies.push(leader, wingman);
      topbarSub.textContent = '就绪 · 编队已就位';
    });
  });
}
```

**主循环加编队重生检测**（在敌机推进循环后）：
```javascript
if (formation) {
  const { leader, wingman } = formation;
  if (leader._exploded && leader._crashTimer <= 0 &&
      wingman._exploded && wingman._crashTimer <= 0) {
    // 都死了且粒子淡出完成 → 一起重生
    leader.reset();
    wingman.reset();
    // 僚机对齐长机 + 偏移
    const off = leader.formationOffset.clone().applyQuaternion(leader.root.quaternion);
    wingman.root.position.copy(leader.root.position).add(off);
    leader.combatState = 'formation';
    wingman.combatState = 'formation';
    leader.wingman = wingman;
    wingman.wingman = leader;
  }
}
```

**`spawnEnemy()` 调用点改为 `spawnFormation()`**（[main.js:112](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/main.js#L112)）。

### 4. 复用现有接口
- `Aircraft.getForward()` / `root.position` / `root.quaternion` / `speed` / `hp` / `crashed` / `_exploded` / `_crashTimer` — 全部可复用
- `Enemy.weapons` / `getPosition()` — 复用
- 现有 evade 逻辑（`_evadeTimer`/`_evadeCd`/`_evadeRoll`）— 复用
- 现有巡逻逻辑（waypoint）— 复用为 `_thinkSolo` 和长机 formation 巡逻

## 关键文件
- [js/aircraft.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/aircraft.js) — 加 `autoRespawn` 标志，改 line 766
- [js/enemy.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/enemy.js) — 编队属性 + 状态机 + takeDamage override
- [js/main.js](file:///c:/Users/CC/Desktop/gameSpace727/darkWil/js/main.js) — `spawnFormation()` + 编队重生检测

## 验证方法

1. **启动**：`npx http-server -p 5173 -c-1 --cors`（已在后台运行），浏览器打开 http://127.0.0.1:5173
2. **编队就位**：加载完成后应看到 2 架 Yak-9 编队飞行（僚机在长机右后下方）
3. **编队保持**：观察僚机跟随长机转弯，保持相对偏移
4. **散开触发**：靠近编队（<500m）或击中一架，两架应分开机动
5. **协同支援**：咬尾其中一架，另一架应从后方/上方/侧方包抄射击
6. **solo 模式**：击落一架，另一架应继续单机战斗（不重生）
7. **编队重生**：击落两架，等粒子淡出，应一起重生为编队
8. **控制台验证**：`window.__debug.enemies` 应有 2 架，`enemies[0].wingman === enemies[1]`

## 风险与边界
- **僚机跟随稳定性**：僚机朝目标点飞时若偏移过远可能追不上，需限制偏移距离合理（40/10/30m 不算大）
- **支援方向频繁切换**：用 `_engageTimer` 4s 重选一次，避免抖动
- **重生位置冲突**：僚机对齐长机偏移，避免重叠
- **solo 敌机不重生**：符合用户需求"编队都被击落后再一起重生"

## 不做的事
- 不做更多敌机类型扩展（本次专注编队 AI）
- 不做得分系统（已有 kills 计数足够）
- 不做编队阵型切换（楔形等留待后续）
