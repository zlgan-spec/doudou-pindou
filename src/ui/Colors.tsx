// 色卡库：MARD 221 色全部色号。按系列看、搜色号或 Hex 色值，点一下复制色号。
import { useMemo, useRef, useState } from 'react';
import { rgbToLab, textColorOn } from '../core/color';
import { matchDistance, PALETTE, type BeadColor } from '../core/palette';
import { rememberCopiedColor } from './handoff';

const SERIES = [...new Set(PALETTE.map(c => c.code.replace(/\d+$/, '')))];
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const NEAREST_COUNT = 8;

function parseHex(q: string): [number, number, number] | null {
  const m = q.trim().match(HEX_RE);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map(ch => ch + ch).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: '拼豆色卡是什么？',
    a: '每个品牌的拼豆都有自己的一套色号，色卡就是色号和颜色的对照表。图纸上写的是色号，备料、配色、找豆都靠它。这里收录的是 MARD 221 色标准色卡，本站生成的图纸也只用这 221 个色号。',
  },
  {
    q: '怎么查色号？',
    a: '三种方式：在上面的搜索框输入色号（如 A1、H7），列出这个色号；输入 Hex 色值（如 #FF6B6B），列出最接近的几个色号；或者点系列标签，按 A 到 M 分组浏览。点任意一张色卡就会复制色号。',
  },
  {
    q: '221 色和 291 色有什么区别？',
    a: '221 色是 MARD 的标准色卡，A 到 M 共 9 个系列，日常拼豆够用，也最好买齐。291 色是完整版，另外多了 P、Q、R、T、Y、ZG 这些特殊系列，比如荧光、透明、夜光色。特殊色不好买齐，熨烫效果也和普通豆不一样，所以本站只用 221 色。',
  },
  {
    q: '屏幕上的颜色和实物豆子不一样？',
    a: '会有差异。屏幕亮度、色温、手机型号都会影响显示，同一个色号不同批次的豆子也会有细微色差。配色拿不准时，以手里的实物豆为准，或者先拼一小块对比。',
  },
  {
    q: '配色有什么技巧？',
    a: '先定 2 到 3 种主色，再配 1 到 2 种辅助色和 1 种点缀色，颜色越少越好拼、越整洁。同一块区域需要明暗时，在同一个系列里挑相邻的色号做深浅，比跨系列混搭更协调。',
  },
];

export function Colors() {
  const [series, setSeries] = useState<string>('全部');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [openQ, setOpenQ] = useState<string | null>(null); // 常见问题里展开的那一条
  const toastTimer = useRef<number>(0);

  // A10、B12、F10 这种既像色号又像 3 位 Hex 的，色号优先；带 # 才一定当 Hex
  const codeHit = !query.trim().startsWith('#') && PALETTE.some(c => c.code.startsWith(query.trim().toUpperCase()));
  const hexRgb = codeHit ? null : parseHex(query);
  const list = useMemo((): Array<BeadColor & { near?: boolean }> => {
    const q = query.trim().toUpperCase();
    if (hexRgb) {
      const lab = rgbToLab(...hexRgb);
      return [...PALETTE].sort((a, b) => matchDistance(lab, a.lab) - matchDistance(lab, b.lab)).slice(0, NEAREST_COUNT).map(c => ({ ...c, near: true }));
    }
    return PALETTE.filter(c => (series === '全部' || c.code.replace(/\d+$/, '') === series) && (!q || c.code.startsWith(q)));
  }, [query, series, hexRgb]);

  const copy = async (code: string) => {
    rememberCopiedColor(code); // 回到做豆图时画笔直接换成这个颜色
    try {
      await navigator.clipboard.writeText(code);
      setToast(`已复制 ${code}`);
    } catch {
      setToast(`色号 ${code}`);
    }
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1400);
  };

  return (
    <>
      <section className="frame-row">
        <div className="cell tool-body">
      {/* 没有页头（和图纸库一样）：标题只给读屏用 */}
      <h1 className="sr-only">MARD 221 色卡</h1>
      <div className="color-tools">
        <label className="search">
          <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜色号或 Hex，如 A1、#FF6B6B" maxLength={8} aria-label="搜索色号或 Hex 色值" />
          {hexRgb && <span className="search-chip" style={{ background: `rgb(${hexRgb.join(',')})` }} />}
        </label>
        <div className="chips" role="tablist" aria-label="系列">
          {['全部', ...SERIES].map(sr => {
            const n = sr === '全部' ? PALETTE.length : PALETTE.filter(c => c.code.replace(/\d+$/, '') === sr).length;
            return (
              <button key={sr} role="tab" aria-selected={series === sr && !hexRgb} className={series === sr && !hexRgb ? 'on' : ''} onClick={() => { setSeries(sr); if (hexRgb) setQuery(''); }}>
                {sr}<small>{n}</small>
              </button>
            );
          })}
          {/* 一句操作说明跟在系列按钮后面，不单独占一行 */}
          {list.length > 0 && <span className="chips-note">{hexRgb ? `和 #${query.trim().replace('#', '').toUpperCase()} 最接近的 ${NEAREST_COUNT} 个，越靠前越接近` : '点色卡即可复制色号'}</span>}
        </div>
      </div>

      {!list.length ? (
        <p className="color-hint">没有以「{query.trim().toUpperCase()}」开头的色号。色号是字母加数字，如 A1、H7。</p>
      ) : (
        <ul className="color-grid">
          {list.map((c, i) => (
            <li key={c.code} style={{ '--i': Math.min(i, 40) } as React.CSSProperties}>
              <button onClick={() => void copy(c.code)} title={`复制 ${c.code}`}>
                <span className="color-chip" style={{ background: c.hex, color: textColorOn(c.hex) }}>{c.near && i === 0 ? '最接近' : ''}</span>
                <span className="color-meta">
                  <b>{c.code}</b>
                  <small>{c.hex.toUpperCase()}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

        </div>
      </section>

      <section className="frame-row">
        <div className="cell pad-lg faq">
        <p className="kicker">常见问题</p>
        <h2 className="title">色卡怎么用</h2>
        <div className="faq-list">
          {FAQ.map(f => (
            <details
              key={f.q}
              open={openQ === f.q}
              onToggle={e => {
                // 同时只展开一个：点开新的，前一个自动收起
                if (e.currentTarget.open) setOpenQ(f.q);
                else if (openQ === f.q) setOpenQ(null);
              }}
            >
              <summary>{f.q}<i aria-hidden /></summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
        </div>
      </section>

      <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">{toast}</div>
    </>
  );
}
