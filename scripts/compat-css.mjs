// 构建后给 CSS 补老安卓（Chrome 61）的回退写法。官方 Skill 的做法：同一属性「旧值在前、新值在后」，
// 新浏览器用后面的新写法，Chrome 61 看不懂新写法就丢掉那一条、留下前面的旧值。只加回退，不改原来的规则。
//
// 1. min() / max() / clamp() / dvh / color-mix()：在前面插一条 Chrome 61 能懂的近似值
//    - 手机优先：min(固定值, 相对值) 取相对值（窄屏上通常是它生效）；max(下限, …) 取下限；clamp(a, b, c) 取 b
//    - dvh 换成 vh；color-mix 换成接近的半透明色
// 2. gap：Grid 补 grid-gap（Chrome 61 认识），Flex 的 gap 由页面加的 .no-flex-gap 类用 margin 补
//    （见 src/ui/compat.ts 的检测）

const MODERN = /(?<![-\w])(min|max|clamp)\(|dvh|color-mix\(/;

/** 拆出一层函数的参数（顶层逗号分开） */
function args(inner) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** 找到第一个 name( 的完整范围 */
function findCall(value, names) {
  const re = new RegExp(`(?<![-\\w])(${names.join('|')})\\(`);
  const m = re.exec(value);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[1].length; i < value.length; i++) {
    if (value[i] === '(') depth++;
    if (value[i] === ')') { depth--; if (depth === 0) return { start: m.index, end: i + 1, name: m[1], inner: value.slice(m.index + m[1].length + 1, i) }; }
  }
  return null;
}

const wrap = v => (/\s[-+*/]\s/.test(v) && !/^calc\(/.test(v) ? `calc(${v})` : v);
const relative = v => /%|vw|vh|vmin|vmax|em\b|rem\b/.test(v);

function pick(name, list) {
  if (name === 'clamp') return wrap(list[1]);
  if (name === 'max') return wrap(list[0]);
  // min：取带相对单位的那个（窄屏上一般是它）
  const rel = list.find(relative);
  return wrap(rel ?? list[0]);
}

function colorMixFallback(inner) {
  const [, a, b] = args(inner);
  const pct = Number((/(\d+)%/.exec(a) || [])[1] || 50) / 100;
  if (/transparent/.test(b)) return `rgba(128,128,128,${Math.min(0.5, pct).toFixed(2)})`;
  return (/var\(--[\w-]+\)/.exec(b) || ['rgba(128,128,128,.3)'])[0];
}

function fallbackValue(value) {
  let v = value;
  for (let guard = 0; guard < 20; guard++) {
    const call = findCall(v, ['min', 'max', 'clamp', 'color-mix']);
    if (!call) break;
    const rep = call.name === 'color-mix' ? colorMixFallback(call.inner) : pick(call.name, args(call.inner));
    v = v.slice(0, call.start) + rep + v.slice(call.end);
  }
  v = v.replace(/(\d)dvh/g, '$1vh');
  return MODERN.test(v) ? null : v;
}

/** 声明列表 "a:b;c:d" → 插好回退的新声明列表；自定义属性的回退另外收在 vars 里 */
function patchDecls(decls, vars) {
  const parts = decls.split(/;(?![^(]*\))/);
  const out = [];
  for (const d of parts) {
    const i = d.indexOf(':');
    if (i < 0) { out.push(d); continue; }
    const prop = d.slice(0, i), val = d.slice(i + 1);
    if (/^--/.test(prop.trim())) {
      // 自定义属性：Chrome 61 会照存变量值，用的地方才算错，没法「旧值在前」；回退值放进 @supports not 里单独给
      const fb = MODERN.test(val) ? fallbackValue(val) : null;
      if (fb) vars.push(`${prop}:${fb}`);
      out.push(d);
      continue;
    }
    const fb = MODERN.test(val) ? fallbackValue(val) : null;
    if (fb) out.push(`${prop}:${fb}`);
    // Grid 的 gap 在 Chrome 61 只认 grid-* 前缀写法
    const alias = { gap: 'grid-gap', 'row-gap': 'grid-row-gap', 'column-gap': 'grid-column-gap' }[prop.trim()];
    if (alias) out.push(`${alias}:${fb ?? val}`);
    out.push(d);
  }
  return out.join(';');
}

export function compatCss(css) {
  // 先收集：哪些选择器是 grid、哪些是竖排 flex（gap 的 margin 方向要看它）
  const gridSel = new Set(), colSel = new Set();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map(s => s.trim());
    if (/display:(inline-)?grid/.test(m[2])) sels.forEach(s => gridSel.add(s));
    if (/flex-direction:column/.test(m[2])) sels.forEach(s => colSel.add(s));
  }
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (all, sel, decls) => {
    const s = sel.trim();
    if (/^(\d|from|to)/.test(s)) return all; // @keyframes 的帧
    const vars = [];
    let rule = `${sel}{${patchDecls(decls, vars)}}`;
    if (vars.length) rule += `@supports not (width:min(1px,2px)){${s}{${vars.join(';')}}}`;
    // Flex 的 gap：.no-flex-gap 下用 margin 补（只补单值和「行 列」两值写法）
    const g = /(?:^|;)gap:([^;]+)/.exec(decls);
    if (g && !/display:(inline-)?grid/.test(decls)) {
      const sels = s.split(',').map(x => x.trim()).filter(x => !gridSel.has(x) && !/::/.test(x));
      if (sels.length) {
        const [rowGap, colGap = rowGap] = g[1].trim().split(/\s+/);
        const column = /flex-direction:column/.test(decls) || sels.every(x => colSel.has(x));
        const side = column ? `margin-top:${rowGap}` : `margin-left:${colGap}`;
        rule += `${sels.map(x => `.no-flex-gap ${x}>*+*`).join(',')}{${side}}`;
      }
    }
    return rule;
  });
}
