import * as THREE from 'three';

import { BasePage } from './_base.js';
import { Aircraft } from '../../aircraft.js';
import { getFreeMap } from '../../config/freemode/maps.js';
import { PLAYER_AIRCRAFT, getPlayerAircraft } from '../../config/freemode/aircraft.js';
import { ENEMY_AIRCRAFT, getEnemyAircraft } from '../../config/freemode/enemy-aircraft.js';
import { FREE_DIFFICULTIES, FREE_TIME_LIMITS, getFreeDifficulty, getFreeTimeLimit } from '../../config/freemode/difficulty.js';

/**
 * 自由模式 · 机库页（全屏模型展示台 + 悬浮面板）。
 *
 * 整个页面是 3D 模型展示台：渐变黑背景 + 光照，飞机模型居中。
 * 所有 UI 面板悬浮在模型上（半透明 + 模糊）：
 *   左侧：飞机信息（名称/历史/性能参数/游戏属性条）
 *   右侧：配置选项（玩家飞机/对手/时间/难度）+ 开始任务
 *
 * 交互：滚轮缩放，鼠标拖拽旋转视角。不自动旋转。
 */
export class FreeHangarPage extends BasePage {
  get name() { return 'free-hangar'; }

  _build(params) {
    this._mapId = params.mapId || 'barbarossa';
    const map = getFreeMap(this._mapId) || { name: '未知地图' };
    this._state = {
      playerAircraftId: 'bf109',
      enemyCount: 1,
      enemyAircraftId: 'i16',
      timeLimitId: '0',
      difficultyId: 'normal',
    };

    const enemyCards = ENEMY_AIRCRAFT.map((a) =>
      `<div class="fh-pick" data-pick="enemy" data-id="${a.id}">${a.name}</div>`).join('');
    const countBtns = [1, 2].map((n) =>
      `<button class="fh-chip" data-pick="count" data-id="${n}">${n}</button>`).join('');
    const timeBtns = FREE_TIME_LIMITS.map((t) =>
      `<button class="fh-chip" data-pick="time" data-id="${t.id}">${t.label}</button>`).join('');
    const diffBtns = FREE_DIFFICULTIES.map((d) =>
      `<button class="fh-chip" data-pick="diff" data-id="${d.id}">${d.name}</button>`).join('');

    return `
      <div class="fh-stage">
        <canvas class="fh-canvas"></canvas>
        <div class="fh-loading" id="fh-loading">
          <div class="fh-loading-bar"><div class="fh-loading-fill"></div></div>
          <div class="fh-loading-text">加载模型中…</div>
        </div>
        <div class="fh-hint">滚轮缩放 · 拖拽旋转</div>
        <div class="fh-pager">
          <button class="fh-pager-btn" data-action="prev">‹</button>
          <span class="fh-pager-name" id="fh-pager-name"></span>
          <button class="fh-pager-btn" data-action="next">›</button>
        </div>
        <div class="fh-panel fh-panel-info">
          <div class="fh-info-head">
            <span class="fh-info-name" id="fh-ac-name"></span>
            <span class="fh-info-sub" id="fh-ac-sub"></span>
          </div>
          <div class="fh-info-history" id="fh-ac-history"></div>
          <div class="fh-spec-block">
            <div class="fh-spec-title">性能参数</div>
            <div class="fh-spec-list" id="fh-real-spec"></div>
          </div>
          <div class="fh-spec-block">
            <div class="fh-spec-title">游戏属性</div>
            <div class="fh-bars" id="fh-game-bars"></div>
          </div>
        </div>
        <div class="fh-panel fh-panel-config">
          <div class="fh-cfg-title">${map.name}</div>
          <div class="fh-cfg-section">
            <div class="fh-cfg-label">对手数量</div>
            <div class="fh-cfg-row">${countBtns}</div>
          </div>
          <div class="fh-cfg-section">
            <div class="fh-cfg-label">对手机种</div>
            <div class="fh-cfg-grid">${enemyCards}</div>
          </div>
          <div class="fh-cfg-section">
            <div class="fh-cfg-label">时间</div>
            <div class="fh-cfg-row fh-cfg-wrap">${timeBtns}</div>
          </div>
          <div class="fh-cfg-section">
            <div class="fh-cfg-label">难度</div>
            <div class="fh-cfg-row">${diffBtns}</div>
          </div>
          <div class="fh-cfg-preview" id="fh-preview-text"></div>
          <button class="bronze-button primary fh-start-btn" data-action="start">开始任务</button>
        </div>
      </div>
      <button class="fh-back" data-action="back">‹ 返回</button>
    `;
  }

