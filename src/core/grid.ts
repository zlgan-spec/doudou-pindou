// 格子表格：整张图纸唯一的数据。每格是一个 MARD 色号，或 null（空格，不放豆）。
// 色卡、颗数都从这里现算，不另外存。

export interface Grid {
  width: number;
  height: number;
  cells: (string | null)[]; // 按行排列，下标 = y * width + x
}

export function createGrid(width: number, height: number): Grid {
  return { width, height, cells: new Array(width * height).fill(null) };
}

export function cloneGrid(grid: Grid): Grid {
  return { width: grid.width, height: grid.height, cells: grid.cells.slice() };
}

export function getCell(grid: Grid, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  return grid.cells[y * grid.width + x];
}

export interface LegendItem {
  code: string;
  count: number;
}

/** 色卡：只含实际用到的色号，按用量从多到少；用量相同按色号排 */
export function legendOf(grid: Grid): LegendItem[] {
  const counts = new Map<string, number>();
  for (const c of grid.cells) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code, 'en', { numeric: true }));
}

export function beadCount(grid: Grid): number {
  return grid.cells.reduce((n, c) => n + (c ? 1 : 0), 0);
}

/** 主体（非空格子）的外接矩形；全空时返回 null */
export function contentBounds(grid: Grid): { left: number; top: number; right: number; bottom: number } | null {
  let left = Infinity, top = Infinity, right = -1, bottom = -1;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (!grid.cells[y * grid.width + x]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** 四连通分块：返回每块的格子下标列表 */
export function connectedRegions(grid: Grid, same: (a: string, b: string) => boolean = () => true): number[][] {
  const { width, height, cells } = grid;
  const seen = new Uint8Array(cells.length);
  const regions: number[][] = [];
  for (let start = 0; start < cells.length; start++) {
    const startCode = cells[start];
    if (seen[start] || !startCode) continue;
    const region: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      region.push(i);
      const x = i % width, y = (i - x) / width;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        const code = cells[j];
        if (seen[j] || !code || !same(startCode, code)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    regions.push(region);
  }
  return regions;
}

export { NEIGHBORS };

/**
 * 把图案居中放到 side×side（或 side×height）的豆板上（尺寸规则：图案 = 非空格子占的范围）。
 * 图案比豆板大时返回 null；本来就是这块板、图案也居中的，原样返回
 */
export function placeOnBoard(grid: Grid, side: number, height = side): Grid | null {
  const b = contentBounds(grid);
  if (!b) return grid.width === side && grid.height === height ? grid : createGrid(side, height);
  const w = b.right - b.left + 1, h = b.bottom - b.top + 1;
  if (w > side || h > height) return null;
  const ox = Math.floor((side - w) / 2), oy = Math.floor((height - h) / 2);
  if (grid.width === side && grid.height === height && b.left === ox && b.top === oy) return grid;
  const out = createGrid(side, height);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.cells[(oy + y) * side + ox + x] = grid.cells[(b.top + y) * grid.width + b.left + x];
  return out;
}
