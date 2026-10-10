# Bf 109 E-4 · 空战测试场

二战德国活塞式战斗机（Messerschmitt Bf 109 E-4）的 Web 空战游戏。当前阶段：玩家驾驶 Bf 109 E-4 与一架 Yak-9 敌机进行单机空战，含完整损伤状态机、坠毁双模式与街机飞行物理。

> 📌 详细设计见 [`docs/DESIGN.md`](./docs/DESIGN.md)，Bug 修复记录见 [`docs/DEBUG_BUG_LOG.md`](./docs/DEBUG_BUG_LOG.md)，功能迭代时间线见 [`docs/CHANGELOG.md`](./docs/CHANGELOG.md)。

## 启动方式

浏览器加载本地 `.glb` 模型与 ES 模块必须走 HTTP，**不能直接双击 index.html**，需要起一个本地静态服务器：

```bash
# 在项目根目录任选一种
npx http-server -p 5173 -c-1 --cors   # 推荐（带 -c-1 关缓存）
# 或
npx serve .
# 或
python -m http.server 5173
```

然后浏览器打开 `http://localhost:5173`（端口看启动提示）。

## 当前功能

### 玩家（Bf 109 E-4）
- **模型加载**：默认加载优化版 `model/bf109_opt.glb`（约 4.4MB，meshopt+WebP，压缩到原体积 18.6%）；URL 加 `?model=raw` 回退原版 23.5MB。预置 DRACO + meshopt 解码器。
- **螺旋桨动画**：模型把螺旋桨 / 起落架 / 座舱盖 / 座舱开关共 576 条轨道全烘焙进同一个 `Animation` 片段。程序只抽取节点名含 `prop` 的 30 条轨道合成纯净螺旋桨片段循环播放，转速随油门变化。
- **螺旋桨多状态**：Prop_Set 下有 anim/slow/blur 三套重叠叶片，propMode 控制只显示一套（默认 blur 模糊盘）。
- **飞行控制**：街机式物理——角速度模型 + 阻尼回中 + 滚转-偏航耦合 + 重力/升力 + 失速预警 + G 力软限制 + 输入响应曲线（0.08s 起步斜坡）。
- **开火**：4 挺机枪（机翼 2 + 机头 2）曳光弹对象池，交替射击，带枪口火光/火花/稀薄烟雾粒子。
- **坠毁**：撞地（高速）/撞建筑触发爆炸粒子 + 镜头震动 + 自动复位；低速轻触地不坠毁。

### 敌机（Yak-9）
- **最初级 AI**：巡逻盘旋为主（绕中央区域 8 个 waypoint），被咬尾时简单桶滚规避（冷却 7-12s），攻击欲望低（仅玩家凑到正前方窄锥 0.15rad 内、200-500m 才开火，开火 0.5s + 冷却 2.5-5s）。
- **优先级**：撞地拉起（agl<120m）> 高度上限下降（>1000m）> 规避中 > 巡逻/靠近 > 开火判定。
- **机动略低于玩家**：maxSpeed 150、pitchMax 1.0、rollMax 2.0；**火力略高**：fireRate 0.06（玩家 0.07）、单发伤害 8-12（玩家 8-20）。
- **重生**：坠毁后重生在玩家前方 1400-1900 单位外随机方位，机头朝向玩家。

### 损伤与坠毁系统
- **随机伤害**：弃用固定值，改为 `damageMin/damageMax` 范围随机，模拟击中装甲区 vs 要害区的不确定性。
- **损伤状态机**：
  - HP ≤ 30：机身中段冒轻度黑灰透明烟
  - HP = 0：加重烟雾 + 火焰，停止机动，进入坠毁
  - 坠毁中累计受击伤害 > 20：触发空中爆炸（火光 Sprite + 深烟团 + 火星 Mesh + 旋转碎片）
- **坠毁双模式**（随机）：
  - 70% **弹道模式**（ballistic）：机头快速低头至近垂直俯冲，3 倍重力加速坠毁
  - 30% **挣扎模式**（struggle）：保留 80% 前飞速度，2 倍重力快速下降，小幅度滚转/偏航/俯仰振荡，模拟受损勉强可飞
