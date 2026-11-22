// 把 archive-worker 的多個模組合併成單一檔案，方便貼進 Cloudflare 後台編輯器。
// 用法：node scripts/bundle-worker.mjs  → 產生 cloudflare/archive-worker/worker.bundle.js
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'cloudflare', 'archive-worker');
const strip = (src) =>
  src
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(?=(async\s+function|function|const|let|class)\b)/gm, '');

const parts = ['auth.js', 'rtc.js', 'squash.js'].map((f) => `// ---- ${f} ----\n${strip(readFileSync(join(dir, f), 'utf8'))}`);
const main = strip(readFileSync(join(dir, 'worker.js'), 'utf8'));
const out = `// 自動產生，請勿手改。來源：auth.js rtc.js squash.js worker.js（node scripts/bundle-worker.mjs）\n${parts.join('\n')}\n// ---- worker.js ----\n${main}`;
writeFileSync(join(dir, 'worker.bundle.js'), out);
console.log('寫出 worker.bundle.js', out.length, 'bytes');
