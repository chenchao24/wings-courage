/**
 * 关卡 02 ·《巴巴罗萨之鹰》
 * 1941.06.22 巴巴罗萨行动，Bf 109 E-4 护航遭遇苏联空军拦截。
 *
 * P1 阶段：仅基础字段（供选关卡片显示）。
 * P4 阶段：填充 waves（6 波 9 架）。
 * P5 阶段：填充 dialogs / tutorial。
 */
export default {
  id: 'barbarossa',
  index: 2,
  name: '巴巴罗萨之鹰',
  subtitle: 'Operation Barbarossa',
  date: '1941.06.22',
  cardImage: '/img/stg2.png',
  difficulty: 1,
  beginner: true,
  briefing:
    '1941 年 6 月 22 日凌晨，巴巴罗萨行动打响。你驾驶 Bf 109 E-4 为轰炸机群护航，' +
    '深入苏联领空后遭遇红军战斗机拦截。指挥官已下达命令：击落全部来支援的敌机，确保轰炸机群安全抵达目标。',
  locked: false,
  playerModel: '/model/bf109_opt.glb',
  music: '/sound/adevnAs.mp3',   // 战斗配乐
  totalEnemies: 9,

  // ──────────────────────────────────────────────────────────
  // 玩家武器组配置（与飞机绑定，关卡级独立，与第1关配置一致）
  // Bf 109 E-4 史实武器：2×MG 17（机头 7.92mm）+ 2×MG FF/M（机翼 20mm 机炮）
  // 枪口顺序见 aircraft.js muzzleOffsets：[0]右翼 [1]左翼 [2]右机头 [3]左机头
  // ──────────────────────────────────────────────────────────
  playerConfig: {
    engineSoundFile: '/sound/eg/bf109-eg-loop.wav',  // Bf 109 实录引擎（无缝循环烘焙版，随油门变调）
    weapons: {
      groups: {
        mg17: {                          // MG 17 7.92mm 机枪（机头 2 挺）
          muzzleIndices: [2, 3],
          fireRate: 0.08,
          bulletSpeed: 755,
          damageMin: 3,
          damageMax: 8,
          bulletScale: 1.0,
          bulletColor: 0xfff4c8,
          explosive: false,
          sound: { file: '/sound/gun/bf109-792.mp3', loopStart: 0.02, loopEnd: 0.11 },  // 机头机枪：0.02~0.11s循环，0.12s后回响
        },
        mgff: {                          // MG FF/M 20mm 机炮（机翼 2 门）
          muzzleIndices: [0, 1],
          fireRate: 0.14,
          bulletSpeed: 700,
          damageMin: 15,
          damageMax: 28,
          bulletScale: 1.8,
          bulletColor: 0xff5520,
          explosive: true,
          sound: { file: '/sound/gun/bf109-20.mp3', loopStart: 0.02, loopEnd: 0.13 },  // 机翼机炮：0.02~0.13s循环，0.14s后回响
        },
      },
    },
  },

  // 关卡环境：巴巴罗萨东线主题（显式 theme 标识触发环境重建，其余参数走 environment.js 默认）
  // sky 天空/太阳/雾/光照均沿用默认（蓝天下 42° 太阳），仅定制天边云
  environment: {
    theme: 'barbarossa',

    // 远景天边云：天空球内三层 fbm 噪声云（远景层云/中空层积云/高空卷云，零 draw call）
    // 风格对比不列颠海峡阴云：东线 1941.06.22 夏季清晨，晴朗少云、云色更亮更白
    skyClouds: {
      enabled: true,
      color: 0xf4f6f8,         // 云基色（亮白，东线夏季清晨蓝天白云，对比不列颠海峡灰云 0x8a9098）
      highlight: 0xf8f4e8,     // 高光色（暖白，朝阳侧被夏季低阳照亮）
      coverage: 0.45,          // 覆盖率 45%（夏季晴朗，远低于不列颠海峡 0.60 阴云密布）
      drift: 0.005,            // 缓慢漂移
      farDarken: 1.0,          // 远景层云不暗化（默认 0.75 会压灰，晴天白云需 1.0）
    },
  },

  // 中空云团（性能优化版：云量 -90%，patchiness 块状分布 + distFade 距离剔除）
  // 玩家出生 (0,700,0) 朝 -Z 飞，敌机在 z=-1400~-1900 出生 → 云带覆盖战斗区+前飞路径
  clouds: {
    mode: 'fixed',
    bandBox: [-6000, 6000, 1200, 1400, 1500, -7000],  // x±6000 横向，y 1200-1400，z 1500→-7000 纵深
    spacing: 700,              // 500→700：网格变疏（24×17=408 → 17×12=204 格）
    patchiness: 0.82,          // 块状分布：跳过 82% 低值格子 → ~37 云团（大片晴空+少量云系）
    patchScale: 8000,          // 噪声尺度 8km：晴空区成片出现
    blobsPerCluster: [5, 7],   // 每团 sprite 数（团内密度足，连片更厚实）
    minSize: 320,
    maxSize: 720,
    opacity: 0.88,             // 略低于默认 0.92，fixed 下适当透气
    depthContrast: 1.0,        // 保持默认质感
    shadowEnabled: false,
    cloudColor: [242, 244, 248],  // 纯白偏冷（东线夏季清晨蓝天白云，对比不列颠海峡灰云）
    // 距离淡出：3km 内全显，3~5km 线性淡出，7km 外整团隐藏（减少远云 draw call + 消除雾阈值闪动）
    distFade: [3000, 5000, 7000],
    extraBands: [
      {
        bandBox: [-6000, 6000, 1200, 1400, 1500, -7000],
        spacing: 4000,         // 1500→4000：8×6=48 → 3×2=6 云团
        blobsPerCluster: [2, 3],  // 少量 sprite，小云团
        minSize: 220,
        maxSize: 420,
        opacity: 0.5,          // 稀薄
        sizeBias: 1.6,         // pow 指数>1 偏向小云团
      },
    ],
  },

  // P4：6 波共 9 架（1+1+2+1+2+2）。entry 方位供 P5 无线电播报使用。
  // model 指定本波敌机模型；未指定则回退到默认 yak9.glb。
  // 难度梯度：I-153(125km/h) → I-16(130) → Yak-1(171) → Yak-7(174)，逐波提速
  waves: [
    { formation: 'solo', count: 1, entry: 'NW', label: '西北方向单机', model: '/model/i153.glb', spawnAlt: [1000, 1200] }, // 第1波（I-153 双翼战斗机）
    { formation: 'solo', count: 1, entry: 'E',  label: '东方单机',     model: '/model/i16.glb',  spawnAlt: [1000, 1200] }, // 第2波（I-16）
    { formation: 'pair', count: 2, entry: 'S',  label: '南方双机编队', model: '/model/i16.glb',  spawnAlt: [1000, 1200] }, // 第3波（I-16）
    { formation: 'solo', count: 1, entry: 'W',  label: '西方单机', model: '/model/yak1.glb',     spawnAlt: [1000, 1200] }, // 第4波（Yak-1）
    { formation: 'pair', count: 2, entry: 'N',  label: '北方双机编队', model: '/model/yak1.glb', spawnAlt: [1000, 1200] }, // 第5波（Yak-1）
    { formation: 'pair', count: 2, entry: 'SE', label: '东南双机编队', model: '/model/yak7.glb', spawnAlt: [1000, 1200] }, // 第6波（Yak-7）
  ],

  // P5：对话脚本（事件触发，由 GameRuntime 调 DialogSystem.show）
  dialogs: {
    onStart: { speaker: '指挥官', text: '发现苏联战斗机接近，上尉，准备战斗！', avatar: 'tower' },
    onWaveStart: [
      { speaker: '指挥官', text: '西北方向单机接近！截住他！', avatar: 'tower' },
      { speaker: '指挥官', text: '东方又来一架，别让他溜了！', avatar: 'tower' },
      { speaker: '指挥官', text: '南方双机编队来袭！注意配合！', avatar: 'tower' },
      { speaker: '指挥官', text: '西方单机，速战速决！', avatar: 'tower' },
      { speaker: '指挥官', text: '北方双机编队！他们学聪明了！', avatar: 'tower' },
      { speaker: '指挥官', text: '最后一波！东南双机，全歼他们！', avatar: 'tower' },
    ],
    onEnemyKilled: [
      { speaker: '通讯兵', text: '击落一架！干得漂亮！', avatar: 'tower' },
      { speaker: '通讯兵', text: '又干掉一架！保持！', avatar: 'tower' },
      { speaker: '通讯兵', text: '敌机坠毁！', avatar: 'tower' },
      { speaker: '通讯兵', text: '打得漂亮，上尉！', avatar: 'tower' },
    ],
    onPlayerDamaged: { speaker: '机械师', text: '注意！机身受损，小心操作！', avatar: 'mechanic' },
    onAllClear: { speaker: '指挥官', text: '任务完成！全部敌机已清除，返航！', avatar: 'tower' },
    onPlayerDead: { speaker: '指挥官', text: '不……上尉！坚持住！', avatar: 'tower' },
  },

  // P5：4 步教学（游戏开始时全屏覆盖，关闭后 3s 首波）
  tutorial: [
    { title: '飞行控制', body: 'W / S 控制俯仰（拉起 / 俯冲），A / D 控制滚转，Q / E 控制偏航。松开操纵杆自动回正。' },
    { title: '油门控制', body: 'Shift 加速，Ctrl 减速。速度过低会失速抖动，速度过快难以机动转向。合理控制速度是空战的关键。' },
    { title: '武器系统', body: 'Space 开火，4 挺机枪同时射击。准星对准敌机方向，距离足够近即可命中。敌机 HP 归零后会冒烟坠毁。' },
    { title: '视角与暂停', body: 'C 键切换追尾 / 座舱视角，V 键循环观察视角（无准星）。ESC 键暂停游戏。准备好了就出发吧，上尉！' },
  ],

  mission: {
    type: 'destroy_all',
    target: 9,
    waves: 6,
    label: '击落全部来支援敌机',
  },
};
