// 边缘清理：按像素画的习惯修掉边缘上的毛病，让轮廓更像人画的。
// 1. 尖刺：长在一大块同色上、只连着 1 颗同色的那颗（直边上鼓出来的一颗）；
// 2. 拐角多余的一颗：细线（一颗宽）在拐弯处多出的那颗，像 ┘ 的尖（Aseprite「pixel-perfect」去掉的就是它）；
// 3. 孤豆：上下左右、斜角都没有同色的一颗。
// 改成它四周最多的那个颜色（可以是空格）。受保护的细节（眼睛、高光）不动；
// 一颗宽的细线（thinLines 找出来的胡子、描边、糖霜线）只去拐角，不当尖刺、孤豆删，不会被削短、打断。
// 另有 regularizeEdges：把大色块边上长短乱跳的台阶按直线 / 弧线重画（见文件后半）。
import { labDistance } from './color';
import { colorOf } from './palette';

type Codes = (string | null)[];

const N4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 细线：一颗宽、至少连着 3 颗、和两侧明暗差得开的线（猫胡子、描边、糖霜线）。
// 同一条线常常由两三个相近色号拼成（糖霜的浅蓝、淡紫、灰白），色差小于 LINE_KIN 的当成同一条线。
const LINE_KIN = 0.1;
const LINE_MIN_LENGTH = 3;
const LINE_CONTRAST = 0.15;

const lightness = (code: string) => colorOf(code).lab[0];

function kinOf() {
  const cache = new Map<string, boolean>();
  return (a: string | null | undefined, b: string | null | undefined): boolean => {
    if (!a || !b) return false;
    if (a === b) return true;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    let v = cache.get(k);
    if (v === undefined) cache.set(k, (v = labDistance(colorOf(a).lab, colorOf(b).lab) < LINE_KIN));
    return v;
  };
}

/**
 * 找出一颗宽的细线：不在任何一个 2×2 同色（含相近色）方块里的格子算「细」，
 * 细格按八连通、相近色连成一条，跨度至少 3 格、平均和两侧的明暗差够大，才算线。
 * 尖刺、孤豆、毛发纹理里随机的一颗宽碎片多半不满足长度或明暗差。
 */
export function thinLines(codes: Codes, w: number, h: number): { line: Uint8Array; lines: number[][] } {
  const kin = kinOf();
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? codes[y * w + x] : null);
  const thin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = codes[y * w + x];
      if (!c) continue;
      let block = false;
      for (let oy = -1; oy <= 0 && !block; oy++) {
        for (let ox = -1; ox <= 0 && !block; ox++) {
          block = kin(c, at(x + ox, y + oy)) && kin(c, at(x + ox + 1, y + oy)) && kin(c, at(x + ox, y + oy + 1)) && kin(c, at(x + ox + 1, y + oy + 1));
        }
      }
      if (!block) thin[y * w + x] = 1;
    }
  }
  const line = new Uint8Array(w * h);
  const lines: number[][] = [];
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!thin[start] || seen[start]) continue;
    const comp = [start];
    seen[start] = 1;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (thin[j] && !seen[j] && kin(codes[i], codes[j])) {
            seen[j] = 1;
            comp.push(j);
          }
        }
      }
    }
    if (comp.length < LINE_MIN_LENGTH) continue;
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    let contrast = 0, n = 0;
    for (const i of comp) {
      const x = i % w, y = (i - x) / w;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      let sum = 0, m = 0;
      for (const [dx, dy] of N4) {
        const c = at(x + dx, y + dy);
        if (c && !kin(codes[i], c)) {
          sum += lightness(c);
          m++;
        }
      }
      if (m) {
        contrast += Math.abs(sum / m - lightness(codes[i]!));
        n++;
      }
    }
    if (Math.max(x1 - x0, y1 - y0) + 1 < LINE_MIN_LENGTH || !n || contrast / n < LINE_CONTRAST) continue;
    for (const i of comp) line[i] = 1;
    lines.push(comp);
  }
  return { line, lines };
}

