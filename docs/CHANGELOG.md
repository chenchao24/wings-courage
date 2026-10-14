# darkWil · 功能迭代时间线

> 按时间正序记录功能迭代。详细设计与算法见 [DESIGN.md](./archive/DESIGN.md)，Bug 修复见 [DEBUG_BUG_LOG.md](./archive/DEBUG_BUG_LOG.md)。

---

## 2026-10-12

### #84 上线前优化与仓库重组
- **仓库化**：git 初始化 + `.gitignore`；目录重组（12 个调参页 + tune js → `tools/`，历史文档 → `docs/archive/`，一次性诊断脚本 → `tests/python/_diag/`，改前备份/废弃脚本 → `_archive/`（gitignored））；删除 `dist/` 过期构建、编辑器残留目录与未引用资产 ~13MB；README/PROJECT_INDEX 重写
- **资产瘦身**：17 个 GLB meshopt 压缩（model/ 74→36.5MB；me_262/fw190 双型追加纹理 ≤1024+webp，经 `scripts/compress_textures_webp.mjs`）；img/ 21→3.5MB（全部转 webp + 柏林地面图 4096 重压缩 11.4→2.9MB）；新增 `scripts/verify_glb.mjs` 校验工具；原始备份与压缩产物均在 `_archive/precompress/`
- **首屏与容错**：开机画面 boot-splash（纯 CSS）+ importmap 能力探测 + noscript + meta/OG；WebGL 创建失败兜底；模型加载失败链闭环（aircraft.load 抛带 url 的 Error → AppShell catch → toast + 回退选关）；LoadingOverlay 慢网模式（8s 提示继续等 / 60s 硬超时刷新按钮，替代原 8s 强制进入）；柏林卫星贴图 404 兜底纯色纹理
- **性能**：HUD setWave 字符串缓存（消除每帧 innerHTML 重建）；aircraft getter 可选 out 参数化（getForward/getVelocity/getAimDirection/新增 getMuzzleWorldPosition/Dir 索引版）；B-17 炮塔瞄准、子弹生成、敌机 AI、雷达渐变等热路径消除每帧分配；**修复克隆实例 dispose 误释放共享 geometry/贴图**（B-17 中途脱离导致同型机 GPU 资源重传卡顿）；柏林 sandbox HUD 不再显示 "0/0"
- **部署**：`_headers`（Pages 缓存策略）+ `.assetsignore`（排除 node_modules/tools/tests 等 + 3 个管线备份 glb）+ `docs/DEPLOY.md`；DRACO 解码器迁入 `vendor/`（不再依赖 /node_modules）；调试全局（__shell/__aircraft 等）改为仅 localhost/?debug 挂载
- **测试**：test_britain_level.py 现代化（ESC 跳过剧情过场后验证敌机生成，修 GBK 编码与平海面顶点断言）；全量回归绿：campaign 三关 + berlin + britain
- **注意**：重跑 `scripts/optimize_b17.mjs`/`optimize_p51.mjs` 会重新生成未压缩 glb，需补跑 meshopt

## 2026-10-14

### #94 全局空气底雾（三关卫星图关卡）
- 用户定向："给大气整个加底雾"——线性雾 `near` 取负值实现常数底雾：near=-9900/far=65000 → 0m 起 ~5% 空气薄霭、50km 视野极限 ~90% 封顶
- 中间尝试记录：sqrt 封顶曲线（否决）、Crytek 式高度雾注入（用户试飞后否决，已回退 git checkout）——最终落地为零 shader 改动的纯配置方案
- 柏林/巴巴罗萨/库尔斯克 + 自由模式副本同步；不列颠雾仍为 0 不动
- 回归三关+柏林全绿

### #92 库尔斯克地图卫星化（方案 A 纯平）
- 地面换 Sentinel-2 卫星图：普罗霍罗卡以南草原 44×44km（2024-08-28 影像，原生 10m/px，3.4MB），农田+河谷+小村，无大城市；管线 `scripts/fetch_kursk_ground.py`（granule 覆盖踩坑记录：tileInfo 虚报/空 granule/HEAD content-length 预检/跳过名单）
- 代码：`environment.js` KurskRoads 按 `ground.type==='satellite'` 门控关闭（防双画 z-fight）；关卡加 `ground` 配置；太阳 elevation 10°→28°（纯平后长阴影无意义）；雾改线性雾
- 性能：drawCalls 2215→20、三角形 102 万→1.86 万；进关加载更快
- 回归断言更新（kurskGround 存在/贴图/路网关闭/Flak 保留）

### #93 四关天际线 + 柏林防闪烁 + 剧情跳过崩溃修复 + 指示器颜色
- **崩溃修复**（老 bug）：跳过剧情 1.2s 读条窗口内 `cinematic.active=false` 但视角模式停在 cinematicAuto → 外部相机分支查不到键值崩帧；库尔斯克 5s 自动切环视后 ESC 必现。`_updateCamera` 把跳过窗口仍按剧情处理 + 未知视角兜底 chase
- **天际线辉光带扩展**：不列颠（浅灰 0xc4cdd8）、库尔斯克（暖米灰 0xe8e0d0）补上 #91 同款地平线过渡带（雾均不动）
- **柏林防飞行闪烁**：地面贴图 anisotropy 8→16 拉满 + `ground.jpg` σ0.8 轻模糊（降高频噪点摩尔纹）
- **线性雾**：柏林 FogExp2 0.00007→线性（2000/42000）；巴巴罗萨（1500/28000）；库尔斯克（2000/32000）；自由模式副本同步
- **指示器颜色**：战斗机红 `#ff5a4d`→亮红 `#ff6b5e`；IL-2 土黄 `#c8a050`→亮桔 `#ff7a2e`

## 2026-10-13

### #91 天际线大气过渡（柏林/巴巴罗萨）
- 参考其他飞行游戏画面优化天边：`environment.js` 天空 shader 新增**地平线大气辉光带**（`sky.horizonColor/horizonStrength/horizonWidth`，高斯带峰值在天际线向上衰减；缺省 strength=0 逐字节不变，其他关零影响）
- 关键手法：**雾色与辉光带同色**消缝（fog 终点色 = 天际线泛白色），天边不再是一道白墙
- 柏林：雾 density 0.00007→0.00004（80km 图幅东缘曾 99.8% 白化失真；50km 裙边外缘仍 >98% 遮蔽），辉光带 0.70/0.06
- 巴巴罗萨：雾 density 0.00008→0.000055，辉光带 0.85/0.10；自由模式副本同步
- 验证：多高度/多视角截图对比（含东缘机群走廊），回归三关+柏林+不列颠全绿

### #90 巴巴罗萨卫星图去云
- 卫星图从 2023-06-05（积云斑 0.61%）换成 **2023-06-25**（初夏，贴 6.22 史实），残余云斑用新管线 `scripts/clean_ground_clouds.py` 清除：**局部亮度对比法检测**（101→201 核，云=比邻域亮且发白；亮田整体亮不误伤）+ **邻近地表纹理移植填充**（边缘羽化；Telea 大斑块会留奶痕）
- 管线教训：`fetch_barbarossa_ground.py` 的 find_tile 改为不信 tileInfo 自报值（本 tile 覆盖率/云量都虚报），用 R60m 快视图实测窗口有效率+云斑；注意 `R60m` 与 `R10m` 内容可能不一致（07-08/07-23 的 R10m 是 24-30KB 的空 tile），下载后必须校验文件大小
- 交战区（图中南部）云斑清零；东北角边缘森林留有少量卷云细丝（高空不可辨）

### #89 巴巴罗萨雾云观感调整
- **雾**：density 0.00016 → 0.00008（18km 小地图遗留值，40km 卫星图需要更远视距；10km 处雾遮蔽 92%→47%，地平线仍由雾+裙边收边）
- **云加密**（玩家反馈看不到云）：patchiness 0.82→0.70；云带高度 y1300-1700 → 1000-2100（盖到玩家 1800m 上空）；patchScale 8km→4km（晴空/云系斑块变小，沿途更易遇云）；maxSize 720→900；distFade 7km→10km
- 自由模式 FreeModeMaps 副本同步（铁原则手动同步，含 fog）
- draw calls 135→142（云增量在 distFade 控制下有界）

### #88 页面返回导航修复
- 问题：各页"返回"按钮走 Router 历史栈 `back()`，历史栈混入简报页等中间页后，选关页"返回菜单"会先弹回简报页（任务开始页），需多次点击才能回菜单
- 修复：六个页面的返回按钮全部改为显式目标导航（BriefingPage→选关、LevelSelectPage/SettingsPage/FreeMapSelectPage→菜单、FreeHangarPage→自由选图、MenuPage→封面），不再依赖历史栈
- 验证： playwright 探针覆盖"进关→ESC 暂停→返回主菜单→返回菜单"场景，一次点击直达

### #87 库尔斯克关卡修正（IL-2 战果计数 + 开场节奏 + 文本）
- **IL-2 逃跑误计击落修复**：IL-2 击落目标（killTarget=4）与击落喊话只计玩家亲手击落——命中检测致死时置 `_killedByPlayer` 标记（GameRuntime），WaveDirector 的 IL-2 坠毁补计/波次释放路径对无标记者静默跳过；此前逃跑/自毁坠地的 IL-2 会推高 `_il2Killed` 导致"杀 1 跑 3 也胜利"。战斗机波次"坠毁计战果"行为不变
- **开场剧情压缩**：接敌点 triggerZ -8254 → -11254（skipToZ 同步 -11400），斯图卡致敬后的空窗 ~45s → ~11s，开场总长 93s → ~60s
- **首波提前遭遇**：第 1 波 Yak-9 出生距离 7000 → 4000m
- **文本**：'请尽快志愿'→'请尽快支援'；对话内 is2 统一为 伊尔-2（×2）
- **测试基建**：8 个 test_*.py 支持 `TEST_PORT` 环境变量（默认 5173 不变）

### #86 库尔斯克战场地面物件移除（性能）
- 实战高度（IL-2 400-600m、战斗机 2300-3600m）下地面物件不可见（#79 思路的彻底完成版）：程序化 T-34 ×174、88mm 炮阵地 ×130、37mm 高炮 ×10、炮位/坦克士兵 InstancedMesh、死代码 GLTF 管线（model/ground_optimized/ 从未存在）全部删除
- `js/kurskBattlefield.js` 1620→~140 行，瘦身为纯数据模块：只按 flak 配置计算防空炮位 `aaGunPositions`（37 门，rear/battlefield zones，采样逻辑不变），供 AntiAircraftFlak 发射曳光/爆点；`group/update/dispose` 接口保留
- 库尔斯克性能：drawCalls **2215 → 26**，mesh 4744 → 63，geometry 616 → 20
- level_03 的 battlefield.zones/数量配置随之清理（死配置）；回归三关+柏林+不列颠全绿，Flak 正常

### #85 巴巴罗萨地图卫星化重构 + 交战高度/距离/云重配
- **地图**：第 2 关地面从程序化地形（terrain.js 缺省模式：18km 顶点色农田 + ~400 个随机村庄 mesh + 2100 棵松树）换成柏林方案卫星贴图——Sentinel-2 真彩色（**明斯克以西平原 40×32km**，2023-06-05 初夏影像，原生 10m/px，2.7MB）。新增管线 `scripts/fetch_barbarossa_ground.py`（R60m 快视图实测窗口覆盖率，规避 tileInfo 虚报）
- **泛化**（共享文件缺省兼容）：`js/berlinGround.js` 裙边兜底色/404 色/mesh 名参数化（柏林默认值不变）；`js/environment.js` 地形分支改为 `theme==='berlin' || ground.type==='satellite'` 门控（其他关零影响）。旧地形/建筑代码保留——主菜单背景仍用它，删关卡 ground 字段即回退
- **出生与距离**：玩家出生 1500（aircraft.reset 硬编码缺省）→ 显式 `playerStart` 1800m；敌机出生 1000-1200 → 1400-1800m；出生距离 1400-1900 → `spawnDist 3000`；每波 `aiOverride patrolAlt 800-1400`（原 fighter 缺省 400-1000 会压到贴地，卫星图低空观感弱）
- **云**：云带随图幅/高度层重配（y 1200-1400 → 1300-1700，x±6km→±15km，z 纵深 1500→-7000 扩为 3000→-18000）；spacing 700→1300 抵消面积放大，sprite 总量与 #83 持平；自由模式副本同步并补上 #83 云配置漂移
- **性能**：draw call ~800 → 135（村庄/森林/地形网格全移除，剩 2 个地面 draw call）
- **自由模式**：`FreeModeMaps.js` 巴巴罗萨副本手动同步同款地面（铁原则：不改战役文件，不 import）
- **回归**：campaign 三关（含新增巴巴罗萨卫星地面断言）+ berlin + britain 全绿；britain 测试里巴巴罗萨出生断言同步 1800m

