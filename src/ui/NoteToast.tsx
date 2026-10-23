// 操作结果的一句话（导入了几张、空间满了）：底部浮出几秒自动收起，不在内容上方插一行把图纸往下顶
import { useEffect } from 'react';

export function NoteToast({ note, onDone }: { note: string; onDone: () => void }) {
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(onDone, 5000);
    return () => window.clearTimeout(t);
  }, [note, onDone]);
  return <div className={`toast notice ${note ? 'show' : ''}`} role="status" aria-live="polite">{note}</div>;
}
