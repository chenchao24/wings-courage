/**
 * 页面路由器：管理 SPA 页面切换。
 * 每个 Page 类实现 mount(root, params) / unmount() 接口。
 * 切换采用交叉淡入：新页先 mount（.page-bg 不透明盖住旧页），下帧加 .show 触发内容淡入；
 * 旧页标记 leaving 屏蔽交互，延时 380ms（淡入完成+缓冲）再 unmount，避免 #app 空帧导致
 * 底层 #scene 3D 画面透出。同名页重新进入时先卸后挂避免冲突。
 */
export class Router {
  constructor(shell) {
    this.shell = shell;
    this.routes = new Map();   // name -> PageClass
    this.current = null;       // 当前 Page 实例
    this.currentName = null;
    this.history = [];         // 导航历史（用于 back）
  }

  register(name, PageClass) {
    this.routes.set(name, PageClass);
    return this;
  }

  /** 跳转到指定页面 */
  go(name, params = {}) {
    const PageClass = this.routes.get(name);
    if (!PageClass) {
      console.warn('[Router] 未注册的页面:', name);
      return;
    }
    const oldPage = this.current;       // 可能 null（首次进入）
    const isSamePage = this.currentName === name;

    // 同名页重新进入：新旧会冲突（如选关->选关刷新），沿用先卸后挂
    if (oldPage && isSamePage) {
      try { oldPage.unmount(); } catch (e) { console.error('[Router] unmount 失败', e); }
    }

    // 挂载新页（旧页若存在且非同名，此时与新页并存：新页 .page-bg 不透明盖住旧页）
    const page = new PageClass(this.shell);
    const root = document.getElementById('app');
    page.mount(root, params);

    // 旧页标记 leaving：屏蔽交互，避免淡出期间仍可点击
    if (oldPage && !isSamePage && oldPage.el) {
      oldPage.el.classList.add('leaving');
    }

    this.current = page;
    this.currentName = name;
    this.history.push({ name, params });
    // 触发新页内容淡入（.page-bg 立即可见不透明，内容 opacity 0->1）
    requestAnimationFrame(() => page.el?.classList.add('show'));

    // 旧页延时卸载：等新页内容淡入完成（0.35s + 缓冲）再移除，避免 #app 空帧导致 #scene 透出
    if (oldPage && !isSamePage) {
      const toUnmount = oldPage;
      setTimeout(() => {
        try { toUnmount.unmount(); } catch (e) { console.error('[Router] 旧页延时 unmount 失败', e); }
      }, 380);
    }
  }

  /** 返回上一页 */
  back() {
    if (this.history.length <= 1) return;
    this.history.pop(); // 弹出当前
    const prev = this.history[this.history.length - 1];
    this.history.pop(); // go 会重新 push
    this.go(prev.name, prev.params);
  }

  /** 返回到指定页面（清除中间历史） */
  backTo(name) {
    const idx = this.history.findIndex(h => h.name === name);
    if (idx < 0) { this.go(name); return; }
    const target = this.history[idx];
    this.history = this.history.slice(0, idx);
    this.go(target.name, target.params);
  }
}
