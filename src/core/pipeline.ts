// 出图流水线：图片 + 主体蒙版 → 放在整块豆板上的格子表格。
// 步骤：取样 → 偏色修正和风格 → 按色族减色 → 每格投票 → 清理（保护关键细节）→ 勾轮廓 → 放到豆板。
import { regularizeEdges, tidyEdges } from './contour';
import { classifyInput, hasOwnOutline, type InputKind } from './classify';
import { capColors, mergeNearDuplicates, mergeRareColors, mergeSmallRegions, protectDetails, removeIslands, detailColors } from './cleanup';
import { chroma, labDistance, rgbToLab, type Lab } from './color';
import { MAX_COLORS, MIN_BEADS_PER_COLOR, SIZES, STYLES, boardArea, fitSide, type SizeId, type StyleId } from './config';
import { connectedRegions, createGrid, legendOf, type Grid } from './grid';
import type { Mask, RgbaImage } from './image';
import { addOutline, type OpenSides } from './outline';
import { colorOf, matchDistance } from './palette';
import { nearest, PALETTE } from './palette';
import { generateFromPhoto } from './photo';

export interface PatternOptions {
  size: SizeId;
  style: StyleId;
  /** 颜色上限；不给就按图自动决定，最多到豆板的上限（贴纸风 autoMaxColors、写实风 realisticMaxColors） */
  maxColors?: number;
  /** 自定义尺寸：图案按比例放进 w×h 颗以内（不留边），再放到能装下它的豆板上；超过 104 用几块 104 板拼。size 只管色数和清理力度 */
  fit?: { w: number; h: number };
}

export interface PatternInput {
  image: RgbaImage;
  mask: Mask | null; // null = 保留背景，整张图都是主体
  /** 已按像素画网格重采样（1 像素 = 1 格）：走保真路径，不平滑、不描边、不改风格 */
  pixelArt?: boolean;
  /** 输入类型；不给就自动判断（pixelArt 为 true 时固定是 pixel） */
  kind?: InputKind;
}

/** 这次输入会走哪条路径 */
export function resolveKind(input: PatternInput): InputKind {
  if (input.pixelArt) return 'pixel';
  return input.kind ?? classifyInput(input.image, input.mask);
}

// ---------- 1. 取样：按 4 倍格子精度取子像素 ----------

const SUB_MAX = 4; // 每格最多 4×4 个子像素

interface WorkImage {
  gw: number;
  gh: number;
  s: number; // 每格 s×s 个子像素
  sub: Lab[];
  subMask: Uint8Array;
  cellSubject: boolean[];
}

/** 主体是否被画框切掉：蒙版贴到了图片的哪几条边 */
function openSides(mask: Mask | null, width: number, height: number): OpenSides {
  const b = maskBounds(mask, width, height);
  return { top: b.y0 === 0, left: b.x0 === 0, right: b.x1 === width, bottom: b.y1 === height };
}

function maskBounds(mask: Mask | null, width: number, height: number) {
  if (!mask) return { x0: 0, y0: 0, x1: width, y1: height };
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask.data[y * width + x] < 0.5) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
    }
  }
  return x1 > x0 ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: width, y1: height };
}

