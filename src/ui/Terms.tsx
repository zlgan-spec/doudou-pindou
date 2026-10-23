// 用户协议（含隐私说明）：页脚进入。写给普通用户看，短句、不堆法律腔；不构成法律意见。
// 改了内容就同时改 UPDATED 日期，重要变化在页面上明显提示（协议第 7 节这么承诺的）。
import type { CSSProperties, ReactNode } from 'react';

const REPO_ISSUES = 'https://github.com/zlgan-spec/doudou-pindou/issues';
const VERSION = '2026-10-20';
const UPDATED = '2026-10-20';

const issues = <a href={REPO_ISSUES} target="_blank" rel="noreferrer">GitHub Issues</a>;

const SECTIONS: Array<{ title: string; body: ReactNode[] }> = [
  {
    title: '01 · 服务说明',
    body: [
      'DouDou 免费使用，不需要注册账号。',
      '所有功能都在你的浏览器里运行：识别图片、抠图、生成和编辑图纸都在你的设备上完成，不经过我们的服务器。',
    ],
  },
  {
    title: '02 · 你上传的图片',
    body: [
      '你上传的图片只在浏览器本地处理，不会上传，我们也看不到。',
      '请确保你有权使用上传的图片。动漫角色、品牌形象和他人创作的作品可能受版权或商标保护。',
      'DouDou 只提供转换工具，不授予原图的使用权。因上传、使用或传播图片及生成的图纸而产生的侵权责任，由使用者依法承担。',
    ],
  },
  {
    title: '03 · 生成的图纸',
    body: [
      '生成图纸不代表获得了原图的版权或商业使用授权。涉及他人作品时，公开传播、售卖或其他商业使用前请先取得授权。',
      '色号按 MARD 公开色卡换算，屏幕颜色和实物会有差异，用量请以实物为准。',
    ],
  },
  {
    title: '04 · 图纸库',
    body: [
      '图纸库中的作品会尽可能注明作者和出处，仅供个人学习和手作参考，不代表已获得商业使用授权。',
      <>如果你是作品的权利人，认为某张图纸侵犯了你的权益，请通过 {issues} 告诉我们，附上作品链接和权属说明。核实后我们会尽快移除。</>,
    ],
  },
  {
    title: '05 · 隐私',
    body: [
      '我们不收集你的个人信息：没有账号，不使用统计 Cookie 或第三方分析工具，也不会把你的图片和操作发给任何第三方。',
      '你的收藏、未保存的草稿、深浅色偏好和界面设置，只保存在当前浏览器的本地存储里，我们看不到。清除浏览器数据会把它们一并删除，换设备前请先在「我的收藏」导出备份。',
      '网站托管在 GitHub Pages 上，GitHub 可能按其隐私政策记录访问日志（例如 IP 地址），这部分由 GitHub 处理。',
    ],
  },
  {
    title: '06 · 开源与商标',
    body: [
      'DouDou 的源代码采用 MIT 协议开源，用到的第三方组件和字体按各自的协议使用，详见网页底部和项目仓库。',
      'MARD 是其权利人的商标。DouDou 是独立开发的项目，与 MARD 没有官方关联。',
    ],
  },
  {
    title: '07 · 免责与变更',
    body: [
      '工具按现状提供。我们会尽力保证正常运行，但不保证转换结果完全准确，或适用于所有用途。在法律允许的范围内，我们不对使用本工具造成的损失承担责任。',
      '我们可能更新功能或调整服务。你的收藏都存在你自己的浏览器里，不会因为网站更新而被删除。',
      '协议更新时会修改顶部的更新日期，重要变化会在页面上明显提示。',
    ],
  },
  {
    title: '08 · 联系我们',
    body: [
      <>遇到问题、发现侵权内容，或者有任何建议，都欢迎通过 {issues} 告诉我们。</>,
      '感谢你使用 DouDou，也期待我们一起创作更多好玩有趣的作品。❤️',
    ],
  },
];

export function Terms({ backHash = '#/' }: { backHash?: string }) {
  return (
    <>
      <section className="frame-row">
        {/* 页头：返回、标题、版本日期，下面两段开头说明 */}
        <div className="cell tool-hero terms-hero">
          <a className="back-link" href={backHash}>← 返回</a>
          <h1 className="title enter">DouDou 用户协议</h1>
          <p className="terms-version enter" style={{ '--d': 1 } as CSSProperties}>版本：{VERSION}　更新日期：{UPDATED}</p>
          <p className="lede enter" style={{ '--d': 2 } as CSSProperties}>
            欢迎使用 DouDou。DouDou 是一个免费、开源的拼豆图纸工具，由个人开发者维护（以下简称“我们”），提供图片转拼豆图纸、在线编辑图纸、现成图纸库和 MARD 色卡查询等功能。
          </p>
          <p className="lede enter" style={{ '--d': 3 } as CSSProperties}>
            请在使用前阅读本协议，特别是第 2 至 4 节关于图片和作品版权的说明。如有疑问，可以通过 {issues} 联系我们。
          </p>
        </div>
      </section>
      <section className="frame-row">
        {/* 每节一行：左边标题、右边正文，铺满宽度，正文行宽保持好读 */}
        <div className="cell tool-body terms">
          {SECTIONS.map(s => (
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
