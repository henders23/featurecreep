// Game rooms. The server holds the truth: which features are where in the
// text, who has claimed what, and who found what. Clients only ever see the
// words of the text until the round is over.

const TEXTS = require('../shared/texts');
const { FEATURES, CATEGORIES, FOCUS_OPTIONS, featuresForFocus } = require('../shared/features');
const { compile, publicText } = require('./textEngine');

const COMPILED = TEXTS.map(compile);
const TRAY_SIZE = 5;
const MAX_PLAYERS = 4;
const COOLDOWN_MS = 2500;
const LEAD_MS = 3000; // countdown before the text starts moving
const SPEEDS = { gentle: 7.5, brisk: 12 }; // characters of text per second
const COLORS = ['#A16207', '#0F766E', '#6D28D9', '#BE185D']; // one per seat, readable on white
const CODE_WORDS = ['HEDGE', 'THESIS', 'CLAUSE', 'SOURCE', 'TOPIC', 'CITE', 'NOUN', 'VERB', 'ESSAY', 'GLOSS'];

function textById(id) {
  return COMPILED.find((c) => c.id === id) || null;
}

function cleanName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 18);
  return n || 'Player';
}

class Room {
  constructor(code, opts) {
    this.code = code;
    this.now = (opts && opts.now) || Date.now;
    this.random = (opts && opts.random) || Math.random;
    this.players = new Map();
    this.order = [];
    this.hostId = null;
    this.phase = 'lobby';
    this.settings = { focus: 'mix', textId: 'random', speed: 'gentle' };
    this.round = null;
    this.results = null;
    this.trayKey = 0;
    this.lastTextId = null;
    this.review = []; // features missed last round, offered more often next round
  }

  // ---------- players ----------

  addPlayer(id, name, send) {
    if (this.players.size >= MAX_PLAYERS) return { error: 'That game is full. Four players at most.' };
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = COLORS.find((c) => !used.has(c)) || COLORS[0];
    const player = { id: id, name: cleanName(name), color: color, send: send, score: 0, claim: null, cooldownUntil: 0, finds: [] };
    this.players.set(id, player);
    this.order.push(id);
    if (!this.hostId) this.hostId = id;
    return { player: player };
  }