/** 主体区域缩成子像素网格：每个子像素取对应区域里主体像素的平均色（相当于轻微去噪） */
function buildWorkImage(input: PatternInput, maxSide: number): WorkImage {
  const { image, mask } = input;
  const b = maskBounds(mask, image.width, image.height);
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const cell = Math.max(bw, bh) / maxSide;
  const gw = Math.max(1, Math.min(maxSide, Math.round(bw / cell)));
  const gh = Math.max(1, Math.min(maxSide, Math.round(bh / cell)));
  // 超过 104 的大图：原图一颗豆只分到几个像素，子像素再多也是插出来的，按原图能给的来，省时间
  const SUB = maxSide > SIZES.large.board ? Math.max(1, Math.min(SUB_MAX, Math.floor(cell))) : SUB_MAX;
  const sw = gw * SUB, sh = gh * SUB;
  const stepX = bw / sw, stepY = bh / sh;
  const sub: Lab[] = new Array(sw * sh);
  const subMask = new Uint8Array(sw * sh);

  // 细的深色线条（嘴巴、眼线、描边）往往只有一个子像素宽，取平均色会被稀释掉。
  // 每个子像素里如果最暗的四分之一像素明显比平均暗，就按这部分像素取色，让线条留下来。
  const LINE_CONTRAST = 0.18;
  const ls: number[] = [];
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let sy = 0; sy < sh; sy++) {
    const y0 = Math.floor(b.y0 + sy * stepY), y1 = Math.max(y0 + 1, Math.floor(b.y0 + (sy + 1) * stepY));
    for (let sx = 0; sx < sw; sx++) {
      const x0 = Math.floor(b.x0 + sx * stepX), x1 = Math.max(x0 + 1, Math.floor(b.x0 + (sx + 1) * stepX));
      ls.length = rs.length = gs.length = bs.length = 0;
      let total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * image.width + x;
          total++;
          const m = mask ? mask.data[i] : image.data[i * 4 + 3] / 255;
          if (m < 0.5) continue;
          const r = image.data[i * 4], g = image.data[i * 4 + 1], bl = image.data[i * 4 + 2];
          rs.push(r);
          gs.push(g);
          bs.push(bl);
          ls.push(0.2126 * r + 0.7152 * g + 0.0722 * bl);
        }
      }
      const k = sy * sw + sx;
      const n = ls.length;
      subMask[k] = n * 2 >= total && n > 0 ? 1 : 0;
      if (!n) {
        sub[k] = [1, 0, 0];
        continue;
      }
      const order = ls.map((_, i) => i).sort((a, c) => ls[a] - ls[c]);
      const quarter = Math.max(1, Math.floor(n / 4));
      const meanL = ls.reduce((a, c) => a + c, 0) / n;
      const darkL = order.slice(0, quarter).reduce((a, i) => a + ls[i], 0) / quarter;
      const pick = meanL - darkL > LINE_CONTRAST * 255 ? order.slice(0, quarter) : order;
      let r = 0, g = 0, bl = 0;
      for (const i of pick) {
        r += rs[i];
        g += gs[i];
        bl += bs[i];
      }
      sub[k] = rgbToLab(Math.round(r / pick.length), Math.round(g / pick.length), Math.round(bl / pick.length));
    }
  }

  const cellSubject: boolean[] = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let covered = 0;
      for (let dy = 0; dy < SUB; dy++) for (let dx = 0; dx < SUB; dx++) covered += subMask[(gy * SUB + dy) * sw + gx * SUB + dx];
      cellSubject.push(covered * 2 >= SUB * SUB);
    }
  }
  return { gw, gh, s: SUB, sub, subMask, cellSubject };
}

// ---------- 3. 每格投票 ----------

/** 每格 16 个子像素投票：默认取最多的颜色；占 1/4 以上、明显更深的颜色（眼睛、鼻子、嘴、条纹）优先 */
// 取格时往格子外面多看几个子像素：离格子越远权重越小（0 = 格内）
const SMOOTH = 2;
const SMOOTH_WEIGHT = [1, 0.45, 0.2];
const DETAIL_SHARE = 3;
const DETAIL_DARKER = 0.2;

function voteCells(work: WorkImage, subCodes: (string | null)[]): (string | null)[] {
  const { gw, gh, cellSubject, s: SUB } = work;
  const sw = gw * SUB;
  const codes: (string | null)[] = new Array(gw * gh).fill(null);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (!cellSubject[gy * gw + gx]) continue;
      // 格内计数（给深色细节规则用）+ 带上周围半格的加权计数（决定主色）：
      // 相当于先把色块边界轻轻抹圆再取格，边缘的台阶会更均匀，不会 2、4、3 这样乱跳
      const tally = new Map<string, number>();
      const wide = new Map<string, number>();
      for (let dy = -SMOOTH; dy < SUB + SMOOTH; dy++) {
        const sy = gy * SUB + dy;
        if (sy < 0 || sy >= gh * SUB) continue;
        const wy = dy < 0 ? -dy : dy >= SUB ? dy - SUB + 1 : 0;
        for (let dx = -SMOOTH; dx < SUB + SMOOTH; dx++) {
          const sx = gx * SUB + dx;
          if (sx < 0 || sx >= sw) continue;
          const c = subCodes[sy * sw + sx];
          if (!c) continue;
          const wx = dx < 0 ? -dx : dx >= SUB ? dx - SUB + 1 : 0;
          const weight = SMOOTH_WEIGHT[Math.max(wx, wy)];
          wide.set(c, (wide.get(c) ?? 0) + weight);
          if (wx === 0 && wy === 0) tally.set(c, (tally.get(c) ?? 0) + 1);
        }
      }
      let major = '', majorCount = 0;
      for (const [c, n] of wide) if (n > majorCount && tally.has(c)) [major, majorCount] = [c, n];
      if (!major) continue;
      let pick = major, pickL = colorOf(major).lab[0];
      for (const [c, n] of tally) {
        const l = colorOf(c).lab[0];
        if (n >= DETAIL_SHARE && pickL - l >= DETAIL_DARKER) [pick, pickL] = [c, l];
      }
      codes[gy * gw + gx] = pick;
    }
  }
  return codes;
}

