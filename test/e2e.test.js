// Runs a real server on a free port and plays a short round with two
// WebSocket clients, checking the messages each player receives.

const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { createServer } = require('../server/index');

function client(port) {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
  const inbox = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data));
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(msg)) { waiters[i].resolve(msg); waiters.splice(i, 1); }
    }
  });
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    waitFor: (match, ms) => new Promise((resolve, reject) => {
      const found = inbox.find(match);
      if (found) { inbox.splice(inbox.indexOf(found), 1); return resolve(found); }
      const t = setTimeout(() => reject(new Error('timed out waiting for message')), ms || 3000);
      waiters.push({ match, resolve: (m) => { clearTimeout(t); inbox.splice(inbox.indexOf(m), 1); resolve(m); } });
    }),
    clear: () => { inbox.length = 0; }
  };
}

test('two players can play a full round over WebSockets', async () => {
  const { server, wss, manager } = createServer({ tickMs: 50 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    // static files and health check
    const page = await fetch('http://127.0.0.1:' + port + '/');
    assert.strictEqual(page.status, 200);
    assert.match(await page.text(), /Feature Creep/);
    const health = await fetch('http://127.0.0.1:' + port + '/healthz');
    assert.deepStrictEqual(await health.json(), { ok: true });

    const a = client(port);
    const b = client(port);
    const welcomeA = await a.waitFor((m) => m.type === 'welcome');
    await b.waitFor((m) => m.type === 'welcome');
    assert.ok(welcomeA.texts.length >= 6, 'catalogue lists the texts');
    assert.ok(welcomeA.features.hedge, 'catalogue lists the features');

    a.send({ type: 'create', name: 'Amira' });
    const joinedA = await a.waitFor((m) => m.type === 'joined');

    b.send({ type: 'join', code: 'NOPE-00', name: 'Jun' });
    const err = await b.waitFor((m) => m.type === 'error');
    assert.match(err.message, /No game/);

    b.send({ type: 'join', code: joinedA.code.toLowerCase(), name: 'Jun' });
    await b.waitFor((m) => m.type === 'joined');
    const lobby = await a.waitFor((m) => m.type === 'state' && m.players.length === 2);
    assert.strictEqual(lobby.hostId, welcomeA.you);

    // a guest cannot change settings; the host can
    b.send({ type: 'settings', settings: { focus: 'organisation' } });
    a.send({ type: 'settings', settings: { focus: 'text', textId: 'emi' } });
    const set = await b.waitFor((m) => m.type === 'state' && m.settings.focus === 'text');
    assert.strictEqual(set.settings.textId, 'emi');

    a.clear(); b.clear();
    a.send({ type: 'start' });
    const roundA = await a.waitFor((m) => m.type === 'round');
    await b.waitFor((m) => m.type === 'round');
    assert.strictEqual(roundA.text.id, 'emi');
    assert.ok(!JSON.stringify(roundA).includes('"pf"'), 'clients never see the tags');
    const st = await a.waitFor((m) => m.type === 'state' && m.round);
    assert.strictEqual(st.round.tray.length, 5);
    for (const tile of st.round.tray) assert.strictEqual(welcomeA.features[tile.fid].cat, 'text');

    // Amira claims a tile and finds it in the text
    const room = manager.get(joinedA.code);
    const tile = st.round.tray[0];
    a.send({ type: 'claim', key: tile.key });
    const claimed = await a.waitFor((m) => m.type === 'claimResult');
    assert.ok(claimed.ok);
    const unit = room.round.text.units[tile.fid][0];
    const seg = room.round.text.unitSegs(unit)[0];

    // Jun tries to grab the same tile too late
    b.send({ type: 'claim', key: tile.key });
    const late = await b.waitFor((m) => m.type === 'claimResult');
    assert.strictEqual(late.reason, 'gone');

    a.send({ type: 'find', seg: seg });
    const hit = await a.waitFor((m) => m.type === 'findResult');
    assert.ok(hit.ok, 'correct find scores');
    const marked = await b.waitFor((m) => m.type === 'state' && m.round && m.round.marks.length === 1);
    assert.deepStrictEqual(marked.round.marks[0].segs, room.round.text.unitSegs(unit));
    assert.strictEqual(marked.players.find((p) => p.id === welcomeA.you).score, welcomeA.features[tile.fid].pts);

    // Jun claims something and clicks the wrong place: frozen
    const tray2 = marked.round.tray;
    b.send({ type: 'claim', key: tray2[1].key });
    const bClaim = await b.waitFor((m) => m.type === 'claimResult');
    const t = room.round.text;
    const wrongSeg = t.segs.findIndex((s) => s.pf.indexOf(bClaim.fid) < 0 && t.sents[s.si].sf.indexOf(bClaim.fid) < 0);
    b.send({ type: 'find', seg: wrongSeg });
    const miss = await b.waitFor((m) => m.type === 'findResult');
    assert.strictEqual(miss.reason, 'wrong');

    // end the round early and check the results
    room.round.startedAt -= room.round.duration + 10000;
    const overA = await a.waitFor((m) => m.type === 'over', 2000);
    const overB = await b.waitFor((m) => m.type === 'over', 2000);
    assert.strictEqual(overA.players[0].finds.length, 1);
    assert.strictEqual(overA.found.length, 1);
    assert.ok(overA.missed.length > 0);
    assert.deepStrictEqual(overA.categories, ['text']);
    assert.ok(overA.missed.every((m) => welcomeA.features[m.fid].cat === 'text'));
    assert.deepStrictEqual(overA, overB, 'everyone sees the same results');
    const after = await a.waitFor((m) => m.type === 'state' && m.phase === 'over');
    assert.ok(!after.round);

    // the host returns everyone to the lobby
    a.send({ type: 'lobby' });
    await b.waitFor((m) => m.type === 'state' && m.phase === 'lobby');

    a.ws.close(); b.ws.close();
  } finally {
    for (const c of wss.clients) c.terminate();
    wss.close();
    await new Promise((r) => server.close(r));
  }
});