## 2026-07-31

### #1 基础飞行测试场
- 模型加载（Bf 109 E-4，预置 DRACO 解码器）
- 螺旋桨动画筛选（576 轨中抽 30 条 prop 轨）
- 螺旋桨多状态（anim/slow/blur，propMode 切换）
- 飞行控制（街机式角速度模型）
- 开火（4 挺机枪曳光弹对象池 + 枪口火光）
- 环境（天空 + 太阳 + 雾 + 农田大地 + 调试网格）
- 调试面板（动画列表 / 朝向缩放 / 螺旋桨模式 / 视角 / 网格 / 重置）

### #2 模型优化
- gltf-transform meshopt + WebP + weld + simplify + prune
- 23.5MB → 4.4MB（18.6%）
- 控制面随输入偏转（升降舵/副翼/方向舵）

### #3 街机物理打磨
- 响应曲线（0.08s 起步斜坡）
- 滚转-偏航耦合（筋斗中禁用）
- 重力/升力（高速平飞净零、低速下沉）
- 失速预警（抖动 + STALL 警告）
- G 力软限制 + HUD 显示
- 低速俯仰舵效衰减
- 坠毁爆炸

### #4 靶标系统 + 多视角 + 动态准星 + 障碍物
- 浮空环形靶（命中爆开 + 计数 + 重生）
- 5 种视角（追尾/斜后/斜前/正上方/座舱）
- 动态准星（投影到机头前方瞄准点）
- 建筑障碍物（坠毁检测）

### #5 雷达 HUD + 云层
- 右下角圆形雷达（canvas 2D，玩家居中机头朝上，getter 注入解耦）
- 程序化云层（28 团，每团 4-7 Sprite 错位叠加，跟随玩家回收）

### #6 地形起伏 + 真实贴图 + 平房村庄
- fbm 噪声高度 + 顶点着色（草/土/麦田按高度坡度）
- 东欧平原缓起伏（0-9m），18000² / 256 segments
- getHeightCached 缓存
- 程序化平房村庄（小屋/谷仓/教堂尖顶）+ 松树

### #7 地貌分区 + 隐藏边界
- 耕田/山区/河流分区
- 雾色 + 边缘渐隐隐藏方形边界

### #8 座舱视角调整功能
- 调试面板「模型校准」下方滑条
- Y 抬高 / X 左右 / Z 前后 / 视距，实时生效

---

## 2026-08-01

### #9 地貌优化
- 沙色土地改为暗褐绿
- 森林从单棵改为 120-200 棵/片的茂密区域
- smoothstep 平滑过渡 + 中尺度 fbm 噪声消除大色块感
- 房屋颜色调整为土色系并增加 roughness

### #10 森林与山体颜色优化
- 森林颜色改为草色略深绿（0x3e5a2e）
- 修复 InstancedMesh 颜色相乘导致过暗的 bug
- 山体以草地为主，h > 45 才岩石为主，灰岩占比降至 6%

### #11 河流稀疏化
- 噪声频率降低，带宽减小
- 减少河流数量和宽度

### #12 调试面板优化
- 移除调试面板
- 操作按键合并为右上可折叠小地图面板

### #13 火炮调试台优化
- `tune.html` 仅保留火炮设计位置调整
- 其他调试项目暂时移除

### #14 座舱瞄准与射击位置一致性修复
- 新增 `Aircraft.getAimDirection()` 统一处理瞄准上抬量
- 准星和子弹方向均读取 `aircraft.aimLift`

### #15 枪口特效粒子化 + 音效系统
- 枪口火光/火花/稀薄烟雾粒子化
- WebAudio 程序化音效（引擎/机枪/命中/爆炸）
- M 键静音切换

### #16 枪口特效优化
- 柔和圆形径向光晕（无星芒）
- 烟雾稀疏化（每 3 发一个）

### #17 敌机系统（Yak-9）+ 空战
- `Enemy extends Aircraft`
- 复用加载/归一化/自动朝向/街机物理/坠毁爆炸
- 新增血量 + 自带武器 + AI
- yak9 螺旋桨固定模糊盘

---

## 2026-08-02

### #18 最初级敌机 AI 重构 + 靶标移除 + 屏幕敌机指示器
- `think()` 巡逻 AI（巡逻盘旋为主，被咬尾简单规避，低攻击欲望）
- 移除靶标系统（Targets 类保留备用）
- 屏幕敌机指示器（NDC 坐标判定，范围 -1.05 到 1.05）

### #19 敌机模型朝向调试台 + aircraft.js 三轴朝向支持
- `aircraft.js`：`yawOffset`/`pitchOffset`/`rollOffset` + `autoOrient`
- `tune_enemy.js`：三轴朝向滑条、缩放、枪口位置、参数输出

### #20 模型中心与缩放同步修复
- 缩放变化时同步更新 `model.position = -center * (baseScale * scale)`
- 确保模型包围盒中心始终在原点（仅调试页）

### #21 敌机参数写入与验证
- `yawOffset=-139`、`pitchOffset=0`、`rollOffset=0`、`userScale=3.6`
- `muzzleOffsets`（机翼 2 + 机头 2）
- `autoOrient=false`
- 测试确认游戏正常加载、敌机就位且无报错

### #22 座舱位置修复
- 恢复 `_applyCalibration()` 原逻辑：只设缩放，不动 `model.position`
- 位置在 `_normalize()` 中一次性设好
- `tune_enemy.js` 居中逻辑保留不变

### #23 随机伤害系统
- `bulletDamage` → `damageMin/damageMax` + `getDamage()`
- 玩家 8-20，敌机 8-12

### #24 损伤状态机
- HP ≤ 30：机身中段冒轻度黑灰透明烟
- HP = 0：加重烟雾 + 火焰，无机动作并螺旋下坠
- 坠毁中累计伤害 > 20：空中爆炸（火光 Sprite + 深烟团 + 火星 Mesh + 旋转碎片）

### #25 坠毁物理自然化 + 坠落与重生解耦
- 重力 0.7× → 2.0× 加速下降
- 旋转欧拉角 → 四元数避免跳变
- 机头渐下压至近垂直俯冲
- 坠落与重生解耦：触地 → 爆炸 → 3s 粒子 → 重生
- 30s 安全阀
- 每架敌机独立实例

### #26 坠毁加速感强化
- 弃用固定向量 + 阻力模型
- 改为标量 `_crashSpeed` 沿机头方向持续加速（3 倍重力无阻力）
- 始终叠加重力下沉

### #27 坠毁弹道修复
- 沿机头方向运动 + 螺旋旋转导致轨迹跟随旋转机头
- 改为弹道模型：速度向量坠毁瞬间固定，重力只改 y，机头螺旋纯视觉
- 消除向上分量 + 初始下沉，保证爬升中击落也立即下坠

### #28 坠毁双模式
- 30% 挣扎模式（前飞 + 快速下降 + 小幅振荡）
- 70% 弹道模式（机头朝下翻滚）

### #29 坠毁旋转翻转 + 漂浮修复
- 恒定滚转率 → sin 振荡（不累积翻转）
- 挣扎模式恒速下沉 → 加速下沉
- 俯仰振荡幅度 0.2 → 0.15

### #30 坠毁前向动量保留（修复"突然失速"）
- 弹道模式：重力 3.0 → 1.5 倍（抛物线下坠）
- 弹道模式：机头低头 0.7-1.0 → 0.25-0.4 rad/s（4-6s 到垂直）
- 弹道模式：阻力改整体 0.05/s（保留前飞动量）
- 弹道模式：向上分量 0.3× 而非归零（保留爬升惯性）
- 挣扎模式：前飞保留 0.8 → 0.9、减速 0.08 → 0.04/s、重力 2.0 → 1.5 倍

### #31 敌机编队 AI（双机编队 + 散开 + 支援 + 编队重生）
- `enemy.js`：新增 `combatState` 状态机（`formation` → `engaged` → `solo`）
  - **编队飞行**：长机按 waypoint 巡逻，僚机保持 body frame 偏移（右40/下10/后30）跟随
  - **散开**：受击或玩家靠近 < 500m → 切 `engaged`，通知队友一起散开（队友随机选支援方向）
  - **支援**：队友被咬尾时，从玩家后方/上方/左侧/右侧随机包抄射击（每 4s 重选方向）
  - **单机**：队友被击落后切 `solo`，即原有巡逻 + 规避 + 低欲望攻击逻辑
- `enemy.js`：override `takeDamage`，受击但未死时触发 `_breakFormation()`
- `aircraft.js`：新增 `autoRespawn` 标志（玩家 `true` 自动重生；敌机 `false` 由 main.js 编队管理）
- `main.js`：`spawnEnemy` → `spawnFormation`（长机 + 僚机并行加载，僚机对齐编队偏移）
- `main.js`：主循环加编队重生检测（两架都爆炸且粒子淡出 → 一起重生 + 恢复编队状态）

### 📝 项目文档化
- 更新 `README.md` 反映当前功能
- 新建 `docs/DESIGN.md`（详细设计）
- 新建 `docs/DEBUG_BUG_LOG.md`（Bug 修复记录）
- 新建 `docs/CHANGELOG.md`（本文件）

---

## 2026-08-06

### #32 glTF 模型缓存与克隆复用（性能优化）
- `aircraft.js`：模块级 `_gltfCache` Map（url → gltf 模板）
- 首次 `load()` 网络下载+解析+模板后处理后存缓存；后续实例 `SkeletonUtils.clone()` 克隆复用
- 导入 `clone as cloneGltfScene` from `SkeletonUtils.js`（r160 导出 `clone` 非 `SkeletonUtils`）
- 模板后处理（材质提亮+阴影）仅做一次，克隆体共享继承
- 消除同模型重复加载（4 架敌机：4 次网络→1 次网络+3 次克隆）
- 详见根目录 `glTF缓存克隆与战斗对话系统文档.md` 第一章

### #33 材质深拷贝修复透明 Bug
- **现象**：缓存克隆后，剧情中全部我方飞机突然半透明（opacity≈0.22）
- **根因**：`SkeletonUtils.clone()` 共享材质引用，`_setupPropPivot()` 修改桨叶 `opacity=0.22` 传播到所有克隆体；桨叶与机身共享材质时整架飞机变透明
- **修复**：`cloneGltfScene()` 后逐 mesh `material.clone()` 断开引用，实例级修改不再传播
- 详见根目录 `glTF缓存克隆与战斗对话系统文档.md` 第二章

### #34 战斗对话系统（接敌对话 + 胜利对话 + 对话队列）
- `GameRuntime` 新增对话队列：`_queueDialogs()` 入队 + `_updateDialogQueue()` 每帧逐句按时长播放
- **interceptChat**（6 句）：接敌时 `_triggerIntercept` / `_finishSkip` 触发，含告警+玩家指令+僚机回应+轰炸机下令
- **victoryChat**（2 句）：全灭 `onAllClear` 回调入队，播完后才触发任务胜利界面（`_victoryPending` 延迟回调）
- **随机喊话关闭**：击落最后一架（4/4）时 `_chatterDisabled=true`，`_updateCombatChatter` 直接 return
- `level_01_britain.js`：`intercept` → `interceptChat`（6 句），新增 `dialogs.victoryChat`（2 句）
- `CinematicSystem.js`：`_triggerIntercept` / `_finishSkip` 改为队列播放 interceptChat
- 详见根目录 `glTF缓存克隆与战斗对话系统文档.md` 第三章 + `docs/dialog_level1_split.md`

---

## 2026-08-07

### #35 通用模型预处理工具 model_tuner.html
- 整合 4 个历史调试页面（`tune.html` / `tune_enemy.html` / `tune_prop.html` / `tune_yak_models.html`）为单一工具
- 4 个 Tab 功能分区：
  - **① 基础坐标**：autoOrient（按螺旋桨质心自动偏航）+ Yaw/Pitch/Roll + userScale（按翼展自动算）+ centerOffset + 包围盒/世界轴/方向标签 + 4 视角预设
  - **② 机枪炮口**：战斗机模式（枪口朝机头 -Z）+ 轰炸机模式（炮塔独立 Yaw/Pitch），枪口预设下拉、标记球、弹道射线、增删炮口
  - **③ 起落架**：节点列表（按 Y 排序/按名排序/过滤）、勾选标记起落架节点、实时隐藏预览、导出 hideGearNodes
  - **④ 螺旋桨**：propNodes 标记、转速/透明度/模糊盘/模糊强度/旋转轴倾斜/桨毂偏移、单发/多桨独立模式
