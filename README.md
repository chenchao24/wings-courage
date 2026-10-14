# 勇气之翼 · Wings of Courage

基于 Three.js 的二战空战网页游戏（第三人称/座舱视角）。纯静态站，无构建步骤：`index.html` + importmap 指向 `/vendor/three`，入口 `js/main.js`，全部是原生 ES Module。

- 版本：**0.84**
- 渲染：Three.js r160（本地 `vendor/three`，不依赖 CDN）
- 音效：WebAudio 程序化合成 + 实录音频文件（引擎/枪声/命中）
- 详细文档：迭代时间线 [`docs/CHANGELOG.md`](./docs/CHANGELOG.md)、交接文档 [`docs/HANDOVER.md`](./docs/HANDOVER.md)、性能优化 [`docs/OPTIMIZATION.md`](./docs/OPTIMIZATION.md)、协作约定 [`AGENTS.md`](./AGENTS.md)

## 游戏内容

### 战役模式（已开放 4 关）

| 关卡 | 名称 | 玩家机型 | 内容 |
|------|------|----------|------|
| 1 | 风云不列颠 | Bf 109 E-4 | 英吉利海峡上空截击，含教学引导与战斗对话 |
| 2 | 巴巴罗萨之鹰 | Bf 109 E-4 | 东线平原护航/截击，剧情编队与友军轰炸机 |
| 3 | 鏖战库尔斯克 | Fw 190 A-4 | 突出部战场：Flak 防空火力、T-34 坦克区、波次敌机 |
| 4 | 柏林保卫战 | Me 262 A-1a | 喷气截击 B-17 轰炸机群：P-51 护航机群（8 架）、友军 262 僚机小队、防空走廊、交战高度规则（<2000m 倒计时）、Jumo 004 油门管理（80% 连续 / 90% 峰值限制） |

第 5-9 关已在关卡注册表占位（《血战中途岛》《马里亚纳猎杀火鸡日》等），尚未开放。

### 自由模式

独立地图/机型/难度自由组合的练习模式，与战役模式 100% 代码隔离（见 `AGENTS.md` 铁原则）。

- 可选机型：Bf 109 E-4 / Fw 190 A-4 / Me 262 A-1a（喷气机含尾流特效与油门管理，武器伤害 ×0.75）
- 可选敌机：I-16 / Spitfire / Yak-7 / Yak-9
- 地图：6 个槽位，当前开放"巴巴罗萨"（东线平原），其余待开放
- 难度多档可选（影响敌机 HP / 机动 / 火力）

## 本地运行

浏览器加载本地 `.glb` 模型与 ES 模块必须走 HTTP，**不能直接双击 index.html**。

```bash
# 方式一：双击 启动服务器.bat（Windows，自动开浏览器）
# 方式二：命令行
npx http-server -p 5173 -c-1 --cors
# 或
python -m http.server 5173
```

然后浏览器打开 `http://localhost:5173`。

> 主游戏只用 `vendor/three`，不需要 `npm install`；`npm install` 仅调参工具页（tools/）和资产管线脚本（scripts/）需要。

## 操作键位

| 按键 | 功能 |
| --- | --- |
| `W` / `S`（或 `↑` / `↓`） | 俯仰（W 推杆低头 / S 拉杆抬头） |
| `A` / `D`（或 `←` / `→`） | 滚转 |
| `Q` / `E` | 偏航（方向舵） |
| `Shift` / `Ctrl` | 油门 加 / 减 |
| `Space` | 开火（全部武器齐射） |
| `Z` / `X` | 仅机枪 / 仅机炮 |
| `C` | 追尾 ↔ 座舱视角（过场中：切换视角） |
| `V` | 循环观察视角（无准星） |
| `M` | 静音切换 |
| `Esc` | 暂停 / 继续（过场中：跳过） |

键位定义见 `js/controls.js`（飞行输入）与 `js/game/GameRuntime.js` `_handleKey`（视角/暂停），游戏内 HUD 右下角有可折叠的操作说明。

## 目录结构

