# 项目文件索引 (PROJECT_INDEX)

> 二战空战游戏《勇气之翼 Wings of Courage》（darkWil）—— 基于 Three.js 的浏览器 3D 空战游戏
> 版本：**0.84** · 本文件为 AI 查询用索引，按分类组织，标注每个文件用途与关键入口。

---

## 0. 顶层目录树

```
darkWil-0.7/
├── index.html              # 游戏主入口（importmap → /vendor/three，加载 js/main.js）
├── favicon.png
├── 启动服务器.bat           # Windows 一键起本地服务器（npx http-server -p 5173）
├── package.json            # type:commonjs；依赖 three + @gltf-transform/*（仅 tools/ 与 scripts/ 需要 npm install）
├── README.md               # 项目说明（玩法/键位/运行/目录）
├── PROJECT_INDEX.md        # 本文件
├── AGENTS.md               # 协作约定（自由模式与战役模式 100% 隔离铁原则）
│
├── js/                     # 游戏源码（66 个文件，见 §1）
├── vendor/three/           # three r160 本地依赖：build/three.module.js + examples/jsm（controls/libs/loaders/objects/utils）
├── model/                  # 3D 模型 .glb（见 §2）
├── sound/                  # 音频（见 §3）
├── img/                    # UI 图片（见 §3）
│
├── docs/                   # 项目文档（见 §6）
├── scripts/                # 资产管线脚本（见 §4）
├── tools/                  # 开发调参工具页（见 §5）
├── tests/                  # Playwright 回归测试（见 §7）
│
├── node_modules/           # npm install 产物（.gitignore；tools/ 调参页与 scripts/ 管线用）
└── _archive/               # 本地归档（.gitignore，不随仓库上传）
    ├── backup_20260820/    # 历史实验备份（云层/斯图卡合并/自由模式 262 等改动前的快照）
    └── scripts/            # 退役管线脚本（convert_me262_specgloss.mjs、optimize_models.mjs 等）
```

---

## 1. 核心源码 `js/`（66 个文件）

### 1.1 入口与机制层（js/ 根，19 个文件）

| 文件 | 用途 |
|------|------|
| `js/main.js` | **游戏入口**，由 index.html 加载，初始化 AppShell |
| `js/aircraft.js` | `Aircraft` 基类：模型加载/校准/飞行物理/螺旋桨/损伤/坠毁/粒子（纯机制，无 AI 无关卡语义） |
| `js/enemy.js` | `Enemy extends Aircraft`：敌机 AI（巡逻/追击/规避/开火）、MODEL_CONFIGS 机型校准表 |
| `js/weapons.js` | 武器系统：曳光弹对象池、枪口特效、命中检测、随机伤害 |
| `js/controls.js` | `Controls`：键盘输入 + 响应曲线（0.08s 起步斜坡），飞行键位定义 |
| `js/audio.js` | `GameAudio`：WebAudio 合成 + 文件音效（引擎实录循环/枪声/命中 beHit/擦过 side） |
| `js/radar.js` | `Radar`：右下角圆形雷达 HUD（canvas 2D） |
| `js/environment.js` | `createEnvironment/disposeEnvironment`：环境总装入口（天空 shader/地形/建筑/云/海/战场） |
| `js/terrain.js` | `Terrain`：fbm 噪声地形 + 顶点着色，`getHeight(x,z)` |
| `js/ocean.js` | `Ocean`：海面渲染 |
| `js/clouds.js` | `Clouds`：云层（云系化可配：patchiness/yCoherent/distFade/extraBands，缺省=原行为） |
| `js/buildings.js` | `Buildings`：程序化村庄/松树，obstacleBoxes 供坠毁检测 |
| `js/groundTargets.js` | 地面目标（可命中物件） |

### 1.2 关卡专用模块（js/ 根）

