const test = require('node:test');
const assert = require('node:assert');
const { Room, COOLDOWN_MS, LEAD_MS, CLEAR_MS } = require('../server/rooms');
const TEXTS = require('../shared/texts');
const { FEATURES, FOCUS_OPTIONS } = require('../shared/features');

function setup(focus, textId) {
  let t = 1000000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const room = new Room('TEST-11', { now: clock.now, random: () => 0.42 });
  room.addPlayer('a', 'Amira', () => {});
  room.addPlayer('b', 'Jun', () => {});
  room.setSettings('a', { focus: focus || 'mix', textId: textId || 'phones', speed: 'gentle' });
  room.start('a');
  clock.advance(LEAD_MS); // the opening countdown
  return { room, clock };
}

// A segment in the paragraph on screen that holds a given feature.
function segFor(room, fid) {
  const unit = room.open(fid)[0];
  return { unit, seg: room.round.text.unitSegs(unit)[0] };
}

// Lets the clock run until the paragraph that holds a feature is on screen.
function goTo(room, clock, fid) {
  while (room.phase === 'playing' && !room.remaining(fid)) {
    clock.advance(room.round.duration);
    room.tick();
  }
  assert.strictEqual(room.phase, 'playing', fid + ' never came up');
}

function endRound(room, clock) {
  while (room.phase === 'playing') { clock.advance(room.round.duration); room.tick(); }
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

test('the tray offers exactly the features left in the paragraph on screen', () => {
  for (const focus of ['language', 'argument', 'organisation', 'mix']) {
    const { room, clock } = setup(focus);
    while (room.phase === 'playing') {
      const tray = room.tray();
      const prog = room.paraProgress();
      assert.ok(tray.length > 0, 'a paragraph with nothing to find is never shown');
      assert.strictEqual(tray.reduce((n, t) => n + t.left, 0), prog.total);
      assert.strictEqual(new Set(tray.map((t) => t.fid)).size, tray.length, 'one tile per feature');
      for (const tile of tray) {
        if (focus !== 'mix') assert.strictEqual(FEATURES[tile.fid].cat, focus);
        for (const unit of room.open(tile.fid)) assert.strictEqual(room.round.text.unitPara(unit), room.currentPara());
      }
      clock.advance(room.round.duration);
      room.tick();
    }
  }
});

test('every feature in every paragraph can be found, by one player, in every text and focus', () => {
  for (const raw of TEXTS) {
    for (const focus of Object.keys(FOCUS_OPTIONS)) {
      const { room, clock } = setup(focus, raw.id);
      const shown = [];
      while (room.phase === 'playing') {
        shown.push(room.currentPara());
        let tray = room.tray();
        while (tray.length) {
          const fid = tray[0].fid;
          assert.ok(room.claim('a', fid).ok);
          // Click the last part of the unit, where a sentence feature and a
          // phrase feature of the same kind can overlap.
          const segs = room.round.text.unitSegs(room.open(fid)[0]);
          const res = room.find('a', segs[segs.length - 1]);
          assert.ok(res.ok, raw.id + ' ' + focus + ' ' + fid + ': ' + res.reason);
          tray = room.tray();
        }
        assert.ok(room.round.clearedAt, 'paragraph is cleared');
        assert.strictEqual(room.tick(), null, 'a short beat before the next paragraph');
        clock.advance(CLEAR_MS);
        assert.ok(room.tick());
      }
      assert.strictEqual(room.results.missed.length, 0, raw.id + ' ' + focus + ' leaves nothing unfindable');
      assert.strictEqual(new Set(shown).size, shown.length);
    }
  }
});

test('a paragraph gives more time when it is longer or holds more features', () => {
  const { room } = setup('mix');
  const [intro, body] = [room.paraDuration(0), room.paraDuration(1)];
  assert.ok(body > intro);
  assert.ok(intro >= 20000 && body <= 180000);
  const brisk = new Room('TEST-14');
  brisk.addPlayer('a', 'Host', () => {});
  brisk.setSettings('a', { textId: 'phones', speed: 'brisk' });
  brisk.start('a');
  assert.ok(brisk.paraDuration(1) < body);
});

test('a correct click scores once; the same spot cannot score twice', () => {
  const { room, clock } = setup();
  goTo(room, clock, 'thesis');
  room.claim('a', 'thesis');
  room.claim('b', 'thesis');
  const { seg } = segFor(room, 'thesis');
  const r = room.find('a', seg);
  assert.ok(r.ok);
  assert.strictEqual(room.players.get('a').score, FEATURES.thesis.pts);
  assert.strictEqual(room.players.get('a').claim, null);
  assert.strictEqual(room.players.get('b').claim, null, 'nothing left to hunt, so the claim lapses for everyone');
  assert.strictEqual(room.claim('b', 'thesis').reason, 'gone');
  assert.strictEqual(room.players.get('b').score, 0);
});

test('two players can hunt the same feature; each instance scores for whoever clicks first', () => {
  const { room, clock } = setup();
  goTo(room, clock, 'hedge');
  assert.ok(room.remaining('hedge') >= 2);
  assert.ok(room.claim('a', 'hedge').ok);
  assert.ok(room.claim('b', 'hedge').ok);
  const first = segFor(room, 'hedge');
  assert.ok(room.find('a', first.seg).ok);
  assert.strictEqual(room.players.get('a').claim, 'hedge', 'keeps hunting while more remain');
  assert.strictEqual(room.find('b', first.seg).reason, 'taken');
  assert.ok(room.find('b', segFor(room, 'hedge').seg).ok);
});

test('a wrong click freezes the player', () => {
  const { room, clock } = setup();
  goTo(room, clock, 'thesis');
  room.claim('a', 'thesis');
  const t = room.round.text;
  const wrong = t.paragraphs[room.currentPara()].segIdx.find((gi) => t.sents[t.segs[gi].si].sf.indexOf('thesis') < 0);
  const r = room.find('a', wrong);
  assert.strictEqual(r.reason, 'wrong');
  const { seg } = segFor(room, 'thesis');
  assert.strictEqual(room.find('a', seg).reason, 'frozen');
  clock.advance(COOLDOWN_MS + 1);
  assert.ok(room.find('a', seg).ok);
});

test('phrase features and sentence features are both findable', () => {
  const { room, clock } = setup();
  goTo(room, clock, 'hedge');
  room.claim('a', 'hedge');
  const h = segFor(room, 'hedge');
  assert.ok(h.unit.startsWith('g'));
  assert.ok(room.find('a', h.seg).ok);

  goTo(room, clock, 'counter');
  room.claim('a', 'counter');
  const c = segFor(room, 'counter');
  assert.ok(c.unit.startsWith('s'));
  const sentSegs = room.round.text.unitSegs(c.unit);
  assert.ok(room.find('a', sentSegs[sentSegs.length - 1]).ok, 'any part of the sentence counts');
});

test('a source sentence and a citation inside it can both be found', () => {
  const { room, clock } = setup('argument', 'fourday');
  const t = room.round.text;
  const gi = t.segs.findIndex((s) => s.pf.indexOf('source') >= 0 && t.sents[s.si].sf.indexOf('source') >= 0);
  assert.ok(gi >= 0);
  while (room.currentPara() !== t.segs[gi].pi) { clock.advance(room.round.duration); room.tick(); }
  room.claim('a', 'source');
  assert.strictEqual(room.find('a', gi).unit, 'g' + gi);
  assert.strictEqual(room.find('a', gi).unit, 's' + t.segs[gi].si, 'a second click on the citation finds the sentence');
});

test('choosing another feature swaps the hunt; a feature not in the paragraph cannot be chosen', () => {
  const { room, clock } = setup();
  goTo(room, clock, 'hedge');
  room.claim('a', 'hedge');
  assert.ok(room.claim('a', 'signpost').ok);
  assert.strictEqual(room.players.get('a').claim, 'signpost');
  assert.strictEqual(room.claim('a', 'thesis').reason, 'gone');
  assert.strictEqual(room.players.get('a').claim, 'signpost');
});

test('nothing can be found during the opening countdown or in a paragraph that has gone', () => {
  let t = 5000;
  const room = new Room('TEST-15', { now: () => t });
  room.addPlayer('a', 'Amira', () => {});
  room.setSettings('a', { textId: 'phones' });
  room.start('a');
  assert.ok(room.claim('a', 'thesis').ok, 'a feature can be chosen during the countdown');
  const seg = segFor(room, 'thesis').seg;
  assert.strictEqual(room.find('a', seg).reason, 'not-playing');
  t += LEAD_MS + room.round.duration;
  assert.strictEqual(room.tick(), 'next');
  assert.strictEqual(room.players.get('a').claim, null, 'the new paragraph has no thesis');
  room.claim('a', 'hedge');
  assert.strictEqual(room.find('a', seg).reason, 'stale');
  assert.strictEqual(room.players.get('a').cooldownUntil, 0, 'no penalty for a late click');
});

test('each paragraph is replaced when its time is up; pauses do not count; results add up', () => {
  const { room, clock } = setup();
  const steps = room.round.paras.length;
  assert.strictEqual(steps, 4);
  room.claim('a', 'thesis');
  room.find('a', segFor(room, 'thesis').seg);

  room.togglePause('a');
  clock.advance(room.round.duration * 2);
  assert.strictEqual(room.tick(), null, 'a paused paragraph stays');
  room.togglePause('a');
  clock.advance(room.round.duration - 10);
  assert.strictEqual(room.tick(), null, 'the countdown does not eat into the paragraph');
  clock.advance(20);
  assert.strictEqual(room.tick(), 'next');
  assert.strictEqual(room.state().round.step, 2);
  assert.strictEqual(room.state().round.marks.length, 0, 'marks belong to the paragraph on screen');

  room.claim('b', 'signpost');
  room.find('b', segFor(room, 'signpost').seg);
  for (let i = 2; i < steps; i++) {
    clock.advance(room.round.duration);
    assert.strictEqual(room.tick(), 'next');
  }
  clock.advance(room.round.duration);
  assert.strictEqual(room.tick(), 'over');
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
  endRound(room, clock);
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

test('features missed last round are flagged in the next round\'s tray', () => {
  const { room, clock } = setup('language');
  endRound(room, clock);
  room.start('a');
  assert.ok(room.review.length > 0);
  for (const fid of room.review) assert.strictEqual(FEATURES[fid].cat, 'language');
  assert.ok(room.tray().every((t) => t.review === (room.review.indexOf(t.fid) >= 0)));
});

test('a game holds four players; the fifth is turned away until someone leaves', () => {
  const { RoomManager } = require('../server/rooms');
  const manager = new RoomManager();
  const room = manager.create();
  for (const id of ['a', 'b', 'c', 'd']) assert.ok(room.addPlayer(id, id, () => {}).player);
  assert.match(room.addPlayer('e', 'e', () => {}).error, /full/);
  assert.deepStrictEqual(
    manager.list().map((g) => [g.players, g.max, g.full]),
    [[4, 4, true]]
  );
  room.removePlayer('b');
  assert.ok(room.addPlayer('e', 'e', () => {}).player);
});
