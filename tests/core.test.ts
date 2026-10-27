// 只测外部行为：给定输入，检查输出的格子表格是否符合图纸交付标准（src/core/validate.ts）。
import { describe, expect, it } from 'vitest';
import { SIZES, boardFor, boardLabel } from '../src/core/config';
import { validatePatternData } from '../src/ui/pngData';
import { commit, copyRect, fitOnBoard, growToFit, copySpot, denoise, fillRect, fillRegion, mirrorGrid, mirrorRect, moveRect, nearestOther, outlineGrid, paintCells, redo, reduceColors, removeColor, replaceColor, startHistory, stampBitmap, undo } from '../src/core/edit';
import { stripChecker } from '../src/core/checker';
import { regularizeEdges, tidyEdges } from '../src/core/contour';
import { contentBounds, createGrid, legendOf, placeOnBoard, type Grid } from '../src/core/grid';
import { cleanMask, dominantBorderMask, plainBackgroundMask, type RgbaImage } from '../src/core/image';
import { PALETTE, isValidCode, nearest } from '../src/core/palette';
import { generatePattern } from '../src/core/pipeline';
import { allPassed, validateGrid } from '../src/core/validate';

function gridFrom(rows: string[], codes: Record<string, string>): Grid {
  const g = createGrid(rows[0].length, rows.length);
  rows.forEach((row, y) => [...row].forEach((ch, x) => (g.cells[y * g.width + x] = ch === '.' ? null : codes[ch])));
  return g;
}

/** 测试图：白底 + 一个带深色眼睛的橙色圆 */
function catLikeImage(size = 200): RgbaImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = Math.hypot(x - size / 2, y - size / 2);
      let rgb = [255, 255, 255];
      if (d < size * 0.38) rgb = [230, 140, 60];
      if (Math.hypot(x - size * 0.4, y - size * 0.45) < size * 0.05 || Math.hypot(x - size * 0.6, y - size * 0.45) < size * 0.05) rgb = [20, 20, 20];
      data.set([...rgb, 255], i);
    }
  }
  return { width: size, height: size, data };
}

describe('色板', () => {
  it('全部色号合法、颜色值不重复', () => {
    expect(PALETTE.length).toBe(221);
    expect(PALETTE.every(c => isValidCode(c.code))).toBe(true);
  });
  it('纯黑找到 H7，纯白找到 H2', () => {
    expect(nearest([0, 0, 0]).code).toBe('H7');
    expect(nearest([1, 0, 0]).code).toBe('H2');
  });
});

describe('色卡（C5、C6）', () => {
  it('只含用到的色号，按用量从多到少，颗数等于格子数', () => {
    const g = gridFrom(['AAB', 'A.C', 'BBB'], { A: 'H7', B: 'A6', C: 'H2' });
    expect(legendOf(g)).toEqual([
      { code: 'A6', count: 4 },
      { code: 'H7', count: 3 },
      { code: 'H2', count: 1 },
    ]);
  });
});

