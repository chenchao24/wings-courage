# 项目文件索引 (PROJECT_INDEX)

> 二战空战游戏 darkWil —— 基于 Three.js 的浏览器 3D 空战游戏
> 本文件为 AI 查询用索引，按分类组织，标注每个文件用途与关键入口。

---

## 0. 顶层目录树

```
darkWil-0.3/
├── index.html              # 游戏主入口
├── package.json            # npm 配置（type:module）
├── la5.config.json         # 项目配置
├── _serve.cjs              # 本地静态服务器
├── serve.bat / 启动服务器.bat  # 启动脚本
├── README.md
├── PROJECT_INDEX.md        # 本文件
│
├── js/                     # 核心源码
├── model/                  # 3D 模型 (.glb)
├── sound/                  # 音效 (.mp3)
├── img/                    # UI 图片
├── scripts/                # 构建/优化脚本
├── tests/                  # 测试脚本与截图
├── docs/                   # 项目文档
│
├── mapEditor.html          # 调试页面（地图编辑器）
├── model_tuner.html        # 调试页面（模型调参）
├── player_tuner.html       # 调试页面（玩家飞机调参）
├── player_tuner_fw190.html # 调试页面（FW190 调参）
├── player_tuner_me262.html # 调试页面（Me 262 调参：枪口/喷气口/节点显隐/座舱/物理）
├── terrain_test.html       # 调试页面（地形测试，引用 js/）
├── tune.html               # 调试页面（通用调参，引用 js/tune.js）
├── tune_enemy.html         # 调试页面（敌机调参，引用 js/tune_enemy.js）
├── tune_prop.html          # 调试页面（螺旋桨调参）
├── tune_yak_models.html    # 调试页面（Yak 模型检查）
└── roadMap.html            # 调试页面（路线图）
```

> **注意**：根目录的 `*.html` 调试页面引用了 `./js/` 相对路径，不可移动。

---

## 1. 核心源码 `js/`

### 1.1 入口与核心系统

| 文件 | 用途 |
|------|------|
| `js/main.js` | **游戏入口**，由 index.html 加载，初始化 AppShell |
| `js/aircraft.js` | `Aircraft` 类：飞机实体（玩家/敌机），物理、姿态、GLTF 加载 |
| `js/enemy.js` | `Enemy` 类：敌机 AI（追击、射击、机动决策） |
| `js/weapons.js` | 武器系统：射击、子弹、枪口闪光、命中检测 |
| `js/controls.js` | `Controls` 类：键鼠/手柄输入映射 |
| `js/audio.js` | 音效系统：引擎、射击、爆炸、Flak 爆炸声（程序化合成） |

### 1.2 环境与场景

| 文件 | 用途 |
|------|------|
| `js/environment.js` | `createEnvironment/disposeEnvironment`：环境构建总入口，组装地形/建筑/云/海/战场 |
| `js/terrain.js` | `Terrain`：程序化地形高度图，`getHeight(x,z)` |
| `js/ocean.js` | `Ocean`：海面渲染 |
| `js/clouds.js` | `Clouds`：云层系统（含块状分布 patchiness / 高度相干 yCoherent / 距离淡出 distFade / 多层 extraBands 等可选配置，缺省=原行为） |
| `js/buildings.js` | `Buildings`：建筑物放置 |
| `js/groundTargets.js` | 地面目标（车辆、建筑等可命中目标） |
| `js/targets.js` | 目标系统（任务目标管理） |
| `js/radar.js` | `Radar`：雷达 HUD 显示 |

### 1.3 库尔斯克关卡专用

| 文件 | 用途 |
|------|------|
| `js/kurskBattlefield.js` | `KurskBattlefield`：库尔斯克战场构建（防空炮、T34 坦克、士兵、补给车、弹坑） |
| `js/kurskRoads.js` | `KurskRoads`：库尔斯克道路网络 |
| `js/AntiAircraftFlak.js` | `AntiAircraftFlak`：防空火力视觉系统（烟团、曳光弹、爆炸声、地面开炮闪光） |

### 1.3.1 柏林关卡专用（第4关）

