import defaultSettings from '../config/default-settings.js';

const STORAGE_KEY = 'couragewings_settings_v1';

/**
 * 设置系统：localStorage 持久化 + 变更订阅。
 * 单例式使用（AppShell 持有一个实例，跨页面/关卡共享）。
 */
export class Settings {
  constructor() {
    this.values = this._load();
    this._listeners = new Map(); // key -> Set<cb>
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
    } catch (e) { /* parse error or quota */ }
    return { ...defaultSettings };
  }

  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values)); }
    catch (e) { /* quota exceeded, ignore */ }
  }

  get(key) { return this.values[key]; }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this._save();
    this._notify(key, value);
  }

  /** 订阅某个 key 的变更 */
  onChange(key, cb) {
    if (!this._listeners.has(key)) this._listeners.set(key, new Set());
    this._listeners.get(key).add(cb);
    // 立即触发一次，让订阅者同步当前状态
    cb(this.values[key]);
  }

  _notify(key, value) {
    const set = this._listeners.get(key);
    if (set) set.forEach(cb => cb(value));
  }
}
