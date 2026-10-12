import * as THREE from 'three';

// ---------- 程序生成纹理（一次性，所有粒子共享）----------

/** 枪口闪光：柔和圆形径向光晕（无星芒，避免有型的十字光）*/
function makeFlashTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const cx = s / 2;
  // 纯柔和径向渐变：中心暖白→橙→透明，边缘极度柔和，一闪而过无明确形状
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, s / 2);
  g.addColorStop(0, 'rgba(255,250,230,0.9)');
  g.addColorStop(0.2, 'rgba(255,220,150,0.5)');
  g.addColorStop(0.5, 'rgba(255,140,60,0.16)');
  g.addColorStop(1, 'rgba(255,80,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 烟雾：柔和径向渐变（暖灰，NormalBlending 真实雾感）*/
function makeSmokeTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const cx = s / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, s / 2);
  g.addColorStop(0, 'rgba(210,205,195,0.55)');
  g.addColorStop(0.5, 'rgba(170,165,158,0.22)');
  g.addColorStop(1, 'rgba(130,128,122,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 火花：小圆点亮光 */
function makeSparkTexture() {
  const s = 32;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const cx = s / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, s / 2);
  g.addColorStop(0, 'rgba(255,240,180,1)');
  g.addColorStop(0.5, 'rgba(255,180,60,0.6)');
  g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 玩家枪口火焰：橙红火焰色径向渐变（比通用 flashTex 更橙更烈，覆盖枪口前 20m）*/
function makeMuzzleFlameTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const cx = s / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, s / 2);
  g.addColorStop(0, 'rgba(255,250,230,1.0)');
  g.addColorStop(0.15, 'rgba(255,210,120,0.85)');
  g.addColorStop(0.35, 'rgba(255,140,40,0.5)');
  g.addColorStop(0.6, 'rgba(255,80,20,0.22)');
  g.addColorStop(1, 'rgba(200,40,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 复用常量
const _NEG_Z = new THREE.Vector3(0, 0, -1);
// _spawnAt 热路径 scratch（即用即弃，不传入持久状态；子特效函数内部只用实例 _v/_v2/_q，无别名冲突）
const _spawnOrigin = new THREE.Vector3();
const _spawnDir = new THREE.Vector3();
const _spawnVel = new THREE.Vector3();

/**
 * 武器系统：曳光弹对象池 + 粒子化枪口闪光 + 火花 + 稀薄烟雾。
 * 子弹沿瞄准方向(aircraft.getAimDirection)高速射出，叠加飞机速度。
 * 闪光：星形 Sprite(additive)，0.06s 快速放大+淡出。
 * 火花：3-4 个小 Sprite，锥形飞溅 + 阻尼，0.1s。
 * 烟雾：每 3 发一个，暖灰 Sprite(normal)，膨胀+减速+淡出，0.6-0.9s。
 */
export class Weapons {
  constructor(scene, aircraft, camera) {
    this.scene = scene;
    this.aircraft = aircraft;
    this.camera = camera || null; // 用于计算弹道屏幕投影角度（狭长 Sprite 对齐弹道）
    this.audio = null; // 由 main.js setAudio 注入

    this.fireRate = 0.07;   // 秒/发（单侧）
    this.bulletSpeed = 700; // 单位/秒
    this.life = 2.4;        // 秒
    // 随机伤害范围（模拟击中不同位置的效果：装甲区 vs 要害区）
    this.damageMin = 8;
    this.damageMax = 20;

    this.timer = 0;
    this.alternate = 0;
    this.bullets = [];
    this.pool = [];

    // 子弹共享几何/材质
    this.bulletGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6);
    this.bulletGeo.rotateX(Math.PI / 2); // 默认沿 -Z
    // 曳光弧形：沿长轴(Z)方向给顶点添加 Y 轴弧度位移，模拟真实录像中曳光弹的轻微弯曲
    // 中段偏移最大、两端为 0（拱形），弯曲量约 5% 子弹长度，纯视觉不影响弹道/命中
    {
      const p = this.bulletGeo.attributes.position;
      const halfLen = 1.2;          // 子弹半长（CylinderGeometry 高 2.4 / 2）
      const bendAmp = 0.12;         // 弯曲幅度（相对子弹长 2.4 约 5%）
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        const u = (z / halfLen + 1) * 0.5;        // 映射 0~1
        p.setY(i, p.getY(i) + Math.sin(u * Math.PI) * bendAmp);
      }
      p.needsUpdate = true;
      this.bulletGeo.computeVertexNormals();
    }
    this.bulletMat = new THREE.MeshBasicMaterial({
      color: 0xffd35a, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    // 轰炸机自卫炮塔子弹材质（橙红曳光弹，与战斗机金色曳光弹明显区分）
    this.bulletMatBomber = new THREE.MeshBasicMaterial({
      color: 0xff5028, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    // 玩家 Bf 109 专用曳光弹材质（亮度增强：更亮的金白色 + toneMapped:false 绕过色调映射保持高亮）
    this.bulletMatPlayer = new THREE.MeshBasicMaterial({
      color: 0xfff4c8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    // 玩家机炮专用曳光弹材质（橙红色，与机枪金白色区分）
    this.bulletMatPlayerCannon = new THREE.MeshBasicMaterial({
      color: 0xff5520, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    // 玩家枪口火焰纹理（橙红火焰色，比通用 flashTex 更烈）
    this.muzzleFlameTex = makeMuzzleFlameTexture();

    // 粒子纹理（共享）
    this.flashTex = makeFlashTexture();
    this.smokeTex = makeSmokeTexture();
    this.sparkTex = makeSparkTexture();

    // 粒子列表 + 对象池
    this.flashes = []; this.flashPool = [];
    this.sparks = [];  this.sparkPool = [];
    this.smokes = [];  this.smokePool = [];

    // 临时向量（避免每发 new）
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._camRight = new THREE.Vector3();
    this._camUp = new THREE.Vector3();
    this._smokeCount = 0;

    // 子弹火光段（仅玩家）：曳光弹前 20m 橙红火焰 Sprite，沿弹道狭长分布
    this.flameSegs = []; this.flameSegPool = [];

    // 机炮大子弹（仅玩家，旧接口，保留兼容）：指定枪口索引用更大缩放
    // 默认空 Set = 所有枪口统一尺寸（Bf 109 不受影响）
    // 新路径：setWeaponGroups 按枪口独立配置（FW190 及后续机型），muzzleConfigs 非 null 时优先
    this.heavyMuzzleSet = new Set();
    this.heavyBulletScale = 1.0;

    // 武器组配置（玩家专属，关卡级注入；敌机/友机为 null 走原 alternate 轮换逻辑）
    // 每个元素对应一个枪口索引：{fireRate, timer, bulletSpeed, damageMin, damageMax, bulletScale, bulletColor, explosive}
    this.muzzleConfigs = null;

    // 敌机武器分组（敌机专属；IL-2 前射固定枪 + 后座自卫炮塔独立开火）
    // null 时走原 alternate 轮换；非 null 时每组独立计时 + 开火标志 + 轮换计数
    this.enemyGroups = null;


    // 机炮命中碎片（仅玩家机炮命中时触发）：小黑碎片锥形飞溅 + 翻转
    this.debris = []; this.debrisPool = [];
    this._hitFlashes = []; this._hitFlashPool = [];  // 机炮命中微闪光（spawnHitDebris opts.flash 触发）
    this.debrisGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);

    // 机炮枪管过热（仅 explosive 机炮，机枪不受影响；敌机/友机 muzzleConfigs 为 null 不触发）
    // 平衡 MG 151/20 火力：持续射击 ~3.5s 过热卡壳，冷却 2s 恢复，过热时仍有 MG 17 可用
    this.cannonHeat = 0;            // 当前温度 0-100
    this.cannonOverheated = false;   // 是否过热卡壳（true 时机炮无法发射）
    this.cannonHeatPerShot = 1.2;    // 每发基础升温（°/发）
    this.cannonMaxHeat = 100;        // 过热阈值（达到即卡壳）
    this.cannonRecoveryThreshold = 60; // 恢复阈值（降到此值以下解除卡壳）
    this.cannonCoolRate = 20;        // 冷却速率（°/秒，不发射时持续冷却）
    this.cannonFireDuration = 0;     // 连续射击时间（秒），驱动升温曲线倍率
  }

  /** 设置机炮枪口索引（玩家专属，旧接口保留兼容）*/
  setHeavyMuzzles(indices, scale) {
    this.heavyMuzzleSet = new Set(indices);
    this.heavyBulletScale = scale;  }

  /**
   * 设置武器组配置（玩家专属，关卡级注入）。
   * 将 groups 配置展开为按枪口索引的配置数组 muzzleConfigs。
   * 调用后 update() 走每枪口独立计时路径；敌机/友机不调用此方法，走原 alternate 轮换。
   * 各机型在 playerConfig.weapons.groups 中配置，实现武器与飞机绑定。
   */
  setWeaponGroups(groups) {
    const n = this.aircraft.muzzleHelpers.length;
    this.muzzleConfigs = new Array(n);
    this.weaponGroups = groups;   // 保留组名与配置，供 update() 检测按下/松开触发组级音效
    this._groupFireState = {};    // groupName → wasFiring（本帧前是否在射击，用于检测按下/松开边沿）
    for (const groupName in groups) {
      const g = groups[groupName];
      for (const idx of g.muzzleIndices) {
        if (idx < n) {
          this.muzzleConfigs[idx] = {
            fireRate: g.fireRate,
            timer: 0,
            bulletSpeed: g.bulletSpeed,
            damageMin: g.damageMin,
            damageMax: g.damageMax,
            bulletScale: g.bulletScale,
            bulletColor: g.bulletColor || 0xfff4c8,
            explosive: !!g.explosive,
            // 可选定制（缺省 undefined = 原行为）：曳光弹颜色/形变、枪口烟频率/倍率
            tracerColor: g.tracerColor,
            smokeEvery: g.smokeEvery,
            smokeBoost: g.smokeBoost,
          };
        }
      }
    }
    // 未配置的枪口用默认值（兼容枪口数多于配置的情况）
    for (let i = 0; i < n; i++) {
      if (!this.muzzleConfigs[i]) {
        this.muzzleConfigs[i] = {
          fireRate: this.fireRate, timer: 0,
          bulletSpeed: this.bulletSpeed,
          damageMin: this.damageMin, damageMax: this.damageMax,
          bulletScale: 1.0, bulletColor: 0xffd35a, explosive: false,
        };
      }
    }
  }

  /**
   * 曳光弹定制材质（仅 tracerColor 武器组使用）：按颜色缓存，加色混合 + toneMapped:false 保持高亮。
   * 与共享材质路径完全隔离——未配置 tracerColor 的关卡材质行为不变。
   */
  _getTracerMaterial(color) {
    if (!this._tracerMatCache) this._tracerMatCache = {};
    if (!this._tracerMatCache[color]) {
      this._tracerMatCache[color] = new THREE.MeshBasicMaterial({
        color, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
    }
    return this._tracerMatCache[color];
  }

  /**
   * 设置敌机武器分组（敌机专属，玩家不调用）。
   * 每组独立计时 + 开火标志 + 轮换计数，支持前射固定枪与自卫炮塔独立开火。
   * 调用后 update() 走分组路径；未调用时 enemyGroups=null 走原 alternate 轮换。
   * @param {Array} groups [{name, indices:[], fireRate}]
   */
  setEnemyMuzzleGroups(groups) {
    this.enemyGroups = groups.map((g) => ({
      name: g.name,
      indices: g.indices.slice(),
      fireRate: g.fireRate,
      timer: 0,
      firing: false,
      alt: 0,
    }));
  }

  /** 设置某组本帧是否开火（AI think 中每帧调用，update 前设好）*/
  setGroupFiring(name, firing) {
    if (!this.enemyGroups) return;
    for (const g of this.enemyGroups) {
      if (g.name === name) { g.firing = firing; return; }
    }
  }

  setAudio(a) { this.audio = a; }
  setCamera(c) { this.camera = c; }

  update(dt, firing, firingMg, firingCannon) {
    if (this.enemyGroups) {
      // 敌机分组开火：每组独立计时 + 轮换枪口
      for (const g of this.enemyGroups) {
        if (g.firing) {
          g.timer -= dt;
          if (g.timer <= 0) {
            g.timer = g.fireRate;
            const idx = g.indices[g.alt % g.indices.length];
            g.alt++;
            this._spawnAt(idx);
          }
        } else {
          g.timer = 0;
        }
      }
    } else if (firing || firingMg || firingCannon) {
      if (this.muzzleConfigs) {
        // 玩家：每枪口独立计时，按射击键分组判断
        //   firing(空格)=全部, firingMg(Z)=只机枪(!explosive), firingCannon(X)=只机炮(explosive)
        for (let i = 0; i < this.muzzleConfigs.length; i++) {
          const mc = this.muzzleConfigs[i];
          const groupFire = firing || (firingMg && !mc.explosive) || (firingCannon && mc.explosive);
          if (!groupFire) { mc.timer = 0; continue; }
          mc.timer -= dt;
          if (mc.timer <= 0) {
            mc.timer = mc.fireRate;
            this._spawnAt(i);
          }
        }
      } else {
        // 敌机/友机：原 alternate 轮换逻辑
        this.timer -= dt;
        if (this.timer <= 0) {
          this.timer = this.fireRate;
          this._spawn();
        }
      }
    } else {
      if (this.muzzleConfigs) {
        for (const mc of this.muzzleConfigs) mc.timer = 0;
      } else {
        this.timer = 0;
      }
    }

    // 机炮枪管冷却（玩家专属，敌机分组路径跳过）
    //   机炮开火 = 空格全部 或 X 只机炮（Z 只机枪不算机炮开火）
    if (!this.enemyGroups) {
      const cannonActive = (firing || firingCannon) && !this.cannonOverheated;
      if (cannonActive) {
        this.cannonFireDuration += dt;
      } else {
        this.cannonFireDuration = 0;
        if (this.cannonHeat > 0) {
          this.cannonHeat = Math.max(0, this.cannonHeat - this.cannonCoolRate * dt);
          if (this.cannonOverheated && this.cannonHeat <= this.cannonRecoveryThreshold) {
            this.cannonOverheated = false;
          }
        }
      }
    }

    // 武器组级音效循环管理（玩家专属，按组检测按下/松开）
    //   按住射击键 → startGroupFire（loopBuffer 无缝循环）
    //   松开射击键 → stopGroupFire（停止循环 + 补一次完整播放含回声收尾）
    //   机炮过热时 explosive 组视为停止（触发收尾），机枪组不受影响
    if (this.muzzleConfigs && this.weaponGroups && this.audio && !this.enemyGroups) {
      for (const groupName in this.weaponGroups) {
        const g = this.weaponGroups[groupName];
        const isExplosive = !!g.explosive;
        let firingNow = isExplosive ? (firing || firingCannon) : (firing || firingMg);
        if (isExplosive && this.cannonOverheated) firingNow = false;
        const wasFiring = !!this._groupFireState[groupName];
        if (firingNow && !wasFiring) {
          this.audio.startGroupFire(groupName);
        } else if (!firingNow && wasFiring) {
          this.audio.stopGroupFire(groupName);
        }
        this._groupFireState[groupName] = firingNow;
      }
    }

    // 子弹
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      // 曳光扭曲闪烁（仅 tracerColor 武器组）：尺寸绕基准轻微脉动，模拟肉眼所见的反光/弧光
      if (b.warp) {
        b.mesh.scale.setScalar(b.baseScale * (1 + Math.sin(b.life * b.warpFreq + b.warpPhase) * 0.16));
      }
      if (b.life <= 0) { this._retire(b); this.bullets.splice(i, 1); }
    }

    // 枪口闪光：玩家原版线性淡出；友军/敌机前期保持饱满亮度，后期快速淡出（更醒目的闪击感）
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const k = 1 - f.life / f.maxLife;       // 0->1
      if (f.isPlayer) {
        // 原版：放大速率 1.1 + 线性淡出
        const s = f.scale0 * (1 + k * 0.1);
        f.sprite.scale.set(s, s, 1);
        f.mat.opacity = Math.max(0, 1 - k);
      } else {
        // 放大版：放大速率放缓 + 前 60% 保持高亮度，后 40% 快速淡出
        const s = f.scale0 * (1 + k * 0.6);     // 放大速率放缓（原 1.1 -> 0.6）
        f.sprite.scale.set(s, s, 1);
        f.mat.opacity = k < 0.6 ? 1.0 : Math.max(0, (1 - k) / 0.4);
      }
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        f.sprite.visible = false;
        this.flashPool.push(f);
        this.flashes.splice(i, 1);
      }
    }

    // 火花：飞溅 + 阻尼 + 淡出
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.life -= dt;
      sp.sprite.position.addScaledVector(sp.vel, dt);
      sp.vel.multiplyScalar(1 - dt * 2.5); // 空气阻力
      const k = 1 - sp.life / sp.maxLife;
      const sc = sp.scale0 * (1 - k * 0.5);
      sp.sprite.scale.set(sc, sc, 1);
      sp.mat.opacity = Math.max(0, (1 - k) * 0.5);
      if (sp.life <= 0) {
        this.scene.remove(sp.sprite);
        sp.sprite.visible = false;
        this.sparkPool.push(sp);
        this.sparks.splice(i, 1);
      }
    }

    // 烟雾：膨胀 + 减速 + 淡出（稀薄）—— 含枪口烟雾 + 玩家子弹烟迹颗粒
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const sm = this.smokes[i];
      sm.life -= dt;
      sm.sprite.position.addScaledVector(sm.vel, dt);
      sm.vel.multiplyScalar(1 - dt * 0.8); // 减速
      const k = 1 - sm.life / sm.maxLife;
      // 烟迹颗粒膨胀更慢（1.2 vs 枪口烟雾 2.4），保持细长不扩散
      const expand = sm.isTrail ? 1.2 : 2.4;
      const sc = sm.scale0 * (1 + k * expand);
      sm.sprite.scale.set(sc, sc, 1);
      // 烟迹颗粒（isTrail=true）峰值 0.35（比枪口烟雾 0.18 高，但更透明不抢眼）
      const peak = sm.isTrail ? 0.35 : 0.18;
      sm.mat.opacity = Math.max(0, (1 - k) * peak);
      if (sm.life <= 0) {
        this.scene.remove(sm.sprite);
        sm.sprite.visible = false;
        this.smokePool.push(sm);
        this.smokes.splice(i, 1);
      }
    }

    // 子弹火光段（仅玩家）：曳光弹前 20m 橙红火焰，快速淡出
    for (let i = this.flameSegs.length - 1; i >= 0; i--) {
      const fs = this.flameSegs[i];
      fs.life -= dt;
      const k = 1 - fs.life / fs.maxLife;
      fs.mat.opacity = Math.max(0, (1 - k) * 0.85);
      if (fs.life <= 0) {
        this.scene.remove(fs.sprite);
        fs.sprite.visible = false;
        this.flameSegPool.push(fs);
        this.flameSegs.splice(i, 1);
      }
    }

    // 机炮命中碎片：飞溅 + 重力下坠 + 翻转 + 淡出
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.vel.multiplyScalar(1 - dt * 1.5);   // 空气阻尼
      d.vel.y -= dt * 30;                    // 重力下坠
      d.mesh.rotation.x += d.spin.x * dt;    // 翻转
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      const k = 1 - d.life / d.maxLife;
      d.mat.opacity = Math.max(0, 1 - k);
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        d.mesh.visible = false;
        this.debrisPool.push(d);
        this.debris.splice(i, 1);
      }
    }

    // 命中微闪光：膨胀 + 快速淡出
    for (let i = this._hitFlashes.length - 1; i >= 0; i--) {
      const f = this._hitFlashes[i];
      f.life -= dt;
      const k = 1 - f.life / f.maxLife;
      f.sp.scale.setScalar(f.size * (1 + k * 2.5));
      f.sp.material.opacity = 1 - k;
      if (f.life <= 0) {
        this.scene.remove(f.sp);
        this._hitFlashPool.push(f);
        this._hitFlashes.splice(i, 1);
      }
    }
  }

  _retire(b) {
    this.scene.remove(b.mesh);
    b.mesh.visible = false;
    this.pool.push(b);
  }

  /** 敌机/友机：alternate 轮换选枪口（保留原逻辑，敌机不走武器组配置）*/
  _spawn() {
    const n = this.aircraft.muzzleHelpers.length;
    if (!n) return;
    const idx = this.alternate % n;
    this.alternate++;
    this._spawnAt(idx);
  }

  /**
   * 按枪口索引发射一发子弹（玩家/敌机共用入口）。
   * 玩家：muzzleConfigs[idx] 提供独立射速/初速/伤害/尺寸/爆炸标志
   * 敌机：muzzleConfigs 为 null，用构造函数默认值 + heavyMuzzleSet 旧接口
   */
  _spawnAt(idx) {
    const ac = this.aircraft;
    const muzzleCount = ac.muzzleHelpers.length;
    if (!muzzleCount || idx >= muzzleCount) return;
    const mc = this.muzzleConfigs ? this.muzzleConfigs[idx] : null;
    // 机炮枪管过热检查：explosive 机炮过热时跳过发射（机枪不受影响）
    if (mc && mc.explosive && this.cannonOverheated) return;

    const origin = ac.getMuzzleWorldPosition(idx, _spawnOrigin);
    // 方向：轰炸机自卫炮塔有独立 muzzleDirs（朝后/侧/上），战斗机退化用机头瞄准方向
    const hasMuzzleDir = !!(ac.muzzleDirs && ac.muzzleDirs.length && ac.muzzleDirs[idx]);
    const dir = hasMuzzleDir ? ac.getMuzzleWorldDir(idx, _spawnDir) : ac.getAimDirection(_spawnDir);
    const bulletSpeed = mc ? mc.bulletSpeed : this.bulletSpeed;

    // 子弹
    const b = this.pool.pop() || this._newBullet();
    b.mesh.visible = true;
    b.mesh.position.copy(origin);
    // 子弹尺寸：武器组配置 > heavyMuzzleSet 旧接口 > 默认 1.0
    let scale = mc ? mc.bulletScale : (this.heavyMuzzleSet.has(idx) ? this.heavyBulletScale : 1.0);
    // 子弹朝向用发射方向，而不是机体姿态（自卫炮塔朝后时子弹头应朝后）
    b.mesh.quaternion.setFromUnitVectors(_NEG_Z, dir);
    // 材质：玩家机炮橙红 > 玩家机枪金白 > 轰炸机/攻击机后座红橙曳光 > 战斗机金色
    const isPlayer = ac.isPlayer;
    const isBomber = ac.aiType === 'bomber';
    const isCannon = mc && mc.explosive;
    // 攻击机后座自卫炮塔（muzzleDirs 朝后 z>0）用红橙曳光弹，更醒目
    const isAttackerRear = !isPlayer && ac.aiType === 'attacker' && hasMuzzleDir && dir.z > 0;

    b.mesh.scale.setScalar(scale);
    b.baseScale = scale;   // 曳光扭曲（warp）脉动的基准尺寸
    // 曳光弹定制（仅配置了 tracerColor 的武器组，如第4关 MK 108；缺省走原共享材质路径）：
    // 独立材质 + 每发随机轴向翻滚（弧光朝向随机）+ 飞行中尺寸脉动（反光闪烁）
    b.warp = !!(mc && mc.tracerColor);
    if (b.warp) {
      b.mesh.material = this._getTracerMaterial(mc.tracerColor);
      b.mesh.rotateZ(Math.random() * Math.PI * 2);   // 静态弯曲弧朝向随机化
      b.warpPhase = Math.random() * Math.PI * 2;
      b.warpFreq = 26 + Math.random() * 18;
    } else {
      b.mesh.material = isPlayer
        ? (isCannon ? this.bulletMatPlayerCannon : this.bulletMatPlayer)
        : (isBomber || isAttackerRear ? this.bulletMatBomber : this.bulletMat);
    }
    this.scene.add(b.mesh);
    b.life = this.life;
    b.vel.copy(dir).multiplyScalar(bulletSpeed).add(ac.getVelocity(_spawnVel));
    // 记录枪口索引和爆炸标志（命中检测用于按枪口取伤害 + 触发机炮碎片）
    b.muzzleIdx = idx;
    b.explosive = mc ? mc.explosive : false;
    this.bullets.push(b);

    // 机炮发射升温（仅 explosive 机炮；过热后不会执行到此行，因 _spawnAt 顶部已 return）
    // 升温曲线：连射时间越长升温越快，倍率 1.0→1.3（变化温和，不突兀）
    //   0秒=1.0倍，5秒=1.15倍，10秒+=1.3倍上限
    if (mc && mc.explosive) {
      const heatMult = 1.0 + 0.03 * Math.min(this.cannonFireDuration, 10);
      this.cannonHeat += this.cannonHeatPerShot * heatMult;
      if (this.cannonHeat >= this.cannonMaxHeat) {
        this.cannonHeat = this.cannonMaxHeat;
        this.cannonOverheated = true;   // 过热卡壳，直到冷却到恢复阈值
      }
    }

    // 玩家专属：沿弹道生成火光段（前 20m 橙红）+ 烟迹颗粒（沿弹道分布）
    if (isPlayer) {
      this._spawnFlameSeg(origin, dir);
      this._spawnTrailSmoke(origin, dir);
    }

    // 枪口特效
    this._spawnFlash(origin, isAttackerRear);
    this._spawnSparks(origin, dir);
    // 烟雾：默认每 3 发一个（避免浓烟遮挡视野）；武器组配 smokeEvery 可加密（如第4关 30mm 机炮）
    this._smokeCount++;
    const smokeEvery = (mc && mc.smokeEvery) || 3;
    if (this._smokeCount % smokeEvery === 0) this._spawnSmoke(origin, dir, mc);

    // 音效：玩家武器组音效由 update() 的组级循环管理（startGroupFire/stopGroupFire），
    //       此处不再触发文件音效；敌机/友机（无 muzzleConfigs）走原 fire() 合成音路径
    if (this.audio && !this.muzzleConfigs) {
      this.audio.fire(isPlayer);
    }
  }

  // ---------- 枪口闪光 ----------
  _spawnFlash(pos, isAttackerRear = false) {
    const f = this.flashPool.pop() || this._newFlash();
    f.sprite.visible = true;
    f.sprite.position.copy(pos);
    // 玩家飞机：恢复原版枪口火光（小尺寸/短寿命/线性淡出）；友军/敌机：保留放大版（更醒目）
    const isPlayer = this.aircraft && this.aircraft.isPlayer;
    f.isPlayer = isPlayer;
    if (isAttackerRear) {
      // IL-2 后座自卫炮塔：橙红火焰纹理 + 大尺寸 + 长寿命（醒目辨识自卫火力来源）
      f.mat.map = this.muzzleFlameTex;
      const s = 4.5 + Math.random() * 1.5;     // 4.5-6.0（明显大于普通敌机闪光）
      f.sprite.scale.set(s, s, 1);
      f.scale0 = s;
      f.mat.opacity = 1.0;
      f.life = 0.18; f.maxLife = 0.18;          // 0.18s（持续更久，易捕捉）
    } else if (isPlayer) {
      f.mat.map = this.flashTex;
      const s = 1.3 + Math.random() * 0.5;   // 原版 1.3-1.8
      f.sprite.scale.set(s, s, 1);
      f.scale0 = s;
      f.mat.opacity = 1.0;
      f.life = 0.05; f.maxLife = 0.05;       // 原版 0.05
    } else {
      f.mat.map = this.flashTex;               // 统一用通用暖白闪光纹理
      const s = 3.2 + Math.random() * 1.0;   // 原 1.3-1.8 -> 3.2-4.2（更醒目）
      f.sprite.scale.set(s, s, 1);
      f.scale0 = s;
      f.mat.opacity = 1.0;
      f.life = 0.12; f.maxLife = 0.12;        // 原 0.05 -> 0.12（持续更久，易捕捉）
    }
    this.scene.add(f.sprite);
    this.flashes.push(f);
  }

  _newFlash() {
    const mat = new THREE.SpriteMaterial({
      map: this.flashTex, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.renderOrder = 20;
    return { sprite, mat, life: 0, maxLife: 0, scale0: 1 };
  }

  // ---------- 火花 ----------
  _spawnSparks(pos, dir) {
    const n = 1 + Math.floor(Math.random() * 2); // 1-2 颗细小火星
    // 构造 dir 局部系（让火花以弹道为轴锥形散布）
    this._q.setFromUnitVectors(_NEG_Z, dir);
    for (let i = 0; i < n; i++) {
      const sp = this.sparkPool.pop() || this._newSpark();
      sp.sprite.visible = true;
      sp.sprite.position.copy(pos);
      // 锥形随机方向：以 -Z(机头)为轴，偏角 0.3-0.8 弧度
      const ang = Math.random() * Math.PI * 2;
      const cone = 0.3 + Math.random() * 0.5;
      this._v2.set(
        Math.sin(cone) * Math.cos(ang),
        Math.sin(cone) * Math.sin(ang),
        -Math.cos(cone)
      ).applyQuaternion(this._q);
      const spd = 12 + Math.random() * 18;
      sp.vel.copy(this._v2).multiplyScalar(spd);
      // 继承部分飞机速度（气流裹挟感）
      sp.vel.addScaledVector(this.aircraft.getVelocity(_spawnVel), 0.3);
      const sc = 0.2 + Math.random() * 0.12;
      sp.sprite.scale.set(sc, sc, 1);
      sp.scale0 = sc;
      sp.mat.opacity = 0.5;
      sp.life = 0.05 + Math.random() * 0.04;
      sp.maxLife = sp.life;
      this.scene.add(sp.sprite);
      this.sparks.push(sp);
    }
  }

  _newSpark() {
    const mat = new THREE.SpriteMaterial({
      map: this.sparkTex, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.renderOrder = 19;
    return { sprite, mat, vel: new THREE.Vector3(), life: 0, maxLife: 0, scale0: 1 };
  }

  // ---------- 烟雾（稀薄）----------
  _spawnSmoke(pos, dir, mc = null) {
    const sm = this.smokePool.pop() || this._newSmoke();
    sm.sprite.visible = true;
    sm.isTrail = false; // 枪口烟雾，非烟迹
    sm.mat.color.setRGB(1, 1, 1); // 重置颜色（回收的烟迹颗粒可能带灰色）
    sm.sprite.position.copy(pos);
    // 烟雾向后退（相对弹道反向）+ 轻微上飘（被余温加热上升）
    this._v.copy(dir).multiplyScalar(-8);
    this._v.y += 3;
    sm.vel.copy(this._v);
    // smokeBoost：大口径机炮烟团放大（如第4关 MK 108 30mm；缺省 1 = 原行为）
    const boost = (mc && mc.smokeBoost) || 1;
    const sc = (1.2 + Math.random() * 0.6) * boost;
    sm.sprite.scale.set(sc, sc, 1);
    sm.scale0 = sc;
    sm.mat.opacity = 0.18;
    sm.life = (0.6 + Math.random() * 0.3) * (0.7 + 0.3 * boost);
    sm.maxLife = sm.life;
    this.scene.add(sm.sprite);
    this.smokes.push(sm);
  }

  _newSmoke() {
    const mat = new THREE.SpriteMaterial({
      map: this.smokeTex, blending: THREE.NormalBlending,
      depthWrite: false, transparent: true, opacity: 0,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.renderOrder = 5; // 烟雾在闪光之下
    return { sprite, mat, vel: new THREE.Vector3(), life: 0, maxLife: 0, scale0: 1, isTrail: false };
  }

  // ---------- 子弹火光段（仅玩家）----------
  /**
   * 曳光弹前 20m 橙红火焰效果：
   * - 每发都生成一个短橙红前段（枪口前 5m，0.1s），代表刚出枪口的燃烧前段
   * - 20% 几率额外生成狭长火光（沿弹道 6-9m，0.12s），点缀更明显的火焰拖尾
   */
  _spawnFlameSeg(origin, dir) {
    // 计算弹道在屏幕平面的投影角度，让狭长 Sprite 长边对齐弹道方向
    // Sprite 始终面向相机，material.rotation 在面向相机的平面内旋转（弧度）
    let rot = 0;
    if (this.camera) {
      this.camera.matrixWorld.extractBasis(this._camRight, this._camUp, this._v);
      const sx = dir.dot(this._camRight);
      const sy = dir.dot(this._camUp);
      rot = Math.atan2(sy, sx);
    }

    // 1) 每发都有：短橙红前段（枪口前 5m 中心，小尺寸）
    const fs1 = this.flameSegPool.pop() || this._newFlameSeg();
    fs1.sprite.visible = true;
    fs1.sprite.position.copy(origin).addScaledVector(dir, 5);
    fs1.sprite.scale.set(2.2, 1.2, 1);
    fs1.scale0 = 2.2;
    fs1.mat.opacity = 0.9;
    fs1.mat.rotation = rot;             // 长边对齐弹道屏幕投影
    fs1.life = 0.1; fs1.maxLife = 0.1;
    this.scene.add(fs1.sprite);
    this.flameSegs.push(fs1);

    // 2) 5% 几率（每发独立判断，各炮口不统一）：狭长火光点缀（沿弹道 6-9m）
    //    一端贴近枪口（机头方向），沿弹道向前延伸，长边与子弹轨迹平行
    if (Math.random() < 0.05) {
      const fs2 = this.flameSegPool.pop() || this._newFlameSeg();
      fs2.sprite.visible = true;
      const len = 6 + Math.random() * 3;
      // 中心放在枪口前 len/2，让 Sprite 一端在枪口、另一端沿弹道向前延伸
      fs2.sprite.position.copy(origin).addScaledVector(dir, len / 2);
      fs2.sprite.scale.set(len, 1.0 + Math.random() * 0.3, 1);
      fs2.scale0 = len;
      fs2.mat.opacity = 0.75;
      fs2.mat.rotation = rot;           // 长边对齐弹道屏幕投影（与子弹轨迹平行）
      fs2.life = 0.12; fs2.maxLife = 0.12;
      this.scene.add(fs2.sprite);
      this.flameSegs.push(fs2);
    }
  }

  _newFlameSeg() {
    const mat = new THREE.SpriteMaterial({
      map: this.muzzleFlameTex, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0, toneMapped: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.renderOrder = 18; // 火光在闪光之下、火花之上
    return { sprite, mat, life: 0, maxLife: 0, scale0: 1 };
  }

  // ---------- 子弹烟迹（仅玩家）----------
  /**
   * 沿弹道生成多个烟雾 Sprite 颗粒，模拟子弹擦过空气的凝结尾迹。
   * 从枪口起沿 dir 每 1.5m 一个颗粒，共 12 个（覆盖前 18m），相邻颗粒尺寸重叠连成连续烟带。
   * 小尺寸 + 低扩散 + 快消散 + 灰色调（比枪口烟雾更细更短更灰）。
   */
  _spawnTrailSmoke(origin, dir) {
    const N = 12;
    const step = 1.5;
    for (let i = 0; i < N; i++) {
      const sm = this.smokePool.pop() || this._newSmoke();
      sm.sprite.visible = true;
      sm.isTrail = true;
      const off = i * step + Math.random() * 0.3;
      sm.sprite.position.copy(origin).addScaledVector(dir, off);
      // 颗粒几乎静止（轻微后向 + 上飘，模拟气流残留）
      this._v.copy(dir).multiplyScalar(-2);
      this._v.y += 1.5;
      sm.vel.copy(this._v);
      const sc = 0.5 + Math.random() * 0.3;   // 0.5-0.8，小尺寸（间距 1.5m 仍重叠连成线）
      sm.sprite.scale.set(sc, sc, 1);
      sm.scale0 = sc;
      sm.mat.opacity = 0.35;
      // 烟迹偏灰（比枪口暖灰烟雾更冷灰，模拟高空冷空气凝结）
      sm.mat.color.setRGB(0.62, 0.62, 0.64);
      sm.life = 0.9; sm.maxLife = 0.9;        // 0.9s 快消散（原 1.6s）
      this.scene.add(sm.sprite);
      this.smokes.push(sm);
    }
  }

  _newBullet() {
    const mesh = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    mesh.visible = false;
    return { mesh, vel: new THREE.Vector3(), life: 0 };
  }

  /** 返回所有活动子弹的世界位置数组（供靶标命中查询，保持解耦）*/
  getBulletPositions() {
    return this.bullets.map((b) => b.mesh.position);
  }

  /** 返回内部子弹数组（供命中检测设 life=0 退役，保持解耦）*/
  getBullets() {
    return this.bullets;
  }

  /**
   * 随机伤害值（模拟击中位置不确定性）。
   * @param idx 枪口索引（玩家武器组配置时按枪口取伤害；敌机不传走默认 damageMin/Max）
   */
  getDamage(idx) {
    if (idx !== undefined && this.muzzleConfigs && this.muzzleConfigs[idx]) {
      const mc = this.muzzleConfigs[idx];
      return mc.damageMin + Math.random() * (mc.damageMax - mc.damageMin);
    }
    return this.damageMin + Math.random() * (this.damageMax - this.damageMin);
  }

  // ---------- 机炮枪管过热 API（供 HUD 读取）----------
  /** 机炮温度 0-100 */
  getCannonHeat() { return this.cannonHeat; }
  /** 机炮是否过热卡壳 */
  isCannonOverheated() { return this.cannonOverheated; }

  // ---------- 机炮命中碎片（仅玩家机炮命中时由 GameRuntime 调用）----------
  /**
   * 机炮命中碎片：3-5 个小黑碎片锥形飞溅 + 翻转 + 重力下坠。
   * 模拟 20mm 高爆弹命中装甲表面崩裂飞溅的金属碎片。
   * opts（全部缺省=原行为）：
   *   {count:[min,max] 碎片数区间, scale:[min,max] 碎片缩放（缺省 0.3-0.6）,
   *    life:[min,max] 碎片存活秒（缺省 0.4-0.7）,
   *    flash:0..1 微闪光爆炸概率, flashSize:[min,max] 闪光尺寸（缺省 1.2-2.4）,
   *    flashLife:[min,max] 闪光存活秒（缺省 0.10-0.16）}
   */
  spawnHitDebris(pos, dir, opts) {
    const o = opts || {};
    const n = o.count
      ? o.count[0] + Math.floor(Math.random() * (o.count[1] - o.count[0] + 1))
      : 3 + Math.floor(Math.random() * 3);
    this._q.setFromUnitVectors(_NEG_Z, dir);
    for (let i = 0; i < n; i++) {
      const d = this.debrisPool.pop() || this._newDebris();
      d.mesh.visible = true;
      d.mesh.position.copy(pos);
      // 锥形随机方向：以弹道为轴，偏角 0.5-1.3 弧度
      const ang = Math.random() * Math.PI * 2;
      const cone = 0.5 + Math.random() * 0.8;
      this._v2.set(
        Math.sin(cone) * Math.cos(ang),
        Math.sin(cone) * Math.sin(ang) + 0.3,
        -Math.cos(cone)
      ).applyQuaternion(this._q);
      const spd = 15 + Math.random() * 25;
      d.vel.copy(this._v2).multiplyScalar(spd);
      d.spin.set(
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15
      );
      const sc = o.scale
        ? o.scale[0] + Math.random() * (o.scale[1] - o.scale[0])
        : 0.3 + Math.random() * 0.3;
      d.mesh.scale.set(sc, sc, sc);
      d.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      d.life = o.life
        ? o.life[0] + Math.random() * (o.life[1] - o.life[0])
        : 0.4 + Math.random() * 0.3;
      d.maxLife = d.life;
      d.mat.opacity = 1.0;
      this.scene.add(d.mesh);
      this.debris.push(d);
    }
    // 微闪光爆炸（小爆点）：小概率触发，additive 闪光快速膨胀淡出
    if (o.flash && Math.random() < o.flash) {
      const f = this._hitFlashPool.pop() || {
        sp: new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.flashTex, color: 0xffdd99, transparent: true, opacity: 1.0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })),
        life: 0, maxLife: 0, size: 1,
      };
      f.sp.material.opacity = 1.0;
      f.sp.position.copy(pos);
      f.size = o.flashSize
        ? o.flashSize[0] + Math.random() * (o.flashSize[1] - o.flashSize[0])
        : 1.2 + Math.random() * 1.2;
      f.sp.scale.setScalar(f.size);
      f.sp.renderOrder = 18;
      f.maxLife = o.flashLife
        ? o.flashLife[0] + Math.random() * (o.flashLife[1] - o.flashLife[0])
        : 0.10 + Math.random() * 0.06;
      f.life = f.maxLife;
      this.scene.add(f.sp);
      this._hitFlashes.push(f);
    }
  }

  _newDebris() {
    const colors = [0x2a2a2a, 0x3a3a3a, 0x403830, 0x4a4030, 0x1a1a1a];
    const mat = new THREE.MeshBasicMaterial({
      color: colors[Math.floor(Math.random() * colors.length)],
      transparent: true, opacity: 1.0,
    });
    const mesh = new THREE.Mesh(this.debrisGeo, mat);
    mesh.visible = false;
    return { mesh, mat, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, maxLife: 0 };
  }
}
