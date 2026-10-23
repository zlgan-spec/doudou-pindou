/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

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
        server.middlewares.use('/patterns/index.json', async (_req, res, next) => {
          try {
            const body = await readFile(path.resolve(library));
            res.setHeader('Content-Type', 'application/json');
            res.end(body);
          } catch {
            next();
          }
        });
      }
      server.middlewares.use('/test-images/', async (req, res, next) => {
        const name = path.basename(decodeURIComponent((req.url ?? '').split('?')[0]));
        try {
          const body = await readFile(path.resolve(process.env.DOUDOU_TEST_IMAGES ?? 'test-images', name));
          res.setHeader('Content-Type', 'image/png');
          res.end(body);
        } catch {
          next();
        }
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

export default defineConfig({
  // GitHub Pages 项目页部署在 /doudou-pindou/ 下，本地开发用根路径
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), localDev(), themeBoot(), securityHeaders()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  // 测试只跑本仓库自己的，不进本地工具目录
  test: { exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'] },
});