describe('编辑', () => {
  const base = gridFrom(['AAB', 'A.B', 'BBB'], { A: 'H7', B: 'A6' });

  it('画笔改格子，橡皮变空格，不改原表', () => {
    const painted = paintCells(base, [[2, 0]], 'H2');
    expect(painted.cells[2]).toBe('H2');
    expect(paintCells(base, [[0, 0]], null).cells[0]).toBeNull();
    expect(base.cells[2]).toBe('A6');
  });

  it('填充只改相连的同色区域', () => {
    const filled = fillRegion(base, 0, 0, 'H2');
    expect(filled.cells.filter(c => c === 'H2').length).toBe(3);
    expect(filled.cells[2]).toBe('A6');
  });

  it('替换成已在用的颜色时色卡合并', () => {
    const replaced = replaceColor(base, 'H7', 'A6');
    expect(legendOf(replaced)).toEqual([{ code: 'A6', count: 8 }]);
  });

  it('镜像两次等于原图', () => {
    const once = mirrorGrid(base);
    expect(once.cells.slice(0, 3)).toEqual(['A6', 'H7', 'H7']);
    expect(mirrorGrid(once).cells).toEqual(base.cells);
  });

  it('文字位图按位置盖到格子上，超出边界的部分忽略', () => {
    const g = stampBitmap(createGrid(4, 4), [[true, false, true]], 2, 1, 'H7');
    expect(g.cells.filter(Boolean).length).toBe(1);
    expect(g.cells[1 * 4 + 2]).toBe('H7');
  });

  it('选区：删除、镜像只动选区里的格子', () => {
    const r = { x: 0, y: 0, w: 3, h: 1 };
    expect(fillRect(base, r, null).cells.slice(0, 4)).toEqual([null, null, null, 'H7']);
    expect(mirrorRect(base, r).cells.slice(0, 6)).toEqual(['A6', 'H7', 'H7', 'H7', null, 'A6']);
  });

  it('复制选区：原位置保留，放在放得下的一侧', () => {
    const wide = gridFrom(['A....', '.....'], { A: 'H7' });
    const r = { x: 0, y: 0, w: 1, h: 1 };
    const [dx, dy] = copySpot(wide, r);
    expect([dx, dy]).toEqual([2, 0]);
    const copied = copyRect(wide, r, dx, dy);
    expect(copied.cells[0]).toBe('H7');
    expect(copied.cells[2]).toBe('H7');
  });

  it('移动选区：内容挪过去，原位置空出，超出豆板的丢掉', () => {
    const moved = moveRect(base, { x: 0, y: 0, w: 1, h: 1 }, 1, 1);
    expect(moved.cells[0]).toBeNull();
    expect(moved.cells[1 * 3 + 1]).toBe('H7');
    expect(moveRect(base, { x: 0, y: 0, w: 1, h: 1 }, -1, 0).cells[0]).toBeNull();
    expect(moveRect(base, { x: 0, y: 0, w: 1, h: 1 }, 0, 0)).toBe(base);
  });

  it('删色：换成图里剩下最接近的颜色，只剩一种时不动', () => {
    const three = gridFrom(['AB', 'CC'], { A: 'H7', B: 'H6', C: 'A6' });
    expect(nearestOther(three, 'H7')).toBe('H6');
    expect(legendOf(removeColor(three, 'H7')).map(l => l.code).sort()).toEqual(['A6', 'H6']);
    const one = gridFrom(['AA'], { A: 'H7' });
    expect(removeColor(one, 'H7')).toBe(one);
  });

  it('减少颜色：用量最少的先并掉，颗数不变', () => {
    const g = gridFrom(['AAAB', 'AAAC'], { A: 'H7', B: 'H6', C: 'A6' });
    const two = reduceColors(g, 2);
    expect(legendOf(two).length).toBe(2);
    expect(two.cells.filter(Boolean).length).toBe(8);
    expect(reduceColors(g, 5)).toBe(g);
  });

  it('描边：图案外面一圈空格铺上颜色，铺满豆板时不变', () => {
    const g = gridFrom(['.....', '.....', '..A..', '.....', '.....'], { A: 'A6' });
    const o = outlineGrid(g, 'H7');
    expect(o.cells.filter(c => c === 'H7').length).toBe(8);
    expect(o.cells[0]).toBeNull();
    const full = gridFrom(['AA', 'AA'], { A: 'A6' });
    expect(outlineGrid(full, 'H7')).toBe(full);
  });

  it('降噪：大色块里的单颗杂点并进周围，干净的图不变', () => {
    const noisy = gridFrom(['AAAAA', 'AAAAA', 'AABAA', 'AAAAA', 'AAAAA'], { A: 'A6', B: 'A10' });
    expect(legendOf(denoise(noisy)).map(l => l.code)).toEqual(['A6']);
    const clean = gridFrom(['AAAA', 'AAAA', 'BBBB', 'BBBB'], { A: 'A6', B: 'H7' });
    expect(denoise(clean)).toBe(clean);
  });

  it('撤销后等于操作前，重做恢复', () => {
    let h = startHistory(base);
    const changed = paintCells(base, [[0, 0]], 'H2');
    h = commit(h, changed);
    h = undo(h);
    expect(h.present).toBe(base);
    h = redo(h);
    expect(h.present).toBe(changed);
  });
});