/**
 * 五官重新落格：眼睛、眉毛、腮红这类「被一块颜色包住的紧凑小色块」，投票时容易胀成方块（显得呆）。
 * 按原图子像素算出它的面积、中心、朝向和长宽比，用同样面积的圆角矩形重新落格，形状跟着原图走（竖椭圆 → 竖着的 1×2 / 2×3）。
 * 只处理紧凑的（子像素面积 / 外接框面积 ≥ 0.45）：细线（嘴、胡须）不处理，免得断掉
 */
const FEATURE_MAX = 24; // 超过这么多格的色块不算五官
const FEATURE_COMPACT = 0.45;
function refitFeatures(codes: (string | null)[], work: WorkImage, subCodes: (string | null)[]): (string | null)[] {
  const { gw, gh, s: SUB } = work;
  const sw = gw * SUB;
  const out = codes.slice();
  const grid: Grid = { width: gw, height: gh, cells: codes };
  for (const region of connectedRegions(grid, (a, b) => a === b)) {
    if (region.length > FEATURE_MAX) continue;
    const c = codes[region[0]];
    if (!c) continue;
    // 周围（4 邻）最多的颜色就是它所在的那块；碰到空格或边界的不算五官
    const around = new Map<string, number>();
    let open = false;
    const inRegion = new Set(region);
    for (const i of region) {
      const x = i % gw, y = (i - x) / gw;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) { open = true; continue; }
        const n = ny * gw + nx;
        if (inRegion.has(n)) continue;
        const nc = codes[n];
        if (!nc) { open = true; continue; }
        around.set(nc, (around.get(nc) ?? 0) + 1);
      }
    }
    if (open || !around.size) continue;
    const host = [...around].sort((a, b) => b[1] - a[1])[0][0];
    // 五官是被同一块颜色包着的（眼睛在脸上）；四周混着好几种颜色的（描边、糖霜断开的碎块）不算，不动它
    const perimeter = [...around.values()].reduce((a, n) => a + n, 0);
    if ((around.get(host) ?? 0) < perimeter * 0.75) continue;
    // 原图里这块五官往往由几种相近的颜色组成（抗锯齿、深浅），子像素离五官色比离底色近就算五官，面积才不会算小
    const cLab = colorOf(c).lab, hostLab = colorOf(host).lab;
    const near = new Map<string, boolean>();
    const isFeature = (code: string | null) => {
      if (!code) return false;
      if (code === c) return true;
      let v = near.get(code);
      if (v === undefined) {
        const lab = colorOf(code).lab;
        v = matchDistance(lab, cLab) < matchDistance(lab, hostLab);
        near.set(code, v);
      }
      return v;
    };
    // 贴着五官的 1、2 颗相近色（原图边缘抗锯齿留下的过渡色，比如眼睛边上一点紫）：并回底色，不当成单独的五官
    if (region.length <= 2 && [...around.keys()].some(n => n !== host && matchDistance(colorOf(n).lab, colorOf(c).lab) < 0.15)) {
      for (const i of region) out[i] = host;
      continue;
    }
    // 外扩一格的范围里，数每格有多少子像素是这个颜色
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0;
    for (const i of region) { const x = i % gw, y = (i - x) / gw; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(gw - 1, x1 + 1); y1 = Math.min(gh - 1, y1 + 1);
    const cover = new Map<number, number>();
    let total = 0, sx0 = Infinity, sy0 = Infinity, sx1 = -1, sy1 = -1;
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      let n = 0;
      for (let dy = 0; dy < SUB; dy++) for (let dx = 0; dx < SUB; dx++) {
        const sx = gx * SUB + dx, sy = gy * SUB + dy;
        if (!isFeature(subCodes[sy * sw + sx])) continue;
        n++;
        sx0 = Math.min(sx0, sx); sx1 = Math.max(sx1, sx); sy0 = Math.min(sy0, sy); sy1 = Math.max(sy1, sy);
      }
      if (n) cover.set(gy * gw + gx, n / (SUB * SUB));
      total += n;
    }
    if (!total) continue;
    const compact = total / ((sx1 - sx0 + 1) * (sy1 - sy0 + 1));
    if (compact < FEATURE_COMPACT) continue;
    // 原图里这个色块的中心、朝向和长宽比（子像素的二阶矩），单位是格
    let mx = 0, my = 0;
    const pts: Array<[number, number]> = [];
    for (let sy = sy0; sy <= sy1; sy++) for (let sx = sx0; sx <= sx1; sx++) {
      if (!isFeature(subCodes[sy * sw + sx])) continue;
      const px = (sx + 0.5) / SUB, py = (sy + 0.5) / SUB;
      pts.push([px, py]);
      mx += px;
      my += py;
    }
    mx /= pts.length;
    my /= pts.length;
    let cxx = 0, cyy = 0, cxy = 0;
    for (const [px, py] of pts) { cxx += (px - mx) ** 2; cyy += (py - my) ** 2; cxy += (px - mx) * (py - my); }
    cxx /= pts.length; cyy /= pts.length; cxy /= pts.length;
    const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const tr = (cxx + cyy) / 2, det = Math.sqrt(Math.max(0, ((cxx - cyy) / 2) ** 2 + cxy ** 2));
    const ra = Math.sqrt(Math.max(1e-3, tr + det)), rb = Math.sqrt(Math.max(1e-3, tr - det));
    // 形状：正着的用矩形模板（1×2、2×2、2×3…，3×3 以上切角），斜着的长条按椭圆挑格保留倾斜；
    // 位置在附近几格里试，取和原图重合最多的那个
    const want = Math.max(1, Math.round(total / (SUB * SUB)));
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const candidates: number[] = [];
    for (let gy = Math.max(0, Math.floor(my) - 4); gy <= Math.min(gh - 1, Math.floor(my) + 4); gy++) {
      for (let gx = Math.max(0, Math.floor(mx) - 4); gx <= Math.min(gw - 1, Math.floor(mx) + 4); gx++) {
        const i = gy * gw + gx;
        if (codes[i] === c || codes[i] === host) candidates.push(i);
      }
    }
    let pick: number[] = [], bestCover = -1;
    const allowed = new Set(candidates);
    const tilted = ra / rb >= 1.6 && Math.abs(Math.sin(2 * theta)) > 0.6; // 明显斜着的长条（比如眉毛）
    if (!tilted) {
      // 正着的：用矩形模板，宽高按原图的长宽比；3×3 以上才切掉四个角显得圆。逐个位置试，取和原图重合最多的
      // 宽高：在 1~7 格的组合里挑面积接近、长宽比也接近原图的（长宽比更重要：竖眼睛宁可 3×4 也不要 3×3 方块）。
      // 长宽比限制在 1:6 到 6:1（只有一行或一列时离散度是 0）
      const ratio = Math.min(6, Math.max(1 / 6, Math.sqrt((cyy + 0.01) / (cxx + 0.01))));
      let tw = 1, th = 1, bestFit = Infinity;
      for (let w = 1; w <= 7; w++) for (let h = 1; h <= 7; h++) {
        const fit = Math.abs(w * h - want) / want + 1.5 * Math.abs(Math.log(h / w / ratio));
        if (fit < bestFit) [tw, th, bestFit] = [w, h, fit];
      }
      const cut = tw >= 4 && th >= 4; // 4×4 以上才切角，3 格宽切了会变成菱形
      for (let oy = Math.floor(my - th / 2) - 1; oy <= Math.floor(my - th / 2) + 1; oy++) {
        for (let ox = Math.floor(mx - tw / 2) - 1; ox <= Math.floor(mx - tw / 2) + 1; ox++) {
          const cells: number[] = [];
          let okAll = true, sum = 0;
          for (let y = 0; y < th && okAll; y++) for (let x = 0; x < tw; x++) {
            if (cut && (x === 0 || x === tw - 1) && (y === 0 || y === th - 1)) continue;
            const gx = ox + x, gy = oy + y;
            const i = gy * gw + gx;
            if (gx < 0 || gy < 0 || gx >= gw || gy >= gh || !allowed.has(i)) { okAll = false; break; }
            cells.push(i);
            sum += cover.get(i) ?? 0;
          }
          if (okAll && sum > bestCover) [pick, bestCover] = [cells, sum];
        }
      }
    } else {
      for (const ox of [-0.5, 0, 0.5]) for (const oy of [-0.5, 0, 0.5]) {
        const cx = Math.round((mx + ox) * 2) / 2, cy = Math.round((my + oy) * 2) / 2;
        const scored = candidates.map(i => {
          const x = (i % gw) + 0.5 - cx, y = Math.floor(i / gw) + 0.5 - cy;
          const u = (x * cos + y * sin) / ra, v = (-x * sin + y * cos) / rb;
          return [i, u * u + v * v] as const;
        }).sort((p, q) => p[1] - q[1]).slice(0, want).map(([i]) => i);
        const sum = scored.reduce((acc, i) => acc + (cover.get(i) ?? 0), 0);
        if (sum > bestCover) [pick, bestCover] = [scored, sum];
      }
    }
    if (!pick.length) continue;
    for (const i of region) out[i] = host;
    for (const i of pick) out[i] = c;
  }
  return out;
}

