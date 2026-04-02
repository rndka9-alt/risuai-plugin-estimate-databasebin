import { build } from 'esbuild';
import { minify } from 'terser';
import { readFile, writeFile } from 'node:fs/promises';

const BANNER = `/*!
//@name database.bin
//@description database.bin 용량을 RisuSave 블록 포맷 기준으로 추산합니다
//@api 3.0
*/`;

// 1. esbuild: TS → single JS bundle
await build({
  entryPoints: ['src/plugin.ts'],
  bundle: true,
  format: 'esm',
  target: 'esnext',
  platform: 'browser',
  outfile: 'plugin.js',
  // RisuAI 플러그인은 async IIFE 내에서 실행되므로 top-level await 가능
  supported: { 'top-level-await': true },
});

// 2. terser: minify (/*! */ 주석 보존)
const code = await readFile('plugin.js', 'utf8');
const result = await minify(code, {
  module: true,
  compress: { passes: 2 },
  mangle: true,
  format: {
    comments: /^!/,
    semicolons: true,
  },
});

await writeFile('plugin.min.js', BANNER + '\n' + result.code);

const raw = Buffer.byteLength(code);
const min = Buffer.byteLength(BANNER + '\n' + result.code);
console.log(`plugin.js  → ${(raw / 1024).toFixed(1)} KB`);
console.log(`plugin.min.js → ${(min / 1024).toFixed(1)} KB (${((1 - min / raw) * 100).toFixed(0)}% 절감)`);