- **参考机叠加**：可叠加另一机型作参考对比调整
- **导出系统**：全量配置或分 Tab 导出，格式直接粘贴到 `js/enemy.js` 的 `MODEL_CONFIGS`
- **游戏一致性**：applyModelConfig 严格复刻 aircraft.js 的 _autoOrient + _normalize + _setupPropPivot 逻辑，工具所见即游戏渲染
- 访问地址：`http://127.0.0.1:8000/model_tuner.html`

### #36 玩家 Bf 109 移出工具范围
- **背景**：玩家 Bf 109 参数在 `aircraft.js` 构造函数硬编码（含座舱 aimLift=0.12 上抬），与敌机/友军（aimLift 恒为 0）渲染逻辑不同，工具内展示与游戏差异较大
- **处理**：从 `model_tuner.html` 彻底移除 Bf 109 相关内容（MODEL_LIST、MODEL_CONFIGS、MUZZLE_PRESETS、aimLift/aimDist 控件、player-badge 徽章、syncPlayerBadge、exportAll 中 isPlayer 判断）
- **简化**：effectiveMuzzleDir 移除 aimLift 分支，敌机弹道=纯机头方向（与 getAimDirection 退化一致）
- **启动**：默认加载首个敌机模型（Spitfire），不再自动加载 bf109_opt.glb
- 玩家飞机将来单独做工具调整

### #37 喷火枪口位置精调
- 用 `model_tuner.html` 校准台对 Spitfire 8×.303 勃朗宁枪口精调
- 旧参数（X 范围 ±4.80、Z=-3.00）→ 新参数（X 范围 ±12.05、Z=-6.30~-7.05），枪口沿机翼前缘外移到翼尖
- 更符合喷火 A 翼 8×.303 历史真实布局（4 左+4 右机翼前缘分布）
- 同步更新 `js/enemy.js` MODEL_CONFIGS + `model_tuner.html` MODEL_CONFIGS/MUZZLE_PRESETS

### #38 友军出生高度整体抬升 300 单位
- `level_01_britain.js`：playerStart.position[1]、friendlyBombers.spawn.y、cinematicFormations spawn.y 全部 +300
- `CinematicSystem.js`：`_dolinBaseY` 默认值同步抬升
- 新高度：玩家 Falke-1 (2070)、轰炸机编队 (2100)、表演 Ju-88 (2150)、表演 Bf-109 (2180)、僚机 Falke-2 (2070)
- 敌机 Spitfire 出生高度 2200 不变，高度差从 430m 缩小到 130m

---

## 2026-08-10

### #39 库尔斯克第三关地面场景（1:1 真实比例）
- **比例基准修正**：游戏内 1 单位 = 1 米（HUD 高度直接读 position.y）。原 SCALE_FACTOR=0.3629（Bf109 翼展基准）导致地面模型偏小 2.75 倍，改为 1.0
- **地面焦土区域**：直接修改地形顶点色（lerp 到 0x3a2e1e 深褐焦土色），战壕前500m/后300m，边缘200m smoothstep 渐变，无额外 Mesh/材质开销
- **程序化虎式坦克**：BoxGeometry（车体/炮塔）+ CylinderGeometry（炮管）+ 黑色履带，深黄色材质（0x7a6a2e），虎式比例（8.45m×3.7m×3.0m），禁用阴影
- **弹坑场**：InstancedMesh 单 draw call，约600个弹坑，直径3-10.5m（pow(random,2.0)分布），星型爆炸纹理，战壕前500m/后300m ±72°扇形分布
- **战壕系统**：主壕 15-25m/宽 1.5m/深 1.8m，支壕 8-12m，1:1 真实尺寸
- **高炮阵地**：沙袋半径 4m/底座 2.6m/炮管 3.2m，1:1 真实尺寸
- **_randomInPolygon 坡度阈值**：3.0→15.0 + 60次尝试 + 兜底返回多边形内任意点（库尔斯克有低矮丘陵）

### #40 FW-190 A-4 玩家机型适配
- **程序化螺旋桨**：`fw_190_a-4.glb` 无独立桨叶节点（桨叶与机身合并为 Object_7），通过 `_setupProceduralProp` 生成模糊盘+旋转桨叶，挂到 `this.root` 避免根旋转轴向错位
- **桨叶透明切割**：shader discard 切割静态桨叶几何（`propCut` 配置）
- **模型方向**：原始机头 +Z，配 `autoOrient: false` + `yawOffset: 180.0` 使机头朝 -Z
- **座舱光源**：隐藏玻璃后座舱内漆黑，加 PointLight 照亮仪表（`cockpitLight` 配置）
- **长机注入**：`_injectPlayerConfigToBomber` 方法注入玩家配置全部校准字段，确保长机与玩家外观一致
- **调试工具**：`player_tuner_fw190.html` 专用调试页（校准/起落架/程序化桨/枪口/飞行物理/机舱视角）

### #41 斯图卡与 IL-2 模型配置
- **Ju 87 B 斯图卡**：`autoOrient: true`, `yawOffset: 270.0`, `userScale: 4.14`，友军编队纯视觉演出
- **IL-2 M3**：`autoOrient: false`, `yawOffset: 61.0`, `userScale: 5.30`, `centerOffset: [0.17, 0.72, 0]`，第3波敌机

---

## 2026-08-11

### #42 FW-190 武器系统（机枪/机炮分离 + 过热 + 命中特效）
- **武器组配置**：`playerConfig.weapons.groups` 按武器组独立参数（射速/初速/伤害/尺寸/爆炸标志）
  - MG 17 机枪：射速 0.10s、初速 750、伤害 5-10、金白色曳光弹
  - MG 151/20 机炮：射速 0.18s、初速 700、伤害 18-36、橙红色曳光弹、有爆炸
- **机炮枪管过热系统**：连射升温曲线 `heatMult = 1.0 + 0.03 × min(fireDuration, 10)`，约3.2秒过热；冷却速率 20°/秒，60°以下解除卡壳；右下角竖向温度条（10×110px，绿→橙→红过渡，过热闪烁）
- **机炮命中特效**：3-5个小黑碎片锥形飞溅+翻转；机炮击落生成8-14个大块黑/灰碎片
- **机炮子弹橙红色**：`bulletMatPlayerCannon`（0xff5520，AdditiveBlending，toneMapped:false）
- **音效分层**：机炮正常播放文件音效，过热卡壳后机枪用合成枪声；机炮+机枪同时开火不播放机枪声

### #43 飞机坠毁物理重构（两阶段下坠）
- **阶段1（2-6s随机）**：从当前姿态平滑 slerp 到目标俯冲姿态（20-50°随机），速度方向跟随机头变化
- **阶段2（过渡完成后）**：姿态锁定在目标俯冲角度，速度从当前值加速到80%极速
- **取消滚转模式**：滚转轴曾错误沿点旋转而非机身轴，最终取消滚转，仅保留机头下垂调整姿态
- **击落爆炸几率调整**：5%直接空中爆炸（火球+碎片），90%冒烟坠毁；坠毁中需累计80伤害（约3-5发机炮）才爆炸

### #44 Bf 109 武器系统更新（两关启用）
- **MG 17 机枪**（机头枪口2,3）：射速 0.08s、初速 755、伤害 3-8、尺寸 1.0×、金白色曳光弹、无爆炸
- **MG FF/M 机炮**（机翼枪口0,1）：射速 0.14s、初速 700、伤害 15-28、尺寸 1.8×、橙红色曳光弹、有爆炸
- **历史差异化**：MG FF/M 弱于 FW190 的 MG 151/20（早期型 vs 改进型），射速略快补偿数量少
- 两关（不列颠、巴巴罗萨）均启用，过热系统同步生效

### #45 喷火敌机 AI 调整（不列颠关，多轮迭代定稿）
- **进攻节奏加强**：开火冷却 4-6s → 2-3s，连发 0.8-1.2s → 1.0-1.4s
- **HP 提升**：100 → 120（多扛1轮机炮）
- **参数化旋钮**（enemy.js 共享代码，默认值=原值，关卡隔离）：
  - `playerNearDist`(300) / `playerNearHoldTime`(4)：attackBomber→engaged 距离触发
  - `disengageDist`(1200) / `disengageHoldTime`(0)：engaged→attackBomber 脱战条件
- **不列颠关配置**：playerNearDist=500 / playerNearHoldTime=2 / disengageDist=1200 / disengageHoldTime=3
- **试错后移除的机制**（副作用过大）：
  - `tailThreatDist` 后方威胁感知：玩家飞到后方全队放弃轰炸机
  - `notifyBulletNearMiss` 40m子弹擦过检测：玩家开火密度大时疯狂触发
  - `takeDamage` 内 `_triggerEvade` 强制规避：破坏攻击节奏
  - `pursuedDist=800` + `engagedEvasionCd 2/4`：engaged 疯狂翻滚不开火
- **最终逻辑**：第一优先攻击轰炸机，被子弹命中才切 engaged，规避走 fighter 基线默认（350m+0.015概率）
- **剧情锁操纵交汇分析**：玩家剧情期间速度恒定 45/s，解锁时(z=10000)轰炸机z≈9720，距喷火loiter仅5220m，喷火刷出后立即切attackBomber不会loiter盘旋

---

## 2026-08-13 · v0.6

### #46 IL-2 强击机 AI 重构（库尔斯克第三波）
- **前机枪**：去 CD 持续开火，`angleOff 0.08→0.25rad`(14°)，距离 `200-500→300-700m`
- **后炮塔**：5 虚拟朝向 → 1 朝向(索引4)，`angleOff 0.5→0.785rad`(45°)，命中率仅距离衰减，去掉 playerSteady 加成
- **规避**：去掉俯冲，改为 95% 偏航+加速、5% 短暂拉起(pitch=+0.2，不俯冲不翻跟头)
- **patrol**：去掉定期换高度，固定 400m 平飞
- **状态机**：新增 break 态，接敌 1500m 触发分头(左右侧前45°飞2-3s)→retreat
- **muzzleGroups 注入 _aiCfg**：修复 `cfg.muzzleGroups` 取不到的隐性 bug
- 详见 `IL2设定文档.md`

### #47 IL-2 战果计数与 AI 失效根因修复
- **根因**：`Enemy.load()` 在 `_applyModelConfig()`（设 `_il2State='patrol'`）之后调用 `reset()`，而 `reset()` 无条件把 `_il2State` 清成 `null`
  - 后果1：`_il2Killed` 永远=0（`notifyKilled` 里 `if (enemy._il2State)` 永远 false）→ 8/8 也不触发胜利
  - 后果2：`_thinkIl2` 根本没在跑（`if (this._il2State)` 永远 false），IL2 走普通 attacker AI → 看不到开火、行为不对
- **修复**：新增 `_il2Enabled` 固有标志，`reset()` 据此恢复 `_il2State='patrol'`
- **战果计数**：`WaveDirector._releaseActive` 补计 `_il2Killed++`

### #48 IL-2 大幅俯冲坠毁根因修复
- **根因**：`think()` 第1172行老的全局高度上限俯冲检查 `myPos.y > patrolAltMax+100 → pitch=-0.6`，IL2 的 patrolAltMax=500，出生 400-600m，`_il2Evasion` 拉起超 600m 触发 -0.6 俯冲，与 aglFloor 拉起形成循环坠毁
- **修复**：加 `!this._il2State` 让 IL2 跳过此检查

### #49 长机离场修复（剧情收尾）
- **根因**：`combatChatter.leader`、`onPlayerDamaged`、`_updateLockWarning` 三处喊话不检查 `_leaderDeparting`；渐隐距离阈值 5000m 太高
- **修复**：三处加 `!this._leaderDeparting`；渐隐改为 `distToPlayer>2500 || routeEnd || elapsed>10s`
- 新增 `_leaderDepartElapsed` 计时器

---

## 2026-08-16 · v0.65

### #50 武器组级开火音效系统（FW-190 / Bf-109）
- **背景**：原开火音效按武器个体触发，多挺机枪同步开火时叠成刺耳尖啸；且不同机型缺乏专属枪声
- **`audio.js` 组级音效管理**：
  - `loadGroupFireSound(url, opts)`：按 url 缓存 AudioBuffer，返回 group id
  - `startGroupFire(groupId, {interval, pitch, volume})`：单实例循环源 + 速率调制，同组多枪只播一份
  - `stopGroupFire(groupId)`：淡出停止