  _onMount() {
    this.$$('.fh-pick').forEach((card) => {
      this._on(card, 'click', () => {
        const pick = card.dataset.pick;
        const id = card.dataset.id;
        if (pick === 'enemy') this._state.enemyAircraftId = id;
        this._refreshUi();
      });
    });
    this.$$('.fh-chip').forEach((btn) => {
      this._on(btn, 'click', () => {
        const pick = btn.dataset.pick;
        const id = btn.dataset.id;
        if (pick === 'count') this._state.enemyCount = parseInt(id, 10);
        else if (pick === 'time') this._state.timeLimitId = id;
        else if (pick === 'diff') this._state.difficultyId = id;
        this._refreshUi();
      });
    });

    this._onClick('[data-action="prev"]', () => this._cyclePlayer(-1));
    this._onClick('[data-action="next"]', () => this._cyclePlayer(1));
    this._onClick('[data-action="start"]', () => this._start());
    this._onClick('[data-action="back"]', () => this.router.go('free-map-select'));

    this._initPreview();
    this._loadPreview(this._state.playerAircraftId);
    this._refreshUi();
  }

  _onUnmount() {
    this._disposePreview();
  }

  _cyclePlayer(dir) {
    const ids = PLAYER_AIRCRAFT.map((a) => a.id);
    let idx = ids.indexOf(this._state.playerAircraftId);
    idx = (idx + dir + ids.length) % ids.length;
    this._state.playerAircraftId = ids[idx];
    this._loadPreview(ids[idx]);
    this._refreshUi();
  }