// ---------- 5. 放到豆板 ----------

/** board 不给：按图案大小放到能装下它的最小豆板（或 104 板拼成的范围） */
function placeOnBoard(codes: (string | null)[], w: number, h: number, board?: number): Grid {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!codes[y * w + x]) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return createGrid(board ?? SIZES.small.board, board ?? SIZES.small.board);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const area = board ? { width: board, height: board } : boardArea(cw, ch);
  const grid = createGrid(area.width, area.height);
  const ox = Math.floor((area.width - cw) / 2), oy = Math.floor((area.height - ch) / 2);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) grid.cells[(oy + y) * area.width + ox + x] = codes[(y0 + y) * w + x0 + x];
  }
  return grid;
}

// ---------- 总流程 ----------


const PIXEL_ART_CLUSTER_RADIUS = 0.045; // 作者会故意用很接近的两种颜色（奶白身体 vs 淡黄背景差 0.05），聚类半径只能吃掉压缩噪点

/**
 * 有颜色的就配有颜色的豆：MARD 在中等亮度的青灰、蓝灰一带只有灰豆离得近，纯最近色会把青灰狼（#679a9b）
 * 配成灰 H20，拼出来就不是青色了。颜色明显带色（色度 ≥ 0.04）而最近的豆几乎没色（色度不到它的 40%）时，
 * 在色相 ±30°、色度至少一半的豆里找最近的，只多付一点距离就换过去。
 * 色度低的灰毛不受影响（不会被挤成彩色豆）。
 */