- **`weapons.js` 触发**：武器组首次开火调 `startGroupFire`，全组停火调 `stopGroupFire`
- **`GameRuntime.js` 装配/清理**：关卡启动时按 `weapons.groups[].fireSound` 装载音效，关卡结束清理
- **关卡配置**：
  - `level_03_kursk.js`：FW-190 MG17 用 `mg17_fire.mp3`、MG151/20 用 `mg151_fire.mp3`
  - `level_01_britain.js` / `level_02_barbarossa.js`：Bf-109 MG17 用 `mg17_fire.mp3`、MG FF/M 用 `mgffm_fire.mp3`
- 效果：同组多枪只一份枪声，不同机型枪声辨识度提升，整体音量密度显著下降

### #51 翼尖拉烟系统（VaporTrail）
- **新建 `js/VaporTrail.js`**：基于带状 mesh ribbon 的翼尖凝结尾迹
  - 每架飞机左右翼尖各一条带，per-vertex opacity 控制头尾透明度
  - ShaderMaterial：边缘羽化 `pow(edge, 8.0)`（从 5.0 加强），中心亮、边缘虚化
  - 带宽随时间扰动增大（±0.3 → ±0.9），模拟湍流扩散
  - 透明度线性衰减，寿命 30s，peakOpacity=0.4
  - 膨胀系数 2.0-3.0（随机），带状几何随时间整体扩张
- **`aircraft.js` `_computeWingTips`**：遍历模型顶点找 X 极值处实际 Y/Z 坐标（两遍遍历左/右翼尖），避免硬编码翼尖位置
- **触发条件**：G ≥ 2.0、速度 ≥ 300km/h（83.3m/s）、高度 600-4500m、非坠毁状态
- **概率**：敌我双方均 30% 飞机实例启用拉烟（构造时随机决定）
- **`enemy.js` 排除**：苏联老式双翼/单翼机 I-153、I-16 设 `noVaporTrail: true`（气动不足以产生明显凝结尾迹）

### #52 库尔斯克长机巡逻中心修复
- **根因**：`enemy.js` 中 `_center` 硬编码为世界原点 (0,0,0)，但库尔斯克战场在 z=-8254，导致编队长机脱离战场后一路飞向世界原点
- **修复**：
  - `_initWaypoints` 改为以敌机出生位置为巡逻中心：`this._patrolCenter = this.root.position.clone()`
  - `_thinkFormation` 和 `_thinkSolo` 中所有引用 `_center` 处改为 `this._patrolCenter`
- 效果：编队长机以出生点为中心盘旋巡逻，不再飞离战场

### #53 坠毁效果全面增强
- **renderOrder 修复（云盖不住坠毁烟）**：
  - 根因：云的 renderOrder=1（`clouds.js:408`），坠毁粒子默认 renderOrder=0，导致云层遮挡坠毁烟雾
  - 修复：烟雾 renderOrder=5、碎片=3、火焰=18、火星=19、闪光=20（全部 > 云的 1）
- **坠毁姿态变化加大**：
  - 滚转角度 ±20° → ±60°
  - 偏航角度 ±15° → ±30°
- **着火概率与强度**：
  - 着火概率 30% → 70%
  - 火焰尺寸 1.5-3.5 → 3.0-7.0
  - 发射间隔 0.06s → 0.04s（更密集）
- **击落瞬间小爆燃 `_spawnKillFlash()`**：
  - 80% 概率触发，不隐藏模型（区别于过量伤害的空中爆炸）
  - 3-5 个小火光 Sprite（黄橙色，0.3-0.6s 短暂）+ 3-5 个小碎块飞溅
  - 与坠毁流程并行，增强击杀反馈
- **增强 `_spawnExplosion()`**：
  - 中心白光闪光（0.15s 短暂）+ 15 个多色火焰团 + 16 个烟雾团 + 30 个多色火星
  - 整体缩放 0.7（缩小 30%，避免过大爆裂感）
- **增强 `_spawnDebris()`**：
  - 碎片数 35-55 个，尺寸 0.2-4.0 大小不一
  - 小碎片飞得快、大碎片飞得慢（质量感）
  - 40% 碎片带火光（大碎片 60%），下坠过程中持续燃烧
- **坠毁烟/火位置上移**：
  - 烟雾 Y 偏移 0.5 → 1.5（避免贴地被地形遮住）
  - 火焰 Y 偏移 0.3 → 1.2
- **螺旋桨渐进停止**：
  - 坠毁瞬间桨速降至 30-40% 转速
  - `_crashPropDecay` 1.0 → 0 约 3 秒衰减
  - 动画桨（`_propAnim`）和固定旋转桨（`_propBlur`）均已处理

---

## 2026-08-16（v0.65.8.16）

### #54 库尔斯克防空火炮烟团颜色调整
- `js/AntiAircraftFlak.js` 烟团颜色调整为更真实的灰黑色调

### #55 封面页改造
- **任意键/点击进入**：移除开始按钮，键盘任意键或鼠标点击屏幕即可进入主菜单
- **版本号显示**：右下角 `v0.65.8.16`，`CoverPage.js` + `Theme.js` `.cover-version` 样式
- **"按任意键开始"闪动样式**：22px 金色 display 字体，letter-spacing 8px，金色光晕 text-shadow，1.6s 透明度闪动动画，居中底部 80px

