import { BasePage } from './_base.js';

/** 机库页占位（暂未开放）。 */
export class HangarPage extends BasePage {
  get name() { return 'hangar'; }

  _build() {
    return `
      <div class="page-header">
        <div class="page-title">机库</div>
        <div class="page-sub">HANGAR</div>
      </div>
      <div style="text-align:center;">
        <div class="hangar-locked">尚未开放</div>
        <div class="hangar-hint">机库系统将在后续版本更新</div>
      </div>
      <div class="page-footer">
        <button class="bronze-button" data-action="back">返回菜单</button>
      </div>
    `;
  }

  _onMount() {
    this._onClick('[data-action="back"]', () => this.router.go('menu'));
  }
}