export function tidyEdges(codes: Codes, w: number, h: number, keep: Uint8Array): Codes {
  let out = codes.slice();
  // 细线只去拐角多出的那颗，不当尖刺、孤豆删：否则胡子、描边会被削短、打断
  const { line, lines } = thinLines(codes, w, h);
  // 一条线由几个相近色号拼成时统一成用得最多的那个，拼的时候一条线一种豆
  for (const comp of lines) {
    const tally = new Map<string, number>();
    for (const i of comp) tally.set(out[i]!, (tally.get(out[i]!) ?? 0) + 1);
    if (tally.size < 2) continue;
    const [main, n] = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (n * 2 < comp.length) continue;
    for (const i of comp) if (!keep[i]) out[i] = main;
  }
  const at = (g: Codes, x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? g[y * w + x] : undefined);
  const same4 = (g: Codes, x: number, y: number) => {
    const c = g[y * w + x];
    return N4.filter(([dx, dy]) => at(g, x + dx, y + dy) === c);
  };
  // 四周（不含自己的颜色）出现最多的颜色，至少要出现 need 次
  const majority = (g: Codes, x: number, y: number, need: number): string | null | undefined => {
    const c = g[y * w + x];
    const tally = new Map<string | null, number>();
    for (const [dx, dy] of N4) {
      const n = at(g, x + dx, y + dy);
      if (n === undefined || n === c) continue;
      tally.set(n, (tally.get(n) ?? 0) + 1);
    }
    let best: string | null | undefined, bestN = 0;
    for (const [k, n] of tally) if (n > bestN) [best, bestN] = [k, n];
    return bestN >= need ? best : undefined;
  };
  // 细线拐角：两个同色邻居一横一竖、夹着的斜角不是同色，且两个邻居本身也是细线
  const corner = (g: Codes, x: number, y: number) => {
    const c = g[y * w + x];
    const same = same4(g, x, y);
    if (same.length !== 2) return false;
    const [[ax, ay], [bx, by]] = same;
    return ax !== bx && ay !== by && at(g, x + ax + bx, y + ay + by) !== c && same4(g, x + ax, y + ay).length <= 2 && same4(g, x + bx, y + by).length <= 2;
  };

  for (let round = 0; round < 2; round++) {
    const next = out.slice();
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const c = out[i];
        if (!c || keep[i] || line[i]) continue;
        const same = same4(out, x, y);
        let to: string | null | undefined;
        if (same.length === 1) {
          // 尖刺：唯一的同色邻居自己连着一大片（至少 3 个同色邻居），这颗才算鼓出来的
          const [dx, dy] = same[0];
          if (same4(out, x + dx, y + dy).length >= 3) to = majority(out, x, y, 2);
        } else if (same.length === 0) {
          let diag = false;
          for (const dx of [-1, 1]) for (const dy of [-1, 1]) if (at(out, x + dx, y + dy) === c) diag = true;
          if (!diag) to = majority(out, x, y, 2);
        }
        if (to !== undefined && to !== c) {
          next[i] = to;
          changed = true;
        }
      }
    }
    // 拐角逐颗就地改：一段每步都带拐角的台阶线，相邻两颗不能同时去掉，否则线会断
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!next[i] || keep[i] || !corner(next, x, y)) continue;
        const to = majority(next, x, y, 2);
        if (to !== undefined && to !== next[i]) {
          next[i] = to;
          changed = true;
        }
      }
    }
    out = next;
    if (!changed) break;
  }
  return out;
}

// 台阶规整：色块边界上的台阶长短乱跳（2、4、3、1…）时，按拟合出的直线或弧线重新画这一段台阶。
// 横着扫一遍处理陡的边、竖着扫一遍处理平的边：每一行里一个色块的左（右）边缘，和下一行相差不超过 2 格的
// 连成一条边。整条边拟合一条直线（弧线用二次曲线，台阶长度会单调变化，正是像素画画弧线的规矩），
// 四舍五入得到新的边缘位置；每行最多挪 1 格、挪动的行不超过 REG_MAX_CHANGE 才采用，
// 否则在偏离直线最远处断开（那里多半是拐角），两段各自再试。拐角因此不会被抹圆。
// 边缘算在两侧里面积大的那块上：大块的轮廓才需要规整，对面常常是好几种颜色拼的。
// 不动：细线、小色块（眼睛、高光、腮红这类，两侧任一块小于 REG_MIN_SHARE 都不动）、
// 小色块里受保护的细节格，以及会把某一行里的一段色挪没、或者会添出新尖刺 / 拐角 / 孤豆的格子。
const REG_MIN_CHAIN = 6;
const REG_MAX_CHANGE = 0.25;
const REG_LINK = 2;
const REG_MIN_REGION = 20;
const REG_MIN_SHARE = 0.015;

interface Edge {
  u: number;
  c: string;
}

interface Curve {
  a: number;
  b: number;
  c: number;
  changes: number;
}