  removePlayer(id) {
    this.players.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.hostId === id) this.hostId = this.order[0] || null;
  }

  isEmpty() {
    return this.players.size === 0;
  }

  // ---------- settings and flow ----------

  setSettings(by, s) {
    if (by !== this.hostId || this.phase === 'playing') return false;
    if (s.focus && FOCUS_OPTIONS[s.focus]) this.settings.focus = s.focus;
    if (s.speed && SPEEDS[s.speed]) this.settings.speed = s.speed;
    if (s.textId && (s.textId === 'random' || textById(s.textId))) this.settings.textId = s.textId;
    return true;
  }

  start(by) {
    if (by !== this.hostId || this.phase === 'playing') return false;
    let text = textById(this.settings.textId);
    if (!text) {
      const pool = COMPILED.length > 1 ? COMPILED.filter((c) => c.id !== this.lastTextId) : COMPILED;
      text = pool[Math.floor(this.random() * pool.length)];
    }
    this.lastTextId = text.id;
    const focusIds = featuresForFocus(this.settings.focus);
    const now = this.now();
    this.round = {
      text: text,
      focus: this.settings.focus,
      focusIds: focusIds,
      startedAt: now + LEAD_MS,
      // FC_ROUND_MS lets automated browser tests run short rounds.
      duration: Number(process.env.FC_ROUND_MS) || Math.round(text.chars / SPEEDS[this.settings.speed] * 1000),
      pausedAt: null,
      pausedTotal: 0,
      tray: [],
      found: {}
    };
    this.review = this.results ? this.results.missed.map((m) => m.fid).filter((fid) => focusIds.indexOf(fid) >= 0) : [];
    this.results = null;
    for (const p of this.players.values()) {
      p.score = 0; p.claim = null; p.cooldownUntil = 0; p.finds = [];
    }
    for (let i = 0; i < TRAY_SIZE; i++) this.round.tray.push(this.newTile());
    this.phase = 'playing';
    return true;
  }

  togglePause(by) {
    if (by !== this.hostId || this.phase !== 'playing') return false;
    const r = this.round;
    const now = this.now();
    if (r.pausedAt) { r.pausedTotal += now - r.pausedAt; r.pausedAt = null; }
    else r.pausedAt = now;
    return true;
  }

  toLobby(by) {
    if (by !== this.hostId || this.phase !== 'over') return false;
    this.phase = 'lobby';
    return true;
  }

  elapsed() {
    const r = this.round;
    if (!r) return 0;
    const t = r.pausedAt || this.now();
    return t - r.startedAt - r.pausedTotal;
  }

  // Returns true when the round has just ended.
  tick() {
    if (this.phase !== 'playing') return false;
    if (this.elapsed() >= this.round.duration) {
      this.finish();
      return true;
    }
    return false;
  }

  finish() {
    this.phase = 'over';
    for (const p of this.players.values()) p.claim = null;
    this.results = this.buildResults();
  }

  // ---------- the tray ----------

  remaining(fid) {
    const r = this.round;
    return r.text.units[fid].filter((u) => !r.found[u + ':' + fid]).length;
  }

  inPlay(fid) {
    let n = this.round.tray.filter((t) => t.fid === fid).length;
    for (const p of this.players.values()) if (p.claim === fid) n++;
    return n;
  }

  newTile() {
    const r = this.round;
    const ids = r.focusIds;
    const onTray = new Set(r.tray.map((t) => t.fid));
    const spare = (fid) => this.remaining(fid) - this.inPlay(fid) > 0;
    let pool = ids.filter((fid) => !onTray.has(fid) && spare(fid));
    if (!pool.length) pool = ids.filter(spare);
    if (!pool.length) pool = ids.filter((fid) => this.remaining(fid) > 0);
    if (!pool.length) pool = ids;
    const review = pool.filter((fid) => this.review.indexOf(fid) >= 0);
    if (review.length && this.random() < 0.5) pool = review;
    const fid = pool[Math.floor(this.random() * pool.length)];
    this.trayKey += 1;
    return { key: this.trayKey, fid: fid };
  }

  claim(by, key) {
    const p = this.players.get(by);
    if (!p || this.phase !== 'playing' || this.round.pausedAt) return { ok: false, reason: 'not-playing' };
    const r = this.round;
    const idx = r.tray.findIndex((t) => t.key === key);
    if (idx < 0) return { ok: false, reason: 'gone' };
    const fid = r.tray[idx].fid;
    const dropped = p.claim;
    p.claim = fid;
    r.tray.splice(idx, 1);
    r.tray.splice(idx, 0, this.newTile());
    return { ok: true, fid: fid, dropped: dropped };
  }

  // ---------- finding ----------

  find(by, gi) {
    const p = this.players.get(by);
    if (!p || this.phase !== 'playing' || this.round.pausedAt) return { ok: false, reason: 'not-playing' };
    const now = this.now();
    if (now < p.cooldownUntil) return { ok: false, reason: 'frozen', cooldownUntil: p.cooldownUntil };
    if (!p.claim) return { ok: false, reason: 'no-claim' };
    const r = this.round;
    const seg = r.text.segs[gi];
    if (!seg) return { ok: false, reason: 'bad-segment' };
    const fid = p.claim;
    let unit = null;
    if (seg.pf.indexOf(fid) >= 0) unit = 'g' + gi;
    else if (r.text.sents[seg.si].sf.indexOf(fid) >= 0) unit = 's' + seg.si;
    if (!unit) {
      p.cooldownUntil = now + COOLDOWN_MS;
      return { ok: false, reason: 'wrong', fid: fid, seg: gi, cooldownUntil: p.cooldownUntil };
    }
    const key = unit + ':' + fid;
    if (r.found[key]) return { ok: false, reason: 'taken', fid: fid, seg: gi };
    r.found[key] = by;
    const pts = FEATURES[fid].pts;
    p.score += pts;
    p.finds.push({ fid: fid, unit: unit, pts: pts });
    p.claim = null;
    return { ok: true, fid: fid, seg: gi, pts: pts, unit: unit };
  }

  // ---------- what clients see ----------

  marks() {
    const r = this.round;
    if (!r) return [];
    return Object.keys(r.found).map((key) => {
      const [unit, fid] = key.split(':');
      return { segs: r.text.unitSegs(unit), by: r.found[key], fid: fid };
    });
  }

  lobbyInfo() {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      players: this.order.map((id) => {
        const p = this.players.get(id);
        return { id: p.id, name: p.name, color: p.color, score: p.score, claim: p.claim, cooldownUntil: p.cooldownUntil };
      })
    };
  }

  state() {
    const msg = Object.assign({ type: 'state', serverNow: this.now() }, this.lobbyInfo());
    if (this.round && this.phase === 'playing') {
      const r = this.round;
      msg.round = {
        textId: r.text.id,
        startedAt: r.startedAt,
        duration: r.duration,
        pausedAt: r.pausedAt,
        pausedTotal: r.pausedTotal,
        focus: r.focus,
        tray: r.tray.map((t) => ({ key: t.key, fid: t.fid })),
        marks: this.marks()
      };
    }
    return msg;
  }

  roundStart() {
    const r = this.round;
    return { type: 'round', text: publicText(r.text), focus: r.focus, focusIds: r.focusIds };
  }

  buildResults() {
    const r = this.round;
    const t = r.text;
    const focus = new Set(r.focusIds);
    const keep = (list) => list.filter((fid) => focus.has(fid));

    const paragraphs = t.paragraphs.map((p) => {
      const sentences = [];
      p.segIdx.forEach((gi) => {
        const seg = t.segs[gi];
        let s = sentences[sentences.length - 1];
        if (!s || s.si !== seg.si) {
          s = { si: seg.si, sf: keep(t.sents[seg.si].sf), segs: [] };
          sentences.push(s);
        }
        s.segs.push({ i: gi, t: seg.t, pf: keep(seg.pf) });
      });
      return { label: p.label, sentences: sentences };
    });

    const found = [];
    const missed = [];
    const byFeature = {};
    r.focusIds.forEach((fid) => {
      byFeature[fid] = { found: 0, total: t.units[fid].length };
      t.units[fid].forEach((unit) => {
        const by = r.found[unit + ':' + fid];
        const seg = unit[0] === 'g' ? t.segs[Number(unit.slice(1))] : null;
        const si = seg ? seg.si : Number(unit.slice(1));
        const entry = { fid: fid, unit: unit, quote: t.unitQuote(unit), si: si, sentence: t.sentenceText(si), phrase: unit[0] === 'g' };
        if (by) { found.push(Object.assign({ by: by }, entry)); byFeature[fid].found += 1; }
        else missed.push(entry);
      });
    });

    const byCategory = {};
    FOCUS_OPTIONS[r.focus].forEach((cat) => {
      byCategory[cat] = { found: 0, total: 0 };
    });
    r.focusIds.forEach((fid) => {
      const cat = FEATURES[fid].cat;
      byCategory[cat].found += byFeature[fid].found;
      byCategory[cat].total += byFeature[fid].total;
    });

    const players = this.order.map((id) => this.players.get(id)).filter(Boolean).map((p) => ({
      id: p.id, name: p.name, color: p.color, score: p.score,
      finds: p.finds.map((f) => ({ fid: f.fid, unit: f.unit, pts: f.pts, quote: t.unitQuote(f.unit) }))
        .sort((a, b) => b.pts - a.pts)
    })).sort((a, b) => b.score - a.score);

    return {
      type: 'over',
      text: { id: t.id, title: t.title, discipline: t.discipline, paragraphs: paragraphs },
      focus: r.focus,
      focusIds: r.focusIds,
      categories: FOCUS_OPTIONS[r.focus],
      players: players,
      found: found,
      missed: missed,
      byFeature: byFeature,
      byCategory: byCategory
    };
  }
}