- **坠落与重生解耦**：触地 → 爆炸 → 3s 粒子淡出 → 重生；30s 安全阀防异常永不触地。每架敌机独立实例，支持未来多敌机。

### 环境
- **天空**：自定义 ShaderMaterial 渐变天空球（天顶 0x3a7fd6 → 中段 0x7fb8e8 → 地平线 0xc8e0f4）+ 太阳方向散射光晕，toneMapped=false 保留饱和度。已弃用 Preetham 物理天空（ACES 下饱和度不足）。
- **地形**：fbm 噪声高度 + 顶点着色（草/土/麦田/森林/岩石按高度坡度），东欧平原缓起伏，18000² / 320 segments。getHeightCached 缓存。
- **建筑**：程序化平房村庄（小屋/谷仓/教堂尖顶）+ 松树（圆锥堆叠）。共享几何/材质。obstacleBoxes 供坠毁，centers 供雷达。
- **云层**：28 团，每团 4-7 个 Sprite 错位叠加成不规则大云团，高度 1000-1700 高空带，跟随玩家循环回收（recycleR 2000）。
- **光照**：HemisphereLight + DirectionalLight（带阴影），雾 FogExp2 偏蓝营造高空感并隐藏大地方形边界。

### HUD 与视角
- **多视角**：追尾 / 斜后 / 斜前 / 正上方 / 座舱（座舱模式右键拖拽自由视野）。C 键循环切换。
- **HUD**：G力 / 速度 / 高度 / 油门条 / 命中数 / 失速警告 / 坠毁提示 / 玩家与敌机血量条 / 动态准星（投影到机头前方瞄准点）。
- **雷达**：右下角圆形雷达 HUD（canvas 2D），玩家居中机头朝上，敌机显示为红点、建筑为灰点，超出 1.5km 范围的目标在边缘显示指示三角，带缓慢旋转扫描线。
- **屏幕敌机指示器**：屏幕外敌机显示边缘三角箭头（NDC 坐标判定，范围 -1.05 到 1.05）。
- **音效**：WebAudio 程序化合成（无外部音频文件）——引擎（锯齿+三角+气流噪声，音调随油门）/ 机枪（噪声 burst + 低频 thump）/ 命中（方波下扫）/ 爆炸（低通噪声长衰减 + 低频冲击波）。M 键静音切换。

## 操作

| 按键 | 功能 |
| --- | --- |
| `W` / `S` | 俯仰（低头 / 抬头） |
| `A` / `D` | 滚转（左 / 右） |
| `Q` / `E` | 偏航（方向舵 左 / 右） |
| `Shift` / `Ctrl` | 油门 加 / 减 |
| `Space` | 开火 |
| `C` | 切换视角 |
| `G` | 开关地面网格 |
| `R` | 重置位置 |
| `H` | 显示/隐藏 UI |
| `M` | 静音切换 |

### 飞行手感
- **响应曲线**：按下后有 0.08s 起步斜坡，松杆立即回零，三轴灵敏度可调（默认 pitch 0.40 / roll 0.35 / yaw 0.45）。
- **阻尼回中**：角速度指数趋近目标，松杆平滑归零。
- **滚转-偏航耦合**：滚转角越大自动带偏航（俯仰角速度大时禁用避免倒飞跳变）。
- **重力/升力**：高速时升力抵消重力（平飞净零），低速会掉高度；失速（speed < minSpeed*1.5）时机身抖动 + 顶部红色 `STALL` 警告。
- **G 力**：俯仰越猛 G 越高，超 6G 时 HUD 数值变红（纯视觉提示）。

## 模型校准

不同来源的 GLB 朝向不一。本项目假设**机头朝 -Z**（Three.js 惯例）。Yak-9 敌机模型通过 `tune_enemy.html` 调试台调出参数后写入 `enemy.js` 构造函数：`yawOffset=-139`、`pitchOffset=0`、`rollOffset=0`、`userScale=3.6`、`autoOrient=false`。

