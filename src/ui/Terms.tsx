// 用户协议（含隐私说明）：页脚进入。内容按渠道写在 platform.copy.terms 里（网站版和小工具版的存储位置、联系方式、开源说明不一样）。
// 改了内容就同时改那边的 updated 日期，重要变化在页面上明显提示（协议第 7 节这么承诺的）。
import { platform } from '@platform';
import type { CSSProperties } from 'react';

export function Terms({ backHash = '#/' }: { backHash?: string }) {
  const { version, updated, intro, readFirst, sections } = platform.copy.terms;
  return (
    <>
      <section className="frame-row">
        {/* 页头：返回、标题、版本日期，下面两段开头说明 */}
        <div className="cell tool-hero terms-hero">
          <a className="back-link" href={backHash}>← 返回</a>
          <h1 className="title enter">DouDou 用户协议</h1>
          <p className="terms-version enter" style={{ '--d': 1 } as CSSProperties}>版本：{version}　更新日期：{updated}</p>
          <p className="lede enter" style={{ '--d': 2 } as CSSProperties}>{intro}</p>
          <p className="lede enter" style={{ '--d': 3 } as CSSProperties}>{readFirst}</p>
        </div>
      </section>
      <section className="frame-row">
        {/* 每节一行：左边标题、右边正文，铺满宽度，正文行宽保持好读 */}
        <div className="cell tool-body terms">
          {sections.map(s => (
            <section key={s.title}>
              <h2>{s.title}</h2>
              <div>{s.body.map((p, i) => <p key={i}>{p}</p>)}</div>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}