| 文件 | 用途 |
|------|------|
| `js/berlinGround.js` | `BerlinGround`：柏林地面（纯平 + Sentinel-2 卫星贴图 80×64km，duck-type Terrain 接口） |
| `js/JetExhaust.js` | `JetExhaust`：喷气尾流特效（喷口辉光/尾气粒子空间发射/热浪锥 shader，`jetNozzles` 配置门控） |

### 1.4 调参脚本（被根目录调试页面引用）

| 文件 | 用途 |
|------|------|
| `js/tune.js` | 通用调参逻辑，被 `tune.html` 引用 |
| `js/tune_enemy.js` | 敌机调参逻辑，被 `tune_enemy.html` 引用 |

### 1.5 应用壳与页面 `js/app/`

| 文件 | 用途 |
|------|------|
| `js/app/AppShell.js` | 应用壳：页面路由与状态管理 |
| `js/app/Router.js` | 路由器 |
| `js/app/Theme.js` | 主题样式 |
| `js/app/pages/_base.js` | 页面基类 |
| `js/app/pages/CoverPage.js` | 封面页 |
| `js/app/pages/MenuPage.js` | 主菜单页 |
| `js/app/pages/LevelSelectPage.js` | 关卡选择页 |
| `js/app/pages/BriefingPage.js` | 任务简报页 |
| `js/app/pages/HangarPage.js` | 机库页 |
| `js/app/pages/SettingsPage.js` | 设置页 |
| `js/app/pages/FreeMapSelectPage.js` | 自由模式 · 地图选择页 |
| `js/app/pages/FreeHangarPage.js` | 自由模式 · 机库页（全屏 3D 展示台） |
| `js/app/ui/Toggle.js` | UI 开关组件 |
| `js/app/ui/LoadingOverlay.js` | 加载遮罩 |
| `js/app/ui/icons.js` | 图标定义 |

### 1.6 游戏运行时 `js/game/`

| 文件 | 用途 |
|------|------|
| `js/game/GameRuntime.js` | **游戏主循环**：每帧 update 所有系统，`this.player?.root?.position` 传给 Flak |
| `js/game/HudController.js` | HUD 控制器 |
| `js/game/hud-template.js` | HUD 模板 |
| `js/game/Settings.js` | 游戏设置 |
| `js/game/DialogSystem.js` | 战斗对话系统 |
| `js/game/CinematicSystem.js` | 过场动画系统 |
| `js/game/WaveDirector.js` | 敌机波次导演 |
| `js/game/LevelMusic.js` | 关卡音乐管理器（主题曲间隔循环 + 战斗高潮曲切换，淡入淡出） |
| `js/game/FriendlyBomber.js` | 友军轰炸机 |
| `js/game/Tutorial.js` | 教程引导 |
| `js/game/CombatAltRule.js` | 交战高度规则（仅 `combatAlt` 配置关卡，如第4关：警告/倒计时/失败或重置二选一） |
| `js/game/JetThrottleGovernor.js` | 喷气油门管理器（仅 `jetThrottle` 配置关卡：峰值功率限制/冷却/回落） |
| `js/game/WingmanJetTrail.js` | 僚机简化喷气尾流（仅第4关僚机：THREE.Points 软粒子喷流，无热浪锥/辉光，每架 1 draw call） |

### 1.7 关卡配置 `js/config/`

| 文件 | 用途 |
|------|------|
| `js/config/default-settings.js` | 默认设置 |
| `js/config/levels/index.js` | 关卡索引 |
| `js/config/levels/level_01_britain.js` | 第一关：不列颠空战 |
| `js/config/levels/level_02_barbarossa.js` | 第二关：巴巴罗萨行动（含 `playerConfig.engineSoundFile` 引擎实录） |
| `js/config/levels/level_03_kursk.js` | 第三关：库尔斯克（含 `flak` 防空配置块、坦克区、引擎实录） |
| `js/config/levels/level_04_berlin.js` | 第四关：柏林保卫战（Me 262 喷气机，`combatAlt` 高度规则、`jetThrottle` 油门管理、`jetNozzles` 尾流、卫星贴图地面、多层云系） |

### 1.8 自由模式 `js/freemode/` + `js/config/freemode/`（与战役模式 100% 隔离）

