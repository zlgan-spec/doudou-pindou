// 往图纸库加一张图纸（或按 id 更新已有的一张）。
// 用法：在「做豆图」里做好图纸 → 点「下载」得到 PNG → 运行
//   node scripts/add-pattern.mjs <图纸.png> --id cat-tootoo --tags 猫咪,杯垫 [--name 名字] [--author 作者] [--source 原创] [--link https://...] [--series golden-cat] [--index 别的图纸库.json]
// PNG 里带着格子表格，脚本把它转成一行一串字符写进 public/patterns/index.json（--index 指定别的文件时写进那份，比如本地预览用的图纸库）。
// 标签只能用 src/ui/tags.json 里的词。
// 系列：--series 写系列 id；新系列第一次用时再加 --series-name 系列名 [--series-note 一句话说明]，会加到文件顶部的系列清单最后。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAGS = JSON.parse(readFileSync(resolve(ROOT, 'src/ui/tags.json'), 'utf8'));
const KNOWN = new Set(Object.values(TAGS).flat());
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i] ?? '';
    else out.file = a;
  }
  return out;
}

/** 读出做拼豆页存进 PNG 的 tEXt 块（关键字 bead-pattern） */
function readPattern(bytes) {
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(pos);
    const type = bytes.toString('latin1', pos + 4, pos + 8);
    if (type === 'tEXt') {
      const body = bytes.subarray(pos + 8, pos + 8 + len);
      const sep = body.indexOf(0);
      if (body.toString('latin1', 0, sep) === 'bead-pattern') {
        return JSON.parse(Buffer.from(body.toString('latin1', sep + 1), 'base64').toString('utf8'));
      }
    }
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  return null;
}

const args = parseArgs(process.argv.slice(2));
if (!args.file || !args.file.toLowerCase().endsWith('.png')) fail('请给一张做拼豆页保存的图纸 PNG。');
if (!/^[a-z0-9-]{1,40}$/.test(args.id ?? '')) fail('--id 只能用小写英文、数字和短横线，如 cat-tootoo。');
const tags = (args.tags ?? '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
const unknown = tags.filter(t => !KNOWN.has(t));
if (unknown.length) fail(`这些标签不在词表里：${unknown.join('、')}。可用的：${[...KNOWN].join('、')}。要加新标签先改 src/ui/tags.json。`);
// 和网站读图纸库时的规则一致（src/ui/library.ts），不合格的条目网站会悄悄跳过，这里提前报错
if (args.link && (!/^https:\/\/[^\s"<>]+$/.test(args.link) || args.link.length > 300)) fail('--link 要是 https 开头、不含空格和引号尖括号的网址（300 字以内）。');
if ((args.name ?? '').length > 30) fail('--name 最多 30 个字。');
if ((args.author ?? '').length > 40) fail('--author 最多 40 个字。');
if ((args.source ?? '').length > 60) fail('--source 最多 60 个字。');
if (args.series !== undefined && !/^[a-z0-9-]{1,40}$/.test(args.series)) fail('--series 是系列 id，只能用小写英文、数字和短横线，如 golden-cat。');
if ((args['series-name'] ?? '').length > 20) fail('--series-name 最多 20 个字。');
if ((args['series-note'] ?? '').length > 60) fail('--series-note 最多 60 个字。');

const data = readPattern(readFileSync(resolve(args.file)));
if (!data?.grid?.cells) fail('这张 PNG 里没有图纸数据。要用做拼豆页「保存图纸」存下来的 PNG。');
const { width, height, cells } = data.grid;
const PALETTE_CODES = new Set([...readFileSync(resolve(ROOT, 'src/core/palette-data.ts'), 'utf8').matchAll(/\['([A-Z]+\d+)',\s*'#[0-9A-Fa-f]{6}'\]/g)].map(m => m[1]));
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 200 || height > 200 || cells.length !== width * height) fail('图纸尺寸不对（每边 1 到 200 格）。');
// 尺寸规则：图纸库不收图案超过 104×104 的（网站读进来时会放到能装下它的最小豆板上），所以只存图案范围，四周的空格不存
let l = width, r = -1, t = height, b = -1;
cells.forEach((c, i) => { if (c) { const x = i % width, y = (i - x) / width; l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); } });
if (r < 0) fail('这张图纸是空的。');
if (r - l + 1 > 104 || b - t + 1 > 104) fail(`图案 ${r - l + 1}×${b - t + 1} 颗，超过 104×104，图纸库不收。`);
const colors = [...new Set(cells.filter(Boolean))];
const badCodes = colors.filter(c => typeof c !== 'string' || !PALETTE_CODES.has(c));
if (badCodes.length) fail(`有不在色卡里的色号：${badCodes.slice(0, 5).join('、')}。`);
if (colors.length > DIGITS.length) fail(`颜色太多（${colors.length} 种），图纸库最多 ${DIGITS.length} 种。`);
const rows = [];
for (let y = t; y <= b; y++) {
  rows.push(cells.slice(y * width + l, y * width + r + 1).map(c => (c ? DIGITS[colors.indexOf(c)] : '.')).join(''));
}

const entry = {
  id: args.id,
  name: (args.name ?? data.name ?? '未命名').slice(0, 30),
  tags,
  author: args.author ?? '',
  source: args.source ?? '',
  ...(args.link ? { link: args.link } : {}),
  addedAt: new Date().toISOString().slice(0, 10),
  mirrored: data.mirrored === true,
  colors,
  rows,
};

const INDEX = args.index ? resolve(args.index) : resolve(ROOT, 'public/patterns/index.json');
const index = JSON.parse(readFileSync(INDEX, 'utf8'));
const at = index.patterns.findIndex(p => p.id === entry.id);
// 系列：写了 --series 就用它；更新已有的一张没写 --series 时保留原来的系列
const seriesList = (index.series ??= []);
const seriesId = args.series ?? (at >= 0 ? index.patterns[at].series : undefined);
let newSeries = null;
if (seriesId) {
  if (!seriesList.some(s => s.id === seriesId)) {
    if (!args['series-name']) fail(`系列清单里没有「${seriesId}」。新系列要再加 --series-name 系列名；已有的系列：${seriesList.map(s => `${s.id}（${s.name}）`).join('、') || '无'}。`);
    newSeries = { id: seriesId, name: args['series-name'], note: args['series-note'] ?? '', cover: entry.id };
    seriesList.push(newSeries);
  }
  entry.series = seriesId;
}
if (at >= 0) index.patterns[at] = entry;
else index.patterns.push(entry);
// 系列清单放在图纸前面，打开文件一眼能看到有哪些系列
const { patterns } = index;
writeFileSync(INDEX, `${JSON.stringify({ v: index.v, series: index.series, ...index }, null, 2)}\n`);
const inSeries = seriesId ? `，系列「${seriesList.find(s => s.id === seriesId).name}」${newSeries ? '（新建）' : ''}，现在 ${patterns.filter(p => p.series === seriesId).length} 张` : '';
console.log(`${at >= 0 ? '已更新' : '已加入'}「${entry.name}」：${r - l + 1}×${b - t + 1} 格，${colors.length} 色，标签 ${tags.join('、') || '无'}${inSeries}。`);
