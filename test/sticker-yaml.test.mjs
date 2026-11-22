import assert from 'node:assert/strict';
import { parseStickerYaml, serializeStickerYaml, checkSvg, StickerParseError } from '../js/core/sticker-yaml.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

test('解析區塊 svg 與 JSON 字串 gif', () => {
  const text = [
    '# 貼圖庫',
    'stickers:',
    '  - name: smile',
    '    type: svg',
    '    data: |',
    '      ' + SVG,
    '  - name: wave',
    '    type: gif',
    '    data: "' + GIF + '"',
    '',
  ].join('\n');
  const r = parseStickerYaml(text);
  assert.equal(r.stickers.length, 2);
  assert.deepEqual(r.stickers[0], { name: 'smile', type: 'svg', data: SVG });
  assert.deepEqual(r.stickers[1], { name: 'wave', type: 'gif', data: GIF });
});
test('serialize → parse 往返不變', () => {
  const stickers = [{ name: 'a1', type: 'svg', data: SVG }, { name: 'b-2', type: 'gif', data: GIF }];
  assert.deepEqual(parseStickerYaml(serializeStickerYaml(stickers)).stickers, stickers);
});
test('空清單與只有註解也合法', () => {
  assert.deepEqual(parseStickerYaml('stickers:\n').stickers, []);
  assert.deepEqual(parseStickerYaml('# only\nstickers:\n# x\n').stickers, []);
});
test('缺少 stickers: 開頭會報錯', () => {
  assert.throws(() => parseStickerYaml('  - name: x\n'), StickerParseError);
});
test('名稱不合法或重複會報錯（帶行號）', () => {
  const bad = 'stickers:\n  - name: Bad Name\n    type: svg\n    data: "' + SVG.replace(/"/g, '\\"') + '"\n';
  assert.throws(() => parseStickerYaml(bad), /名稱不合法/);
  const dup = serializeStickerYaml([{ name: 'x', type: 'svg', data: SVG }, { name: 'x', type: 'svg', data: SVG }]);
  assert.throws(() => parseStickerYaml(dup), /名稱重複/);
});
test('svg 安全檢查：擋 script、事件屬性、javascript:', () => {
  assert.equal(checkSvg(SVG), null);
  assert.match(checkSvg('<svg><script>alert(1)</script></svg>'), /script/);
  assert.match(checkSvg('<svg onload="x()"></svg>'), /事件/);
  assert.match(checkSvg('<svg><a href="javascript:x">a</a></svg>'), /javascript/);
  assert.match(checkSvg('<div></div>'), /必須以 <svg/);
  assert.match(checkSvg('<svg><foreignObject></foreignObject></svg>'), /foreignObject/);
});
test('含惡意 svg 的貼圖整檔會被拒絕', () => {
  const evil = serializeStickerYaml([{ name: 'evil', type: 'svg', data: '<svg onclick="x()"></svg>' }]);
  assert.throws(() => parseStickerYaml(evil), /事件屬性/);
});
test('gif 必須是 data:image/gif;base64', () => {
  const t = serializeStickerYaml([{ name: 'g', type: 'gif', data: 'https://x/y.gif' }]);
  assert.throws(() => parseStickerYaml(t), /gif 的 data/);
});
test('type 不合法、欄位不認識、縮排錯誤都會報錯', () => {
  assert.throws(() => parseStickerYaml('stickers:\n  - name: a\n    type: png\n    data: "x"\n'), /type/);
  assert.throws(() => parseStickerYaml('stickers:\n  - name: a\n    color: red\n'), /不認識/);
  assert.throws(() => parseStickerYaml('stickers:\n    name: a\n'), /縮排/);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (sticker-yaml)`);
  if (failed) process.exitCode = 1;
})();