class RoomManager {
  constructor(opts) {
    this.opts = opts || {};
    this.rooms = new Map();
  }

  newCode() {
    const random = this.opts.random || Math.random;
    for (let tries = 0; tries < 200; tries++) {
      const code = CODE_WORDS[Math.floor(random() * CODE_WORDS.length)] + '-' + String(10 + Math.floor(random() * 90));
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Could not find a free room code');
  }

  create() {
    const room = new Room(this.newCode(), this.opts);
    this.rooms.set(room.code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code || '').trim().toUpperCase()) || null;
  }

  removeIfEmpty(room) {
    if (room && room.isEmpty()) this.rooms.delete(room.code);
  }

  // Games shown on the start screen, newest first.
  list() {
    return Array.from(this.rooms.values()).reverse().map((room) => {
      const host = room.players.get(room.hostId);
      return {
        code: room.code,
        host: host ? host.name : '',
        players: room.players.size,
        max: MAX_PLAYERS,
        full: room.players.size >= MAX_PLAYERS,
        phase: room.phase
      };
    });
  }
}

function catalogue() {
  return {
    features: FEATURES,
    categories: CATEGORIES,
    focusOptions: FOCUS_OPTIONS,
    texts: COMPILED.map((c) => ({ id: c.id, title: c.title, discipline: c.discipline })),
    speeds: Object.keys(SPEEDS)
  };
}

module.exports = { Room, RoomManager, catalogue, COOLDOWN_MS, LEAD_MS, TRAY_SIZE, SPEEDS, MAX_PLAYERS };
