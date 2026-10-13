import { BasePage } from './_base.js';
import { createToggle } from '../ui/Toggle.js';

/**
 * 设置页：
 *   - 3 个开关：音效总开关 / 音乐总开关 / 击中音效
 *   - 4 个音量滑块 + 试听按钮：音乐 / 音效 / 机枪 / 引擎
 *
 * 滑块实时生效；试听按钮为 toggle（点击开始周期性播放，再点停止）。
 * 离开页面时自动停止所有预览并恢复菜单音乐。
 */
export class SettingsPage extends BasePage {
  get name() { return 'settings'; }

  _build() {
    const s = this.shell.settings;
    const vol = (key) => s.get(key);
    return `
      <div class="page-header">
        <div class="page-title">设置</div>
        <div class="page-sub">SETTINGS</div>
      </div>
      <div class="settings-cols">
        <!-- 左列：开关 -->
        <div class="settings-list settings-left">
          <div class="setting-row bronze-frame" data-key="soundEnabled">
            <div class="sr-text">
              <span class="sr-title">音效总开关</span>
              <span class="sr-desc">一键静音所有声音</span>
            </div>
            <div class="toggle-slot"></div>
          </div>
          <div class="setting-row bronze-frame" data-key="musicEnabled">
            <div class="sr-text">
              <span class="sr-title">音乐总开关</span>
              <span class="sr-desc">菜单与战斗背景配乐</span>
            </div>
            <div class="toggle-slot"></div>
          </div>
          <div class="setting-row bronze-frame" data-key="hitSound">
            <div class="sr-text">
              <span class="sr-title">击中音效</span>
              <span class="sr-desc warn">关闭可获得更真实体验（默认开启）</span>
            </div>
            <div class="toggle-slot"></div>
          </div>
        </div>
        <!-- 右列：音量滑块 -->
        <div class="settings-list settings-right">
          ${this._sliderRow('musicVolume', '音乐音量', vol('musicVolume'), 'music')}
          ${this._sliderRow('sfxVolume', '音效音量', vol('sfxVolume'), 'sfx')}
          ${this._sliderRow('gunVolume', '机枪音量', vol('gunVolume'), 'gun')}
          ${this._sliderRow('engineVolume', '引擎音量', vol('engineVolume'), 'engine')}
        </div>
      </div>
      <button class="bronze-button page-back-btn" data-action="back">返回</button>
    `;
  }

  _sliderRow(key, label, value, previewType) {
    return `
      <div class="setting-row slider-row bronze-frame" data-key="${key}">
        <div class="slider-header">
          <span class="sr-title">${label}</span>
          <div class="slider-controls">
            <input type="range" min="0" max="100" value="${value}" class="volume-slider" data-key="${key}">
            <span class="slider-value" data-value-for="${key}">${value}</span>
            <button class="preview-btn" data-preview="${previewType}">试听</button>
          </div>
        </div>
      </div>
    `;
  }

  _onMount() {
    const settings = this.shell.settings;
    const audio = this.shell.audio;
    this._activePreviews = new Set();

    // 开关
    this.$$('.setting-row:not(.slider-row)').forEach((row) => {
      const key = row.dataset.key;
      const slot = row.querySelector('.toggle-slot');
      const toggle = createToggle(settings.get(key), (on) => settings.set(key, on));
      slot.appendChild(toggle);
    });

    // 滑块：实时同步
    this.$$('.volume-slider').forEach((slider) => {
      const key = slider.dataset.key;
      const valLabel = this.el.querySelector(`[data-value-for="${key}"]`);
      // 初始填充
      slider.style.setProperty('--fill', slider.value + '%');
      slider.addEventListener('input', () => {
        const v = parseInt(slider.value, 10);
        valLabel.textContent = v;
        slider.style.setProperty('--fill', v + '%');
        settings.set(key, v);
      });
    });

    // 试听按钮：toggle
    this.$$('.preview-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.preview;
        if (this._activePreviews.has(type)) {
          audio.previewStop(type);
          this._activePreviews.delete(type);
          btn.textContent = '试听';
          btn.classList.remove('active');
        } else {
          audio.previewStart(type);
          this._activePreviews.add(type);
          btn.textContent = '停止';
          btn.classList.add('active');
        }
      });
    });

    this._onClick('[data-action="back"]', () => this.router.go('menu'));
  }

  _onUnmount() {
    const audio = this.shell.audio;
    // 停止所有预览
    if (this._activePreviews) {
      audio.previewStopAll();
      this._activePreviews.clear();
    }
    // 恢复菜单音乐（试听可能停了音乐）
    if (audio._musicName !== 'menu' && audio._musicEnabled) {
      audio.playMusic('menu', 1.0);
    }
  }
}
