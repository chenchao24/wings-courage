# darkWil 0.72 · 交接文档

> **日期**：2026-08-20
> **项目**：空战游戏《勇气之翼》（darkWil 0.72.8.19）
> **技术栈**：Three.js 0.160 + 原生 JS（ESM + importmap）+ Vite（默认端口 5173），无框架，Cloudflare Pages 部署
> **工作目录**：`C:\Users\CC\Desktop\gameSpace727\darkWil-0.7`
> **详细迭代**：见 [CHANGELOG.md](./CHANGELOG.md)（#1-#78），详细设计见 [DESIGN.md](./DESIGN.md)，Bug 修复见 [DEBUG_BUG_LOG.md](./DEBUG_BUG_LOG.md)

---

## 一、项目现状

### 四关开发状态

| 关卡 | 名称 | 玩家机型 | 状态 |
|------|------|----------|------|
| 1 | 风云不列颠 | Bf 109 E-4 | ✅ 完整（剧本/对话/教学） |
| 2 | 巴巴罗萨之鹰 | Bf 109 E-4 | ✅ 完整（剧情编队/友军轰炸机） |
| 3 | 鏖战库尔斯克 | Fw 190 A-4 | ✅ 完整（地形/路网/地面物件/波次） |
| 4 | 柏林保卫战 | Me 262 | 🔨 **P1 落地（#58-#78），待试玩目检收尾** |

第 5-9 关在 `index.js` 占位（`血战中途岛`/`马里亚纳猎杀火鸡日` 等卡片图已备），`UNLOCKED_IDS` 当前开放前 4 关。

### 自由模式

框架搭建中（`js/freemode/` + `js/config/freemode/`），与战役模式 **100% 代码隔离**（详见 AGENTS.md 铁原则）。

---

## 二、第 4 关《柏林保卫战》落地清单（#58-#78）

### 地图与环境（#58-#66）
- **地面**：`js/berlinGround.js`（纯平 + Sentinel-2 卫星贴图 80×64km，`theme:'berlin'` 唯一入口）；管线 `scripts/fetch_berlin_ground.py`
- **视觉裙边**（#66）：环形零重叠平面 + 主图降采样镜像延伸 + 主图边缘 2km 羽化，藏图幅边界（`skirtScale/skirtTexSize/featherMeters` 可配）
- **云层**：`clouds.js` 云系化（patchiness/yCoherent/spreadMul/distFade/extraBands/texHoles，缺省=原行为）
- **雾**：`FogExp2` color 0xd8dee4 / density 0.00010（#78 雾效调参已回退原值）

### Me 262 玩家机（#59-#62）
- spec-gloss→PBR 转换（`scripts/convert_me262_specgloss.mjs`）、`player_tuner_me262.html` 调试台
- 4×MK108（tracerColor 曳光定制）、史实物理包线
- **喷气三件套**（playerConfig 门控）：
  - 文件引擎音（`engineSoundFile`，无缝循环烘焙 `scripts/make_engine_loops.py`）
  - 尾流特效 `js/JetExhaust.js`（`jetNozzles`）
  - 油门管理 `js/game/JetThrottleGovernor.js`（`jetThrottle`，80% 连续/90% 峰值/冷却）
- **交战高度规则** `js/game/CombatAltRule.js`（`combatAlt`，<2000m 倒计时判负或重置 4000m）

### B-17 轰炸机群（#63-#69）
- `bomberStream` 配置 + `js/game/HeavyBomber.js`：直飞 / 受伤返航 / 炮塔提前量 / 四式坠毁
- **网格合并优化**（#63）：`scripts/optimize_b17.mjs`，`model/b17.original.glb`（备份）→ `model/b17.glb`（116→26 mesh/架，近距 draw call 2398→768）
  - ⚠️ 关键坑：`helice03_FACES01-FACES` 不能删（运行时隐藏，但 `_setupPropPivot` 靠它算 pivot 包围盒）；4 个桨叶组节点名是 pivot 旋转查找键，合并必须绕过
  - ⚠️ 重跑模型管线前不要删 `b17.original.glb` 备份