| 文件 | 用途 |
|------|------|
| `js/kurskBattlefield.js` | 库尔斯克战场（防空阵地、T-34 坦克、炮位士兵） |
| `js/kurskRoads.js` | 库尔斯克道路网络 |
| `js/AntiAircraftFlak.js` | 防空火力视觉/音效（烟团/曳光/地面闪光；含柏林 corridor 走廊模式打 B-17 编队） |
| `js/berlinGround.js` | 柏林地面（纯平 + Sentinel-2 卫星贴图 80×64km + 视觉裙边，duck-type Terrain 接口） |
| `js/JetExhaust.js` | 喷气尾流特效（喷口辉光/尾气粒子/热浪锥，`jetNozzles` 配置门控） |
| `js/VaporTrail.js` | 翼尖拉烟/凝结尾迹 |

### 1.3 应用壳与页面 `js/app/`（15 个文件）

| 文件 | 用途 |
|------|------|
| `js/app/AppShell.js` | 应用壳：场景管理/页面路由/环境重建/关卡切换/柏林音乐接管 |
| `js/app/Router.js` | 页面路由器 |
| `js/app/Theme.js` | 全局样式（含暂停覆盖层、拦截进度 UI 的 CSS） |
| `js/app/pages/_base.js` | 页面基类 |
| `js/app/pages/CoverPage.js` | 封面页（`APP_VERSION` 版本号在此） |
| `js/app/pages/MenuPage.js` | 主菜单页 |
| `js/app/pages/LevelSelectPage.js` | 战役关卡选择页 |
| `js/app/pages/BriefingPage.js` | 任务简报页（进关卡入口） |
| `js/app/pages/HangarPage.js` | 机库页（机型展示） |
| `js/app/pages/SettingsPage.js` | 设置页 |
| `js/app/pages/FreeMapSelectPage.js` | 自由模式 · 地图选择页 |
| `js/app/pages/FreeHangarPage.js` | 自由模式 · 机库页（全屏 3D 展示台） |
| `js/app/ui/LoadingOverlay.js` | 加载遮罩 |
| `js/app/ui/Toggle.js` | UI 开关组件 |
| `js/app/ui/icons.js` | 图标定义 |

### 1.4 游戏运行时 `js/game/`（19 个文件）

| 文件 | 用途 |
|------|------|
| `js/game/GameRuntime.js` | **战役主循环**：每帧 update 全部系统；键位（C/V/M/Esc）在 `_handleKey`；全部关卡配置门控在此注入 |
| `js/game/WaveDirector.js` | 敌机波次导演（生成/撤退/波次推进） |
| `js/game/HudController.js` | HUD 控制器（速度/高度/G 力/血条/拦截进度等） |
| `js/game/hud-template.js` | HUD DOM 模板（含右下角操作说明键位表） |
| `js/game/Settings.js` | 游戏设置 |
| `js/game/DialogSystem.js` | 战斗对话系统（队列顺序播放） |
| `js/game/CinematicSystem.js` | 过场动画系统（剧情编队；C 切视角 / Esc 跳过） |
| `js/game/Tutorial.js` | 教程引导 |
| `js/game/LevelMusic.js` | 关卡音乐管理器（主题曲/战斗曲切换，淡入淡出） |
| `js/game/FriendlyBomber.js` | 友军轰炸机 NPC（第 1/2 关） |
| `js/game/HeavyBomber.js` | **B-17 重轰炸机群**（直飞/受伤返航/炮塔多目标提前量/四式坠毁） |
| `js/game/Wingman262Squadron.js` | **友军 Me 262 僚机小队**（指尖编队 → 1500m 解除 → 六模式猎杀表演/规避） |
| `js/game/WingmanJetTrail.js` | 僚机喷流尾迹（THREE.Points 软圆斑，每架 1 draw call） |
| `js/game/P51EscortSquadron.js` | **P-51 护航机群**（8 架 2 中队 4 小队：伴飞/拦截/猎杀/协同 + 防撞规避） |
| `js/game/BerlinOpening.js` | 柏林 15s 推镜开场（鸭式复用 CinematicSystem 接线） |
| `js/game/BerlinChatter.js` | 柏林专属喊话（开局 8 句 + 战斗 6 类，战斗开始门控） |
| `js/game/BerlinMusic.js` | 柏林多段序列音乐（m1→elg→m2→交替→[进度≥90%]m3） |
| `js/game/CombatAltRule.js` | 交战高度规则（`combatAlt` 门控：<2000m 倒计时判负或重置 4000m） |
| `js/game/JetThrottleGovernor.js` | 喷气油门管理（`jetThrottle` 门控：80% 连续/90% 峰值/冷却回落） |

