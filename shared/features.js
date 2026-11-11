// The features players hunt for, grouped into three categories.
// Points reflect how hard a feature usually is to spot.

const CATEGORIES = {
  language: {
    id: 'language',
    name: 'Language',
    blurb: 'Word- and sentence-level choices: hedging, passives, grammar.',
    color: '#1D4ED8',
    tint: '#E3EBFD'
  },
  argument: {
    id: 'argument',
    name: 'Argument',
    blurb: 'What the writer does with ideas and evidence: thesis, sources, counterarguments.',
    color: '#B4380B',
    tint: '#FBE6DC'
  },
  organisation: {
    id: 'organisation',
    name: 'Organisation',
    blurb: 'How the text holds together: topic sentences, signposts, links.',
    color: '#116B3A',
    tint: '#DDF2E3'
  }
};

const FEATURES = {
  hedge: {
    name: 'Hedging', cat: 'language', pts: 10,
    def: 'Wording that softens a claim so it matches the strength of the evidence.',
    ex: 'may, might, can, often, tend to, suggests, is likely to'
  },
  booster: {
    name: 'Booster', cat: 'language', pts: 15,
    def: 'Wording that makes a claim sound more certain or forceful.',
    ex: 'clearly, certainly, undoubtedly'
  },
  reporting: {
    name: 'Reporting verb', cat: 'language', pts: 10,
    def: 'A verb that introduces what a source or a group of people says, thinks or found.',
    ex: 'found, argue, claim, note, reported'
  },
  nominal: {
    name: 'Nominalisation', cat: 'language', pts: 20,
    def: 'An action or process turned into a noun phrase, often in the pattern “the … of”.',
    ex: 'reduce → the reduction of; remove → their removal'
  },
  passive: {
    name: 'Passive voice', cat: 'language', pts: 15,
    def: 'A form of “be” plus a past participle, where the thing acted on becomes the subject.',
    ex: 'is defined as, were exposed to, will be banned'
  },
  informal: {
    name: 'Informal wording', cat: 'language', pts: 20,
    def: 'Everyday wording that is too casual for academic writing.',
    ex: 'a lot of, kids, really, pretty, loads of'
  },
  grammar: {
    name: 'Grammar mistake', cat: 'language', pts: 25,
    def: 'An error such as a verb that does not agree with its subject, or a wrong verb form.',
    ex: 'the results shows → the results show'
  },
  thesis: {
    name: 'Thesis statement', cat: 'argument', pts: 30,
    def: 'The sentence where the writer states their overall position on the question.',
    ex: 'I argue that…'
  },
  source: {
    name: 'Source as evidence', cat: 'argument', pts: 20,
    def: 'A cited study or author used to support the writer’s point.',
    ex: 'Smith (2020) found that…; (Lee, 2019)'
  },
  counter: {
    name: 'Counterargument', cat: 'argument', pts: 25,
    def: 'An opposing view that the writer acknowledges.',
    ex: 'Critics argue that…'
  },
  rebuttal: {
    name: 'Rebuttal', cat: 'argument', pts: 25,
    def: 'The writer’s answer to an opposing view, showing why their position still holds.',
    ex: 'Nevertheless, this overlooks…'
  },
  definition: {
    name: 'Definition of a key term', cat: 'argument', pts: 20,
    def: 'A sentence explaining exactly what an important term means in this text.',
    ex: 'X can be defined as…'
  },
  example: {
    name: 'Example', cat: 'argument', pts: 10,
    def: 'A specific case that illustrates a general point.',
    ex: 'For example, …'
  },
  limitation: {
    name: 'Evaluating a source', cat: 'argument', pts: 25,
    def: 'A comment on a weakness or limit of the evidence the writer has used.',
    ex: 'However, the sample was small, so…'
  },
  topic: {
    name: 'Topic sentence', cat: 'organisation', pts: 20,
    def: 'The first sentence of a body paragraph, telling you what the paragraph is about.',
    ex: 'Firstly, there is evidence that…'
  },
  signpost: {
    name: 'Signposting', cat: 'organisation', pts: 10,
    def: 'A word or phrase that guides the reader through the argument.',
    ex: 'Firstly, However, Nevertheless, For example, In conclusion'
  },
  refback: {
    name: 'Reference back', cat: 'organisation', pts: 15,
    def: 'A phrase pointing back to something already mentioned, linking sentences together.',
    ex: 'these devices, this approach, this study'
  },
  conclusion: {
    name: 'Concluding sentence', cat: 'organisation', pts: 20,
    def: 'The sentence that opens the conclusion and sums up the argument.',
    ex: 'In conclusion, …'
  }
};

const FOCUS_OPTIONS = {
  mix: ['language', 'argument', 'organisation'],
  language: ['language'],
  argument: ['argument'],
  organisation: ['organisation']
};

function featuresForFocus(focus) {
  const cats = FOCUS_OPTIONS[focus] || FOCUS_OPTIONS.mix;
  return Object.keys(FEATURES).filter((id) => cats.indexOf(FEATURES[id].cat) >= 0);
}

module.exports = { CATEGORIES, FEATURES, FOCUS_OPTIONS, featuresForFocus };