describe('边缘清理', () => {
  const codes = { '.': 'H2', '#': 'H7', A: 'H2', B: 'A6' };
  const parse = (rows: string[]) => rows.flatMap(r => [...r].map(ch => codes[ch as keyof typeof codes]));
  const noKeep = (n: number) => new Uint8Array(n);

  it('一颗宽的斜线（胡子、描边）不会被当成孤豆删断', () => {
    const rows = ['.........', '.#.......', '..#......', '...#.....', '....#....', '.....#...', '.........'];
    const before = parse(rows);
    const after = tidyEdges(before, 9, 7, noKeep(before.length));
    expect(after).toEqual(before);
  });

  it('每步都带拐角的台阶线只去掉多出来的那颗，线不断', () => {
    const rows = ['..........', '.##.......', '..##......', '...##.....', '....##....', '.....##...', '..........'];
    const w = 10, h = rows.length;
    const after = tidyEdges(parse(rows), w, h, noKeep(w * h));
    const dark = after.map((c, i) => (c === 'H7' ? i : -1)).filter(i => i >= 0);
    expect(dark.length).toBeGreaterThanOrEqual(6);
    expect(dark.length).toBeLessThan(10);
    // 八连通：从第一颗出发能走到每一颗
    const set = new Set(dark), seen = new Set([dark[0]]), stack = [dark[0]];
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = (y + dy) * w + x + dx;
        if (set.has(j) && !seen.has(j)) [seen.add(j), stack.push(j)];
      }
    }
    expect(seen.size).toBe(dark.length);
  });

  it('台阶规整：长短乱跳的平缓边理成长度只差 1 的台阶，小色块不动', () => {
    // 上白下橙，分界每列的高度按 3,3,2,4,3,3,3,4,2,3,3,3 格一级往下走；左上角放一个 3×3 的深色小块（眼睛）
    const runs = [3, 3, 2, 4, 3, 3, 3, 4, 2, 3, 3, 3];
    const w = runs.reduce((a, b) => a + b, 0), h = 24;
    const edge: number[] = [];
    runs.forEach((r, k) => { for (let i = 0; i < r; i++) edge.push(6 + k); });
    const before: (string | null)[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) before.push(y < edge[x] ? 'H2' : 'A6');
    for (let y = 1; y <= 3; y++) for (let x = 2; x <= 4; x++) before[y * w + x] = 'H7';
    const after = regularizeEdges(before, w, h, noKeep(w * h));
    const col = (x: number) => { let y = 0; while (after[y * w + x] !== 'A6') y++; return y; };
    const lengths: number[] = [];
    for (let x = 0, run = 1; x < w; x++, run++) if (x === w - 1 || col(x + 1) !== col(x)) [lengths.push(run), (run = 0)];
    const inner = lengths.slice(1, -1);
    expect(Math.max(...inner) - Math.min(...inner)).toBeLessThanOrEqual(1);
    expect(after.filter((c, i) => c !== before[i]).length).toBeLessThanOrEqual(w * 0.25);
    for (let y = 1; y <= 3; y++) for (let x = 2; x <= 4; x++) expect(after[y * w + x]).toBe('H7');
  });
});

describe('纯色背景去除', () => {
  it('白底图能抠出主体，主体在中间', () => {
    const img = catLikeImage();
    const mask = plainBackgroundMask(img);
    expect(mask).not.toBeNull();
    const clean = cleanMask(mask!);
    expect(clean.data[100 * 200 + 100]).toBe(1);
    expect(clean.data[0]).toBe(0);
  });
});

describe('主体贴边时的平涂背景', () => {
  // 深色主体从底边长上来（边缘颜色不统一，走「边缘最多的颜色」那条路）；背景 top→bottom 从 top 变到 bottom
  const image = (top: number, bottom: number): RgbaImage => {
    const w = 100, h = 100, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const subject = x >= 25 && x < 75 && y >= 40;
      const v = subject ? 40 : Math.round(top + ((bottom - top) * y) / (h - 1));
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
    return { width: w, height: h, data };
  };
  it('平涂背景照常去掉', () => {
    const mask = dominantBorderMask(image(230, 230));
    expect(mask).not.toBeNull();
    expect(mask!.data[0]).toBe(0);
    expect(mask!.data[99 * 100 + 50]).toBe(1);
  });
  it('有明暗的墙（照片）不走这条路，交给抠图模型', () => {
    expect(dominantBorderMask(image(250, 150))).toBeNull();
  });
});

