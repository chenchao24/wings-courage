import * as THREE from 'three';
import { Terrain, setCoastConfig, setTerrainTheme } from './terrain.js';
import { Buildings } from './buildings.js';
import { Ocean } from './ocean.js';
import { KurskBattlefield } from './kurskBattlefield.js';
import { KurskRoads } from './kurskRoads.js';
import { AntiAircraftFlak } from './AntiAircraftFlak.js';
import { BerlinGround } from './berlinGround.js';

/**
 * 构建飞行环境：渐变天空 + 太阳 + 雾 + 地形 + 建筑 + 海洋（Britain）。
 *
 * @param envConfig 关卡环境配置（null=barbarossa 默认，所有参数走 ?? 回退，行为等同原版）
 *   { theme:'britain', sky:{topColor,...}, sun:{elevation,...}, fog:{color,density},
 *     lights:{hemiSky,...}, terrain:{coastline,cliffHeight,...}, buildings:{palette,...},
 *     ocean:{size,color,...} }
 */
export function createEnvironment(scene, renderer, envConfig = null) {
  const cfg = envConfig || {};
  const isBritain = cfg.theme === 'britain';

  // ---------- 参数化（?? 回退 barbarossa 默认值，envConfig=null 时行为不变）----------
  const elevation = cfg.sun?.elevation ?? 42;
  const azimuth = cfg.sun?.azimuth ?? 150;
  const sunColorVal = cfg.sun?.color ?? 0xffe8c0;
  const skyTop = cfg.sky?.topColor ?? 0x3a7fd6;
  const skyMid = cfg.sky?.midColor ?? 0x7fb8e8;
  const skyBot = cfg.sky?.bottomColor ?? 0xc8e0f4;
  const fogColor = cfg.fog?.color ?? 0xc8e0f4;
  const fogDensity = cfg.fog?.density ?? 0.00016;
  const hemiSky = cfg.lights?.hemiSky ?? 0xbfd8ff;
  const hemiGround = cfg.lights?.hemiGround ?? 0x4a5d3a;
  const hemiIntensity = cfg.lights?.hemiIntensity ?? 1.0;
  const sunIntensity = cfg.lights?.sunIntensity ?? 3.0;

  // 远景云带（天空 shader 内 fbm 噪声绘制，零 draw call，无穷远海平线层云）
  const skyClouds = cfg.skyClouds ?? {};
  const cloudEnabled = skyClouds.enabled === true;  // 默认关闭，需显式 enabled:true 才开启（消除各关天边云带）
  const cloudColor = skyClouds.color ?? 0x9aa0a8;
  const cloudHighlight = skyClouds.highlight ?? 0xe8e0d0;
  const cloudCoverage = skyClouds.coverage ?? 0.5;
  const cloudDrift = skyClouds.drift ?? 0.008;
  // 远景层云暗化系数（大气透视效应）。默认 0.75 保持原海峡阴云暗化行为；
  // 晴朗关卡可配 1.0 不暗化（天边云保持亮白）
  const cloudFarDarken = skyClouds.farDarken ?? 0.75;
  // 天顶云增量（0=原行为；0.3-1.0=天顶卷云加密+band上界推高，让头顶云量增多）
  const cloudZenith = skyClouds.zenithBoost ?? 0;
  // 拉抻云强度（0=关闭；0.3-1.0=新增一层各向异性涂抹云，模拟中高云被高空风扯开拉长）
  const cloudStreak = skyClouds.streak ?? 0;

  // ---------- 海岸线配置（必须在 terrain.create 之前，影响顶点着色与高度）----------
  if (isBritain && cfg.terrain) {
    setCoastConfig({
      coastline: cfg.terrain.coastline,
      cliffHeight: cfg.terrain.cliffHeight,
      beachWidth: cfg.terrain.beachWidth ?? 200,
      cliffWidth: cfg.terrain.cliffWidth ?? 60,
    });
  } else {
    setCoastConfig(null); // barbarossa/kursk 恢复无海岸模式
  }

  // ---------- 地形主题（必须在 terrain.create 之前，影响高度与着色）----------
  // kursk：大平原草原（无河流/无山区/黄绿草甸）；其他：null=barbarossa 原行为。
  // britain 必须 null：britain 陆域深处复用 _computeLandHeight，若设 kursk 会污染其内陆地形。
  setTerrainTheme(isBritain ? null : (cfg.theme === 'kursk' ? 'kursk' : null));

  // ---------- 天空（自定义渐变着色器：天顶→地平线 + 太阳散射光晕）----------
  const sun = new THREE.Vector3();
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sun.setFromSphericalCoords(1, phi, theta);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(40000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        topColor:    { value: new THREE.Color(skyTop) },
        midColor:    { value: new THREE.Color(skyMid) },
        bottomColor: { value: new THREE.Color(skyBot) },
        sunDir:      { value: sun.clone() },
        sunColor:    { value: new THREE.Color(sunColorVal) },
        // 远景云带 uniforms
        uTime:          { value: 0 },
        uCloudEnabled:  { value: cloudEnabled ? 1.0 : 0.0 },
        uCloudColor:    { value: new THREE.Color(cloudColor) },
        uCloudHighlight:{ value: new THREE.Color(cloudHighlight) },
        uCloudCoverage: { value: cloudCoverage },
        uCloudDrift:    { value: cloudDrift },
        uCloudFarDarken:{ value: cloudFarDarken },
        uCloudZenith:   { value: cloudZenith },
        uCloudStreak:   { value: cloudStreak },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        uniform vec3 topColor, midColor, bottomColor, sunDir, sunColor;
        uniform float uTime, uCloudCoverage, uCloudDrift, uCloudEnabled, uCloudFarDarken, uCloudZenith, uCloudStreak;
        uniform vec3 uCloudColor, uCloudHighlight;

        float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0; float a = 0.5;
          mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);  // 旋转 36.87°，打破网格对齐（去方格感）
          for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = rot * p * 2.0; a *= 0.5; }
          return v;
        }
        // 3D 噪声（用于天顶云：dir 单位向量在球面上完全连续，无方位角接缝、无极点汇聚）
        float hash13(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float vnoise3(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          float n000 = hash13(i);
          float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
          float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
          float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
          float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
          float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
          float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
          float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
          return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
                     mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
        }
        float fbm3(vec3 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 5; i++) { v += a * vnoise3(p); p *= 2.02; a *= 0.5; }
          return v;
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(bottomColor, midColor, smoothstep(0.0, 0.45, h));
          col = mix(col, topColor, smoothstep(0.4, 1.0, h));
          float sd = max(dot(dir, normalize(sunDir)), 0.0);
          col += sunColor * pow(sd, 6.0) * 0.18;
          col += sunColor * pow(sd, 48.0) * 0.5;

          // 远景云：三层 fbm 噪声绘制（零 draw call，无穷远）
          //   1. 远景层云带（地平线密集，大气透视偏暗）
          //   2. 中空层积云（主要云层，中等密度）
          //   3. 高空卷云（稀疏薄云，高处点缀）
          if (uCloudEnabled > 0.5) {
            float lit = smoothstep(0.10, 0.80, sd);

            // ---- 1. 远景层云带（地平线附近，最密集最厚）----
            if (dir.y < 0.35) {
              float stretch = mix(3.5, 1.0, smoothstep(0.0, 0.25, dir.y));
              vec2 cuv = dir.xz * stretch * 0.8;       // 0.4→0.8：增大采样范围，避免某方位角系统性缺云
              cuv += vec2(uTime * uCloudDrift, uTime * uCloudDrift * 0.3);
              float n = fbm(cuv);
              float cloud = smoothstep(1.0 - uCloudCoverage * 1.15, 1.0 - uCloudCoverage * 0.25, n);
              float band = smoothstep(0.32, 0.08, dir.y) * smoothstep(-0.08, 0.04, dir.y);
              cloud *= band;
              // 远景云偏暗（大气透视效应，晴朗关可经 uCloudFarDarken=1.0 关闭）
              vec3 farCol = mix(uCloudColor * uCloudFarDarken, uCloudHighlight * 0.85, lit);
              col = mix(col, farCol, cloud * 0.85);
            }

            // ---- 2. 中空层积云（主要云层，中等高度中等密度）----
            if (dir.y > 0.06 && dir.y < 0.75) {
              vec2 cuv2 = dir.xz * 1.0 + vec2(uTime * uCloudDrift * 0.7, uTime * uCloudDrift * 0.2);
              float n2 = fbm(cuv2 + vec2(7.3, 2.1));   // 偏移避免与层云重复
              float cloud2 = smoothstep(1.0 - uCloudCoverage * 0.9, 1.0 - uCloudCoverage * 0.3, n2);
              float band2 = smoothstep(0.06, 0.25, dir.y) * smoothstep(0.75, 0.40, dir.y);
              cloud2 *= band2 * 0.80;
              vec3 midCol = mix(uCloudColor, uCloudHighlight, lit);
              col = mix(col, midCol, cloud2);
            }

            // ---- 3. 高空卷云（稀疏薄云，高处点缀，偏亮）----
            //   zenithBoost>0：阈值降低（更密）+ band 上界推高（天顶不衰减）+ 密度增强
            //                + 采样改用 3D 噪声（dir 向量），球面连续无方位角接缝、无极点拉抻
            //   zenithBoost=0 时采样/阈值/带宽全回退原值，行为完全不变（关卡隔离）
            if (dir.y > 0.25) {
              float n3;
              if (uCloudZenith > 0.01) {
                // 3D 噪声采样：dir 是单位向量，球面上完全连续，
                //   无 atan 方位角接缝、无 dir.xz 极点汇聚，天顶云自然无拉伸无接缝
                vec3 c3 = dir * 3.0 + vec3(uTime * uCloudDrift * 0.4, 0.0, 0.0) + vec3(15.7, 8.2, 3.1);
                n3 = fbm3(c3);
              } else {
                // 原采样：dir.xz 2D fbm（保持其他关行为不变）
                vec2 cuv3 = dir.xz * 2.2 + vec2(uTime * uCloudDrift * 0.4, 0.0);
                n3 = fbm(cuv3 + vec2(15.7, 8.2));
              }
              float thrLow = mix(0.45, 0.28, uCloudZenith);
              float cloud3 = smoothstep(thrLow, thrLow + 0.20, n3);
              float bandTop = mix(0.95, 1.50, uCloudZenith);  // 上界推高；=1.50 时天顶(dir.y≤1)永不衰减
              float band3 = smoothstep(0.25, 0.45, dir.y) * smoothstep(bandTop, 0.60, dir.y);
              cloud3 *= band3 * mix(0.50, 0.85, uCloudZenith);
              // 高空云偏亮（被太阳直射，少大气遮挡）
              vec3 highCol = mix(uCloudColor * 1.15, uCloudHighlight * 1.08, lit);
              col = mix(col, highCol, cloud3);
            }
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  sky.userData.followCamera = true;

  // ---------- 太阳圆盘 + 光晕（挂到天空球下随相机移动）----------
  const sunSpriteCfg = cfg.sunSprite || {};
  const sunSprite = makeSunSprite(sunSpriteCfg);
  const sunDist = sunSpriteCfg.sunDist ?? 30000;
  sunSprite.position.copy(sun).multiplyScalar(sunDist);
  sky.add(sunSprite);

  // ---------- 光照 ----------
  const hemi = new THREE.HemisphereLight(hemiSky, hemiGround, hemiIntensity);
  scene.add(hemi);

  const sunLight = new THREE.DirectionalLight(sunColorVal, sunIntensity);
  sunLight.position.copy(sun).multiplyScalar(500);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  const sc = 220;
  sunLight.shadow.camera.left = -sc;
  sunLight.shadow.camera.right = sc;
  sunLight.shadow.camera.top = sc;
  sunLight.shadow.camera.bottom = -sc;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 1400;
  sunLight.shadow.bias = -0.0004;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // ---------- 雾 ----------
  scene.fog = new THREE.FogExp2(fogColor, fogDensity);

  // ---------- 地形 ----------
  // 关卡隔离：theme 'berlin' 或 ground.type 'satellite' 用 BerlinGround
  // （纯平卫星贴图地面，无地面3D内容），不创建 Terrain/Buildings；
  // 其他主题走原路径，逐行不变。
  const useSatelliteGround = cfg.theme === 'berlin' || cfg.ground?.type === 'satellite';
  let terrain, ground, buildings = null, obstacles = [], obstacleCenters = [];
  if (useSatelliteGround) {
    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
    terrain = new BerlinGround({ anisotropy: Math.min(8, maxAniso), ...(cfg.ground || {}) });
    ground = terrain.create();
    scene.add(ground);
  } else {
    const terrainSize = cfg.terrain?.size ?? 18000;
    const terrainSeg = cfg.terrain?.segments ?? 320;
    terrain = new Terrain(terrainSize, terrainSeg);
    ground = terrain.create();
    scene.add(ground);

    // ---------- 建筑 ----------
    buildings = new Buildings(terrain, cfg.buildings || {});
    scene.add(buildings.group);
    obstacles = buildings.obstacleBoxes;
    obstacleCenters = buildings.centers;
  }

  // ---------- 调试网格（已移除：正式游戏不再显示参考网格）----------
  const grid = null;

  // ---------- 海洋（仅 Britain 模式）----------
  // 太阳方向共享总线：同一个 sun Vector3 传给 sky uniform / sunLight.position / ocean.uSunDir，
  // 保证"天上太阳"与"水里高光"、DirectionalLight 三者方向完全同步（不脱节）。
  const ocean = isBritain ? new Ocean(scene, cfg.ocean) : null;
  if (ocean) {
    ocean.setEnv({
      sunDir: sun,
      sunColor: sunColorVal,
      skyTop,
      skyHorizon: skyBot,   // 海平线反射色 = 天空底部色，实现水天相接
      fogColor,
      // ocean 独立距离雾（不受场景雾影响）：场景雾关时陆地清晰，海洋仍融入天空，避免海平线硬边
      fogDensity: cfg.ocean?.fogDensity ?? 0.0003,
      coastline: cfg.terrain?.coastline,  // 海岸线基准 z
      coastAmp: isBritain ? 1.0 : 0,      // 海岸线弯曲开关（1=正弦波弯曲 ±1900m；0=平直）
    });
  }

  // ---------- 库尔斯克路网（仅 kursk 主题）----------
  // 三级路网（公路/土路/小路），灰白砂石颗粒感，贴地形起伏。
  // 关卡隔离：cfg.theme === 'kursk' 是唯一入口，britain/barbarossa 不创建。
  // 路网骨架与 terrain.js KURSK_ROAD_SKELETON 严格一致（农田距离分布共用）。
  let roads = null;
  if (cfg.theme === 'kursk') {
    roads = new KurskRoads(terrain);
    scene.add(roads.group);
  }

  // ---------- 库尔斯克战场（仅 kursk 主题；#86 起为纯数据模块：只算防空炮位）----------
  // 关卡隔离：cfg.theme === 'kursk' 是唯一入口，britain/barbarossa 不创建。
  let battlefield = null;
  if (cfg.theme === 'kursk' && cfg.battlefield?.enabled) {
    battlefield = new KurskBattlefield(terrain, cfg.battlefield, cfg.flak);
    scene.add(battlefield.group);
  }

  // ---------- 防空火力 Flak 视觉（仅配置启用时创建，纯视觉不接伤害）----------
  let flak = null;
  if (cfg.flak?.enabled) {
    const gunPositions = battlefield?.aaGunPositions || [];
    flak = new AntiAircraftFlak(scene, terrain, cfg.flak, gunPositions);
  }

  return {
    sky, sun, sunLight, hemi, ground, grid, obstacles, obstacleCenters, terrain, buildings, ocean, roads, battlefield, flak, envConfig: cfg,
    // 远景云带 uTime 推进（每帧调用，驱动天空 shader 内 fbm 云缓慢漂移）
    updateSkyClouds(dt) {
      sky.material.uniforms.uTime.value += dt;
    },
  };
}

/**
 * 释放环境资源（关卡切换时调用）。
 * 按顺序释放 sky（含 sunSprite 纹理）/光照/grid/terrain/buildings/ocean。
 */
export function disposeEnvironment(env, scene) {
  if (!env) return;
  // sky + sunSprite 纹理
  if (env.sky) {
    env.sky.traverse((o) => {
      if (o.isSprite && o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    scene.remove(env.sky);
    env.sky.geometry.dispose();
    env.sky.material.dispose();
  }
  // 光照
  if (env.sunLight) { scene.remove(env.sunLight); scene.remove(env.sunLight.target); }
  if (env.hemi) scene.remove(env.hemi);
  // 调试网格
  if (env.grid) { scene.remove(env.grid); env.grid.geometry.dispose(); env.grid.material.dispose(); }
  // 地形（先移除再释放 geo/mat）
  if (env.ground) scene.remove(env.ground);
  if (env.terrain) env.terrain.dispose();
  // 建筑
  if (env.buildings) env.buildings.dispose(scene);
  // 库尔斯克路网
  if (env.roads) env.roads.dispose(scene);
  // 库尔斯克战场氛围地标
  if (env.battlefield) env.battlefield.dispose(scene);
  // 防空火力 Flak
  if (env.flak) env.flak.dispose();
  // 海洋
  if (env.ocean) env.ocean.dispose();
}

/** 程序化生成太阳：多层 sprite 叠加（核心亮盘 + 暖光晕 + 大范围弥散光）
 *  尺寸参数可由 envConfig.sunSprite 传入（tune_scene 实时调节用） */
function makeSunSprite(cfg = {}) {
  const coreScale = cfg.coreScale ?? 6000;
  const halo1Scale = cfg.halo1Scale ?? 16000;
  const halo2Scale = cfg.halo2Scale ?? 34000;
  const halo1Opacity = cfg.halo1Opacity ?? 0.55;
  const halo2Opacity = cfg.halo2Opacity ?? 0.25;
  const sunDist = cfg.sunDist ?? 30000;
  const group = new THREE.Group();

  const coreTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.clearRect(0, 0, 256, 256);
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,250,225,0.98)');
    grd.addColorStop(0.6, 'rgba(255,236,180,0.5)');
    grd.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();

  const haloTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.clearRect(0, 0, 256, 256);
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,240,200,0.55)');
    grd.addColorStop(0.3, 'rgba(255,230,180,0.22)');
    grd.addColorStop(0.7, 'rgba(255,220,160,0.05)');
    grd.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();

  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: coreTex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  }));
  core.scale.setScalar(coreScale);
  group.add(core);

  const halo2 = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTex, transparent: true, depthWrite: false, opacity: halo1Opacity,
    blending: THREE.AdditiveBlending, fog: false,
  }));
  halo2.scale.setScalar(halo1Scale);
  group.add(halo2);

  const halo3 = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTex, transparent: true, depthWrite: false, opacity: halo2Opacity,
    blending: THREE.AdditiveBlending, fog: false,
  }));
  halo3.scale.setScalar(halo2Scale);
  group.add(halo3);

  return group;
}
