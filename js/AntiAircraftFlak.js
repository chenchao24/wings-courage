import * as THREE from 'three';

/**
 * 防空火力（Flak）视觉系统 —— 纯视觉，不接伤害。
 *
 * 两类视觉：
 *   A. flak 烟团（空爆）：瞬间火光 Sprite(additive,0.1s) + 3-5 深灰烟团 Sprite 错位叠加（膨胀+淡出,15s）
 *   B. 地面曳光弹线：从地面发射点向天空射出狭长 Sprite（沿弹道屏幕投影对齐,红橙,0.1-0.2s）
 *
 * 区域化发射（坐标来自库尔斯克地图点位.md，[x,z]）：
 *   - friendly 友军区域：不发射
 *   - mainBattle 主战场：零星，越靠近苏军越多（ramp = dFriendly/(dFriendly+dEnemy)）
 *   - enemy 苏军阵地：密集
 * 高度分段按区域分密度权重（苏军 0-1500m，非苏军 500-1000m）。
 *
 * 性能：follow 玩家 activeR 内生成，cullR 距离剔除，maxBursts/maxTracers 上限，纹理共享。
 */
const _smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _UP = new THREE.Vector3(0, 1, 0);
const _RIGHT = new THREE.Vector3(1, 0, 0);

export class AntiAircraftFlak {
  constructor(scene, terrain, options = {}, gunPositions = []) {
    this.scene = scene;
    this.terrain = terrain;
    this.options = options;
    this.camera = null;

    this.activeR = options.activeR ?? 3000;
    this.cullR = options.cullR ?? 5000;
    this.maxBursts = options.maxBursts ?? 80;
    this.maxTracers = options.maxTracers ?? 80;

    // ── 阵地防空带（继承老苏军系数，zone-based）──
    this.positionZone = options.positionZone || null;
    this.positionDensity = options.positionDensity ?? 1.6;
    this.positionBurstRate = options.positionBurstRate ?? 1;
    this.positionTracerRate = options.positionTracerRate ?? 12;
    // 曳光弹高度上限（玩家 AGL 低于此值才发射曳光，缺省 500=原行为；柏林高空关可调高）
    this.tracerAltMax = options.tracerAltMax ?? 500;

    // ── 我方防空走廊（仅配置 corridor 的关卡启用，如第4关柏林：打轰炸机编队，不打玩家）──
    // 缺省 null = 原"跟随玩家"行为（其他关不受影响）。
    // { zoneMin, zoneMax, zHalf, segmentEvery, segmentLen, leadIn, leadOut,
    //   burstRate, tracerRate, altSpread, killAt }
    this.corridor = options.corridor || null;
    this._corridorSegs = [];
    this._corridorKilled = false;    // 表演击落一次性标志
    this._corridorBurstAcc = 0;
    this._corridorTracerAcc = 0;
    if (this.corridor) {
      const c = this.corridor;
      // 沿 x 轴从东缘（zoneMax，编队入口）向西：每 segmentEvery 一个 segmentLen 区间
      for (let e = c.zoneMax; e - c.segmentLen >= c.zoneMin; e -= c.segmentEvery) {
        this._corridorSegs.push({ east: e, west: e - c.segmentLen, firing: false });
      }
    }

    // ── 炮位（per-gun emission）──
    this._gunPositions = gunPositions || [];
    const g = options.gun || {};
    this.gunCoverage = g.coverage ?? 600;
    this.gunCoverageSq = this.gunCoverage * this.gunCoverage;
    this.gunAltMin = g.altMin ?? 300;
    this.gunAltMax = g.altMax ?? 1500;
    this.gunDensity = g.density ?? 0.2;
    this.gunBurstRate = g.burstRate ?? 0.1;
    this.gunTracerRate = g.tracerRate ?? 0.9;

    // ── 高度分段（统一）──
    this.altBands = options.altBands || [{ alt: [300, 800], weight: 1.2 }, { alt: [800, 1200], weight: 1.0 }, { alt: [1200, 1500], weight: 0.35 }];

    const b = options.burst || {};
    this.burstCfg = {
      smokeColor: b.smokeColor || [40, 40, 44],
      fireColor: b.fireColor || [255, 200, 120],
      smokeLife: b.smokeLife ?? 28,
      smokeBlobs: b.smokeBlobs || [3, 7],
      smokeSize: b.smokeSize || [60, 180],
      smokeMaxScale: b.smokeMaxScale ?? 1.5,
      fireLife: b.fireLife ?? 0.15,
      salvo: b.salvo || [3, 5],
      salvoSpread: b.salvoSpread ?? 800,
    };
    const t = options.tracer || {};
    this.tracerCfg = {
      color: t.color || [255, 90, 60],
      life: t.life || [0.20, 0.40],
      len: t.len || [180, 320],
    };

    // 多灰度烟团纹理
    this._smokeTexs = [
      this._makeSmokeTexture([35, 35, 40]),
      this._makeSmokeTexture([78, 78, 86]),
      this._makeSmokeTexture([135, 135, 145]),
      this._makeSmokeTexture([30, 30, 34]),
    ];
    this._fireTex = this._makeFireTexture(this.burstCfg.fireColor);
    this._tracerTex = this._makeTracerTexture(this.tracerCfg.color);

    this._bursts = [];
    this._tracers = [];
    this._pendingBursts = [];
    this._flashes = [];           // 地面开炮闪光
    this._posBurstAcc = 0;   // 阵地防空带齐射累积
    this._posTracerAcc = 0;  // 阵地防空带曳光弹累积

    this._camRight = new THREE.Vector3();
    this._camUp = new THREE.Vector3();
    this._v = new THREE.Vector3();

    this._altCum = this._buildAltCum(this.altBands);

    this._enabled = true;
  }

