// 上传卡片：首页和做拼豆页共用，卡片放在一块"豆板"上。只留一句话和一个按钮；做拼豆页在卡片顶部放豆板尺寸。
import { useId, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { ARROW_BODY, ARROW_HEAD, ARROW_LINE } from './brushArrow';
import { Logo } from './Logo';

interface Props {
  onFile: (file: File) => void;
  busy?: boolean;
  progress?: string;
  /** 首页上豆板高一些、带标志；做拼豆页紧凑一些 */
  hero?: boolean;
  /** 卡片顶部的额外内容（做拼豆页的豆板尺寸），点它不会打开选图 */
  header?: ReactNode;
}

export function UploadCard({ onFile, busy = false, progress = '', hero = false, header }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, ''); // 页面上可能有两张卡片，滤镜和遮罩的 id 要各用各的
  const pick = () => !busy && input.current?.click();

  return (
    <div className={`pegboard ${hero ? 'hero-board' : ''}`}>
      <div
        className={`drop card ${dragging ? 'over' : ''} ${busy ? 'busy' : ''}`}
        onDragOver={(e: DragEvent) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file && !busy) onFile(file);
        }}
      >
        {header && <div className="drop-head">{header}</div>}
        <div
          className="drop-body"
          onClick={pick}
          role="button"
          tabIndex={0}
          aria-disabled={busy}
          aria-label="上传图片"
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
        >
          {hero && <Logo size={64} animated />}
          <strong>{busy ? progress || '正在处理…' : '拖入、粘贴图片，或点击'}</strong>
          {!busy && (
            <span className="cta">
              <span className="btn primary pill">选择图片</span>
              {/* 手绘毛笔箭头：从「点击」右边出发，一笔弧线指向按钮右侧（留一段距离） */}
              <svg className="cta-arrow" viewBox="0 0 100 76" aria-hidden>
                <defs>
                  <filter id={`rough${uid}`} x="-10%" y="-10%" width="120%" height="120%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
                    <feDisplacementMap in="SourceGraphic" scale="1.1" />
                  </filter>
                  <mask id={`reveal${uid}`} maskUnits="userSpaceOnUse">
                    <path className="cta-reveal" d={ARROW_LINE} pathLength={1} />
                  </mask>
                </defs>
                <g filter={`url(#rough${uid})`} mask={`url(#reveal${uid})`}>
                  <path d={ARROW_BODY} />
                  {ARROW_HEAD.map(d => <path key={d} d={d} />)}
                </g>
              </svg>
            </span>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*,.heic,.heif"
          hidden
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onFile(file);
          }}
        />
      </div>
    </div>
  );
}
