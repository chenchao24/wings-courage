import { BasePage } from './_base.js';
import { getLevel } from '../../config/levels/index.js';

/**
 * 任务简报页：展示关卡背景与任务目标，点击"开始任务"进入关卡。
 * P1 阶段：点击开始 → 调用 shell.startLevel（P2 实现 GameRuntime 启动）。
 */
export class BriefingPage extends BasePage {
  get name() { return 'briefing'; }

  _build(params) {
    const lv = getLevel(params.levelId) || {};
    const mission = lv.mission || {};
    return `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;">
        <div class="briefing-box bronze-frame">
          <h2>${lv.name || '未知关卡'}</h2>
          <div class="b-sub">${lv.subtitle || ''} · ${lv.date || ''}</div>
          <div class="b-body">${lv.briefing || ''}</div>
          <div class="b-mission">
            ▸ 任务目标：${mission.label || '击落全部敌机'}<br>
            ▸ 敌机总数：${lv.totalEnemies || 0} 架 · ${mission.waves || 0} 波
          </div>
          <div class="briefing-actions">
            <button class="bronze-button" data-action="back">返回</button>
            <button class="bronze-button primary" data-action="start">开始任务</button>
          </div>
        </div>
      </div>
    `;
  }

  _onMount(params) {
    this._onClick('[data-action="start"]', () => {
      this.shell.ensureAudio();
      this.shell.startLevel(params.levelId);
    });
    this._onClick('[data-action="back"]', () => this.router.go('level-select'));
  }
}
