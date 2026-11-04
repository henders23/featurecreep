(function () {
  'use strict';

  // ---------------------------------------------------------------- state
  const S = {
    ws: null,
    cat: null,            // catalogue: features, categories, texts, speeds
    me: null,             // my player id
    room: null,           // latest 'state' message
    text: null,           // the round's text (words only)
    focusIds: [],
    results: null,        // end-of-round results
    fbStep: 0,            // 0 = scores (B), 1 = the text (A), 2 = blind spots (D)
    screen: null,
    clockOffset: 0,
    error: '',
    lobbyKey: '',
    game: null            // live DOM references while playing
  };
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const START_OFFSET = 150;

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + a + ')';
  }
  function initials(name, isMe) {
    if (isMe) return 'YOU';
    const parts = String(name).trim().split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : String(name).slice(0, 2)).toUpperCase();
  }
  function feature(fid) { return S.cat.features[fid]; }
  function category(fid) { return S.cat.categories[feature(fid).cat]; }
  function serverNow() { return Date.now() + S.clockOffset; }
  function player(id) {
    return S.room ? S.room.players.find((p) => p.id === id) : null;
  }
  function isHost() { return S.room && S.room.hostId === S.me; }
  function send(msg) {
    if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(msg));
  }
  let toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }
  function savedName() {
    try { return localStorage.getItem('fc-name') || ''; } catch (e) { return ''; }
  }
  function saveName(n) {
    try { localStorage.setItem('fc-name', n); } catch (e) { /* ignore */ }
  }
  const logo = (cls) => '<div class="logo ' + (cls || '') + '"><span>Feature</span><span class="creep"><span>C</span><span>r</span><span>e</span><span>e</span><span>p</span></span></div>';
  const catIcon = (catId) => {
    if (catId === 'language') return '<span class="aa">Aa</span>';
    if (catId === 'text') return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#10131A" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 6H20M4 11H20M4 16H14"></path></svg>';
    return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#10131A" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1"></rect><rect x="3" y="11" width="12" height="4" rx="1"></rect><rect x="3" y="17" width="15" height="4" rx="1"></rect></svg>';
  };

  // ---------------------------------------------------------------- connection
  function connect() {
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    const ws = new WebSocket(url);
    S.ws = ws;
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    };
    ws.onclose = () => { document.getElementById('offline').hidden = false; };
    setInterval(() => send({ type: 'ping', t: Date.now() }), 10000);
    ws.onopen = () => send({ type: 'ping', t: Date.now() });
  }

  function handle(msg) {
    switch (msg.type) {
      case 'welcome':
        S.cat = msg;
        S.me = msg.you;
        render();
        break;
      case 'pong': {
        const now = Date.now();
        const rtt = now - msg.t;
        S.clockOffset = msg.serverNow + rtt / 2 - now;
        break;
      }
      case 'joined':
        S.me = msg.you;
        S.error = '';
        break;
      case 'error':
        S.error = msg.message;
        if (!S.room) render(); else toast(msg.message);
        break;
      case 'left':
        S.room = null; S.text = null; S.results = null;
        render();
        break;
      case 'round':
        S.text = msg.text;
        S.focusIds = msg.focusIds;
        S.results = null;
        S.fbStep = 0;
        S.game = null;
        break;
      case 'over':
        // The state message that follows switches the screen.
        S.results = msg;
        S.fbStep = 0;
        break;
      case 'state':
        onState(msg);
        break;
      case 'claimResult':
        if (!msg.ok && msg.reason === 'gone') toast('Someone else claimed that one first.');
        if (msg.ok && msg.dropped) toast('Dropped ' + feature(msg.dropped).name + '. Now hunting ' + feature(msg.fid).name + '.');
        break;
      case 'findResult':
        onFindResult(msg);
        break;
      default:
        break;
    }
  }

  function onState(msg) {
    if (S.clockOffset === 0) S.clockOffset = msg.serverNow - Date.now();
    const prev = S.room;
    S.room = msg;
    const screen = screenFor();
    if (screen !== S.screen) { render(); return; }
    if (screen === 'game') updateGame();
    if (screen === 'lobby') {
      const key = JSON.stringify([msg.hostId, msg.settings, msg.players.map((p) => [p.id, p.name, p.color])]);
      if (key !== S.lobbyKey) render();
    }
    if (screen === 'feedback' && prev && prev.hostId !== msg.hostId) render();
  }

  function screenFor() {
    if (!S.cat) return 'loading';
    if (!S.room) return 'home';
    if (S.room.phase === 'playing' && S.text) return 'game';
    if (S.room.phase === 'over' && S.results) return 'feedback';
    return 'lobby';
  }

  // ---------------------------------------------------------------- render
  function render() {
    S.screen = screenFor();
    if (S.screen !== 'game') S.game = null;
    if (S.screen === 'loading') app.innerHTML = '<div class="home"><div class="kicker">Connecting…</div></div>';
    if (S.screen === 'home') renderHome();
    if (S.screen === 'lobby') renderLobby();
    if (S.screen === 'game') buildGame();
    if (S.screen === 'feedback') renderFeedback();
  }

  // ---------------------------------------------------------------- home
  function renderHome() {
    app.innerHTML =
      '<main class="home"><div class="home-inner">' +
      '<div class="home-hero">' +
      '<span class="kicker gold">A reading hunt for 1–6 players</span>' +
      logo('big') +
      '<p>An academic essay rises up the screen towards a shredder. Claim features of academic writing from the tray, then find them in the text before they’re gone.</p>' +
      '</div>' +
      '<div class="field" style="max-width:420px"><label for="name">Your name</label><input id="name" class="input" maxlength="18" autocomplete="nickname" value="' + esc(savedName()) + '" placeholder="e.g. Amira"></div>' +
      '<div class="home-forms">' +
      '<div class="panel form-card"><h2 style="font-size:24px">Start a new game</h2><p style="margin:0;color:var(--soft);font-size:15px;line-height:1.5">You’ll get a code to share. You choose the text and the features.</p><button type="button" class="btn btn-gold" data-action="create">Create a game</button></div>' +
      '<div class="panel form-card"><h2 style="font-size:24px">Join a game</h2><div class="field"><label for="code">Game code</label><input id="code" class="input code" maxlength="10" placeholder="HEDGE-42" autocomplete="off"></div><button type="button" class="btn btn-ghost" data-action="join">Join</button></div>' +
      '</div>' +
      '<p class="error" role="alert">' + esc(S.error) + '</p>' +
      '</div></main>';
    const code = document.getElementById('code');
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  }

  function nameValue() {
    const el = document.getElementById('name');
    const n = (el && el.value.trim()) || '';
    if (n) saveName(n);
    return n;
  }
  function doCreate() {
    const name = nameValue();
    if (!name) { S.error = 'Type your name first.'; renderHome(); return; }
    send({ type: 'create', name: name });
  }
  function doJoin() {
    const name = nameValue();
    const code = (document.getElementById('code').value || '').trim().toUpperCase();
    if (!name) { S.error = 'Type your name first.'; renderHome(); return; }
    if (!code) { S.error = 'Type the game code your host shared.'; renderHome(); return; }
    send({ type: 'join', code: code, name: name });
  }

  // ---------------------------------------------------------------- lobby
  function renderLobby() {
    const r = S.room;
    const host = isHost();
    S.lobbyKey = JSON.stringify([r.hostId, r.settings, r.players.map((p) => [p.id, p.name, p.color])]);
    const focusOrder = ['mix', 'language', 'text', 'organisation'];
    const focusCards = focusOrder.map((f) => {
      const cats = S.cat.focusOptions[f];
      const title = f === 'mix' ? 'Mix' : S.cat.categories[f].name;
      const blurb = f === 'mix' ? 'A bit of everything: all three kinds of feature in one round.' : S.cat.categories[f].blurb;
      const names = Object.keys(S.cat.features).filter((id) => cats.indexOf(S.cat.features[id].cat) >= 0).map((id) => S.cat.features[id].name);
      return '<button type="button" class="focus-card" data-action="focus" data-focus="' + f + '" aria-pressed="' + (r.settings.focus === f) + '"' + (host ? '' : ' disabled') + '>' +
        '<span class="swatches">' + cats.map((c) => '<span style="background:' + S.cat.categories[c].color + '"></span>').join('') + '</span>' +
        '<strong>' + title + '</strong><span class="blurb">' + esc(blurb) + '</span>' +
        '<span class="list">' + esc(f === 'mix' ? 'All 18 features' : names.join(' · ')) + '</span></button>';
    }).join('');
    const textOptions = '<option value="random"' + (r.settings.textId === 'random' ? ' selected' : '') + '>Surprise me (random text)</option>' +
      S.cat.texts.map((t) => '<option value="' + t.id + '"' + (r.settings.textId === t.id ? ' selected' : '') + '>' + esc(t.title) + ' · ' + esc(t.discipline) + '</option>').join('');
    const speedButtons = S.cat.speeds.map((s) => '<button type="button" data-action="speed" data-speed="' + s + '" aria-pressed="' + (r.settings.speed === s) + '"' + (host ? '' : ' disabled') + '>' + (s === 'gentle' ? 'Gentle · about 3 min' : 'Brisk · about 2 min') + '</button>').join('');
    const players = r.players.map((p) =>
      '<div class="player-row"><span class="avatar" style="background:' + p.color + '">' + esc(initials(p.name, p.id === S.me)) + '</span>' +
      '<span style="flex:1;font-size:17px;font-weight:600">' + esc(p.name) + (p.id === S.me ? ' <span style="color:var(--muted);font-weight:400">(you)</span>' : '') + '</span>' +
      (p.id === r.hostId ? '<span class="kicker gold" style="font-size:10px">HOST</span>' : '') + '</div>').join('');

    app.innerHTML =
      '<main class="page">' +
      '<div class="lobby-head"><div style="display:flex;flex-direction:column;gap:12px">' + logo() +
      '<span class="kicker">' + (host ? 'You’re the host. Choose the round, then start.' : 'Waiting for the host to start the round.') + '</span></div>' +
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="kicker">Game code — share it</span><span class="room-code">' + esc(r.code) + '</span></div></div>' +
      '<div class="lobby-grid"><section class="lobby-main">' +
      '<div class="panel" style="display:flex;flex-direction:column;gap:16px"><div><span class="kicker">What will you hunt for?</span></div><div class="focus-grid">' + focusCards + '</div></div>' +
      '<div class="panel settings-row">' +
      '<div class="field"><label for="textSel">Text</label><select id="textSel" class="select"' + (host ? '' : ' disabled') + '>' + textOptions + '</select></div>' +
      '<div class="field"><label>Speed</label><div class="seg-toggle">' + speedButtons + '</div></div>' +
      '</div>' +
      (host ? '<div><button type="button" class="btn btn-gold" data-action="start" style="min-height:62px;padding:0 40px;font-size:19px">Start round</button></div>' : '<p class="waiting">The host chooses the text and features. The round starts for everyone at once.</p>') +
      '</section><aside class="lobby-side">' +
      '<div class="panel"><span class="kicker">Players · ' + r.players.length + ' of 6</span><div style="margin-top:8px">' + players + '</div></div>' +
      '<div class="panel"><span class="kicker">How to play</span><ol class="steps" style="margin-top:14px">' +
      '<li><b>1</b><span><strong style="color:var(--ink)">Claim.</strong> Click a feature in the tray. Hover over it first for a definition.</span></li>' +
      '<li><b>2</b><span><strong style="color:var(--ink)">Hunt.</strong> Click the words, or the sentence, where it appears in the text.</span></li>' +
      '<li><b>3</b><span><strong style="color:var(--ink)">Score.</strong> Right first time scores. A wrong click freezes you for a moment, so read before you click.</span></li>' +
      '</ol></div>' +
      '<button type="button" class="btn btn-ghost btn-small" data-action="leave" style="align-self:flex-start">Leave game</button>' +
      '</aside></div></main>';

    const sel = document.getElementById('textSel');
    if (sel) sel.addEventListener('change', () => send({ type: 'settings', settings: { textId: sel.value } }));
  }

  // ---------------------------------------------------------------- game
  function buildGame() {
    const t = S.text;
    const sheets = t.paragraphs.map((p, i) =>
      '<article class="sheet"><span class="tab"><b>¶' + (i + 1) + '</b>' + esc(p.label) + '</span><p>' +
      p.segs.map((s) => '<a class="seg" href="#" data-action="find" data-seg="' + s.i + '">' + esc(s.t) + '</a>').join('') +
      '</p></article>').join('');
    const legendCats = Array.from(new Set(S.focusIds.map((fid) => feature(fid).cat)));
    const legend = legendCats.map((c) => '<span style="color:' + S.cat.categories[c].color + '"><i style="background:' + S.cat.categories[c].color + '"></i>' + esc(S.cat.categories[c].name.toUpperCase()) + '</span>').join('');

    app.innerHTML =
      '<main class="page">' +
      '<header class="game-head">' +
      '<div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap">' + logo() +
      '<div class="text-meta"><span class="kicker">' + esc(t.discipline) + '</span><strong>' + esc(t.title) + '</strong></div></div>' +
      '<div class="progress"><div style="display:flex;justify-content:space-between" class="kicker"><span>Text fed through</span><span id="pct" style="color:var(--ink)">0%</span></div>' +
      '<div class="progress-bars" id="bars">' + '<span></span>'.repeat(20) + '</div></div>' +
      '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
      '<div class="score-box"><span class="kicker" style="font-size:10px">Your score</span><span id="myScore">0</span></div>' +
      (isHost() ? '<button type="button" class="btn btn-ghost btn-small" data-action="pause" id="pauseBtn">Pause</button>' : '') +
      '</div></header>' +
      '<div class="game-body">' +
      '<section class="well-wrap" aria-label="The text"><div class="well" id="well">' +
      '<div class="column" id="column">' + sheets + '</div>' +
      '<div class="shredder"><span class="rollers" aria-hidden="true"></span><span class="mono">THE SHREDDER</span><span class="rollers rev" aria-hidden="true"></span></div>' +
      '<div class="feeder">TEXT FEEDS IN</div>' +
      '<div class="pill" id="pill"></div>' +
      '<div class="overlay" id="overlay" hidden></div>' +
      '</div></section>' +
      '<aside class="board" aria-label="Leaderboard"><span class="kicker">Leaderboard</span><div class="board-list" id="board"></div></aside>' +
      '</div>' +
      '<section class="tray" aria-label="The tray"><div class="legend">' + legend + '</div><div class="tiles" id="tiles"></div></section>' +
      '</main>';

    S.game = {
      well: document.getElementById('well'),
      column: document.getElementById('column'),
      pill: document.getElementById('pill'),
      overlay: document.getElementById('overlay'),
      board: document.getElementById('board'),
      tiles: document.getElementById('tiles'),
      bars: Array.from(document.getElementById('bars').children),
      pct: document.getElementById('pct'),
      score: document.getElementById('myScore'),
      pauseBtn: document.getElementById('pauseBtn'),
      segEls: {},
      trayKeys: '',
      seenKeys: new Set(),
      marked: new Set(),
      lit: -1,
      pillText: '',
      overlayText: '',
      innerH: 0
    };
    app.querySelectorAll('.seg').forEach((el) => { S.game.segEls[el.dataset.seg] = el; });
    updateGame();
  }

  function updateGame() {
    const g = S.game;
    if (!g || !S.room || !S.room.round) return;
    const r = S.room.round;
    const meP = player(S.me);

    // tray
    const keys = r.tray.map((t) => t.key).join(',');
    if (keys !== g.trayKeys) {
      const first = g.trayKeys === '';
      g.trayKeys = keys;
      g.tiles.innerHTML = r.tray.map((tile) => {
        const f = feature(tile.fid);
        const c = category(tile.fid);
        const fresh = !first && !g.seenKeys.has(tile.key);
        return '<div class="tile-wrap"><button type="button" class="tile' + (fresh ? ' fresh' : '') + '" data-action="claim" data-key="' + tile.key + '" style="--cat:' + c.color + ';--deep:' + c.deep + '">' +
          '<span class="tile-top"><span class="tile-cat">' + catIcon(f.cat) + esc(c.name) + '</span><span class="coin">+' + f.pts + '</span></span>' +
          '<span class="tile-body"><span class="tile-name">' + esc(f.name) + '</span><span class="tile-foot">' + (fresh ? 'JUST ARRIVED' : 'CLICK TO CLAIM') + '</span></span></button>' +
          '<div class="tip" style="--cat:' + c.color + '"><span class="k">' + esc(c.name) + ' · ' + f.pts + ' points</span><strong>' + esc(f.name) + '</strong><span class="d">' + esc(f.def) + '</span><span class="e">e.g. ' + esc(f.ex) + '</span></div></div>';
      }).join('');
      r.tray.forEach((t) => g.seenKeys.add(t.key));
    }

    // leaderboard
    const top = Math.max(30, ...S.room.players.map((p) => p.score));
    const now = serverNow();
    g.board.innerHTML = S.room.players.slice().sort((a, b) => b.score - a.score).map((p) => {
      const mine = p.id === S.me;
      const frozen = p.cooldownUntil > now;
      let status = p.claim ? 'Hunting: ' + feature(p.claim).name : (mine ? 'Browsing the tray' : 'Reading');
      let col = p.claim ? (mine ? 'var(--gold)' : 'var(--soft)') : 'var(--muted)';
      if (frozen) { status = 'Frozen for a moment'; col = 'var(--red)'; }
      return '<div class="board-card' + (mine ? ' me' : '') + '"><div class="board-top"><span class="avatar" style="background:' + p.color + '">' + esc(initials(p.name, mine)) + '</span>' +
        '<span class="board-name"><strong>' + esc(mine ? 'You' : p.name) + '</strong><span style="color:' + col + '">' + esc(status) + '</span></span>' +
        '<span class="board-score">' + p.score + '</span></div>' +
        '<div class="bar"><span style="width:' + Math.max(3, Math.round(p.score / top * 100)) + '%;background:' + p.color + '"></span></div></div>';
    }).join('');
    g.score.textContent = meP ? meP.score : 0;

    // marks: who found what, shown in their colour
    const marked = new Set();
    r.marks.forEach((m) => {
      const p = player(m.by);
      const color = p ? p.color : '#888888';
      m.segs.forEach((i) => {
        const el = g.segEls[i];
        if (!el) return;
        el.style.background = rgba(color, 0.34);
        el.style.boxShadow = 'inset 0 -2px 0 ' + color;
        marked.add(String(i));
      });
    });
    g.marked.forEach((i) => { if (!marked.has(i) && g.segEls[i]) { g.segEls[i].style.background = ''; g.segEls[i].style.boxShadow = ''; } });
    g.marked = marked;

    if (g.pauseBtn) g.pauseBtn.textContent = r.pausedAt ? 'Resume' : 'Pause';
  }

  function onFindResult(msg) {
    const g = S.game;
    if (msg.ok) {
      flash(msg.seg, 'ok');
      if (g) {
        const pop = document.createElement('div');
        pop.className = 'gain';
        pop.textContent = '+' + msg.pts;
        g.well.appendChild(pop);
        setTimeout(() => pop.remove(), 1500);
      }
    } else if (msg.reason === 'wrong') {
      flash(msg.seg, 'bad');
      if (g) {
        g.well.classList.remove('shake');
        void g.well.offsetWidth;
        g.well.classList.add('shake');
      }
    } else if (msg.reason === 'taken') {
      flash(msg.seg, 'bad');
      toast('Someone already found that one. Look for another.');
    } else if (msg.reason === 'no-claim') {
      toast('Claim a feature from the tray first, then find it here.');
    }
  }

  function flash(seg, cls) {
    const el = S.game && S.game.segEls[seg];
    if (!el) return;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 900);
  }

  function frame() {
    const g = S.game;
    if (g && S.room && S.room.round && S.screen === 'game') {
      const r = S.room.round;
      const now = serverNow();
      const elapsed = (r.pausedAt || now) - r.startedAt - r.pausedTotal;
      const progress = Math.max(0, Math.min(1, elapsed / r.duration));
      const wellH = g.well.clientHeight;
      const innerH = g.column.offsetHeight;
      const offset = START_OFFSET + progress * (wellH + innerH - START_OFFSET);
      g.column.style.transform = 'translateY(' + (-offset).toFixed(1) + 'px)';

      const lit = Math.round(progress * 20);
      if (lit !== g.lit) {
        g.lit = lit;
        g.bars.forEach((b, i) => { b.className = i < lit ? (i >= 15 ? 'on late' : 'on') : ''; });
        g.pct.textContent = Math.round(progress * 100) + '%';
      }

      const meP = player(S.me);
      const frozenFor = meP ? meP.cooldownUntil - now : 0;
      let pillText = 'Click a feature in the tray below to claim it';
      let pillCls = 'pill';
      let wellCls = '';
      if (meP && meP.claim) {
        if (frozenFor > 0) {
          pillText = 'Not there. Look again in ' + Math.ceil(frozenFor / 1000) + 's';
          pillCls = 'pill frozen'; wellCls = 'frozen';
        } else {
          pillText = 'Hunting: ' + feature(meP.claim).name + ' · click it in the text';
          pillCls = 'pill hunting'; wellCls = 'hunting';
        }
      }
      if (pillText !== g.pillText) { g.pillText = pillText; g.pill.textContent = pillText; }
      if (g.pill.className !== pillCls) g.pill.className = pillCls;
      g.well.classList.toggle('hunting', wellCls === 'hunting');
      g.well.classList.toggle('frozen', wellCls === 'frozen');

      let overlay = '';
      if (elapsed < 0) overlay = '<span class="kicker gold">Get ready · claim a feature now</span><span class="big">' + Math.ceil(-elapsed / 1000) + '</span>';
      else if (r.pausedAt) overlay = '<span style="font-size:56px;font-weight:700">Paused</span><span class="kicker">The host has paused the round</span>';
      if (overlay !== g.overlayText) {
        g.overlayText = overlay;
        g.overlay.innerHTML = overlay;
        g.overlay.hidden = !overlay;
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- feedback
  function renderFeedback() {
    const R = S.results;
    const steps = ['Scores', 'In the text', 'Blind spots'];
    const titles = ['Shredded. Here’s the haul.', 'Every feature, in the text', 'Your table’s blind spots'];
    let body = '';
    if (S.fbStep === 0) body = feedbackScores(R);
    if (S.fbStep === 1) body = feedbackText(R);
    if (S.fbStep === 2) body = feedbackSpots(R);

    let nav = '';
    if (S.fbStep > 0) nav += '<button type="button" class="btn btn-ghost" data-action="fb-back">Back</button>';
    if (S.fbStep === 0) nav += '<button type="button" class="btn btn-gold" data-action="fb-next">Next: see it in the text</button>';
    if (S.fbStep === 1) nav += '<button type="button" class="btn btn-gold" data-action="fb-next">Next: blind spots</button>';

    app.innerHTML =
      '<main class="page">' +
      '<div class="fb-head"><div style="display:flex;flex-direction:column;gap:10px">' +
      '<span class="kicker red">Round over · ' + esc(R.text.title) + ' · ' + esc(R.text.discipline) + '</span>' +
      '<h1>' + titles[S.fbStep] + '</h1></div>' +
      '<div class="fb-steps">' + steps.map((s, i) => '<span class="' + (i === S.fbStep ? 'on' : '') + '">' + (i + 1) + ' · ' + s.toUpperCase() + '</span>').join('') + '</div></div>' +
      body +
      (nav ? '<div class="fb-nav">' + nav + '</div>' : '') +
      '</main>';
    window.scrollTo(0, 0);
  }

  function resultPlayer(R, id) {
    return R.players.find((p) => p.id === id) || { name: 'Someone who left', color: '#888888', id: id };
  }

  function quoteShort(q) {
    return q.length > 60 ? q.slice(0, 57).replace(/\s+\S*$/, '') + '…' : q;
  }

  function feedbackScores(R) {
    const ps = R.players;
    const order = [ps[1], ps[0], ps[2]].filter(Boolean);
    const heights = { 0: 180, 1: 130, 2: 100 };
    const places = ['1ST', '2ND', '3RD'];
    const podium = order.map((p) => {
      const rank = ps.indexOf(p);
      const first = rank === 0;
      return '<div class="podium-col">' +
        (first ? '<svg width="40" height="28" viewBox="0 0 40 28" aria-hidden="true"><path d="M3 24L6 6L14 14L20 3L26 14L34 6L37 24Z" fill="#E8B33A" stroke="#9A7420" stroke-width="2" stroke-linejoin="round"></path></svg>' : '') +
        '<span class="avatar" style="background:' + p.color + ';box-shadow:0 0 0 4px var(--bg),0 0 0 6px ' + p.color + '">' + esc(initials(p.name, p.id === S.me)) + '</span>' +
        '<strong>' + esc(p.id === S.me ? 'You' : p.name) + '</strong>' +
        '<div class="podium-block" style="height:' + heights[rank] + 'px;box-shadow:inset 0 3px 0 ' + p.color + (first ? ';background:#2A2516' : '') + '">' +
        '<span class="pts" style="' + (first ? 'color:var(--gold)' : '') + '">' + p.score + '</span><span class="place">' + places[rank] + '</span></div></div>';
    }).join('');

    const ledgers = ps.map((p, i) => {
      const rows = p.finds.length
        ? p.finds.map((f) => '<div class="ledger-row"><span><strong>' + esc(feature(f.fid).name) + '</strong><q>' + esc(quoteShort(f.quote)) + '</q></span><span class="pts">+' + f.pts + '</span></div>').join('')
        : '<span style="color:var(--muted);font-size:15px">No finds this round.</span>';
      return '<div class="ledger" style="box-shadow:0 0 0 1px var(--line),inset 0 4px 0 ' + p.color + '">' +
        '<div class="ledger-head"><span><span class="dot" style="background:' + p.color + '"></span>' + esc(p.id === S.me ? 'You' : p.name) + (i > 2 ? ' · ' + (i + 1) + 'th' : '') + '</span><span class="mono" style="font-size:22px;font-weight:700">' + p.score + '</span></div>' +
        '<div style="display:flex;flex-direction:column;gap:10px">' + rows + '</div></div>';
    }).join('');

    const counts = {};
    R.missed.forEach((m) => { counts[m.fid] = (counts[m.fid] || 0) + 1; });
    const cols = R.categories.map((cat) => {
      const c = S.cat.categories[cat];
      const fids = Object.keys(counts).filter((fid) => feature(fid).cat === cat).sort((a, b) => counts[b] - counts[a]);
      const n = fids.reduce((s, fid) => s + counts[fid], 0);
      return '<div class="slipped-col"><span class="kicker" style="color:' + c.color + '">' + esc(c.name) + ' · ' + n + '</span><div class="chips">' +
        (fids.length ? fids.map((fid) => '<span class="chip">' + esc(feature(fid).name) + (counts[fid] > 1 ? ' ×' + counts[fid] : '') + '</span>').join('') : '<span style="color:var(--green)">Nothing missed</span>') +
        '</div></div>';
    }).join('');

    return '<div class="podium">' + podium + '</div>' +
      '<div class="ledgers">' + ledgers + '</div>' +
      '<section class="slipped"><div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:12px"><h2 style="font-size:26px">Slipped through the shredder</h2><span class="kicker red">' + R.missed.length + ' features nobody found</span></div><div class="slipped-cols">' + cols + '</div></section>';
  }

  function tagFound(fid, p) {
    return '<span class="tag" style="background:' + p.color + '">' + esc(feature(fid).name) + ' · ' + esc(p.id === S.me ? 'You' : p.name) + '</span>';
  }
  function tagMiss(fid) {
    return '<span class="tag miss">Missed · ' + esc(feature(fid).name) + '</span>';
  }

  function feedbackText(R) {
    const found = {};
    R.found.forEach((f) => { found[f.unit + ':' + f.fid] = f.by; });

    const essay = R.text.paragraphs.map((para, pi) => {
      const html = para.sentences.map((s) => {
        let pre = '';
        let sentFound = null;
        let sentMissed = false;
        s.sf.forEach((fid) => {
          const by = found['s' + s.si + ':' + fid];
          if (by) { const p = resultPlayer(R, by); pre += tagFound(fid, p); sentFound = sentFound || p; }
          else { pre += tagMiss(fid); sentMissed = true; }
        });
        const inner = s.segs.map((seg) => {
          if (!seg.pf.length) return esc(seg.t);
          const trail = seg.t.match(/\s*$/)[0];
          const word = seg.t.slice(0, seg.t.length - trail.length);
          let style = '';
          let cls = '';
          let tags = '';
          seg.pf.forEach((fid) => {
            const by = found['g' + seg.i + ':' + fid];
            if (by) {
              const p = resultPlayer(R, by);
              if (!style) style = 'background:' + rgba(p.color, 0.34) + ';box-shadow:inset 0 -2px 0 ' + p.color + ';border-radius:3px';
              tags += tagFound(fid, p);
            } else {
              if (!style) cls = 'ph-miss';
              tags += tagMiss(fid);
            }
          });
          return '<span class="' + cls + '" style="' + style + '">' + esc(word) + '</span>' + tags + trail;
        }).join('');
        let wrapStyle = '';
        let wrapCls = '';
        if (sentFound) wrapStyle = 'background:' + rgba(sentFound.color, 0.16) + ';border-radius:3px';
        if (sentMissed && !sentFound) wrapCls = 'sent-miss';
        return pre + '<span class="' + wrapCls + '" style="' + wrapStyle + '">' + inner + '</span> ';
      }).join('');
      return '<div><span class="label"><span style="color:#B07E12">¶' + (pi + 1) + '</span> ' + esc(para.label) + '</span>' + html + '</div>';
    }).join('');

    const total = R.found.length + R.missed.length;
    const stack = R.players.map((p) => '<span style="width:' + (total ? (p.finds.length / total * 100) : 0) + '%;background:' + p.color + '"></span>').join('');
    const people = R.players.map((p) => '<div class="list-row"><span style="display:flex;align-items:center;gap:10px"><span class="dot" style="background:' + p.color + '"></span>' + esc(p.id === S.me ? 'You' : p.name) + '</span><span class="mono">' + p.finds.length + ' found</span></div>').join('');
    const counts = {};
    R.missed.forEach((m) => { counts[m.fid] = (counts[m.fid] || 0) + 1; });
    const most = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 4)
      .map((fid) => '<div class="list-row"><span>' + esc(feature(fid).name) + '</span><span class="mono" style="color:var(--red)">×' + counts[fid] + '</span></div>').join('');

    return '<div class="annot-grid"><article class="essay">' + essay + '</article>' +
      '<aside class="annot-side">' +
      '<div class="panel" style="display:flex;flex-direction:column;gap:14px"><span class="kicker" style="color:var(--ink)">The table found</span>' +
      '<div style="display:flex;align-items:baseline;gap:10px"><span class="big-num">' + R.found.length + '</span><span style="font-size:18px;color:var(--muted)">of ' + total + ' features</span></div>' +
      '<div class="stack-bar">' + stack + '</div>' + people + '</div>' +
      '<div class="panel" style="display:flex;flex-direction:column;gap:12px"><span class="kicker" style="color:var(--ink)">How to read the essay</span>' +
      '<div class="key-row"><span class="sw" style="background:rgba(232,179,58,0.34);box-shadow:inset 0 -2px 0 #E8B33A"></span>Found: highlighted in the finder’s colour</div>' +
      '<div class="key-row"><span class="sw" style="border-bottom:2px dashed var(--red-line)"></span>Missed words: dashed red underline</div>' +
      '<div class="key-row"><span class="sw" style="font-family:var(--serif);color:var(--ink);text-decoration:underline wavy var(--red-line);text-underline-offset:5px;width:auto">Sentence</span>Missed sentence: wavy red underline</div></div>' +
      (most ? '<div class="panel" style="display:flex;flex-direction:column;gap:6px"><span class="kicker" style="color:var(--ink)">Most missed</span>' + most + '</div>' : '') +
      '</aside></div>';
  }

  function ring(found, total, color) {
    const c = 326.7;
    const dash = total ? (found / total) * c : 0;
    return '<div class="gauge-ring"><svg width="128" height="128" viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="52" fill="none" stroke="#20242E" stroke-width="14"></circle>' +
      '<circle cx="64" cy="64" r="52" fill="none" stroke="' + color + '" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + dash.toFixed(1) + ' ' + c + '" transform="rotate(-90 64 64)"></circle></svg>' +
      '<span><b>' + found + '/' + total + '</b><span class="mono" style="font-size:11px;color:var(--muted)">' + (total ? Math.round(found / total * 100) : 0) + '%</span></span></div>';
  }

  function feedbackSpots(R) {
    const gauges = R.categories.map((cat) => {
      const c = S.cat.categories[cat];
      const st = R.byCategory[cat];
      const missedHere = R.focusIds.filter((fid) => feature(fid).cat === cat)
        .map((fid) => ({ fid: fid, m: R.byFeature[fid].total - R.byFeature[fid].found, t: R.byFeature[fid].total }))
        .sort((a, b) => b.m - a.m);
      const worst = missedHere[0];
      const note = !worst || worst.m === 0 ? 'Everything in this category was found.' :
        (feature(worst.fid).name + ' was the hardest: ' + (worst.t - worst.m) + ' of ' + worst.t + ' found.');
      return '<div class="panel gauge">' + ring(st.found, st.total, c.color) +
        '<div style="display:flex;flex-direction:column;gap:6px"><span class="kicker" style="color:' + c.color + ';font-weight:700">' + esc(c.name) + '</span><span style="font-size:15px;line-height:1.45;color:var(--soft)">' + esc(note) + '</span></div></div>';
    }).join('');

    const spots = R.focusIds
      .map((fid) => ({ fid: fid, f: R.byFeature[fid] }))
      .filter((x) => x.f.total - x.f.found > 0)
      .sort((a, b) => (b.f.total - b.f.found) - (a.f.total - a.f.found) || a.f.found / a.f.total - b.f.found / b.f.total)
      .slice(0, 6)
      .map((x) => {
        const f = feature(x.fid);
        const c = category(x.fid);
        const sample = R.missed.find((m) => m.fid === x.fid);
        let quote = esc(sample.sentence);
        if (sample.phrase) {
          const at = sample.sentence.indexOf(sample.quote);
          if (at >= 0) quote = esc(sample.sentence.slice(0, at)) + '<span class="ph-miss">' + esc(sample.quote) + '</span>' + esc(sample.sentence.slice(at + sample.quote.length));
        } else {
          quote = '<span class="sent-miss">' + quote + '</span>';
        }
        const ticks = Array.from({ length: x.f.total }, (_, i) => '<span class="' + (i < x.f.found ? 'got' : '') + '"></span>').join('');
        return '<article class="spot"><div class="spot-head"><span><span style="width:10px;height:10px;border-radius:3px;background:' + c.color + ';display:inline-block"></span>' + esc(f.name) + '</span>' +
          '<span class="mono" style="font-size:13px;color:var(--red)">' + x.f.found + ' OF ' + x.f.total + '</span></div>' +
          '<div class="ticks">' + ticks + '</div><p class="quote">' + quote + '</p>' +
          '<span style="font-size:14px;line-height:1.45;color:var(--muted)">' + esc(f.def) + '</span></article>';
      }).join('');

    const host = isHost();
    const next = '<div class="next-box"><div style="display:flex;flex-direction:column;gap:4px"><strong style="font-size:19px">' +
      (spots ? 'The next round brings these back more often.' : 'Nothing slipped through. Try a faster speed or a new text.') + '</strong>' +
      '<span style="font-size:15px;color:#D6C9A8">' + (host ? 'Head back to the lobby to choose the next round.' : 'Waiting for the host to set up the next round.') + '</span></div>' +
      (host ? '<button type="button" class="btn btn-gold" data-action="lobby">Back to the lobby</button>' : '') + '</div>';

    return '<div class="gauges">' + gauges + '</div>' +
      (spots ? '<section style="display:flex;flex-direction:column;gap:14px"><h2 style="font-size:26px">What nobody saw</h2><div class="spots">' + spots + '</div></section>' : '') +
      next;
  }

  // ---------------------------------------------------------------- events
  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const a = el.dataset.action;
    if (a === 'find') {
      e.preventDefault();
      send({ type: 'find', seg: Number(el.dataset.seg) });
      return;
    }
    if (a === 'create') doCreate();
    if (a === 'join') doJoin();
    if (a === 'leave') send({ type: 'leave' });
    if (a === 'focus') send({ type: 'settings', settings: { focus: el.dataset.focus } });
    if (a === 'speed') send({ type: 'settings', settings: { speed: el.dataset.speed } });
    if (a === 'start') send({ type: 'start' });
    if (a === 'pause') send({ type: 'pause' });
    if (a === 'claim') send({ type: 'claim', key: Number(el.dataset.key) });
    if (a === 'lobby') send({ type: 'lobby' });
    if (a === 'fb-next') { S.fbStep = Math.min(2, S.fbStep + 1); renderFeedback(); }
    if (a === 'fb-back') { S.fbStep = Math.max(0, S.fbStep - 1); renderFeedback(); }
  });

  connect();
  requestAnimationFrame(frame);
})();
