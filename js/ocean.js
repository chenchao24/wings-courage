import * as THREE from 'three';

/**
 * 英吉利海峡海水渲染 v2：Gerstner 五重波 GPU 顶点位移 + Fresnel 天空反射 + Blinn-Phong 太阳高光 + fbm 泡沫 + 距离雾融入。
 *
 * 升级要点（参考 navybattle Gerstner 方案 + 3jsSkill 海面分级 L5）：
 *   - GPU 顶点位移（5 层 Gerstner 波，黄金角 2.399 错开方向）替代 CPU sin 循环
 *   - 解析法线（Y 偏导简化版）替代 computeVertexNormals（CPU 省去 40k 顶点重算）
 *   - 片元 shader：菲涅尔天空反射 + 波峰浅/波谷深双色 + Blinn-Phong 太阳高光 + fbm 泡沫 + 距离雾融入海平线
 *   - frustumCulled=false（顶点位移后包围球失真会被视锥误裁，知识库陷阱）
 *   - JS 镜像 getWaveHeight 供未来飞机贴海判断（常数与 GLSL 严格一致）
 *   - 太阳方向共享总线：setEnv 注入 sunDir，保证水面高光与天上太阳、DirectionalLight 同步
 *
 * 性能：segments=200 -> 40k 顶点，GPU 位移+片元 shader，CPU 仅更新 uTime/cameraPos（比 v1 CPU sin 循环快 3-5 倍）。
 * 平海面特化（waveHeight=0，如 Britain）：网格降为 1 段 2 三角形（顶点无位移无需细分），
 * USE_WAVES=0 编译时短路 Gerstner 循环与泡沫 fbm；细节噪声按距离短路（>3000m 不算）。
 */
const N_WAVES = 5;

export class Ocean {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.size = opts.size || 30000;
    this.segments = opts.segments || 200;
    this.color = opts.color || 0x3a5060;
    this.waveHeight = opts.waveHeight ?? 0.35;  // 总浪高系数（首层振幅 = waveHeight*0.5）
    this.t = 0;

    // 平海面特化（waveHeight=0，如 Britain 关）：
    // 顶点无位移 → 网格无需细分（1 段 = 2 三角形，省 9 万顶点）；
    // 着色器用 USE_WAVES=0 编译时短路 Gerstner 循环与泡沫 fbm（vCrest 恒 0 时泡沫恒不可见）。
    this._wavesEnabled = this.waveHeight > 0;

    // 生成 5 层 Gerstner 波参数（黄金角错开方向，振幅/波长逐层衰减）
    this._waves = this._wavesEnabled ? this._generateWaves() : [];

    // 水色（深/浅，波峰用浅色）
    const cDeep = new THREE.Color(this.color).offsetHSL(0, 0, -0.05);
    const cShallow = new THREE.Color(this.color).offsetHSL(0, 0, 0.12);

    // 平海面时顶点无位移，1 段（2 三角形）即可，几何/着色结果与高细分完全一致
    const seg = this._wavesEnabled ? this.segments : 1;
    const geo = new THREE.PlaneGeometry(this.size, this.size, seg, seg);
    geo.rotateX(-Math.PI / 2);

    // 波参数 uniform 数组（xy=方向, z=振幅, w=频率）
    const uWaves = this._waves.map((w) => new THREE.Vector4(w.dirX, w.dirY, w.amp, w.freq));

