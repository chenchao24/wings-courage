/**
 * 《勇气之翼》入口：启动 AppShell。
 * 旧测试场的主循环逻辑已迁移至 js/game/GameRuntime.js（P2 阶段）。
 *
 * 开机画面 #boot-splash（index.html 内联，纯 CSS）在此退出：
 *  - boot 成功、封面页挂载进 #app 后淡出移除（等两帧让 Router 的 .show 淡入先启动，避免闪白）；
 *  - import/boot 任一环失败：保留画面，#boot-splash-msg 改错误文案并停掉转圈
 *    （与 AppShell 致命错误兜底共用接口：#boot-splash / #boot-splash-msg）。
 */
const splashEl = () => document.getElementById('boot-splash');
const splashMsgEl = () => document.getElementById('boot-splash-msg');

function dismissBootSplash() {
  const splash = splashEl();
  if (!splash) return;
  splash.classList.add('done'); // CSS opacity 淡出 + 立即放行点击
  splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  setTimeout(() => splash.remove(), 1000); // transitionend 不触发时的兜底移除
}

function failBootSplash(err) {
  console.error('[main] 启动失败:', err);
  const splash = splashEl();
  if (splash) splash.classList.add('failed');
  const msg = splashMsgEl();
  if (msg) msg.textContent = '加载失败，请刷新重试';
}

try {
  // 动态 import：静态 import 失败时整模块不会执行，无法 catch 后更新画面文案
  const { AppShell } = await import('./app/AppShell.js');
  const shell = new AppShell();
  shell.boot(); // 同步完成 WebGL 创建 + 封面页挂载进 #app；失败抛错走 catch
  requestAnimationFrame(() => requestAnimationFrame(dismissBootSplash));
} catch (err) {
  failBootSplash(err);
}