### #56 自由模式框架搭建（与战役模式 100% 隔离）
- **隔离原则写入 AGENTS.md**：FreeModeEnemy 不得 extends Enemy，FreeModeRuntime 不得 extends GameRuntime；仅允许 extends Aircraft（纯机制基类）；不 import js/config/levels/*；共享底层模块（Aircraft/Weapons/Controls/Radar/HudController/environment/clouds/audio）允许
- **配置数据**（`js/config/freemode/`）：
  - `aircraft.js`：玩家机型（Bf109 E-4 / Fw 190 A-4），含 history/realSpec/gameBars 属性条数据、playerConfig 校准/物理/武器、previewOffset 预览位置偏移
  - `enemy-aircraft.js`：敌机机型（I-16 / Spitfire / Yak-7 / Yak-9）
  - `maps.js`：6 个地图选项（巴巴罗萨开放，其余 5 个待开放）
  - `difficulty.js`：难度（新兵/老兵/王牌）+ 时间限制（无限制/5/10/15/20 分钟）
- **独立敌机类** `js/freemode/FreeModeEnemy.js`：extends Aircraft，独立 AI 配置，HP 为原模式一半，出生距离 3000 米高度 2000 米
- **地图配置** `js/freemode/FreeModeMaps.js`：玩家出生 [0,2000,0]
- **独立运行时** `js/freemode/FreeModeRuntime.js`：不 extends GameRuntime
- **地图选择页** `js/app/pages/FreeMapSelectPage.js`
- **机库页** `js/app/pages/FreeHangarPage.js`（详见 #57）
- **路由注册**：`AppShell.startFreeMode` + Router 路由
- **主菜单入口**：`MenuPage.js` 解锁自由模式按钮

### #57 机库页（FreeHangarPage）多次迭代
- **全屏 3D 展示台**：整个页面是 3D 模型展示区，所有 UI 悬浮（半透明 + backdrop-filter 模糊）
- **左侧信息面板**：飞机名称/历史/性能参数/游戏属性条（属性条非数值）
- **右侧配置面板**：对手数量（1-2）/ 对手机种 / 时间 / 难度 + 开始任务按钮
- **翻页器**：顶部中央，左右切换玩家飞机
- **返回按钮**：左上角缩小按钮
- **背景**：深灰色径向渐变 CanvasTexture（中心 #3e3e3e → 边缘 #161616）
- **环境贴图**：PMREMGenerator 从半球光场景生成，增强金属表面反光质感
- **光照**：上方主光 DirectionalLight + 左前暖色补光 + 右后冷色补光 + 正后边缘光 + 上部两盏 SpotLight 射灯（展厅氛围），所有 decay=0 不衰减
- **地面**：深灰径向渐变 + 同心圆纹 CanvasTexture，roughness 0.55 / metalness 0.35（有反光质感）
- **相机**：球坐标控制，滚轮缩放 + 鼠标拖拽旋转，不自动旋转
  - 最终参数：`camR=38` `camTheta=-2.134` `camPhi=0.262`（俯视约 15°）`FOV=40`
  - `lookAt(0,0,0)` 飞机居中
- **加载进度条**：模型加载时居中显示滑动进度条 + "加载模型中…"文字，`_setLoading()` 控制显示
- **FW190 预览位置微调**：`previewOffset: [0, 0, -2.6]`，通过 `ac.root.position` 应用，仅影响机库预览不影响游戏模型（centerOffset 不变，避免破坏模型）

---

## 2026-08-16 ~ 2026-08-17

### #58 第四关《柏林保卫战》P1：地图与关卡骨架

**设计定案**（讨论结论）：体验式截击关，不追求全歼；交战高度 3000-7000m，轰炸机巡航 5000m（后续阶段），2000m 为硬性下限。

- **卫星贴图地面**：Sentinel-2 L2A 哥白尼开放数据（AWS 公开桶匿名可取），一次性管线 `scripts/fetch_berlin_ground.py`（tileInfo 按 dataCoveragePercentage/cloudyPixelPercentage 过滤过境条带，2023-06-05 全盖无云景，裁剪柏林西郊 80×64km 窗口、柏林城自然落在东缘），产出 `img/berlin/ground.jpg`（8000×6400，1 texel=10m，11.5MB）。README 已加哥白尼署名
- **`js/berlinGround.js`**：纯平平面 + 贴图，duck-type Terrain 接口（create/getHeight/isLand/dispose），`js/terrain.js` 零改动
- **矩形地图**：`environment.js` 新增 `theme === 'berlin'` 分支（BerlinGround 替代 Terrain/Buildings），前三关分支逐行未动
- **交战高度规则** `js/game/CombatAltRule.js`：<2200m 警告 → <2000m 十五秒倒计时（"请返回作战高度，您的任务将失败"）→ 归零弹窗二选一（任务失败走阵亡结算带自定义文案 / 原地重置 4000m 黑屏读条，仿 CinematicSystem.skip 的 #loader 模式）；>7000m 仅软提示。HUD 走 `snap.altFence` 字段门控
- **Flak 防空带**：复用 `AntiAircraftFlak`（无库尔斯克硬编码），唯一改动 `playerAlt<500` 写死 → `tracerAltMax ?? 500` 可选参数（柏林配 6500）；柏林高度段 3000-6000m
- **沙盒模式**：`GameRuntime` onAllClear 开头加 `if (levelConfig.sandbox) return;`（空 waves 不再开局即胜利）
- **地图边缘问题迭代史**（最终回到极简）：衬底裙边+贴图羽化曾引发 z-fighting 全屏闪白（near=0.5/far=50000 在 3km 外深度精度 >1m）→ 裙边下沉 -250m + 跟随相机 + 雾色天空底一致 → 用户实测后与羽化一起撤除，大图幅（80×64km）+ 距离雾天然足够
- **测试**：`tests/python/test_berlin_level.py`（17 项：加载/出生点/朝向/高度规则全流程）+ `tests/python/test_campaign_regression.py`（前三关隔离回归）

### #59 Me 262 模型调校（player_tuner_me262.html）

- **贴图修复**：`me_262.glb` 用旧版 spec-gloss 工作流（KHR_materials_pbrSpecularGlossiness），新版 three.js GLTFLoader 不再内置支持 → `scripts/convert_me262_specgloss.mjs` 离线转 metalRough（备份 `model/me_262_specgloss_backup.glb`）
- **朝向**：机头原始 +Z（垂尾 Object_2 在 -Z），`autoOrient:false` + `yawOffset:180`
- **比例约定**：实测游戏内 Bf109 翼展 32.34 / Fw190 34.25 = 史实×3.26 倍；262 按 `userScale=4.53`（12.5×3.26/9）对齐同一约定
- **调试台** `player_tuner_me262.html`：去全部桨功能，4 枪口（MK 108 上2下2）+ 喷气口定位（橙锥标记）+ 节点显隐列表（Object_2~15 按材质合并，人工识别；Object_8 无贴图半透明黑壳默认隐藏）+ 座舱/物理页，导出对齐 level_04 playerConfig 格式
- **史实物理包线**：maxSpeed 240（870km/h）、diveAccel 12（喷气机能量战）、滚转/盘旋弱于 Fw190、minSpeed 25
- **武器组 mk108**：4×MK 108 30mm 机头机炮（fireRate 0.15 游戏化降速 / bulletSpeed 540 史实 / damage 30-55 高爆 / 枪声 mk108.mp3 loop 0.02-0.13s）

### #60 喷气系统三件套（仅第4关，`playerConfig` 门控）

- **喷气引擎合成音**（`audio.js` setEngineType 'jet'，后被实录文件取代，保留为兜底）：涡轮啸叫双正弦失谐 300→1700Hz + 压气机带通噪声 + 低频轰鸣
- **文件引擎音**（`playerConfig.engineSoundFile`，优先级最高）：`audio.js setEngineSoundFile/clearEngineSound`，实录循环 playbackRate 0.75~1.3 + 音量随油门；已接入第2关 bf109 / 第3关 fw190 / 第4关 me262（第1关喷火无文件保持合成）
- **无缝循环烘焙** `scripts/make_engine_loops.py`：ffmpeg 解码 → 裁头部静音 → 自相关找主周期（156/21/114Hz）→ 循环段取周期整数倍 → 尾头 80ms 等功率交叉淡化（缝合点落在原始材料相邻样本间，严格连续）→ 输出 WAV（不用 mp3，编码器 delay/padding 会破坏循环）。三文件缝合端点差 ≤0.009
- **喷气尾流** `js/JetExhaust.js`（`jetNozzles` 配置门控）：喷口辉光（白炽 sprite）+ 尾气粒子（空间发射——沿每帧位移线段按 0.7m 节距铺粒子，消除按帧成团的球感；出生强跟随 0.85×前速逐渐失速；白→灰→淡褐色谱；近相机 3.5-9m 淡出防贴脸球感）+ 热浪锥（自定义 shader：噪声条纹沿锥流动 + 顶点摇曳 + 菲涅尔衰减羽化边缘，低成本热流观感）
- **262 专用油门条**（`jetThrottle` 配置门控，HUD 专用条替换通用条）：80% 最大连续功率 / 90% 峰值功率红线（"峰值功率"标签）；持续超 90% 达 10s → 自动降频 80% + 冷却 30s（锁死 80%，HUD"发动机冷却中 Ns"）；松 Shift 按 0.125/s 回落到 50%（releaseTarget）；超 90% 整条闪红。逻辑 `js/game/JetThrottleGovernor.js`
- **曳光弹定制**（weapons.js，仅 `tracerColor` 武器组）：独立材质缓存（深橙红 0xff4d14）+ 每发随机轴向翻滚（弧光朝向随机）+ 尺寸 ±16% 脉动（反光闪烁）；`smokeEvery`/`smokeBoost` 枪口烟加密放大；未配置组走原共享材质路径，前三关零影响

### #61 云层系统大改（clouds.js，全部新参数缺省=原行为）

针对"稀碎/同平面/厚重/小孔/远云闪动/无远近层次"六条反馈：

- **云系化分布**：`patchiness`（2D value-noise 阈值跳过）+ `patchScale`（云系尺度 18km）+ `spreadMul`（团内散布加宽 2.2 倍，相邻云团渗透合并成片）
- **高度相干**：`yCoherent` 云团高度按低频空间噪声起伏 + 每团 ±0.16 随机（成层而非同平面撒盐）
- **尺寸多样性**：`sizeBias`（pow 分布指数）+ `maxClusterScale`（特大团上限 5.0）
- **稀薄气体感**：opacity 0.5 + `texHoles:false`（真实云无内部孔洞，仅边缘破碎）+ depthContrast 1.5 + volumeShade 1.0（明暗体积感）
- **三层高度带**（extraBands）：低空散云 800-1600m（极淡 0.26）+ 主云系 2800-4500m + 高层薄云 5500-7000m（大而稀 0.22）
- **距离淡出** `distFade: [14000, 21000, 24000]`：远云在雾灭绝阈值前平滑消隐（修远云随视角闪动的根因——大 sprite 雾按片元深度计算），同时形成近清远淡的空中透视
- **天空球背景云**：`coverage` 0.55（远处高空有云）+ `zenithBoost` 0.5（天顶卷云加密 + 3D 噪声采样防天顶拉抻，库尔斯克方案复用）
- 性能：云团 ~250 / 云片 ~1400，距离剔除使任意时刻实际渲染远少于总数

### #62 关卡注册与杂项

- `js/config/levels/index.js`：第4关柏林正式注册（import level_04_berlin.js，替换占位），UNLOCKED_IDS 加 'berlin'
- 追尾相机 chase Y 定版 6.5（调试台导出后经多轮 4.2→5.0→8.0→6.5）
- 出生：空中出生 x=+20km / 4500m / 朝西迎击（yaw=π/2）

### #63 B-17 机群渲染性能优化（离线网格合并，方案A）

**问题**：b17.glb 单架 116 mesh / 28 材质，12 架编队近距同屏实测 **2398 draw call / 92 万三角面**（全材质 doubleSided 双面光栅化 + 高空无用的阴影通道重绘），玩家面向机群掉帧严重。

- **离线管线** `scripts/optimize_b17.mjs`（输入 `model/b17.original.glb` → 输出 `model/b17.glb`，可重复运行）：
  1. dedup 合并完全相同材质（28→23）
  2. 离线删除起落架节点（复刻 enemy.js `hideGearNodes`；**保留** `helice03_FACES01-FACES`——运行时 visible=false 隐藏，但 `_setupPropPivot` 要靠它的几何包围盒算桨毂 pivot，删了 pivot 变 NaN）
  3. 除 4 个螺旋桨组（helice03_FACES01~04 子树，pivot 旋转依赖节点名）外全部按（材质 × 属性签名）合并，世界变换烘焙进顶点；负行列式镜像节点翻转绕序
  4. 不透明材质 doubleSided→FrontSide（桨叶/玻璃/模糊盘保持双面防破洞）
- **结果**：116→26 mesh/架（470→40 节点），**近距 draw call 2398→768（-68%）**，三角面数不变，文件 5.7MB→4.35MB
- **阴影**：`HeavyBomber.load` 内关 castShadow（交战 5000m，阴影相机 far=1400 内无任何可接收面，纯省一个阴影通道）
- **备份/回退**：`model/b17.original.glb` 为原始模型；回退 = 把它复制回 `model/b17.glb`（或重跑管线可从备份重新生成）
- **附带发现**：出生点 10km 外机群本就几乎被视锥/远裁剪剔除（原始/合并模型行为一致，仅 ~18 call 差），掉帧压力集中在近距交战段——正是本次优化覆盖的场景
- **验证**：`tests/python/_b17_closeup_calls.py`（近距 draw call 实测对比）；`b17_tuner.html` 截图目检（几何无破洞、命中球/炮塔/发烟点标定全部对齐——tuner 点位全是 body frame 数值不依赖节点树）；`test_berlin_level.py` + `test_campaign_regression.py` 全绿

### #64 B-17 机群试玩反馈三连修

- **玩家出生朝向修正**：原 `yaw=π/2` 朝西 = 背对自东向西飞来的机群（出生即看不到目标），改 `yaw=-π/2` 朝东迎头；`test_berlin_level.py` 朝向断言同步翻转
- **机群巡航降速**：87 → 50 m/s（不列颠 He111 为 55，用户要求比其更慢；返航速度联动 0.8×=40）
- **受伤返航"卡在空中"修复**：根因有二——① 指数 slerp 转向在低帧率 dt 限幅（`GameRuntime` dt clamp 0.05s，掉帧时游戏时间变慢动作）下会把 180° 转弯拖成小半径原地盘旋，远看像悬停；② 伤员机要一直飞回 x=+38km 东缘才消失，最远挂天上十几分钟。改为 `rotateTowards` 恒定角速度转向（0.35 rad/s 保证收敛）+ 返航后离玩家 >15km（雾中不可见）即脱离（`rtbDespawnDist` 可配）
- **态势图**：`tests/python/_berlin_spawn_map.py`（PIL 绘制，venv-ground 环境）→ `tests/screenshots/berlin_spawn_map.png`，玩家/机群出生点、航线方向、编队放大一图看清
- **验证**：`tests/python/_b17_rtb_repro.py`（击伤→恒定速率稳定转向 + 远距离脱离 12→11 架）；`test_berlin_level.py` + `test_campaign_regression.py` 全绿

### #65 B-17 损伤模型定案 + 262 火力增强（试玩反馈）

**B-17 损伤/坠毁体系**（`js/game/HeavyBomber.js` 全重写，自管粒子不依赖 Aircraft.update）：

- **55% 阈值概率返航**：达阈值 35% 脱离编队返航 / 65% 带伤跟随编队（`rtbChance`）
- **发动机数量状态机**（不叠加，按数量切换）：1 发冒烟不减速 / 2 发 -10% / 3 发 -20%+持续掉血 2/s / 4 发 -25%+掉血 10/s
- **HP<40%**：随机一个冒烟发动机燃大火（浓烟加重 + 每 3s 掉 2）
- **HP<10%**：缓慢坠毁（向下固定 15-20° 拉坠毁浓烟，炮塔停火）
- **坠毁四式**（HP=0；过量伤害 hp≤-100 强制爆炸式）：① 30° 俯冲（随机左右倾 20°，加速到极速 90%）② 缓慢滚转失控翻覆（30-45°，极速 70%）③ 爆燃解体（40-60° 缓慢下坠+翻滚，大火黑烟 + 程序大块零件着火下落/小碎片散落）④ 爆炸（闪光火光 + 白烟爆散 + 碎片拉小烟尘，主体同③）。大块零件/碎片一直下落、离玩家 >1000m 消失；触地爆炸后移除
- **撞机判定**：262 与 B-17 命中球（外扩 6m）接触 → 双方爆炸坠毁，玩家任务失败（GameRuntime 粗筛 260m）

**262 火力**：MK108 伤害 30-55→**45-65**（~8 发击落一架）、弹速 540→**650**；命中特效增强（4-7 灰黑碎片 + 30% 微闪光，`spawnHitDebris` 加 opts 缺省原行为）

**计分**：击伤（+10）过的 B-17 再被击落只再 +10（`b17KillAfterDamaged`，完整击落仍 +25）

- **验证**：`tests/python/_b17_damage_model.py`（T1-T7：概率返航/发动机状态机/大火 DoT/缓慢坠毁俯角与停火/坠毁模式分布与过量爆炸/碎片千码剔除/撞机双双爆炸）；`tests/python/_b17_crash_visual.py` 截图；`test_berlin_level.py` + `test_campaign_regression.py` 全绿

### #66 出生/高度上限调整 + 柏林地面视觉裙边（藏图幅边界）

- **玩家出生高度 4500→6000m**（`level_04_berlin.js` playerStart）；**高空软提示 7000→8000m**，文案改「高度过高，发动机功率将受限」（CombatAltRule ceiling，仍仅提示未实际限功率）
- **问题**：B-17 走廊把战场推到图幅边缘（机群出生 x=+38km，距东缘仅 2km；出生点望东缘 12km，FogExp2 1e-4 仅遮 ~76%），缘外直接露出天空球
- **方案（视觉裙边三件套，不扩展可玩区，`berlinGround.js`）**：
  1. **环形裙边**（ShapeGeometry 外框 320×256km − 主图大小内孔）：初版整板垫 y=-5 在远距离深度精度不足（far=50km 时 40km 处分辨率 ~200m）z-fight 闪动，挖孔零重叠后根除；UV 由世界坐标线性映射，与主图同一映射 + `MirroredRepeatWrapping` → 裙边与主图四缘逐边对齐、向外镜像翻折
  2. **裙边贴图** = 主图运行时降采样 2048×1638 CanvasTexture（~39m/px，各向异性同主图）；初版 256px 太糊与主图锐度跳变明显
  3. **主图边缘羽化**：最外 2km 环带渐进模糊到裙边频率（`featherMeters` 可配），主贴图运行时替换为羽化 CanvasTexture——接缝无频率跳变，俯视也找不到接缝线
- **性能**：+1 draw call / 环形 8 三角形 / 裙边贴图 ~22MB VRAM，羽化为加载期一次性处理；相机 far=50km 处雾已 100%，裙边超出部分被裁剪不可见
- **验证**：`tests/python/_berlin_skirt_visual.py`（挂钩 `_updateCamera` 钉相机——冻结 `_running` 会停渲染不可靠；`skirt_edge_on/off.png` 同机位对照、`skirt_seam.png` 正俯视接缝、`skirt_overview.png` 缘外 80km 回看）；`test_berlin_level.py` + `test_campaign_regression.py` 全绿

### #67 B-17 特效全面加强 + 状态过渡平滑 + 30mm 命中打击感（试玩反馈）

**烟火加强**（`HeavyBomber.js`，全部纯视觉参数，机制未动）：
- **烟/火贴图**：烟径向 alpha 0.75→0.95 核心加密（原纹理外圈过淡，远距离几乎不可读）；火贴图亮核加大（0.35→0.45 半径 0.95 alpha）
- **发动机拉烟**：受损 10→14/s、大火 25→30/s；默认烟团 1.6-2.8m→3.2-4.8m、寿命 0.9-1.5s→2.0-2.8s、不透明度 0.55→0.8；大火发动机火团 2.2-3.8→4.5-7m
- **缓慢坠毁烟**：14→20/s，烟团 5-8m、不透明度 0.9
- **坠毁状态（全四式）**：浓烟改**每拍两个随机机身发烟点**（`_bodyFxPoints`：躯干/翼尖/尾+四发烟点）7-11m 大烟团；**机身大火从③④扩展到全部模式**（16/s、5.5-10m 火团、多点随机闪燃）——"已坠毁的 B-17 拖着大火浓烟下坠"
- 烟 sprite 增加逐个体 `opacity` 字段（原更新循环硬编码 0.55 会把爆散白烟的 0.7 覆盖掉）

**状态过渡平滑**：
- 编队扰动偏移改为每帧记录（`_wobOffset`），进入返航/缓慢坠毁/坠毁时把残余偏移转 `_residualWob` **指数衰减**（e^-2.2t）——原实现切换瞬间扰动硬停，位置跳变最多 ±4m
- 坠毁①俯冲式：滚转 ±20° 从**瞬跳**改为 2.2/s 平滑压倾（`rollTarget`）；坠毁俯仰缓动 1.2→0.9/s；缓慢坠毁压姿态 0.5→0.35 rad/s

**30mm 命中打击感**：
- `weapons.spawnHitDebris` 新增 opts `scale/life/flashSize/flashLife`（全部缺省=原行为，1/3 关调用不受影响）
- B-17 命中分支（GameRuntime）：碎片 0.3-0.6→**1.2-2.4 倍**、每发必触发 5-8m 大闪光（原 30% 概率 1.2-2.4m 微闪光）
- 新增 `HeavyBomber._spawnImpactFx`：命中点 2-4 团 6-11m 火光外抛 + 黑烟团（`onBulletHit` 加第 5 参 hitPos；坠毁中机体被命中也照常放）

**排障记录**：headless 软渲染帧率极低（~2fps），`dt` 限幅 0.05s 使游戏时间流速仅为实时 ~10%——截图验证烟迹类持续特效时必须在页面内手动泵 `updateAll(0.05)` 推进游戏时间（`_b17_fx_visual.py`）

**附带修出的存量 bug（`_b17_damage_model.py` T5 暴露）**：`_updateRtb` 的东缘脱离判定 `x >= 38000` 未算编队槽位偏移——轰炸机出生线 x=38000+slot.x（slot 最大 +2100），返航机在进入返航的**第一帧**就满足 x≥38000 被移除，表现为"击伤 → 当场凭空消失"（也是用户感知"状态切换生硬"的一部分），并让 bomberStream 数组随机缩短、按索引访问的测试随之抖动。改为仅保留 >15km 雾中不可见脱离（`rtbDespawnDist`），伤员机正常掉头东飞、渐远消失在雾中。

**顺带**：
- **P-51 配置注册**（`enemy.js` MODEL_CONFIGS 末尾）：autoOrient + yawOffset=134.0、userScale 3.60、6×.50 机翼枪口（调校台标定值），为后续护航 AI 阶段备料
- `_b17_damage_model.py` T7 撞机用例改轮询等碰撞结果（原固定 1.5s 实时等待在 headless 低帧率下会漏接触帧，纯测试健壮性，断言不变）

**验证**：`_b17_fx_visual.py` 截图目检（`b17_fx_engine.png` 长烟迹 / `b17_fx_impact.png` 命中火球 / `b17_fx_crash_late.png` 坠毁大火浓烟）；`_b17_damage_model.py` T1-T7 全绿

### #68 柏林防空改我方走廊模式（打轰炸机编队，表演性质）

**需求**：第4关防空炮是我方柏林防空军，目标轰炸机队而非玩家，与库尔斯克"敌方防空炮"隔离。

- **`AntiAircraftFlak` 新增 corridor 模式**（配置 `flak.corridor` 才启用，缺省=原"跟随玩家"逻辑逐行不变；`update()` 加第 6 参 `bombers`，GameRuntime 传 `this.bomberStream`）：
  - 走廊 x -30000~15000（东缘=编队入口）向西每 3000m 一个 800m 区间（`segmentEvery/segmentLen`）
  - 开火状态机：前锋 x < 东缘+`leadIn`(700m) 开火、队尾 x < 西缘-`leadOut`(700m) 停火；**start 含"队尾未越过西缘"守卫**——缺它编队飞过后区间会反复启停闪烁（测试抓出）
  - 爆点：区间内 x/z 散布（`zHalf` 2500），高度 = 编队均值 ±`altSpread`(400m)；密度 0.53 爆/s + 4.3 曳光/s（每激活区间）= 原跟随玩家密度的 2/3
  - **表演击落**：前锋深入走廊一半（`killAt` 0.5）时随机一架：机体周围 3 团空爆 + 直接 `_enterCrash(1~3)`——**不报 `killed` 事件，不计玩家积分**；一次性；触地走正常 despawn 移除
- **柏林 flak 配置改写**：删除 positionZone/gun/altBands（走廊模式下的死配置），保留 burst/tracer 视觉参数
- **文档**：`docs/Flak防空火力参数说明.md` 新增"十一、柏林 corridor 走廊模式"章节
- **验证**：`tests/python/_berlin_flak_corridor.py`（区间启停/爆点高度带/击落不计分/飞离停火，全绿）

### #70 友军 Me 262 僚机小队 + 开场推镜过场（第4关专属，AI 全隔离）

**模型选型**（性能评估先行）：僚机直接用玩家同款 `me_262.glb`（14 mesh/72k 面/架，3 架仅 +42 draw call），不引 C-2b（spec-gloss 双座型，转换+重校不划算）；P-51（32 mesh/32 材质/5.3k 面）后续护航阶段先做材质合并再上场（仿 optimize_b17）。

**开场过场** `js/game/BerlinOpening.js`（新）：**鸭式兼容 CinematicSystem 接口**（active/camMode/update/skip/toggleView/computeFixedCam/dispose），GameRuntime 既有剧情接线（锁输入/相机委托/准星隐藏/ESC·C 键转发）零改动复用，与 1/3 关剧情系统互不干扰。镜头从编队后上方（≈7000m 海拔）15s smoothstep 推进到追尾视角（对齐本关 chase 偏移），ESC 跳过黑屏读条。`opening.dialogs` 时间轴留空待文案。
- **坑**：跳过读条期间 `runtime._camMode` 残留 'cinematicFixed'（不在 `_camOffsets`）会崩相机——skip 时立即复位 'chase'
- **坑2（试玩抓出）**：`_update` 剧情分支的拟真波动（±3m/s/±5m）以 `_cinematicBaseSpeed/_cinematicBaseAlt` 为基准，该值仅 `_initCinematic` 记录——BerlinOpening 未记录时 `baseSpd` 退化为当前速度，每帧积分漂移（60fps 下 15s 冲上千 km/h）。`BerlinOpening.start()` 补记录 ✓；起始机位按试玩反馈改 **上方 500m/后方 300m**（`camFrom` 可配）

### #71 僚机小队试玩反馈一轮（7 项）

- **出生点西移 2250m**（28000→25750）：补偿 15s 过场直线位移（150m/s×15s），交还操控时恰在原设计截击位；`test_berlin_level.py` 断言同步
- **指尖编队拉开**：slots [-70,0,90]/[70,0,90]/[150,15,180]（原过密）
- **编队防抖**：槽位目标点低通平滑 + 18m 到位死区（死区内仅匹配速度、8°/s 极低转向率）——原实现每帧全速率修正航向导致微抖
- **高度微扰**：全状态叠加低频 ±3-5m 高度浮动（差量叠加防瞬跳，编队状态减半；262 飞行平稳只缺高度生气）
- **僚机双发凝结尾迹**：>4000m 排放，左右喷气口各 11/s 白淡 sprite（opacity 0.38，留空成带 2-2.8s），简化版不走 JetExhaust
- **视野外僚机方块标记**（squadron 管 DOM）：每帧投影三架，取"离开视野的最近一架"，空心方框贴屏幕边缘指示方向（背后目标翻正）
- **猎杀六模式大收紧**（原参数循环 20-30s、僚机"飞走不回来"，表演稀疏）：全部进入点收到编队周边 250-650m，脱离距离 450-500m，盘旋 400m 半径 5-8s，新增**全局 14s 模式超时**强制重选——目标攻击循环 8-15s/轮，三架轮穿高密度表演
- **验证**：`_berlin_wingmen.py` 全绿；开场/末段截图目检；`test_berlin_level.py` 全绿（过场跳过改为"先等 opening 创建再 skip"——僚机加载期 cinematic 为空，直接 skip 打空+轮询秒过会撞上剧情分支拉回高度的加载竞态）

### #72 僚机小队试玩反馈二轮（翼尖拉烟/连续尾迹/编队跑飞修复）

- **翼尖拉烟高空不触发修复**：`VaporTrail` 高度窗 600-4500m 硬编码 → 柏林 6000m+ 永远不拉烟（用户："不知道什么时候没的"——第4关从来没触发过）。改构造 opts 可配（缺省原值），`playerConfig.vaporAltMax: 8000` 注入（aircraft.js 惰性创建时读取；其他关/机型零影响）
- **僚机尾迹改连续白带**：sprite 球链（间隔大显断续）→ **复用 VaporTrail 带状 mesh**，左右喷口当"翼尖"喂入（实例级覆盖 `getWingTipWorldPositions`），`gThreshold=0/minSpeed=0` 常触发 + 每帧钉 `_willTrail` 绕 30% 随机，>4000m 自动出带；opacity 0.30 白淡，6 条带仅 6 draw call（比球链省几百）
- **编队"提前散开"真因**：跟随速度修正是纯距离正反馈（`base+dist×0.15` 恒≥长机速度，超前永不减速）→ 僚机稳步跑飞到长机前方几百米散开。改**沿航向带符号修正**（落后加速/超前减速，along×0.6），泵测槽位误差从发散 370m 收敛到稳定 ~16m（平滑滞后常量，视觉上就是稳定的跟队位）
- **出生点再调**：24250 / 6300m（过场结束 x≈26500，距机群 ~10.7km，按接近率 200m/s 还有 ~45s 编队飞行时间，满足"至少 8-10s 以上"）
- **开场机位**：上方 200m / 后方 400m（`camFrom`）；**指尖槽位**：前后拉近一半、左右再散 30%（[-91,0,45]/[91,0,45]/[195,15,90]）
- **测试连带**：`_berlin_wingmen.py` 解除判定传送点随高度差改 400m 横向（3D 距离 √（400²+1300²)<1500）；`test_berlin_level.py` 出生断言 24250/6300
- **验证**：编队泵测 20s 槽位误差稳定 16m；`_berlin_wingmen.py` + `test_berlin_level.py` 全绿；截图确认连续双尾迹 + 新机位构图 + 视野外僚机标记生效

**僚机小队** `js/game/Wingman262Squadron.js`（新，`Wingman262 extends Enemy` 仅复用加载/武器底层，AI 全自管运动学转向，永不走 Enemy think）：
- **formation**：指尖槽位跟随（#2 左后 #3 右后 #4 右后远，可配）；任一敌军距编队 <1500m（`breakDist`）→ 全小队**永久解除**
- **hunt 六模式**（权重 15/20/20/5/15/25）：高空俯冲穿越拉外侧 / 下方仰射横走不穿越 / 横向 15-30° 掠射拉起 / 后方斜穿前飞 800m 拉起 / 蜻蜓点水短点射 / 编队上方 1000-1500m 盘旋 8-15s；全部"进入点→开火窗口（对准+80-900m 才放，纯曳光）→脱离→重选"，转向/加减速全限速（30-55°/s，姿态随速度方向重建+压坡）
- **evade**：敌机后半球 <200m → 极速拉开 >600m 重选（P-51 未上线，逻辑休眠待命）
- **表演性质成立机制**：僚机子弹无任何命中检测路径；僚机自身不被受击检测
- **B-17 炮塔多目标化**：`_updateTurrets(dt, targets[])`，每炮塔锁定"射界内最近"的玩家/僚机（僚机只被瞄不受击）；`updateAll` 加第 3 参透传
- **无 B-17 可打**时松散跟随玩家（不恢复指尖编队）

**其他**：`MODEL_CONFIGS` 新增 `/model/me_262.glb` 条目（镜像玩家 playerConfig 校准）；GameRuntime 全部配置门控（`wingmen262`/`opening` 仅第4关配置）；`test_berlin_level.py` 进关即跳过过场
**验证**：`tests/python/_berlin_wingmen.py`（过场锁输入/跳过解锁/编队解除转猎杀分模式/evade 触发/炮塔锁僚机，全绿）+ `wm_opening.png`/`wm_hunt.png` 截图；`test_berlin_level.py` + `_b17_damage_model.py` 回归全绿（T6 下坠断言窗口随 #69 限速俯仰改泵 3s，消残扰符号抖动）

### #69 B-17 特效调参一轮（试玩反馈：命中收敛 / 烟色层次 / 姿态放缓）

- **命中特效收敛**（原偏大偏闪显假）：命中火团 2-4团×6-11m → **1-3团×3.5-5.5m**；命中闪光每发必触发×5-8m → **60% 概率×3.5-5m**；命中黑烟 4.5-7m → 3-4.5m
- **击落烟观感**：不透明度 0.9→**0.7**（过浓显假）；烟纹理改**中性灰底** + 材质灰阶随机（`_CRASH_SMOKE_TINTS` 黑0.30→浅灰0.90 五档，发动机油烟 `_ENGINE_SMOKE_TINTS` 黑~深灰三档，命中烟尘 `_IMPACT_SMOKE_TINTS` 近黑）——单纹理全色域，烟迹有深浅层次；坠毁烟排放 12/s×2 → **16/s×2**（修"断断续续"：烟团间距从 ~12.5m 收到 ~4.7m，小于烟团直径即连续）
- **姿态过渡全面放缓**（用户：重型机改姿态不可能快）：进入坠毁姿态初值改取当前四元数欧拉角（含扰动残量，零瞬跳）；坠毁俯仰/压倾从指数缓动（首秒最快显硬）改**限速线性逼近**——俯仰 ≤6.5°/s（30° 目标 ~5s 压满）、①式压倾 ≤5°/s（20° ~4s）；缓慢坠毁压姿态 0.35→**0.10 rad/s**；返航转向 0.35→**0.20 rad/s**（大转弯 ~16s）
- **验证**：`_b17_fx_visual.py` 截图复验；`_b17_damage_model.py` T1-T7 回归

**#69 修出的自身回归**：#67 的残余扰动衰减实现有误（每帧加全量残值再衰减向量，累计加成 O/(1-d)≈9.6 倍偏移，T6 下坠断言随机翻红）——改为"固定初值 O + 衰减系数 k(1→0)，每帧只加衰减差量 O×(kNew-kOld)"，累计恰为 -O，零瞬跳且无过冲（`_residualWobK`）

### #73 僚机小队三连修（尾迹去带状 / 微震 / 开局调整过程，2026-08-18）

**量化诊断先行**（`tests/python/_wm_opening_diag.py` / `_wm_err_decomp.py`，改前基线）：
开场 14s 僚机稳定吊在槽位**后方 8~9m**（首秒就掉队 −7m）、全程不在 12m 死区内、每帧姿态步进均值 0.28°（60fps 下持续微抖）。根因：`_smoothWp` 指数低通（λ=5/s）追踪以 150m/s 平移的槽位，**稳态滞后 ≈ v/λ ≈ 30m**——僚机追的是滞后点，速度修正平衡后永远坠在槽位后持续修正（= 开局"调整位置过程" + "微弱震动"同源）。

- **尾迹去带状**：弃用 VaporTrail 带状（用户反馈"带状的不行"），新建 `js/game/WingmanJetTrail.js`——玩家 JetExhaust 的简化版：只保留尾气粒子一层（**无热浪锥/热抖动、无喷口辉光**），寿命 2.0-3.2s（玩家 0.45-0.85s）→ **喷流更长**（~150-200m 渐散）；一架飞机左右喷口共 1 个 `THREE.Points`（自定义 shader 软圆斑，世界坐标直写）= **每架仅 1 次 draw call**；空间节距发射 + 0.82 强跟随速度模型（同玩家版游戏化处理）+ 近相机淡出；`wingmen262.trail` 配置可覆盖全部参数
- **微震修复**：① 槽位平滑点加**平移前馈** `v×(1/λ)`，巡航零滞后；② 死区内不再追"槽位前方延伸点"（追点对扰动残差持续修姿态），改**速度方向对齐长机前向 + 残差极缓回拉**（err/83 弧度量级，秒级收敛、姿态近似不动）；③ 扰动首帧从 0 差量开始（`_lastWob` 构造初始化，防出生瞬跳）
- **开局调整过程修复**：开场推镜期间僚机**轨载钉死**在槽位（`_updateRails`：位置/姿态/速度全同步长机，无任何动态修正，扰动也不加；Squadron 每帧按 `_cinematicActive && cinematic.active` 写入 `_rails`）；平滑点与扰动时钟随轨载同步，过场结束/ESC 跳过自动交还动态——**交接零跳变**
- **改后泵测**（`_wm_opening_diag.py` / `_wm_handover_diag.py`）：过场段槽位误差/姿态步进**精确 0**；交接段最大误差 0.57m 无跳变；交接后直平飞误差稳定 0.4-0.8m（改前 8-9m，-91%）、姿态步进 0.10°/帧（改前 0.28°，剩余为长机物理波动传导）
- **目检**：`wm_trail_side.png` 四机指尖编队 + 连续渐散双发喷流（`_wm_trail_side.py`）
- **回归**：`_berlin_wingmen.py` / `test_berlin_level.py` / `test_campaign_regression.py` 全绿

### #74 P-51 护航机群模型优化（离线网格合并 32→9 draw call/架，2026-08-18）

- **背景**：为 6-8 架 P-51 护航编队做性能准备。原 model/p51.glb 有 32 mesh/32 材质（每 prim 1 draw call）→ 8 架 = 256 draw call；几何本身仅 5097 v/5330 tri，瓶颈全在 draw call 与状态切换
- **管线** `scripts/optimize_p51.mjs`（复刻 optimize_b17.mjs 模式）：`model/p51.original.glb`（首跑自动备份）→ `model/p51.glb`，可重复运行
  - 19 个纯色不透明件 → COLOR_0 顶点色烘焙合并为 1 组（本模型导出器把 baseColorFactor 在 COLOR_0 里重复存了一份，最终色=factor²；逐通道烘焙 原COLOR_0×factor 进新顶点色 + 白底材质 → 渲染结果逐位保真），并丢弃无用 TEXCOORD_0
  - 6 个贴图不透明件按纹理分 5 组（机身/机翼/尾码 VIFS13+14 共享/"351"机码/黑白条纹）——纹理承载涂装细节，不可烘焙
  - 4 个半透明小件（红/绿翼尖航行灯 VIFS11/12 + VIFS21/27）→ vec4 顶点色（rgb+alpha 全烘焙）合并单 BLEND 材质
  - 座舱盖 VIFS03 独立成组（近景透明排序安全）；双模糊盘 Cylinder15/16 同轴同位合并为单节点 `p51_propdisc`（未来 `propNodes:['p51_propdisc']` 即可转桨）
  - 全部不透明材质 doubleSided→FrontSide（原 32 材质全双面，光栅化成本减半）；实测无镜像节点（绕序翻转逻辑防御性保留）
- **结果**：每架 draw call 32→9（8 架 256→72，-72%）；节点 128→9；材质 32→9；文件 530KB→435KB；包围盒与原模型逐位一致
- **安全性**（改前核查）：autoOrient 关键词匹配不到 P-51 任何节点 → 用配置 yawOffset=134 兜底，改名安全；枪口为 body frame 数值；当前无关卡生成 P-51（level_04 仅 p51Kill 记分字段）、propBranches 本就为空（静态模糊盘）；无代码引用 P-51 内部节点名
- **回退**：`model/p51.original.glb` 复制回 `model/p51.glb`
- **待目检**：model_tuner.html 加载 P-51 过一遍外观（FrontSide 转换 + 顶点色合并的最终确认）

### #75 P-51 护航编队 AI 上线（8 架 2 中队 4 小队，2026-08-18）

- **编制**：`js/game/P51EscortSquadron.js`（新）——`P51Escort extends Enemy` 仅借模型加载/武器/坠毁底层，AI 全自管运动学（同僚机262模式，与其他关 Enemy AI 零共享）。8 架 = A/B 中队 × 2 小队（A1/A2/B1/B2）× 长僚 2 机
- **伴飞**（escort）：A 中队编队上方 +400m 靠前、B 中队下方 -400m 靠后；僚机在长机后 120m 外侧 60m；槽位平滑 + 平移前馈（沿用 #73 僚机防滞后教训），速度锁机群 50m/s + 带符号纵向修正
- **拦截**（intercept，一次性）：任一 262（玩家/僚机一视同仁）距编队质心 ≤1500m → A1/A2/B1 同时爬升 6500m 对头冲锋（目标按距质心排序依次认领，均匀不重复）；B2 上移 A1 原槽位顶补伴飞；262 逼近 B2 ≤400m 或任一 262 距任一 B-17 ≤500m → B2 也加入猎杀
- **猎杀**（engage）：1000m 内锁定（`_claims` 唯一性仲裁，顺位 A1→A2→B1→B2）；1000-1500m 死带接近不开火（滞回防抖动）；≤400m 且对准（提前量 5.7° 锥）→ 点射 0.8-1.6s + 冷却 1.2-2.4s；追击上限 30s；目标持续 2s 超 600m / 高度出 [3000,7000] 超 1s / 本机低于 3000m → 放弃并自由盘旋 3-6s（玩家攻击窗口）；1500m 无候选 → 编队上方 700m 半径巡行
- **协同**（60/20/20 权重，6-12s 重掷）：same 双机同目标（攻击方式各自随机：对冲/追逐/扫射）/ trail 僚机尾随长机 100-150m（独立控制律+扰动不镜像）/ free 双机各自自由选目标（释放小队认领，允许撞车）；对冲错开后长左僚右分头转向 100-140° 再接敌
- **伤害链路**：P-51 子弹真实弹道（继承本机速度），只结算玩家（2-6/发，.50 机枪）；AI 僚机无命中路径（与僚机子弹无命中路径设计一致）；玩家可击落 P-51（HP120，MK108 2-3 发），击伤 55% +3 / 击落 +8 接入 intercept 计分与胜利判定（`_onP51Event`）
- **接线**（GameRuntime 全部门控 `escortP51`，其他关零影响）：创建（bomberStream 后）/每帧推进（先于僚机，僚机当帧可读 P-51 位置）/命中检测两块（玩家子弹 vs P-51；P-51 子弹 vs 玩家）/雷达红点/咬尾锁定警告并入/stop 释放；僚机小队 env 增 `escorts`——规避与编队解除可见 P-51，但猎杀目标池不含 P-51（僚机无视 P-51 原设计不变）
- **验证**：`node --check`（ESM）四文件通过；vm.SourceTextModule 全链链接/求值通过（P51EscortSquadron/GameRuntime/Wingman262Squadron/level_04）；待试玩目检（拦截冲锋时机/分头转向观感/伤害节奏）
- **回退**：删 level_04_berlin.js 的 `escortP51` 配置块即整体关闭

### #76 P-51 护航试玩反馈一轮修（伤害骰点 / 巡行大圈化 / 触发前移 / 僚机尾喷对齐玩家 / 编队零扰动，2026-08-18）

- **P-51 对玩家伤害收敛**（试玩反馈"攻击太强"）：guns 加 `hitChance: 0.2` + damageMin/Max 2-6 → 3/3——子弹命中时 20% 概率造成 3 点（期望 DPS 约为原 1/6）；命中块骰点未中则子弹静默消失（无伤害无音效，视作擦过）
- **巡行/盘旋大圈化**（原观感"编队上方原地兜圈"）：patrol 半径 700→**1800m**、速度 140→145、限速转向 35→**12°/s**（需求角速度 v/R≈4.6°/s，一圈 ~78s 浅坡连续转弯，符合空气动力学观感；僚机改固定弧长 300m 错相位跟随）；参数入 `escortP51.patrol{radius/alt/speed}`；自由盘旋 `_flyOrbit` 同步放宽（侧向点 350→900m、转向 40→12°/s，盘旋半径 ≈670m，非原地急转）
- **首次拦截触发前移**：判定从"任一262→编队质心 ≤1500m"改"**任一262 ↔ 任一在编 B-17 最近距离 ≤2000m**"（质心判据对箱式队形偏保守：队尾距质心 >1km，262 咬尾时迟迟不触发）；`triggerDist: 2000`
- **玩家出生点西移 3000m**：playerStart x 24250→**21250**（过场推进后距机群前缘 ~13.7km，按接近率 200m/s ≈ 59s 后进入触发圈——为 P-51 提前前冲留窗口）
- **僚机 262 尾喷对齐玩家观感**（原"松散过长"）：`wingmen262.trail` 配置覆盖缺省——节距 2.0→**0.9m**、寿命 2.0-3.2s→**0.45-0.85s**、出生尺寸 1.15→1.35、膨胀 3.4→4.0、后喷 26→40、跟随 0.82→0.85、粒子池 230→**300**（240m/s 下存活峰值 ~227，不截断续流）；纯配置覆盖，WingmanJetTrail 代码零改动
- **僚机编队状态零扰动**（原编队半幅 ±1.5-2.5m 是残余震颤来源）：高度微扰仅在非编队状态施加，编队/轨载平飞钉队形；`_lastWob` 始终跟踪全幅当前值，解除编队瞬间差量从 0 连续起步零瞬跳
- **占位图**：`scripts/draw_berlin_layout.py` 生成 `docs/berlin_initial_layout.png`（俯视等比 + 侧视高度分布 + 玩家编队放大 inset）
- **验证**：四文件 `node --check`（ESM）通过；待试玩目检（P-51 前冲时机/大圈巡行观感/尾喷连续度/编队震颤消除）

### #77 击落失败倒计时 + P-51 防撞规避（2026-08-18）

- **击落任务结束倒计时**（试玩反馈"被击落不会马上终止游戏"）：新增 `levelConfig.downed { graceSec:3, countdownSec:8 }`（仅第4关配置）——HP=0 坠毁 → 3s 演出宽限 → HUD 红字闪动"你被击落了 · 任务结束倒计时 N"（复用 altFence 通道 countdown 级样式，玩家坠毁后高度规则 hudState 恒 null 自动让出通道）→ 8s 归零 `_onPlayerDead()` 任务失败；其他关无此配置 → 保持"爆炸计时归零即结算"原行为不变
- **P-51 防撞规避**（试玩发现追击时与玩家追尾穿模）：Squadron 每帧 `_updatePlayerAvoid`（最高优先级，escort/intercept/engage/patrol 任何状态生效）——距离/接近率双阈值触发（<90m 贴身必触发；<170m 且接近率 >35m/s；<260m 且接近率 >120m/s 高速对头提前量）→ 本机立即放弃目标、向远离玩家一侧满转 + 前冲 + 爬升 120m 规避 1.15s；长机触发时顺带释放小队认领并进 3-6s 重选窗口（兼作玩家攻击窗口）；规避中飞机跳过状态机由 Squadron 直接接管飞规避航点；参数 `escortP51.avoid{near/mid/midClosing/far/farClosing/dur}` 全部可调；规避过期后自动回到原状态机（小队目标仍在则继续接敌）
- **验证**：三文件 `node --check`（ESM）通过；待试玩目检（倒计时文案与闪动、对头/追尾场景规避时机、规避后重选节奏）

### #78 全局命中/擦过音效 + 柏林专属喊话系统 + 多段序列音乐 + 拦截进度UI + 界面文本审核回写（2026-08-20）

#### 1. 全局命中玩家音效 + 子弹擦过音效
- **命中玩家**：`audio.js` 新增 `playPlayerHit()`（beHit01-03.mp3 随机），`GameRuntime.js` 3 处命中玩家音效替换（原通用 hit 音 → 专属被命中音）
- **擦过音效**：`audio.js` 新增 `playSidePassBy()`（side1-3.mp3 随机）；`GameRuntime._updateLockWarning` 改造——被咬尾且敌机开火时 30% 概率触发，1-3s 冷却防刷屏
- **音文件**：`sound/hit/beHit01-03.mp3`、`sound/hit/side1-3.mp3`；`audio.js` 新增 `loadGlobalSfx()` 预加载 + `_playerHitBuffers`/`_sideBuffers` 缓冲池

#### 2. 柏林专属喊话系统（`js/game/BerlinChatter.js`，新）
- **开局喊话**：8 句序列（指挥官→僚机→指挥官交替），开场后逐句播放
- **战斗喊话**：6 类（随机报点/事件/咬尾/击落击伤/阵亡），**每次只触发一条**（去掉"干得好"回复避免刷屏）
- **间隔**：报点 35-55s，事件 55-75s
- **战斗开始门控**：`_combatStarted` 初始 false，P-51 首次拦截（`p51Escort._intercepted`）或玩家进入 B-17 空域 ≤2000m 时置 true，之后才开始战斗喊话
- **接线**：GameRuntime 门控 `levelConfig.chatter`，仅柏林关配置；其他关零影响
- **审核文档**：`docs/柏林喊话审核.md`

#### 3. 柏林多段序列音乐（`js/game/BerlinMusic.js`，新）
- **流程**：m1（highWar.mp3）→ elg → m2 → [6s] → 交替循环（elg ↔ m2）→ [进度 ≥90%] → 循环 m3
- **接管**：`AppShell._playCombatMusic` 检查 `levelConfig.berlinMusic` 跳过旧 playMusic，避免双轨叠加
- **音文件**：`sound/bl/{elg,m1,m2,m3}.mp3` + `sound/highWar.mp3`（m1 替换为 highWar）

#### 4. 拦截进度 UI
- **位置**：左上角，360px 宽，现代无面板风格（无实色背景框）
- **结构**：`hud-template.js` 加 `#intercept-card`（ic-header/ic-row/ic-stats）；`HudController.js` 缓存 DOM + 每帧更新进度
- **样式**：`Theme.js` 加 CSS——进度条 10px 高 + 流光动效（`@keyframes ic-flow`）+ 渐变金色；文字醒目（label 14px / 百分比 28px / stats 13px）
- **门控**：`levelConfig.intercept` 字段门控，仅柏林关配置；HudController 一次性加 `intercept-mode` class，CSS 隐藏任务面板（`#mission-panel`）
- **数据源**：GameRuntime 每帧同步 P-51 拦截进度（已拦截数/总数、击落数、剩余时间）

#### 5. 界面文本审核回写
- **版本号**：0.65.8.16 → **0.72.8.19**（`CoverPage.js`）
- **第3关简报**：尾句改写（`level_03_kursk.js`）
- **第4关配置**（`level_04_berlin.js`）：难度 3→**4 星**、totalEnemies 0→**20**、新增 `displayWaves:1`、简报改写
- **`LevelSelectPage.js`**：支持 `displayWaves` 字段（关卡卡片显示波次数）
- **favicon**：`index.html` 加 PNG favicon link
- **审核文档**：`docs/界面文本审核.md`

#### 6. 雾效调整（已回退）
- 尝试 FogExp2 + BerlinGround shader clamp 雾因子上限（density/maxFactor 多轮调参），效果不理想
- 已完全回退到原始状态：`level_04_berlin.js` fog 配置（color 0xd8dee4 / density 0.00010）、`environment.js` 雾创建（单行 FogExp2）、`berlinGround.js`（无 fogMaxFactor / 无 _applyFogClamp），三处均恢复备份原值

---

## 2026-08-20 · 性能优化 + 自由模式 Me 262

### #79 库尔斯克地面物品清理
- **目标**：减少库尔斯克关卡开场渲染压力，移除战斗中不可见的地面细节
- **改动**：
  - `js/kurskBattlefield.js`：构造函数注释 11 类无用生成调用（弹坑/战壕/焦土/补给/士兵/雾气/烟柱/闪光/德军虎式坦克），`_buildSovietDefenses` 删战壕保留 37mm 高炮，`_buildAAGunPositions` 注释补给卡车
  - `js/config/levels/level_03_kursk.js`：8 个数量字段置 0
  - 保留：防空阵地 + 苏军 T-34 坦克 + 防空炮位士兵
- **隔离**：仅影响库尔斯克，不列颠/巴巴罗萨不变。回归通过

### #80 斯图卡渲染优化（方案 A：关阴影 + 关拉烟）
- **目标**：减少斯图卡编队的 draw call 和 overdraw
- **改动**：
  - `js/enemy.js`：`MODEL_CONFIGS['/model/ju87.glb']` 加 `castShadow: false, noVaporTrail: true`
  - `js/game/FriendlyBomber.js`：构造函数加 `_castShadow` 属性 + `_applyModelConfig` 读取 + `load` 后遍历关闭 castShadow/receiveShadow
- **效果**：draw call ~2240 → ~1120
- **注**：方案 B（合并 mesh + InstancedMesh）已回退——自动化测试位置偏差 0.000m 但实际显示异常，备份保留在 `_backup/stuka_merge_20260820_1608/`

### #81 库尔斯克云层优化（云量 -80%）
- **目标**：减少库尔斯克 Sprite 云的 draw call 和 overdraw
- **改动**（`js/config/levels/level_03_kursk.js` clouds 配置）：
  - 主云带 spacing 500→700 + patchiness 0.6（跳过 60% 格子，块状云系+大片晴空）+ patchScale 8000
  - 额外云带 spacing 1500→3000
  - 新增 distFade [3500, 6000, 8000]（3.5km 内全显，6km 淡出，8km 隐藏）
- **效果**：云团 ~456→~94（-79%），Sprite ~2568→~522（-80%），叠加 distFade 运行时再剔除远云 draw call
- **回归**：三关通过，隔离无泄漏

### #82 自由模式 Me 262 加入 + 武器伤害 ×0.75
- **目标**：把 Me 262 喷气截击机加入自由模式供玩家选择，武器伤害调低 25%（仅自由模式生效）
- **改动**：
  - `js/config/freemode/aircraft.js`：新增 `ME262_PLAYER` 配置（独立复制第 4 关校准/物理/武器/喷气专属配置，不 import levels），加入 `PLAYER_AIRCRAFT` 数组。MK108 伤害 ×0.75：`damageMin 45→34, damageMax 65→49`
  - `js/freemode/FreeModeRuntime.js`：补充喷气机专属配置处理（门控分支，活塞机型无此字段 = 原行为不变）：
    - import `JetExhaust` + `JetThrottleGovernor`
    - `start()`：注入 `vaporAltMax` + 创建 JetExhaust/JetThrottleGovernor + 设置 engineSound/engineSoundFile
    - `_update()`：每帧更新喷气尾流 + 油门管理器
    - `_updateHud()`：传递 jetThrottle HUD 状态
    - `stop()`：清理喷气尾流 + 恢复活塞引擎音
- **隔离**：所有改动仅在 `js/freemode/` + `js/config/freemode/`，不 import `js/config/levels/*`。三关回归通过

### #83 巴巴罗萨云层优化（云量 -90%）
- **目标**：大幅减少巴巴罗萨 Sprite 云的 draw call 和 overdraw
- **改动**（`js/config/levels/level_02_barbarossa.js` clouds 配置）：
  - 主云带 spacing 500→700 + patchiness 0.82（跳过 82% 格子）+ patchScale 8000
  - 额外云带 spacing 1500→4000
  - 新增 distFade [3000, 5000, 7000]（3km 内全显，5km 淡出，7km 隐藏）
- **效果**：云团 ~456→~43（-90%），Sprite ~2568→~237（-91%）

### 下一步候选（截至 #83，2026-08-20）

#### 第 4 关《柏林保卫战》待目检 / 收尾
- **试玩目检**（#75-#78 多处标注「待试玩目检」）：P-51 拦截冲锋时机 / 分头转向观感、僚机猎杀六模式表演密度、B-17 命中/坠毁特效节奏、击落倒计时文案闪动、拦截进度 UI 流光
- **B-17 凝结尾迹**（#63 遗留「下一阶段」）：高空速度感核心参照，未落地。僚机/玩家 262 已有 `WingmanJetTrail`/`JetExhaust`，B-17 需独立实现（多发动机翼尖凝结带，复用 VaporTrail 喷口驱动或新建）
- **同屏架次性能**：B-17×N + P-51×8 + 僚机 262×3 + 玩家已接近上限，30+ 架次时评估 InstancedMesh 方案（AGENTS.md 候选）

#### 其他关卡
- **第 5 关《血战中途岛》**：`index.js` 已占位 + `stg5.png` 卡片图已备，从 0 搭建（地图 / 机型 / 波次 / 剧本）
- **第 1-3 关迭代**：库尔斯克地面物品放置（`交接文档_库尔斯克关卡.md` P1/P2 待实现：坦克 InstancedMesh / 弹坑 / 战壕 / 防空阵地）、不列颠细节打磨；巴巴罗萨/库尔斯克云层已优化（#81/#83）

#### 通用
- 玩家飞机专用调整工具（aimLift 座舱上抬 + aircraft.js 构造函数参数，Bf 109 已从 model_tuner 移除见 #36）
- 自由模式：Me 262 已加入可选机型（#82），更多地图开放、敌机 AI 多样化、得分/击落数显示（框架搭建中，见 AGENTS.md 隔离约定）
