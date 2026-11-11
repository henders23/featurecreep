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
    fbStep: 0,            // 0 = scores, 1 = the text, 2 = blind spots
    screen: null,
    clockOffset: 0,
    error: '',
    lobbyKey: '',
    games: [],            // games listed on the start screen
    game: null            // live DOM references while playing
  };
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + a + ')';
  }
  // Each player marks the text with a highlighter pen of their own colour.
  const PENS = ['#FFE45C', '#FFB8D2', '#A8E6B4', '#A9D4FF'];
  function avatar(p) {
    return '<span class="pen" style="background:' + p.color + '"></span>';
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
  function soundOn() {
    try { return localStorage.getItem('fc-sound') !== 'off'; } catch (e) { return true; }
  }
  function setSound(on) {
    try { localStorage.setItem('fc-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- sound
  // The chime is synthesised, so there is no audio file to load. Browsers only
  // allow sound after the player has clicked something, so the audio context is
  // created on the first click.
  let audio = null;
  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audio) { try { audio = new AC(); } catch (e) { return; } }
    if (audio.state === 'suspended') audio.resume();
  }
  function note(freq, at, len, peak, type) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type || 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(at);
    osc.stop(at + len + 0.02);
  }
  // Two rising notes for a correct find; a third when it clears the paragraph.
  function playCorrect(cleared) {
    if (!audio || !soundOn()) return;
    const t = audio.currentTime + 0.01;
    note(783.99, t, 0.22, 0.16);          // G5
    note(1174.66, t + 0.09, 0.34, 0.16);  // D6
    if (cleared) note(1567.98, t + 0.2, 0.5, 0.14); // G6
  }
  // Two falling, duller notes for a wrong click.
  function playWrong() {
    if (!audio || !soundOn()) return;
    const t = audio.currentTime + 0.01;
    note(207.65, t, 0.16, 0.07, 'square');        // G#3
    note(155.56, t + 0.12, 0.26, 0.07, 'square'); // D#3
  }
  // One tick a second for the last ten seconds, higher for the last three.
  function playTick(secsLeft) {
    if (!audio || !soundOn()) return;
    note(secsLeft <= 3 ? 1318.51 : 987.77, audio.currentTime + 0.01, 0.06, 0.05, 'sine');
  }
  document.addEventListener('pointerdown', unlockAudio);
  document.addEventListener('keydown', unlockAudio);

  const brand = () => '<div class="brand">Feature <mark>Creep</mark></div>';
  const legendHtml = (cats) => cats.map((c) => {
    const k = S.cat.categories[c];
    return '<span><span class="sq" style="background:' + k.tint + ';border:1px solid ' + k.color + '"></span>' + esc(k.name) + '</span>';
  }).join('');

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
      case 'games':
        S.games = msg.games;
        if (S.screen === 'home') renderGames();
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
        if (!msg.ok && msg.reason === 'gone') toast('That one has already been found in this paragraph.');
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
    if (S.screen === 'loading') app.innerHTML = '<div class="home"><p class="muted">Connecting…</p></div>';
    if (S.screen === 'home') renderHome();
    if (S.screen === 'lobby') renderLobby();
    if (S.screen === 'game') buildGame();
    if (S.screen === 'feedback') renderFeedback();
  }

  // ---------------------------------------------------------------- home
  function renderHome() {
    const hl = (i, words, name) => '<span class="hl" style="background:' + PENS[i] + '">' + words + '</span><small>' + name + '</small>';
    app.innerHTML =
      '<main class="home"><div class="home-inner">' +
      '<div class="home-top">' +
      '<section class="hero">' +
      '<h1>Feature <mark>Creep</mark></h1>' +
      '<p>A reading race for up to four players. An essay appears one paragraph at a time. Mark every feature of academic writing before the clock runs out.</p>' +
      '<div class="sample" aria-hidden="true"><div class="timebar"><span></span></div>' +
      '<div class="sample-head"><span class="label">Paragraph 2 of 4</span><span class="mono">0:42</span></div>' +
      '<p>' + hl(1, 'However', 'Signposting') + ', ' + hl(2, 'this study', 'Reference back') + ' relied on self-reported phone use, which ' + hl(0, 'may not be', 'Hedging') + ' accurate.</p></div>' +
      '</section>' +
      '<section class="join">' +
      '<div class="name-card"><label for="name">Your name</label>' +
      '<input id="name" class="name-input" maxlength="18" autocomplete="nickname" value="' + esc(savedName()) + '" placeholder="e.g. Amira">' +
      '<button type="button" class="btn btn-primary" data-action="create">Start a new game</button>' +
      '<span class="note">You host: you choose the text and the features, and decide when it starts.</span>' +
      '<p class="error" role="alert">' + esc(S.error) + '</p></div>' +
      '<div><div class="list-head"><span class="label">Or join an open game</span><span class="sub">Up to 4 players each</span></div>' +
      '<div id="games" class="games"></div></div>' +
      '</section></div>' +
      '<div class="how">' +
      '<div><b>1</b><span><strong>Read.</strong> One paragraph at a time, each against the clock.</span></div>' +
      '<div><b>2</b><span><strong>Mark.</strong> Choose a feature, then click where it appears. First to mark it scores.</span></div>' +
      '<div><b>3</b><span><strong>Clear.</strong> Find everything early and every player earns a bonus.</span></div>' +
      '</div>' +
      '</div></main>';
    renderGames();
  }

  function renderGames() {
    const box = document.getElementById('games');
    if (!box) return;
    if (!S.games.length) {
      box.innerHTML = '<p class="games-empty">No open games yet. Start one, or wait here: new games appear as soon as someone starts them.</p>';
      return;
    }
    box.innerHTML = S.games.map((g) => {
      const seats = Array.from({ length: g.max }, (_, i) => i < g.players ? '<i class="on" style="background:' + PENS[i % PENS.length] + '"></i>' : '<i></i>').join('');
      const status = g.full ? 'Full' : (g.phase === 'lobby' ? 'Waiting to start' : (g.phase === 'playing' ? 'Round in progress' : 'Reviewing results'));
      return '<div class="game-row' + (g.full ? ' full' : '') + '">' +
        '<div class="game-info"><strong>' + esc(g.host ? g.host + '’s game' : 'Game') + '</strong>' +
        '<span><span class="mono">' + esc(g.code) + '</span> · ' + status + '</span></div>' +
        '<div class="seats" role="img" aria-label="' + g.players + ' of ' + g.max + ' players">' + seats + '</div>' +
        '<button type="button" class="btn btn-small" data-action="join" data-code="' + esc(g.code) + '"' + (g.full ? ' disabled' : '') + '>' + (g.full ? 'Full' : 'Join') + '</button>' +
        '</div>';
    }).join('');
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
  function doJoin(code) {
    const name = nameValue();
    if (!name) { S.error = 'Type your name first.'; renderHome(); return; }
    send({ type: 'join', code: code, name: name });
  }

  // ---------------------------------------------------------------- lobby
  function renderLobby() {
    const r = S.room;
    const host = isHost();
    S.lobbyKey = JSON.stringify([r.hostId, r.settings, r.players.map((p) => [p.id, p.name, p.color])]);
    const focusOrder = ['mix', 'language', 'argument', 'organisation'];
    const focusCards = focusOrder.map((f) => {
      const cats = S.cat.focusOptions[f];
      const title = f === 'mix' ? 'Mix' : S.cat.categories[f].name;
      const blurb = f === 'mix' ? 'All three kinds of feature in one round.' : S.cat.categories[f].blurb;
      const names = Object.keys(S.cat.features).filter((id) => cats.indexOf(S.cat.features[id].cat) >= 0).map((id) => S.cat.features[id].name);
      return '<button type="button" class="focus-card" data-action="focus" data-focus="' + f + '" aria-pressed="' + (r.settings.focus === f) + '"' + (host ? '' : ' disabled') + '>' +
        '<span class="swatches">' + cats.map((c) => '<span class="sq" style="background:' + S.cat.categories[c].color + '"></span>').join('') + '</span>' +
        '<strong>' + title + '</strong><span class="blurb">' + esc(blurb) + '</span>' +
        '<span class="list">' + esc(f === 'mix' ? 'All 18 features' : names.join(', ')) + '</span></button>';
    }).join('');
    const textOptions = '<option value="random"' + (r.settings.textId === 'random' ? ' selected' : '') + '>Random text</option>' +
      S.cat.texts.map((t) => '<option value="' + t.id + '"' + (r.settings.textId === t.id ? ' selected' : '') + '>' + esc(t.title) + ' (' + esc(t.discipline) + ')</option>').join('');
    const speedButtons = S.cat.speeds.map((s) => '<button type="button" data-action="speed" data-speed="' + s + '" aria-pressed="' + (r.settings.speed === s) + '"' + (host ? '' : ' disabled') + '>' + (s === 'gentle' ? 'Gentle · more time per paragraph' : 'Brisk · less time per paragraph') + '</button>').join('');
    const players = r.players.map((p) =>
      '<div class="player-row">' + avatar(p) +
      '<span class="name">' + esc(p.name) + (p.id === S.me ? ' <span class="muted" style="font-weight:400">(you)</span>' : '') + '</span>' +
      (p.id === r.hostId ? '<span class="badge">Host</span>' : '') + '</div>').join('');

    app.innerHTML =
      '<main class="page">' +
      '<header class="topbar"><div class="topbar-left">' + brand() + '<span class="divider"></span>' +
      '<span class="tag-chip">Game</span><span class="code">' + esc(r.code) + '</span></div>' +
      '<div class="topbar-right"><span class="tag-chip">' + (host ? 'You’re the host. Choose the round, then start it.' : 'Waiting for the host to start the round.') + '</span>' +
      '<button type="button" class="btn btn-secondary btn-small" data-action="leave">Leave game</button></div></header>' +
      '<div class="lobby-grid"><section class="lobby-main">' +
      '<div class="panel"><div class="panel-head">What will you hunt for?</div><div class="focus-grid">' + focusCards + '</div></div>' +
      '<div class="panel"><div class="panel-head">Round settings</div><div class="settings-grid">' +
      '<div class="field"><label for="textSel">Text</label><select id="textSel" class="select"' + (host ? '' : ' disabled') + '>' + textOptions + '</select></div>' +
      '<div class="field"><label>Speed</label><div class="seg-toggle">' + speedButtons + '</div></div>' +
      '</div></div>' +
      (host ? '<div><button type="button" class="btn btn-primary btn-large" data-action="start">Start the game</button></div>' : '<p class="waiting">The round starts for everyone at once when the host is ready.</p>') +
      '</section><aside class="lobby-side">' +
      '<div class="panel"><div class="panel-head">Players <span class="sub">' + r.players.length + ' of 4</span></div>' + players + '</div>' +
      '<div class="panel"><div class="panel-head">How to play</div><ol class="steps">' +
      '<li><b>1</b><span><strong>Read.</strong> The essay appears one paragraph at a time, each with a time limit.</span></li>' +
      '<li><b>2</b><span><strong>Choose.</strong> The tray shows every feature still hidden in the paragraph. Click one to mark it. Hover over it first for a definition.</span></li>' +
      '<li><b>3</b><span><strong>Find.</strong> Click the words, or the sentence, where it appears. The first player to click each one scores. A wrong click pauses you briefly, so read before you click.</span></li>' +
      '<li><b>4</b><span><strong>Clear.</strong> Find everything before the time runs out and every player gets a bonus, bigger the more time is left. If the time runs out, you see what was missed.</span></li>' +
      '<li><b>5</b><span><strong>Streak.</strong> ' + S.cat.streakAt + ' correct finds in a row and each find is worth ×' + S.cat.streakMult + ', until a wrong click.</span></li>' +
      '</ol></div>' +
      '</aside></div></main>';

    const sel = document.getElementById('textSel');
    if (sel) sel.addEventListener('change', () => send({ type: 'settings', settings: { textId: sel.value } }));
  }

  // ---------------------------------------------------------------- game
  function buildGame() {
    const t = S.text;
    const cats = Array.from(new Set(S.focusIds.map((fid) => feature(fid).cat)));
    const focusName = cats.length > 1 ? 'Mix' : S.cat.categories[cats[0]].name;
    const speed = S.room.settings.speed === 'brisk' ? 'Brisk' : 'Gentle';

    app.innerHTML =
      '<main class="page">' +
      '<header class="topbar"><div class="topbar-left">' + brand() +
      '<span class="tag-chip">' + esc(t.title) + ' · ' + esc(focusName) + ' · ' + speed + '</span></div>' +
      '<div class="topbar-right">' +
      '<div class="progress"><span id="stepLabel">Paragraph</span><span class="step-dots" id="stepDots"></span></div>' +
      '<span class="score">Score <strong id="myScore">0</strong></span>' +
      '<button type="button" class="btn btn-secondary btn-small" data-action="sound" id="soundBtn" aria-pressed="' + soundOn() + '">' + (soundOn() ? 'Sound on' : 'Sound off') + '</button>' +
      (isHost() ? '<button type="button" class="btn btn-secondary btn-small" data-action="pause" id="pauseBtn">Pause</button>' : '') +
      '</div></header>' +
      '<div class="game-body">' +
      '<section class="doc" id="doc" aria-label="The text">' +
      '<div class="timebar"><span id="timebar"></span></div>' +
      '<div class="doc-head"><span class="label" id="paraLabel"></span>' +
      '<span class="status-side"><span id="statusSide"></span><span class="timer" id="timer" aria-label="Time left for this paragraph"></span></span></div>' +
      '<div class="well" id="well"><div class="column" id="column"></div>' +
      '<div class="hint" id="hint" hidden></div>' +
      '<div class="overlay" id="overlay" hidden></div></div>' +
      '<div class="status" id="status"><span class="status-main" id="statusMain"></span></div>' +
      '</section>' +
      '<aside class="board" aria-label="Players"><div class="panel-head"><span>Highlighters</span><span class="sub" id="playerCount"></span></div><div class="board-list" id="board"></div></aside>' +
      '</div>' +
      '<section class="tray" aria-label="Features to find"><div class="tray-head"><span class="label">Still to find in this paragraph <span class="sub" id="trayCount"></span></span><span class="legend">' + legendHtml(cats) + '</span></div><div class="tiles" id="tiles"></div></section>' +
      '</main>';

    S.game = {
      doc: document.getElementById('doc'),
      well: document.getElementById('well'),
      column: document.getElementById('column'),
      status: document.getElementById('status'),
      statusMain: document.getElementById('statusMain'),
      statusSide: document.getElementById('statusSide'),
      paraLabel: document.getElementById('paraLabel'),
      timer: document.getElementById('timer'),
      timebar: document.getElementById('timebar'),
      overlay: document.getElementById('overlay'),
      hint: document.getElementById('hint'),
      board: document.getElementById('board'),
      playerCount: document.getElementById('playerCount'),
      tiles: document.getElementById('tiles'),
      trayCount: document.getElementById('trayCount'),
      stepLabel: document.getElementById('stepLabel'),
      stepDots: document.getElementById('stepDots'),
      score: document.getElementById('myScore'),
      pauseBtn: document.getElementById('pauseBtn'),
      segEls: {},
      para: -1,
      revealPara: -1,
      tickSec: -1,
      hintFid: null,
      trayKeys: null,
      stepKey: '',
      sideText: null,
      marked: new Set(),
      timerText: '',
      statusHtml: '',
      overlayText: ''
    };
    updateGame();
  }

  // Puts one paragraph on screen, replacing the one before it.
  function showParagraph(pi) {
    const g = S.game;
    const p = S.text.paragraphs[pi];
    g.para = pi;
    g.paraLabel.textContent = 'Paragraph ' + (pi + 1) + ' of ' + S.text.paragraphs.length + ' · ' + p.label;
    g.column.innerHTML =
      '<div class="para"><p>' +
      p.segs.map((s) => '<a class="seg" href="#" data-action="find" data-seg="' + s.i + '">' + esc(s.t) + '</a>').join('') +
      '</p></div>';
    g.segEls = {};
    g.column.querySelectorAll('.seg').forEach((el) => { g.segEls[el.dataset.seg] = el; });
    g.marked = new Set();
    g.revealPara = -1;
    g.tickSec = -1;
    clearTimeout(g.gainTimer);
    g.gain = '';
  }

  // When the time runs out, what nobody found is marked and named in place.
  function showMissed(missed) {
    const g = S.game;
    missed.forEach((m) => {
      const tag = '<span class="tag miss">' + esc(feature(m.fid).name) + '</span>';
      const first = g.segEls[m.segs[0]];
      if (!first) return;
      if (m.sentence) {
        m.segs.forEach((i) => { if (g.segEls[i]) g.segEls[i].classList.add('sent-miss'); });
        first.insertAdjacentHTML('beforebegin', tag);
      } else {
        first.classList.add('ph-miss');
        first.insertAdjacentHTML('afterend', tag);
      }
    });
  }

  function updateGame() {
    const g = S.game;
    if (!g || !S.room || !S.room.round) return;
    const r = S.room.round;
    const meP = player(S.me);

    if (r.para !== g.para) showParagraph(r.para);
    const hold = r.hold ? r.hold.kind : '';
    if (hold === 'reveal' && g.revealPara !== r.para) { g.revealPara = r.para; showMissed(r.hold.missed); }
    g.doc.classList.toggle('revealing', hold === 'reveal');
    g.tiles.classList.toggle('closed', !!hold);

    const stepKey = r.step + '/' + r.steps;
    if (stepKey !== g.stepKey) {
      g.stepKey = stepKey;
      g.stepLabel.textContent = 'Paragraph ' + r.step + ' of ' + r.steps;
      g.stepDots.innerHTML = Array.from({ length: r.steps }, (_, i) => '<i class="' + (i + 1 < r.step ? 'done' : (i + 1 === r.step ? 'on' : '')) + '"></i>').join('');
    }

    // tray: one tile for each feature still to be found in this paragraph
    const mine = meP ? meP.claim : null;
    if (meP) g.tiles.style.setProperty('--me', meP.color);
    const keys = r.tray.map((t) => t.fid + ':' + t.left).join(',') + '|' + mine + '|' + hold;
    if (keys !== g.trayKeys) {
      g.trayKeys = keys;
      g.tiles.innerHTML = r.tray.length ? r.tray.map((tile) => {
        const f = feature(tile.fid);
        const c = category(tile.fid);
        const on = tile.fid === mine;
        const foot = hold ? 'Missed' : (on ? 'Marking now' : (tile.review ? 'Missed last round' : esc(c.name)));
        return '<div class="tile-wrap" style="--cat:' + c.color + ';--tint:' + c.tint + '"><button type="button" class="tile" data-action="claim" data-fid="' + tile.fid + '" aria-pressed="' + on + '"' + (hold ? ' disabled' : '') + '>' +
          '<span class="tile-name">' + esc(f.name) + '</span>' +
          '<span class="tile-foot"><span>' + foot + ' · ' + tile.left + ' left</span><span class="pts">+' + f.pts + '</span></span></button>' +
          '<div class="tip"><span class="k">' + esc(c.name) + ' · ' + f.pts + ' points each</span><strong>' + esc(f.name) + '</strong><span class="d">' + esc(f.def) + '</span><span class="e">e.g. ' + esc(f.ex) + '</span></div></div>';
      }).join('') : '<p class="tiles-empty">Everything in this paragraph has been found.</p>';
    }
    g.trayCount.textContent = '· ' + (r.total - r.found) + ' left';

    // players
    const now = serverNow();
    g.playerCount.textContent = S.room.players.length + ' of 4';
    g.board.innerHTML = S.room.players.slice().sort((a, b) => b.score - a.score).map((p) => {
      const isMe = p.id === S.me;
      const frozen = p.cooldownUntil > now;
      let status = p.claim ? 'Marking ' + feature(p.claim).name : (isMe ? 'Choosing a feature' : 'Reading');
      if (frozen) status = '<span style="color:var(--red)">Paused for a moment</span>';
      else status = esc(status);
      const hot = p.streak >= S.cat.streakAt;
      const pips = Array.from({ length: S.cat.streakAt }, (_, i) => '<i class="' + (i < p.streak ? 'on' : '') + '"></i>').join('');
      const streak = '<span class="streak' + (hot ? ' hot' : '') + '" title="' + (hot ? 'On a streak: finds are worth ×' + S.cat.streakMult : p.streak + ' correct in a row') + '">' + (hot ? '×' + S.cat.streakMult : pips) + '</span>';
      return '<div class="board-row' + (isMe ? ' me' : '') + '"><div class="board-top">' + avatar(p) +
        '<span class="board-name"><strong>' + esc(isMe ? 'You' : p.name) + '</strong><span>' + status + '</span></span>' + streak +
        '<span class="board-score">' + p.score + '</span></div></div>';
    }).join('');
    g.score.textContent = meP ? meP.score : 0;

    // who found what, in their colour
    const marked = new Set();
    r.marks.forEach((m) => {
      const p = player(m.by);
      const color = p ? p.color : '#D9DCE2';
      m.segs.forEach((i) => {
        const el = g.segEls[i];
        if (!el) return;
        el.style.background = color;
        marked.add(String(i));
      });
    });
    g.marked.forEach((i) => { if (!marked.has(i) && g.segEls[i]) { g.segEls[i].style.background = ''; } });
    g.marked = marked;

    if (g.pauseBtn) g.pauseBtn.textContent = r.pausedAt ? 'Resume' : 'Pause';
  }

  function onFindResult(msg) {
    const g = S.game;
    if (msg.ok) {
      flash(msg.seg, 'ok');
      playCorrect(msg.cleared);
      if (g) {
        g.gain = '<span class="gain">Found · +' + msg.pts + (msg.hot ? ' · streak ×' + S.cat.streakMult : '') + '</span>';
        if (msg.streak === S.cat.streakAt) toast(S.cat.streakAt + ' in a row. Each find is now worth ×' + S.cat.streakMult + ', until a wrong click.');
        clearTimeout(g.gainTimer);
        g.gainTimer = setTimeout(() => { g.gain = ''; }, 1500);
      }
    } else if (msg.reason === 'wrong') {
      flash(msg.seg, 'bad');
      playWrong();
    } else if (msg.reason === 'taken') {
      flash(msg.seg, 'bad');
      toast('Someone already found that one. Look for another.');
    } else if (msg.reason === 'no-claim') {
      toast('Choose a feature from the tray first, then find it in the paragraph.');
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
      const left = Math.max(0, Math.min(r.duration, r.duration - elapsed));

      const hold = r.hold;
      const cleared = !!hold && hold.kind === 'cleared';
      const reveal = !!hold && hold.kind === 'reveal';
      const holdLeft = hold ? Math.max(0, hold.ms - ((r.pausedAt || now) - hold.at)) : 0;
      const last = r.step >= r.steps;

      // the paragraph's clock
      const secs = Math.ceil(left / 1000);
      const timerText = cleared ? 'Done' : (reveal ? '0:00' : Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'));
      if (timerText !== g.timerText) { g.timerText = timerText; g.timer.textContent = timerText; }
      const low = reveal || (!cleared && elapsed >= 0 && left <= 10000);
      g.timer.classList.toggle('low', low);
      g.timebar.classList.toggle('low', low);
      g.timebar.classList.toggle('done', cleared);
      g.timebar.style.width = (cleared ? 100 : (reveal ? holdLeft / hold.ms * 100 : left / r.duration * 100)).toFixed(2) + '%';
      if (!hold && !r.pausedAt && elapsed >= 0 && left > 0 && left <= 10000 && secs !== g.tickSec) {
        g.tickSec = secs;
        playTick(secs);
      }

      const side = g.gain || (r.found + ' of ' + r.total + ' found');
      if (side !== g.sideText) { g.sideText = side; g.statusSide.innerHTML = side; }

      const meP = player(S.me);
      const frozenFor = meP ? meP.cooldownUntil - now : 0;
      let html = '<span class="dot" style="background:var(--line-2)"></span>Choose a feature below, then mark it in the paragraph';
      let frozen = false;
      if (cleared) {
        html = '<span class="dot" style="background:var(--green)"></span><strong>Paragraph cleared.</strong> +' + hold.bonus + ' bonus for everyone. ' + (last ? 'That was the last one.' : 'The next one is coming.');
      } else if (reveal) {
        html = '<strong>Time’s up.</strong> Here is what was missed. ' + (last ? 'Results' : 'Next paragraph') + ' in ' + Math.ceil(holdLeft / 1000) + 's';
      } else if (meP && meP.claim) {
        if (frozenFor > 0) {
          html = 'Not there. Try again in ' + Math.ceil(frozenFor / 1000) + 's';
          frozen = true;
        } else {
          html = '<span class="dot" style="background:' + meP.color + '"></span>You are marking <strong>' + esc(feature(meP.claim).name) + '</strong> · click it in the paragraph';
        }
      }
      if (html !== g.statusHtml) { g.statusHtml = html; g.statusMain.innerHTML = html; }
      g.status.classList.toggle('frozen', frozen || reveal);
      g.status.classList.toggle('cleared', cleared);
      g.doc.classList.toggle('frozen', frozen);

      // While a wrong click keeps you waiting, a reminder of what you are looking for.
      const hintFid = frozen ? meP.claim : null;
      if (hintFid !== g.hintFid) {
        g.hintFid = hintFid;
        g.hint.hidden = !hintFid;
        if (hintFid) {
          const f = feature(hintFid);
          g.hint.innerHTML = '<span class="k">Hint · ' + esc(f.name) + '</span><span class="d">' + esc(f.def) + '</span><span class="e">e.g. ' + esc(f.ex) + '</span>';
        }
      }

      let overlay = '';
      if (elapsed < 0) overlay = '<span class="big mono">' + Math.ceil(-elapsed / 1000) + '</span><span class="msg">Get ready. The first paragraph is about to appear.</span>';
      else if (r.pausedAt) overlay = '<h2>Paused</h2><span class="msg">The host has paused the round.</span>';
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
    const titles = ['Round results', 'Every feature, in the text', 'Blind spots'];
    let body = '';
    if (S.fbStep === 0) body = feedbackScores(R);
    if (S.fbStep === 1) body = feedbackText(R);
    if (S.fbStep === 2) body = feedbackSpots(R);

    let nav = '';
    if (S.fbStep > 0) nav += '<button type="button" class="btn btn-secondary" data-action="fb-back">Back</button>';
    if (S.fbStep === 0) nav += '<button type="button" class="btn btn-primary" data-action="fb-next">Next: see it in the text</button>';
    if (S.fbStep === 1) nav += '<button type="button" class="btn btn-primary" data-action="fb-next">Next: blind spots</button>';

    app.innerHTML =
      '<main class="page">' +
      '<header class="topbar"><div class="topbar-left">' + brand() + '<span class="tag-chip">' + esc(R.text.title) + ' · ' + esc(R.text.discipline) + '</span></div>' +
      '<div class="stepper">' + steps.map((s, i) => '<span class="' + (i === S.fbStep ? 'on' : '') + '">' + (i + 1) + '. ' + s + '</span>').join('') + '</div></header>' +
      '<div class="fb-head"><h1>' + titles[S.fbStep] + '</h1></div>' +
      body +
      (nav ? '<div class="fb-nav">' + nav + '</div>' : '') +
      '</main>';
    window.scrollTo(0, 0);
  }

  function resultPlayer(R, id) {
    return R.players.find((p) => p.id === id) || { name: 'Someone who left', color: '#D9DCE2', id: id };
  }
  function who(p) { return p.id === S.me ? 'You' : p.name; }
  function quoteShort(q) {
    return q.length > 60 ? q.slice(0, 57).replace(/\s+\S*$/, '') + '…' : q;
  }
  function missedCounts(R) {
    const counts = {};
    R.missed.forEach((m) => { counts[m.fid] = (counts[m.fid] || 0) + 1; });
    return counts;
  }

  function feedbackScores(R) {
    const ps = R.players;
    const ranking = ps.map((p, i) =>
      '<div class="rank-row' + (i === 0 ? ' first' : '') + '"><span class="place">' + (i + 1) + '</span>' + avatar(p) +
      '<span class="who">' + esc(who(p)) + '</span><span class="finds">' + p.finds.length + (p.finds.length === 1 ? ' find' : ' finds') + '</span><span class="pts">' + p.score + '</span></div>').join('');

    const ledgers = ps.map((p) => {
      const rows = p.finds.length
        ? p.finds.map((f) => '<div class="ledger-row"><span><strong>' + esc(feature(f.fid).name) + '</strong><q>' + esc(quoteShort(f.quote)) + '</q></span><span class="pts">' + (f.streak ? '<span class="x">×' + S.cat.streakMult + '</span>' : '') + '+' + f.pts + '</span></div>').join('')
        : '<div class="ledger-empty">No finds this round.</div>';
      const bonus = p.bonus ? '<div class="ledger-row"><span><strong>Paragraphs cleared early</strong><span class="muted" style="font-size:13px">Bonus shared by every player</span></span><span class="pts">+' + p.bonus + '</span></div>' : '';
      return '<div class="panel"><div class="panel-head"><span style="display:flex;align-items:center;gap:8px"><span class="dot" style="background:' + p.color + '"></span>' + esc(who(p)) + '</span><span class="mono">' + p.score + '</span></div>' + rows + bonus + '</div>';
    }).join('');

    const counts = missedCounts(R);
    const cols = R.categories.map((cat) => {
      const c = S.cat.categories[cat];
      const fids = Object.keys(counts).filter((fid) => feature(fid).cat === cat).sort((a, b) => counts[b] - counts[a]);
      const n = fids.reduce((s, fid) => s + counts[fid], 0);
      return '<div class="missed-col"><span class="head"><span class="sq" style="background:' + c.color + '"></span>' + esc(c.name) + ' <span class="muted" style="font-weight:400">· ' + n + ' missed</span></span><div class="chips">' +
        (fids.length ? fids.map((fid) => '<span class="chip">' + esc(feature(fid).name) + (counts[fid] > 1 ? '<b>×' + counts[fid] + '</b>' : '') + '</span>').join('') : '<span class="muted" style="font-size:13px">Nothing missed</span>') +
        '</div></div>';
    }).join('');

    return '<div class="panel"><div class="panel-head">Ranking</div><div class="ranking">' + ranking + '</div></div>' +
      '<div class="ledgers">' + ledgers + '</div>' +
      '<div class="panel"><div class="panel-head">Nobody found these <span class="sub">' + R.missed.length + ' features</span></div><div class="missed-cols">' + cols + '</div></div>';
  }

  function tagFound(fid, p) {
    return '<span class="tag" style="background:' + p.color + '">' + esc(feature(fid).name) + ' · ' + esc(who(p)) + '</span>';
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
              if (!style) style = 'background:' + p.color + ';padding:3px 4px;border-radius:2px';
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
        if (sentFound) wrapStyle = 'background:' + rgba(sentFound.color, 0.4) + ';padding:3px 0;border-radius:2px';
        if (sentMissed && !sentFound) wrapCls = 'sent-miss';
        return pre + '<span class="' + wrapCls + '" style="' + wrapStyle + '">' + inner + '</span> ';
      }).join('');
      return '<div><span class="label">Paragraph ' + (pi + 1) + ' · ' + esc(para.label) + '</span>' + html + '</div>';
    }).join('');

    const total = R.found.length + R.missed.length;
    const stack = R.players.map((p) => '<span style="width:' + (total ? (p.finds.length / total * 100) : 0) + '%;background:' + p.color + '"></span>').join('');
    const people = R.players.map((p) => '<div class="list-row"><span style="display:flex;align-items:center;gap:8px"><span class="dot" style="background:' + p.color + '"></span>' + esc(who(p)) + '</span><span class="mono" style="font-size:13px">' + p.finds.length + ' found</span></div>').join('');
    const counts = missedCounts(R);
    const most = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 4)
      .map((fid) => '<div class="list-row"><span>' + esc(feature(fid).name) + '</span><span class="mono" style="font-size:13px;font-weight:700;color:var(--red)">×' + counts[fid] + '</span></div>').join('');

    return '<div class="annot-grid"><article class="panel essay">' + essay + '</article>' +
      '<aside class="annot-side">' +
      '<div class="panel"><div class="panel-head">Found together</div><div style="padding:18px 22px 6px;display:flex;flex-direction:column;gap:12px">' +
      '<div style="display:flex;align-items:baseline;gap:8px"><span class="big-num">' + R.found.length + '</span><span class="muted">of ' + total + ' features</span></div>' +
      '<div class="stack-bar">' + stack + '</div></div>' + people + '</div>' +
      '<div class="panel"><div class="panel-head">Key</div>' +
      '<div class="key-row" style="padding-top:14px"><span class="sw" style="background:' + PENS[0] + '"></span>Found, in the finder’s highlighter</div>' +
      '<div class="key-row"><span class="sw" style="border-bottom:2px dashed var(--red);border-radius:0"></span>Missed words</div>' +
      '<div class="key-row" style="padding-bottom:14px"><span class="sw" style="font-family:var(--serif);font-size:16px;color:var(--ink);text-decoration:underline wavy var(--red);text-underline-offset:5px;width:auto;height:auto">Sentence</span>Missed sentence</div></div>' +
      (most ? '<div class="panel"><div class="panel-head">Most missed</div>' + most + '</div>' : '') +
      '</aside></div>';
  }

  function ring(found, total, color) {
    const r = 42;
    const c = 2 * Math.PI * r;
    const dash = total ? (found / total) * c : 0;
    return '<div class="gauge-ring"><svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true"><circle cx="52" cy="52" r="' + r + '" fill="none" stroke="#EEF0F3" stroke-width="10"></circle>' +
      (found ? '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + dash.toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 52 52)"></circle>' : '') + '</svg>' +
      '<span><b>' + found + '/' + total + '</b><small>' + (total ? Math.round(found / total * 100) : 0) + '%</small></span></div>';
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
        '<div><span class="cat" style="color:' + c.color + '">' + esc(c.name) + '</span><p>' + esc(note) + '</p></div></div>';
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
        return '<article class="panel spot"><div class="spot-head"><span class="name"><span class="sq" style="background:' + c.color + '"></span>' + esc(f.name) + '</span>' +
          '<span class="count">' + x.f.found + ' of ' + x.f.total + ' found</span></div>' +
          '<div class="ticks">' + ticks + '</div><p class="quote">' + quote + '</p>' +
          '<span class="def">' + esc(f.def) + '</span></article>';
      }).join('');

    const host = isHost();
    const next = '<div class="panel next-box"><div style="display:flex;flex-direction:column;gap:4px"><strong>' +
      (spots ? 'The next round flags these in the tray, so you can look out for them.' : 'Nothing slipped through. Try a faster speed or a new text.') + '</strong>' +
      '<span>' + (host ? 'Go back to the lobby to set up the next round.' : 'Waiting for the host to set up the next round.') + '</span></div>' +
      (host ? '<button type="button" class="btn btn-primary" data-action="lobby">Back to the lobby</button>' : '') + '</div>';

    return '<div class="gauges">' + gauges + '</div>' +
      (spots ? '<h2 class="fb-sub">What nobody saw</h2><div class="spots">' + spots + '</div>' : '') +
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
    if (a === 'join') doJoin(el.dataset.code);
    if (a === 'leave') send({ type: 'leave' });
    if (a === 'focus') send({ type: 'settings', settings: { focus: el.dataset.focus } });
    if (a === 'speed') send({ type: 'settings', settings: { speed: el.dataset.speed } });
    if (a === 'start') send({ type: 'start' });
    if (a === 'pause') send({ type: 'pause' });
    if (a === 'claim') send({ type: 'claim', fid: el.dataset.fid });
    if (a === 'sound') {
      const on = !soundOn();
      setSound(on);
      el.setAttribute('aria-pressed', on);
      el.textContent = on ? 'Sound on' : 'Sound off';
      if (on) { unlockAudio(); playCorrect(false); }
    }
    if (a === 'lobby') send({ type: 'lobby' });
    if (a === 'fb-next') { S.fbStep = Math.min(2, S.fbStep + 1); renderFeedback(); }
    if (a === 'fb-back') { S.fbStep = Math.max(0, S.fbStep - 1); renderFeedback(); }
  });

  connect();
  requestAnimationFrame(frame);
})();
