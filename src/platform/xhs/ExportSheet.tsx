// 「存到相册」预览（小工具版）：先把要存的图画好给用户看一眼，再点按钮存。
// 这样点按钮时图已经是现成的 data URL，可以立刻调平台接口（平台要求由点击直接触发）。
// 存的图一律写色号（照着拼用），不给开关。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExportImage, ExportRequest } from '../types';
import { albumAvailable, saveDataUrls } from './album';

let open: ((req: ExportRequest) => void) | null = null;
/** 任何地方都能调：打开「存到相册」预览 */
export function openExport(req: ExportRequest): void {
  open?.(req);
}

export function ExportHost() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [req, setReq] = useState<ExportRequest | null>(null);
  const [images, setImages] = useState<ExportImage[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    open = r => { setReq(r); setImages(null); };
    return () => { open = null; };
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (req && !d.open) { d.showModal(); (document.activeElement as HTMLElement | null)?.blur(); } // 不让浏览器自动把焦点放到「取消」上
    if (!req && d.open) d.close();
  }, [req]);

  // 打开时画图：先让「正在生成」显示出来
  useEffect(() => {
    if (!req) return;
    setImages(null);
    // 等预览窗先画出来（两帧）再开始画图，大图分板时也能马上看到窗口
    let t = 0;
    const f = requestAnimationFrame(() => { t = window.setTimeout(() => setImages(req.build(true)), 0); });
    return () => { cancelAnimationFrame(f); window.clearTimeout(t); };
  }, [req]);

  const close = useCallback(() => setReq(null), []);
  const save = () => {
    if (!images || saving) return;
    setSaving(true);
    // 同步调用：第一张图的平台接口在这次点击里就发出
    void saveDataUrls(images.map(i => i.url)).then(n => { setSaving(false); if (n) close(); });
  };

  return (
    <dialog ref={dialog} className="ask export-sheet" onClose={close} onClick={e => { if (e.target === dialog.current) close(); }} aria-labelledby="export-title">
      <h2 id="export-title">存到相册</h2>
      <div className="export-preview">
        {images ? <img src={images[0].url} alt={req?.title ?? '图纸预览'} /> : <span className="fine">正在生成…</span>}
      </div>
      {images && images.length > 1 && <p className="fine">共 {images.length} 张：总览 + 每块板一张</p>}
      {!albumAvailable() && <p className="fine">在小红书 App 里打开才能存相册</p>}
      <div className="ask-actions">
        <button className="btn link" onClick={close}>取消</button>
        <button className="btn primary pill" onClick={save} disabled={!images || saving}>{saving ? '正在保存…' : '存相册'}</button>
      </div>
    </dialog>
  );
}
