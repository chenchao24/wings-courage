/**
 * 关卡 04 ·《柏林保卫战》
 * 1945.03 帝国防空战：玩家驾驶 Me 262 从柏林东郊空域紧急爬升，
 * 迎击自西向东直扑柏林的美军 B-17 轰炸机群及其 P-51 护航。
 *
 * 【隔离原则】本关所有设置独立，不影响第 1/2/3 关：
 *   - theme: 'berlin' → environment.js 走 BerlinGround 分支（纯平卫星贴图地面）
 *   - combatAlt 交战高度规则（仅本关配置，GameRuntime 门控创建）
 *   - flak 我方防空走廊（corridor 模式：打轰炸机编队不打玩家，表演性质）
 *
 * P1 阶段：地图骨架（卫星地面 + 高度规则 + Flak + 云层），无 waves（sandbox 模式）。
 *   后续阶段：Me 262 playerConfig 精调 → B-17 轰炸机群 → P-51 护航 AI。
 */
export default {
  id: 'berlin',
  index: 4,
  name: '柏林保卫战',
  subtitle: 'Battle of Berlin',
  date: '1945.03.18',
  cardImage: '/img/stg4.webp',
  difficulty: 4,
  briefing:
    '1945 年 3 月，帝国领空。美军轰炸机群每日白昼临空，战争已来到柏林上空。' +
    '你驾驶 Me 262 喷气截击机紧急升空，在轰炸机群抵达市区之前尽可能拦截削弱它们。' +
    '保持作战高度，上尉。',
  locked: false,
  playerModel: '/model/me_262.glb',

  // ════════════════════════════════════════════════════════════
  // 关卡级玩家参数（GameRuntime 在 load 前注入，覆盖 Aircraft 构造函数默认值）
  // Me 262 A-1a 史实：翼展 12.5m，maxSpeed 870km/h≈242m/s，4×MK 108 30mm 机头机炮。
  // 喷气式：无螺旋桨配置（无 prop* 字段）。
  // 枪口/座舱/喷气口已经 player_tuner_me262.html 手工调校（2026-08-16）。
  // 注：模型为 spec-gloss 旧格式，已用 scripts/convert_me262_specgloss.mjs 转为标准 PBR。
  // ════════════════════════════════════════════════════════════
  playerConfig: {
    // 校准：模型机头在 +Z（垂尾 Object_2 在 -Z），yawOffset=180 翻转到 body frame -Z。
    // 游戏飞机约定=史实尺寸×3.26（Bf109 32.34/Fw190 34.25 实测翼展），
    // userScale=12.5×3.26/9≈4.53 使 262 与兄弟机型同视觉大小。
    autoOrient: false,            // 喷气机无桨叶节点，关闭自动朝向
    yawOffset: 180.0,
    userScale: 4.53,
    centerOffset: [0.00, 0.00, 0.00],
    propNodes: [],
    engineSound: 'jet',           // 喷气引擎合成音（兜底：文件引擎加载失败时走此路径）
    engineSoundFile: '/sound/eg/me262-eg-loop.wav',  // Me 262 实录引擎（无缝循环烘焙版，随油门变调）

    // 喷气油门管理（Jumo 004 脆弱性游戏化：JetThrottleGovernor，仅本关启用）
    //   80%=最大连续功率；90%=峰值功率线（HUD 醒目红线）；
    //   持续超 90% 达 10s → 自动降频 80% + 冷却 30s（冷却期间不能再超 80%，HUD 提示"发动机冷却中"）；
    //   松开 Shift 后高于 50% 的部分按 0.125/s 线性回落（1.0→0.5 约 4s）
    jetThrottle: {
      maxContinuous: 0.80,
      peakLine: 0.90,
      peakLimitSec: 10,
      cooldownSec: 30,
      releaseTarget: 0.50,
      fallRate: 0.125,
    },

    // 隐藏节点（Object_8 = 无贴图半透明黑壳，tuner 节点页确认）
    hideGear: true,
    hideGearNodes: ['Object_8'],

    // 枪口（4 个：机头 4 门 MK 108 30mm，body frame，机头=-Z，tuner 精调值）
    muzzleOffsets: [
      [ 0.52,  0.80, -10.68],  // 右上 MK 108
      [-0.48,  0.80, -10.68],  // 左上 MK 108
      [ 1.28,  0.14, -10.50],  // 右下 MK 108
      [-1.28,  0.14, -10.50],  // 左下 MK 108
    ],

    // 喷气口位置（左右 Jumo 004 发动机尾喷口，body frame，tuner 精调值）
    // 供后续喷气尾焰/热流效果使用（当前版本仅记录位置，不渲染）
    jetNozzles: [
      [ 7.30, -2.80, 6.04],    // 右发动机尾喷口
      [-7.30, -2.80, 6.04],    // 左发动机尾喷口
    ],

    // 武器组（MK 108 30mm ×4：史实 650发/分、初速 540m/s，游戏化降速）
    weapons: {
      groups: {
        mk108: {
          muzzleIndices: [0, 1, 2, 3],
          fireRate: 0.15,
          bulletSpeed: 650,           // 弹速上调（540→650，提前量手感更舒服）
          damageMin: 45,              // 伤害上调（30-55→45-65，对 B-17 击杀节奏 ~8 发）
          damageMax: 65,
          bulletScale: 1.9,              // 弹径收细（原 2.5 偏假）
          tracerColor: 0xff4d14,         // 深橙红曳光（独立材质+每发随机弧向/闪烁，区别于共享粉橙）
          smokeEvery: 2,                 // 枪口烟加密（默认每3发→每2发，30mm 烟量更大）
          smokeBoost: 1.4,               // 烟团放大 1.4 倍
          explosive: true,
          sound: { file: '/sound/gun/mk108.mp3', loopStart: 0.02, loopEnd: 0.13 }, // 0.02-0.13s 循环机炮声，0.13s 后回响
        },
      },
    },

    // 飞行物理（Me 262 A-1a 史实街机化：高速/俯冲极佳，低速/滚转/盘旋弱）
    maxSpeed: 240,        // 870km/h ≈ 242m/s
    minSpeed: 25,         // 喷气机低速差（史实失速 ~160km/h，街机化放宽）
    cruiseSpeed: 165,
    pitchMax: 1.00,       // 重战俯仰弱（Fw190 1.25）
    pitchResp: 4.5,
    rollMax: 2.60,        // 翼下吊舱滚转惯量大（Fw190 3.4）
    rollResp: 5.5,
    yawMax: 0.60,
    yawResp: 3.0,
    gravity: 4.0,
    liftK: 0.026,
    diveAccel: 12,        // 俯冲加速极佳（Fw190 10）：喷气机能量战核心
    stallThreshold: 20,

    // 翼尖拉烟高度窗（本关交战 3000-8000m，缺省上限 4500m 永远不触发）
    vaporAltMax: 8000,

    // 座舱/相机（tuner 精调值；追尾相机对齐 Bf109/Fw190 约定）
    cockpit: {
      x: 0.00, y: 2.29, z: -0.54,
      lookDist: 120,
      aimLift: 0.030,
      aimDist: 1600,
      chase: { x:  0.00, y:  6.50, z:  12.50 },
    },
  },

  totalEnemies: 20,
  displayWaves: 1,  // 卡片展示用（B-17 机群波次，非 WaveDirector 波次；sandbox 不走 waves）

  // P1 沙盒：无敌机波次，纯地图/手感调试（GameRuntime 据此跳过胜利结算）
  sandbox: true,

  // 空中出生：B-17 编队前方（西）~17km 迎头截击位置（机群东缘 x=+38km 出生向西）
  //   坐标系：x+东/x-西，z+北/z-南；机群自东向西飞来，玩家必须【朝东】迎头：
  //   getForward()=(0,0,-1) 经 yaw=-π/2 旋转 → (+1,0,0) 朝东（yaw=+π/2 朝西是背对机群，已修正）
  //   x=21250：出生点西移 3000m 拉长接敌窗口（150m/s×15s=2250m 过场后 x≈23500，
  //   距机群前缘 ~13.7km，按接近率 200m/s ~59s 后进入 P-51 拦截触发圈 2000m）
  //   y=6300：整体出生高度抬高后的值（原 6000 +300）
  playerStart: {
    position: [21250, 6300, 0],
    yaw: -Math.PI / 2,
    speed: 150,
  },

  // ════════════════════════════════════════════════════════════
  // B-17 轰炸机群（HeavyBomber，GameRuntime 门控创建，不走 WaveDirector）
  //   东缘 x=+38km 出生 → 向西直飞（~50m/s）；
  //   4 小队 × V 字三机 = 12 架箱式队形（横向错位 + 高低差）；
  //   直飞不规避；损伤模型：55% 阈值 35% 概率返航、发动机数量状态（减速/持续掉血）、
  //   <40% 发动机大火、<10% 缓慢坠毁、HP=0 坠毁四式（过量伤害强制爆炸）；炮塔射界内带提前量瞄准。
  //   枪口/炮塔/发动机/命中球点位已经 tools/b17_tuner.html 手工标定（2026-08-17）。
  // ════════════════════════════════════════════════════════════
  bomberStream: {
    model: '/model/b17.glb',
    speed: 50,                    // 巡航速度（m/s；比不列颠 He111 的 55 再慢点，玩家 262 高速掠袭窗口更舒服）
    hp: 450,                      // 高 HP 池（MK108 45-65/发，~8 发击落）
    damageThreshold: 0.55,        // 受伤阈值（损失 55% 生命 → 判定返航）
    rtbChance: 0.35,              // 达阈值时返航概率 35%（65% 带伤跟随编队）
    despawnX: -38000,             // 西缘消失
    route: [
      { x: 38000, y: 5000, z: 0 },   // 出生（最东）
      { x: -38000, y: 5000, z: 0 },  // 脱离（最西）
    ],

    // 编队槽位（相对 route[0] 的固定偏移；x+ = 更晚到达的纵队）
    formation: {
      vicSpacing: 700,            // 小队纵距
      wingSpacing: 320,           // V 字僚机横距
      trailOffset: 380,           // 僚机后撤
      // 4 小队：领队 / 高二队（右后高 150）/ 低三队（左后低 150）/ 四队收尾
      vics: [
        { x: 0,    alt: 0,    lat: 0 },
        { x: 700,  alt: 150,  lat: 900 },
        { x: 1400, alt: -150, lat: -900 },
        { x: 2100, alt: 50,   lat: 0 },
      ],
    },

    // 命中球（大机体多球近似；offset 为 body frame，engine=发动机索引 null=机体）
    hitSpheres: [
      { offset: [0, 6.5, -22.4],   radius: 10, engine: null },  // 躯干
      { offset: [9.6, 7.1, -20.8],  radius: 5.5, engine: 0 },   // 右内发
      { offset: [-9.6, 7.4, -20.8],  radius: 5.5, engine: 1 },  // 左内发
      { offset: [21.1, 7.4, -19],  radius: 5, engine: 2 },      // 右外发
      { offset: [-21.1, 7.5, -19.5],  radius: 5, engine: 3 },   // 左外发
      { offset: [17, 5.9, -9],   radius: 10, engine: null },    // 右翼尖
      { offset: [-16, 5.9, -9],   radius: 10, engine: null },   // 左翼尖
      { offset: [0, 8.2, 28.1],   radius: 8, engine: null },    // 尾部
    ],

    // 四发动机（命中点 + 发烟点，body frame）
    engines: [
      { hitOffset: [9.8, 6, -19],  smokeOffset: [10, 8.3, -19.7] },   // 右内
      { hitOffset: [-9.8, 6, -19], smokeOffset: [-10, 8.3, -19.7] },  // 左内
      { hitOffset: [20.8, 6.9, -18],  smokeOffset: [21.1, 8.6, -16.5] }, // 右外
      { hitOffset: [-20.8, 6.9, -18], smokeOffset: [-21.1, 8.6, -16.5] },// 左外
    ],

    // 枪口位置（body frame，b17_tuner 标定）
    muzzles: [
      { pos: [-0.9, 1.2, 5.5] },   // 0-1 球塔（机腹）
      { pos: [0.9, 1.2, 5.5] },
      { pos: [0.5, 10, -14] },     // 2-3 顶炮（机背）
      { pos: [-1.1, 10, -14] },
      { pos: [-0.6, 3.5, 41] },    // 4-5 尾炮
      { pos: [0.6, 3.5, 41] },
      { pos: [0.8, 5, -33.8] },    // 6-7 颊炮（机头）
      { pos: [-0.6, 5, -33.8] },
    ],

    // 炮塔（射界约定：yaw 0=正后 / ±90=侧 / 180=正前；pitch 正=上）
    turrets: [
      { name: 'ball',   muzzles: [0, 1], yawCenter: 0,    yawRange: 96, pitchCenter: -63,  pitchRange: 51,
        range: 900, burst: [1.0, 1.8], cd: [2.5, 4.1], spreadDeg: 1.6, fireRate: 0.14 },
      { name: 'top',    muzzles: [2, 3], yawCenter: 0,    yawRange: 100, pitchCenter: 68,   pitchRange: 60,
        range: 900, burst: [1.0, 1.6], cd: [2.5, 4.0], spreadDeg: 1.5, fireRate: 0.13 },
      { name: 'tail',   muzzles: [4, 5], yawCenter: 0,    yawRange: 64, pitchCenter: 1,   pitchRange: 60,
        range: 950, burst: [1.2, 2.0], cd: [2.0, 3.5], spreadDeg: 1.2, fireRate: 0.12 },
      { name: 'cheek',  muzzles: [6, 7], yawCenter: 180,   yawRange: 47, pitchCenter: 0,   pitchRange: 40,
        range: 700, burst: [0.8, 1.4], cd: [3.0, 5.0], spreadDeg: 1.8, fireRate: 0.14 },
    ],
    bulletSpeed: 650,
    turretDamage: [2, 4],         // 单发伤害（.50 口径，命中真实但伤害轻）
  },

  // ════════════════════════════════════════════════════════════
  // P-51 护航编队（P51EscortSquadron，8架 = 2中队×2小队(A1/A2/B1/B2)×长僚2机，AI 全隔离）
  //   伴飞：A 中队编队上方 +400m 靠前，B 中队下方 -400m 靠后；
  //   触发：任一 262（玩家/僚机一视同仁）与任一在编 B-17 最近距离 ≤2000m → P-51 开始加速，
  //         A1/A2/B1 爬升 6500m 对头冲锋（目标均匀分配不重复），B2 上移 A1 位继续伴飞；
  //         262 逼近 B2 ≤400m 或任一 262 距任一 B-17 ≤500m → B2 也加入猎杀；
  //   猎杀：1000m 内锁定（四小队互不重目标，A1→A2→B1→B2 仲裁），≤400m 开火（点射+冷却），
  //         追击 ≤30s；目标持续 2s >600m 或高度出 [3000,7000]（不追低不追高）→ 放弃，
  //         3-6s 自由盘旋后重选（玩家攻击窗口）；无目标 → 编队上方浅坡大圈巡行（R1800m）；
  //   协同：60% 双机同目标 / 20% 僚机尾随长机 100-150m / 20% 双机自由选目标；
  //   真实瞄准射击：只伤玩家（命中时 20% 概率造成 3 点），不伤 AI 僚机（无命中路径）；
  //   玩家可击落（HP120，击伤 55% +3 / 击落 +8，intercept 计分）。
  // ════════════════════════════════════════════════════════════
  escortP51: {
    model: '/model/p51.glb',
    hp: 120,
    damagedAt: 0.55,              // 损失 55% HP → 计击伤分（一次性）
    perf: {
      maxSpeed: 195,              // P-51D 史实高空极速 ~703km/h（262 极速 240，追不上会触发放弃）
      cruiseSpeed: 140,
      minSpeed: 70,
      turnEscort: 30,             // 伴飞转向 deg/s（平稳）
      turnCombat: 55,             // 格斗转向 deg/s
    },
    slotSpacing: { fwd: 350, lat: 260, alt: 400 },  // 中队槽位：fwd 沿航向/lat 侧向/alt 高度差
    wingTrail: [100, 150],        // 僚机尾随长机距离带（m）
    engage: {
      triggerDist: 2000,          // 首次拦截触发（任一262 ↔ 任一在编B-17 最近距离）
      interceptAlt: 6500,         // 拦截爬升高度
      selectDist: 1000,           // 锁定半径（唯一性仲裁）
      patrolDist: 1500,           // 无候选回编队阈值（滞回带 1000-1500 接近不开火）
      fireOpen: 400,              // 开火距离（≤400m 且对准）
      chaseMaxSec: 30,            // 追击上限
      abandonDist: 600,           // 目标持续超此距离
      abandonSec: 2,              // …持续时长 → 放弃
      reselectSec: [3, 6],        // 放弃后自由盘旋/重选间隔（玩家攻击窗口）
      altBand: [3000, 7000],      // 目标高度带：出带不选/放弃（不追低不追高）
      burstSec: [0.8, 1.6],       // 点射时长
      cooldownSec: [1.2, 2.4],    // 冷却间隔
    },
    patrol: { radius: 1800, alt: 550, speed: 145 },  // 无目标巡行：编队上方浅坡大圈（限速转向 ~5°/s）
    b2Join: { selfDist: 400, bomberDist: 500 },   // B2 退出伴飞条件
    pairWeights: { same: 60, trail: 20, free: 20 }, // 小队协同权重
    pairSwitchSec: [6, 12],       // 协同模式重掷间隔
    guns: { fireRate: 0.09, bulletSpeed: 750, life: 1.8, hitChance: 0.2, damageMin: 3, damageMax: 3 },
    // 防撞规避（仅对玩家）：距离/接近率双阈值触发 → 放弃当前目标侧向急转脱离，绝不追尾/相撞
    //   near=贴身必触发；mid+midClosing=中距中速接近触发；far+farClosing=高速对头提前触发；dur=规避机动时长
    avoid: { near: 90, mid: 170, midClosing: 35, far: 260, farClosing: 120, dur: 1.15 },
  },

  // ════════════════════════════════════════════════════════════
  // 友军 Me 262 僚机小队（Wingman262Squadron，AI 与其他关完全隔离）
  //   开场：3 架僚机指尖编队跟随玩家（左1右2）；任一敌军距编队 ≤1500m 永久解除；
  //   编队/轨载状态零扰动平飞（高度扰动仅猎杀状态施加）；
  //   解除后自由猎杀（6 模式加权随机），P-51 尾随 <200m 规避拉开 >600m；
  //   攻击纯表演（无命中/伤害结算），但 B-17 炮塔把僚机当正常目标。
  //   尾喷：trail 覆盖 WingmanJetTrail 缺省——短而连续，观感对齐玩家 JetExhaust。
  // ════════════════════════════════════════════════════════════
  wingmen262: {
    count: 3,
    model: '/model/me_262.glb',
    // 指尖槽位（body frame [x右, y上, z后]；前后拉近、左右散开 30%）：#2 左后 / #3 右后 / #4 右后远
    slots: [[-91, 0, 45], [91, 0, 45], [195, 15, 90]],
    breakDist: 1500,          // 敌军接近到此距离 → 编队永久解除
    evadeDist: 200,           // 敌机尾随 <200m → 规避
    evadeExit: 600,           // 拉开到 >600m → 重选攻击模式
    patternWeights: { dive: 15, lowGun: 20, beam: 20, crossRear: 5, hitRun: 15, orbit: 25 },
    // 尾喷调校（对齐玩家版：密节距/短寿命/强跟随；maxParticles 保池不截断续流）
    trail: {
      spacing: 0.9,           // 空间发射节距（m；缺省 2.0 太稀 → 松散）
      lifeRange: [0.45, 0.85],// 粒子寿命 s（缺省 2.0-3.2 太长 → 拖尾过长）
      sizeStart: 1.35,        // 出生尺寸（m，同玩家版）
      sizeGrow: 4.0,          // 膨胀倍数（同玩家版）
      exhaustVel: 40,         // 后喷缓速（同玩家版；缺省 26 偏弱）
      followVel: 0.85,        // 出生跟随前速比例（同玩家版）
      maxParticles: 300,      // 240m/s ÷ 0.9m × 0.85s ≈ 227 存活峰值，300 留余量
    },
  },

  // ════════════════════════════════════════════════════════════
  // 开场过场（BerlinOpening，鸭式复用 CinematicSystem 接线）
  //   镜头从编队后上方（≈7000m 海拔）15s 推进到玩家追尾视角；期间锁操控；
  //   ESC 跳过；dialogs 时间轴对话（文案后续补充）。
  // ════════════════════════════════════════════════════════════
  opening: {
    enabled: true,
    duration: 15,
    camFrom: { x: 0, y: 200, z: 400, lookAhead: 120 },  // body frame 起始偏移（编队上方200m/后方400m）
    // 开局喊话（按时间轴逐句播放，avatar 用柏林专属 key；berlin_tower 随机选 tw001/tw02）
    dialogs: [
      { t: 0,    speaker: '希尔克', role: '塔台',   text: '雨燕小队，"堡垒"塔台呼叫。航向 075 度，敌机编队约 20 架，轰炸机 12 架，其余为战斗机。高度 5600 米，西风 15 节，少云。祝顺利。', duration: 5000, avatar: 'berlin_tower' },
      { t: 4,    speaker: '贝尔格', role: '雨燕1号', text: '雨燕 1 号收到。', duration: 2500, avatar: 'berlin_1' },
      { t: 5.5,  speaker: '贝尔格', role: '雨燕1号', text: '雨燕小队，按常规拦截战术，俯冲掠袭，一击脱离，切勿闯入编队交叉火网。', duration: 4000, avatar: 'berlin_1' },
      { t: 8.5,  speaker: '贝尔格', role: '雨燕1号', text: '优先目标为轰炸机，不要和护航机纠缠。牢记：我们的燕子，高速优势明显，盘旋不是她的长项，注意保持速度。', duration: 4500, avatar: 'berlin_1' },
      { t: 11.5, speaker: '霍夫曼', role: '雨燕2号', text: '收到，队长！', duration: 2500, avatar: 'berlin_2' },
      { t: 12.5, speaker: '韦勒',   role: '雨燕3号', text: '3号收到！', duration: 2000, avatar: 'berlin_3' },
      { t: 13.3, speaker: '贝尔格', role: '雨燕1号', text: '勿长时间推满油门，注意机炮过热，准备爬升', duration: 3000, avatar: 'berlin_1' },
      { t: 14.2, speaker: '科赫',   role: '雨燕4号', text: '收到，让我们给他们个惊喜！', duration: 2500, avatar: 'berlin_4' },
    ],
  },

  // ════════════════════════════════════════════════════════════
  // 柏林专属喊话系统（BerlinChatter，与全局 combatChatter/dialogs 隔离）
  //   鸭式事件入口：onLockedOn / onPlayerDamaged / onB17Killed / onB17Damaged /
  //                 onP51Killed / onP51Damaged / onAltViolation / onThrottleOverheat / onPlayerDead
  //   战斗喊话：随机报点(20-30s) / 随机事件(40-50s) / 咬尾 / 击落击伤+基地回复 / 阵亡
  //   cd 覆盖缺省 CD（见 BerlinChatter.DEFAULT_CD）
  // ════════════════════════════════════════════════════════════
  berlinChatter: {
    // cd: { lockWarn: 10, b17Kill: 6, ... }  // 覆盖缺省 CD，按需
  },

  // ════════════════════════════════════════════════════════════
  // 关卡音乐（柏林专属多段序列，BerlinMusic 接管，与 levelMusic 互斥）
  //   流程：m1 → elg → m2 → [gapSec 静默] → 交替循环(elg ↔ m2)
  //         → 拦截进度 ≥ progressThreshold → 循环 m3
  //   所有切换淡入淡出（fadeSec）
  // ════════════════════════════════════════════════════════════
  berlinMusic: {
    m1: 'sound/highWar.mp3',
    elg: 'sound/bl/elg.mp3',
    m2: 'sound/bl/m2.mp3',
    m3: 'sound/bl/m3.mp3',
    gapSec: 6,                 // m2 播完后静默秒数，再进入交替循环
    fadeSec: 1.5,              // 淡入淡出时长
    progressThreshold: 0.9,    // 拦截进度 ≥ 90% 切 m3 循环
  },

  // 拦截积分（击落/击伤给分；拦截进度 100% = 胜利，GameRuntime 直接触发 onAllClear）
  intercept: {
    b17Kill: 25,                  // 击落 B-17（未击伤过的完整击落）
    b17KillAfterDamaged: 10,      // 击落已被击伤过的 B-17（击伤分已拿过，补刀只再加 10）
    b17Damaged: 10,               // 击伤 B-17（55% 阈值）
    p51Kill: 8,                   // 击落 P-51（后续阶段）
    p51Damaged: 3,                // 击伤 P-51（后续阶段）
    target: 100,                  // 胜利进度（≈击落 4 架 B-17 当量）
  },

  // ════════════════════════════════════════════════════════════
  // 交战高度规则（CombatAltRule，仅本关启用）
  //   <warnAlt HUD 软警告；<floorAlt 倒计时 countdownSec 秒，醒目提示；
  //   归零弹窗二选一：任务失败 / 重置高度（原地 x/z 不变重置到 resetAlt，黑屏读条）；
  //   >ceilingSoft 仅软提示不惩罚。
  // ════════════════════════════════════════════════════════════
  combatAlt: {
    warnAlt: 2200,
    floorAlt: 2000,
    countdownSec: 15,
    resetAlt: 4000,
    ceilingSoft: 8000,
  },

  // ════════════════════════════════════════════════════════════
  // 击落流程（仅本关）：HP=0 坠毁 → graceSec(3s) 演出宽限
  //   → HUD 闪动"任务结束倒计时" countdownSec(8s)（复用 altFence 通道 countdown 级红字闪动）
  //   → 归零任务失败。其他关无此配置 → 保持原"爆炸计时归零即结算"。
  // ════════════════════════════════════════════════════════════
  downed: { graceSec: 3, countdownSec: 8 },

  // 关卡环境：柏林独立主题（BerlinGround 纯平卫星贴图，无 Terrain/Buildings）
  environment: {
    theme: 'berlin',

    // 晴朗冷调白昼（初值，待调校）：卫星图为夏季植被，天空走中性通透路线
    sun: {
      elevation: 35,
      azimuth: 160,
      color: 0xfff0d8,
    },
    sky: {
      topColor: 0x3a6fb8,
      midColor: 0x7fa8d0,
      bottomColor: 0xd8e0e8,
      // 地平线大气辉光带（#91）：天际线泛白蓝过渡，与雾色同色衔接消缝
      horizonColor: 0xdfe7ee,
      horizonStrength: 0.70,
      horizonWidth: 0.06,
    },
    fog: {
      // #91：density 0.00007→0.00004（柏林 80km 图幅东缘机群处曾 99.8% 白化失真）；
      // 20km 处遮蔽 86%→45%，远景可读；50km 裙边外缘仍 >98% 遮蔽
      // 颜色与地平线辉光带同色（0xdfe7ee），天边不再是一道白墙
      color: 0xdfe7ee,
      density: 0.00004,
    },
    lights: {
      hemiSky: 0xbfd4e8,
      hemiGround: 0x5a5a4a,      // 卫星地面偏暗绿，反弹光跟随
      sunIntensity: 2.8,
    },

    // 天边云（背景云量 + 天顶防拉抻）：
    //   coverage 0.55 远处高空有云；zenithBoost 0.5 → 天顶卷云加密 + 3D 噪声采样
    //   （2D dir.xz 采样在天顶会径向拉抻，3D 噪声球面连续无拉伸无接缝，库尔斯克已验证）
    skyClouds: {
      enabled: true,
      color: 0xf4f6f8,
      highlight: 0xf8f4e8,
      coverage: 0.55,
      drift: 0.005,
      farDarken: 1.0,
      zenithBoost: 0.5,
    },

    // 柏林地面（BerlinGround）：Sentinel-2 卫星贴图，80000×64000（宽高比 1.25，近方形观感）
    ground: { type: 'satellite', width: 80000, depth: 64000 },

    // 防空火力 Flak —— 我方柏林防空军，目标=轰炸机编队，不打玩家（纯表演）
    // corridor 走廊模式（AntiAircraftFlak 缺省不配置=其他关"跟随玩家"行为不变）：
    //   编队进入走廊（x -30000~15000）后，每 3000m 触发一个 800m 区间；
    //   进入前 700m 开火、队飞过后 700m 停火；密度 = 原跟随玩家方案的 2/3；
    //   爆点高度 = 编队高度 ±400m 随机；深入一半时随机击落一架（不计玩家积分）。
    flak: {
      enabled: true,
      activeR: 2000,
      cullR: 4000,
      maxBursts: 80,
      maxTracers: 80,
      tracerAltMax: 6500,

      corridor: {
        zoneMin: -30000, zoneMax: 15000,  // 走廊 x 范围（沿 z=0 航线，东缘=编队入口）
        zHalf: 2500,                      // 横向散布半宽
        segmentEvery: 3000,               // 区间间隔
        segmentLen: 800,                  // 区间长度
        leadIn: 700,                      // 进入前 700m 开火
        leadOut: 700,                     // 队过后 700m 停火
        burstRate: 0.53,                  // 每激活区间齐射/s（原 0.8 的 2/3）
        tracerRate: 4.3,                  // 每激活区间曳光/s（原 6.4 的 2/3）
        altSpread: 400,                   // 爆点高度 = 编队高度 ±400m
        killAt: 0.5,                      // 深入走廊一半时表演击落一架（一次性）
      },

      // 视觉参数（沿用库尔斯克观感）
      burst: {
        smokeColor: [40, 40, 44],
        fireColor: [255, 200, 120],
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
  },

  // 交战高度云层（多层云系化：低散云 + 主云系 + 高薄云，距离淡出做近清远淡层次）
  clouds: {
    mode: 'fixed',
    bandBox: [-40000, 40000, 2800, 4500, -32000, 32000],
    spacing: 3400,           // 云系内加密重叠连片
    patchiness: 0.5,         // 50% 区域无云
    patchScale: 18000,       // 云系尺度 18km（系统/间隙交替，飞行中几分钟一遇）
    yCoherent: true,         // 高度相干起伏（云系成层）
    sizeBias: 1.0,           // 中大云团为主
    maxClusterScale: 5.0,
    spreadMul: 2.2,          // 团内散布加宽 2.2 倍：相邻云团渗透合并成大片
    blobsPerCluster: [5, 8],
    minSize: 320,
    maxSize: 900,
    opacity: 0.5,
    depthContrast: 1.5,
    volumeShade: 1.0,
    texHoles: false,
    shadowEnabled: false,
    // 距离淡出 [淡入起点, 全淡点, 剔除距离]：远云在雾阈值前平滑消隐（修远云闪动）+ 近清远淡
    distFade: [14000, 21000, 24000],

    // 低空稀薄散云 + 高层薄云（三层高度层次）
    extraBands: [
      {
        bandBox: [-40000, 40000, 800, 1600, -32000, 32000],
        spacing: 9000,
        patchiness: 0.5,
        opacity: 0.26,           // 很淡
        minSize: 400, maxSize: 1100,
        blobsPerCluster: [2, 3],
        sizeBias: 1.0,
        spreadMul: 1.4,
      },
      {
        bandBox: [-40000, 40000, 5500, 7000, -32000, 32000],
        spacing: 12000,          // 极稀疏
        patchiness: 0.4,
        opacity: 0.22,           // 极淡的高云
        minSize: 900, maxSize: 2200,  // 大幅薄云
        blobsPerCluster: [2, 3],
        sizeBias: 0.7,           // 偏大型
        spreadMul: 2.0,
      },
    ],
  },
};
