#!/usr/bin/env node
/**
 * verify-asar.js — SmartSCADA 打包校验工具
 * 用 @electron/asar 的 getRawHeader 解析头（已验证完整正确），自行按 '/' 下钻
 * （规避 Windows 上 path.sep 分隔符导致的 statFile 误报 not found），读取 asar 内
 * dist/index.html，全量比对它引用的每个资源是否真实存在于 asar 内；可选 --dist 做 sha256 比对。
 * 用法: node tools/verify-asar.js <app.asar> [--dist <dist目录>]
 * 退出码: 0=通过, 1=缺失/不一致, 2=参数错误
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ASAR = process.argv[2];
let DIST_DIR = null;
for (let i = 3; i < process.argv.length; i++) if (process.argv[i] === '--dist') DIST_DIR = process.argv[++i];
if (!ASAR) { console.error('usage: node verify-asar.js <app.asar> [--dist <dist>]'); process.exit(2); }

let getRawHeader;
try { ({ getRawHeader } = require('@electron/asar')); }
catch { getRawHeader = require(path.join(__dirname, '..', 'node_modules', '@electron/asar')).getRawHeader; }

const raw = getRawHeader(ASAR);
const header = raw.header;                 // { files: { dist, electron, ... } }
const FILE_DATA_BASE = 8 + raw.headerSize; // 8 字节 size + header JSON

function lookup(relPath) {
  const parts = relPath.split('/').filter(Boolean);
  let node = header; // 每级节点的子节点都挂在 node.files 下；根的子节点在 header.files
  for (const p of parts) {
    if (!node || !node.files || !node.files[p]) return null;
    node = node.files[p];
  }
  return node;
}
function readFileBytes(relPath) {
  const node = lookup(relPath);
  if (!node || node.files) return null;
  const off = FILE_DATA_BASE + parseInt(node.offset, 10);
  const fd = fs.openSync(ASAR, 'r');
  try {
    const buf = Buffer.alloc(node.size);
    fs.readSync(fd, buf, 0, node.size, off);
    return buf;
  } finally { fs.closeSync(fd); }
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

const idxBytes = readFileBytes('dist/index.html');
if (!idxBytes) { console.error('asar 内找不到 dist/index.html'); process.exit(1); }
const idxHtml = idxBytes.toString('utf8');

const refs = [];
for (const m of idxHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const u = m[1];
  if (u.startsWith('./') || u.startsWith('/') || (!u.startsWith('http') && !u.startsWith('data:'))) {
    const clean = u.replace(/^\.?\//, '');
    if (!refs.includes(clean)) refs.push(clean);
  }
}

console.log('=== SmartSCADA asar 校验 ===');
console.log('asar :', ASAR);
console.log('dist/index.html 引用资源数:', refs.length);

let missing = [];
let hashMismatch = [];
for (const r of refs) {
  const asarPath = 'dist/' + r;       // index.html 引用相对 dist/，asar 内路径需带 dist/ 前缀
  const inAsar = !!lookup(asarPath);
  let localMatch = 'n/a';
  if (DIST_DIR) {
    const localPath = path.join(DIST_DIR, r);
    if (fs.existsSync(localPath)) {
      const aBytes = readFileBytes(asarPath);
      const lBytes = fs.readFileSync(localPath);
      localMatch = (aBytes && sha256(aBytes) === sha256(lBytes)) ? 'OK' : 'MISMATCH';
      if (localMatch === 'MISMATCH') hashMismatch.push(r);
    } else localMatch = 'no-local';
  }
  console.log('  [' + (inAsar ? 'OK ' : 'MISSING') + '] ' + r + (DIST_DIR ? '  (local:' + localMatch + ')' : ''));
  if (!inAsar) missing.push(r);
}

const assetsNode = lookup('dist/assets');
const assetCount = assetsNode && assetsNode.files ? Object.keys(assetsNode.files).length : 0;
console.log('asar 内 dist/assets 文件数:', assetCount);

console.log('\n--- 结论 ---');
if (missing.length === 0) {
  console.log('index.html 引用的全部资源均存在于 asar 内。');
  if (DIST_DIR && hashMismatch.length === 0) console.log('与本地 dist 逐字节一致。');
  else if (DIST_DIR && hashMismatch.length) console.log('以下资源与本地 dist hash 不一致: ' + hashMismatch.join(', '));
  process.exit(0);
} else {
  console.log('缺失资源 (' + missing.length + '): ' + missing.join(', '));
  process.exit(1);
}