```
darkWil-0.7/
├── index.html            # 游戏主入口（importmap → /vendor/three）
├── favicon.png
├── 启动服务器.bat         # Windows 一键起本地服务器（端口 5173）
├── package.json          # 仅调参工具与管线脚本需要 npm install
│
├── js/                   # 游戏源码（66 个文件）
│   ├── main.js           # 入口
│   ├── app/              # 页面与应用外壳（AppShell/Router/各页面）
│   ├── game/             # 运行时（GameRuntime 主循环/WaveDirector/HUD/柏林各子系统）
│   ├── config/levels/    # 战役四关配置
│   ├── config/freemode/  # 自由模式配置（隔离区）
│   ├── freemode/         # 自由模式运行时（隔离区）
│   └── aircraft.js / enemy.js / weapons.js / environment.js … # 机制层
│
├── vendor/three/         # three r160 本地依赖（build + examples/jsm 精选）
├── model/                # 飞机模型 .glb（含 b17/p51 的 .original.glb 管线备份）
├── sound/                # 音频（gun/ 枪声、eg/ 引擎实录循环、bl/ 柏林音乐、hit/ 命中擦过）
├── img/                  # UI 图片（关卡卡片、菜单背景、berlin/ 卫星地面贴图）
│
├── docs/                 # 文档（CHANGELOG.md、HANDOVER.md、OPTIMIZATION.md、
│                         #      上线前优化清单.md、柏林/、库尔斯克/、archive/ 历史稿）
├── scripts/              # 资产管线脚本（见下）
├── tools/                # 开发调参工具页（12 个 html + tune.js/tune_enemy.js + la5.config.json）
└── tests/                # Playwright 回归测试（tests/python/test_*.py，打 http://127.0.0.1:5173）
```

## 开发说明

### 调参工具（tools/）

`model_tuner.html`（敌机模型预处理）、`player_tuner*.html`（Bf109/Fw190/Me262 玩家机调试台）、`b17_tuner.html`（B-17 标定）、`tune.html` / `tune_enemy.html`（枪口/朝向）、`terrain_test.html`、`mapEditor.html` 等。

这些页面引用 `/node_modules/three`，需先 `npm install` 再起本地服务器，访问 `http://localhost:5173/tools/xxx.html`。调出的参数写回 `js/enemy.js` MODEL_CONFIGS 或各关 `playerConfig`。

### 回归测试（tests/）

`tests/python/test_*.py` 为 Playwright 截图/断言测试，需先起服务器（打 `http://127.0.0.1:5173`）：

- `test_campaign_regression.py` — 前三关回归（改共享代码后必跑）
- `test_berlin_level.py` — 第四关全流程（加载/出生点/高度规则三态/重置）
- 其余为各机型/场景的专项验证脚本；`tests/python/_diag/` 是辅助诊断脚本

### 资产管线（scripts/）

- `optimize_b17.mjs` / `optimize_p51.mjs` — 模型网格合并优化（`model/*.original.glb` 是管线输入备份，**不要删**；重跑前先读 `docs/HANDOVER.md` 注意事项）
- `inspect_glb.mjs` — GLB 结构检查（节点树/材质/包围盒）
- `fetch_berlin_ground.py` — 柏林卫星地面图获取（Sentinel-2 公开桶）
- `make_engine_loops.py` — 引擎实录无缝循环烘焙（→ `sound/eg/*-loop.wav`）

### 协作约定

**自由模式与战役模式必须 100% 代码隔离**，共享代码只加"缺省关闭/缺省原值"的门控分支。改动前请读 `AGENTS.md`。

## 技术栈与部署

- Three.js 0.160（本地 vendor）+ 原生 JS（ESM + importmap），无框架、无构建
- 模型 glTF .glb（meshopt/WebP 压缩，gltf-transform 离线管线）
- 部署：整目录上传到任意静态托管即可，无需构建；主游戏运行不依赖 `node_modules`

## 数据署名

- 第四关地面贴图：Contains modified Copernicus Sentinel data (2023)，Sentinel-2 L2A，经 `scripts/fetch_berlin_ground.py` 裁剪处理。