describe('出图流水线符合交付标准', () => {
  const img = catLikeImage();
  const mask = cleanMask(plainBackgroundMask(img)!);
  for (const size of Object.keys(SIZES) as Array<keyof typeof SIZES>) {
    for (const style of ['sticker', 'realistic'] as const) {
      it(`${size} · ${style} 通过全部自动检查`, () => {
        const grid = generatePattern({ image: img, mask }, { size, style });
        const results = validateGrid(grid, { size });
        expect(results.filter(r => !r.ok)).toEqual([]);
        expect(allPassed(results)).toBe(true);
      });
    }
  }

  it('眼睛这样的深色小细节被保留', () => {
    const grid = generatePattern({ image: img, mask }, { size: 'small', style: 'sticker' });
    expect(legendOf(grid).some(l => l.code === 'H7' || PALETTE.find(c => c.code === l.code)!.lab[0] < 0.3)).toBe(true);
  });

  it('自定义尺寸：图案放进宽 × 高以内，超过 104 放到几块 104 板拼成的范围上', () => {
    for (const kind of ['flat', 'photo'] as const) {
      for (const m of [mask, null]) {
        const grid = generatePattern({ image: img, mask: m, kind }, { size: 'large', style: 'sticker', fit: { w: 234, h: 119 } });
        const b = contentBounds(grid)!;
        expect(b.right - b.left + 1).toBeLessThanOrEqual(234);
        expect(b.bottom - b.top + 1).toBeLessThanOrEqual(119);
        expect(Math.max(b.right - b.left, b.bottom - b.top) + 1).toBeGreaterThan(104);
        expect([grid.width % 104, grid.height % 104]).toEqual([0, 0]);
      }
    }
    const small = generatePattern({ image: img, mask }, { size: 'small', style: 'sticker', fit: { w: 40, h: 40 } });
    expect([small.width, small.height]).toEqual([52, 52]);
  });

  it('同样的输入每次结果相同', () => {
    const a = generatePattern({ image: img, mask }, { size: 'small', style: 'sticker' });
    const b = generatePattern({ image: img, mask }, { size: 'small', style: 'sticker' });
    expect(a.cells).toEqual(b.cells);
  });

  it('不抠图时整张图都是主体，仍在安全边距内', () => {
    const grid = generatePattern({ image: img, mask: null }, { size: 'small', style: 'realistic' });
    expect(validateGrid(grid, { size: 'small' }).find(r => r.id === 'A2')!.ok).toBe(true);
  });
});

describe('五官重新落格', () => {
  // 回归：只有一行高的小色块，竖向离散度是 0，曾经算出无穷宽、页面卡死
  it('一行高的小色块不会卡死，三个尺寸都能出图', () => {
    const W = 240, H = 240;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const face = (x - 120) ** 2 + (y - 120) ** 2 < 100 ** 2;
      const line = face && y === 100 && x > 100 && x < 112; // 脸上一道 1 像素高的短横
      const [r, g, b] = line ? [20, 20, 120] : face ? [100, 160, 160] : [255, 255, 255];
      data.set([r, g, b, 255], i);
    }
    const image: RgbaImage = { width: W, height: H, data };
    for (const size of ['small', 'medium', 'large'] as const) {
      const grid = generatePattern({ image, mask: null, kind: 'flat' }, { size, style: 'sticker' });
      expect(grid.cells.some(Boolean)).toBe(true);
    }
  });
});

