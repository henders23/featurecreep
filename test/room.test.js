const test = require('node:test');
const assert = require('node:assert');
const { Room, COOLDOWN_MS, LEAD_MS, TRAY_SIZE } = require('../server/rooms');
const { FEATURES } = require('../shared/features');

function setup(focus) {
  let t = 1000000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const room = new Room('TEST-11', { now: clock.now, random: () => 0.42 });
  room.addPlayer('a', 'Amira', () => {});
  room.addPlayer('b', 'Jun', () => {});
  room.setSettings('a', { focus: focus || 'mix', textId: 'phones', speed: 'gentle' });
  room.start('a');
  return { room, clock };
}

// Find a segment in the text that holds a given feature (phrase or sentence).
function segFor(room, fid, skip) {
  const t = room.round.text;
  const unit = t.units[fid].find((u) => !room.round.found[u + ':' + fid] && u !== skip);
  return { unit, seg: t.unitSegs(unit)[0] };
}

function claimFeature(room, who, fid) {
  // Force the tray to contain the feature so the test is deterministic.
  room.round.tray[0] = { key: 999, fid: fid };
  return room.claim(who, 999);
}

test('only the host can change settings or start', () => {
  const room = new Room('TEST-12');
  room.addPlayer('a', 'Host', () => {});
  room.addPlayer('b', 'Guest', () => {});
  assert.strictEqual(room.setSettings('b', { focus: 'language' }), false);
  assert.strictEqual(room.start('b'), false);
  assert.strictEqual(room.setSettings('a', { focus: 'language' }), true);
  assert.strictEqual(room.settings.focus, 'language');
});

test('tray always holds five tiles from the chosen focus', () => {
  for (const focus of ['language', 'text', 'organisation', 'mix']) {
    const { room } = setup(focus);
    assert.strictEqual(room.round.tray.length, TRAY_SIZE);
    for (const tile of room.round.tray) {
      if (focus !== 'mix') assert.strictEqual(FEATURES[tile.fid].cat, focus);
    }
    const r = room.claim('a', room.round.tray[2].key);
    assert.ok(r.ok);
    assert.strictEqual(room.round.tray.length, TRAY_SIZE);
  }
});

test('organisation focus works even though it has only four features', () => {
  const { room } = setup('organisation');
  for (let i = 0; i < 12; i++) {
    const r = room.claim(i % 2 ? 'a' : 'b', room.round.tray[i % TRAY_SIZE].key);
    assert.ok(r.ok);
    assert.strictEqual(room.round.tray.length, TRAY_SIZE);
  }
});

test('a correct click scores once; the same spot cannot score twice', () => {
  const { room } = setup();
  claimFeature(room, 'a', 'thesis');
  const { seg } = segFor(room, 'thesis');
  const r = room.find('a', seg);
  assert.ok(r.ok);
  assert.strictEqual(room.players.get('a').score, FEATURES.thesis.pts);
  assert.strictEqual(room.players.get('a').claim, null);

  claimFeature(room, 'b', 'thesis');
  const again = room.find('b', seg);
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.reason, 'taken');
  assert.strictEqual(room.players.get('b').score, 0);
});

test('a wrong click freezes the player', () => {
  const { room, clock } = setup();
  claimFeature(room, 'a', 'thesis');
  const wrong = room.round.text.segs.findIndex((s, i) => {
    const sent = room.round.text.sents[s.si];
    return s.pf.indexOf('thesis') < 0 && sent.sf.indexOf('thesis') < 0 && i > 0;
  });
  const r = room.find('a', wrong);
  assert.strictEqual(r.reason, 'wrong');
  const { seg } = segFor(room, 'thesis');
  assert.strictEqual(room.find('a', seg).reason, 'frozen');
  clock.advance(COOLDOWN_MS + 1);
  assert.ok(room.find('a', seg).ok);
});

test('phrase features and sentence features are both findable', () => {
  const { room } = setup();
  claimFeature(room, 'a', 'hedge');
  const h = segFor(room, 'hedge');
  assert.ok(h.unit.startsWith('g'));
  assert.ok(room.find('a', h.seg).ok);

  claimFeature(room, 'a', 'counter');
  const c = segFor(room, 'counter');
  assert.ok(c.unit.startsWith('s'));
  const sentSegs = room.round.text.unitSegs(c.unit);
  assert.ok(room.find('a', sentSegs[sentSegs.length - 1]).ok, 'any part of the sentence counts');
});

test('claiming a new tile drops the old one', () => {
  const { room } = setup();
  claimFeature(room, 'a', 'thesis');
  room.round.tray[1] = { key: 1001, fid: 'hedge' };
  const r = room.claim('a', 1001);
  assert.strictEqual(r.dropped, 'thesis');
  assert.strictEqual(room.players.get('a').claim, 'hedge');
});

test('round ends after its duration, pauses do not count, and results add up', () => {
  const { room, clock } = setup();
  claimFeature(room, 'a', 'thesis');
  room.find('a', segFor(room, 'thesis').seg);
  claimFeature(room, 'b', 'signpost');
  room.find('b', segFor(room, 'signpost').seg);

  room.togglePause('a');
  clock.advance(room.round.duration * 2);
  assert.strictEqual(room.tick(), false, 'paused rounds do not end');
  room.togglePause('a');
  clock.advance(room.round.duration - 10);
  assert.strictEqual(room.tick(), false, 'the countdown does not eat into the round');
  clock.advance(LEAD_MS + 20);
  assert.strictEqual(room.tick(), true);
  assert.strictEqual(room.phase, 'over');

  const res = room.results;
  const totalUnits = room.round.focusIds.reduce((n, fid) => n + room.round.text.units[fid].length, 0);
  assert.strictEqual(res.found.length, 2);
  assert.strictEqual(res.found.length + res.missed.length, totalUnits);
  assert.strictEqual(res.players[0].finds.length, 1);
  const catTotal = Object.values(res.byCategory).reduce((n, c) => n + c.total, 0);
  assert.strictEqual(catTotal, totalUnits);
});

test('focus limits the results to the chosen category', () => {
  const { room, clock } = setup('language');
  clock.advance(room.round.duration + LEAD_MS + 1);
  room.tick();
  for (const m of room.results.missed) assert.strictEqual(FEATURES[m.fid].cat, 'language');
  assert.deepStrictEqual(Object.keys(room.results.byCategory), ['language']);
});

test('the host passes on when the host leaves', () => {
  const room = new Room('TEST-13');
  room.addPlayer('a', 'Host', () => {});
  room.addPlayer('b', 'Guest', () => {});
  room.removePlayer('a');
  assert.strictEqual(room.hostId, 'b');
});

test('features missed last round come back more often', () => {
  const { room, clock } = setup('language');
  clock.advance(room.round.duration + LEAD_MS + 1);
  room.tick();
  room.start('a');
  assert.ok(room.review.length > 0);
  for (const fid of room.review) assert.strictEqual(FEATURES[fid].cat, 'language');
});
