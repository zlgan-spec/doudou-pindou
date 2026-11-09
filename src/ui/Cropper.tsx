// 选好图后先框一下要的部分：默认框住整张，直接点「生成图纸」就和不裁一样；
// 拖四个角改大小、按住框里拖动挪位置（和换头像时裁图的习惯一样）。裁剪用原图分辨率，交给 loadImage 再缩小。
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** 裁剪框：占原图宽高的比例（0–1） */
export interface CropRect { x: number; y: number; w: number; h: number }
type Corner = 'tl' | 'tr' | 'bl' | 'br';

const MIN = 0.06; // 框最小占原图的比例，免得缩成一个点

export function Cropper({ url, onDone, onCancel }: { url: string; onDone: (crop: CropRect | null) => void; onCancel: () => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState<[number, number] | null>(null);
  const [view, setView] = useState<{ left: number; top: number; w: number; h: number } | null>(null);
  const [box, setBox] = useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
  const drag = useRef<{ mode: Corner | 'move'; px: number; py: number; b: CropRect } | null>(null);

  // 图片按「完整放进舞台」摆好，记下它在屏幕上的位置和大小
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !nat) return;
    const fit = () => {
      const sw = stage.clientWidth, sh = stage.clientHeight;
      const k = Math.min(sw / nat[0], sh / nat[1]);
      const w = nat[0] * k, h = nat[1] * k;
      setView({ left: (sw - w) / 2, top: (sh - h) / 2, w, h });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [nat]);

  const down = (mode: Corner | 'move') => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, px: e.clientX, py: e.clientY, b: box };
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || !view) return;
    const dx = (e.clientX - d.px) / view.w, dy = (e.clientY - d.py) / view.h;
    const b = d.b;
    if (d.mode === 'move') {
      setBox({ ...b, x: Math.min(1 - b.w, Math.max(0, b.x + dx)), y: Math.min(1 - b.h, Math.max(0, b.y + dy)) });
      return;
    }
    let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    if (d.mode === 'tl' || d.mode === 'bl') x0 = Math.min(x1 - MIN, Math.max(0, x0 + dx));
    else x1 = Math.max(x0 + MIN, Math.min(1, x1 + dx));
    if (d.mode === 'tl' || d.mode === 'tr') y0 = Math.min(y1 - MIN, Math.max(0, y0 + dy));
    else y1 = Math.max(y0 + MIN, Math.min(1, y1 + dy));
    setBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  };
  const up = () => { drag.current = null; };

  const whole = box.x < 0.005 && box.y < 0.005 && box.w > 0.99 && box.h > 0.99;
  const style = view && { left: view.left + box.x * view.w, top: view.top + box.y * view.h, width: box.w * view.w, height: box.h * view.h };

  return (
    <div className="cropper" role="dialog" aria-label="框出要做成图纸的部分">
      <div className="cropper-stage" ref={stageRef} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <img src={url} alt="" draggable={false} onLoad={e => setNat([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
          style={view ? { left: view.left, top: view.top, width: view.w, height: view.h } : { visibility: 'hidden' }} />
        {style && (
          <div className="crop-box" style={style} onPointerDown={down('move')}>
            <i className="crop-thirds" aria-hidden />
            {(['tl', 'tr', 'bl', 'br'] as const).map(c => <span key={c} className={`crop-corner ${c}`} onPointerDown={down(c)} aria-hidden />)}
          </div>
        )}
      </div>
      <div className="cropper-actions">
        <button className="btn link" onClick={onCancel}>取消</button>
        <button className="btn primary pill" disabled={!view} onClick={() => onDone(whole ? null : box)}>生成图纸</button>
      </div>
    </div>
  );
}

// 任何地方都能调：打开裁剪，等用户点「生成图纸」（返回框，整张为 null）或「取消」（'cancel'）
let open: ((file: File, resolve: (c: CropRect | null | 'cancel') => void) => void) | null = null;
export function askCrop(file: File): Promise<CropRect | null | 'cancel'> {
  return new Promise(resolve => (open ? open(file, resolve) : resolve(null)));
}

export function CropHost() {
  const [ask, setAsk] = useState<{ url: string; resolve: (c: CropRect | null | 'cancel') => void } | null>(null);
  useEffect(() => {
    open = (file, resolve) => setAsk({ url: URL.createObjectURL(file), resolve });
    return () => { open = null; };
  }, []);
  if (!ask) return null;
  const finish = (c: CropRect | null | 'cancel') => { URL.revokeObjectURL(ask.url); setAsk(null); ask.resolve(c); };
  return <Cropper key={ask.url} url={ask.url} onDone={finish} onCancel={() => finish('cancel')} />;
}
