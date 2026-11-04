const test = require('node:test');
const assert = require('node:assert');
const TEXTS = require('../shared/texts');
const { FEATURES } = require('../shared/features');
const { compile, publicText } = require('../server/textEngine');

test('every text compiles and contains every feature at least once', () => {
  for (const raw of TEXTS) {
    const c = compile(raw);
    for (const fid of Object.keys(FEATURES)) {
      assert.ok(c.units[fid].length > 0, raw.id + ' has no ' + fid);
    }
  }
});

test('text ids are unique', () => {
  const ids = TEXTS.map((t) => t.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('public text never leaks feature tags', () => {
  for (const raw of TEXTS) {
    const json = JSON.stringify(publicText(compile(raw)));
    assert.ok(!/"pf"|"sf"|\[\[|\{thesis/.test(json), raw.id + ' leaks tags');
  }
});

test('reassembled text reads cleanly', () => {
  for (const raw of TEXTS) {
    const c = compile(raw);
    const whole = c.segs.map((s) => s.t).join('');
    assert.ok(!/ {2}/.test(whole), raw.id + ' has double spaces');
    assert.ok(!/ [.,]/.test(whole), raw.id + ' has a space before punctuation');
  }
});
