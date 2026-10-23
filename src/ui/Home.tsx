// 首页：只有一屏——居中的大标题 + 一句说明 + 按钮；鼠标移动时有坐标十字线跟着（HeroCrosshair），不铺图案。
// 隐藏功能：把图片直接拖进这一屏，松手就去做豆图（粘贴图片在 App 里处理）。
// 回到改版前的样子（左标题 + 右上传卡片）：git 标签 home-before-beadfield；铺满豆子的那版：home-beadfield-try。
import { useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { HeroCrosshair } from './HeroCrosshair';
import { DouWord } from './DouWord';
import { isHeic } from './loadImage';
import { Logo } from './Logo';

interface Props {
  onFile: (file: File) => void;
}

const d = (n: number) => ({ '--d': n }) as CSSProperties;
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

export function Home({ onFile }: Props) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0); // 拖过子元素时 enter/leave 会成对多触发几次，数到 0 才算真的离开

  return (
    <section
      className={`frame-row hero-field ${dragging ? 'over' : ''}`}
      onDragEnter={e => { if (!hasFiles(e)) return; depth.current++; setDragging(true); }}
      onDragOver={e => { if (hasFiles(e)) e.preventDefault(); }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
      onDrop={e => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        const file = e.dataTransfer.files[0];
        // 不是图片（比如拖进来一个文本文件）就不跳转，免得换掉做豆图里已有的图纸
        if (file && (file.type.startsWith('image/') || isHeic(file))) onFile(file);
      }}
    >
      <HeroCrosshair />
      <div className="hero-center">
        <h1 className="display hero-title enter" style={d(1)} aria-label="万物皆可 DOU"><span className="line">万物皆可<DouWord /><span className="title-bead" aria-hidden><Logo size={96} animated /></span></span></h1>
        <p className="lede enter" style={d(2)}><span className="phrase">从一张图片开始</span><span className="phrase">我们和 DouDou 的无限创意</span></p>
        {dragging ? (
          <p className="hero-drop-hint">松手，就用这张图开始</p>
        ) : (
          <div className="hero-actions enter" style={d(3)}>
            <a className="btn primary pill caps" href="#/make">开始做图纸</a>
            <a className="btn link caps" href="#/patterns">看看图纸库<i className="play" aria-hidden /></a>
          </div>
        )}
      </div>
    </section>
  );
}
