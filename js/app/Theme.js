/**
 * 《勇气之翼》主题样式表（二战空战主题）。
 * AppShell 启动时注入到 <style id="theme-css">。
 *
 * 设计语言：黄铜金 + 羊皮纸米白 + 深炭黑底，军事感字体，
 * 保留原测试场的战术蓝/敌机红用于 HUD 数据色。
 */
export const THEME_CSS = `
:root {
  /* 二战空战主题色板 */
  --bg-deep: #0a0d10;
  --bg-panel: rgba(18, 24, 28, 0.85);
  --bg-panel-strong: rgba(12, 16, 20, 0.95);
  --line-soft: rgba(180, 145, 80, 0.25);
  --line-strong: rgba(220, 180, 110, 0.55);

  --accent-gold: #d4a85a;
  --accent-amber: #ffb84d;
  --accent-cyan: #6fd0ff;
  --accent-red: #ff5a4d;
  --accent-green: #6fe0a0;

  --text-primary: #e8dcc0;
  --text-secondary: #b8a888;
  --text-muted: #7a7060;

  --font-display: 'STKaiti', 'KaiTi', '楷体', 'Cinzel', serif;
  --font-body: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
  --font-mono: 'Consolas', 'Source Code Pro', monospace;
  /* 现代数字字体：几何无衬线，DIN 风，用于 HUD 读数/任务面板 */
  --font-hud: 'Bahnschrift', 'DIN Alternate', 'Oswald', 'Segoe UI', 'Microsoft YaHei', sans-serif;

  /* 文字光晕（去面板化后保证可读性的核心手段）：黑色多层光晕 */
  --ts-halo: 0 0 3px rgba(0,0,0,0.95), 0 0 7px rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,1);
  --ts-halo-strong: 0 0 4px rgba(0,0,0,1), 0 0 10px rgba(0,0,0,0.8), 0 2px 5px rgba(0,0,0,1);
  /* 白色数据 + 金色发光 */
  --ts-gold: 0 0 3px rgba(0,0,0,0.95), 0 0 7px rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,1), 0 0 14px rgba(212,168,90,0.45);

  /* 旧测试场 HUD 变量（保留兼容） */
  --panel: rgba(12, 18, 22, 0.78);
  --panel-line: rgba(120, 180, 210, 0.25);
  --accent: #6fd0ff;
  --warn: #ffb84d;
  --fire: #ff5a4d;
  --text: #d7e6ee;
  --muted: #8aa0ad;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: 100%; height: 100%; overflow: hidden;
  background: var(--bg-deep); color: var(--text-primary);
  font-family: var(--font-body);
  user-select: none;
}
#scene, #indicator { display: block; width: 100vw; height: 100vh; position: fixed; inset: 0; }
#indicator { z-index: 12; pointer-events: none; }
#app { position: fixed; inset: 0; z-index: 100; pointer-events: none; }
#app > * { pointer-events: auto; }

/* ---------- 通用组件 ---------- */
.bronze-frame {
  border: 1px solid var(--line-strong);
  background: linear-gradient(135deg, var(--bg-panel), var(--bg-panel-strong));
  box-shadow: inset 0 1px 0 rgba(220, 180, 110, 0.15), 0 4px 20px rgba(0, 0, 0, 0.6);
  border-radius: 6px;
}
.bronze-button {
  background: linear-gradient(180deg, #3a3024, #1f1a14);
  border: 1px solid var(--accent-gold);
  color: var(--accent-gold);
  font-family: var(--font-body);
  font-size: 14px;
  letter-spacing: 2px;
  padding: 10px 22px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  text-transform: uppercase;
}
.bronze-button:hover {
  background: linear-gradient(180deg, #4a3e2e, #2a2218);
  box-shadow: 0 0 16px rgba(212, 168, 90, 0.4);
  color: #f0d090;
}
.bronze-button:active { transform: translateY(1px); }
.bronze-button.primary {
  background: linear-gradient(180deg, #6a5028, #3a2c18);
  color: #fff0d0;
}
.bronze-button:disabled, .bronze-button.locked {
  opacity: 0.4; cursor: not-allowed; filter: grayscale(0.6);
}
.bronze-button.locked:hover { box-shadow: none; }

/* ---------- 页面通用 ---------- */
/* 防泄漏设计：.page 自身不参与 opacity 过渡，.page-bg 始终满 opacity
   不透明地盖住底层 #scene 3D 画面；只有页面内容做淡入。
   这样切换瞬间新页背景立即可见，旧页未移除也不会让 #scene 透出。*/
.page {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  pointer-events: auto;
}
.page > *:not(.page-bg) {
  opacity: 0;
  transition: opacity 0.35s ease;
}
.page.show > *:not(.page-bg) { opacity: 1; }
/* 切换中旧页屏蔽交互，避免淡出期间仍可点击 */
.page.leaving { pointer-events: none; }
.page-bg {
  position: absolute; inset: 0; z-index: -1;
  background: radial-gradient(circle at 50% 35%, #1a2230 0%, #0a0d10 70%);
}
.page-bg.with-image { background-size: cover; background-position: center; }
.page-bg.with-image::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(8,10,14,0.25) 0%, rgba(8,10,14,0.55) 100%);
}
.page-header {
  text-align: center; padding: 40px 20px 16px;
}
.page-title {
  font-family: var(--font-display);
  font-size: 38px; letter-spacing: 8px;
  color: var(--accent-gold);
  text-shadow: 0 2px 12px rgba(212, 168, 90, 0.4);
}
.page-sub {
  font-size: 13px; color: var(--text-muted);
  letter-spacing: 4px; margin-top: 8px;
}
.page-footer {
  text-align: center; padding: 20px; margin-top: auto;
}
/* 页面右上角返回按钮（选关/设置页用，腾出底部空间）*/
.page-back-btn {
  position: absolute; top: 24px; right: 28px; z-index: 10;
}

/* ---------- 封面页 ---------- */
.page-cover { align-items: center; justify-content: flex-end; padding-bottom: 140px; }
.cover-title {
  font-family: var(--font-display);
  font-size: 72px; letter-spacing: 16px;
  color: var(--accent-gold);
  text-shadow: 0 4px 24px rgba(212, 168, 90, 0.5), 0 0 60px rgba(212, 168, 90, 0.2);
  margin-bottom: 12px;
}
.cover-subtitle {
  font-size: 16px; color: var(--text-secondary);
  letter-spacing: 8px; margin-bottom: 60px;
  font-family: var(--font-display);
}
.cover-start {
  font-size: 16px; padding: 14px 48px;
  animation: pulse 2.4s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 12px rgba(212, 168, 90, 0.3); }
  50% { box-shadow: 0 0 28px rgba(212, 168, 90, 0.6); }
}
.cover-hint {
  position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
  font-family: var(--font-display); font-size: 22px; font-weight: 700;
  color: var(--accent-gold); letter-spacing: 8px;
  text-shadow: 0 0 18px rgba(212,168,90,0.6), 0 2px 8px rgba(0,0,0,0.8);
  animation: cover-hint-blink 1.6s ease-in-out infinite;
  z-index: 5; pointer-events: none; white-space: nowrap;
}
@keyframes cover-hint-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}
.cover-version {
  position: absolute; right: 18px; bottom: 14px;
  font-size: 11px; color: var(--text-muted); letter-spacing: 1px;
  font-family: var(--font-body); opacity: 0.7;
  pointer-events: none; z-index: 5;
}

/* ---------- 主菜单 ---------- */
.page-menu { align-items: center; justify-content: flex-end; padding-bottom: 80px; }
.page-menu .page-footer { margin-top: 0; }
.menu-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  width: 560px; max-width: 90vw;
  margin-bottom: 32px;
}
.menu-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px;
  background: linear-gradient(135deg, rgba(58, 48, 36, 0.65), rgba(31, 26, 20, 0.45));
  border: 1px solid var(--line-soft);
  border-left: 3px solid var(--accent-gold);
  border-radius: 4px;
  cursor: pointer; transition: all 0.2s;
  color: var(--text-primary);
  font-size: 17px; letter-spacing: 4px;
  font-family: var(--font-display);
  backdrop-filter: blur(4px);
}
.menu-item:hover {
  background: linear-gradient(135deg, rgba(88, 72, 50, 0.75), rgba(50, 40, 28, 0.55));
  border-left-color: var(--accent-amber);
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(212, 168, 90, 0.25);
}
.menu-item.locked {
  opacity: 0.45; cursor: not-allowed; filter: grayscale(0.7);
  border-left-color: var(--text-muted);
}
.menu-item.locked:hover { transform: none; box-shadow: none; }
.menu-item .mi-label { display: flex; align-items: center; gap: 12px; }
.menu-item .mi-lock { font-size: 11px; color: var(--text-muted); letter-spacing: 1px; }
.menu-item .mi-icon { font-size: 20px; color: var(--accent-gold); }

/* ---------- 选关页（3x3 卡片） ---------- */
.level-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  padding: 20px 48px;
  max-width: 1100px; margin: 0 auto;
  width: 100%;
}
.level-card {
  position: relative;
  padding: 0;
  min-height: 180px;
  cursor: pointer; transition: all 0.25s;
  display: flex; flex-direction: column; justify-content: space-between;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 4px;
}
.level-card::before {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(10, 8, 6, 0.55) 0%, rgba(8, 6, 4, 0.92) 100%);
  z-index: 0;
}
.level-card .card-banner {
  position: absolute; inset: 0; z-index: -1;
  background-size: cover; background-position: center;
}
.level-card .card-body { position: relative; z-index: 1; padding: 18px 18px 0; }
.level-card .card-status { position: relative; z-index: 1; }
.level-card.unlocked:hover {
  transform: translateY(-3px);
  border-color: var(--accent-amber);
  box-shadow: 0 8px 28px rgba(212, 168, 90, 0.3), inset 0 0 20px rgba(212, 168, 90, 0.08);
}
.level-card.locked {
  cursor: not-allowed; opacity: 0.5; filter: grayscale(0.8);
}
.level-card .card-num {
  font-family: var(--font-display);
  font-size: 28px; color: var(--accent-gold);
  letter-spacing: 2px;
  text-shadow: 0 2px 6px rgba(0,0,0,0.9);
}
.level-card .card-name {
  font-family: var(--font-display);
  font-size: 20px; color: #fff8e0;
  letter-spacing: 3px; margin-top: 6px;
  text-shadow: 0 2px 6px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.8);
}
.level-card .card-meta {
  font-size: 12px; color: var(--text-secondary);
  letter-spacing: 1px; margin-top: 4px;
  text-shadow: 0 1px 3px rgba(0,0,0,0.9);
}
.level-card .card-status {
  font-size: 12px; letter-spacing: 2px;
  margin: 0; padding: 10px 18px 14px;
  border-top: 1px solid var(--line-soft);
  color: var(--accent-amber);
  text-shadow: 0 1px 3px rgba(0,0,0,0.9);
}
.level-card.locked .card-status { color: var(--text-muted); }
.level-card.locked .card-num,
.level-card.locked .card-name { color: var(--text-muted); }
.level-card .card-lock-icon {
  position: absolute; top: 14px; right: 14px;
  font-size: 16px; color: var(--text-muted);
  text-shadow: 0 1px 3px rgba(0,0,0,0.9);
}
.level-card .card-diff {
  display: block;
  font-size: 14px;
  letter-spacing: 2px;
  margin-top: 4px;
  color: var(--accent-amber);
  text-shadow: 0 1px 4px rgba(0,0,0,0.95);
}
.level-card .card-beginner {
  display: inline-block;
  font-size: 11px;
  letter-spacing: 1px;
  margin-left: 8px;
  padding: 2px 7px;
  border: 1px solid var(--accent-amber);
  border-radius: 2px;
  color: var(--accent-amber);
  vertical-align: middle;
  font-family: sans-serif;
  background: rgba(0,0,0,0.5);
}
.level-card.locked .card-diff { color: var(--text-muted); }
.level-card.locked .card-beginner { color: var(--text-muted); border-color: var(--text-muted); }
@media (max-width: 720px) {
  .level-grid { grid-template-columns: repeat(2, 1fr); padding: 16px; gap: 12px; }
  .page-title { font-size: 28px; letter-spacing: 4px; }
  .cover-title { font-size: 48px; letter-spacing: 8px; }
  .menu-list { width: 100%; padding: 0 16px; gap: 12px; }
  .menu-item { padding: 14px 16px; font-size: 14px; letter-spacing: 2px; }
  .page-menu { padding-bottom: 60px; }
  .settings-list { padding: 0 12px; }
  .slider-header { flex-direction: column; align-items: flex-start; gap: 8px; }
  .slider-controls { width: 100%; }
  .volume-slider { width: 100%; flex: 1; }
  /* 小屏设置页回退为单列，避免左右挤压 */
  .settings-cols { flex-direction: column; gap: 12px; max-width: 520px; }
}

/* ---------- 设置页 ---------- */
/* 设置页左右双列布局：左开关右音量，缩短页面高度 */
.settings-cols {
  display: flex; gap: 24px; justify-content: center;
  max-width: 920px; margin: 16px auto; width: 100%;
  padding: 0 24px;
}
.settings-cols .settings-list {
  max-width: none; margin: 0; padding: 0; flex: 1; min-width: 0;
}
.settings-list {
  max-width: 520px; margin: 24px auto; width: 100%;
  padding: 0 24px;
  display: flex; flex-direction: column; gap: 12px;
}
/* 设置页紧凑：缩小行内边距与标题区，让返回按钮在小屏可见 */
.page-settings .page-header { padding: 24px 20px 10px; }
.page-settings .settings-cols { margin: 12px auto; }
.setting-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px;
}
.setting-row .sr-text { display: flex; flex-direction: column; gap: 4px; }
.setting-row .sr-title {
  font-size: 15px; color: var(--text-primary); letter-spacing: 2px;
}
.setting-row .sr-desc {
  font-size: 11px; color: var(--text-muted); letter-spacing: 1px;
}
.setting-row .sr-desc.warn { color: var(--accent-amber); }

/* 设置页分割线 */
.settings-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--line-soft) 20%, var(--line-soft) 80%, transparent);
  margin: 8px 0;
}

/* 音量滑块行 */
.slider-row { flex-direction: column; gap: 10px; }
.slider-header {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%;
}
.slider-controls {
  display: flex; align-items: center; gap: 12px;
}
.slider-value {
  font-family: var(--font-display);
  font-size: 14px; color: var(--accent-gold);
  min-width: 28px; text-align: right;
  text-shadow: var(--ts-halo);
}

/* 自定义 range 滑块 */
.volume-slider {
  -webkit-appearance: none; appearance: none;
  width: 180px; height: 4px;
  background: linear-gradient(90deg, var(--accent-gold) 0%, var(--accent-gold) var(--fill, 50%), #2a2418 var(--fill, 50%), #2a2418 100%);
  border-radius: 2px; outline: none; cursor: pointer;
}
.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--accent-gold);
  border: 2px solid #1a1610;
  box-shadow: 0 0 8px rgba(212, 168, 90, 0.6);
  cursor: pointer; transition: transform 0.15s;
}
.volume-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
.volume-slider::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--accent-gold); border: 2px solid #1a1610;
  box-shadow: 0 0 8px rgba(212, 168, 90, 0.6); cursor: pointer;
}
.volume-slider::-moz-range-track {
  height: 4px; background: #2a2418; border-radius: 2px;
}

/* 试听按钮 */
.preview-btn {
  padding: 4px 14px;
  font-size: 12px; letter-spacing: 2px;
  font-family: var(--font-display);
  color: var(--text-muted);
  background: rgba(42, 36, 24, 0.6);
  border: 1px solid var(--line-soft);
  border-radius: 3px; cursor: pointer;
  transition: all 0.2s;
}
.preview-btn:hover {
  color: var(--accent-gold);
  border-color: var(--accent-gold);
  background: rgba(88, 72, 50, 0.5);
}
.preview-btn.active {
  color: #1a1610;
  background: var(--accent-gold);
  border-color: var(--accent-gold);
  box-shadow: 0 0 10px rgba(212, 168, 90, 0.5);
}

/* Toggle 开关 */
.toggle {
  position: relative; width: 48px; height: 24px;
  background: #2a2418; border: 1px solid var(--line-soft);
  border-radius: 12px; cursor: pointer; transition: all 0.2s;
  flex-shrink: 0;
}
.toggle::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--text-muted); transition: all 0.2s;
}
.toggle.on {
  background: linear-gradient(90deg, #6a5028, #8a6838);
  border-color: var(--accent-gold);
}
.toggle.on::after {
  left: 26px; background: var(--accent-gold);
  box-shadow: 0 0 8px rgba(212, 168, 90, 0.6);
}

/* ---------- 机库占位页 ---------- */
.page-hangar { align-items: center; justify-content: center; text-align: center; }
.hangar-locked {
  font-family: var(--font-display);
  font-size: 24px; color: var(--text-muted);
  letter-spacing: 6px; margin-bottom: 12px;
}
.hangar-hint { font-size: 13px; color: var(--text-muted); letter-spacing: 2px; }

/* ---------- 简报页 ---------- */
.page-briefing { align-items: center; justify-content: center; }
.briefing-box {
  max-width: 640px; width: 90%; padding: 32px 36px;
}
.briefing-box h2 {
  font-family: var(--font-display); font-size: 26px;
  color: var(--accent-gold); letter-spacing: 6px; margin-bottom: 4px;
}
.briefing-box .b-sub { font-size: 12px; color: var(--text-muted); letter-spacing: 3px; margin-bottom: 20px; }
.briefing-box .b-body {
  font-size: 14px; line-height: 1.9; color: var(--text-secondary);
  margin-bottom: 24px; text-indent: 2em;
}
.briefing-box .b-mission {
  padding: 14px 18px; margin-bottom: 24px;
  border-left: 3px solid var(--accent-amber);
  background: rgba(255, 184, 77, 0.06);
  font-size: 13px; color: var(--text-primary); letter-spacing: 1px;
}
.briefing-actions { display: flex; gap: 14px; justify-content: center; }

/* ---------- 结算页 ---------- */
.page-result { align-items: center; justify-content: center; }
.result-banner { text-align: center; margin-bottom: 28px; }
.result-banner .rb-stamp {
  font-family: var(--font-display); font-size: 16px;
  letter-spacing: 8px; color: var(--accent-amber); margin-bottom: 8px;
}
.result-banner .rb-title {
  font-family: var(--font-display); font-size: 52px;
  letter-spacing: 12px; color: var(--accent-gold);
  text-shadow: 0 2px 20px rgba(212, 168, 90, 0.5);
}
.result-banner.fail .rb-stamp,
.result-banner.fail .rb-title { color: var(--accent-red); text-shadow: 0 2px 20px rgba(255, 90, 77, 0.5); }
.result-banner .rb-subtitle { font-size: 12px; color: var(--text-muted); letter-spacing: 3px; margin-top: 8px; }
.result-stats {
  max-width: 560px; width: 90%; padding: 24px 28px; margin-bottom: 28px;
}
.result-stats h3 {
  font-family: var(--font-display); font-size: 16px; letter-spacing: 4px;
  color: var(--accent-gold); margin-bottom: 16px; text-align: center;
}
.rs-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
.rs-item {
  padding: 14px 16px; text-align: center;
  background: rgba(0,0,0,0.25); border: 1px solid var(--line-soft); border-radius: 4px;
}
.rs-item .rs-label { font-size: 11px; color: var(--text-muted); letter-spacing: 2px; margin-bottom: 6px; }
.rs-item .rs-value { font-family: var(--font-mono); font-size: 22px; color: var(--accent-cyan); }
.result-actions { display: flex; gap: 14px; }

/* ====================================================================
   HUD 样式（现代文字风 v2 · 去面板化 · 白色文字+黑色光晕保可读性）
   设计：无边框面板，白色文字为主，金色仅做发光，全文字黑色多层光晕
   ==================================================================== */
#hud { position: fixed; inset: 0; z-index: 10; pointer-events: none; }

/* ---------- 左上：任务面板（网游风，透明无框，对号列表） ---------- */
#mission-panel {
  position: fixed; top: 20px; left: 24px; z-index: 11; pointer-events: none;
  font-family: var(--font-hud);
}
.mp-label {
  font-size: 11px; letter-spacing: 5px; color: rgba(255,255,255,0.55);
  margin-bottom: 5px; text-shadow: var(--ts-halo);
}
.mp-title {
  font-size: 14px; letter-spacing: 2px; color: rgba(255,255,255,0.9);
  margin-bottom: 12px; text-shadow: var(--ts-halo);
}
.mp-progress { display: flex; align-items: baseline; gap: 3px; margin-bottom: 10px; }
.mp-count {
  font-size: 40px; font-weight: 700; line-height: 0.9; color: #fff;
  font-variant-numeric: tabular-nums;
  text-shadow: var(--ts-gold);
}
.mp-slash { font-size: 26px; color: rgba(255,255,255,0.4); margin: 0 3px; text-shadow: var(--ts-halo); }
.mp-total {
  font-size: 26px; color: rgba(255,255,255,0.5);
  font-variant-numeric: tabular-nums; text-shadow: var(--ts-halo);
}
.mp-waves { display: flex; gap: 7px; }
.mw {
  font-size: 13px; width: 20px; height: 20px; line-height: 20px; text-align: center;
  border-radius: 50%; transition: all 0.3s; font-weight: 700;
}
.mw.done { color: #6fe0a0; text-shadow: var(--ts-halo), 0 0 8px rgba(111,224,160,0.7); }
.mw.active { color: #ffb84d; text-shadow: var(--ts-halo), 0 0 12px rgba(255,184,77,0.8);
  animation: mwPulse 1.2s ease-in-out infinite; }
.mw.pending { color: rgba(255,255,255,0.3); text-shadow: var(--ts-halo); }
@keyframes mwPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }

/* ---------- 准星 ---------- */
#crosshair {
  position: absolute; top: 50%; left: 50%; width: 64px; height: 64px;
  transform: translate(-50%, -50%); opacity: .9; pointer-events: none;
  will-change: left, top;
}
#crosshair .ring {
  position: absolute; inset: 0; border: 1.5px solid rgba(120,210,255,.75);
  border-radius: 50%; box-shadow: 0 0 8px rgba(120,210,255,.45), inset 0 0 6px rgba(120,210,255,.2);
}
#crosshair::before, #crosshair::after {
  content: ""; position: absolute; background: rgba(120,210,255,.75);
  box-shadow: 0 0 4px rgba(120,210,255,.5);
}
#crosshair::before { left: 50%; top: 18%; width: 2px; height: 24%; transform: translateX(-50%); }
#crosshair::after  { top: 50%; left: 18%; height: 2px; width: 24%; transform: translateY(-50%); }
#crosshair .dot { position: absolute; top: 50%; left: 50%; width: 4px; height: 4px; border-radius: 50%;
  background: var(--fire); transform: translate(-50%,-50%); box-shadow: 0 0 6px rgba(255,90,77,.8); }
#crosshair .ring::before, #crosshair .ring::after {
  content: ""; position: absolute; background: rgba(120,210,255,.75);
  box-shadow: 0 0 4px rgba(120,210,255,.5);
}
#crosshair .ring::before { left: 50%; bottom: 18%; width: 2px; height: 24%; transform: translateX(-50%); }
#crosshair .ring::after  { left: 58%; top: 50%; height: 2px; width: 24%; transform: translateY(-50%); }

/* ---------- 警告（红色发光文字 + 黑色光晕保可读性） ---------- */
#hud-stall, #hud-crash {
  position: absolute; left: 50%; transform: translateX(-50%);
  color: #ff5a4d; font-weight: 800; letter-spacing: 6px;
  font-family: var(--font-hud);
  text-shadow: var(--ts-halo-strong), 0 0 12px rgba(255,90,77,.9), 0 0 24px rgba(255,90,77,.4);
  opacity: 0; transition: opacity .15s; pointer-events: none;
}
#hud-stall { top: 20%; font-size: 24px; }
#hud-crash { top: 34%; font-size: 30px; letter-spacing: 7px; }
#hud-altitude {
  top: 50%; font-size: 28px; letter-spacing: 8px;
  transform: translate(-50%, -50%);
}
#hud-stall.show { opacity: 1; animation: stallBlink 0.5s steps(2) infinite; }
#hud-crash.show { opacity: 1; animation: stallBlink 0.4s steps(2) infinite; }
#hud-altitude.show { opacity: 1; animation: stallBlink 0.45s steps(2) infinite; }
@keyframes stallBlink { 50% { opacity: 0.35; } }

/* ---------- 交战高度规则警告（仅 combatAlt 关卡，如第4关柏林） ---------- */
#hud-alt-fence {
  position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%);
  color: #ffb84d; font-weight: 800; font-size: 26px; letter-spacing: 6px;
  font-family: var(--font-hud);
  text-shadow: var(--ts-halo-strong), 0 0 12px rgba(255,184,77,.9), 0 0 24px rgba(255,184,77,.4);
  opacity: 0; transition: opacity .15s; pointer-events: none;
  font-variant-numeric: tabular-nums;
}
#hud-alt-fence.show { opacity: 1; animation: stallBlink 0.45s steps(2) infinite; }
#hud-alt-fence[data-level="countdown"] {
  color: #ff5a4d; font-size: 30px;
  text-shadow: var(--ts-halo-strong), 0 0 12px rgba(255,90,77,.9), 0 0 24px rgba(255,90,77,.4);
}
#hud-alt-fence[data-level="ceiling"] { font-size: 22px; }

/* ---------- 被咬尾警告（顶端中央：红框白字 + 框下中文小字，持续闪动） ---------- */
#hud-tail-warn {
  position: absolute; left: 50%; top: 72px; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  font-family: var(--font-hud);
  opacity: 0; transition: opacity .15s; pointer-events: none;
}
#hud-tail-warn .tw-box {
  background: #ff5a4d; color: #fff; font-weight: 800;
  font-size: 13px; letter-spacing: 3px;
  padding: 4px 11px; border-radius: 5px;
  text-shadow: 0 0.5px 1px rgba(0,0,0,.5);
  box-shadow: 0 0 7px rgba(255,90,77,.85), 0 0 14px rgba(255,90,77,.4), 0 1px 4px rgba(0,0,0,.6);
}
#hud-tail-warn .tw-sub {
  color: #fff; font-size: 11px; letter-spacing: 1.5px; font-weight: 600;
  text-shadow: var(--ts-halo-strong), 0 0 8px rgba(0,0,0,.85);
}
#hud-tail-warn.show { opacity: 1; animation: stallBlink 0.45s steps(2) infinite; }

/* ---------- 脱离作战空域：二选一弹窗（CombatAltRule） ---------- */
#alt-choice-overlay { position: fixed; inset: 0; z-index: 150; }
#alt-choice-overlay .ac-mask {
  position: absolute; inset: 0;
  background: radial-gradient(circle at 50% 40%, rgba(26,34,48,0.88), rgba(10,13,16,0.94) 70%);
}
#alt-choice-overlay .ac-card {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  padding: 36px 48px; text-align: center;
  border: 1px solid var(--line-soft); border-radius: 8px;
  background: rgba(12, 16, 20, 0.92);
}
#alt-choice-overlay .ac-stamp {
  font-family: var(--font-display); font-size: 15px; letter-spacing: 5px;
  color: #ff5a4d; text-shadow: 0 0 12px rgba(255,90,77,.6);
}
#alt-choice-overlay .ac-title { font-family: var(--font-display); font-size: 26px; letter-spacing: 4px; color: var(--accent-gold); }
#alt-choice-overlay .ac-text { font-size: 13px; color: var(--text-muted); letter-spacing: 1px; max-width: 46ch; line-height: 1.8; }
#alt-choice-overlay .ac-actions { display: flex; gap: 16px; margin-top: 10px; }

/* ---------- 重置高度：黑屏读条遮罩（样式对齐 #loader） ---------- */
#alt-reset-mask {
  position: fixed; inset: 0; z-index: 200;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 40%, #1a2230, #0a0d10 70%);
  transition: opacity .6s ease;
}
#alt-reset-mask.hide { opacity: 0; pointer-events: none; }
#alt-reset-mask .title { font-family: var(--font-display); font-size: 22px; letter-spacing: 6px; color: var(--accent-gold); margin-bottom: 18px; }
#alt-reset-mask .sub { font-size: 13px; color: var(--text-muted); margin-bottom: 24px; letter-spacing: 2px; }
#alt-reset-mask .pct { margin-top: 12px; font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; font-family: var(--font-hud); }

/* ---------- 拦截进度（仅 intercept 关卡，如第4关柏林；左上现代无面板风格） ---------- */
/* 柏林专属模式：左上任务面板隐藏，拦截进度取代其位置 */
.intercept-mode #mission-panel { display: none; }

#hud-intercept {
  position: fixed; top: 22px; left: 24px; z-index: 12; width: 360px;
  font-family: var(--font-hud); pointer-events: none;
}
#hud-intercept .ic-header {
  display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px;
}
#hud-intercept .ic-label {
  font-size: 14px; color: var(--accent-gold); letter-spacing: 4px; font-weight: 700;
  text-shadow: var(--ts-gold);
}
#hud-intercept .ic-sub { font-size: 13px; color: var(--text-secondary); letter-spacing: 2px; text-shadow: var(--ts-halo); }
#hud-intercept .ic-row { display: flex; align-items: center; gap: 12px; }
#hud-intercept .ic-track {
  flex: 1; height: 10px; border-radius: 5px; overflow: hidden; position: relative;
  background: rgba(0,0,0,0.35); box-shadow: inset 0 1px 2px rgba(0,0,0,0.7);
}
#hud-intercept .ic-track > i {
  display: block; height: 100%; width: 0%; border-radius: 5px; position: relative; overflow: hidden;
  background: linear-gradient(90deg, #b88840, #d4a85a 30%, #ffb84d 70%, #ffd98a);
  box-shadow: 0 0 12px rgba(255,184,77,.6), inset 0 1px 0 rgba(255,255,255,.35);
  transition: width .4s cubic-bezier(.22,1,.36,1);
}
#hud-intercept .ic-track > i::after {
  content: ''; position: absolute; top: 0; left: 0; height: 100%; width: 60px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
  animation: ic-flow 2.2s linear infinite;
}
@keyframes ic-flow {
  0% { transform: translateX(-60px); }
  100% { transform: translateX(360px); }
}
#hud-intercept .ic-pct { line-height: 1; white-space: nowrap; }
#hud-intercept .ic-pct-num {
  font-size: 28px; font-weight: 700; color: var(--accent-gold);
  font-variant-numeric: tabular-nums; text-shadow: var(--ts-gold);
}
#hud-intercept .ic-pct-sign { font-size: 16px; color: var(--accent-amber); opacity: 0.8; }
#hud-intercept .ic-stats {
  margin-top: 7px; font-size: 13px; letter-spacing: 1px;
  color: var(--text-secondary); font-variant-numeric: tabular-nums; text-shadow: var(--ts-halo);
}
#hud-intercept .ic-score { color: var(--accent-gold); font-weight: 600; }
#hud-intercept .ic-sep { margin: 0 4px; opacity: 0.5; }
#hud-intercept .ic-target { color: var(--text-secondary); }

/* ---------- 左下：HP + 速度读数（白色文字 + 黑色光晕，无面板） ---------- */
#hud-readout {
  position: fixed; left: 24px; bottom: 24px; z-index: 11; pointer-events: none;
  font-family: var(--font-hud);
}
/* HP 行：标签 + 分段血条 + 数值，整体宽度受控避免与油门重叠 */
.ro-hp { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.ro-hp-label { font-size: 11px; letter-spacing: 4px; color: rgba(255,255,255,0.6); text-shadow: var(--ts-halo); }
/* 血条：深色轨道 + 彩色填充 + 段落刻度，6px 厚度更醒目 */
.hp-bar { position: relative; width: 160px; height: 6px; background: rgba(0,0,0,0.5); border-radius: 3px;
  overflow: hidden; border: none; box-shadow: 0 0 4px rgba(0,0,0,0.8), inset 0 0 3px rgba(0,0,0,0.9); }
.hp-bar > i { display: block; height: 100%; width: 100%; border-radius: 3px; transition: width .15s; }
.hp-bar > i.hp-high { background: linear-gradient(90deg, #2ecc71, #6fe0a0); box-shadow: 0 0 8px rgba(111,224,160,0.6); }
.hp-bar > i.hp-mid  { background: linear-gradient(90deg, #f39c12, #ffb84d); box-shadow: 0 0 8px rgba(255,184,77,0.6); }
.hp-bar > i.hp-low  { background: linear-gradient(90deg, #e74c3c, #ff5a4d); box-shadow: 0 0 10px rgba(255,90,77,0.7); }
/* 血条段落刻度线（25%/50%/75%） */
.hp-bar::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(90deg,
    transparent 24%, rgba(0,0,0,0.5) 25%, rgba(0,0,0,0.5) 26%, transparent 27%,
    transparent 49%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.5) 51%, transparent 52%,
    transparent 74%, rgba(0,0,0,0.5) 75%, rgba(0,0,0,0.5) 76%, transparent 77%);
}
.ro-hp-val { font-size: 18px; font-weight: 700; color: #fff; min-width: 42px;
  font-variant-numeric: tabular-nums; text-shadow: var(--ts-halo); }
.ro-row { display: flex; align-items: baseline; gap: 10px; line-height: 1; }
.ro-row + .ro-row { margin-top: 6px; }
.ro-label { font-size: 11px; color: rgba(255,255,255,0.55); letter-spacing: 4px; width: 52px; text-shadow: var(--ts-halo); }
.ro-val {
  font-size: 36px; font-weight: 700; color: #fff; line-height: 0.9;
  font-variant-numeric: tabular-nums;
  text-shadow: var(--ts-gold);
}
.ro-unit { font-size: 12px; color: rgba(255,255,255,0.5); letter-spacing: 1px; text-shadow: var(--ts-halo); }

/* ---------- 油门条（右移避免与血条重叠，极简框架） ---------- */
#throttle-bar { position: fixed; left: 300px; bottom: 24px; width: 22px; height: 165px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 5px;
  overflow: hidden; pointer-events: none; z-index: 11; }
/* 注意：不加 transition——每帧更新高度时 transition 会被反复重启导致卡顿 */
#throttle-bar > i { position: absolute; left: 0; bottom: 0; width: 100%; height: 30%;
  background: linear-gradient(0deg, #8a6838, #d4a85a 70%, #f0d090);
  box-shadow: 0 0 12px rgba(212,168,90,.5) inset; will-change: height; }
#throttle-bar .th-scale { position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, transparent 0, transparent 16px, rgba(255,255,255,.12) 16px, rgba(255,255,255,.12) 17px); }
#throttle-bar .th-pct { position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
  font-size: 11px; color: #fff; font-variant-numeric: tabular-nums; font-weight: 600; font-family: var(--font-hud); }
#throttle-bar .th-label { position: absolute; left: 26px; bottom: 50%; transform: rotate(180deg) translateY(50%);
  writing-mode: vertical-rl; font-size: 10px; color: rgba(255,255,255,0.45); letter-spacing: 4px; font-family: var(--font-hud); }

/* ---------- 262 专用喷气油门条（仅 jetThrottle 关卡显示） ---------- */
#hud-jet-throttle { position: fixed; left: 300px; bottom: 24px; z-index: 11; pointer-events: none;
  font-family: var(--font-hud); }
#hud-jet-throttle .jt-track { position: relative; width: 22px; height: 165px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 5px; overflow: hidden; }
#hud-jet-throttle .jt-fill { position: absolute; inset: 0;
  background: linear-gradient(0deg, #8a6838 0%, #d4a85a 62%, #e08050 78%, #ff5a4d 92%, #ff2a1d 100%);
  will-change: clip-path; }
#hud-jet-throttle .jt-scale { position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, transparent 0, transparent 16px, rgba(255,255,255,.12) 16px, rgba(255,255,255,.12) 17px); }
/* 峰值功率限制线（90%）：醒目红色横线 + 标签 */
#hud-jet-throttle .jt-peak-line { position: absolute; left: -4px; right: -4px; height: 0;
  border-top: 2px solid #ff5a4d; box-shadow: 0 0 8px rgba(255,90,77,.9), 0 0 3px rgba(255,90,77,.7); }
#hud-jet-throttle .jt-peak-line span { position: absolute; left: 30px; top: -7px; white-space: nowrap;
  font-size: 10px; letter-spacing: 2px; color: #ff5a4d; text-shadow: 0 0 6px rgba(255,90,77,.8); }
#hud-jet-throttle .jt-pct { position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
  font-size: 11px; color: #fff; font-variant-numeric: tabular-nums; font-weight: 600; }
#hud-jet-throttle .jt-label { position: absolute; left: 26px; bottom: 50%; transform: rotate(180deg) translateY(50%);
  writing-mode: vertical-rl; font-size: 10px; color: rgba(255,255,255,0.45); letter-spacing: 4px; }
/* 超过峰值线：整条闪红 */
#hud-jet-throttle.flash .jt-track { animation: jtFlash 0.4s steps(2) infinite; }
@keyframes jtFlash {
  0%, 100% { box-shadow: 0 0 0 rgba(255,42,29,0); }
  50% { box-shadow: 0 0 18px rgba(255,42,29,.95), 0 0 6px rgba(255,42,29,.7) inset; }
}
/* 冷却中：轨道压暗 + 提示文字 */
#hud-jet-throttle.cooling .jt-track { opacity: 0.55; }
#hud-jet-throttle .jt-cooling { position: absolute; top: -26px; left: 50%; transform: translateX(-50%);
  white-space: nowrap; font-size: 11px; letter-spacing: 2px; color: #ffb84d;
  text-shadow: 0 0 8px rgba(255,184,77,.7); }

/* ---------- 右下：机炮温度条（竖向，操作提示左侧，紧凑布局） ---------- */
#cannon-heat { position: fixed; right: 200px; bottom: 20px; z-index: 11;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  pointer-events: none; }
#cannon-heat .ch-track { width: 10px; height: 110px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 4px;
  overflow: hidden; position: relative; }
/* 填充用 transform: scaleY() 代替 height（不触发布局重排，动画更平滑） */
#cannon-heat .ch-fill { position: absolute; left: 0; bottom: 0; width: 100%; height: 100%;
  transform: scaleY(0); transform-origin: bottom;
  background: linear-gradient(0deg, #3fcc5a 0%, #f0a030 55%, #e83020 100%);
  box-shadow: 0 0 6px rgba(232,48,32,.4) inset;
  transition: transform 0.06s linear; will-change: transform; }
/* 标签水平显示在条下方，另起一行 */
#cannon-heat .ch-label { font-size: 8px; color: rgba(255,255,255,0.45);
  letter-spacing: 2px; font-family: var(--font-hud); }
/* 过热闪烁警告 */
#cannon-heat.overheated .ch-fill { animation: cannonFlash 0.3s ease-in-out infinite alternate; }
#cannon-heat.overheated .ch-track { border-color: rgba(232,48,32,0.7); box-shadow: 0 0 8px rgba(232,48,32,0.5); }
@keyframes cannonFlash { from { opacity: 0.55; } to { opacity: 1; } }

/* ---------- 右上：雷达（保留轻底色供雷达对比度） ---------- */
/* FPS 帧数显示（屏幕顶部，雷达左侧，30×30 黑色块透明度 0.8 + 白色帧数） */
#hud-fps {
  position: fixed; top: 18px; right: 240px; z-index: 12;
  width: 30px; height: 30px;
  background: rgba(0,0,0,0.8);
  border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-hud); font-size: 13px; font-weight: 700;
  color: #fff; font-variant-numeric: tabular-nums;
  text-shadow: 0 0 4px rgba(0,0,0,0.6);
  pointer-events: none;
}

#panel-tr {
  position: fixed; top: 18px; right: 20px; z-index: 11;
  background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
  backdrop-filter: blur(3px); overflow: hidden; padding: 8px 10px;
}
#panel-tr .rd-label { display: block; font-size: 10px; color: rgba(255,255,255,0.55); letter-spacing: 3px;
  margin-bottom: 4px; text-align: center; font-family: var(--font-hud); text-shadow: var(--ts-halo); }
#radar {
  display: block; border-radius: 50%;
  box-shadow: 0 0 14px rgba(111,208,255,.2), inset 0 0 18px rgba(0,0,0,.6);
  border: 1px solid rgba(111,208,255,.3);
}
#pos-readout {
  margin-top: 5px; text-align: center;
  font-family: var(--font-hud); font-size: 11px;
  color: rgba(255,255,255,0.7); letter-spacing: 1px;
  font-variant-numeric: tabular-nums; text-shadow: var(--ts-halo);
}

/* ---------- 左侧对话系统（任务面板下方） ---------- */
#dialog-system {
  position: fixed; top: 300px; left: 24px; z-index: 11;
  width: 440px; max-width: 46vw;
  display: flex; flex-direction: column; gap: 8px;
  pointer-events: none;
}
.dialog-item {
  background: rgba(0,0,0,0.65);
  border: 1px solid rgba(255,255,255,0.1);
  border-left: 3px solid var(--accent-gold);
  border-radius: 6px; padding: 10px 12px;
  display: flex; gap: 10px;
  animation: dialogIn 0.3s ease-out;
  pointer-events: auto; backdrop-filter: blur(4px);
}
.dialog-item.leaving { animation: dialogOut 0.3s ease-in forwards; }
.dialog-avatar {
  width: 50px; height: 50px; border-radius: 50%;
  border: 1px solid var(--accent-gold); flex-shrink: 0; overflow: hidden;
  background: #2a2418; display: flex; align-items: center; justify-content: center;
}
.dialog-avatar svg { width: 34px; height: 34px; }
.dialog-avatar .avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
.dialog-body { flex: 1; min-width: 0; }
.dialog-speaker {
  font-family: var(--font-display); color: var(--accent-gold);
  font-size: 13px; letter-spacing: 1px; margin-bottom: 3px;
  display: flex; align-items: baseline; gap: 6px;
}
.dialog-role {
  font-family: var(--font-body); font-size: 10px;
  color: var(--text-muted); letter-spacing: 1px;
  opacity: 0.85;
}
.dialog-text { color: rgba(255,255,255,0.92); font-size: 14px; line-height: 1.55; }
@keyframes dialogIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes dialogOut { to { opacity: 0; transform: translateY(8px); } }

/* ---------- 右下：按键提示（极简） ---------- */
#controls-hint {
  position: fixed; right: 20px; bottom: 20px; z-index: 11;
  background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px; backdrop-filter: blur(3px);
  overflow: hidden; opacity: 0.7; transition: opacity 0.2s;
  pointer-events: auto;
}
#controls-hint:hover { opacity: 1; }
.ch-toggle {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; cursor: pointer; user-select: none;
  font-size: 11px; color: rgba(255,255,255,0.6); letter-spacing: 3px; font-family: var(--font-hud);
  text-shadow: var(--ts-halo);
}
.ch-toggle .ch-icon { font-size: 14px; }
.ch-body { padding: 4px 12px 10px; display: none; }
#controls-hint.open .ch-body { display: block; }
.ch-row { display: flex; align-items: center; gap: 6px; font-size: 11px; color: rgba(255,255,255,0.7); margin: 3px 0; }
.ch-row kbd { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); border-radius: 3px;
  padding: 0 5px; font: 11px var(--font-hud); color: #fff; min-width: 18px; text-align: center; }
.ch-row .ch-desc { margin-left: auto; color: rgba(255,255,255,0.45); }

/* ---------- 教学提示框 ---------- */
#tutorial-overlay {
  position: fixed; inset: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.45); backdrop-filter: blur(2px);
  pointer-events: auto;
}
.tutorial-box {
  max-width: 480px; width: 90%; padding: 28px 32px;
  text-align: center;
}
.tutorial-step { font-size: 11px; color: var(--text-muted); letter-spacing: 3px; margin-bottom: 8px; }
.tutorial-title { font-family: var(--font-display); font-size: 24px; color: var(--accent-gold); letter-spacing: 6px; margin-bottom: 14px; }
.tutorial-body { font-size: 14px; line-height: 1.9; color: var(--text-secondary); margin-bottom: 22px; }
.tutorial-btn { display: inline-block; }

/* ---------- 暂停覆盖层 ---------- */
#pause-overlay { position: fixed; inset: 0; z-index: 200; pointer-events: auto;
  display: flex; align-items: center; justify-content: center; }
#pause-overlay .pause-mask {
  position: absolute; inset: 0; background: rgba(0,0,0,0.72); backdrop-filter: blur(4px);
  animation: resultFadeIn 0.3s ease-out;
}
.pause-card {
  position: relative; z-index: 1; max-width: 420px; width: 90%;
  text-align: center; padding: 40px 44px;
  animation: resultSlideIn 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.pause-title {
  font-family: var(--font-display); font-size: 36px; letter-spacing: 10px;
  color: var(--accent-gold); margin-bottom: 4px;
  text-shadow: 0 2px 16px rgba(212,168,90,0.4);
}
.pause-sub {
  font-family: var(--font-hud); font-size: 12px; letter-spacing: 6px;
  color: var(--text-muted); margin-bottom: 28px;
}
.pause-settings {
  display: flex; flex-direction: column; gap: 4px; margin-bottom: 28px;
  border-top: 1px solid rgba(212,168,90,0.15); border-bottom: 1px solid rgba(212,168,90,0.15);
  padding: 8px 0;
}
.pause-setting-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
}
.ps-label { font-size: 14px; color: var(--text-primary); letter-spacing: 3px; font-family: var(--font-hud); }
.pause-actions { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
.pause-hint { font-size: 11px; color: var(--text-muted); letter-spacing: 3px; }

/* ---------- 结算覆盖层 ---------- */
#result-overlay { position: fixed; inset: 0; z-index: 250; pointer-events: auto;
  display: flex; align-items: center; justify-content: center; }
#result-overlay .result-mask {
  position: absolute; inset: 0; background: rgba(0,0,0,0.78); backdrop-filter: blur(4px);
  animation: resultFadeIn 0.5s ease-out;
}
@keyframes resultFadeIn { from { opacity: 0; } to { opacity: 1; } }
.result-card {
  position: relative; z-index: 1; max-width: 560px; width: 90%;
  text-align: center; padding: 44px 48px;
  animation: resultSlideIn 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes resultSlideIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
.result-card .result-stamp {
  font-family: var(--font-hud); font-size: 13px; letter-spacing: 8px; color: var(--accent-amber);
  margin-bottom: 10px; opacity: 0.85;
}
.result-card .result-title {
  font-family: var(--font-display); font-size: 48px; letter-spacing: 10px; color: var(--accent-gold);
  margin-bottom: 36px;
  text-shadow: 0 2px 20px rgba(212,168,90,0.5), 0 0 40px rgba(212,168,90,0.2);
}
.result-card.fail .result-stamp { color: var(--accent-red); }
.result-card.fail .result-title { color: var(--accent-red);
  text-shadow: 0 2px 20px rgba(255,90,77,0.5), 0 0 40px rgba(255,90,77,0.2); }
.result-stats {
  display: flex; justify-content: center; gap: 0; margin-bottom: 36px;
  border-top: 1px solid rgba(212,168,90,0.2); border-bottom: 1px solid rgba(212,168,90,0.2);
}
.rs-cell { flex: 1; padding: 18px 8px; border-right: 1px solid rgba(212,168,90,0.12); }
.rs-cell:last-child { border-right: none; }
.rs-cell .rs-l { display: block; font-size: 11px; letter-spacing: 3px; color: rgba(255,255,255,0.5); margin-bottom: 8px; font-family: var(--font-hud); }
.rs-cell .rs-v { font-family: var(--font-hud); font-size: 28px; font-weight: 700; color: #fff;
  font-variant-numeric: tabular-nums; }
.rs-cell .rs-v i { font-size: 16px; color: var(--accent-gold); opacity: 0.5; font-style: normal; }

/* ---------- 剧情模式提示 ---------- */
#cinematic-skip {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  z-index: 60; padding: 8px 20px; font-size: 12px; letter-spacing: 2px;
  color: rgba(255,255,255,0.5); font-family: var(--font-hud);
  pointer-events: none; user-select: none;
  border: 1px solid rgba(255,255,255,0.12); border-radius: 4px;
  background: rgba(0,0,0,0.35); backdrop-filter: blur(4px);
}
#cinematic-hint {
  position: fixed; bottom: 68px; left: 50%; transform: translateX(-50%);
  z-index: 60; padding: 8px 20px; font-size: 13px; letter-spacing: 2px;
  color: var(--accent-gold); font-family: var(--font-hud);
  pointer-events: none; user-select: none;
  animation: cinematic-hint-pulse 1.6s ease-in-out infinite;
}
@keyframes cinematic-hint-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

/* 剧情阶段屏幕上方"鼠标右键可旋转视角"提示 */
#cinematic-rotate-hint {
  position: fixed; top: 28px; left: 50%; transform: translateX(-50%);
  z-index: 60; padding: 8px 22px; font-size: 13px; letter-spacing: 2px;
  color: var(--accent-gold); font-family: var(--font-hud);
  pointer-events: none; user-select: none;
  border: 1px solid rgba(212, 168, 90, 0.35); border-radius: 4px;
  background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(4px);
  animation: cinematic-hint-pulse 1.6s ease-in-out infinite;
}


/* ---------- 加载层 ---------- */
#loader {
  position: fixed; inset: 0; z-index: 200;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 40%, #1a2230, #0a0d10 70%);
  transition: opacity .6s ease;
}
#loader.hide { opacity: 0; pointer-events: none; }
#loader .title { font-family: var(--font-display); font-size: 22px; letter-spacing: 6px; color: var(--accent-gold); margin-bottom: 18px; }
#loader .sub { font-size: 13px; color: var(--text-muted); margin-bottom: 24px; letter-spacing: 2px; }
.bar { width: 320px; max-width: 70vw; height: 6px; background: rgba(255,255,255,.08); border-radius: 4px; overflow: hidden; border: 1px solid var(--line-soft); }
.bar > i { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, #d4a85a, #ffb84d); transition: width .2s; }
#loader .pct { margin-top: 12px; font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; font-family: var(--font-hud); }
#loader .err { margin-top: 16px; color: var(--fire); font-size: 12px; max-width: 80vw; text-align: center; white-space: pre-wrap; }

/* ====================================================================
   自由模式 · 地图选择 + 机库页
   ==================================================================== */
.free-map-grid { grid-template-columns: repeat(3, 1fr); }
@media (max-width: 720px) {
  .free-map-grid { grid-template-columns: repeat(2, 1fr); }
}

/* ---------- 机库页 · 全屏展示台 ---------- */
.page-free-hangar { overflow: hidden; }
.fh-stage {
  position: fixed; inset: 0; z-index: 1;
  overflow: hidden;
}
.fh-canvas { display: block; width: 100%; height: 100%; cursor: grab; }
.fh-hint {
  position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
  font-size: 11px; letter-spacing: 3px; color: rgba(255,255,255,0.35);
  font-family: var(--font-hud); pointer-events: none; z-index: 2;
}
.fh-loading {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 5; text-align: center; opacity: 0; transition: opacity 0.25s;
  pointer-events: none;
}
.fh-loading.visible { opacity: 1; }
.fh-loading-bar {
  width: 220px; height: 3px; background: rgba(255,255,255,0.12);
  border-radius: 2px; overflow: hidden; margin: 0 auto 10px;
}
.fh-loading-fill {
  width: 40%; height: 100%; background: var(--accent-amber, #d4a85a);
  border-radius: 2px;
  animation: fh-loading-slide 1.1s ease-in-out infinite;
}
@keyframes fh-loading-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}
.fh-loading-text {
  font-family: var(--font-hud); font-size: 12px; letter-spacing: 2px;
  color: rgba(255,255,255,0.5);
}

/* ---------- 翻页器（顶部中央） ---------- */
.fh-pager {
  position: absolute; top: 24px; left: 50%; transform: translateX(-50%);
  z-index: 4; display: flex; align-items: center; gap: 16px;
  background: rgba(8,10,14,0.55); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(212,168,90,0.22); border-radius: 40px;
  padding: 7px 18px; box-shadow: 0 6px 24px rgba(0,0,0,0.4);
}
.fh-pager-btn {
  width: 34px; height: 34px; border-radius: 50%;
  border: 1px solid var(--line-soft); background: rgba(0,0,0,0.3);
  color: var(--accent-amber); font-size: 20px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s; font-family: var(--font-display); user-select: none;
}
.fh-pager-btn:hover { background: rgba(212,168,90,0.2); border-color: var(--accent-amber); }
.fh-pager-name {
  font-family: var(--font-display); font-size: 17px; letter-spacing: 3px;
  color: var(--accent-gold); min-width: 130px; text-align: center;
}

/* ---------- 返回按钮（缩小，左上角） ---------- */
.fh-back {
  position: fixed; top: 22px; left: 22px; z-index: 10;
  padding: 6px 14px; font-size: 12px; letter-spacing: 2px;
  color: var(--text-secondary); background: rgba(8,10,14,0.6);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(212,168,90,0.22); border-radius: 3px;
  cursor: pointer; font-family: var(--font-hud); transition: all 0.2s;
}
.fh-back:hover { color: var(--accent-amber); border-color: var(--accent-amber); }

/* ---------- 悬浮面板 ---------- */
.fh-panel {
  position: absolute; z-index: 3;
  background: rgba(8, 10, 14, 0.7);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(212, 168, 90, 0.2);
  border-radius: 5px;
  box-shadow: 0 10px 36px rgba(0,0,0,0.55);
}
.fh-panel::-webkit-scrollbar { width: 5px; }
.fh-panel::-webkit-scrollbar-track { background: transparent; }
.fh-panel::-webkit-scrollbar-thumb { background: rgba(212,168,90,0.25); border-radius: 3px; }
.fh-panel-info {
  left: 22px; top: 92px; width: 320px;
  max-height: calc(100vh - 116px); overflow-y: auto;
  padding: 18px 20px;
}
.fh-panel-config {
  right: 22px; top: 92px; width: 244px;
  max-height: calc(100vh - 116px); overflow-y: auto;
  padding: 16px 18px;
  display: flex; flex-direction: column; gap: 10px;
}

/* ---------- 信息面板 ---------- */
.fh-info-head {
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
  margin-bottom: 12px; padding-bottom: 10px;
  border-bottom: 1px solid rgba(212,168,90,0.15);
}
.fh-info-name { font-family: var(--font-display); font-size: 20px; letter-spacing: 3px; color: var(--accent-gold); }
.fh-info-sub { font-size: 11px; letter-spacing: 2px; color: var(--text-muted); }
.fh-info-history { font-size: 12.5px; line-height: 1.8; color: var(--text-secondary); margin-bottom: 16px; text-indent: 2em; }
.fh-spec-block { margin-bottom: 14px; }
.fh-spec-block:last-child { margin-bottom: 0; }
.fh-spec-title {
  font-family: var(--font-display); font-size: 11px; letter-spacing: 3px;
  color: var(--accent-amber); margin-bottom: 8px; padding-bottom: 5px;
  border-bottom: 1px solid rgba(212,168,90,0.12);
}
.fh-spec-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 11.5px; }
.fh-sk { color: var(--text-muted); letter-spacing: 1px; }
.fh-sv { color: #fff8e0; font-family: var(--font-hud); letter-spacing: 0.5px; }
.fh-bars { display: flex; flex-direction: column; gap: 6px; }
.fh-bar-row { display: flex; align-items: center; gap: 10px; }
.fh-bar-label { font-size: 11px; color: var(--text-muted); letter-spacing: 1px; width: 50px; flex-shrink: 0; }
.fh-bar-track { flex: 1; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
.fh-bar-fill { height: 100%; background: linear-gradient(90deg, #b8862e, #f4d98a, #ffb84d); border-radius: 3px; transition: width 0.3s; }

/* ---------- 配置面板 ---------- */
.fh-cfg-title {
  font-family: var(--font-display); font-size: 13px; letter-spacing: 3px;
  color: var(--accent-gold); text-align: center; padding-bottom: 8px;
  border-bottom: 1px solid rgba(212,168,90,0.15); margin-bottom: 4px;
}
.fh-cfg-section { }
.fh-cfg-label { font-family: var(--font-display); font-size: 10px; letter-spacing: 2px; color: var(--accent-gold); margin-bottom: 6px; }
.fh-cfg-row { display: flex; gap: 6px; }
.fh-cfg-wrap { flex-wrap: wrap; }
.fh-cfg-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.fh-pick {
  flex: 1; padding: 6px 8px; text-align: center; font-size: 12px; letter-spacing: 1px;
  color: var(--text-secondary); background: rgba(0,0,0,0.3);
  border: 1px solid var(--line-soft); border-radius: 3px;
  cursor: pointer; transition: all 0.2s; font-family: var(--font-hud); user-select: none;
}
.fh-pick:hover { color: var(--accent-amber); border-color: var(--accent-amber); }
.fh-pick.selected { color: #1a1208; background: linear-gradient(180deg, #f4d98a, #d4a85a); border-color: var(--accent-gold); box-shadow: 0 2px 10px rgba(212,168,90,0.4); font-weight: 700; }
.fh-chip {
  flex: 1; padding: 5px 6px; text-align: center; font-size: 11px; letter-spacing: 1px;
  color: var(--text-secondary); background: rgba(0,0,0,0.3);
  border: 1px solid var(--line-soft); border-radius: 3px;
  cursor: pointer; transition: all 0.2s; font-family: var(--font-hud); user-select: none;
}
.fh-chip:hover { color: var(--accent-amber); border-color: var(--accent-amber); }
.fh-chip.selected { color: #1a1208; background: linear-gradient(180deg, #f4d98a, #d4a85a); border-color: var(--accent-gold); box-shadow: 0 2px 10px rgba(212,168,90,0.4); font-weight: 700; }
.fh-cfg-preview { padding: 9px 11px; border: 1px solid rgba(212,168,90,0.15); border-radius: 3px; background: rgba(0,0,0,0.25); margin-top: 2px; }
.fh-pv-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 11px; letter-spacing: 1px; }
.fh-pv-row span { color: var(--text-muted); }
.fh-pv-row b { color: var(--accent-amber); font-family: var(--font-hud); font-weight: 400; }
.fh-start-btn { margin-top: 6px; padding: 10px 16px; font-size: 14px; letter-spacing: 4px; }

@media (max-width: 720px) {
  .fh-panel-info { width: calc(100vw - 44px); max-height: 38vh; }
  .fh-panel-config { width: calc(100vw - 44px); top: auto; bottom: 16px; max-height: 48vh; }
}
`;