| 文件 | 用途 |
|------|------|
| `js/freemode/FreeModeEnemy.js` | 自由模式敌机类（extends Aircraft，不 extends Enemy，独立 AI 配置） |
| `js/freemode/FreeModeRuntime.js` | 自由模式运行时（不 extends GameRuntime） |
| `js/freemode/FreeModeMaps.js` | 自由模式地图配置（玩家出生 [0,2000,0]） |
| `js/config/freemode/aircraft.js` | 玩家机型配置（Bf109/Fw190，含 previewOffset 预览偏移） |
| `js/config/freemode/enemy-aircraft.js` | 敌机机型配置（I-16/Spitfire/Yak-7/Yak-9） |
| `js/config/freemode/maps.js` | 地图列表（6 个，巴巴罗萨开放） |
| `js/config/freemode/difficulty.js` | 难度 + 时间限制 |

---

## 2. 3D 模型 `model/`

| 文件 | 机型 |
|------|------|
| `spitfire.glb` | 喷火 (英) |
| `bf109_opt.glb` | Bf-109 (德) |
| `fw_190_a-4.glb`, `fw_190_a-5.glb` | FW-190 A-4/A-5 (德) |
| `yak1.glb`, `yak3.glb`, `yak7.glb`, `yak9.glb` | Yak 系列 (苏) |
| `la5.glb` | La-5 (苏) |
| `i16.glb`, `i153.glb` | I-16 / I-153 (苏) |
| `il2.glb` | Il-2 对地攻击机 (苏) |
| `p51.glb` | P-51 (英/美) |
| `b17.glb` | B-17 轰炸机 (英/美) |
| `me_262.glb` | Me 262 A-1a 喷气截击机 (德，第4关玩家机；已转标准 PBR 材质) |
| `me_262_c-2b.glb` | Me 262 C-2b (德，备用) |
| `me_262_specgloss_backup.glb` | me_262 原始 spec-gloss 备份（转换前） |
| `he111.glb` | He-111 轰炸机 (德) |
| `ju87.glb` | Ju-87 俯冲轰炸机 (德) |
| `ju88.glb` | Ju-88 轰炸机 (德) |

---

## 3. 资源 `sound/` `img/`

| 目录 | 内容 |
|------|------|
| `sound/` | `mainTitle.mp3`（主标题乐）, `adevnAs.mp3`, `shoot01/02.mp3`（射击音）, `sound/gun/`（机型枪声：mk108/fw190-151 等）, `sound/eg/`（引擎实录：bf109/fw190/me262-eg.mp3 + `-loop.wav` 无缝循环烘焙版） |
| `img/` | `mb1/2.png`（主菜单背景）, `stg1-6.png`（过场图）, `img/gem/`（图标资源）, `img/berlin/`（Sentinel-2 卫星地面贴图 ground.jpg，第4关） |

---

## 4. 构建脚本 `scripts/`

| 文件 | 用途 |
|------|------|
| `scripts/optimize_models.mjs` | glTF 模型优化（压缩、去冗余） |
| `scripts/inspect_glb.mjs` | GLB 结构检查（节点树/材质/纹理/包围盒） |
| `scripts/convert_me262_specgloss.mjs` | me_262.glb 旧 spec-gloss 材质 → 标准 PBR 转换（一次性） |
| `scripts/fetch_berlin_ground.py` | 柏林卫星地面图获取管线（Sentinel-2 AWS 公开桶，含覆盖率/云量过滤） |
| `scripts/make_engine_loops.py` | 引擎实录无缝循环烘焙（裁头/周期对齐/交叉淡化 → -loop.wav） |

---

## 5. 测试 `tests/`

### 5.1 Python 测试 `tests/python/`

| 文件 | 测试内容 |
|------|----------|
| `test_britain_level.py` | 不列颠关卡加载测试 |
| `test_lock_altitude.py` | 高度锁定测试 |
| `test_ocean_verify.py` | 海面渲染验证 |
| `test_p2_full.py` | 第二关完整流程测试 |
| `test_scan_spitfire_alt.py` | 喷火高度扫描 |
| `test_spitfire_new.py` | 喷火新模型测试 |
| `test_spit_debug.py` | 喷火调试 |
| `test_spit_muzzle.py` | 喷火枪口闪光 |
| `test_spit_prop.py` | 喷火螺旋桨 |
| `test_spit_tree.py` | 喷火节点树 |
| `test_tune_spitfire_yaw.py` | 喷火偏航调参 |
| `test_berlin_level.py` | 第四关柏林全流程（加载/出生点/高度规则三态/重置） |
| `test_campaign_regression.py` | 前三关隔离回归（改第4关后必跑） |