> ⚠️ 重要约定：`Aircraft._applyCalibration()` 只设缩放，不动 `model.position`（位置在 `_normalize()` 中一次性设好，座舱偏移据此校准）。曾因在 `_applyCalibration()` 中改 `model.position` 导致主游戏座舱视角偏移，详见 [`docs/DEBUG_BUG_LOG.md`](./docs/DEBUG_BUG_LOG.md)。

## 关于模型体积与优化

`messerschmitt_bf109_e4.glb` 原始约 **23.5 MB**（Sketchfab 导出，66 张 JPEG 纹理 + 201 mesh，完全未压缩）。

页面默认加载优化版 `model/bf109_opt.glb`（约 4.4 MB，压缩到原体积 18.6%），用 `gltf-transform` 一次性生成：

```bash
npx @gltf-transform/cli optimize model/messerschmitt_bf109_e4.glb model/bf109_opt.glb \
  --texture-compress webp --texture-size 2048 \
  --compress meshopt --meshopt-level medium \
  --simplify true --simplify-ratio 0.5 --simplify-error 0.0008 \
  --weld true --prune true
```

加载侧适配：`aircraft.js` 已注册 `MeshoptDecoder`（`EXT_meshopt_compression` 必须）；WebP 纹理 three 0.160 内置支持。

**回退原版**：在 URL 加 `?model=raw` 即加载原始 23.5MB 模型，便于对比或兜底。

## 目录结构

```
darkWil/
├── model/                       # 飞机模型
│   ├── bf109_opt.glb            # 玩家优化版（4.4MB，meshopt+WebP）
│   ├── messerschmitt_bf109_e4.glb  # 玩家原版（23.5MB）
│   └── yak9.glb                 # 敌机 Yak-9
├── js/
│   ├── main.js                  # 入口：渲染器/场景/循环/视角/敌机生成/命中检测
│   ├── environment.js           # 天空/大地/光照/雾/障碍物
│   ├── terrain.js               # fbm 噪声地形 + 顶点着色 + getHeight
│   ├── buildings.js             # 程序化村庄 + 松树
│   ├── aircraft.js              # Aircraft 类：加载/动画/控制面/飞行物理/损伤/坠毁/爆炸
│   ├── enemy.js                 # Enemy extends Aircraft：血量+武器+巡逻 AI
│   ├── controls.js              # 键盘输入 + 响应曲线
│   ├── weapons.js               # 曳光弹对象池 + 枪口特效 + 随机伤害
│   ├── clouds.js                # 程序化云层（sprite，跟随玩家回收）
│   ├── radar.js                 # 雷达 HUD（canvas 2D）
│   ├── audio.js                 # WebAudio 程序化音效
│   ├── targets.js               # （靶标系统，已停用，类保留备用）
│   ├── tune.js                  # 玩家火炮位置调试页逻辑
│   └── tune_enemy.js            # 敌机模型朝向/枪口调试页逻辑
├── docs/                        # 详细文档
│   ├── DESIGN.md                # 详细设计
│   ├── DEBUG_BUG_LOG.md         # 调试与 Bug 修复记录
│   └── CHANGELOG.md             # 功能迭代时间线
├── index.html                   # 主游戏页
├── tune.html                    # 玩家火炮调试页
├── tune_enemy.html              # 敌机朝向/枪口调试页
├── _serve.cjs                   # 本地服务器脚本
└── package.json
```

## 调试接口

浏览器控制台可用：
- `window.__aircraft` — 玩家飞机实例
- `window.__debug.clouds` / `.camera` / `.renderer` / `.env` / `.enemies` — 各子系统引用

## 技术栈

- Three.js 0.160（本地 npm，ES 模块 + importmap）
- 纯原生 JS，无框架
- gltf-transform（模型优化，离线一次性）
- 本地 HTTP 服务器（http-server / serve / python）

## 数据署名

- 第四关地面贴图：Contains modified Copernicus Sentinel data (2023)，Sentinel-2 L2A，经 `scripts/fetch_berlin_ground.py` 裁剪处理。
