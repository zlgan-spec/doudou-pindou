// 网站版：整页按 ← / → 切换一排筛选标签（等于点上一个 / 下一个），首尾相接；↑ ↓ 不管，浏览器照常滚动。
// 界面上不写说明，按一下就知道。小工具版在手机上、没有键盘，不带这段。
export function arrowTabs(getList: () => HTMLElement | null): () => void {
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    // Alt + ← 是浏览器后退；大图翻页、引导这些先处理过的（defaultPrevented）不再管
    if (!d || e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    // 搜索框里 ← → 移光标；下拉框上（Windows）← → 会改值
    const t = e.target instanceof HTMLElement ? e.target : null;
    if (t && (t.isContentEditable || t.closest('input, textarea, select'))) return;
    if (document.querySelector('dialog[open], .modal-backdrop')) return;
    const list = getList();
    if (!list) return;
    const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
    if (tabs.length < 2) return;
    const at = tabs.findIndex(b => b.getAttribute('aria-selected') === 'true');
    // 一个都没选中（色卡库按 Hex 搜索时）：→ 从第一个开始，← 从最后一个开始
    const next = at < 0 ? tabs[d > 0 ? 0 : tabs.length - 1] : tabs[(at + d + tabs.length) % tabs.length];
    e.preventDefault();
    const hadFocus = list.contains(document.activeElement);
    next.click();
    if (hadFocus) next.focus({ preventScroll: true }); // 焦点本来就在标签上（刚点过）：跟着走，Tab 键不乱
    // 窄屏标签栏是横着滑的：滑到能看见这一个
    const lr = list.getBoundingClientRect();
    const br = next.getBoundingClientRect();
    const cs = getComputedStyle(list);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    if (br.left < lr.left + padL) list.scrollLeft -= lr.left + padL - br.left;
    else if (br.right > lr.right - padR) list.scrollLeft += br.right - (lr.right - padR);
    // 页面往下翻远了、标签栏不在屏幕里：滚回标签栏看新列表的开头，让开吸顶导航
    const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    if (lr.top < top || lr.bottom > window.innerHeight) window.scrollTo({ top: window.scrollY + lr.top - top - 16 });
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