### 5.2 测试截图与数据 `tests/screenshots/`

- `*.png` — 各测试截图（封面、菜单、关卡、战斗、喷火各角度、海洋验证等）
- `*.json` — 调试数据（`spit_muzzle_check.json`, `spit_nodes.json`, `spit_tree.json`）
- `*.html` — 内联调试页（`test_prop_pivot.html` 引用 `/js/aircraft.js`，`_temp_orient_check.html`）
- `*.py` — 截图辅助脚本（`diag_yak1_orient.py`, `test_orient_check.py`）

---

## 6. 文档 `docs/`

### 6.1 顶层文档

| 文件 | 内容 |
|------|------|
| `docs/CHANGELOG.md` | 变更日志 |
| `docs/DESIGN.md` | 设计文档（架构、视觉规范） |
| `docs/HANDOVER.md` | 交接文档 |
| `docs/DEBUG_BUG_LOG.md` | Bug 调试记录 |
| `docs/OPTIMIZATION.md` | 性能优化记录 |
| `docs/IL2设定文档.md` | Il-2 设定（后炮塔枪口闪光等） |
| `docs/Flak防空火力参数说明.md` | **Flak 参数速查**（区域、炮位、烟团、曳光弹、音效、闪光、3D 模型） |
| `docs/Flak防空火力设计文档.md` | Flak 设计文档 |
| `docs/glTF缓存克隆与战斗对话系统文档.md` | glTF 缓存与对话系统 |
| `docs/海面雪花修正及海洋场景优化文档.md` | 海面优化 |
| `docs/dialog_level1_split.md` | 第一关对话拆分 |

### 6.2 库尔斯克 `docs/库尔斯克/`

| 文件 | 内容 |
|------|------|
| `交接文档_库尔斯克关卡.md` | 库尔斯克关卡交接 |
| `库尔斯克补充点位图（防空和坦克）.md` | **防空区域与坦克区地图点位**（Flak 配置依据） |
| `库尔斯克地图点位.md` | 原始地图点位 |
| `库尔斯克对话剧本.md` | 对话剧本 |
| `库尔斯克构思.md` | 关卡构思 |
| `库尔斯克剧情脚本.md` | 剧情脚本 |

### 6.3 调试笔记 `docs/调试笔记/`

| 文件 | 内容 |
|------|------|
| `111.md` | 零散笔记 |
| `88.md` | 零散笔记 |
| `不列颠剧情脚本.md` | 不列颠剧情 |
| `FW190螺旋桨透明切割方案.md` | FW190 螺旋桨方案 |

### 6.4 参考图片 `docs/参考图片/`

4 张 `.jpeg` 参考图（地图/场景参考）。

---

## 7. 关键调用链（AI 快速定位）

```
index.html
  └─ js/main.js
       └─ js/app/AppShell.js → Router → pages/*
            └─ BriefingPage → GameRuntime (js/game/GameRuntime.js)
                 ├─ environment.js: createEnvironment(levelConfig)
                 │    ├─ Terrain, Ocean, Clouds, Buildings
                 │    ├─ KurskBattlefield (防空炮3D模型 + T34坦克 + 士兵)
                 │    └─ AntiAircraftFlak (烟团/曳光弹/爆炸声/地面闪光)
                 ├─ Aircraft (玩家) → Controls → Weapons
                 ├─ Enemy → WaveDirector
                 ├─ DialogSystem, CinematicSystem
                 └─ HudController, Radar
```

**Flak 每帧更新**：`GameRuntime.js:983` → `AntiAircraftFlak.update(dt, playerPos)` → 分区发射 → `_emitBurstFromZone`/`_emitBurstFromGun` → `_spawnGroundFlash` + `audio.flakExplosion(distance)`

---

## 8. 技术栈

- **渲染**：Three.js（ES Module，importmap）
- **语言**：JavaScript（ES Module，`package.json` type:module）
- **模型**：glTF (.glb)，DRACO/meshopt 压缩
- **音效**：Web Audio API（程序化合成 + MP3 文件）
- **测试**：Python（Playwright/截图脚本）
- **服务器**：`_serve.cjs`（Node.js 静态服务器）