const KEEP_HUE_MIN_CHROMA = 0.04;
const KEEP_HUE_MARGIN = 0.02;
const hueOf = (l: Lab) => (Math.atan2(l[2], l[1]) * 180) / Math.PI;
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
function nearestKeepingHue(lab: Lab): string {
  const pick = nearest(lab);
  const c = chroma(lab);
  if (c < KEEP_HUE_MIN_CHROMA || chroma(pick.lab) >= c * 0.4) return pick.code;
  const h = hueOf(lab);
  const sameHue = PALETTE.filter(p => chroma(p.lab) >= c * 0.5 && hueGap(hueOf(p.lab), h) <= 30);
  if (!sameHue.length) return pick.code;
  const alt = nearest(lab, sameHue);
  return matchDistance(lab, alt.lab) - matchDistance(lab, pick.lab) <= KEEP_HUE_MARGIN ? alt.code : pick.code;
}

/**
 * 按出现频率贪心聚类：最常见的颜色先成为一类中心，之后的颜色离某个中心够近就归入，否则新开一类。
 * 返回"颜色 → 该类对应的 MARD 色号"的函数。keepHue：带色的中心不配成灰豆（像素画路径用）。
 */
function clusterColors(labs: Lab[], radius: number, keepHue = false): (lab: Lab) => string {
  const q = (l: Lab) => `${Math.round(l[0] * 100)},${Math.round(l[1] * 200)},${Math.round(l[2] * 200)}`;
  const counts = new Map<string, { lab: Lab; n: number }>();
  for (const lab of labs) {
    const k = q(lab);
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { lab, n: 1 });
  }
  const centers: Lab[] = [];
  const centerCode: string[] = [];
  for (const { lab } of [...counts.values()].sort((a, b) => b.n - a.n)) {
    if (centers.some(c => labDistance(c, lab) < radius)) continue;
    centers.push(lab);
    // 黑白锚定：几乎无色的深色就是黑（H7），几乎无色的浅色就是白（H2）；
    // 否则 #141414 这种"接近黑"会被配到深棕，眼睛就不黑了
    const neutral = chroma(lab) < 0.02;
    centerCode.push(neutral && lab[0] < 0.25 ? 'H7' : neutral && lab[0] > 0.93 ? 'H2' : keepHue ? nearestKeepingHue(lab) : nearest(lab).code);
  }
  return lab => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const d = labDistance(centers[i], lab);
      if (d < bestD) [best, bestD] = [i, d];
    }
    return centerCode[best];
  };
}