### 1.5 战役关卡配置 `js/config/levels/`

| 文件 | 用途 |
|------|------|
| `js/config/levels/index.js` | 关卡注册中心（9 关元数据，`UNLOCKED_IDS` 当前开放前 4 关） |
| `js/config/levels/level_01_britain.js` | 第 1 关《风云不列颠》（Bf 109 E-4） |
| `js/config/levels/level_02_barbarossa.js` | 第 2 关《巴巴罗萨之鹰》（Bf 109 E-4，`engineSoundFile` 引擎实录） |
| `js/config/levels/level_03_kursk.js` | 第 3 关《鏖战库尔斯克》（Fw 190 A-4，`flak` 防空配置块） |
| `js/config/levels/level_04_berlin.js` | 第 4 关《柏林保卫战》（Me 262：`combatAlt`/`jetThrottle`/`jetNozzles`/`bomberStream`/`escortP51`/`wingmen262`/`chatter`/`berlinMusic`/`intercept`/`downed`） |
| `js/config/default-settings.js` | 默认设置 |

### 1.6 自由模式 `js/freemode/` + `js/config/freemode/`（与战役 100% 隔离，见 AGENTS.md）

| 文件 | 用途 |
|------|------|
| `js/freemode/FreeModeRuntime.js` | 自由模式运行时（不 extends GameRuntime；含喷气机门控分支） |
| `js/freemode/FreeModeEnemy.js` | 自由模式敌机（extends Aircraft，不 extends Enemy，AI 配置独立） |
| `js/freemode/FreeModeMaps.js` | 自由模式地图实际配置（环境/出生点） |
| `js/config/freemode/aircraft.js` | 玩家机型配置（Bf109/Fw190/Me262，Me262 武器伤害 ×0.75） |
| `js/config/freemode/enemy-aircraft.js` | 敌机机型配置（I-16/Spitfire/Yak-7/Yak-9） |
| `js/config/freemode/maps.js` | 地图元数据（6 槽位，当前开放"巴巴罗萨"） |
| `js/config/freemode/difficulty.js` | 难度乘数（敌机 HP/机动/火力、玩家 HP） |

---

## 2. 3D 模型 `model/`

| 文件 | 机型 |
|------|------|
| `bf109_opt.glb` | Bf 109 E-4（第 1/2 关玩家机，meshopt+WebP 优化版） |
| `fw_190_a-4.glb` / `fw_190_a-5.glb` | Fw 190 A-4/A-5（第 3 关玩家机） |
| `me_262.glb` | Me 262 A-1a（第 4 关玩家机，已转标准 PBR） |
| `me_262_specgloss_backup.glb` | me_262 转换前 spec-gloss 备份 |
| `b17.glb` | B-17 轰炸机（网格合并优化后：116→26 mesh/架） |
| `b17.original.glb` | B-17 管线输入备份（**勿删**，重跑 `optimize_b17.mjs` 需要） |
| `p51.glb` / `p51.original.glb` | P-51（32→9 draw call/架 优化 + 管线备份） |
| `spitfire.glb` | 喷火（英） |
| `yak1.glb` / `yak3.glb` / `yak7.glb` / `yak9.glb` | Yak 系列（苏） |
| `la5.glb` | La-5（苏） |
| `i16.glb` / `i153.glb` | I-16 / I-153（苏） |
| `il2.glb` | Il-2 对地攻击机（苏） |
| `he111.glb` / `ju87.glb` / `ju88.glb` | He-111 / Ju-87 / Ju-88（德） |

---

## 3. 资源 `sound/` `img/`

