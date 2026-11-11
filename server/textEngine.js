// Turns the marked-up texts in shared/texts.js into clickable segments,
// and keeps track of every "unit" (a tagged phrase or a tagged sentence)
// that a player can find.

const { FEATURES } = require('../shared/features');

const SENTENCE_TAGS = /^\{([a-z,]+)\}/;
const PHRASE = /\[\[([a-z,]+)\|([^\]]+)\]\]/g;

function parseIds(list, where) {
  return list.split(',').map((id) => {
    const clean = id.trim();
    if (!FEATURES[clean]) throw new Error('Unknown feature "' + clean + '" in ' + where);
    return clean;
  });
}

function parseSentence(raw, where) {
  let body = raw;
  let sf = [];
  const tag = body.match(SENTENCE_TAGS);
  if (tag) {
    sf = parseIds(tag[1], where);
    body = body.slice(tag[0].length);
  }
  const parts = [];
  let last = 0;
  let m;
  PHRASE.lastIndex = 0;
  while ((m = PHRASE.exec(body))) {
    if (m.index > last) parts.push({ t: body.slice(last, m.index), pf: [] });
    parts.push({ t: m[2], pf: parseIds(m[1], where) });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ t: body.slice(last), pf: [] });
  if (/\[\[|\]\]|\{|\}/.test(parts.map((p) => p.t).join(''))) {
    throw new Error('Malformed markup in ' + where + ': ' + raw);
  }
  return { sf: sf, parts: parts };
}

function compile(text) {
  const segs = [];
  const sents = [];
  const units = {};
  Object.keys(FEATURES).forEach((id) => { units[id] = []; });
  const paragraphs = text.paragraphs.map((para, pi) => {
    const segIdx = [];
    para.sentences.forEach((raw, k) => {
      const where = text.id + ' ¶' + (pi + 1) + ' sentence ' + (k + 1);
      const parsed = parseSentence(raw, where);
      const si = sents.length;
      const sent = { pi: pi, sf: parsed.sf, segIdx: [] };
      sents.push(sent);
      parsed.sf.forEach((fid) => units[fid].push('s' + si));
      parsed.parts.forEach((part, j) => {
        const gi = segs.length;
        let t = part.t;
        if (j === parsed.parts.length - 1 && k < para.sentences.length - 1) t += ' ';
        segs.push({ pi: pi, si: si, t: t, pf: part.pf });
        sent.segIdx.push(gi);
        segIdx.push(gi);
        part.pf.forEach((fid) => units[fid].push('g' + gi));
      });
    });
    return { label: para.label, segIdx: segIdx };
  });
  const chars = segs.reduce((n, s) => n + s.t.length, 0);
  const compiled = {
    id: text.id, title: text.title, discipline: text.discipline,
    paragraphs: paragraphs, segs: segs, sents: sents, units: units, chars: chars
  };
  compiled.unitSegs = (unit) => {
    const n = Number(unit.slice(1));
    return unit[0] === 'g' ? [n] : sents[n].segIdx.slice();
  };
  compiled.unitPara = (unit) => {
    const n = Number(unit.slice(1));
    return unit[0] === 'g' ? segs[n].pi : sents[n].pi;
  };
  compiled.unitQuote = (unit) => {
    return compiled.unitSegs(unit).map((gi) => segs[gi].t).join('').trim();
  };
  compiled.sentenceText = (si) => sents[si].segIdx.map((gi) => segs[gi].t).join('').trim();
  return compiled;
}

// What a client sees during play: the words only, never the tags.
function publicText(c) {
  return {
    id: c.id, title: c.title, discipline: c.discipline,
    paragraphs: c.paragraphs.map((p) => ({
      label: p.label,
      segs: p.segIdx.map((gi) => ({ i: gi, t: c.segs[gi].t }))
    }))
  };
}

module.exports = { compile, publicText, parseSentence };
