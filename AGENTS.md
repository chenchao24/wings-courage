# AGENTS.md · 项目协作约定

## 铁原则：自由模式与战役模式完全隔离

**自由模式（Free Mode）与战役模式（Campaign）必须 100% 代码隔离，任何修改不得跨模式影响。**

### 强制约束
1. **不继承战役类**：`FreeModeEnemy` 不得 `extends Enemy`，`FreeModeRuntime` 不得 `extends GameRuntime`。
   - 仅允许 `extends Aircraft`（Aircraft 是纯机制基类：模型加载/飞行物理/坠毁/粒子，无任何 AI/关卡逻辑）。
2. **不引用战役配置**：自由模式不得 `import` `js/config/levels/` 下任何文件；地图配置独立复制到 `js/freemode/`。
3. **不共享 AI 配置**：自由模式敌机 AI 配置（`_aiCfg`/`MODEL_CONFIGS`/`AI_TYPE_CONFIGS`）独立维护，不从 `enemy.js` 读取。
4. **修改战役代码不得影响自由模式**：改 `Enemy.js`/`GameRuntime.js`/`WaveDirector.js`/`js/config/levels/*` 时，自由模式行为必须不变。
5. **修改自由模式代码不得影响战役**：改 `js/freemode/*` 时，战役三关行为必须不变。
6. **共享底层允许**：`Aircraft`/`Weapons`/`Controls`/`Radar`/`HudController`/`environment`/`clouds`/`audio` 等纯机制模块可共享（它们无模式语义）；但自由模式的调用方式、配置实例必须独立。

### 目录约定
```
js/freemode/          # 自由模式专属代码（隔离区）
  ├── FreeModeEnemy.js
  ├── FreeModeRuntime.js
  └── FreeModeMaps.js
js/config/freemode/   # 自由模式配置数据（隔离区）
  ├── aircraft.js
  ├── maps.js
  └── difficulty.js
js/app/pages/
  ├── FreeMapSelectPage.js
  └── FreeHangarPage.js
```

### 验证清单（改自由模式后必跑）
- 战役三关（不列颠/巴巴罗萨/库尔斯克）加载、敌机 AI、坠毁、对话不变
- 自由模式新功能生效

## 版本
- 当前：0.72.8.20
- 自由模式框架搭建中；Me 262 已加入自由模式可选机型（#82，武器伤害 ×0.75）
- 第 4 关《柏林保卫战》P1 已落地（2026-08-16 ~ 08-17，详见 docs/CHANGELOG.md #58-#62）：
  - **地图**：`js/berlinGround.js`（纯平 + Sentinel-2 卫星贴图 80×64km，`theme:'berlin'` 唯一入口）；管线 `scripts/fetch_berlin_ground.py`；#66 起加**视觉裙边**藏图幅边界（环形零重叠平面 + 主图降采样镜像延伸 + 主图边缘 2km 羽化，`skirtScale/skirtTexSize/featherMeters` 可配）
  - **Me 262 玩家机**：spec-gloss→PBR 转换（scripts/convert_me262_specgloss.mjs）、`player_tuner_me262.html` 调试台、4×MK108（tracerColor 曳光定制）、史实物理包线
  - **喷气三件套**（playerConfig 门控）：文件引擎音（`engineSoundFile`，无缝循环烘焙 scripts/make_engine_loops.py）、尾流特效 `js/JetExhaust.js`（`jetNozzles`）、油门管理 `js/game/JetThrottleGovernor.js`（`jetThrottle`，80% 连续/90% 峰值/冷却）
  - **规则**：`js/game/CombatAltRule.js` 交战高度规则（`combatAlt`，<2000m 倒计时判负或重置 4000m）
  - **云层**：clouds.js 云系化（patchiness/yCoherent/spreadMul/distFade/extraBands/texHoles，缺省=原行为）
  - 共享文件仅加"缺省关闭/缺省原值"门控分支；回归：`tests/python/test_berlin_level.py` + `tests/python/test_campaign_regression.py`
- **B-17 轰炸机群已落地**（`bomberStream` 配置 + `js/game/HeavyBomber.js`，直飞/受伤返航/炮塔提前量；`b17_tuner.html` 标定），并做了**网格合并优化**（CHANGELOG #63）：
  - 管线 `scripts/optimize_b17.mjs`：`model/b17.original.glb`（原始备份）→ `model/b17.glb`（116→26 mesh/架，近距 draw call 2398→768）；重跑模型管线前不要删备份
  - 关键坑：`helice03_FACES01-FACES` 不能删（运行时隐藏，但 `_setupPropPivot` 靠它算 pivot 包围盒）；4 个桨叶组节点名是 pivot 旋转的查找键，合并必须绕过
  - P-51 护航 AI 已上线（#75-#77，8 架 2 中队 4 小队）；B-17 凝结尾迹待做（#63 遗留）；同屏架次 30+ 再评估 InstancedMesh
- **友军 262 僚机小队已落地**（CHANGELOG #70-#73）：`js/game/Wingman262Squadron.js`（extends Enemy 仅借加载底层，AI 全自管：指尖编队→1500m 解除→六模式猎杀表演/规避；双发喷流尾迹 `js/game/WingmanJetTrail.js`，#73 去 VaporTrail 带状改粒子软圆斑，每架 1 draw call）+ `js/game/BerlinOpening.js`（15s 推镜开场，鸭式复用 CinematicSystem 接线）；炮塔多目标化（玩家/僚机就近）；**编队跟随须带符号速度修正 + 平移前馈**（#72 纯距离正反馈跑飞 / #73 指数低通稳态滞后）