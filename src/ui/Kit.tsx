// 组件页（只在本地开发时有，网址 #/kit，不进正式版）：档位和现有组件都摆在这里，新增组件先在这里登记一份。
// 数值不在这里写第二遍：档位从 styles.css 的变量里现读，组件直接用正式的 class。
// 规则：字号、圆角、阴影只从档位取，间距用 2 / 4 的倍数（tests/style-scale.test.ts 会查）。
import type { CSSProperties, ReactNode } from 'react';

const TEXT = ['--text-xs', '--text-s', '--text-m', '--text-l', '--text-xl', '--title-s', '--title-m', '--title-l'];
const RADIUS = ['--radius-2xs', '--radius-xs', '--radius-s', '--radius', '--radius-pill'];
const SHADOW = ['--shadow-0', '--shadow-1', '--shadow-2', '--shadow-3', '--shadow-up', '--ring-focus', '--ring-selected', '--ring-line', '--edge-inset'];
const CONTROL = ['--control-s', '--control-m', '--control-l'];
const COLOR = ['--bg', '--surface', '--card', '--fill', '--line', '--faint', '--muted', '--ink', '--danger'];

const valueOf = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 };
const box: CSSProperties = { width: 96, height: 56, border: '1px solid var(--line)', background: 'var(--surface)' };
const still: CSSProperties = { position: 'static', transform: 'none', opacity: 1, margin: 0 };

// 一小块像素图，给卡片和文件夹当示例图
const THUMB = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" shape-rendering="crispEdges"><rect width="4" height="4" fill="#fbe7c6"/><rect x="1" y="1" width="2" height="2" fill="#f7a072"/><rect x="1" y="1" width="1" height="1" fill="#0a0a0a"/><rect x="2" y="2" width="1" height="1" fill="#0a0a0a"/></svg>')}`;

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="res-section" style={{ maxWidth: 'none', marginBottom: 40 }}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Token({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {children}
      <small style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>{name}<br />{valueOf(name)}</small>
    </div>
  );
}