- **特效**（#67/#69）：烟/火贴图加密、发动机拉烟、缓慢坠毁烟、坠毁四式多点大火、状态过渡平滑（残余扰动指数衰减）、30mm 命中打击感
- **柏林防空走廊模式**（#68）：`AntiAircraftFlak` corridor 模式打轰炸机编队（表演性质，不计玩家积分）

### 友军 Me 262 僚机小队（#70-#73）
- `js/game/Wingman262Squadron.js`（`Wingman262 extends Enemy` 仅借加载底层，AI 全自管）
- **指尖编队** → 1500m 解除 → **六模式猎杀表演** / 规避；表演性质成立（僚机子弹无命中路径，僚机不被受击）
- **双发喷流尾迹** `js/game/WingmanJetTrail.js`（#73 去 VaporTrail 带状改粒子软圆斑，每架 1 draw call）
- **编队跟随**：带符号速度修正 + 平移前馈（#72 纯距离正反馈跑飞 / #73 指数低通稳态滞后）
- **开场推镜** `js/game/BerlinOpening.js`（15s，鸭式复用 CinematicSystem 接线；过场期间僚机轨载钉死槽位，交接零跳变）
- B-17 炮塔多目标化（玩家/僚机就近）

### P-51 护航机群（#74-#77）
- **模型优化**（#74）：`scripts/optimize_p51.mjs`，32→9 draw call/架（8 架 256→72，-72%）；`model/p51.original.glb` 备份
- **AI**（#75）`js/game/P51EscortSquadron.js`：8 架 = A/B 中队 × 2 小队 × 长僚 2 机
  - **伴飞** → **拦截**（一次性爬升对头冲锋）→ **猎杀**（1000m 锁定 / 400m 点射 / 30s 上限）→ **协同**（same/trail/free 三策略）
  - 伤害链路：P-51 子弹只结算玩家（hitChance 0.2 + 3/3 伤害）；玩家可击落 P-51（HP120，击伤 +3 / 击落 +8）
- **试玩反馈修**（#76）：伤害骰点收敛、巡行大圈化（半径 1800m / 12°/s）、首次拦截触发前移（最近距离 ≤2000m）、玩家出生点西移 3000m、僚机尾喷对齐玩家、编队零扰动
- **击落倒计时**（#77）：`levelConfig.downed { graceSec:3, countdownSec:8 }`，HP=0 → 3s 演出宽限 → HUD 红字倒计时 → 8s 归零任务失败
- **P-51 防撞规避**（#77）：`_updatePlayerAvoid` 距离/接近率双阈值触发，满转 + 前冲 + 爬升 120m 规避 1.15s

### 音效 / 喊话 / 音乐 / UI（#78）
- **全局音效**：命中玩家 `playPlayerHit()`（beHit01-03.mp3）、子弹擦过 `playSidePassBy()`（side1-3.mp3，咬尾开火 30% 概率）
- **柏林喊话** `js/game/BerlinChatter.js`：开局 8 句序列 + 战斗 6 类（报点/事件/咬尾/击落/阵亡），战斗开始门控（P-51 首次拦截或玩家进 B-17 空域 ≤2000m）
- **柏林多段序列音乐** `js/game/BerlinMusic.js`：m1→elg→m2→交替循环→[进度≥90%]→m3
- **拦截进度 UI**：左上角 `#intercept-card`（流光动效进度条 + 金色渐变），门控 `levelConfig.intercept`
- **界面文本审核**：版本号 0.65.8.16→0.72.8.19、第 3 关简报尾句、第 4 关难度 3→4 星 / totalEnemies 0→20 / displayWaves:1、favicon

---

## 三、核心技术约束

### ⛔ 关卡隔离原则（最高优先级）

**关卡之间设置绝对不能互相影响。改一关的配置/行为，绝不允许波及其他关卡。**

- 飞机相关（最严格）：敌机/友军/玩家的模型参数、AI、枪口、性能、出生点按关卡独立配置
- 共享代码扩展原则：加 uniform/选项带默认值，默认值 = 原行为值，只在新关配新值
- 共享代码改动需验证全部已开放关卡（当前：britain + barbarossa + kursk + berlin）行为不变

### ⛔ 自由模式与战役模式完全隔离（AGENTS.md 铁原则）

