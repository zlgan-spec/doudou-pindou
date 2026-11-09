// 兼容老安卓（小工具最低按 Android 8.1 / Chrome 61）：Flex 布局的 gap 在 Chrome 84 才支持。
// 实际量一次：不支持时给 <html> 加 no-flex-gap，CSS 里对应的规则用 margin 补上间距。
export function markFlexGap(): void {
  const flex = document.createElement('div');
  flex.style.position = 'absolute';
  flex.style.visibility = 'hidden';
  flex.style.display = 'flex';
  flex.style.flexDirection = 'column';
  flex.style.rowGap = '1px';
  flex.appendChild(document.createElement('div'));
  flex.appendChild(document.createElement('div'));
  document.body.appendChild(flex);
  const supported = flex.scrollHeight === 1;
  document.body.removeChild(flex);
  if (!supported) document.documentElement.classList.add('no-flex-gap');
}