export default function Kit() {
  return (
    <section className="frame-row">
      <div className="cell tool-body">
        <h1 className="title" style={{ marginBottom: 32 }}>组件页</h1>

        <Block title="字号">
          {TEXT.map(n => <p key={n} style={{ margin: 0, fontSize: `var(${n})` }}>拼豆图纸 DouDou 52×52　<span style={{ color: 'var(--muted)' }}>{n} · {valueOf(n)}</span></p>)}
        </Block>

        <Block title="圆角">
          <div style={row}>{RADIUS.map(n => <Token key={n} name={n}><div style={{ ...box, borderRadius: `var(${n})` }} /></Token>)}</div>
        </Block>

        <Block title="阴影和描边环">
          <div style={{ ...row, gap: 32 }}>{SHADOW.map(n => <Token key={n} name={n}><div style={{ ...box, border: 0, borderRadius: 'var(--radius-s)', boxShadow: `var(${n})` }} /></Token>)}</div>
        </Block>

        <Block title="控件高度">
          <div style={row}>{CONTROL.map(n => <Token key={n} name={n}><div style={{ width: 96, height: `var(${n})`, borderRadius: 'var(--radius-pill)', background: 'var(--fill)' }} /></Token>)}</div>
        </Block>

        <Block title="颜色">
          <div style={row}>{COLOR.map(n => <Token key={n} name={n}><div style={{ ...box, width: 72, height: 44, borderRadius: 'var(--radius-s)', background: `var(${n})` }} /></Token>)}</div>
        </Block>

        <Block title="按钮">
          <div style={row}>
            <button className="btn">默认</button>
            <button className="btn primary">主按钮</button>
            <button className="btn soft">浅底</button>
            <button className="btn link">文字按钮</button>
            <button className="btn pill">胶囊</button>
            <button className="btn primary pill">胶囊主按钮</button>
            <button className="btn small">小号</button>
            <button className="btn pill" aria-pressed>已按下</button>
            <button className="btn" disabled>不可点</button>
          </div>
        </Block>

        <Block title="分段选择">
          <div style={row}>
            <div className="seg" role="radiogroup"><button className="on">自适应</button><button>52×52</button><button>78×78</button></div>
            <div className="seg mini" role="radiogroup"><button className="on">贴纸</button><button>写实</button></div>
          </div>
        </Block>

        <Block title="筛选标签">
          <div className="chips"><button className="on">全部<small>276</small></button><button>动漫<small>82</small></button><button>动物<small>103</small></button></div>
          <div className="chips sub"><button className="on">猫咪<small>40</small></button><button>杯垫<small>12</small></button></div>
        </Block>

        <Block title="搜索框和下拉">
          <div className="search-row" style={{ maxWidth: 560 }}>
            <label className="search">
              <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input placeholder="搜名字或系列" aria-label="搜索示例" />
            </label>
            <select className="size-pick" aria-label="下拉示例"><option>全部尺寸</option><option>52×52</option></select>
          </div>
        </Block>

        <Block title="开关">
          <div style={{ ...row, maxWidth: 480 }}>
            <button className="switch-row" role="switch" aria-checked style={{ flex: 1 }}><span><b>描边</b></span><i aria-hidden /></button>
            <button className="switch-row" role="switch" aria-checked={false} style={{ flex: 1 }}><span><b>镜像</b></span><i aria-hidden /></button>
          </div>
        </Block>

        <Block title="卡片">
          <ul className="color-grid" style={{ maxWidth: 560 }}>
            <li><button><span className="color-chip" style={{ background: '#f7a072' }} /><span className="color-meta"><b>A7</b><small>#F7A072</small></span></button></li>
            <li><button><span className="color-chip" style={{ background: '#0a0a0a' }} /><span className="color-meta"><b>H7</b><small>#0A0A0A</small></span></button></li>
          </ul>
          <ul className="color-grid pattern-grid" style={{ maxWidth: 420 }}>
            <li><button aria-label="图纸卡片示例"><span className="color-chip pattern-thumb"><img src={THUMB} alt="" /></span></button></li>
          </ul>
        </Block>

        <Block title="文件夹">
          <ul className="folder-grid" style={{ maxWidth: 440 }}>
            <li>
              <button className="folder" aria-label="文件夹示例">
                <span className="folder-back" aria-hidden />
                <span className="folder-papers" aria-hidden><img src={THUMB} alt="" /><img src={THUMB} alt="" /><img src={THUMB} alt="" /></span>
                <span className="folder-front"><b>再见爱人</b><small>3</small></span>
              </button>
            </li>
            <li>
              <button className="folder" aria-label="文件夹示例">
                <span className="folder-back" aria-hidden />
                <span className="folder-papers" aria-hidden><img src={THUMB} alt="" /></span>
                <span className="folder-front"><b>散装</b><small>1</small></span>
              </button>
            </li>
          </ul>
        </Block>

        <Block title="提示条">
          <div style={row}>
            <div className="toast notice show" style={still}>已存到相册</div>
            <div className="toast notice has-action show" style={still}><span>已取消收藏</span><button>撤销</button></div>
          </div>
        </Block>

        <Block title="对话框">
          <div className="ask" style={still}>
            <h2>换一张图？</h2>
            <p>现在这张还没收藏，换了就找不回来。</p>
            <div className="ask-actions">
              <button className="btn link">取消</button>
              <button className="btn pill">直接换</button>
              <button className="btn primary pill">收藏后再换</button>
            </div>
          </div>
        </Block>

        <Block title="空状态">
          <div className="empty tall"><p>还没有收藏。在 <a href="#/make">做豆图</a> 里点「收藏」，图纸会出现在这里。</p></div>
        </Block>
      </div>
    </section>
  );
}