/**
 * 像素画保真路径：每个像素就是作者摆好的一颗豆，只做"找最接近的 MARD 色号"和轻微的 JPEG 去噪。
 * 主体放得下就 1:1 放；放不下才按整数倍缩小（像素画缩小只能走整数倍，否则线条会断）。
 */
function generateFromPixelArt(input: PatternInput, options: PatternOptions): Grid {
  const size = SIZES[options.size];
  const { image, mask } = input;
  const b = maskBounds(mask, image.width, image.height);
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const boxW = options.fit?.w ?? size.maxSubject, boxH = options.fit?.h ?? size.maxSubject;
  const factor = Math.max(1, Math.ceil(bw / boxW), Math.ceil(bh / boxH));
  const gw = Math.ceil(bw / factor), gh = Math.ceil(bh / factor);
  // 色彩归一：JPEG 会把一块平涂色打散成几十种相近色。先把所有主体像素按颜色聚成几类，再把每一类配到色号。
  const pixelLab = new Map<number, Lab>();
  const labAt = (i: number) => {
    let lab = pixelLab.get(i);
    if (!lab) pixelLab.set(i, (lab = rgbToLab(image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2])));
    return lab;
  };
  const clusterCode = clusterColors(
    [...Array(image.width * image.height).keys()].filter(i => (mask ? mask.data[i] : image.data[i * 4 + 3] / 255) >= 0.5).map(labAt),
    PIXEL_ART_CLUSTER_RADIUS,
    true,
  );
  const codes: (string | null)[] = new Array(gw * gh).fill(null);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      // factor > 1 时取块内多数色
      const tally = new Map<string, number>();
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const x = b.x0 + gx * factor + dx, y = b.y0 + gy * factor + dy;
          if (x >= b.x1 || y >= b.y1) continue;
          const i = y * image.width + x;
          const m = mask ? mask.data[i] : image.data[i * 4 + 3] / 255;
          if (m < 0.5) continue;
          const code = clusterCode(labAt(i));
          tally.set(code, (tally.get(code) ?? 0) + 1);
        }
      }
      if (!tally.size) continue;
      let best = '', bestN = 0;
      for (const [c, n] of tally) if (n > bestN) [best, bestN] = [c, n];
      codes[gy * gw + gx] = best;
    }
  }
  let out = mergeNearDuplicates(codes, 0.035); // 只合并 JPEG 噪点级别的差异
  out = mergeRareColors(out, MIN_BEADS_PER_COLOR);
  out = capColors(out, options.maxColors ?? MAX_COLORS); // 像素画一格一豆还原，颜色按作者画的来，不按豆板砍
  return placeOnBoard(out, gw, gh, options.fit ? undefined : size.board);
}

/**
 * 平涂图路径：卡通、贴纸、AI 画的像素风。颜色已经是作者定好的几种，我们只负责
 * 按聚类配到 MARD 色号、按格投票、清掉压缩噪点；不平滑、不改色调；图里自带描边就不再描。
 */