export function regularizeEdges(codes: Codes, w: number, h: number, keep: Uint8Array): Codes {
  const minRegion = Math.max(REG_MIN_REGION, Math.round(w * h * REG_MIN_SHARE));
  const out = codes.slice();
  const { line } = thinLines(codes, w, h);
  for (const across of [false, true]) {
    // across = false：按行扫，u 是列号、v 是行号；true：按列扫，u 是行号、v 是列号
    const U = across ? h : w, V = across ? w : h;
    const idx = (u: number, v: number) => (across ? u * w + v : v * w + u);
    const get = (u: number, v: number) => (u >= 0 && u < U ? out[idx(u, v)] : undefined);
    const area = regionAreas(out, w, h);
    const areaAt = (u: number, v: number) => (u >= 0 && u < U && out[idx(u, v)] ? area[idx(u, v)] : Infinity);

    // 把第 v 行的边缘从 p 挪到 q（只差 1 格）：挪过去的那颗换成边缘另一侧的颜色
    const move = (v: number, p: number, q: number) => {
      const u = q > p ? p : p - 1;  // 换色的那颗
      const src = q > p ? p - 1 : p; // 换成这颗的颜色
      const i = idx(u, v);
      const from = out[i], to = get(src, v)!;
      if (from === to || line[i]) return;
      if (areaAt(u, v) < minRegion || areaAt(src, v) < minRegion) return;
      if (keep[i] && areaAt(u, v) < minRegion * 4) return;
      if (get(q > p ? u + 1 : u - 1, v) !== from) return; // 失去这颗的那段色在本行至少还剩 1 颗
      const before = defectsAround(out, w, h, i);
      out[i] = to;
      if (defectsAround(out, w, h, i) > before) out[i] = from;
    };

    // 给定 b、c，常数项在 a0 上下半格内按 0.05 微调，找挪动最少的画法；有一行要挪 2 格以上就不行
    const tryCurve = (list: Edge[], s: number, e: number, b: number, c: number, a0: number): Curve | null => {
      let best: Curve | null = null;
      for (let o = -10; o <= 10; o++) {
        const a = a0 + o * 0.05;
        let changes = 0, ok = true;
        for (let k = s; k < e && ok; k++) {
          const d = Math.abs(Math.round(a + b * k + c * k * k) - list[k].u);
          if (d > 1) ok = false;
          else if (d) changes++;
        }
        if (ok && (!best || changes < best.changes)) best = { a, b, c, changes };
      }
      return best;
    };

    const fit = (list: Edge[], v0: number, s: number, e: number) => {
      const n = e - s;
      if (n < REG_MIN_CHAIN) return;
      let st = 0, su = 0, stt = 0, stu = 0;
      for (let k = s; k < e; k++) {
        st += k;
        su += list[k].u;
        stt += k * k;
        stu += k * list[k].u;
      }
      const den = n * stt - st * st;
      const lsq = den ? (n * stu - st * su) / den : 0;
      const candidates: Array<Curve | null> = [];
      // 直线：最小二乘定斜率，上下各试 15%
      for (let ds = -3; ds <= 3; ds++) {
        const slope = lsq * (1 + ds * 0.05);
        candidates.push(tryCurve(list, s, e, slope, 0, (su - slope * st) / n));
      }
      // 弧线：二次曲线
      const quad = n >= REG_MIN_CHAIN + 2 ? quadFit(list, s, e) : null;
      if (quad) candidates.push(tryCurve(list, s, e, quad[1], quad[2], quad[0]));
      let best: Curve | null = null;
      for (const cand of candidates) if (cand && (!best || cand.changes < best.changes)) best = cand;
      if (best && best.changes <= Math.floor(n * REG_MAX_CHANGE)) {
        for (let k = s; k < e; k++) {
          const q = Math.round(best.a + best.b * k + best.c * k * k);
          if (q !== list[k].u) move(v0 + k, list[k].u, q);
        }
        return;
      }
      // 在偏离最小二乘直线最远处断开（多半是拐角），两段各自再试
      const icpt = (su - lsq * st) / n;
      let cut = -1, cutD = -1;
      for (let k = s + 1; k < e - 1; k++) {
        const d = Math.abs(icpt + lsq * k - list[k].u);
        if (d > cutD) [cut, cutD] = [k, d];
      }
      if (cut - s < 2 || e - cut < 2) cut = (s + e) >> 1;
      fit(list, v0, s, cut);
      fit(list, v0, cut, e);
    };

    for (const side of [0, 1]) {
      // side 0：色块在边缘左侧（这是它的右边缘）；side 1：色块在右侧（它的左边缘）
      const chains: Array<{ v0: number; list: Edge[] }> = [];
      let open: typeof chains = [];
      for (let v = 0; v < V; v++) {
        const here: Edge[] = [];
        for (let u = 1; u < U; u++) {
          const a = get(u - 1, v)!, b = get(u, v)!;
          if (a === b) continue;
          const own = side === 0 ? a : b, other = side === 0 ? b : a;
          if (own === null) continue;
          const ownArea = side === 0 ? areaAt(u - 1, v) : areaAt(u, v);
          const otherArea = side === 0 ? areaAt(u, v) : areaAt(u - 1, v);
          // 只记属于面积大那一侧的边缘（一样大时算左侧的；对面是空格时总算这一侧的）
          if (other !== null && (otherArea > ownArea || (otherArea === ownArea && side === 1))) continue;
          here.push({ u, c: own });
        }
        const next: typeof open = [];
        const used = new Set<number>();
        for (const chain of open) {
          const last = chain.list[chain.list.length - 1];
          let best = -1, bestD = REG_LINK + 1;
          here.forEach((e, k) => {
            const d = Math.abs(e.u - last.u);
            if (!used.has(k) && e.c === last.c && d < bestD) [best, bestD] = [k, d];
          });
          if (best < 0) {
            chains.push(chain);
            continue;
          }
          used.add(best);
          chain.list.push(here[best]);
          next.push(chain);
        }
        here.forEach((e, k) => {
          if (!used.has(k)) next.push({ v0: v, list: [e] });
        });
        open = next;
      }
      chains.push(...open);
      for (const { v0, list } of chains) fit(list, v0, 0, list.length);
    }
  }
  return out;
}

