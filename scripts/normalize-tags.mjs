// 整理图纸库的标签：每张图纸只留一个大类，写在第一个；风景类补上「挂画」。可以反复跑，没有要改的就不动文件。
// 用法：node scripts/normalize-tags.mjs [--index 别的图纸库.json]
// 大类怎么定：属于某部作品的优先（动漫 > 游戏 > 潮玩），否则留原来写在最前面的那个；一个大类都没有的归「其他」。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAGS = JSON.parse(readFileSync(resolve(ROOT, 'src/ui/tags.json'), 'utf8'));
const CATS = TAGS['大类'];
const PRIORITY = ['动漫', '游戏', '潮玩'];
const at = process.argv.indexOf('--index');
const INDEX = at >= 0 ? resolve(process.cwd(), process.argv[at + 1]) : resolve(ROOT, 'public/patterns/index.json');
const index = JSON.parse(readFileSync(INDEX, 'utf8'));

let changed = 0;
for (const p of index.patterns) {
  const cats = p.tags.filter(t => CATS.includes(t));
  const cat = PRIORITY.find(c => cats.includes(c)) ?? cats[0] ?? '其他';
  const rest = p.tags.filter(t => !CATS.includes(t));
  if (cat === '风景' && !rest.includes('挂画')) rest.push('挂画');
  const next = [cat, ...rest];
  if (next.join() !== p.tags.join()) { p.tags = next; changed++; }
}
// 同一个系列里大类要一样（按系列里多数图纸的来）
for (const s of index.series) {
  const ps = index.patterns.filter(p => p.series === s.id);
  const count = new Map();
  for (const p of ps) count.set(p.tags[0], (count.get(p.tags[0]) ?? 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const p of ps) if (p.tags[0] !== top) { p.tags = [top, ...p.tags.slice(1)]; changed++; }
}
if (changed) writeFileSync(INDEX, `${JSON.stringify({ v: index.v, series: index.series, ...index }, null, 2)}\n`);
console.log(`${INDEX}：改了 ${changed} 张，共 ${index.patterns.length} 张`);