function generateFromFlat(input: PatternInput, options: PatternOptions): Grid {
  const size = SIZES[options.size];
  const style = STYLES[options.style];
  const ownOutline = hasOwnOutline(input.image, input.mask);
  const withOutline = input.mask !== null && style.outline !== 'none' && !ownOutline;

  const pad = withOutline ? 2 : 0; // 描边四周各占一颗
  const b = maskBounds(input.mask, input.image.width, input.image.height);
  const work = buildWorkImage(input, options.fit ? fitSide(b.x1 - b.x0, b.y1 - b.y0, options.fit.w - pad, options.fit.h - pad) : size.maxSubject - pad);
  const { gw, gh } = work;
  const subject = work.sub.filter((_, i) => work.subMask[i]);
  const step = Math.max(1, Math.floor(subject.length / 20000));
  const sample = subject.filter((_, i) => i % step === 0);
  const radius = flatRadius(options);
  const clusterCode = clusterColors(sample, radius);
  const subCodes = work.sub.map((lab, i) => (work.subMask[i] ? clusterCode(lab) : null));

  let codes = voteCells(work, subCodes);
  codes = mergeNearDuplicates(codes, Math.min(0.05, radius * 0.85));
  const keep = protectDetails(codes, gw, gh);
  const details = detailColors(codes, keep); // 眼睛、高光的颜色：后面砍色数时不动
  codes = mergeSmallRegions(codes, gw, gh, 2, keep); // 只清 1 颗的压缩噪点；2 颗以上视为作者有意
  if (input.mask) codes = removeIslands(codes, gw, gh);
  codes = mergeRareColors(codes, MIN_BEADS_PER_COLOR);
  codes = tidyEdges(codes, gw, gh, keep); // 修掉边缘的尖刺、细线拐角多出的那颗、孤豆
  codes = regularizeEdges(codes, gw, gh, keep); // 大色块边上长短乱跳的台阶按直线 / 弧线重画
  codes = refitFeatures(codes, work, subCodes); // 眼睛、眉毛这类小色块按原图的面积和形状重新落格
  codes = mergeRareColors(codes, MIN_BEADS_PER_COLOR); // 上面几步可能把某个颜色改得只剩一两颗（单买一包不划算），换成图里最接近的颜色

  let w = gw, h = gh;
  if (withOutline && codes.some(Boolean)) {
    const outlined = addOutline(codes, gw, gh, style.outline === 'black' ? 'black' : 'dark', openSides(input.mask, input.image.width, input.image.height));
    [codes, w, h] = [outlined.codes, outlined.w, outlined.h];
  }
  codes = capColors(codes, options.maxColors ?? MAX_COLORS, details);
  return placeOnBoard(codes, w, h, options.fit ? undefined : size.board);
}

// 平涂图的聚类半径：同一块平涂色的离散范围（底色和阴影色通常差 0.08 以上，不会被并掉）。
// 板越大能放下越多明暗细节，颜色分得越细，默认色数跟着板变多
const FLAT_RADIUS: Record<SizeId, number> = { small: 0.06, medium: 0.045, large: 0.035 };
const FLAT_RADIUS_BEYOND = 0.03; // 超过一块 104 板的大图
function flatRadius(options: PatternOptions): number {
  return options.fit && Math.max(options.fit.w, options.fit.h) > SIZES.large.board ? FLAT_RADIUS_BEYOND : FLAT_RADIUS[options.size];
}

// 多色版的把关：和刚生成的那张逐格比，大变样的格子不能超过 3%（颜色跳了：头上冒出淡紫色块、背景冒出灰斑），
// 孤豆和碎块不能明显变多。只加明暗层次，不改画面
const RICH_JUMP = 0.15, RICH_MAX_JUMP_SHARE = 0.03, RICH_NOISE_SLACK = 1.3;
function noiseOf(g: Grid): number {
  let n = 0;
  for (const r of connectedRegions(g, (a, b) => a === b)) if (r.length <= 4) n++;
  return n;
}
function passesRich(base: Grid, cand: Grid): boolean {
  if (cand.width !== base.width || cand.height !== base.height) return false;
  let jumps = 0, beads = 0;
  for (let i = 0; i < base.cells.length; i++) {
    const a = base.cells[i], b = cand.cells[i];
    if (!a && !b) continue;
    beads++;
    if (!a || !b || matchDistance(colorOf(a).lab, colorOf(b).lab) > RICH_JUMP) jumps++;
  }
  return jumps <= beads * RICH_MAX_JUMP_SHARE && noiseOf(cand) <= noiseOf(base) * RICH_NOISE_SLACK + 5;
}

