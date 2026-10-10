/**
 * 关卡 01 ·《风云不列颠》
 * 1940.09 不列颠战役，Bf 109 E-4 从法国海岸跨海拦截英国皇家空军喷火战斗机。
 *
 * 地图：英吉利海峡地貌（海:陆 ≈ 7:3）
 *   - 地形 size 24000（halfSize 12000）
 *   - 海岸线 z = -5000：z > -5000 海域，z < -5000 陆地（英国一侧）
 *   - 玩家初始 (0, 700, -3600) 朝 -Z（朝向陆地）
 *   - 敌机生成于玩家前方 1400-1900（z = -5000 ~ -5500，刚进入陆地）
 *
 * 环境：灰蓝、雾气重、多阴天（典型海峡天气）
 *   - 天空：浅灰蓝渐变
 *   - 雾：密度高于巴巴罗萨（0.00035），灰蓝色
 *   - 太阳：低仰角，偏冷色（被云遮挡感）
 *   - 海水：灰蓝偏暗
 */
export default {
  id: 'britain',
  index: 1,
  name: '风云不列颠',
  subtitle: 'Battle of Britain',
  date: '1940.09.15',
  cardImage: '/img/stg1.png',
  difficulty: 2,
  briefing:
    '1940 年 9 月 15 日，不列颠战役的关键一天。你驾驶 Bf 109 E-4 从法国海岸起飞，' +
    '跨越英吉利海峡，在英国南部海岸上空遭遇皇家空军喷火战斗机拦截。注意燃料与海峡天气，上尉。',
  locked: false,
  playerModel: '/model/bf109_opt.glb',
  music: '/sound/adevnAs.mp3',
  // 关卡音乐系统：主题曲间隔循环 + 战斗高潮曲切换（由 LevelMusic 接管）
  levelMusic: {
    theme: '/sound/fight.mp3',       // 不列颠主题曲（间隔循环）
    combat: '/sound/highWar.mp3',    // 战斗高潮曲（敌机进入 5000m 播一次）
    gapMin: 8, gapMax: 10,           // 循环间隔（秒）
    triggerRadius: 5000,             // 敌机触发半径（米）
    fadeSec: 1.5,                    // 淡入淡出时长
  },
  totalEnemies: 4,

  // 玩家初始位置：剧情模式出生点 z=21000（海侧边界前 3000m）
  // 朝 -Z 直飞，约 5分51秒飞到 z=5200 触发接敌。期间播放开场剧情（座舱/第三方视角自由观察，不可操纵）
  // 出生点靠后到 z=21000（海上），利用海峡纵深给护航更多时间
  playerStart: {
    position: [120, 2070, 21000],   // x=120 偏右（相对轰炸机长机 x=0，玩家在编队右侧护航位）；y=2070（整体+300）
    speed: 45,              // 与 FriendlyBomber._cruiseSpeed 一致，护航编队同步
    // yaw 默认 0：机头朝 -Z（跟随编队方向）
  },

  // ──────────────────────────────────────────────────────────
  // 玩家武器组配置（与飞机绑定，关卡级独立）
  // Bf 109 E-4 史实武器：2×MG 17（机头 7.92mm）+ 2×MG FF/M（机翼 20mm 机炮）
  // 枪口顺序见 aircraft.js muzzleOffsets：[0]右翼 [1]左翼 [2]右机头 [3]左机头
  // 历史：MG 17 射速 1200发/分(0.05s)，初速 755m/s
  //       MG FF/M 射速 540-600发/分(0.10-0.11s)，初速 700m/s，20mm 高爆弹
  // 游戏化：MG FF/M 弱于 FW190 的 MG 151/20（早期型 vs 改进型），射速略快补偿数量少
  // ──────────────────────────────────────────────────────────
  playerConfig: {
    weapons: {
      groups: {
        mg17: {                          // MG 17 7.92mm 机枪（机头 2 挺）
          muzzleIndices: [2, 3],         // 机头枪口
          fireRate: 0.08,                // 秒/发/枪口（史实 1200发/分≈0.05s 游戏化降速）
          bulletSpeed: 755,              // 初速 755 单位/秒（史实值）
          damageMin: 3,                  // 步枪口径低伤害
          damageMax: 8,
          bulletScale: 1.0,
          bulletColor: 0xfff4c8,         // 金白曳光弹
          explosive: false,
          sound: { file: '/sound/gun/bf109-792.mp3', loopStart: 0.02, loopEnd: 0.11 },  // 机头机枪：0.02~0.11s循环，0.12s后回响
        },
        mgff: {                          // MG FF/M 20mm 机炮（机翼 2 门）
          muzzleIndices: [0, 1],         // 机翼枪口
          fireRate: 0.14,                // 秒/发/枪口（史实 540-600发/分≈0.10s 游戏化降速）
          bulletSpeed: 700,              // 初速 700 单位/秒（史实值）
          damageMin: 15,                 // 20mm 高爆弹（弱于 FW190 MG151/20 的 18-36）
          damageMax: 28,
          bulletScale: 1.8,              // 视觉放大 1.8 倍（略小于 FW190 的 2.0）
          bulletColor: 0xff5520,         // 橙红色曳光弹（与 FW190 一致）
          explosive: true,               // 命中触发爆炸碎片效果
          sound: { file: '/sound/gun/bf109-20.mp3', loopStart: 0.02, loopEnd: 0.13 },  // 机翼机炮：0.02~0.13s循环，0.14s后回响
        },
      },
    },
  },

  // 开场剧情系统（CinematicSystem 驱动）：出生后锁操纵，按时间轴播对白 + 分兵演出，飞到 triggerZ 接敌
  cinematic: {
    enabled: true,
    showRotateHint: true,         // 剧情阶段屏幕上方提示"鼠标右键可旋转视角"
    triggerZ: 10000,        // 飞到此 z 触发接敌
    skipToZ: 11000,         // 跳过剧情后切到这个 z（须 > triggerZ，否则跳过即接敌）
    timeline: [
      { t: 0,  type: 'phase', phase: 'intro' },        // ① 0-15s 开场引擎轰鸣，座舱视角
      { t: 8,  type: 'hint' },                          // 8s 提示按 C 切换视角
      { t: 15, type: 'phase', phase: 'briefing' },      // ② 编队简报（4 句）
      { t: 32, type: 'phase', phase: 'freeObserve1' },  // ② 后间隙 10s 自由观察
      { t: 42, type: 'phase', phase: 'silence' },       // ③ 静默过渡 4s（杂音切入）
      { t: 46, type: 'phase', phase: 'splitBriefing' }, // ④ 分兵转折（7 句丰富对白）
      { t: 96, type: 'splitStart' },                    // 分兵演出开始（第三方固定视角）
      { t: 96, type: 'phase', phase: 'farewell' },      // ⑤ 嘱托告别（与分兵演出并行，3 句）
      // ⑦ 分兵后空白期闲聊（3 段，段间静默，填充 t=116~244 空白窗口）
      { t: 120,   type: 'phase', phase: 'splitChat1' }, // 态势确认+护航分工
      { t: 158.5, type: 'phase', phase: 'splitChat2' }, // 轰炸机-战斗机打配合
      { t: 192.5, type: 'phase', phase: 'splitChat3' }, // 能量俯冲战术+英国雷达
      // ⑥ 接敌告警由 triggerZ 物理触发，不在时间轴
    ],
    dialogs: {
      briefing: [
        { speaker: '默滕斯',   role: '编队指挥', text: '编队保持 4800，航向 090，距离海岸四分钟。',         duration: 5000, avatar: 'commander' },
        { speaker: 'Falke-2',  role: '僚机',     text: 'Falke-1，今天空域很安静。',                         duration: 4000, avatar: 'radio' },
        { speaker: 'Falke-1',  role: '长机·你',  text: '不要放松警惕。',                                    duration: 4000, avatar: 'player' },
        { speaker: 'Adler-1',  role: '护航二队长', text: 'Falke 小队、Adler 小队，左右高位警戒。',             duration: 4500, avatar: 'commander' },
      ],
      splitBriefing: [
        { speaker: 'SEE-STELLE', role: '雷达站',  text: '紧急通报！主攻机场防空火力骤然增强，原定高度突防损失将超预期。东北 7 公里处发现防御薄弱的备用雷达站--该站正引导英军战斗机实施拦截，打击优先级提升至一级。', duration: 12000, avatar: 'tower' },
        { speaker: '默滕斯',     role: '编队指挥', text: 'SEE-STELLE 收到。方案调整：分兵分散拦截。哈通，你带三机转攻雷达站，拔掉他们的眼睛；多林，你的三机继续原任务，主攻机场。', duration: 11000, avatar: 'commander' },
        { speaker: '哈通',       role: '轰炸机二队长', text: '哈通收到，三机转向雷达站。多林，看你的了。',       duration: 5000, avatar: 'radio' },
        { speaker: '多林',       role: '轰炸机一队长', text: '多林明白，继续主攻。',                            duration: 4000, avatar: 'wingman' },
        { speaker: 'Adler-1',    role: '护航二队长', text: '战斗机配比--Adler 小队随哈通分队护航；Falke-1，你带 Falke-2 留下掩护多林的轰炸机。', duration: 8000, avatar: 'commander' },
        { speaker: 'Falke-2',    role: '僚机',     text: '双机掩护三架 Ju-88……长官，这压力不小。',          duration: 5500, avatar: 'radio' },
        { speaker: 'Falke-1',    role: '长机·你',  text: '明白。尽全力守住，轰炸优先。',                     duration: 4500, avatar: 'player' },
      ],
      farewell: [
        { speaker: 'Adler-1',  role: '护航二队长', text: '风险我清楚。Falke-1，避免主动缠斗，驱赶敌机，守住轰炸机后半球。轰炸优先于击落。汇合点：海峡中线 4000 米，禁止单机返航。祝好运。', duration: 12000, avatar: 'commander' },
        { speaker: 'Falke-2',  role: '僚机',     text: 'Adler-1，保重。',                                   duration: 3500, avatar: 'radio' },
        { speaker: '多林',     role: '轰炸机一队长', text: '恢复原航向，距目标三分钟，全员警戒。',               duration: 4500, avatar: 'wingman' },
      ],
      // 分兵后空白期闲聊（3 段，定稿见 docs/dialog_level1_split.md）
      splitChat1: [
        { speaker: 'Falke-2', role: '僚机',       text: '长机，哈通组已脱离。现在双机掩护多林编队。', duration: 4500, avatar: 'radio' },
        { speaker: 'Falke-1', role: '长机·你',    text: '收到。注意高度，英国佬经常自从高处来。',     duration: 4500, avatar: 'player' },
        { speaker: 'Falke-2', role: '僚机',       text: '明白，六点钟归我。',                       duration: 3000, avatar: 'radio' },
        { speaker: '多林',    role: '轰炸机一队长', text: 'Falke 小队，多林。编队保持 2100，三分钟后进入目标上空。', duration: 5000, avatar: 'wingman' },
        { speaker: 'Falke-1', role: '长机·你',    text: 'Falke-1 收到。在你左右。',                 duration: 3500, avatar: 'player' },
      ],
      splitChat2: [
        { speaker: '多林',    role: '轰炸机一队长', text: 'Falke，说一下预案。如果有英国佬出现，轰炸机保持队形不动，靠交叉火力自卫。Ju 88 的炮塔不是摆设。', duration: 6500, avatar: 'wingman' },
        { speaker: 'Falke-1', role: '长机·你',    text: '收到，Falke 自由猎杀！',                   duration: 3500, avatar: 'player' },
        { speaker: '多林',    role: '轰炸机一队长', text: '注意炮塔火力射界。',                       duration: 3000, avatar: 'wingman' },
        { speaker: 'Falke-2', role: '僚机',       text: '收到，伙计。',                             duration: 3000, avatar: 'radio' },
      ],
      splitChat3: [
        { speaker: 'Falke-1', role: '长机·你',    text: 'Falke-2，接敌后用能量战术。保持高度优势，俯冲打一轮就拉起来，不要和喷火缠斗盘旋。', duration: 6500, avatar: 'player' },
        { speaker: 'Falke-2', role: '僚机',       text: '明白，俯冲一击脱离，不跟它转圈。',           duration: 4000, avatar: 'radio' },
        { speaker: 'Falke-2', role: '僚机',       text: '长官，最近英国人反应快了不少，从发现到起飞拦截间隔越来越短。', duration: 5500, avatar: 'radio' },
        { speaker: 'Falke-1', role: '长机·你',    text: '情报部门简报是他们沿海的新雷达，探测距离比我们预想的，远。', duration: 5500, avatar: 'player' },
        { speaker: 'Falke-1', role: '长机·你',    text: 'Falke-2，注意你的油表，我们不能久留，速战速决，打完就汇合返航，别恋战。', duration: 6000, avatar: 'player' },
        { speaker: 'Falke-2', role: '僚机',       text: '收到 长官。',                             duration: 2500, avatar: 'radio' },
      ],
      // 接敌对话序列：告警 → 玩家指令 → 僚机回应 → 轰炸机下令（由 GameRuntime 对话队列逐句播放）
      interceptChat: [
        { speaker: 'Falke-2',  role: '僚机',     text: 'Falke-1！陌生编队高速逼近！',                        duration: 4000, avatar: 'radio' },
        { speaker: 'Falke-1',  role: '长机·你',  text: 'Falke队，前出！自由猎时间！',                       duration: 4000, avatar: 'player' },
        { speaker: 'Falke-2',  role: '僚机',     text: '收到，长官！',                                     duration: 3000, avatar: 'radio' },
        { speaker: 'Falke-1',  role: '长机·你',  text: '迎面威慑射击，驱散他们的队形！',                     duration: 4500, avatar: 'player' },
        { speaker: 'Falke-2',  role: '僚机',     text: '跟着你。',                                         duration: 2500, avatar: 'radio' },
        { speaker: '多林',     role: '轰炸机一队长', text: '各机紧密队形，机枪手准备射击！',                   duration: 5000, avatar: 'wingman' },
      ],
    },
    split: { detachingGroups: ['hartung', 'adler'] },   // 分兵时驶离的编队组
  },

  // 关卡环境：不列颠海峡主题
  environment: {
    theme: 'britain',

    // 天空：浅灰蓝（阴云密布感）
    sky: {
      topColor:    0x4a5a6e,   // 天顶灰蓝
      midColor:    0x7a8898,   // 中部浅灰蓝
      bottomColor: 0xb8c4d0,   // 地平线浅灰
    },

    // 太阳：低仰角 + 偏冷色（被云遮挡的散射光）
    // azimuth=300° → 玩家朝 -Z 飞，太阳在右后方，避开视野
    sun: {
      elevation: 22,
      azimuth: 300,
      color: 0xe8d8b8,
    },

    // 雾：海峡典型浓雾（临时关闭用于诊断"陆地全白"问题，确认效果后调整）
    fog: {
      color: 0xb8c4d0,
      density: 0,
    },

    // 光照：调亮环境光（解决飞机过暗问题）
    lights: {
      hemiSky: 0xa8b8c8,
      hemiGround: 0x3a4a55,
      hemiIntensity: 1.5,      // 原0.9，调亮解决飞机过黑
      sunIntensity: 2.5,       // 原2.0，增强日照
    },

    // 地形：英吉利海峡地貌
    terrain: {
      size: 48000,
      segments: 600,           // 600 段（80m/顶点）匹配断崖宽度，平滑海岸线
      coastline: -5000,        // 海岸线基准 z（实际随 x 弯曲，产生海湾/海岬）
      cliffHeight: 75,        // 直立白崖高度基础值（实际 55-95m 起伏）
      beachWidth: 250,         // 海滩宽度（短海滩可见砾石滩）
      cliffWidth: 80,          // 断崖陡度（窄=陡，slope≈0.9 近似直立）
    },

    // 建筑：不列颠主题（红砖 + 灰石板）
    buildings: {
      palette: 'britain',
      villageCount: 7,
      forestPatchCount: 10,
      fieldR: 3400,
    },

    // 海洋：深灰蓝（海峡典型色），平海面（waveHeight=0 去掉海浪，配合低反光）
    ocean: {
      size: 60000,          // 大海面覆盖到地平线（跟随相机，避免边缘露出背景）
      segments: 300,        // 300 段（200m/顶点）保持细节
      color: 0x1a3040,      // 深灰蓝（比 0x3a5060 更深，海峡深水色）
      waveHeight: 0,        // 平海面（无 Gerstner 位移，去海浪效果）
      fogDensity: 0.00012,  // ocean 独立距离雾（默认0.0003太浓，高空海面过白；调淡保留海天衔接）
    },

    // 远景云：三层 fbm 云（远景层云 + 中空层积云 + 高空卷云），零 draw call 绘制在天空球内部
    skyClouds: {
      enabled: true,
      color: 0x8a9098,         // 云基色（灰，背阳侧）
      highlight: 0xe8dcc8,     // 高光色（暖白，朝阳侧被太阳照亮）
      coverage: 0.60,          // 覆盖率（英吉利海峡多云天气）
      drift: 0.006,            // 漂移速度（缓慢移动）
    },
  },

  // 云层：本关独立配置（单层主云带，900-1300m 高度）
  // 固定云带：横向 ±7500m，纵深 3100→-10000，高度 900-1300m
  //   spacing 380 + clusterR 增大 → 相邻云团 sprite 重叠连片（约 6 成连片）
  //   大云团占多数（pow0.8 幂律分布），小云团 opacity 自动减半更透明
  //   纹理 blur(14px) + alphaTest 0.008 消除图块边缘感
  //   无海面投影
  clouds: {
    mode: 'fixed',           // 固定云带模式（不跟随玩家）
    // bandBox = [minX, maxX, minY, maxY, minZ, maxZ]
    bandBox: [-7500, 7500, 900, 1300, 3100, -10000],  // 横向 ±7500m，高度 900-1300m，纵深 3100→-10000
    spacing: 380,            // 网格步长 380m（密集分布，约 39×34=1326 团，配合大 clusterR 实现 6 成连片）
    blobsPerCluster: [4, 6], // 每团 sprite 数（4-6，增加团内密度）
    minSize: 300,            // 单 sprite 基础尺寸下限
    maxSize: 760,            // 单 sprite 基础尺寸上限（配合 clusterScale 最大可达 ~3.0x → ~2280）
    opacity: 0.72,           // 整体淡度
    depthContrast: 1.4,      // 深浅对比增强（顶部高光 + 底部阴影加暗）
    shadowEnabled: false,    // 关闭海面投影
  },

  // 波次：1 波 4 架喷火式，2 个双机编队（double-pair）
  // 坐标系：玩家 (120,2070,21000) 朝 -Z 飞；海岸线 z=-5000；内陆 z<-5000
  // 喷火式出生高度 2200 米（比玩家高 130 米），从内陆俯冲攻击轰炸机
  // AI 逻辑：编队飞行 8s -> 切 attackBomber（优先攻击轰炸机）
  //         被玩家攻击 -> 切 engaged（攻击玩家），10s 无攻击 -> 切回 attackBomber
  // 互射为表演性质：敌机子弹不命中轰炸机，轰炸机自卫炮塔子弹不命中敌机
  waves: [
    {
      formation: 'double-pair', count: 4, model: '/model/spitfire.glb',
      label: '喷火双机编队',
      spawn: { x: 0, y: 2200, z: 1000 },                    // 出生点前移到 z=1000（原 -8000），更靠近玩家
      loiter: { x: 0, z: 4500, radius: 700, alt: 2200 },    // 盘旋点相应前移（原 -4500 -> 4500）
      pairOffset: { x: -250, y: 0, z: 120 },               // 第二组相对第一组侧后方偏移
      // 本关专用 AI 高度覆盖（匹配 2200m 出生高度，全局 fighter 默认 400-1000m）
      // 喷火循敌逻辑：第一优先攻击轰炸机，只有被玩家子弹直接命中才切 engaged 攻击玩家
      // 触发切 engaged 的条件：被玩家子弹命中（takeDamage 内切）
      //   - 玩家靠近 <500m 持续 2s 也切（playerNearDist + playerNearHoldTime，防贴脸无反应）
      // 切回 attackBomber 的条件：玩家拉开 >1200m 持续 3s（disengageDist + disengageHoldTime）
      // 规避：走 fighter 基线默认概率规避（350m 内概率 0.015），不强制翻滚
      aiOverride: {
        patrolAltMin: 1800,  // 巡逻高度下限（默认 400 -> 1800）
        patrolAltMax: 2300,  // 巡逻高度上限（默认 1000 -> 2300）
        aglFloor: 300,      // 撞地拉起阈值（默认 120 -> 300，高空作战不需要太低）
        maxHp: 120,         // HP 100 -> 120（多扛 1 轮机炮）
        fire: { cdMin: 2.0, cdMax: 3.0, burstMin: 1.0, burstMax: 1.4 },  // 开火冷却 2-3s（原 fighter 基线 1.5-3s）
        playerNearDist: 500,          // attackBomber→engaged 触发距离 300 -> 500
        playerNearHoldTime: 2,        // 持续时间 4s -> 2s（玩家靠近 500m 内持续 2s 即切）
        disengageDist: 1200,          // engaged→attackBomber 脱战距离 1200（拉开 1200m 持续 3s 才回轰炸机）
        disengageHoldTime: 3,         // 脱战持续时间 0 -> 3s
      },
    },
  ],

  // 友军 NPC 轰炸机编队（玩家护航目标，演出用）：3 架 Ju 88 三角形 V 字编队
  // 出生：玩家前方 300 米、下方 30 米（玩家 y=2070 z=21000 -> 轰炸机 y=2100 z=20700）
  // 航线：从出生点平飞至陆地侧地图最边缘 z=-24000 后消失
  // 速度 45（街机化慢速，方便玩家目视跟随），路径 29000 单位约飞 10 分钟
  friendlyBombers: {
    model: '/model/ju88.glb',
    formation: 'v',          // V 字三角形：长机居中前，左右僚机后撤两侧
    spacing: 105,            // 僚机间距（左右各 105，匹配 Ju 88 翼展约 58 单位）
    trailOffset: 60,         // 僚机后撤距离（形成 V 字）
    spawn: { x: 0, y: 2100, z: 20700 },     // 玩家前方 300 米、下方 30 米（海上出生点）；y=2100（整体+300）
    route: [
      { x: 0, y: 2100, z: 20700 },     // 出生点（海上）
      { x: 0, y: 2100, z: -24000 },   // 陆地侧地图最边缘（到达后脱离消失）
    ],
  },

  // 开场剧情编队组（CinematicSystem 创建管理，分兵演出时驶离）
  // 哈通组：3 架 Ju-88（多林组长机左前方 350m，+50m 高）；Adler 组：2 架 Bf-109（护航位）；Falke-2：玩家僚机
  // 注：spawn 为初始位置，分兵时哈通/Adler 组调 despawnNow() 驶离淡出
  cinematicFormations: [
    { id: 'hartung', model: '/model/ju88.glb', formation: 'v', spacing: 105, trailOffset: 60,
      spawn: { x: -350, y: 2150, z: 20350 } },   // 多林组长机左前方 350m、+50m 高（多林 z=20700 -> 哈通 z=20350）；y=2150（整体+300）
    { id: 'adler', model: '/model/bf109_opt.glb', formation: 'pair', spacing: 60, trailOffset: 40,
      spawn: { x: -280, y: 2180, z: 20250 } },   // 哈通组右后方护航位；y=2180（整体+300）
    { id: 'falke2', model: '/model/bf109_opt.glb', formation: 'single',
      spawn: { x: 50, y: 2070, z: 21260 }, followPlayer: true },   // 玩家右后方僚机位（z=21000+126）；y=2070（整体+300）
  ],

  // 对话脚本
  dialogs: {
    onStart: { speaker: '指挥官', role: '地面指挥', text: '护航编队已就位！Ju 88 轰炸机在你前方，护送它们穿越海峡，上尉！', avatar: 'tower' },
    onWaveStart: [
      { speaker: '通讯兵', role: '通讯兵', text: '喷火式来了！盯紧它们，别让它们靠近轰炸机！', avatar: 'tower' },
    ],
    onEnemyKilled: [
      { speaker: '通讯兵', role: '通讯兵', text: '击落一架喷火！干得漂亮！', avatar: 'tower' },
      { speaker: '通讯兵', role: '通讯兵', text: '敌机坠入海峡！', avatar: 'tower' },
    ],
    onPlayerDamaged: { speaker: '机械师', role: '地勤机械师', text: '机翼受损，注意操作，海峡里没迫降场！', avatar: 'mechanic' },
    onAllClear: { speaker: '指挥官', role: '地面指挥', text: '空域清除，轰炸机编队安全！返航！', avatar: 'tower' },
    // 胜利对话序列：击落全部敌机后逐句播放，播完后才触发任务胜利界面
    victoryChat: [
      { speaker: 'Falke-1', role: '长机·你',    text: '击落全部敌机，Falke队重组，返航，祝你好运 去干活吧多林', duration: 6500, avatar: 'player' },
      { speaker: '多林',    role: '轰炸机一队长', text: '干的好伙计，下面是我们的活了，汇合点见！',             duration: 5500, avatar: 'wingman' },
    ],
    onPlayerDead: { speaker: '指挥官', role: '地面指挥', text: '上尉！坚持住，搜救船马上到！', avatar: 'tower' },
  },

  // 战斗随机喊话：仅在轰炸机自卫炮塔开火期间触发，CD 3-8s 随机
  combatChatter: {
    bomber: [
      { speaker: '多林', role: '轰炸机一队长', text: '点钟方向，注意！', avatar: 'wingman' },
      { speaker: '多林', role: '轰炸机一队长', text: '注意队形，别散开，稳住。', avatar: 'wingman' },
      { speaker: '多林', role: '轰炸机一队长', text: '该死的英国佬！', avatar: 'wingman' },
      { speaker: '多林', role: '轰炸机一队长', text: '多林，正在被攻击，注意！', avatar: 'wingman' },
      { speaker: '多林', role: '轰炸机一队长', text: '干得好，Falke 伙计！', avatar: 'wingman' },
    ],
    wingman: [
      { speaker: 'Falke-2', role: '僚机', text: '我咬住一架！', avatar: 'radio' },
      { speaker: 'Falke-2', role: '僚机', text: '我击伤了他！', avatar: 'radio' },
      { speaker: 'Falke-2', role: '僚机', text: '有敌机在你后面，小心！', avatar: 'radio' },
      { speaker: 'Falke-2', role: '僚机', text: '注意点钟方向！', avatar: 'radio' },
    ],
  },

  // 教学略（玩家通过巴巴罗萨后已熟悉操作；可后续扩展）
  tutorial: [],

  mission: {
    type: 'destroy_all',
    target: 4,
    waves: 1,
    label: '护航 Ju 88 编队并击落喷火式',
  },
};