describe('假透明棋盘格背景', () => {
  /** 白 + 浅灰方格底（方格边长可以是小数，模拟缩放过），中间一个红圆，圆里一块白色 */
  function checkerImage(size: number, square: number, bg: (x: number, y: number) => number): RgbaImage {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, dx = x - size / 2, dy = y - size / 2;
      const inCircle = dx * dx + dy * dy < (size * 0.3) ** 2;
      const inWhite = Math.abs(dx) < size * 0.08 && Math.abs(dy) < size * 0.08;
      const v = bg(Math.floor(x / square), Math.floor(y / square));
      const [r, g, b] = inWhite ? [255, 255, 255] : inCircle ? [220, 40, 40] : [v, v, v];
      data.set([r, g, b, 255], i);
    }
    return { width: size, height: size, data };
  }
  const alphaAt = (img: RgbaImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];

  it('方格背景变透明，主体（含里面的白色）保留', () => {
    for (const square of [16, 12.8]) {
      const img = checkerImage(300, square, (cx, cy) => ((cx + cy) & 1 ? 204 : 255));
      expect(stripChecker(img)).toBe(true);
      expect(alphaAt(img, 5, 5)).toBe(0);
      expect(alphaAt(img, 290, 150)).toBe(0);
      expect(alphaAt(img, 150, 150)).toBe(255); // 圆里的白块
      expect(alphaAt(img, 150, 80)).toBe(255);  // 红圆
    }
  });

  it('纯白底、灰白条纹底不动', () => {
    expect(stripChecker(checkerImage(300, 16, () => 255))).toBe(false);
    expect(stripChecker(checkerImage(300, 16, (_, cy) => (cy & 1 ? 204 : 255)))).toBe(false);
  });
});

describe('尺寸规则：图案放进能装下的最小豆板', () => {
  it('按最长边归板', () => {
    expect(boardFor(32, 16)).toBe('small');
    expect(boardFor(52, 52)).toBe('small');
    expect(boardFor(54, 47)).toBe('medium');
    expect(boardFor(78, 10)).toBe('medium');
    expect(boardFor(90, 60)).toBe('large');
    expect(boardFor(104, 104)).toBe('large');
    expect(boardFor(105, 20)).toBeNull();
    expect(boardLabel(32, 16)).toBe('52×52 豆板');
    expect(boardLabel(234, 119)).toBe('需 6 块 104×104 豆板拼（横 3 × 竖 2）');
  });

  it('图案居中放到豆板上，格子不变', () => {
    const g = createGrid(32, 16);
    g.cells[0] = 'H2';
    g.cells[32 * 16 - 1] = 'F9';
    const out = placeOnBoard(g, 52)!;
    expect([out.width, out.height]).toEqual([52, 52]);
    expect(contentBounds(out)).toEqual({ left: 10, top: 18, right: 41, bottom: 33 });
    expect(out.cells[18 * 52 + 10]).toBe('H2');
    expect(out.cells[33 * 52 + 41]).toBe('F9');
    expect(placeOnBoard({ width: 120, height: 10, cells: Array(1200).fill('H2') }, 104)).toBeNull();
  });

  it('以前存的 50×50 / 100×100 图纸读进来补成 52 / 104，图案不动', () => {
    const g = createGrid(50, 50);
    g.cells[0] = 'H2';
    const d = validatePatternData({ name: '旧图', size: 'small', style: 'sticker', grid: g })!;
    expect([d.grid.width, d.grid.height]).toEqual([52, 52]);
    expect(d.grid.cells[1 * 52 + 1]).toBe('H2');
    expect(validatePatternData({ name: '新图', grid: createGrid(78, 78) })!.grid.width).toBe(78);
    const old100 = createGrid(100, 100);
    old100.cells[0] = 'H7';
    const d100 = validatePatternData({ name: '旧大图', grid: old100 })!;
    expect([d100.grid.width, d100.grid.cells[2 * 104 + 2]]).toEqual([104, 'H7']);
    expect(validatePatternData({ name: '转错的', grid: createGrid(102, 102) })!.grid.width).toBe(104);
  });
});

