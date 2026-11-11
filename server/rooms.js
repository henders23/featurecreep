// Game rooms. The server holds the truth: which features are where in the
// text, who is hunting what, and who found what. Clients only ever see the
// words of the text until the round is over.
//
// A round shows the essay one paragraph at a time. Each paragraph stays for a
// set time, or until every feature in it has been found, and is then replaced
// by the next one.

const TEXTS = require('../shared/texts');
const { FEATURES, CATEGORIES, FOCUS_OPTIONS, featuresForFocus } = require('../shared/features');
const { compile, publicText } = require('./textEngine');

const COMPILED = TEXTS.map(compile);
const MAX_PLAYERS = 4;
const COOLDOWN_MS = 2500;
const LEAD_MS = 3000; // countdown before the first paragraph appears
const CLEAR_MS = 2500; // pause after a paragraph is cleared, before the next one
const REVEAL_BASE_MS = 3000; // when time runs out, what was missed is shown for
const REVEAL_EACH_MS = 600;  // this long, plus a little for each missed feature,
const REVEAL_MAX_MS = 8000;  // up to this limit
const STREAK_AT = 3;         // correct finds in a row, with no wrong click, to earn
const STREAK_MULT = 1.5;     // this multiplier on every find until a wrong click
const BONUS_STEP = 5;        // clear bonus: 5 points for every tenth of the time left
// Time allowed for a paragraph: a base, plus reading time, plus time for each
// feature there is to find in it.
const SPEEDS = {
  gentle: { base: 15000, perChar: 1000 / 14, perUnit: 5000 },
  brisk: { base: 10000, perChar: 1000 / 20, perUnit: 3500 }
};
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
    this.lastTextId = null;
    this.review = []; // features missed last round, offered more often next round
  }

  // ---------- players ----------

  addPlayer(id, name, send) {
    if (this.players.size >= MAX_PLAYERS) return { error: 'That game is full. Four players at most.' };
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = COLORS.find((c) => !used.has(c)) || COLORS[0];
    const player = { id: id, name: cleanName(name), color: color, send: send, score: 0, claim: null, cooldownUntil: 0, finds: [], streak: 0, bestStreak: 0, bonus: 0 };
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
    // What there is to find in each paragraph: byPara[pi][fid] = [unit, ...]
    const byPara = text.paragraphs.map(() => ({}));
    focusIds.forEach((fid) => {
      text.units[fid].forEach((unit) => {
        const slot = byPara[text.unitPara(unit)];
        (slot[fid] = slot[fid] || []).push(unit);
      });
    });
    // Paragraphs with nothing to find in the chosen focus are not shown.
    const paras = byPara.map((slot, pi) => pi).filter((pi) => Object.keys(byPara[pi]).length > 0);
    this.round = {
      text: text,
      focus: this.settings.focus,
      focusIds: focusIds,
      speed: this.settings.speed,
      byPara: byPara,
      paras: paras,
      idx: 0,
      startedAt: this.now() + LEAD_MS, // when the current paragraph's clock starts
      duration: 0,
      pausedAt: null,
      pausedTotal: 0,
      hold: null, // { kind: 'cleared' | 'reveal', at, ms, ... } between paragraphs
      found: {}
    };
    this.round.duration = this.paraDuration(paras[0]);
    this.review = this.results ? this.results.missed.map((m) => m.fid).filter((fid) => focusIds.indexOf(fid) >= 0) : [];
    this.results = null;
    for (const p of this.players.values()) {
      p.score = 0; p.claim = null; p.cooldownUntil = 0; p.finds = [];
      p.streak = 0; p.bestStreak = 0; p.bonus = 0;
    }
    this.phase = 'playing';
    return true;
  }

  paraDuration(pi) {
    const r = this.round;
    // FC_ROUND_MS lets automated browser tests run short rounds.
    const fixed = Number(process.env.FC_ROUND_MS);
    if (fixed) return Math.round(fixed / r.paras.length);
    const sp = SPEEDS[r.speed];
    const chars = r.text.paragraphs[pi].segIdx.reduce((n, gi) => n + r.text.segs[gi].t.length, 0);
    const units = Object.keys(r.byPara[pi]).reduce((n, fid) => n + r.byPara[pi][fid].length, 0);
    return Math.round(sp.base + chars * sp.perChar + units * sp.perUnit);
  }

  togglePause(by) {
    if (by !== this.hostId || this.phase !== 'playing') return false;
    const r = this.round;
    const now = this.now();
    if (r.pausedAt) {
      const gap = now - r.pausedAt;
      r.pausedTotal += gap;
      if (r.hold) r.hold.at += gap;
      r.pausedAt = null;
    } else r.pausedAt = now;
    return true;
  }

  toLobby(by) {
    if (by !== this.hostId || this.phase !== 'over') return false;
    this.phase = 'lobby';
    return true;
  }

  // Time used on the current paragraph. Negative during the opening countdown.
  elapsed() {
    const r = this.round;
    if (!r) return 0;
    const t = r.pausedAt || this.now();
    return t - r.startedAt - r.pausedTotal;
  }

  // Moves the round on. When a paragraph's time is up, what was missed is
  // shown for a few seconds ('reveal'); then, or shortly after a paragraph has
  // been cleared, the next paragraph appears ('next') or the round ends ('over').
  tick() {
    if (this.phase !== 'playing') return null;
    const r = this.round;
    if (r.pausedAt) return null;
    const now = this.now();
    if (r.hold) return now - r.hold.at >= r.hold.ms ? this.advance() : null;
    if (this.elapsed() < r.duration) return null;
    const missed = this.missedHere();
    r.hold = { kind: 'reveal', at: now, ms: Math.min(REVEAL_MAX_MS, REVEAL_BASE_MS + REVEAL_EACH_MS * missed.length), missed: missed };
    for (const p of this.players.values()) p.claim = null;
    return 'reveal';
  }

  // Everything in the paragraph on screen that nobody has found.
  missedHere() {
    const r = this.round;
    const slot = r.byPara[this.currentPara()];
    const out = [];
    r.focusIds.forEach((fid) => {
      (slot[fid] || []).forEach((unit) => {
        if (!r.found[unit + ':' + fid]) out.push({ fid: fid, unit: unit, segs: r.text.unitSegs(unit), sentence: unit[0] === 's' });
      });
    });
    return out;
  }

  advance() {
    const r = this.round;
    r.idx += 1;
    if (r.idx >= r.paras.length) {
      this.finish();
      return 'over';
    }
    r.startedAt = this.now();
    r.pausedTotal = 0;
    r.hold = null;
    r.duration = this.paraDuration(r.paras[r.idx]);
    // A feature someone was hunting carries over only if the new paragraph has it.
    for (const p of this.players.values()) if (p.claim && !this.remaining(p.claim)) p.claim = null;
    return 'next';
  }

  finish() {
    this.phase = 'over';
    for (const p of this.players.values()) p.claim = null;
    this.results = this.buildResults();
  }

  // ---------- the tray ----------

  currentPara() {
    const r = this.round;
    return r.paras[Math.min(r.idx, r.paras.length - 1)];
  }

  // Units of a feature in the current paragraph that nobody has found yet.
  open(fid) {
    const r = this.round;
    return (r.byPara[this.currentPara()][fid] || []).filter((u) => !r.found[u + ':' + fid]);
  }

  remaining(fid) {
    return this.open(fid).length;
  }

  // One tile for each feature still to be found in the current paragraph.
  // The tray never offers a feature the paragraph does not contain, and a tile
  // stays until every instance is found, so the paragraph can always be cleared.
  tray() {
    const r = this.round;
    return r.focusIds.map((fid) => ({ fid: fid, left: this.remaining(fid), review: this.review.indexOf(fid) >= 0 }))
      .filter((t) => t.left > 0);
  }

  paraProgress() {
    const slot = this.round.byPara[this.currentPara()];
    let total = 0;
    let left = 0;
    Object.keys(slot).forEach((fid) => { total += slot[fid].length; left += this.remaining(fid); });
    return { total: total, found: total - left };
  }

  // Choosing a feature to hunt. Any number of players can hunt the same
  // feature; each instance of it scores for whoever clicks it first.
  claim(by, fid) {
    const p = this.players.get(by);
    if (!p || this.phase !== 'playing' || this.round.pausedAt || this.round.hold) return { ok: false, reason: 'not-playing' };
    if (!this.remaining(fid)) return { ok: false, reason: 'gone' };
    p.claim = fid;
    return { ok: true, fid: fid };
  }

  // ---------- finding ----------

  find(by, gi) {
    const p = this.players.get(by);
    const r = this.round;
    if (!p || this.phase !== 'playing' || r.pausedAt || r.hold || this.elapsed() < 0) return { ok: false, reason: 'not-playing' };
    const now = this.now();
    if (now < p.cooldownUntil) return { ok: false, reason: 'frozen', cooldownUntil: p.cooldownUntil };
    if (!p.claim) return { ok: false, reason: 'no-claim' };
    const seg = r.text.segs[gi];
    // A click on a paragraph that has just been replaced costs nothing.
    if (!seg || seg.pi !== this.currentPara()) return { ok: false, reason: 'stale' };
    const fid = p.claim;
    // The clicked words can hold the feature themselves, sit in a sentence
    // that holds it, or both. Take whichever has not been found yet.
    const units = [];
    if (seg.pf.indexOf(fid) >= 0) units.push('g' + gi);
    if (r.text.sents[seg.si].sf.indexOf(fid) >= 0) units.push('s' + seg.si);
    if (!units.length) {
      p.cooldownUntil = now + COOLDOWN_MS;
      p.streak = 0;
      return { ok: false, reason: 'wrong', fid: fid, seg: gi, cooldownUntil: p.cooldownUntil };
    }
    const unit = units.find((u) => !r.found[u + ':' + fid]);
    if (!unit) return { ok: false, reason: 'taken', fid: fid, seg: gi };
    r.found[unit + ':' + fid] = by;
    // Careful reading pays: from the third correct find in a row, every find
    // is worth more, until a wrong click breaks the streak.
    p.streak += 1;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
    const hot = p.streak >= STREAK_AT;
    const base = FEATURES[fid].pts;
    const pts = hot ? Math.round(base * STREAK_MULT / 5) * 5 : base;
    p.score += pts;
    p.finds.push({ fid: fid, unit: unit, pts: pts, streak: hot });
    const left = this.remaining(fid);
    // Keep hunting the same feature while the paragraph has more of it.
    if (!left) for (const q of this.players.values()) if (q.claim === fid) q.claim = null;
    const prog = this.paraProgress();
    const cleared = prog.found === prog.total;
    let bonus = 0;
    if (cleared) {
      // Clearing a paragraph early earns everyone the same bonus, bigger the
      // more time is left, so the whole group gains by finishing it together.
      const share = Math.max(0, 1 - this.elapsed() / r.duration);
      bonus = BONUS_STEP * Math.max(1, Math.ceil(share * 10));
      for (const q of this.players.values()) { q.score += bonus; q.bonus += bonus; }
      r.hold = { kind: 'cleared', at: now, ms: CLEAR_MS, bonus: bonus };
    }
    return { ok: true, fid: fid, seg: gi, pts: pts, base: base, streak: p.streak, hot: hot, unit: unit, left: left, cleared: cleared, bonus: bonus };
  }

  // ---------- what clients see ----------

  // Finds in the paragraph on screen.
  marks() {
    const r = this.round;
    if (!r) return [];
    const pi = this.currentPara();
    return Object.keys(r.found).filter((key) => r.text.unitPara(key.split(':')[0]) === pi).map((key) => {
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
        return { id: p.id, name: p.name, color: p.color, score: p.score, claim: p.claim, cooldownUntil: p.cooldownUntil, streak: p.streak };
      })
    };
  }

  state() {
    const msg = Object.assign({ type: 'state', serverNow: this.now() }, this.lobbyInfo());
    if (this.round && this.phase === 'playing') {
      const r = this.round;
      const prog = this.paraProgress();
      msg.round = {
        textId: r.text.id,
        para: this.currentPara(),   // index into the text's paragraphs
        step: r.idx + 1,            // 1st, 2nd… paragraph shown this round
        steps: r.paras.length,
        startedAt: r.startedAt,
        duration: r.duration,
        pausedAt: r.pausedAt,
        pausedTotal: r.pausedTotal,
        // between paragraphs: 'cleared' (with the bonus) or 'reveal' (with what was missed)
        hold: r.hold ? { kind: r.hold.kind, at: r.hold.at, ms: r.hold.ms, bonus: r.hold.bonus || 0, missed: (r.hold.missed || []).map((m) => ({ fid: m.fid, segs: m.segs, sentence: m.sentence })) } : null,
        total: prog.total,
        found: prog.found,
        focus: r.focus,
        tray: this.tray(),
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
      id: p.id, name: p.name, color: p.color, score: p.score, bonus: p.bonus, bestStreak: p.bestStreak,
      finds: p.finds.map((f) => ({ fid: f.fid, unit: f.unit, pts: f.pts, streak: f.streak, quote: t.unitQuote(f.unit) }))
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
    speeds: Object.keys(SPEEDS),
    streakAt: STREAK_AT,
    streakMult: STREAK_MULT
  };
}

module.exports = { Room, RoomManager, catalogue, COOLDOWN_MS, LEAD_MS, CLEAR_MS, STREAK_AT, SPEEDS, MAX_PLAYERS };