/**
 * 刚生成的图上加明暗：逐格看原图（逐格最近色、不清理的那份），和这格原来的颜色是同一种（差得不多）就换成原图的深浅，
 * 差得多就保持原样。色块的形状、轮廓、背景都不变，只是同一块里多出原图的明暗层次；
 * 冒出来的零星单颗（上下左右都不是同一深浅）退回原色，不添杂点
 */
const SHADE_NEAR = 0.1;       // 卡通：同一种颜色只取很近的深浅
const SHADE_NEAR_PHOTO = 0.14; // 照片本来就是连续的明暗，放宽一点
const SHADE_MIN_PATCH = 4;
function addShading(base: Grid, shades: Grid, near = SHADE_NEAR): Grid {
  if (shades.width !== base.width || shades.height !== base.height) return base;
  const { width: w, height: h } = base;
  const out = base.cells.slice();
  for (let i = 0; i < out.length; i++) {
    const a = base.cells[i], b = shades.cells[i];
    if (a && b && a !== b && matchDistance(colorOf(a).lab, colorOf(b).lab) <= near) out[i] = b;
  }
  // 新加的深浅要连成一小片（至少 SHADE_MIN_PATCH 颗）才留，零星几颗退回原色：加的是明暗层次，不是杂点
  const clean = out.slice();
  for (const region of connectedRegions({ width: w, height: h, cells: out }, (a, b) => a === b)) {
    const i0 = region[0];
    if (out[i0] === base.cells[i0] || region.length >= SHADE_MIN_PATCH) continue;
    for (const i of region) clean[i] = base.cells[i];
  }
  // 新深浅把原来的色块切开后，会剩下一两颗夹在中间的原色：只并这种「被切出来的」小块（原来所在的色块比它大），
  // 原图里本来就小的细节（蛋糕夹层、巧克力线、眼睛）不动
  const baseSize = new Int32Array(w * h);
  for (const r of connectedRegions(base, (a, b) => a === b)) for (const i of r) baseSize[i] = r.length;
  const tidy = clean.slice();
  for (const r of connectedRegions({ width: w, height: h, cells: clean }, (a, b) => a === b)) {
    if (r.length >= SHADE_MIN_PATCH || !r.every(i => baseSize[i] > r.length)) continue;
    const tally = new Map<string, number>();
    for (const i of r) {
      const x = i % w, y = (i - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const c = clean[ny * w + nx];
        if (c && c !== clean[i]) tally.set(c, (tally.get(c) ?? 0) + 1);
      }
    }
    let top: string | null = null, tn = 0;
    for (const [c, n] of tally) if (n > tn) [top, tn] = [c, n];
    if (top) for (const i of r) tidy[i] = top;
  }
  return { width: w, height: h, cells: mergeRareColors(tidy, MIN_BEADS_PER_COLOR) };
}

/**
 * 「颜色数量」往右用的多色版：像换了大一号的豆板一样多出细节，但画面不变样。
 * 都是在刚生成的图上按原图加明暗（见 addShading），再过一遍把关
 */
export function generateRich(input: PatternInput, options: PatternOptions): Grid {
  const kind = resolveKind(input);
  const opts = { ...options, maxColors: MAX_COLORS };
  const photoInput = { image: input.image, mask: input.mask };
  const base = generatePattern({ ...input, kind }, options);
  const size = SIZES[options.size];
  const fit = options.fit ?? { w: size.maxSubject, h: size.maxSubject };
  // 照片也走「在刚生成的图上加明暗」：直接换成色数更多的那份，会冒出原图里零星的怪色（蛋糕上的淡绿、淡粉）
  const candidates = kind === 'photo'
    ? [addShading(base, generateFromPhoto(photoInput, opts), SHADE_NEAR_PHOTO), addShading(base, generateFromPhoto(photoInput, { ...opts, keepShades: true }), SHADE_NEAR_PHOTO)]
    : [addShading(base, generateFromPhoto(photoInput, { ...opts, fit, keepShades: true }))];
  let best = base, most = legendOf(base).length;
  for (const c of candidates) {
    const n = legendOf(c).length;
    if (n > most && passesRich(base, c)) [best, most] = [c, n];
  }
  return best;
}

export function generatePattern(input: PatternInput, options: PatternOptions): Grid {
  const kind = resolveKind(input);
  if (kind === 'pixel') return generateFromPixelArt(input, options);
  if (kind === 'flat') return generateFromFlat(input, options);
  return generateFromPhoto({ image: input.image, mask: input.mask }, options);
}
