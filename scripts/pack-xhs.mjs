// 打小红书小工具的 zip：类型检查 + 构建（--mode xhs）→ 检查文件类型 → 检查包里没有别的渠道的代码 →
// 安全检查（密钥字样、本机路径、邮箱、source map；可以再加一份自己的规则）→ 压缩 dist-xhs 里的内容（index.html 在 zip 根目录）。
// 用法：npm run pack:xhs            版本号取 package.json
//      npm run pack:xhs -- 1.4.1    指定版本号
// 额外规则：DOUDOU_SCAN_RULES=/path/to/rules.json，内容是 [{ "name": "…", "pattern": "正则", "flags": "i" }, …]，
// 放仓库外面（比如维护者自己的名字、账号），每条都和内置规则一样对待。任何一条命中就停下，不出 zip。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist-xhs');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = process.argv[2] ?? pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('版本号写成 1.4.0 这样');

execFileSync('npm', ['run', 'build:xhs'], { cwd: root, stdio: 'inherit' });

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else files.push(p);
  }
})(dist);
const textFiles = files.filter(f => /\.(html|css|js|json|svg)$/i.test(f));
const rel = f => path.relative(dist, f);

// 1. 文件类型：只允许官方清单里的
const ALLOWED = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.json']);
const bad = files.filter(f => !ALLOWED.has(path.extname(f).toLowerCase()) || /\.map$|\.DS_Store$/.test(f));
if (bad.length) throw new Error(`不允许的文件：${bad.map(rel).join(', ')}`);
if (!existsSync(path.join(dist, 'index.html'))) throw new Error('dist-xhs 根目录没有 index.html');

// 2. 没把网站版的东西打进来：抠图模型、HEIC 解码、后台线程、全屏、剪贴板、外链、模块脚本
const LEAKS = [
  ['抠图模型', /onnxruntime|u2netp|\.wasm\b/i],
  ['HEIC 解码库', /heic2any/i],
  ['后台线程', /new Worker\(/],
  ['全屏接口', /requestFullscreen/],
  ['剪贴板', /navigator\.clipboard/],
  ['外链', /href:`https?:\/\//], // 写死的 <a href="http…">（字体许可全文里的网址不算）
  ['模块脚本', /<script[^>]*type="module"|\bimport\.meta\b/],
];
const leaks = scan(LEAKS, textFiles);
if (leaks.length) fail('包里有别的渠道的代码', leaks);

// 3. 安全检查：密钥字样、本机路径、邮箱、source map；再加环境变量指定的那份规则
const RULES = [
  ['本机路径', /\/Users\/|\/home\/\w+\/|\/private\/tmp|C:\\\\Users/],
  ['邮箱', /[\w.+-]+@[\w-]+\.(com|cn|net|org|io)\b/i],
  ['密钥字样', /api[_-]?key|secret[_-]?key|access[_-]?token|bearer\s+[a-z0-9]|sk-[a-z0-9]{16,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY/i],
  ['source map', /sourceMappingURL/],
];
const extraPath = process.env.DOUDOU_SCAN_RULES;
if (extraPath) {
  const extra = JSON.parse(readFileSync(extraPath, 'utf8'));
  for (const r of extra) RULES.push([r.name, new RegExp(r.pattern, r.flags ?? '')]);
  console.log(`额外扫描规则：${extra.length} 条（${extraPath}）`);
} else {
  console.log('提示：没有设 DOUDOU_SCAN_RULES，只跑内置的通用规则');
}
const hits = scan(RULES, textFiles);
if (hits.length) fail('安全检查没通过', hits);

// 4. 压缩：进入 dist-xhs 压缩里面的内容，不套一层目录
const out = path.join(root, 'release', `doudou-minitool-${version}.zip`);
mkdirSync(path.dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-rX', '-q', out, '.', '-x', '*.DS_Store'], { cwd: dist });
const size = statSync(out).size;
console.log(`\n检查通过（${files.length} 个文件，${RULES.length} 条扫描规则）`);
console.log(`zip：${path.relative(root, out)}  ${(size / 1024 / 1024).toFixed(2)} MB（上限 10 MB）`);

function scan(rules, list) {
  const found = [];
  for (const f of list) {
    const text = readFileSync(f, 'utf8');
    for (const [name, re] of rules) {
      const m = re.exec(text);
      if (m) found.push(`${rel(f)}：${name}「${text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' ')}」`);
    }
  }
  return found;
}
function fail(title, list) {
  console.error(`${title}：\n${list.join('\n')}`);
  process.exit(1);
}