/** 这颗和上下左右四颗里，有几颗是尖刺 / 孤豆（同色邻居不到 2 个）或细线拐角 */
function defectsAround(g: Codes, w: number, h: number, i: number): number {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? g[y * w + x] : undefined);
  const x0 = i % w, y0 = (i - x0) / w;
  let n = 0;
  for (const [ox, oy] of [[0, 0], ...N4]) {
    const x = x0 + ox, y = y0 + oy;
    const c = at(x, y);
    if (!c) continue;
    const same = N4.filter(([dx, dy]) => at(x + dx, y + dy) === c);
    if (same.length <= 1) n++;
    else if (same.length === 2) {
      const [[ax, ay], [bx, by]] = same;
      if (ax !== bx && ay !== by && at(x + ax + bx, y + ay + by) !== c) n++;
    }
  }
  return n;
}

/** 最小二乘二次拟合 u ≈ a + b·k + c·k²（k 从 s 到 e − 1），返回 [a, b, c] */
function quadFit(list: Edge[], s: number, e: number): [number, number, number] | null {
  // 以区间中点为原点算，数值更稳，最后换回 k 的系数
  const m = (s + e - 1) / 2;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
  for (let k = s; k < e; k++) {
    const t = k - m, u = list[k].u;
    s0++;
    s1 += t;
    s2 += t * t;
    s3 += t * t * t;
    s4 += t * t * t * t;
    y0 += u;
    y1 += t * u;
    y2 += t * t * u;
  }
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (Math.abs(det) < 1e-9) return null;
  const A = (y0 * (s2 * s4 - s3 * s3) - s1 * (y1 * s4 - s3 * y2) + s2 * (y1 * s3 - s2 * y2)) / det;
  const B = (s0 * (y1 * s4 - y2 * s3) - y0 * (s1 * s4 - s3 * s2) + s2 * (s1 * y2 - y1 * s2)) / det;
  const C = (s0 * (s2 * y2 - s3 * y1) - s1 * (s1 * y2 - s3 * y0) + y0 * (s1 * s3 - s2 * s2)) / det;
  // u = A + B·(k − m) + C·(k − m)²
  return [A - B * m + C * m * m, B - 2 * C * m, C];
}

/** 每格所在同色四连通块的大小 */
function regionAreas(codes: Codes, w: number, h: number): Int32Array {
  const area = new Int32Array(w * h);
  const seen = new Uint8Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !codes[s]) continue;
    const comp = [s];
    seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w, y = (i - x) / w;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!seen[j] && codes[j] === codes[i]) {
          seen[j] = 1;
          comp.push(j);
        }
      }
    }
    for (const i of comp) area[i] = comp.length;
  }
  return area;
}