describe('编辑时画到豆板外：四边等量扩大', () => {
  it('52 板画到边外 → 78 板，原图案居中，新画的位置也在板内', () => {
    const g = createGrid(52, 52);
    g.cells[0] = 'H2';
    const r = growToFit(g, -3, 10, 0, 10)!;
    expect([r.grid.width, r.grid.height, r.dx, r.dy]).toEqual([78, 78, 13, 13]);
    expect(r.grid.cells[13 * 78 + 13]).toBe('H2');
    expect(-3 + r.dx).toBeGreaterThanOrEqual(0);
  });
  it('一次跳过 78 直接到 104；超过 104 往画出去的那边加整块 104 板', () => {
    expect(growToFit(createGrid(52, 52), -20, 0, 0, 0)!.grid.width).toBe(104);
    const right = growToFit(createGrid(104, 104), 104, 50, 105, 50)!;
    expect([right.grid.width, right.grid.height, right.dx, right.dy]).toEqual([208, 104, 0, 0]);
    const left = growToFit(createGrid(208, 104), -1, -110, 0, 0)!;
    expect([left.grid.width, left.grid.height, left.dx, left.dy]).toEqual([312, 312, 104, 208]);
    const from78 = growToFit(createGrid(78, 78), 0, 0, 150, 10)!;
    expect([from78.grid.width, from78.grid.height, from78.dx, from78.dy]).toEqual([208, 104, 13, 13]);
  });
  it('在板内或超过上限时不扩', () => {
    expect(growToFit(createGrid(52, 52), 0, 0, 51, 51)).toBeNull();
    expect(growToFit(createGrid(52, 52), -500, 0, 0, 0)).toBeNull();
  });
});

describe('没有原图时换豆板：图案原样换板', () => {
  it('换大板居中不缩放，换回能装下的最小板', () => {
    const g = createGrid(52, 52);
    g.cells[10 * 52 + 10] = 'H2';
    g.cells[20 * 52 + 30] = 'F9';
    const big = fitOnBoard(g, 104, 104);
    expect([big.width, big.height]).toEqual([104, 104]);
    const b = contentBounds(big)!;
    expect([b.right - b.left + 1, b.bottom - b.top + 1]).toEqual([21, 11]);
    expect(fitOnBoard(big).width).toBe(52);
    const multi = fitOnBoard(g, 200, 120);
    expect([multi.width, multi.height]).toEqual([208, 208]);
  });
  it('板放不下图案时才缩小', () => {
    const g = createGrid(104, 104);
    g.cells = g.cells.map((_, i) => (i % 104 < 80 && Math.floor(i / 104) < 80 ? 'H7' : null));
    const small = fitOnBoard(g, 52, 52);
    expect([small.width, small.height]).toEqual([52, 52]);
    const b = contentBounds(small)!;
    expect(b.right - b.left + 1).toBeLessThanOrEqual(52);
    expect(small.cells.filter(Boolean).length).toBeGreaterThan(2000);
  });
});

describe('等比缩放（选区）', () => {
  it('整数倍放大：一颗变成 k×k 颗', async () => {
    const { scaleCells } = await import('../src/core/scale');
    const r = scaleCells(['H7', 'A1', 'A1', 'H7'], 2, 2, 2);
    expect([r.w, r.h]).toEqual([4, 4]);
    expect(r.cells.slice(0, 4)).toEqual(['H7', 'H7', 'A1', 'A1']);
  });

  it('缩小一半：一样大的两只眼睛缩完一样大，不会被跳掉', async () => {
    const { scaleCells } = await import('../src/core/scale');
    const W = 20, H = 10;
    const cells = Array.from({ length: W * H }, (_, i) => {
      const x = i % W, y = (i - x) / W;
      const eye = y >= 3 && y < 6 && ((x >= 3 && x < 6) || (x >= 12 && x < 15)); // 3×3 的眼睛，一只压在格线上
      return eye ? 'H7' : 'F18';
    });
    const r = scaleCells(cells, W, H, 0.5);
    const eyes: number[][] = [];
    r.cells.forEach((c, i) => { if (c === 'H7') eyes.push([i % r.w, Math.floor(i / r.w)]); });
    const left = eyes.filter(([x]) => x < r.w / 2).length, right = eyes.filter(([x]) => x >= r.w / 2).length;
    expect(left).toBeGreaterThan(0);
    expect(left).toBe(right);
  });
});
