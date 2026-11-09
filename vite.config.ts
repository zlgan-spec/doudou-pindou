/// <reference types="vitest/config" />
// 一份代码出两个渠道：
// - 默认（npm run build）：网站版，部署到 GitHub Pages
// - --mode xhs（npm run build:xhs）：小红书小工具版，产物在 dist-xhs/，再由 scripts/pack-xhs.mjs 打成 zip
// 渠道差异都在 src/platform/ 里，@platform 别名按 mode 指向 web 或 xhs 那份实现，另一份不会进包。
import { createHash } from 'node:crypto';
import { cpSync, readFile, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { compatCss } from './scripts/compat-css.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ---------- 网站版 ----------

// 仅本地开发，不会被打包发布：
// - 出图测试台读本机的测试图：默认 test-images/（不进仓库），可以用 DOUDOU_TEST_IMAGES 指到别的文件夹
// - 设了 DOUDOU_LIBRARY（一份图纸库 json 的路径）就用它代替 public/patterns/index.json，方便预览还没上线的图纸
function localDev(): Plugin {
  return {
    name: 'local-dev-files',
    apply: 'serve',
    configureServer(server) {
      const library = process.env.DOUDOU_LIBRARY;
      if (library) {
        server.middlewares.use('/patterns/index.json', (_req, res, next) => {
          readFile(path.resolve(library), (err, body) => {
            if (err) return next();
            res.setHeader('Content-Type', 'application/json');
            res.end(body);
          });
        });
      }
      server.middlewares.use('/test-images/', (req, res, next) => {
        const name = path.basename(decodeURIComponent((req.url ?? '').split('?')[0]));
        readFile(path.resolve(process.env.DOUDOU_TEST_IMAGES ?? 'test-images', name), (err, body) => {
          if (err) return next();
          res.setHeader('Content-Type', 'image/png');
          res.end(body);
        });
      });
    },
  };
}

// 防闪烁：页面渲染前就按存过的主题（没存过就跟系统）给 <html> 加上 dark，首屏不会先白后黑
const THEME_BOOT = "try{var t=localStorage.getItem('bead-theme');if(t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}";
const THEME_BOOT_HASH = `'sha256-${createHash('sha256').update(THEME_BOOT).digest('base64')}'`;
function themeBoot(): Plugin {
  return {
    name: 'theme-boot',
    transformIndexHtml: () => [{ tag: 'script', children: THEME_BOOT, injectTo: 'head-prepend' }],
  };
}

// 只加在正式构建里（开发服务器有内联脚本，加了会被拦）：内容安全策略 + 引用来源策略。
// 所有资源都从本站加载；抠图模型的 wasm 要 'wasm-unsafe-eval'，HEIC 解码库用了 new Function 和 blob worker，
// 所以还要 'unsafe-eval' 和 worker-src blob:（不支持 HEIC 原生解码的浏览器才会用到它）
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${THEME_BOOT_HASH} 'wasm-unsafe-eval' 'unsafe-eval'`, // 哈希放行的只有上面那段防闪烁脚本
  "worker-src 'self' blob:",
  "connect-src 'self' data: blob:",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');
function securityHeaders(): Plugin {
  return {
    name: 'security-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' }, injectTo: 'head-prepend' },
    ],
  };
}

// ---------- 小红书小工具版 ----------
// 容器要求（见官方 Skill minitool-zip-builder）：资源全用相对路径；不能联网；不能有内联 <script>、type="module"、import/export，
// 只能是经典脚本；JS 转译到 ES2017 / Chrome 61，CSS 也按 Chrome 61 降级；不能带 source map 和构建配置

// 图纸库打进包里（容器禁 fetch）：从 public/patterns/index.json 只取作者 DouDou、出处 AI 原创的图纸，不带外链字段；
// 系列只留还有图纸的。规则改了要同步 CONTRIBUTING.md
const LIBRARY_ID = 'virtual:library-data';
function libraryData(): Plugin {
  return {
    name: 'xhs-library-data',
    resolveId: id => (id === LIBRARY_ID ? `\0${LIBRARY_ID}` : null),
    load(id) {
      if (id !== `\0${LIBRARY_ID}`) return null;
      const src = JSON.parse(readFileSync(path.join(ROOT, 'public/patterns/index.json'), 'utf8')) as {
        v: unknown; series: Array<{ id: string }>; patterns: Array<Record<string, unknown>>;
      };
      const patterns = src.patterns
        .filter(p => p.author === 'DouDou' && p.source === 'AI 原创')
        .map(({ link: _link, ...p }) => { void _link; return p; });
      const used = new Set(patterns.map(p => p.series));
      const series = src.series.filter(s => used.has(s.id));
      return `export default ${JSON.stringify({ v: src.v, series, patterns })};`;
    },
  };
}

// Vite 总会输出 <script type="module" crossorigin>：改成放在 body 末尾的经典脚本（IIFE 立即执行，要等 #root 已经在页面里）。
// 顺手把网站版的 viewport / 图标 / 描述换成小工具要的
function xhsHtml(): Plugin {
  return {
    name: 'xhs-html',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const tags: string[] = [];
        let out = html.replace(/\s*<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_m, src: string) => {
          tags.push(`    <script src="${src}"></script>`);
          return '';
        });
        out = out.replace(/\s+crossorigin(?=[\s>])/g, '');
        out = out.replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />');
        out = out.replace(/\s*<meta name="description"[^>]*>/, '').replace(/\s*<link rel="icon"[^>]*>/, '');
        return out.replace('</body>', `${tags.join('\n')}\n  </body>`);
      },
    },
  };
}

// public/ 里网站版才用的东西（抠图模型、图纸库 json、图标）不进小工具包：关掉 publicDir，只把字体拷过去
function xhsPublic(): Plugin {
  return {
    name: 'xhs-public',
    apply: 'build',
    closeBundle() {
      // 只拷字体文件本身；许可全文 OFL.txt 不在容器允许的文件类型里，协议页里已经带了全文
      cpSync(path.join(ROOT, 'public/fonts'), path.join(ROOT, 'dist-xhs/fonts'), { recursive: true, filter: src => !src.endsWith('.txt') });
    },
  };
}

// 构建后的 CSS 补 Chrome 61 回退写法（见 scripts/compat-css.mjs）
function cssCompat(): Plugin {
  return {
    name: 'xhs-css-compat',
    apply: 'build',
    writeBundle(opts, bundle) {
      for (const name of Object.keys(bundle)) {
        if (!name.endsWith('.css')) continue;
        const file = path.join(opts.dir ?? 'dist-xhs', name);
        writeFileSync(file, compatCss(readFileSync(file, 'utf8')));
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const xhs = mode === 'xhs';
  return {
    // GitHub Pages 项目页部署在 /doudou-pindou/ 下，本地开发用根路径；小工具 zip 里全是相对路径
    base: xhs ? './' : process.env.BASE_PATH ?? '/',
    resolve: {
      alias: { '@platform': path.join(ROOT, xhs ? 'src/platform/xhs/index.ts' : 'src/platform/web/index.ts') },
    },
    publicDir: xhs ? false : 'public',
    plugins: xhs ? [react(), libraryData(), xhsHtml(), xhsPublic(), cssCompat()] : [react(), localDev(), themeBoot(), securityHeaders()],
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['onnxruntime-web'] },
    build: xhs
      ? {
          outDir: 'dist-xhs',
          target: ['es2017', 'chrome61'],
          cssTarget: ['chrome61'],
          sourcemap: false,
          modulePreload: false,
          cssCodeSplit: false,
          assetsInlineLimit: 0,
          rolldownOptions: { output: { format: 'iife', codeSplitting: false } },
        }
      : {},
    // 测试只跑本仓库自己的，不进本地工具目录
    test: { exclude: ['**/node_modules/**', '**/dist/**', '**/dist-xhs/**', '.claude/**'] },
  };
});