- `FreeModeEnemy` 不得 `extends Enemy`，`FreeModeRuntime` 不得 `extends GameRuntime`（仅允许 `extends Aircraft`）
- 自由模式不得 `import` `js/config/levels/`；AI 配置独立维护，不从 `enemy.js` 读取
- 共享底层允许：`Aircraft`/`Weapons`/`Controls`/`Radar`/`HudController`/`environment`/`clouds`/`audio` 等纯机制模块

### Hard Constraints（硬约束）
- 海洋材质 `depthTest: true` / 地形 `SEA_BED` = -30 / 海洋距离雾密度 0.00012 / 海洋颜色 0x1a3040
- GLTF 模型必须缓存+克隆（`_gltfCache` + `SkeletonUtils.clone()`），克隆体必须深拷贝材质（#33 透明 Bug 教训）
- 螺旋桨 `PROP_SPIN=300` rad/s（避开 125.66 频闪冻结点）
- 敌机/友军 aimLift 恒为 0；玩家 aimLift 由 setCamMode 动态设置
- 对话队列顺序播放，游戏停止时清空；玩家控制锁定到 interceptChat 开始播放才解锁
- 击落最后一架后关闭随机喊话，victoryChat 播完才显胜利界面

---

## 四、关键文件清单

### 关卡配置
| 文件 | 说明 |
|------|------|
| `js/config/levels/index.js` | 关卡注册中心，UNLOCKED_IDS 控制开放（当前 4 关） |
| `js/config/levels/level_01_britain.js` | 第 1 关（Bf 109，完整） |
| `js/config/levels/level_02_barbarossa.js` | 第 2 关（Bf 109，完整，含剧情编队） |
| `js/config/levels/level_03_kursk.js` | 第 3 关（Fw 190 A-4，完整） |
| `js/config/levels/level_04_berlin.js` | **第 4 关（Me 262，P1 落地 #58-#78）** |

### 核心游戏模块
| 文件 | 说明 |
|------|------|
| `js/aircraft.js` | Aircraft 基类（模型加载/飞行物理/螺旋桨/座舱光源/桨叶透明化） |
| `js/enemy.js` | Enemy extends Aircraft（AI/损伤/MODEL_CONFIGS，含 P-51 配置） |
| `js/weapons.js` | Weapons（曳光弹/枪口特效/机炮大子弹/玩家火光烟迹） |
| `js/audio.js` | GameAudio（WebAudio 合成 + 文件音效 + 全局命中/擦过音效） |
| `js/environment.js` | createEnvironment（天空 shader/skyClouds/太阳/雾/光照） |
| `js/clouds.js` | Clouds（程序化云层，云系化可配） |
| `js/terrain.js` / `js/kurskRoads.js` / `js/kurskBattlefield.js` | 地形/路网/库尔斯克战场 |
| `js/berlinGround.js` | 柏林地面（Sentinel-2 卫星贴图 + 视觉裙边） |
| `js/AntiAircraftFlak.js` | 防空炮（含柏林 corridor 走廊模式 #68） |
| `js/JetExhaust.js` / `js/VaporTrail.js` | 喷气尾流 / 翼尖拉烟 |

### 游戏运行时（`js/game/`）
| 文件 | 说明 |
|------|------|
| `GameRuntime.js` | **关卡运行时核心**（加载/主循环/相机/武器注入/playerConfig 注入/全部配置门控） |
| `WaveDirector.js` | 波次导演 |
| `DialogSystem.js` / `Tutorial.js` / `CinematicSystem.js` | 对话/教学/剧情编队 |
| `HudController.js` / `hud-template.js` | HUD（含拦截进度 UI #78） |
| `FriendlyBomber.js` | 友军轰炸机 NPC（1/2 关） |
| `HeavyBomber.js` | **B-17 重轰炸机**（#63-#69，直飞/返航/炮塔多目标/四式坠毁） |
| `BerlinOpening.js` | **柏林开场推镜**（#70，鸭式复用 CinematicSystem） |
| `Wingman262Squadron.js` / `WingmanJetTrail.js` | **友军 262 僚机小队** / 喷流尾迹（#70-#73） |
| `P51EscortSquadron.js` | **P-51 护航机群**（#74-#77，8 架 2 中队 4 小队） |
| `CombatAltRule.js` / `JetThrottleGovernor.js` | 交战高度规则 / 喷气油门管理 |
| `BerlinChatter.js` / `BerlinMusic.js` / `LevelMusic.js` | 柏林喊话 / 柏林多段音乐 / 关卡音乐 |