| 目录 | 内容 |
|------|------|
| `sound/` | `mainTitle.mp3`（主标题乐）、`adevnAs/fight/highWar/kersk.mp3`（各关音乐） |
| `sound/bl/` | 柏林多段音乐 `elg/m2/m3.mp3`（m1 用根目录 `highWar.mp3`） |
| `sound/eg/` | 引擎实录无缝循环 `bf109/fw190/me262-eg-loop.wav`（`scripts/make_engine_loops.py` 烘焙） |
| `sound/gun/` | 机型枪声 `bf109-792/bf109-20/fw190-131-2/fw190-151-2/mk108.mp3` |
| `sound/hit/` | 全局命中玩家 `beHit01-03.mp3` + 子弹擦过 `side1-3.mp3` |
| `img/` | `mb1/2.png`（菜单背景）、`stg1-6.png`（关卡卡片/过场图）、`gem/`（图标） |
| `img/berlin/` | Sentinel-2 卫星地面贴图 `ground.jpg`（第 4 关，`fetch_berlin_ground.py` 产物） |

---

## 4. 资产管线脚本 `scripts/`

| 文件 | 用途 |
|------|------|
| `scripts/optimize_b17.mjs` | B-17 网格合并优化（读 `b17.original.glb` → 写 `b17.glb`；`helice03_FACES01-FACES` 节点不能删，桨叶组节点名是 pivot 查找键） |
| `scripts/optimize_p51.mjs` | P-51 网格合并优化（读 `p51.original.glb` → 写 `p51.glb`） |
| `scripts/inspect_glb.mjs` | GLB 结构检查（节点树/材质/纹理/包围盒） |
| `scripts/fetch_berlin_ground.py` | 柏林卫星地面图获取（Sentinel-2 AWS 公开桶，Python venv 在 `scripts/.venv-ground/`） |
| `scripts/make_engine_loops.py` | 引擎实录无缝循环烘焙（裁头/周期对齐/交叉淡化 → `*-loop.wav`） |

退役脚本（`optimize_models.mjs`、`convert_me262_specgloss.mjs`、`_perf_models.mjs`、`draw_berlin_layout.py`）已移入 `_archive/scripts/`。

---

## 5. 调参工具页 `tools/`

12 个 HTML 调试页 + 配套脚本。**引用 `/node_modules/three`（非 /vendor），需先 `npm install` 再起本地服务器**，访问 `http://localhost:5173/tools/xxx.html`。

| 文件 | 用途 |
|------|------|
| `model_tuner.html` | 敌机模型预处理（4 Tab，导出 → `js/enemy.js` MODEL_CONFIGS） |
| `player_tuner.html` | Bf 109 玩家机调试台 |
| `player_tuner_fw190.html` | Fw 190 玩家机调试台（导出 → `level_03_kursk.js` playerConfig） |
| `player_tuner_me262.html` | Me 262 玩家机调试台（枪口/喷气口/座舱/物理，导出 → `level_04_berlin.js` playerConfig） |
| `b17_tuner.html` | B-17 标定台 |
| `tune.html` + `tune.js` | 玩家火炮位置调试 |
| `tune_enemy.html` + `tune_enemy.js` | 敌机朝向/枪口调试 |
| `tune_prop.html` | 螺旋桨调参 |
| `tune_yak_models.html` | Yak 模型检查 |
| `terrain_test.html` | 地形测试 |
| `mapEditor.html` | 地图编辑器 |
| `roadMap.html` | 路线图 |
| `la5.config.json` | La-5 调参配置 |

---

## 6. 文档 `docs/`

