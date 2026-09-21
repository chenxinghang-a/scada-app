#!/usr/bin/env node
/**
 * verify-dist.js — 构建产物完整性闸门（fail-closed）
 *
 * 为什么需要它：
 *   本机环境的「批量删除保护」会在 `vite build` 的 emptyOutDir 阶段
 *   中途拦截删除，导致 dist/ 被删成半拉子 —— 部分 CSS/JS 消失了，
 *   而 index.html 仍引用它们。此时 electron-builder 照样能打包成功，
 *   装出来的应用在运行时才 404（样式丢失/白屏）。
 *
 *   **教训**：上一轮把这种现象误诊为「Vite manualChunks 产出了悬挂 CSS 引用」，
 *   于是写了 afterPack 钩子把那条 <link> 抹成空格 —— 而那条链接其实是
 *   合法的（vendor-element-*.css 确实由构建产出，357KB 的 Element Plus 样式）。
 *   补丁"修好"了症状，代价是打包后的应用丢掉全部 Element Plus 样式。
 *   正确做法是让构建产物自己说话：引用缺了就报错，不许往下走。
 *
 * 用法：
 *   node tools/verify-dist.js [dist目录]     # 默认 dist
 * 退出码：
 *   0 = 全部引用均存在；1 = 有缺失；2 = 参数/产物缺失（dist 或 index.html 不存在）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIST = path.resolve(process.argv[2] || 'dist');
const INDEX = path.join(DIST, 'index.html');

if (!fs.existsSync(INDEX)) {
  console.error('[verify-dist] 找不到构建产物: ' + INDEX);
  console.error('[verify-dist] 请先执行 npm run build');
  process.exit(2);
}

const html = fs.readFileSync(INDEX, 'utf8');

// 只校验本地相对引用；外链与 data: 不管
const refs = [];
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = m[1];
  if (/^(https?:|data:|#|mailto:)/i.test(url)) continue;
  const clean = url.replace(/^\.?\//, '').split('?')[0].split('#')[0];
  if (clean && !refs.includes(clean)) refs.push(clean);
}

console.log('=== SmartSCADA dist 完整性校验 ===');
console.log('dist :', DIST);
console.log('index.html 本地引用数:', refs.length);

const missing = [];
for (const r of refs) {
  const p = path.join(DIST, r);
  const ok = fs.existsSync(p) && fs.statSync(p).isFile() && fs.statSync(p).size > 0;
  console.log('  [' + (ok ? 'OK ' : 'MISS') + '] ' + r + (ok ? '' : '  <- 引用存在但文件缺失/为空'));
  if (!ok) missing.push(r);
}

// 防御性下界：index.html 至少要有入口 JS 与至少一条样式，否则说明产物本身不完整
if (refs.length < 2) {
  console.error('\n[verify-dist] 引用数异常偏少(' + refs.length + ')，产物可能不完整');
  process.exit(1);
}

console.log('\n--- 结论 ---');
if (missing.length === 0) {
  console.log('index.html 引用的全部本地资源均存在且非空。');
  process.exit(0);
}
console.error('缺失资源 (' + missing.length + '): ' + missing.join(', '));
console.error('产物不完整，**拒绝打包**。请清理 dist/ 后重新执行 npm run build。');
process.exit(1);
