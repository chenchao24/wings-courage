/**
 * HUD HTML 模板：由 HudController 注入到 #hud 容器。
 * 样式见 Theme.js。
 *
 * 布局：
 *   #topbar          中上：关卡名 + 波次 + 返回
 *   #mission-panel   左上：任务面板（网游风，透明无框，对号列表）
 *   #crosshair       中心准星（追尾/座舱显示，观察视角隐藏）
 *   #hud-stall/crash 警告
 *   #hud-readout     左下：HP（上）+ SPEED/ALT 大字读数
 *   #throttle-bar    油门条
 *   #panel-tr        右上：雷达
 *   #dialog-system   右上雷达下：对话系统（P5）
 *   #controls-hint   右下：按键提示（可折叠）
 */
export function hudTemplate(levelName) {
  const name = levelName || '任务';
  return `
  <!-- 左上：任务面板（网游风，透明无框） -->
  <div id="mission-panel">
    <div class="mp-label">MISSION</div>
    <div class="mp-title">击落全部来援敌机</div>
    <div class="mp-progress">
      <span class="mp-count" data-ro="kills">0</span><span class="mp-slash">/</span><span class="mp-total" data-ro="target">0</span>
    </div>
    <div class="mp-waves" data-ro="waves"></div>
  </div>

  <!-- 准星 -->
  <div id="crosshair"><div class="ring"></div><div class="dot"></div></div>

  <!-- 警告 -->
  <div id="hud-stall">失速 STALL</div>
  <div id="hud-crash">坠毁 CRASH</div>
  <div id="hud-altitude">高度过低 注意拉起</div>
  <!-- 交战高度规则警告（仅 combatAlt 关卡显示；默认隐藏，见 CombatAltRule） -->
  <div id="hud-alt-fence"></div>
  <!-- 被咬尾警告（顶端中央：红框白字 + 框下中文小字，持续咬尾中闪动，无追击者消失） -->
  <div id="hud-tail-warn">
    <div class="tw-box">FEIND HINTER HECK!</div>
    <div class="tw-sub">被咬尾注意规避！</div>
  </div>

  <!-- 左下：HP + 速度读数（HP 在上） -->
  <div id="hud-readout">
    <div class="ro-hp">
      <span class="ro-hp-label">HP</span>
      <div class="hp-bar"><i class="hp-high"></i></div>
      <span class="ro-hp-val" data-ro="hp">100</span>
    </div>
    <div class="ro-row"><span class="ro-label">SPEED</span><span class="ro-val" data-ro="speed">0</span><span class="ro-unit">km/h</span></div>
    <div class="ro-row"><span class="ro-label">ALT</span><span class="ro-val" data-ro="alt">0</span><span class="ro-unit">m</span></div>
  </div>

  <!-- 油门条 -->
  <div id="throttle-bar">
    <i></i><div class="th-scale"></div>
    <div class="th-pct">0</div>
    <div class="th-label">THROTTLE</div>
  </div>

  <!-- 262 专用喷气油门条（仅 jetThrottle 关卡显示；渐变+峰值限制线+冷却提示） -->
  <div id="hud-jet-throttle" style="display:none">
    <div class="jt-track">
      <div class="jt-fill"></div>
      <div class="jt-scale"></div>
      <div class="jt-peak-line"><span>峰值功率</span></div>
    </div>
    <div class="jt-pct">0</div>
    <div class="jt-label">THROTTLE</div>
    <div class="jt-cooling"></div>
  </div>

  <!-- 顶部：FPS 帧数显示（雷达左侧） -->
  <div id="hud-fps">60</div>

  <!-- 右上：雷达 -->
  <div id="panel-tr">
    <span class="rd-label">RADAR</span>
    <canvas id="radar" width="170" height="170"></canvas>
    <div id="pos-readout">X 0 · Z 0</div>
  </div>

  <!-- 左上：拦截进度（仅配置 intercept 的关卡显示，如第4关；取代任务面板位置） -->
  <div id="hud-intercept" style="display:none">
    <div class="ic-header">
      <span class="ic-label">INTERCEPT</span>
      <span class="ic-sub">拦截进度</span>
    </div>
    <div class="ic-row">
      <div class="ic-track"><i></i></div>
      <div class="ic-pct"><span class="ic-pct-num">0</span><span class="ic-pct-sign">%</span></div>
    </div>
    <div class="ic-stats">
      <span class="ic-score">0</span><span class="ic-sep"> / </span><span class="ic-target">100</span>
    </div>
  </div>

  <!-- 右上对话系统（P5 填充） -->
  <div id="dialog-system"></div>

  <!-- 右下：机炮温度条（竖向，操作提示左侧） -->
  <div id="cannon-heat">
    <div class="ch-track"><i class="ch-fill"></i></div>
    <div class="ch-label">CANNON</div>
  </div>

  <!-- 右下：按键提示 -->
  <div id="controls-hint">
    <div class="ch-toggle"><span class="ch-icon">⚙</span><span>操作说明</span></div>
    <div class="ch-body">
      <div class="ch-row"><kbd>W</kbd><kbd>S</kbd><span class="ch-desc">俯仰</span></div>
      <div class="ch-row"><kbd>A</kbd><kbd>D</kbd><span class="ch-desc">滚转</span></div>
      <div class="ch-row"><kbd>Q</kbd><kbd>E</kbd><span class="ch-desc">偏航</span></div>
      <div class="ch-row"><kbd>Shift</kbd><span class="ch-desc">加速</span></div>
      <div class="ch-row"><kbd>Ctrl</kbd><span class="ch-desc">减速</span></div>
      <div class="ch-row"><kbd>Space</kbd><span class="ch-desc">开火</span></div>
      <div class="ch-row"><kbd>C</kbd><span class="ch-desc">追尾 / 座舱</span></div>
      <div class="ch-row"><kbd>V</kbd><span class="ch-desc">观察视角</span></div>
      <div class="ch-row"><kbd>M</kbd><span class="ch-desc">静音</span></div>
      <div class="ch-row"><kbd>Esc</kbd><span class="ch-desc">暂停</span></div>
    </div>
  </div>
  `;
}
