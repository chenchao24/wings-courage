import * as THREE from 'three';

/**
 * 浮空靶标系统：环形靶围绕飞机前方分布，子弹命中时爆开 + 计数 + 延时重生。
 * 靶标位置每帧在飞机前方一定半径内重新撒布（保持前方可见、随飞机移动）。
 */
export class Targets {
  constructor(scene, aircraft, weapons, count = 6) {
    this.scene = scene;
    this.aircraft = aircraft;
    this.weapons = weapons;
    this.count = count;

    this.hits = 0;
    this.targets = []; // { mesh, pos:Vector3, alive:bool, respawnAt:number }
    this.particles = []; // 命中爆开粒子

    // 共享几何/材质（加大尺寸、提高不透明度，更显眼）
    this.ringGeo = new THREE.TorusGeometry(5.0, 0.6, 12, 32);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xff5a4d, transparent: true, opacity: 1.0, side: THREE.DoubleSide,
    });
    this.centerMat = new THREE.MeshBasicMaterial({
      color: 0xffe07a, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
    });
    this.centerGeo = new THREE.CircleGeometry(3.8, 24);

    this._spawnAll();
  }

  _spawnAll() {
    for (let i = 0; i < this.count; i++) this._makeTarget(i);
  }

  _makeTarget(seed) {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    const center = new THREE.Mesh(this.centerGeo, this.centerMat);
    group.add(ring, center);
    group.visible = false;
    this.scene.add(group);
    const t = { mesh: group, pos: new THREE.Vector3(), alive: false, respawnAt: 0, seed };
    this._placeRandom(t);
    this.targets.push(t);
  }

  /** 在飞机前方随机方位/距离/高度放置靶标 */
  _placeRandom(t) {
    const ac = this.aircraft.root;
    const fwd = this.aircraft.getForward();
    const angle = (Math.random() - 0.5) * 1.0;          // 前方扇形
    const dist = 800 + Math.random() * 400;             // 800-1200 单位前方（远距离可视）
    const alt = ac.position.y + (Math.random() - 0.5) * 80;
    // 旋转前向得到扇形内方向
    const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    t.pos.copy(ac.position).addScaledVector(dir, dist);
    t.pos.y = Math.max(20, alt);
    t.mesh.position.copy(t.pos);
    // 让靶标面向飞机
    t.mesh.lookAt(ac.position);
    t.alive = true;
    t.mesh.visible = true;
    t.mesh.scale.setScalar(1);
  }

  update(dt) {
    const bullets = this.weapons ? this.weapons.getBulletPositions() : [];

    for (const t of this.targets) {
      if (!t.alive) {
        // 等待重生
        if (performance.now() / 1000 >= t.respawnAt) this._placeRandom(t);
        continue;
      }
      // 靶标离飞机太近（飞过去了）则重新撒到前方
      const dToAc = t.mesh.position.distanceTo(this.aircraft.root.position);
      if (dToAc < 100 || dToAc > 1500) { this._placeRandom(t); continue; }

      // 命中检测：任一子弹进入靶标半径（远距离散布大，半径加大）
      const hitR = 10.0;
      for (let i = 0; i < bullets.length; i++) {
        if (bullets[i].distanceTo(t.mesh.position) < hitR) {
          this._hit(t);
          break;
        }
      }
      // 轻微自转，增加辨识
      if (t.alive) t.mesh.rotateZ(dt * 0.5);
    }

    // 更新粒子
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.multiplyScalar(1 + dt * 3);
      p.mesh.material.opacity = Math.max(0, p.life / p.maxLife) * 0.9;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }
  }

  _hit(t) {
    t.alive = false;
    t.mesh.visible = false;
    t.respawnAt = performance.now() / 1000 + 1.2; // 1.2s 后重生（更快重新出现）
    this.hits++;
    this._spawnParticles(t.mesh.position);
  }

  _spawnParticles(pos) {
    const geo = new THREE.SphereGeometry(0.6, 8, 8);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xffb84d : 0xff5a4d, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos);
      this.scene.add(m);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 40,
      );
      this.particles.push({ mesh: m, vel: v, life: 0.6, maxLife: 0.6 });
    }
  }

  /** 返回所有存活靶标的世界位置数组（供雷达显示，保持解耦）*/
  getTargetPositions() {
    const out = [];
    for (const t of this.targets) {
      if (t.alive) out.push(t.mesh.position);
    }
    return out;
  }
}
