// 確認 worker.bundle.js 是用目前的原始模組產生的（避免忘了重新產生）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBundle, BUNDLE_PATH } from '../scripts/bundle-worker.mjs';

const { text } = buildBundle();
const committed = fs.readFileSync(BUNDLE_PATH, 'utf8');
assert.equal(committed.replace(/\r\n/g, '\n'), text.replace(/\r\n/g, '\n'), 'worker.bundle.js 過期，請執行 node scripts/bundle-worker.mjs');
assert.equal((committed.match(/^export default/gm) || []).length, 1, '應該只有一個 export default');
assert.equal((committed.match(/^import\s/gm) || []).length, 0, '不應該有 import（單檔版本）');
console.log('ok   - bundle 與原始模組一致、只有一個 export default、沒有 import');
console.log('\n1/1 passed (bundle)');
