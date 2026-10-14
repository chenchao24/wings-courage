/**
 * 自由模式 · 地图配置（与战役模式完全隔离）。
 *
 * 按 map id 索引，每张地图独立配置：
 *   - environment: 环境主题（天空/太阳/雾/光照/地形/skyClouds）
 *   - clouds:      中空云团配置
 *   - playerStart: 玩家默认出生位置（机库页可覆盖）
 *
 * 当前仅"巴巴罗萨"开放，配置独立复制自 level_02_barbarossa.js（数据独立维护）。
 * 不 import 任何 js/config/levels/* 文件。
 */

const BARBAROSSA_MAP = {
  id: 'barbarossa',
  name: '巴巴罗萨',
  // 环境主题：东线夏季晴天（复制第2关 environment 配置，独立维护）
  // #85 同步：卫星贴图地面（与战役同图不同配置对象，铁原则隔离）
  environment: {
    theme: 'barbarossa',
    sky: { horizonColor: 0xd8eaf4, horizonStrength: 0.85, horizonWidth: 0.10 },  // #91 同步战役
    fog: { type: 'linear', near: 1500, far: 64000, color: 0xd8eaf4 },   // 最远端 ~78% 不死白，与战役同步
    ground: {
      type: 'satellite',
      texture: '/img/barbarossa/ground.jpg',
      width: 40000,
      depth: 32000,
      name: 'barbarossaGround',
      skirtColor: 0x484f35,
      fallbackColor: [73, 80, 53],
    },
    skyClouds: {
      enabled: true,
      color: 0xf4f6f8,
      highlight: 0xf8f4e8,
      coverage: 0.45,
      drift: 0.005,
      farDarken: 1.0,
    },
  },
  // 中空云团（复制第2关 clouds 配置，独立维护；#89 同步加密云量/放宽高度带与视距）
  clouds: {
    mode: 'fixed',
    bandBox: [-15000, 15000, 1000, 2100, 3000, -18000],
    spacing: 1300,
    patchiness: 0.70,
    patchScale: 4000,
    blobsPerCluster: [5, 7],
    minSize: 320,
    maxSize: 900,
    opacity: 0.88,
    depthContrast: 1.0,
    shadowEnabled: false,
    cloudColor: [242, 244, 248],
    distFade: [4000, 7000, 10000],
    extraBands: [
      {
        bandBox: [-15000, 15000, 1000, 2100, 3000, -18000],
        spacing: 6000,
        blobsPerCluster: [2, 3],
        minSize: 220,
        maxSize: 420,
        opacity: 0.5,
        sizeBias: 1.6,
      },
    ],
  },
  // 玩家默认出生位置（中央高空 2000 米，朝 -Z 飞）
  playerStart: {
    position: [0, 2000, 0],
    speed: 90,
  },
};

/** 按 map id 查地图配置 */
export function getFreeMapConfig(id) {
  switch (id) {
    case 'barbarossa': return BARBAROSSA_MAP;
    default: return null;
  }
}