| 文件 | 内容 |
|------|------|
| `docs/CHANGELOG.md` | 功能迭代时间线（#1-#83） |
| `docs/HANDOVER.md` | 交接文档（现状/约束/文件清单/下一步） |
| `docs/OPTIMIZATION.md` | 性能优化记录 |
| `docs/上线前优化清单.md` | 上线前优化清单 |
| `docs/Flak防空火力参数说明.md` | Flak 参数速查 |
| `docs/柏林喊话审核.md` / `docs/界面文本审核.md` | 第 4 关喊话与界面文本审核 |
| `docs/berlin_initial_layout.png` | 柏林初始布局图（俯视/侧视/玩家编队 inset） |
| `docs/柏林/` | 柏林关卡交接文档与喊话文本 |
| `docs/库尔斯克/` | 库尔斯克交接/地图点位/对话剧本/剧情脚本 |
| `docs/archive/` | 历史稿（DESIGN.md、DEBUG_BUG_LOG.md、Flak 设计文档、IL2 设定、调试笔记、参考图片等） |

---

## 7. 测试 `tests/`

Playwright 截图/断言测试，**需先起本地服务器（打 `http://127.0.0.1:5173`）**，Python 运行。

| 文件 | 测试内容 |
|------|----------|
| `tests/python/test_campaign_regression.py` | **前三关回归（改共享代码后必跑）** |
| `tests/python/test_berlin_level.py` | 第 4 关全流程（加载/出生点/高度规则三态/重置） |
| `tests/python/test_britain_level.py` | 不列颠关卡加载 |
| `tests/python/test_p2_full.py` | 第 2 关完整流程 |
| `tests/python/test_lock_altitude.py` / `test_ocean_verify.py` | 高度锁定 / 海面渲染验证 |
| `tests/python/test_spit_*.py` 等 | 喷火模型专项（高度/枪口/螺旋桨/节点树/偏航） |
| `tests/python/_diag/` | 辅助诊断脚本（B-17 特效/柏林裙边/出生点分布等截图脚本） |

测试截图产物（`tests/screenshots/`、`tests/test_shots/`）已 gitignore，可再生成。

---

## 8. 关键调用链（AI 快速定位）

```
index.html（importmap → /vendor/three）
  └─ js/main.js
       └─ js/app/AppShell.js → Router → pages/*
            ├─ BriefingPage → GameRuntime（战役，js/game/GameRuntime.js）
            │    ├─ environment.js: createEnvironment(levelConfig)
            │    │    ├─ Terrain / Ocean / Clouds / Buildings
            │    │    ├─ KurskBattlefield + AntiAircraftFlak（库尔斯克/柏林）
            │    │    └─ BerlinGround（柏林，theme:'berlin' 唯一入口）
            │    ├─ Aircraft（玩家）→ Controls → Weapons
            │    ├─ Enemy → WaveDirector
            │    ├─ HeavyBomber（B-17 机群）/ P51EscortSquadron / Wingman262Squadron（柏林）
            │    ├─ DialogSystem / CinematicSystem / Tutorial
            │    ├─ CombatAltRule / JetThrottleGovernor（配置门控）
            │    └─ HudController / Radar / LevelMusic（BerlinMusic 接管）
            └─ FreeHangarPage → FreeModeRuntime（自由模式，js/freemode/，隔离区）
```

- **键位**：飞行输入 `js/controls.js`；C/V/M/Esc 在 `GameRuntime._handleKey`（自由模式同款在 `FreeModeRuntime._handleKey`）
- **Flak 每帧更新**：`GameRuntime` 主循环 → `AntiAircraftFlak.update(dt, playerPos)` → 分区发射 → 地面闪光 + `audio.flakExplosion(distance)`
- **柏林开场**：`BerlinOpening`（15s 推镜）→ 僚机轨载钉死槽位 → 交接 `Wingman262Squadron` 编队

---

## 9. 技术栈

- **渲染**：Three.js 0.160（ES Module + importmap；主游戏用 `/vendor/three`，调参页用 `/node_modules/three`）
- **语言**：原生 JavaScript（ESM），无框架、无构建步骤
- **模型**：glTF .glb，meshopt/WebP 压缩（gltf-transform 离线管线）
- **音效**：Web Audio API（程序化合成 + MP3/WAV 文件）
- **测试**：Python + Playwright
- **部署**：纯静态站，整目录上传即可；主游戏运行不依赖 `node_modules`