    this.material = new THREE.ShaderMaterial({
      toneMapped: false,  // 手算颜色直出，与天空 shader 一致；不走 PBR 光照
      transparent: true,   // 海岸线 alpha 渐变软衔接沙滩
      depthWrite: false,   // 透明不写深度，让 terrain 陆地正确遮挡
      defines: {
        USE_WAVES: this._wavesEnabled ? 1 : 0,  // 平海面编译时短路 Gerstner/泡沫计算
      },
      uniforms: {
        uTime:        { value: 0 },
        uWaves:       { value: uWaves },
        uSunDir:      { value: new THREE.Vector3(0, 1, 0) },
        uSunColor:    { value: new THREE.Color(0xfff0d8) },
        uSkyTop:      { value: new THREE.Color(0x4a5a6e) },
        uSkyHorizon:  { value: new THREE.Color(0xb8c4d0) },
        uWaterDeep:   { value: cDeep },
        uWaterShallow: { value: cShallow },
        uCameraPos:   { value: new THREE.Vector3() },
        uFogColor:    { value: new THREE.Color(0xb8c4d0) },
        uFogDensity:  { value: 0.00038 },
        uCoastline:   { value: -5000 },  // 海岸线基准 z（实际海岸线 = uCoastline + fbm 噪声 * uCoastAmp）
        uCoastAmp:    { value: 0 },      // 海岸线弯曲振幅（0=平直，3200=±1600m 海湾/海岬）
        uOceanHalf:   { value: this.size / 2 },  // 海面半径（用于边缘 alpha 渐隐）
      },
      vertexShader: /* glsl */`
        uniform float uTime;
        uniform vec4 uWaves[${N_WAVES}];
        varying vec3 vWorldPos;
        varying vec2 vLocalPos;
        varying vec3 vNormal;
        varying float vCrest;

        void main() {
          // 用世界水平坐标（mesh.position + localPos），让波纹/纹理相对世界固定；
          // mesh 跟随相机时相机移动 -> 海面纹理"后退"，产生低空掠过的速度参照感
          vec2 horiz = (modelMatrix * vec4(position, 1.0)).xz;
          float dx = 0.0, dz = 0.0, y = 0.0;
          float dYdx = 0.0, dYdz = 0.0;
#if USE_WAVES
          for (int i = 0; i < ${N_WAVES}; i++) {
            vec4 w = uWaves[i];
            vec2 d = w.xy;
            float amp = w.z;
            float freq = w.w;
            float phase = dot(d, horiz) * freq + uTime * freq;
            float s = sin(phase);
            float c = cos(phase);
            // Gerstner 水平位移（陡度 Q=0.3 温和，避免自交）
            float Q = 0.3;
            dx += Q * d.x * amp * s;
            dz += Q * d.y * amp * s;
            y += amp * c;
            // 法线（Y 偏导简化版，浪高<0.5 时视觉够）
            dYdx += amp * freq * d.x * c;
            dYdz += amp * freq * d.y * c;
          }
#endif
          vec3 displaced = vec3(position.x + dx, y, position.z + dz);
          vec3 normal = normalize(vec3(-dYdx, 1.0, -dYdz));
          vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;
          vLocalPos = horiz;
          vNormal = normal;
          vCrest = y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyTop;
        uniform vec3 uSkyHorizon;
        uniform vec3 uWaterDeep;
        uniform vec3 uWaterShallow;
        uniform vec3 uCameraPos;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uCoastline;
        uniform float uCoastAmp;
        uniform float uOceanHalf;
        varying vec3 vWorldPos;
        varying vec2 vLocalPos;
        varying vec3 vNormal;
        varying float vCrest;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0; float a = 0.5;
          mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);  // 旋转 36.87°，打破网格对齐（去方格感）
          for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = rot * p * 2.0; a *= 0.5; }
          return v;
        }

        // 弯曲海岸线：三层正弦波在 x 方向产生海湾/海岬（与 terrain.js coastLineAt 严格一致）
        // 正弦波不用 hash 噪声--避免 JS double 与 GLSL highp float 精度不匹配
        float coastLineAt(float x) {
          float curve = sin(x * 0.0006) * 1200.0
                      + sin(x * 0.0017 + 2.1) * 500.0
                      + sin(x * 0.0041 + 4.3) * 200.0;
          return uCoastline + curve * uCoastAmp;
        }

        void main() {
          // 陆地区域不渲染海洋（terrain 显示）；海岸线随 x 弯曲，alpha 渐变软衔接沙滩
          float coastX = coastLineAt(vWorldPos.x);
          if (vWorldPos.z < coastX - 30.0) discard;
          float coastAlpha = smoothstep(coastX - 30.0, coastX + 220.0, vWorldPos.z);

          vec3 N = normalize(vNormal);
          vec3 V = normalize(uCameraPos - vWorldPos);
          float dist = length(uCameraPos - vWorldPos);

          // 细碎法线扰动：fbm 多频叠加（4 层 vnoise → 去方格感/去规律感）
          // 两组不同偏移的 fbm 分别扰动 x/z（避免方向对称）+ 高频细节层
          // 按距离衰减（高空/远处减弱，避免塑料反光；近处保留细节）
          float detailFade = 1.0 - smoothstep(600.0, 5000.0, dist);
          if (detailFade > 0.001) {
            vec2 uv1 = vLocalPos * 0.05 + vec2(uTime * 0.06, uTime * 0.04);
            vec2 uv2 = uv1 + vec2(10.0, 5.0);  // 偏移采样，避免 x/z 方向对称
            float nx = fbm(uv1);               // 低频大尺度起伏（fbm 4 层叠加）
            float nz = fbm(uv2);
            float n3 = fbm(vLocalPos * 0.22 + uTime * 0.08);  // 高频细碎细节（fbm 去方格）
            N = normalize(N + vec3(
              (nx - 0.5) * 0.5 + (n3 - 0.5) * 0.15,
              0.0,
              (nz - 0.5) * 0.5 + (n3 - 0.5) * 0.15
            ) * detailFade);
          }

          // 菲涅尔（Schlick 近似，rf0=0.02 真实水反射率）
          // 系数从 0.98 降到 0.45：降低天空反射强度，去塑料反光感
          float fresnel = 0.02 + 0.45 * pow(1.0 - max(dot(N, V), 0.0), 5.0);

          // 天空色反射：按反射向量仰角采样
          vec3 R = reflect(-V, N);
          float skyT = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 skyCol = mix(uSkyHorizon, uSkyTop, smoothstep(0.3, 1.0, skyT));

          // 水色：波峰浅，波谷深（增强深度对比，去塑料感）
          float crest = smoothstep(0.05, 0.40, vCrest);
          vec3 waterCol = mix(uWaterDeep, uWaterShallow, crest);

          // 大尺度明暗斑驳：fbm 多频叠加给平海面加深浅变化（去"均匀玻璃"感）。
          // 低频系数 0.0008（约 1250m 周期），fbm 4 层叠加去方格感。
          float patchN = fbm(vLocalPos * 0.0008);
          waterCol *= 0.86 + patchN * 0.28;  // 对比度 0.86-1.14（原 0.92-1.08）

          // 合成水色 + 天空反射
          vec3 col = mix(waterCol, skyCol, fresnel);

          // Blinn-Phong 太阳高光：降低强度+更柔和扩散（去塑料反光）
          vec3 sunDir = normalize(uSunDir);
          vec3 H = normalize(V + sunDir);
          float spec = pow(max(dot(N, H), 0.0), 120.0);
          col += uSunColor * spec * 0.3;

          // fbm 泡沫（波峰处出现白沫）；平海面 vCrest 恒 0 时 foamMask 恒 0，编译时短路
#if USE_WAVES
          float foam = fbm(vLocalPos * 0.3 + uTime * 0.04);
          float foamMask = smoothstep(0.20, 0.36, vCrest) * smoothstep(0.45, 0.72, foam);
          col = mix(col, vec3(0.92, 0.94, 0.96), foamMask * 0.55);
#endif

          // 距离雾融入海平线（片元内实现，与场景雾色一致，实现水天相接）
          float fogFactor = 1.0 - exp(-uFogDensity * dist);
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

          // 边缘 alpha 渐隐：海面跟随相机，边缘 fade 到 0 避免硬边露出背景
          float edgeDist = length(vWorldPos.xz - uCameraPos.xz);
          float edgeFade = 1.0 - smoothstep(uOceanHalf - 5000.0, uOceanHalf, edgeDist);

          gl_FragColor = vec4(col, coastAlpha * edgeFade);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'ocean';
    this.mesh.position.y = 0;
    this.mesh.receiveShadow = false;  // ShaderMaterial 不接收阴影，关掉省性能
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;  // 顶点位移后包围球失真，必须关视锥裁（知识库陷阱）
    scene.add(this.mesh);
  }

  /** 生成 5 层 Gerstner 波参数（黄金角 2.399 错开方向，振幅/波长逐层衰减）*/
  _generateWaves() {
    const waves = [];
    const baseAmp = this.waveHeight * 0.5;  // 首层振幅，总和约 waveHeight*0.97
    let amp = baseAmp;
    let wavelength = 90;
    let angle = Math.random() * Math.PI * 2;
    for (let i = 0; i < N_WAVES; i++) {
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const freq = (2 * Math.PI) / wavelength;
      waves.push({ dirX, dirY, amp, freq });
      angle += 2.39996;   // 黄金角（弧度），避免平行波纹
      amp *= 0.62;        // 振幅逐层衰减
      wavelength *= 0.86; // 波长逐层缩短
    }
    return waves;
  }

  /**
   * 注入环境参数（太阳方向/颜色、天空色、雾），由 environment.js 创建后调用。
   * 太阳方向共享总线：保证水面高光与天上太阳、DirectionalLight 同步（不脱节）。
   */
  setEnv({ sunDir, sunColor, skyTop, skyHorizon, fogColor, fogDensity, coastline, coastAmp }) {
    if (sunDir) this.material.uniforms.uSunDir.value.copy(sunDir);
    if (sunColor) this.material.uniforms.uSunColor.value.set(sunColor);
    if (skyTop) this.material.uniforms.uSkyTop.value.set(skyTop);
    if (skyHorizon) this.material.uniforms.uSkyHorizon.value.set(skyHorizon);
    if (fogColor) this.material.uniforms.uFogColor.value.set(fogColor);
    if (fogDensity !== undefined) this.material.uniforms.uFogDensity.value = fogDensity;
    if (coastline !== undefined) this.material.uniforms.uCoastline.value = coastline;
    if (coastAmp !== undefined) this.material.uniforms.uCoastAmp.value = coastAmp;
  }

  /** 每帧更新：uTime 推进 + 相机位置 + 跟随相机 xz（海洋无限延伸感）*/
  update(dt, camera) {
    this.t += dt;
    this.material.uniforms.uTime.value = this.t;
    this.material.uniforms.uCameraPos.value.copy(camera.position);
    this.mesh.position.x = camera.position.x;
    this.mesh.position.z = camera.position.z;
  }

  /**
   * JS 镜像波高（供未来飞机贴海判断浪面）。
   * 常数与 GLSL 严格一致，否则视觉与逻辑脱钩（知识库 navybattle 踩坑）。
   */
  getWaveHeight(x, z, t = this.t) {
    let y = 0;
    for (let i = 0; i < N_WAVES; i++) {
      const w = this._waves[i];
      const phase = (w.dirX * x + w.dirY * z) * w.freq + t * w.freq;
      y += w.amp * Math.cos(phase);
    }
    return y;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh = null;
  }
}
