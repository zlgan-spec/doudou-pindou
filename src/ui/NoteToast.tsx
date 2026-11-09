// 操作结果的一句话（导入了几张、空间满了）：底部浮出几秒自动收起，不在内容上方插一行把图纸往下顶
// 可以带一两个按钮（存相册成功后的「发笔记」「关注作者」）：有按钮时多留几秒，点了按钮就收起
import { useEffect } from 'react';
import type { NoteAction } from '../platform/types';

export type ToastAction = NoteAction;

// 大图窗口是模态 dialog（在浏览器的最上层）：它开着时，App 的提示条要渲染进它里面才看得见、点得到
let host: HTMLElement | null = null;
export function setToastHost(el: HTMLElement | null): void {
  host = el;
}
export function toastHost(): HTMLElement | null {
  return host;
}

export function NoteToast({ note, actions, onDone }: { note: string; actions?: ToastAction[]; onDone: () => void }) {
  const has = !!note && !!actions && actions.length > 0;
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(onDone, has ? 8000 : 5000);
    return () => window.clearTimeout(t);
  }, [note, has, onDone]);
  return (
    <div className={`toast notice ${has ? 'has-action' : ''} ${note ? 'show' : ''}`} role="status" aria-live="polite">
      {has ? <span>{note}</span> : note}
      {has && actions!.map(a => <button key={a.label} onClick={() => { a.run(); onDone(); }}>{a.label}</button>)}
    </div>
  );
}