### 自由模式（`js/freemode/`，隔离区）
| 文件 | 说明 |
|------|------|
| `FreeModeEnemy.js` / `FreeModeRuntime.js` / `FreeModeMaps.js` | 自由模式敌机/运行时/地图（框架搭建中） |

### 应用框架
| 文件 | 说明 |
|------|------|
| `js/app/AppShell.js` | 应用外壳（场景管理/环境重建/关卡切换/柏林音乐接管） |
| `js/main.js` | 入口 |

### 调试工具
| 文件 | 说明 |
|------|------|
| `model_tuner.html` | 敌机模型预处理工具（4 Tab，导出 → `js/enemy.js` MODEL_CONFIGS） |
| `player_tuner_fw190.html` | FW190 玩家飞机调试台（导出 → `level_03_kursk.js` playerConfig） |
| `player_tuner_me262.html` | **Me 262 玩家飞机调试台**（导出 → `level_04_berlin.js` playerConfig） |
| `b17_tuner.html` | B-17 标定台 |

---

## 五、本地运行与调试

```bash
# Vite 开发服务器（默认端口 5173）
npm run dev

# 或静态服务器
python -m http.server 8000
# 浏览器访问 http://127.0.0.1:8000
```

### 调试台
- 敌机：`http://127.0.0.1:8000/model_tuner.html`（导出 → `js/enemy.js` MODEL_CONFIGS）
- FW190 玩家：`http://127.0.0.1:8000/player_tuner_fw190.html`（导出 → `level_03_kursk.js` playerConfig）
- Me 262 玩家：`http://127.0.0.1:8000/player_tuner_me262.html`（导出 → `level_04_berlin.js` playerConfig）

---

## 六、注意事项

1. **改共享代码后必跑验证清单**：不列颠 / 巴巴罗萨 / 库尔斯克 / 柏林四关行为不变（回归测试 `tests/python/test_campaign_regression.py` + `test_berlin_level.py`）
2. **共享代码扩展原则**：加 uniform/选项带默认值，默认值 = 原行为值，只在新关配新值
3. **GLTF 缓存克隆材质**：`SkeletonUtils.clone()` 共享材质引用，必须 cloneGltfScene 后逐 mesh `material.clone()`（#33 透明 Bug 教训）
4. **B-17 模型管线**：重跑 `optimize_b17.mjs` 前不要删 `model/b17.original.glb` 备份；`helice03_FACES01-FACES` 节点不能删
5. **P-51 模型管线**：`optimize_p51.mjs`，`model/p51.original.glb` 备份；回退方法：复制 original 回 p51.glb

---

## 七、下一步候选（截至 #78，2026-08-20）

### 第 4 关《柏林保卫战》待目检 / 收尾
- **试玩目检**（#75-#78 多处标注「待试玩目检」）：P-51 拦截冲锋时机 / 分头转向观感、僚机猎杀六模式表演密度、B-17 命中/坠毁特效节奏、击落倒计时文案闪动、拦截进度 UI 流光
- **B-17 凝结尾迹**（#63 遗留）：高空速度感核心参照，未落地。僚机/玩家 262 已有 `WingmanJetTrail`/`JetExhaust`，B-17 需独立实现
- **同屏架次性能**：B-17×N + P-51×8 + 僚机 262×3 + 玩家已接近上限，30+ 架次时评估 InstancedMesh 方案

### 其他关卡
- **第 5 关《血战中途岛》**：`index.js` 已占位 + `stg5.png` 卡片图已备，从 0 搭建
- **第 1-3 关迭代**：库尔斯克地面物件放置（`交接文档_库尔斯克关卡.md` P1/P2 待实现）、不列颠 / 巴巴罗萨细节打磨

### 通用
- 玩家飞机专用调整工具（aimLift 座舱上抬 + aircraft.js 构造函数参数）
- 自由模式：更多地图开放、敌机 AI 多样化、得分/击落数显示
