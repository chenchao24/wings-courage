/**
 * 关卡 03 ·《鏖战库尔斯克》
 * 1943.07.05 库尔斯克会战（堡垒行动），人类历史上最大的坦克会战。
 * 玩家驾驶 Fw 190 A-4 为德军装甲集群提供空中掩护，对抗红军 Yak-9 / Yak-7 战斗机
 * 与 IL-2 对地攻击机。空战特征：大规模、低空、伴随大量 IL-2。
 *
 * 【隔离原则】本关所有设置独立，不影响第1/2关的 Bf 109。
 *   - playerModel: Fw 190 A-4（非 Bf 109）
 *   - playerConfig: 关卡级玩家参数覆盖（GameRuntime 在 load 前注入）
 *   - 不改 aircraft.js 构造函数默认值（第1/2关走默认）
 *
 * P1 阶段：可玩骨架（playerConfig + 基础环境 + 简单波次）。剧情/对话后续迭代。
 */
export default {
  id: 'kursk',
  index: 3,
  name: '鏖战库尔斯克',
  subtitle: 'Battle of Kursk',
  date: '1943.07.05',
  cardImage: '/img/stg3.webp',
  difficulty: 3,
  briefing:
    '1943 年 7 月 5 日，堡垒行动打响。你驾驶 Fw 190 A-4 从前线机场起飞，' +
    '为德军装甲矛头提供空中掩护。红军空军倾巢而出，Yak 战斗机与 IL-2 攻击机铺天盖地而来。' +
    '夺取制空权，猎杀攻击机，上尉。',
  locked: false,
  playerModel: '/model/fw_190_a-5.glb',
  music: '/sound/adevnAs.mp3',
  // 关卡音乐系统：主题曲间隔循环 + 战斗高潮曲切换（由 LevelMusic 接管，AppShell 跳过旧 playMusic）
  levelMusic: {
    theme: '/sound/kersk.mp3',       // 库尔斯克主题曲（间隔循环）
    combat: '/sound/highWar.mp3',    // 战斗高潮曲（敌机进入 4000m 播一次）
    gapMin: 6, gapMax: 10,           // 循环间隔（秒）
    triggerRadius: 4000,             // 敌机触发半径（米）
    fadeSec: 1.5,                    // 淡入淡出时长
  },
  totalEnemies: 8,

  // 玩家开火音效：按武器组区分（见 weapons.groups.*.sound），不再用关卡级共用音效

  // ════════════════════════════════════════════════════════════
  // 关卡级玩家参数覆盖（GameRuntime 在 load 前注入，覆盖 Aircraft 构造函数默认值）
  // 参数来源：player_tuner_fw190.html 调校导出。
  // 枪口为初始估值，待 player_tuner_fw190 精调后更新。
  // ════════════════════════════════════════════════════════════
  playerConfig: {
    // 校准（load 内 _normalize/_autoOrient/_applyCalibration 读取）
    // autoOrient=false：Object_2 在机尾方向，autoOrient 把它当机头会算反方向。
    // 模型原始机头在 +Z（非 glTF 惯例），yawOffset=180 翻转使机头对齐 body frame -Z。
    autoOrient: false,
    yawOffset: 180.0,
    userScale: 3.81,                   // 3.6 × 10.50 / 9.92（Fw 190 A 翼展 10.5m）
    centerOffset: [0.00, 0.00, -3.05], // 几何中心前移修正
    engineSoundFile: '/sound/eg/fw190-eg-loop.wav',  // Fw 190 实录引擎（无缝循环烘焙版，随油门变调）
    // 本模型整个飞机是一个节点 Object_7（机身），无独立桨叶节点，桨叶几何与机身合并。
    // 下方程序化桨配置（_setupProceduralProp 在桨毂位置程序化生成模糊盘+旋转桨叶）。
    // propNodes 留空：autoOrient 已禁用，无需机头参考节点。
    propNodes: [],

    // 起落架隐藏（Object_3/4/5 为起落架 mesh，飞行时隐藏）
    hideGear: true,
    hideGearNodes: ['Object_4', 'Object_3', 'Object_5'],

    // 座舱玻璃透明化（Object_9 不透明，需强制透明让玩家座舱视角能看出去）
    glassNodes: ['Object_9'],

    // 座舱内部光源（隐藏玻璃后座舱内漆黑，PointLight 照亮仪表贴图）
    // 位置在座舱视角略上前方，暖白色模拟仪表板琥珀灯
    cockpitLight: {
      x: 0.00, y: 2.40, z: 4.80,   // 光源位置（body frame，座舱位置 z=5.28 略前）
      color: 0xfff2d8,              // 暖白（仪表板琥珀灯感）
      intensity: 2.0,               // 强度（够照亮仪表，distance 限制不外溢）
      distance: 16,                 // 光照范围（body 单位，不照亮机身外部）
      decay: 2.0,
    },

    // 程序化螺旋桨（模型无独立桨叶节点，桨叶与机身合并）
    // 在桨毂位置程序化生成模糊盘 + 旋转桨叶，原静态桨叶被盘视觉吸收。
    propProcedural: true,                // 模型无独立桨叶节点，桨叶与机身合并
    propBlurDisc: true,                  // 模糊盘（覆盖静态桨叶）
    propBlurStyle: 'fw',                 // FW190 专用模糊盘纹理（纯黑模糊边缘）
    propHubOffset: [-0.10, -0.45, -5.80], // 桨毂位置（body frame，机头=-Z）
    propRadius: 5.20,                    // 桨叶半径（body frame 单位）
    propBladeCount: 3,                   // 3 片桨叶
    propBladeChord: 0.85,                // 桨叶最大弦宽（纺锤形中段最宽处，body frame 单位）
    propBladeTwist: 35,                  // 扭转角（度，根部高迎角→叶尖低迎角）
    propSpinSpeed: 295,                  // rad/s
    propOpacity: 0.00,                   // 程序化桨叶透明度（0=完全透明，仅靠模糊盘呈现）
    propBlurStrength: 0.90,              // 模糊盘强度

    // 静态桨叶透明切割（shader discard）
    // 模型桨叶与机身合并（Object_7），无法隐藏节点。在 shader 中让桨叶区域顶点 discard。
    // 区域由 player_tuner_fw190.html 调校确定：Z=-7~-5.5，圆心(0,-0.5)，半径>0.8。
    // 不修改几何，完全可逆，仅本关生效。
    propCut: { zMin: -7.0, zMax: -5.5, cx: 0.0, cy: -0.5, radius: 0.8 },

    // 枪口（6 个：机头 2 挺 MG 17 + 机翼 4 门 MG 151/20，body frame，机头=-Z）
    muzzleOffsets: [
      [ 0.40,  1.65, -1.80],  // 右机头机枪
      [-0.40,  1.65, -1.80],  // 左机头机枪
      [ 3.10, -1.60, -2.65],  // 右翼内机炮
      [ 7.80, -1.10, -1.65],  // 右翼外机炮
      [-3.10, -1.60, -2.75],  // 左翼内机炮
      [-7.85, -1.20, -1.70],  // 左翼外机炮
    ],
    // ──────────────────────────────────────────────────────────
    // 武器组配置（与飞机绑定，关卡级独立，不影响第1/2关 Bf 109）
    // FW190 A-4 史实武器：2×MG 17（机头 7.92mm）+ 4×MG 151/20（机翼 20mm 机炮）
    // 每个枪口独立配置：射速/初速/伤害/子弹尺寸/是否爆炸
    // 历史：MG17 射速 1200发/分(0.05s)，初速 755m/s
    //       MG151/20 射速 750发/分(0.08s)，初速 720m/s，配 Minengeschoß 高爆燃烧弹
    // 游戏化：机炮射速略降避免性能问题，伤害差异化体现 20mm 火力优势
    // idx 对应 muzzleOffsets 顺序：0/1=机头机枪，2/3/4/5=机翼机炮
    // ──────────────────────────────────────────────────────────
    weapons: {
      groups: {
        mg17: {                          // MG 17 7.92mm 机枪（机头 2 挺）
          muzzleIndices: [0, 1],
          fireRate: 0.10,                // 秒/发/枪口（10 发/秒/枪口，史实 1200发/分≈0.05s 游戏化降速）
          bulletSpeed: 750,              // 初速 750 单位/秒（史实 755 m/s）
          damageMin: 5,                  // 步枪口径低伤害
          damageMax: 10,
          bulletScale: 1.0,
          bulletColor: 0xfff4c8,         // 金白曳光弹
          explosive: false,
          sound: { file: '/sound/gun/fw190-131-2.mp3', loopStart: 0.0, loopEnd: 0.21 },  // 机鼻2门：0~0.21s循环枪声，0.21s后回响
        },
        mg151: {                         // MG 151/20 20mm 机炮（机翼 4 门）
          muzzleIndices: [2, 3, 4, 5],
          fireRate: 0.18,                // 秒/发/枪口（5.5 发/秒/枪口，史实 750发/分≈0.08s 游戏化降速）
          bulletSpeed: 700,              // 初速 700 单位/秒（史实 720 m/s）
          damageMin: 18,                 // 20mm 高爆弹高伤害（用户指定）
          damageMax: 36,
          bulletScale: 2.0,              // 视觉放大 2 倍
          bulletColor: 0xfff4c8,
          explosive: true,               // 命中触发爆炸碎片效果
          sound: { file: '/sound/gun/fw190-151-2.mp3', loopStart: 0.02, loopEnd: 0.29 },  // 双翼4门：0.02~0.29s循环枪声，0.29s后回响
        },
      },
    },

    // 飞行物理（Fw 190 A-4 史实：maxSpeed 656km/h≈175，滚转强、盘旋弱）
    maxSpeed: 175,
    minSpeed: 8,
    cruiseSpeed: 110,
    pitchMax: 1.25,
    pitchResp: 5.5,
    rollMax: 3.4,
    rollResp: 7.5,
    yawMax: 0.7,
    yawResp: 3.5,
    gravity: 4.0,
    liftK: 0.026,
    diveAccel: 10,            // 俯冲额外加速（街机特色：机头朝下加速、朝上减速，BZ 能量感）
    stallThreshold: 12,

    // 座舱/相机参数（关卡级覆盖；FW 190 座舱位置与 Bf 109 不同，机枪在 z=-1.80，座舱需后移）
    cockpit: {
      x: -0.04, y:  2.25, z:  5.04,   // 座舱位置（body frame）
      lookDist: 192,
      aimLift: 0.145,
      aimDist: 1600,
      chase: { x:  0.00, y:  4.20, z:  12.50 },
    },
  },

  // 玩家初始位置：库尔斯克突出部南端德军集结区（标注出生点 2002,-16624）
  // 高度 2200 米（初始巡航高度，构思文档约定）
  // 朝北 yaw=π：地图坐标系 z+北/z-南，玩家从南方(z=-16624)朝北飞向战场(z=-8254)
  //   getForward()=(0,0,-1)经quaternion旋转，yaw=π时forward=(0,0,1)朝+Z(北)
  playerStart: {
    position: [2002, 2200, -16624],
    yaw: Math.PI,
    speed: 90,
  },

  // 关卡环境：库尔斯克独立主题（继承 barbarossa 草原基底 + 无海岸无海洋，
  // terrain.js/buildings.js/ocean.js 都不检查 theme 字符串，kursk 走 else 分支自动获得草原）
  // 主题改为 'kursk'（原 'barbarossa'）：保证从 barbarossa 切到 kursk 时 AppShell 正确重建环境，
  // 不再被同主题跳过优化误判（修复 skyClouds 等差异配置不生效的潜在 bug）
  environment: {
    theme: 'kursk',

    // 卫星地面（#92，BerlinGround 通用类）：普罗霍罗卡以南草原 44×44km（Sentinel-2 2024-08-28，
    // 管线 scripts/fetch_kursk_ground.py）；无 Terrain/KurskRoads/Buildings（roads 由
    // environment.js 按 ground.type 门控跳过）；terrain 配置保留仅作回退
    ground: {
      type: 'satellite',
      texture: '/img/kursk/ground.jpg',
      width: 44000,
      depth: 44000,
      name: 'kurskGround',
      skirtColor: 0x5c5640,          // 卫星图均值（农田棕绿）
      fallbackColor: [93, 87, 64],
    },

    // 低空日出→上午偏晨（#92：纯平卫星图后 10° 低阳的"丘陵长阴影"不复存在，
    // 抬高到 28° 让贴图受光均匀；暖橙色调保留堡垒行动清晨氛围）
    sun: {
      elevation: 28,
      azimuth: 95,               // 东方偏南（默认 150）
      color: 0xffd9a0,           // 暖橙日出光（默认 0xffe8c0）
    },
    sky: {
      topColor: 0x2a5a9a,        // 天顶稍深蓝（日出蓝天）
      midColor: 0x7fa8c8,        // 中段过渡
      bottomColor: 0xe8c8a0,     // 地平线暖橙（日出霞光）
      // #91：地平线辉光带取雾灰白与霞光暖橙之间的暖米灰（本关雾色刻意中性，见 fog 注释）
      horizonColor: 0xe8e0d0,
      horizonStrength: 0.60,
      horizonWidth: 0.10,
    },
    fog: {
      // #94：线性雾 near 取负值 → 全局 ~5% 空气底雾 + 50km 处 ~90% 封顶（同柏林）
      type: 'linear',
      near: -9900,
      far: 65000,
      color: 0xe4e0d4,
    },
    lights: {
      hemiSky: 0xc8b890,         // 暖天光（默认 0xbfd8ff 蓝白）
      hemiGround: 0x4a3d2a,      // 暗土地面反弹光（默认 0x4a5d3a 草绿）
      sunIntensity: 3.5,         // 略强（默认 3.0，低角度光更硬朗）
    },

    // 地形尺寸：与大不列颠一致（48000/600，80m/顶点）
    //   库尔斯克突出部是开阔大平原会战，地形应广袤；原默认 18000 过小，远处 6.5km 即雾化，
    //   调大到 48000 后边缘雾化起点延至 ~17.3km，远处丘陵与草原天际线充分展开
    //   kursk 无海岸无海洋，仅需 size/segments（无 coastline/cliffHeight 等 britain 专用字段）
    terrain: {
      size: 48000,
      segments: 600,           // 600 段（80m/顶点），草原缓起伏足够平滑
    },

    // 天边云（保留库尔斯克盛夏晴朗风格，覆盖率略低于第2关）
    skyClouds: {
      enabled: true,
      color: 0xf4f6f8,         // 亮白云基色
      highlight: 0xf8f4e8,     // 暖白高光
      coverage: 0.55,          // 覆盖率 55%（地平线层云+中空层积云更密，地平远方云量足）
      drift: 0.005,
      farDarken: 1.0,
      // 天顶云增强（仅本关，不影响第1/2关）
      //   zenithBoost：天顶卷云加密 + band 上界推高 + 3D 噪声采样（无接缝无极点拉抻）
      //   0.5 适中（太密天顶云压顶感重，太稀天顶空荡），3D 噪声已消接缝无需靠稀薄掩盖
      zenithBoost: 0.5,
    },

    // 库尔斯克战场（#86 起为纯数据模块：只按 flak 配置计算防空炮位坐标 aaGunPositions，
    // 供 AntiAircraftFlak 发射曳光/爆点；地面物件——程序化 T-34/炮阵地/士兵等 ~4600 mesh——
    // 在实战高度不可见，已全部移除，旧实现见 git 历史）
    battlefield: {
      enabled: true,
    },

    // 防空火力 Flak 视觉（纯视觉，不接伤害；详见 docs/Flak防空火力设计文档.md）
    // 区域化发射：友军区域无高炮，主战场越靠近苏军越多，苏军阵地密集。
    // 高度分段：非苏军 500-1000m（主要 500-800），苏军 0-1500m（800 以下增多、1200-1500 较少）。
    flak: {
      enabled: true,
      activeR: 2000,          // 玩家周围活跃半径
      cullR: 4000,            // 粒子超出此距离回收
      maxBursts: 80,          // 同时活跃烟团上限
      maxTracers: 80,         // 同时活跃曳光线上限

      // ── 阵地防空带（继承老苏军阵地全部系数）──
      positionZone: [[-16952,5883],[20874,5883],[20874,7934],[-16952,7934]],
      positionDensity: 1.6,       // 继承老苏军阵地系数
      positionBurstRate: 1,       // 老基础齐射频率
      positionTracerRate: 12,     // 老基础曳光弹频率
      positionGroupSize: 3,       // 每组3门防空炮
      positionGroupSpacing: 1200, // 每隔1200m一组

      // ── 后方防空带（每区域随机4门炮）──
      rearZones: [
        [[-17034,10970],[-9362,10970],[-9362,13022],[-17034,13022]],
        [[-4644,11052],[2576,11052],[2576,13186],[-4644,13186]],
        [[5038,11011],[12341,11011],[12341,13186],[5038,13186]],
        [[14638,11052],[21120,11052],[21120,13022],[14638,13022]],
      ],
      rearGunsPerZone: 4,

      // ── 战场防空（每区域3门炮）──
      battlefieldZones: [
        [[-15311,-1255],[-10306,-1255],[-10306,2724],[-15311,2724]],
        [[-4029,-1214],[1797,-1214],[1797,2847],[-4029,2847]],
        [[7623,-968],[11561,-968],[11561,2724],[7623,2724]],
        [[16156,-1543],[21079,-1543],[21079,3052],[16156,3052]],
        [[-12152,-4931],[-6367,-4931],[-6367,-2183],[-12152,-2183]],
        [[976,-4726],[8812,-4726],[8812,-2306],[976,-2306]],
        [[13612,-5136],[17510,-5136],[17510,-2593],[13612,-2593]],
      ],
      battlefieldGunsPerZone: 3,

      // ── 每门炮参数 ──
      gun: {
        coverage: 1200,        // 覆盖半径（米）
        altMin: 300,           // 最低射高
        altMax: 1500,          // 最大射高
        density: 0.2,          // 每门炮密度系数
        burstRate: 0.4,        // 每门炮齐射/秒
        tracerRate: 0.9,       // 每门炮曳光弹/秒
      },

      // 高度分段（统一 300-1500m）
      altBands: [
        { alt: [300, 800],   weight: 1.2 },
        { alt: [800, 1200],  weight: 1.0 },
        { alt: [1200, 1500], weight: 0.35 },
      ],

      // ── 苏军坦克区 ──
      tankZones: [
        [[-15516,6704],[-1075,6704],[-1075,9780],[-15516,9780]],
        [[5571,6827],[19315,6827],[19315,9739],[5571,9739]],
        [[-7024,3463],[8935,3463],[8935,5801],[-7024,5801]],
      ],
      tankSpacing: 1000,        // 横向每1000m
      tanksPerKm: 4,            // 4台坦克
      tankSoldiers: [5, 7],     // 每台坦克后5-7名士兵

      // 视觉参数
      burst: {
        smokeColor: [40, 40, 44],
        fireColor:   [255, 200, 120],
        smokeLife: 28,
        smokeBlobs: [3, 7],
        smokeSize: [60, 180],
        smokeMaxScale: 1.5,
        fireLife: 0.15,
        salvo: [3, 5],
        salvoSpread: 800,
      },
      tracer: {
        color: [255, 90, 60],
        life: [0.20, 0.40],
        len: [180, 320],
      },
    },


    // 建筑（村庄/桦树林）：暂时关闭，后续按地图标注重新迭代
    // enabled:false → 跳过村庄/森林生成，得到纯净地形（关卡隔离，不影响第1/2关）
    buildings: { palette: 'kursk', enabled: false },
  },

  // 中空云团（性能优化版：云量 -80%，patchiness 块状分布 + distFade 距离剔除）
  clouds: {
    mode: 'fixed',
    bandBox: [-6000, 6000, 1200, 1400, 1500, -7000],
    spacing: 700,            // 500→700：网格变疏（24×17=408 → 17×12=204 格）
    patchiness: 0.6,         // 块状分布：跳过 60% 低值格子 → ~82 云团（云系+大片晴空）
    patchScale: 8000,        // 噪声尺度 8km：晴空区成片出现，非零散空洞
    blobsPerCluster: [5, 7],
    minSize: 320,
    maxSize: 720,
    opacity: 0.88,
    depthContrast: 1.0,
    // 体积感阴影：per-blob 灰度变化（部分偏暗作阴影层/偏亮作受光层）+ 纹理内部暗斑/亮斑，
    // 多片重叠时明暗差异 → 云团立体层次感。仅本关开启，不影响第1/2关。
    volumeShade: 0.7,
    shadowEnabled: false,
    cloudColor: [242, 244, 248],
    // 距离淡出：3.5km 内全显，3.5~6km 线性淡出，8km 外整团隐藏（减少远云 draw call + 消除雾阈值闪动）
    distFade: [3500, 6000, 8000],
    extraBands: [
      {
        bandBox: [-6000, 6000, 1200, 1400, 1500, -7000],
        spacing: 3000,       // 1500→3000：8×6=48 → 4×3=12 云团
        blobsPerCluster: [2, 3],
        minSize: 220,
        maxSize: 420,
        opacity: 0.5,
        sizeBias: 1.6,
      },
    ],
  },

  // ════════════════════════════════════════════════════════════
  // 开场剧情：玩家编队（长机+玩家）+ 3 批斯图卡编队交汇
  //
  // 玩家：从 (2002, 2200, -16624) 朝 +Z 飞，速度 90
  //   z(t) = -16624 + 90t，到可操控点 z=-11254 需 ~60s
  //   （#87：原 z=-8254/93s，斯图卡致敬后 ~45s 空窗太长；接敌点南移 3km 压缩到 ~11s）
  //
  // 长机（冯·莱纳）：跟随玩家左前方，拉远靠前方便玩家一眼看到
  //   followOffset: { x:-65, y:12, z:-95 }（左=-X, 前=-Z，距离≈115m）
  //   使用玩家同款 FW-190 模型+校准（modelConfig:'playerConfig'）
  //
  // 3 批斯图卡分批次出现（Ju-87 B，都从西向东飞，高度差 150m）：
  //   批次1：3 机 V 字，航线 z=-13500，高度 2050，交汇 t≈35s
  //   批次2：4 机 Schwarm，航线 z=-13000，高度 1900（-150m），交汇 t≈40.5s
  //   批次3：3 机 V 字，航线 z=-12500，高度 1750（-150m），交汇 t≈46s
  //     └ 其中 1 架僚机冒烟飞行（对地攻击受损返航）
  //   每批航线 x 有小偏移（±200m），方向大体一致但略有错开，更真实
  // ════════════════════════════════════════════════════════════
  cinematic: {
    enabled: true,
    showRotateHint: true,         // 剧情阶段屏幕上方提示"鼠标右键可旋转视角"
    autoSwitchSec: 5,             // 开场 5s 后自动从座舱切到第三方视角（默认 15s）
    triggerZ: -11254,      // 玩家朝 +Z 飞到 z=-11254（可操控开始点）触发接敌
    triggerDir: 'pos',     // 玩家朝 +Z 飞（z 增大），z >= triggerZ 时触发（默认 'neg' 朝 -Z 飞）
    skipToZ: -11400,       // 跳过剧情后切到 z=-11400（略靠南，z < triggerZ）
    wingmanImmediateEngage: true,  // 僚机恢复控制后立即脱离跟随（第3关专属；第1关走原逻辑等距敌<1000m）
    camAuto: { height: 11, lookAhead: 12 },  // 第三方环视相机：抬高俯瞰 + 看前方（第1关不配=默认height5/lookAhead0）
    timeline: [
      { t: 0,  type: 'phase', phase: 'intro' },         // 开场：座舱视角，引擎轰鸣
      { t: 2,  type: 'hint' },                           // 2s 提示"按 C 切换视角"（5s 自动切前先提示）
      { t: 12, type: 'phase', phase: 'briefing' },       // 长机简报（3句）
      { t: 30, type: 'phase', phase: 'stukaSight' },     // 长机提示看斯图卡编队
      { t: 38, type: 'phase', phase: 'stukaSalute' },    // 长机致敬+斯图卡回复
    ],
    dialogs: {
      intro: [],  // intro 阶段无对白（纯引擎轰鸣 + 斯图卡渐近）
      briefing: [
        { speaker: '冯·莱纳', role: '长机·上尉', text: '博克，新飞机适应如何？中低空速度、俯冲、滚转是我们的优势，切忌长时间盘旋缠斗。', duration: 6500, avatar: 'commander' },
        { speaker: '冯·莱纳', role: '长机·上尉', text: '今日城堡行动首日，我们的任务是夺取制空权，拦截对地轰炸的伊尔-2，掩护装甲部队推进。', duration: 6500, avatar: 'commander' },
      ],
      stukaSight: [
        { speaker: '冯·莱纳', role: '长机·上尉', text: '看下面，早上出发的斯图卡在返航——刚完成对地攻击回来。', duration: 5500, avatar: 'commander' },
      ],
      stukaSalute: [
        { speaker: '冯·莱纳', role: '长机·上尉', text: '斯图卡编队，这里是 FW-190 游隼队。辛苦了，上尉。', duration: 5000, avatar: 'commander' },
        { speaker: '斯图卡编队长', role: '友军·上尉', text: '游隼队，这边空域交给你们了。祝好运，猎杀顺利。', duration: 5500, avatar: 'commander' },
      ],
      // 接敌时排队播放：指挥部预警 → 长机战斗指令（逐句播放）
      interceptChat: [
        { speaker: '指挥部', role: '地面·预警', text: '预警！发现多个空中目标接近战区，准备战斗！', duration: 5000, avatar: 'tower' },
        { speaker: '冯·莱纳', role: '长机·上尉', text: '收到。散开队形，自由猎杀！', duration: 4000, avatar: 'commander' },
        { speaker: '冯·莱纳', role: '长机·上尉', text: '注意使用俯冲战术，打完就拉起。', duration: 4000, avatar: 'commander' },
        { speaker: '冯·莱纳', role: '长机·上尉', text: '注意身后，随时警戒！', duration: 3500, avatar: 'commander' },
      ],
    },
  },

  cinematicFormations: [
    // ── 玩家编队长机（冯·莱纳，跟随玩家左前方）──
    // followPlayer 模式：长机作为 NPC 跟随玩家保持 body frame 偏移
    // body frame（玩家 yaw=π 朝 +Z）：左=-X，前=-Z
    // 左前方（距离≈115m）+ 高 12m → offset (-65, 12, -95)
    // spawn = 玩家位置 + offset 经 yaw=π 旋转 = (2002+65, 2212, -16624+95)
    // modelConfig:'playerConfig' → 使用关卡 playerConfig 校准（朝向/缩放/起落架/螺旋桨等与玩家一致）
    {
      id: 'leader',
      model: '/model/fw_190_a-5.glb',
      formation: 'single',
      modelConfig: 'playerConfig',  // 注入玩家校准参数（朝向/起落架/螺旋桨等）
      followPlayer: true,
      followOffset: { x: -65, y: 12, z: -95 },
      spawn: { x: 2067, y: 2212, z: -16529 },
      yaw: Math.PI,   // 与玩家同向朝 +Z
    },

    // ── 斯图卡批次1（3机V字，西→东，航线 z=-13500，高度 2050）──
    // 交汇点 (2002, 2050, -13500)，t≈35s
    {
      id: 'stuka1',
      model: '/model/ju87.glb',
      formation: 'v',            // 3 机 V 字编队（长机+左右僚机）
      spacing: 80,
      trailOffset: 55,
      cruiseSpeed: 80,
      spawn: { x: -798, y: 2050, z: -13500 },
      route: [
        { x: -798, y: 2050, z: -13500 },
        { x: 8000, y: 2050, z: -13500 },
      ],
    },

    // ── 斯图卡批次2（4机Schwarm，西→东，航线 z=-13000，高度 1900）──
    // 4 机编队（长机+左右僚机+尾机），高度比批次1低 150m
    // 航线 x 偏移 -200m（略偏南，方向大体一致但有小错开）
    {
      id: 'stuka2',
      model: '/model/ju87.glb',
      formation: 'four',         // 4 机 Schwarm 编队（长机+左右僚机+尾机）
      spacing: 80,
      trailOffset: 55,
      cruiseSpeed: 80,
      spawn: { x: -1040, y: 1900, z: -13000 },
      route: [
        { x: -1040, y: 1900, z: -13000 },
        { x: 7800,  y: 1900, z: -13000 },
      ],
    },

    // ── 斯图卡批次3（3机V字，西→东，航线 z=-12500，高度 1750，1架冒烟）──
    // 高度比批次2低 150m，航线 x 偏移 +200m（略偏北）
    // smokingIndices:[1] → 左僚机冒烟（对地攻击受损返航）
    {
      id: 'stuka3',
      model: '/model/ju87.glb',
      formation: 'v',
      spacing: 80,
      trailOffset: 55,
      cruiseSpeed: 80,
      smokingIndices: [1],       // 左僚机冒烟飞行
      spawn: { x: -598, y: 1750, z: -12500 },
      route: [
        { x: -598, y: 1750, z: -12500 },
        { x: 8200, y: 1750, z: -12500 },
      ],
    },
  ],

  // 波次：3 波 6 架（2+2+2），苏方主力 Yak-9 / Yak-7
  // 库尔斯克苏方空军主力：Yak-9（1943 服役）、Yak-7、La-5FN
  // 倾向高空作战：第一波 2300m，后续波次 1800-2200m
  // 出生距离：首波 4000m（#87 提前遭遇，压缩开场空窗），后续波 7000m（玩家前方），
  // 保持编队缓慢靠近，玩家进入 1200m 触发散开接战。
  // aiOverride：
  //   - breakDist 1200：远距离出生需更早散开（默认 500m 太近，7km 接近耗时久）
  //   - patrolAltMin/Max 拉高到 1800-2300：匹配高空出生高度，避免 think() 高度上限
  //     检测（myPos.y > patrolAltMax+100）误触发强制下降，导致敌机在出生高度与巡逻
  //     高度（默认 400-1000）间反复横跳"飞上飞下"
  //   - 机动参数（maxRoll/maxPitch/maxYaw/evasionChance）不覆盖，走战斗机基准默认值
  //     （此前曾削弱以补偿玩家弱火力，现已增强玩家武器 MG151/20 18-36，恢复敌机正常水平）
  waves: [
    {
      formation: 'pair', count: 2, label: '北方双机编队', model: '/model/yak9.glb',
      spawnAlt: [2300, 2300], spawnDist: 4000,
      aiOverride: { breakDist: 1200, patrolAltMin: 2000, patrolAltMax: 2300, aglFloor: 300 },
    },
    {
      formation: 'pair', count: 2, label: '近卫精英双机', model: '/model/la5.glb', tier: 'elite',
      looseFormation: true,   // La-5 精英高速（209），宽编队（150m）比紧密编队（50m）更易保持
      spawnAlt: [3200, 3600], spawnDist: 7000,
      aiOverride: { breakDist: 1200, patrolAltMin: 3200, patrolAltMax: 3600, aglFloor: 300 },
    },
    {
      formation: 'pair', count: 4, label: '伊尔-2强击机', model: '/model/il2.glb', type: 'attacker', tier: 'normal',
      spawnAlt: [400, 600], spawnDist: 7000,
      aiOverride: { breakDist: 1200, patrolAltMin: 300, patrolAltMax: 500, aglFloor: 150 },
      // IL-2 循环波次：每次4架/2编队，从4刷新点随机选2个，循环刷新直到击落4架
      il2Wave: {
        spawnPoints: [
          { x: -6572, z: 12398 },
          { x: -1854, z:  9731 },
          { x:  8197, z:  9813 },
          { x: 13530, z: 12275 },
        ],
        killTarget: 4,           // 击落4架后剩余IL-2撤退
        despawnBoundary: 14000,  // 飞到此边界外消失
      },
    },
  ],

  // 对话脚本：本关专有，全部由长机（冯·莱纳）提醒
  // 取消系统默认僚机喊话和击落喊话，改用长机语音
  // 对白来源：调试文档/库尔斯克剧情脚本.md（v1 初稿）
  dialogs: {
    onStart: { speaker: '冯·莱纳', role: '长机·上尉', text: '红军空军来袭！准备接战！', avatar: 'commander' },
    onWaveStart: [
      // 第1波：Yak-7B 制空争夺
      { speaker: '冯·莱纳', role: '长机·上尉', text: '两架雅克-7，十一点钟方向，高度两千八。咬上去！', duration: 4500, avatar: 'commander' },
      // 第2波：La-5FN 精英对决（多句入队逐条播放）
      [
        { speaker: '冯·莱纳', role: '长机·上尉', text: '高空有飞机接近，看速度是近卫的 La-5，从上方压下来了！', duration: 5000, avatar: 'commander' },
        { speaker: '冯·莱纳', role: '长机·上尉', text: '占着高度，集中精神，这些家伙不好对付。', duration: 4500, avatar: 'commander' },
      ],
      // 第3波：IL-2 进场（地面指挥）
      { speaker: '地面指挥', role: '装甲矛头指挥', text: '地面报告多个伊尔-2编队在南面低空区域，注意该型攻击机有正面装甲，优先攻击侧面和尾部，但要注意尾部机枪威胁', duration: 5500, avatar: 'tower' },
    ],
    // 波次全灭后的剧情窗口对白（嵌套数组，入队逐条播放）
    onWaveCleared: [
      // 第1波清场：指引飞往 B 区域
      [
        { speaker: '冯·莱纳', role: '长机·上尉', text: '空域暂清。东南方向有新动静，跟我转向，保持高度优势。', duration: 5000, avatar: 'commander' },
        { speaker: '博克上士', role: '僚机·你', text: '明白，跟随。', duration: 2500, avatar: 'player' },
      ],
      // 第2波清场：核心转折——长机负伤离场 + 地面广播
      // 通话结束后长机脱离编队调头返航；地面广播紧接其后，为第3波铺垫
      [
        { speaker: '冯·莱纳', role: '长机·上尉', text: '指挥部，游隼1号机身中弹，评估损伤，无法继续战斗，申请返航', duration: 4000, avatar: 'commander' },
        { speaker: '博克上士', role: '僚机·你', text: '长机！你还好吗？！', duration: 3000, avatar: 'player' },
        { speaker: '冯·莱纳', role: '长机·上尉', text: '游隼2，我没事。油压在掉，需要立刻返航。', duration: 5000, avatar: 'commander' },
        { speaker: '上士', role: '僚机·你', text: '收到，游隼2，继续执行肃清任务', duration: 3000, avatar: 'player' },
        { speaker: '冯·莱纳', role: '长机·上尉', text: '注意伊尔-2的装甲，别靠太近，保持速度和高度，保重', duration: 6000, avatar: 'commander' },
        { speaker: '地面指挥', role: '装甲矛头指挥', text: '地面前哨报告！有编队伊尔-2出现，目前威胁地面坦克部队', duration: 6500, avatar: 'tower' },
        { speaker: '地面指挥', role: '装甲矛头指挥', text: '游隼2，请尽快支援', duration: 5500, avatar: 'tower' },
        { speaker: '博克上士', role: '僚机·你', text: '游隼2，收到', duration: 5500, avatar: 'player' },
      ],
    ],
    // 第1/2波击落喊话（随机抽一条）
    onEnemyKilled: [
      { speaker: '上士', role: '僚机·你', text: '击中！一架起火！', avatar: 'player' },
      { speaker: '冯·莱纳', role: '长机·上尉', text: '漂亮，保持节奏。', avatar: 'commander' },
      { speaker: '冯·莱纳', role: '长机·上尉', text: '干掉一架，别恋战，注意编队。', avatar: 'commander' },
      { speaker: '上士', role: '僚机·你', text: '一架拉格坠落！', avatar: 'player' },
      { speaker: '冯·莱纳', role: '长机·上尉', text: '还有一架，盯紧他！', avatar: 'commander' },
    ],
    // 第3波 IL-2 击落喊话（按击落序号取，非随机）
    // 第4架击落时不喊话，直接进 victoryChat
    onEnemyKilledWave3: [
      { speaker: '地面指挥', role: '装甲矛头指挥', text: '一架伊尔-2坠落！装甲部队谢谢你了！', avatar: 'tower' },
      { speaker: '地面指挥', role: '装甲矛头指挥', text: '又一架！保持，他们撑不了多久了！', avatar: 'tower' },
      { speaker: '地面指挥', role: '装甲矛头指挥', text: '击落伊尔-2报告', avatar: 'tower' },
    ],
    onPlayerDamaged: { speaker: '冯·莱纳', role: '长机·上尉', text: '注意损伤，别硬撑，机动规避！', avatar: 'commander' },
    onAllClear: { speaker: '冯·莱纳', role: '长机·上尉', text: '空域清除！装甲矛头继续推进！', avatar: 'commander' },
    onPlayerDead: { speaker: '冯·莱纳', role: '长机·上尉', text: '上士！……该死，坚持住，我们马上派人……！', avatar: 'commander' },
    victoryChat: [
      { speaker: '地面指挥', role: '装甲矛头指挥', text: '强击机威胁全部清除！战线空域稳固了，干得好，游隼2！', duration: 6000, avatar: 'tower' },
      { speaker: '博克上士', role: '僚机·你', text: '收到，现在返航', duration: 3000, avatar: 'player' },
    ],
  },

  // 战斗中长机随机提醒（CD 定时触发，不依赖轰炸机开火）
  // 仅本关配置 leader 字段，其他关走 bomber/wingman 分支不受影响
  combatChatter: {
    leader: [
      { speaker: '冯·莱纳', role: '长机·上尉', text: '注意高度！', avatar: 'commander' },
      { speaker: '冯·莱纳', role: '长机·上尉', text: '注意身后！', avatar: 'commander' },
      { speaker: '冯·莱纳', role: '长机·上尉', text: '不要和它绕圈！', avatar: 'commander' },
    ],
  },

  // 教学略（玩家通过前两关已熟悉操作）
  tutorial: [],

  mission: {
    type: 'destroy_all',
    target: 8,
    waves: 3,
    label: '击落全部来袭敌机，掩护装甲矛头',
  },
};
