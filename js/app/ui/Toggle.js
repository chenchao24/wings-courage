/**
 * 开关组件（青铜风）。
 * @param {boolean} initial  初始状态
 * @param {(on:boolean)=>void} onChange  状态变更回调
 */
export function createToggle(initial, onChange) {
  const el = document.createElement('div');
  el.className = 'toggle' + (initial ? ' on' : '');
  el.addEventListener('click', () => {
    const on = !el.classList.contains('on');
    el.classList.toggle('on', on);
    if (onChange) onChange(on);
  });
  /** 外部同步状态 */
  el.set = (on) => el.classList.toggle('on', on);
  return el;
}