  // ---------- 3D 展示台 ----------
  _initPreview() {
    const canvas = this.$('.fh-canvas');
    const stage = this.$('.fh-stage');
    this._previewStage = stage;
    const w = stage.clientWidth || innerWidth;
    const h = stage.clientHeight || innerHeight;

    this._previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this._previewRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._previewRenderer.setSize(w, h, false);
    this._previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this._previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._previewRenderer.toneMappingExposure = 1.05;

    this._previewScene = new THREE.Scene();
    this._previewScene.background = this._makeBackgroundTexture();
    this._previewCamera = new THREE.PerspectiveCamera(40, w / h, 0.5, 2000);

    // 环境贴图（增强金属反光质感）
    const pmrem = new THREE.PMREMGenerator(this._previewRenderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.HemisphereLight(0xe8e8e8, 0x2a2a2a, 1.0));
    this._previewEnvMap = pmrem.fromScene(envScene, 0.04).texture;
    this._previewScene.environment = this._previewEnvMap;
    pmrem.dispose();

    // 主光（上方偏前）
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(8, 40, 15);
    this._previewScene.add(key);
    // 补光（左前方，暖色）
    const fill1 = new THREE.DirectionalLight(0xffe8c8, 0.7);
    fill1.position.set(-30, 18, 25);
    this._previewScene.add(fill1);
    // 补光（右后方，冷色）
    const fill2 = new THREE.DirectionalLight(0xb0c8e0, 0.6);
    fill2.position.set(30, 12, -25);
    this._previewScene.add(fill2);
    // 边缘光（正后方，勾边）
    const rim = new THREE.DirectionalLight(0x80a0c0, 1.1);
    rim.position.set(0, 6, -45);
    this._previewScene.add(rim);

    // 上部射灯（展厅氛围）
    const spot1 = new THREE.SpotLight(0xfff0d0, 2.2, 0, Math.PI / 6, 0.6, 0);
    spot1.position.set(-18, 32, 12);
    spot1.target.position.set(-6, 0, 0);
    this._previewScene.add(spot1);
    this._previewScene.add(spot1.target);
    const spot2 = new THREE.SpotLight(0xfff0d0, 2.2, 0, Math.PI / 6, 0.6, 0);
    spot2.position.set(18, 32, 12);
    spot2.target.position.set(6, 0, 0);
    this._previewScene.add(spot2);
    this._previewScene.add(spot2.target);

    // 地面（质感展示台：径向渐变 + 同心圆纹）
    const groundTex = this._makeGroundTexture();
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.55,
      metalness: 0.35,
    });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(200, 64), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -6;
    this._previewScene.add(ground);
    this._previewGround = ground;
    this._previewGroundTex = groundTex;

    // 相机球坐标（玩家可控）
    this._camR = 38;
    this._camTheta = -2.134;
    this._camPhi = 0.262;
    this._previewAircraft = null;
    this._previewRafId = 0;
    this._dragging = false;
    this._dragX = 0;
    this._dragY = 0;

    this._applyCamera();
    this._wirePreviewEvents();

    this._previewLoop = () => {
      this._previewRafId = requestAnimationFrame(this._previewLoop);
      this._previewRenderer.render(this._previewScene, this._previewCamera);
    };
    this._previewLoop();
  }

  _applyCamera() {
    const r = this._camR;
    const t = this._camTheta;
    const p = this._camPhi;
    this._previewCamera.position.x = r * Math.cos(p) * Math.sin(t);
    this._previewCamera.position.y = r * Math.sin(p);
    this._previewCamera.position.z = r * Math.cos(p) * Math.cos(t);
    this._previewCamera.lookAt(0, 0, 0);
  }

  _wirePreviewEvents() {
    const canvas = this.$('.fh-canvas');

    this._onWheel = (e) => {
      e.preventDefault();
      this._camR = THREE.MathUtils.clamp(this._camR + e.deltaY * 0.04, 26, 110);
      this._applyCamera();
    };
    this._on(canvas, 'wheel', this._onWheel);

    this._onMouseDown = (e) => {
      this._dragging = true;
      this._dragX = e.clientX;
      this._dragY = e.clientY;
      canvas.style.cursor = 'grabbing';
    };
    this._on(canvas, 'mousedown', this._onMouseDown);

    this._onMouseMove = (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._dragX;
      const dy = e.clientY - this._dragY;
      this._dragX = e.clientX;
      this._dragY = e.clientY;
      this._camTheta -= dx * 0.006;
      this._camPhi = THREE.MathUtils.clamp(this._camPhi + dy * 0.005, -0.35, 0.85);
      this._applyCamera();
    };
    this._on(window, 'mousemove', this._onMouseMove);

    this._onMouseUp = () => {
      this._dragging = false;
      canvas.style.cursor = 'grab';
    };
    this._on(window, 'mouseup', this._onMouseUp);

    this._onResize = () => {
      const stage = this._previewStage;
      if (!stage) return;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      this._previewRenderer.setSize(w, h, false);
      this._previewCamera.aspect = w / h;
      this._previewCamera.updateProjectionMatrix();
    };
    this._on(window, 'resize', this._onResize);
  }

  async _loadPreview(aircraftId) {
    const pa = getPlayerAircraft(aircraftId);
    if (!pa) return;

    this._disposePreviewAircraft();
    this._setLoading(true);

    const ac = new Aircraft(this._previewScene, this._previewRenderer);
    const pc = pa.playerConfig || {};
    if (pc.autoOrient !== undefined) ac.autoOrient = pc.autoOrient;
    if (pc.yawOffset !== undefined) ac.yawOffset = pc.yawOffset;
    if (pc.userScale !== undefined) ac.userScale = pc.userScale;
    if (pc.centerOffset) ac.centerOffset = pc.centerOffset.slice();
    if (pc.hideGear !== undefined) ac._hideGear = pc.hideGear;
    if (pc.hideGearNodes) ac._hideGearNodes = pc.hideGearNodes.slice();
    if (pc.glassNodes) ac._glassNodes = pc.glassNodes.slice();
    if (pc.propNodes) ac._propNodes = pc.propNodes.slice();
    if (pc.propBlurDisc !== undefined) ac._propBlurDisc = pc.propBlurDisc;
    if (pc.propSpinSpeed !== undefined) ac._propSpinSpeed = pc.propSpinSpeed;
    if (pc.propOpacity !== undefined) ac._propOpacity = pc.propOpacity;
    if (pc.propBlurStrength !== undefined) ac._propBlurStrength = pc.propBlurStrength;
    if (pc.propBlurStyle !== undefined) ac._propBlurStyle = pc.propBlurStyle;
    if (pc.propProcedural !== undefined) ac._propProcedural = pc.propProcedural;
    if (pc.propHubOffset) ac._propHubOffset = pc.propHubOffset.slice();
    if (pc.propRadius !== undefined) ac._propRadius = pc.propRadius;
    if (pc.propBladeCount !== undefined) ac._propBladeCount = pc.propBladeCount;
    if (pc.propBladeChord !== undefined) ac._propBladeChord = pc.propBladeChord;
    if (pc.propBladeTwist !== undefined) ac._propBladeTwist = pc.propBladeTwist;
    if (pc.propCut) ac._propCut = { ...pc.propCut };
    if (pc.cockpitLight) ac._cockpitLight = { ...pc.cockpitLight };

    try {
      await ac.load(pa.model);
      this._previewAircraft = ac;
      const previewOffset = pa.previewOffset;
      if (previewOffset) {
        ac.root.position.x += previewOffset[0] || 0;
        ac.root.position.y += previewOffset[1] || 0;
        ac.root.position.z += previewOffset[2] || 0;
      }
    } catch (e) {
      console.error('[FreeHangar] 模型加载失败:', e);
    } finally {
      this._setLoading(false);
    }
  }

  _setLoading(on) {
    const el = this.$('#fh-loading');
    if (el) el.classList.toggle('visible', on);
  }

  _disposePreviewAircraft() {
    const ac = this._previewAircraft;
    if (!ac) return;
    if (ac.model) {
      ac.model.traverse((o) => {
        if (o.isMesh) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          }
        }
      });
    }
    if (this._previewScene) this._previewScene.remove(ac.root);
    this._previewAircraft = null;
  }

  _disposePreview() {
    if (this._previewRafId) cancelAnimationFrame(this._previewRafId);
    this._previewRafId = 0;
    this._disposePreviewAircraft();
    if (this._previewGround) {
      this._previewGround.geometry?.dispose();
      this._previewGround.material?.dispose();
      this._previewGround = null;
    }
    if (this._previewGroundTex) {
      this._previewGroundTex.dispose();
      this._previewGroundTex = null;
    }
    if (this._previewEnvMap) {
      this._previewEnvMap.dispose();
      this._previewEnvMap = null;
    }
    if (this._previewScene?.background?.isTexture) {
      this._previewScene.background.dispose();
    }
    if (this._previewRenderer) {
      this._previewRenderer.dispose();
      this._previewRenderer = null;
    }
    this._previewScene = null;
    this._previewCamera = null;
    this._previewStage = null;
  }

  _makeBackgroundTexture() {
    const size = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const grad = ctx.createRadialGradient(cx, cy * 0.7, 0, cx, cy, cx * 1.1);
    grad.addColorStop(0.0, '#3e3e3e');
    grad.addColorStop(0.5, '#2a2a2a');
    grad.addColorStop(1.0, '#161616');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _makeGroundTexture() {
    const size = 1024;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
    grad.addColorStop(0.0, '#484848');
    grad.addColorStop(0.3, '#383838');
    grad.addColorStop(0.6, '#282828');
    grad.addColorStop(1.0, '#1c1c1c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(180,180,180,0.06)';
    ctx.lineWidth = 1;
    for (let r = 48; r < cx; r += 48) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  // ---------- UI 更新 ----------
  _refreshUi() {
    const s = this._state;
    this.$$('.fh-pick[data-pick="enemy"]').forEach((c) => {
      c.classList.toggle('selected', c.dataset.id === s.enemyAircraftId);
    });
    this.$$('.fh-chip[data-pick="count"]').forEach((c) => {
      c.classList.toggle('selected', parseInt(c.dataset.id, 10) === s.enemyCount);
    });
    this.$$('.fh-chip[data-pick="time"]').forEach((c) => {
      c.classList.toggle('selected', c.dataset.id === s.timeLimitId);
    });
    this.$$('.fh-chip[data-pick="diff"]').forEach((c) => {
      c.classList.toggle('selected', c.dataset.id === s.difficultyId);
    });

    const pa = getPlayerAircraft(s.playerAircraftId);
    if (pa) {
      const set = (id, txt) => { const el = this.$('#' + id); if (el) el.textContent = txt; };
      set('fh-pager-name', pa.name);
      set('fh-ac-name', pa.name);
      set('fh-ac-sub', `${pa.subtitle} · ${pa.nation}`);
      set('fh-ac-history', pa.history || '');
      const realSpec = this.$('#fh-real-spec');
      if (realSpec && pa.realSpec) {
        realSpec.innerHTML = pa.realSpec.map(([k, v]) =>
          `<div class="fh-spec-row"><span class="fh-sk">${k}</span><span class="fh-sv">${v}</span></div>`).join('');
      }
      const gameBars = this.$('#fh-game-bars');
      if (gameBars && pa.gameBars) {
        gameBars.innerHTML = pa.gameBars.map(([k, v]) => {
          const pct = (v / 5) * 100;
          return `<div class="fh-bar-row"><span class="fh-bar-label">${k}</span><div class="fh-bar-track"><div class="fh-bar-fill" style="width:${pct}%"></div></div></div>`;
        }).join('');
      }
    }

    const ea = getEnemyAircraft(s.enemyAircraftId);
    const tl = getFreeTimeLimit(s.timeLimitId);
    const df = getFreeDifficulty(s.difficultyId);
    const preview = this.$('#fh-preview-text');
    if (preview) {
      preview.innerHTML = `
        <div class="fh-pv-row"><span>对手</span><b>${s.enemyCount} × ${ea ? ea.name : '-'}</b></div>
        <div class="fh-pv-row"><span>时间</span><b>${tl ? tl.label : '-'}</b></div>
        <div class="fh-pv-row"><span>难度</span><b>${df ? df.name : '-'}</b></div>
      `;
    }
  }

  _start() {
    const s = this._state;
    const pa = getPlayerAircraft(s.playerAircraftId);
    const ea = getEnemyAircraft(s.enemyAircraftId);
    const df = getFreeDifficulty(s.difficultyId);
    const tl = getFreeTimeLimit(s.timeLimitId);
    if (!pa || !ea || !df || !tl) return;
    const config = {
      mapId: this._mapId,
      playerAircraft: pa,
      enemyAircraftList: Array.from({ length: s.enemyCount }, () => ({ model: ea.model })),
      difficulty: df,
      timeLimitMinutes: tl.minutes,
    };
    this.shell.ensureAudio();
    this.shell.startFreeMode(config);
  }
}