  setCamera(camera) { this.camera = camera; }

  // ─── 纹理生成 ───
  _makeSmokeTexture(color) {
    const [r, g, b] = color;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    let rng = (r * 7 + g * 13 + b * 17) % 233280 || 12345;
    const rand = () => { rng = (rng * 9301 + 49297) % 233280; return rng / 233280; };
    // 柔球叠加（稀薄，alpha 偏低）
    ctx.filter = 'blur(10px)';
    const balls = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < balls; i++) {
      const cx = 80 + rand() * 96;
      const cy = 80 + rand() * 96;
      const rad = 38 + rand() * 52;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grd.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
      grd.addColorStop(0.5, `rgba(${r},${g},${b},0.3)`);
      grd.addColorStop(0.75, `rgba(${r},${g},${b},0.12)`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.filter = 'none';
    // 边缘破碎：destination-out 随机小圆侵蚀边缘 + 内部小孔
    ctx.globalCompositeOperation = 'destination-out';
    ctx.filter = 'blur(6px)';
    for (let i = 0; i < 30; i++) {
      const ang = rand() * Math.PI * 2;
      const dist = 72 + rand() * 78;
      const ex = 128 + Math.cos(ang) * dist;
      const ey = 128 + Math.sin(ang) * dist;
      const er = 10 + rand() * 24;
      const grd = ctx.createRadialGradient(ex, ey, 0, ex, ey, er);
      grd.addColorStop(0, 'rgba(0,0,0,0.5)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 6; i++) {
      const ex = 90 + rand() * 76;
      const ey = 90 + rand() * 76;
      const er = 6 + rand() * 12;
      const grd = ctx.createRadialGradient(ex, ey, 0, ex, ey, er);
      grd.addColorStop(0, 'rgba(0,0,0,0.35)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _makeFireTexture(color) {
    const [r, g, b] = color;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, `rgba(${r},${g},${b},0.9)`);
    grd.addColorStop(0.7, `rgba(${r},${g},${b},0.3)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _makeTracerTexture(color) {
    const [r, g, b] = color;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, `rgba(${r},${g},${b},0.8)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ─── 区域工具 ───
  _pointInPolygon(x, z, poly) {
    if (!poly || poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1];
      const xj = poly[j][0], zj = poly[j][1];
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
    }
    return inside;
  }

  _distToSegmentSq(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((px - ax) * dx + (pz - az) * dz) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cz = az + t * dz;
    const ex = px - cx, ez = pz - cz;
    return ex * ex + ez * ez;
  }

  _distToPolygon(x, z, poly) {
    if (!poly || poly.length < 3) return Infinity;
    let minD2 = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const d2 = this._distToSegmentSq(x, z, a[0], a[1], b[0], b[1]);
      if (d2 < minD2) minD2 = d2;
    }
    return Math.sqrt(minD2);
  }

  // ─── 高度分段 ───
  _buildAltCum(bands) {
    if (!bands || !bands.length) return null;
    let total = 0;
    const cum = [];
    for (const seg of bands) { total += seg.weight; cum.push(total); }
    return { bands, cum, total };
  }

  /** 选高度：统一高度带权重选段，段内优先靠近玩家高度（±250m），clamp 到段内。 */
  _pickAltitude(playerAlt) {
    const ac = this._altCum;
    if (!ac) return playerAlt ?? 600;
    const r = Math.random() * ac.total;
    let seg;
    for (let i = 0; i < ac.cum.length; i++) {
      if (r <= ac.cum[i]) { seg = ac.bands[i]; break; }
    }
    if (!seg) seg = ac.bands[ac.bands.length - 1];
    if (playerAlt != null && playerAlt >= 0) {
      const center = playerAlt + (Math.random() - 0.5) * 500;
      return Math.max(seg.alt[0], Math.min(seg.alt[1], center));
    }
    return seg.alt[0] + Math.random() * (seg.alt[1] - seg.alt[0]);
  }

  // ─── 随机点 ───
  /** 玩家周围环形 (minR, maxR) 内随机点 */
  _randomAroundPlayer(playerPos, minR, maxR) {
    const ang = Math.random() * Math.PI * 2;
    const rad = minR + Math.sqrt(Math.random()) * (maxR - minR);
    return { x: playerPos.x + Math.cos(ang) * rad, z: playerPos.z + Math.sin(ang) * rad };
  }


  // ─── 发射 ───
  _spawnBurst(pos) {
    if (this._bursts.length >= this.maxBursts) return;
    const cfg = this.burstCfg;
    const life = cfg.smokeLife;
    const blobsN = cfg.smokeBlobs[0] + Math.floor(Math.random() * (cfg.smokeBlobs[1] - cfg.smokeBlobs[0] + 1));

    const burst = {
      pos: pos.clone(),
      life, maxLife: life,
      fireLife: cfg.fireLife, fireMaxLife: cfg.fireLife,
      coreLife: 0.06, coreMaxLife: 0.06,

      smokeSprites: [], smokeMats: [], blobScales: [],
      fireSprite: null, fireMat: null, fireBase: 0,
      coreSprite: null, coreMat: null, coreBase: 0,
    };

    const fireMat = new THREE.SpriteMaterial({
      map: this._fireTex, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 1.3, toneMapped: false, fog: true,
    });
    const fireSprite = new THREE.Sprite(fireMat);
    fireSprite.position.copy(pos);
    const fireBase = cfg.smokeSize[0] * 0.8;
    fireSprite.scale.setScalar(fireBase);
    fireSprite.renderOrder = 20;
    this.scene.add(fireSprite);
    burst.fireSprite = fireSprite;
    burst.fireMat = fireMat;
    burst.fireBase = fireBase;

    // 中心核心爆点：更小更亮，快速闪（0.06s）
    const coreMat = new THREE.SpriteMaterial({
      map: this._fireTex, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 1.6, toneMapped: false, fog: true,
    });
    const coreSprite = new THREE.Sprite(coreMat);
    coreSprite.position.copy(pos);
    const coreBase = fireBase * 0.35;
    coreSprite.scale.setScalar(coreBase);
    coreSprite.renderOrder = 21;
    this.scene.add(coreSprite);
    burst.coreSprite = coreSprite;
    burst.coreMat = coreMat;
    burst.coreBase = coreBase;

    for (let i = 0; i < blobsN; i++) {
      const tex = this._smokeTexs[Math.floor(Math.random() * this._smokeTexs.length)];
      const mat = new THREE.SpriteMaterial({
        map: tex, blending: THREE.NormalBlending,
        depthWrite: false, transparent: true, opacity: 0, fog: true,
      });
      const sp = new THREE.Sprite(mat);
      const off = (Math.random() - 0.5) * cfg.smokeSize[0] * 0.7;
      const off2 = (Math.random() - 0.5) * cfg.smokeSize[0] * 0.7;
      const offY = (Math.random() - 0.5) * cfg.smokeSize[0] * 0.5;
      sp.position.set(pos.x + off, pos.y + offY, pos.z + off2);
      const baseScale = cfg.smokeSize[0] + Math.random() * (cfg.smokeSize[1] - cfg.smokeSize[0]);
      sp.scale.setScalar(baseScale);
      sp.renderOrder = 6;
      this.scene.add(sp);
      burst.smokeSprites.push(sp);
      burst.smokeMats.push(mat);
      burst.blobScales.push(baseScale);
    }

    this._bursts.push(burst);
  }

  _spawnTracer(fromPos, dir) {
    if (this._tracers.length >= this.maxTracers) return;
    const cfg = this.tracerCfg;
    const life = cfg.life[0] + Math.random() * (cfg.life[1] - cfg.life[0]);
    const len = cfg.len[0] + Math.random() * (cfg.len[1] - cfg.len[0]);

    // 扰动参数：3 段拼接，正弦波垂直偏移，模拟弹道不稳
    const segs = 3;
    const segLen = len / segs;
    const wobbleAmp = 5 + Math.random() * 8;
    const wobbleFreq = 2 + Math.random() * 2;
    const upRef = Math.abs(dir.y) < 0.9 ? _UP : _RIGHT;
    const perp = new THREE.Vector3().crossVectors(dir, upRef).normalize();
    perp.applyAxisAngle(dir, Math.random() * Math.PI * 2);

    let rot = 0;
    if (this.camera) {
      this.camera.matrixWorld.extractBasis(this._camRight, this._camUp, this._v);
      const sx = dir.dot(this._camRight);
      const sy = dir.dot(this._camUp);
      rot = Math.atan2(sy, sx);
    }

    const sprites = [];
    const mats = [];
    for (let s = 0; s < segs; s++) {
      const tMid = (s + 0.5) / segs;
      const along = tMid * len;
      const offset = Math.sin(tMid * Math.PI * wobbleFreq) * wobbleAmp * tMid;
      const px = fromPos.x + dir.x * along + perp.x * offset;
      const py = fromPos.y + dir.y * along + perp.y * offset;
      const pz = fromPos.z + dir.z * along + perp.z * offset;

      const mat = new THREE.SpriteMaterial({
        map: this._tracerTex, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.9, toneMapped: false, fog: true,
      });
      mat.rotation = rot;
      const sp = new THREE.Sprite(mat);
      sp.position.set(px, py, pz);
      sp.scale.set(segLen, 1.5, 1);
      sp.renderOrder = 19;
      this.scene.add(sp);
      sprites.push(sp);
      mats.push(mat);
    }

    this._tracers.push({ sprites, mats, life, maxLife: life });
  }

  // ─── update ───
  update(dt, playerPos, camera, forward, audio, bombers) {
    if (!this._enabled || !playerPos) return;
    if (camera) this.camera = camera;

    const gh0 = this.terrain ? this.terrain.getHeight(playerPos.x, playerPos.z) : 0;
    const playerAlt = playerPos.y != null ? (playerPos.y - gh0) : 0;

    if (this.corridor) {
      // 我方防空走廊（柏林）：发射逻辑完全独立，不跟随玩家
      this._updateCorridor(dt, playerPos, audio, bombers);
    } else {
    // ── 阵地防空带：zone-based，继承老苏军系数 ──
    if (this.positionZone && this._pointInPolygon(playerPos.x, playerPos.z, this.positionZone)) {
      const d = this.positionDensity;
      this._posBurstAcc += dt * this.positionBurstRate * d;
      while (this._posBurstAcc >= 1) {
        this._posBurstAcc -= 1;
        this._emitBurstFromZone(playerPos, forward);
      }
      if (playerAlt < this.tracerAltMax) {
        this._posTracerAcc += dt * this.positionTracerRate * d;
        while (this._posTracerAcc >= 1) {
          this._posTracerAcc -= 1;
          this._emitTracerFromZone(playerPos);
        }
      } else {
        this._posTracerAcc = 0;
      }
    }

    // ── per-gun 发射：每门炮独立累积 ──
    for (const gun of this._gunPositions) {
      const dx = gun.x - playerPos.x, dz = gun.z - playerPos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > this.gunCoverageSq) continue;  // 超出覆盖范围
      gun.burstAcc += dt * this.gunBurstRate;
      while (gun.burstAcc >= 1) {
        gun.burstAcc -= 1;
        this._emitBurstFromGun(gun, playerPos);
      }
      if (playerAlt < this.tracerAltMax) {
        gun.tracerAcc += dt * this.gunTracerRate;
        while (gun.tracerAcc >= 1) {
          gun.tracerAcc -= 1;
          this._emitTracerFromGun(gun, playerPos);
        }
      } else {
        gun.tracerAcc = 0;
      }
    }
    }

    // 推进错落待爆开的烟团
    for (let i = this._pendingBursts.length - 1; i >= 0; i--) {
      const pb = this._pendingBursts[i];
      pb.delay -= dt;
      if (pb.delay <= 0) {
        this._spawnBurst(pb.pos);
        this._spawnGroundFlash(pb.gunX, pb.gunZ);
        if (audio) {
          const dx = pb.pos.x - playerPos.x;
          const dy = pb.pos.y - (playerPos.y != null ? playerPos.y : 0);
          const dz = pb.pos.z - playerPos.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          audio.flakExplosion(dist);
        }
        this._pendingBursts.splice(i, 1);
      }
    }

    this._updateBursts(dt, playerPos);
    this._updateTracers(dt);
    this._updateFlashes(dt);
  }

  // ─── 我方防空走廊（仅 corridor 配置关卡，如柏林；打轰炸机编队不打玩家，表演性质）───
  /**
   * 触发机制（编队西飞 -x 向）：
   *   前锋 x < 区间东缘 + leadIn → 该区间开火；队尾 x < 区间西缘 - leadOut → 停火。
   *   爆点高度 = 编队平均高度 ± altSpread 随机。
   *   编队前锋深入走廊 killAt 比例时，随机击落一架（直接进坠毁，不报 killed 事件、不计玩家积分）。
   */
  _updateCorridor(dt, playerPos, audio, bombers) {
    const c = this.corridor;
    // 在编轰炸机（未坠毁/未返航/未缓慢坠毁/未脱离）
    let front = Infinity, trail = -Infinity, altSum = 0;
    const alive = [];
    for (const b of bombers || []) {
      if (!b || !b.ready || !b.root || b._falling || b._rtb || b._slowCrash || b._despawnRequested) continue;
      alive.push(b);
      const x = b.root.position.x;
      if (x < front) front = x;
      if (x > trail) trail = x;
      altSum += b.root.position.y;
    }
    if (!alive.length) return;   // 无在编轰炸机 → 停火（已生成的烟团自然消散）
    const bomberAlt = altSum / alive.length;
    const leadIn = c.leadIn ?? 700, leadOut = c.leadOut ?? 700;

    // 区间开火状态机（start 需编队尚未飞过该区间，否则飞过后会反复重触发）
    let nFiring = 0;
    for (const seg of this._corridorSegs) {
      if (!seg.firing && front < seg.east + leadIn && trail > seg.west - leadOut) seg.firing = true;
      else if (seg.firing && trail < seg.west - leadOut) seg.firing = false;
      if (seg.firing) nFiring++;
    }

    // 发射（每激活区间独立按 burstRate/tracerRate 累积）
    if (nFiring) {
      this._corridorBurstAcc += dt * (c.burstRate ?? 0.5) * nFiring;
      while (this._corridorBurstAcc >= 1) {
        this._corridorBurstAcc -= 1;
        this._emitCorridorSalvo(this._randomFiringSeg(), bomberAlt);
      }
      this._corridorTracerAcc += dt * (c.tracerRate ?? 4) * nFiring;
      while (this._corridorTracerAcc >= 1) {
        this._corridorTracerAcc -= 1;
        this._emitCorridorTracer(this._randomFiringSeg(), bomberAlt);
      }
    }

    // 表演击落（一次性）：编队前锋深入走廊 killAt 比例 → 随机一架进坠毁，不计分
    if (!this._corridorKilled) {
      const L = c.zoneMax - c.zoneMin;
      if (front < c.zoneMax - L * (c.killAt ?? 0.5)) {
        this._corridorKilled = true;
        const pick = alive[Math.floor(Math.random() * alive.length)];
        for (let i = 0; i < 3; i++) {   // 机体周围空爆命中表演
          const p = pick.root.position.clone();
          p.x += (Math.random() - 0.5) * 30;
          p.y += (Math.random() - 0.5) * 20;
          p.z += (Math.random() - 0.5) * 30;
          this._spawnBurst(p);
        }
        pick._enterCrash(1 + Math.floor(Math.random() * 3));
      }
    }
  }

  _randomFiringSeg() {
    const firing = [];
    for (const s of this._corridorSegs) if (s.firing) firing.push(s);
    return firing[Math.floor(Math.random() * firing.length)];
  }

  /** 走廊齐射：区间内散布爆点，高度 = 编队平均高度 ± altSpread */
  _emitCorridorSalvo(seg, bomberAlt) {
    if (!seg) return;
    const cfg = this.burstCfg;
    const c = this.corridor;
    const n = cfg.salvo[0] + Math.floor(Math.random() * (cfg.salvo[1] - cfg.salvo[0] + 1));
    const zHalf = c.zHalf ?? 2500, altSpread = c.altSpread ?? 400;
    for (let i = 0; i < n; i++) {
      const ox = seg.west + Math.random() * (seg.east - seg.west);
      const oz = (Math.random() - 0.5) * 2 * zHalf;
      const gh = this.terrain ? this.terrain.getHeight(ox, oz) : 0;
      const alt = Math.max(300, bomberAlt + (Math.random() - 0.5) * 2 * altSpread);
      const pos = new THREE.Vector3(ox, gh + alt, oz);
      const delay = Math.random() * 1.5;
      this._pendingBursts.push({ pos, delay, gunX: ox, gunZ: oz });
    }
  }

  /** 走廊曳光弹：区间内地面炮位射向编队高度带 */
  _emitCorridorTracer(seg, bomberAlt) {
    if (!seg) return;
    const c = this.corridor;
    const zHalf = c.zHalf ?? 2500, altSpread = c.altSpread ?? 400;
    const gx = seg.west + Math.random() * (seg.east - seg.west);
    const gz = (Math.random() - 0.5) * 2 * zHalf;
    const groundH = this.terrain ? this.terrain.getHeight(gx, gz) : 0;
    const from = new THREE.Vector3(gx, groundH + 2, gz);
    const tx = gx + (Math.random() - 0.5) * 500;
    const tz = (Math.random() - 0.5) * 800;
    const ty = groundH + bomberAlt + (Math.random() - 0.5) * 2 * altSpread;
    const dir = new THREE.Vector3(tx - from.x, ty - from.y, tz - from.z).normalize();
    this._spawnTracer(from, dir);
  }

  /** 阵地防空带齐射：在玩家前方散布，继承老苏军系数 */
  _emitBurstFromZone(playerPos, forward) {
    const cfg = this.burstCfg;
    const aheadDist = 800;
    const cx = playerPos.x + (forward ? forward.x * aheadDist : 0);
    const cz = playerPos.z + (forward ? forward.z * aheadDist : 0);
    const n = cfg.salvo[0] + Math.floor(Math.random() * (cfg.salvo[1] - cfg.salvo[0] + 1));
    const spread = cfg.salvoSpread;
    const groundH0 = this.terrain ? this.terrain.getHeight(playerPos.x, playerPos.z) : 0;
    const playerAlt = playerPos.y != null ? (playerPos.y - groundH0) : null;
    for (let i = 0; i < n; i++) {
      const ox = cx + (Math.random() - 0.5) * spread;
      const oz = cz + (Math.random() - 0.5) * spread;
      const gh = this.terrain ? this.terrain.getHeight(ox, oz) : 0;
      const alt = this._pickAltitude(playerAlt);
      const pos = new THREE.Vector3(ox, gh + alt, oz);
      const delay = Math.random() * 1.5;
      this._pendingBursts.push({ pos, delay, gunX: cx, gunZ: cz });
    }
  }

  /** per-gun 齐射：从炮位散布，对玩家射击 */
  _emitBurstFromGun(gun, playerPos) {
    const cfg = this.burstCfg;
    const n = cfg.salvo[0] + Math.floor(Math.random() * (cfg.salvo[1] - cfg.salvo[0] + 1));
    const spread = cfg.salvoSpread;
    const groundH0 = this.terrain ? this.terrain.getHeight(playerPos.x, playerPos.z) : 0;
    const playerAlt = playerPos.y != null ? (playerPos.y - groundH0) : null;
    for (let i = 0; i < n; i++) {
      const ox = gun.x + (Math.random() - 0.5) * spread;
      const oz = gun.z + (Math.random() - 0.5) * spread;
      const gh = this.terrain ? this.terrain.getHeight(ox, oz) : 0;
      const alt = this._pickAltitude(playerAlt);
      const pos = new THREE.Vector3(ox, gh + alt, oz);
      const delay = Math.random() * 1.5;
      this._pendingBursts.push({ pos, delay, gunX: gun.x, gunZ: gun.z });
    }
  }

  /** 阵地防空带曳光弹：从玩家周围地面射向玩家 */
  _emitTracerFromZone(playerPos) {
    const ang = Math.random() * Math.PI * 2;
    const rad = 600 + Math.sqrt(Math.random()) * (this.activeR - 600);
    const gx = playerPos.x + Math.cos(ang) * rad;
    const gz = playerPos.z + Math.sin(ang) * rad;
    const groundH = this.terrain ? this.terrain.getHeight(gx, gz) : 0;
    const from = new THREE.Vector3(gx, groundH + 2, gz);
    const tx = playerPos.x + (Math.random() - 0.5) * 400;
    const tz = playerPos.z + (Math.random() - 0.5) * 400;
    const ty = playerPos.y + 200 + Math.random() * 400;
    const dir = new THREE.Vector3(tx - from.x, ty - from.y, tz - from.z).normalize();
    this._spawnTracer(from, dir);
  }

  /** per-gun 曳光弹：从炮位射向玩家 */
  _emitTracerFromGun(gun, playerPos) {
    const groundH = this.terrain ? this.terrain.getHeight(gun.x, gun.z) : 0;
    const from = new THREE.Vector3(gun.x, groundH + 2, gun.z);
    const tx = playerPos.x + (Math.random() - 0.5) * 400;
    const tz = playerPos.z + (Math.random() - 0.5) * 400;
    const ty = playerPos.y + 200 + Math.random() * 400;
    const dir = new THREE.Vector3(tx - from.x, ty - from.y, tz - from.z).normalize();
    this._spawnTracer(from, dir);
  }

  /** 地面开炮闪光：炮位地面短暂橙色闪光，模拟炮口焰 */
  _spawnGroundFlash(gunX, gunZ) {
    const groundH = this.terrain ? this.terrain.getHeight(gunX, gunZ) : 0;
    const size = 8 + Math.random() * 7;
    const mat = new THREE.SpriteMaterial({
      map: this._fireTex, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 1.0, toneMapped: false, fog: true,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.set(gunX, groundH + 1.5, gunZ);
    sp.scale.setScalar(size);
    sp.renderOrder = 18;
    this.scene.add(sp);
    this._flashes.push({ sprite: sp, mat, life: 0.1, maxLife: 0.1 });
  }

  _updateFlashes(dt) {
    for (let i = this._flashes.length - 1; i >= 0; i--) {
      const f = this._flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        f.mat.dispose();
        this._flashes.splice(i, 1);
        continue;
      }
      f.mat.opacity = f.life / f.maxLife;
    }
  }

  _updateBursts(dt, playerPos) {
    const cfg = this.burstCfg;
    const cullSq = this.cullR * this.cullR;
    for (let i = this._bursts.length - 1; i >= 0; i--) {
      const b = this._bursts[i];
      if (playerPos) {
        const dx = b.pos.x - playerPos.x, dz = b.pos.z - playerPos.z;
        if (dx * dx + dz * dz > cullSq) { this._recycleBurst(i); continue; }
      }
      if (b.fireLife > 0) {
        b.fireLife -= dt;
        const ft = 1 - b.fireLife / b.fireMaxLife;
        b.fireSprite.scale.setScalar(b.fireBase * (1 + 3 * ft));
        b.fireMat.opacity = Math.max(0, 1.3 * (1 - ft));
        if (b.fireLife <= 0) b.fireSprite.visible = false;
      }
      // 中心核心爆点：快速闪
      if (b.coreLife > 0) {
        b.coreLife -= dt;
        const ct = 1 - b.coreLife / b.coreMaxLife;
        b.coreSprite.scale.setScalar(b.coreBase * (1 + 1.5 * ct));
        b.coreMat.opacity = Math.max(0, 1.6 * (1 - ct));
        if (b.coreLife <= 0) b.coreSprite.visible = false;
      }
      b.life -= dt;
      if (b.life <= 0) { this._recycleBurst(i); continue; }
      const elapsed = b.maxLife - b.life;
      const t = elapsed / b.maxLife;
      const grow = 1 + (cfg.smokeMaxScale - 1) * _smoothstep(0, 0.2, t);
      let op;
      if (elapsed < 0.5) op = elapsed / 0.5;
      else if (elapsed < 3) op = 1.0;
      else if (elapsed < 20) op = 1.0 - (elapsed - 3) / 17 * 0.3;
      else op = 0.7 * (1 - (elapsed - 20) / 8);
      for (let j = 0; j < b.smokeSprites.length; j++) {
        b.smokeSprites[j].scale.setScalar(b.blobScales[j] * grow);
        b.smokeMats[j].opacity = op * 0.5;
      }
    }
  }

  _recycleBurst(i) {
    const b = this._bursts[i];
    if (b.fireSprite) { this.scene.remove(b.fireSprite); b.fireMat.dispose(); }
    if (b.coreSprite) { this.scene.remove(b.coreSprite); b.coreMat.dispose(); }
    for (let j = 0; j < b.smokeSprites.length; j++) {
      this.scene.remove(b.smokeSprites[j]);
      b.smokeMats[j].dispose();
    }
    this._bursts.splice(i, 1);
  }

  _updateTracers(dt) {
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const tr = this._tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) {
        for (let j = 0; j < tr.sprites.length; j++) {
          this.scene.remove(tr.sprites[j]);
          tr.mats[j].dispose();
        }
        this._tracers.splice(i, 1);
        continue;
      }
      const t = 1 - tr.life / tr.maxLife;
      const op = 0.9 * (1 - t);
      for (let j = 0; j < tr.mats.length; j++) tr.mats[j].opacity = op;
    }
  }

  dispose() {
    while (this._bursts.length) this._recycleBurst(0);
    for (const tr of this._tracers) {
      for (let j = 0; j < tr.sprites.length; j++) {
        this.scene.remove(tr.sprites[j]);
        tr.mats[j].dispose();
      }
    }
    this._tracers.length = 0;
    for (const f of this._flashes) { this.scene.remove(f.sprite); f.mat.dispose(); }
    this._flashes.length = 0;
    if (this._smokeTexs) for (const t of this._smokeTexs) t.dispose();
    if (this._fireTex) this._fireTex.dispose();
    if (this._tracerTex) this._tracerTex.dispose();
  }
}