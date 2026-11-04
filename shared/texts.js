// Practice texts for Feature Creep. All sources cited in them are fictional.
//
// Markup, one string per sentence:
//   {thesis}            at the very start tags the WHOLE sentence (several: {counter,topic})
//   [[hedge|may not be]] tags a phrase (several: [[grammar,hedge|which suggest]])
//
// Every instance of a feature in a text should be tagged, because clicking an
// untagged instance counts as a miss. Each text plants two grammar mistakes
// where possible and at least one piece of informal wording.

module.exports = [
  {
    id: 'phones',
    title: 'Smartphones in the lecture hall',
    discipline: 'Education',
    paragraphs: [
      { label: 'Introduction', sentences: [
        'Over the past decade, smartphones have become a constant presence in university lecture halls.',
        'Many lecturers believe that [[refback|these devices]] are damaging students’ ability to concentrate.',
        '{thesis}I argue that the problem lies not in the technology itself but in how students are taught to manage it.'
      ] },
      { label: 'Body 1', sentences: [
        '{topic}[[signpost|Firstly]], there is evidence that phones [[hedge|can reduce]] attention during lectures.',
        '{source}Wood and Patel (2019) [[reporting|found]] that students who checked their phones more than five times per lecture recalled less of the content.',
        '{limitation}[[signpost|However]], [[refback|this study]] relied on self-reported phone use, which [[hedge|may not be]] accurate.',
        '[[informal|A lot of]] students also use their phones to look up unfamiliar terms, [[grammar,hedge|which suggest]] that [[refback|these devices]] are not always a distraction.'
      ] },
      { label: 'Body 2', sentences: [
        '{counter,topic}Critics of phone use [[reporting|argue]] that a complete ban is the only effective solution.',
        '[[booster|Undoubtedly]], bans remove the most obvious source of interruption.',
        '{rebuttal}[[signpost|Nevertheless]], a ban does nothing to develop the self-regulation that students will need after university.',
        '{definition}Self-regulation, which [[passive|can be defined]] as the ability to monitor and control one’s own learning, [[passive|is increasingly seen]] as a core graduate skill [[source|(Okafor, 2021)]].',
        '{example}[[signpost|For example]], several universities now [[grammar|runs]] short workshops on managing digital distraction.'
      ] },
      { label: 'Conclusion', sentences: [
        '{conclusion}[[signpost|In conclusion]], [[nominal|the reduction of]] distraction [[hedge|is more likely to]] come from teaching students to manage their devices than from [[nominal|their removal]].',
        '[[booster|Clearly]], [[refback|this approach]] asks more of lecturers, but it prepares students for working lives in which phones [[passive|will not simply be banned]].'
      ] }
    ]
  },

  {
    id: 'greenspace',
    title: 'Green space and mental health',
    discipline: 'Public health',
    paragraphs: [
      { label: 'Introduction', sentences: [
        'As cities [[grammar|grows]], urban planners face difficult choices about how to use limited land.',
        'Parks and gardens are [[hedge|often]] the first casualties of [[refback|this pressure]].',
        '{thesis}I argue that green space [[passive|should be treated]] as essential health infrastructure rather than as an optional amenity.'
      ] },
      { label: 'Body 1', sentences: [
        '{topic}[[signpost|Firstly]], access to green space [[hedge|appears to]] protect mental health.',
        '{source}In a survey of 20,000 adults, Morales and Lin (2018) [[reporting|reported]] that people living within 300 metres of a park had lower rates of depression.',
        '{limitation}[[signpost|However]], [[refback|this survey]] measured people at a single point in time, so it does not establish whether parks cause better mental health.',
        '[[informal|Kids]] who grow up near parks also [[grammar,hedge|tends]] to enjoy greater wellbeing as adults.'
      ] },
      { label: 'Body 2', sentences: [
        '{counter,topic}Property developers [[reporting|claim]] that land in city centres is too valuable to leave undeveloped.',
        '{rebuttal}[[signpost|Nevertheless]], [[refback|this argument]] ignores the cost of treating mental illness, which [[passive|is borne]] by public health services.',
        '{definition}Here, “green space” [[passive|is defined]] as any publicly accessible area of vegetation, including parks, river paths and community gardens.',
        '{example}[[signpost|For example]], [[nominal|the conversion of]] a disused railway line in Seoul into a park [[passive|was followed]] by a fall in local stress levels [[source|(Park, 2020)]].'
      ] },
      { label: 'Conclusion', sentences: [
        '{conclusion}[[signpost|In conclusion]], [[nominal|the protection of]] urban green space is [[booster|undoubtedly]] a public health issue.',
        'City authorities that sell parkland [[hedge|may]] save money in the short term, but they [[hedge|are likely to]] pay for [[refback|this decision]] through higher healthcare costs.'
      ] }
    ]
  },

  {
    id: 'fourday',
    title: 'The four-day working week',
    discipline: 'Business',
    paragraphs: [
      { label: 'Introduction', sentences: [
        'Since 2019, hundreds of companies have experimented with a four-day working week.',
        'Supporters see [[refback|this change]] as a way to improve wellbeing without losing output.',
        '{thesis}I argue that a shorter week [[hedge|can benefit]] both staff and employers, but only when employers redesign work rather than squeezing it into fewer days.'
      ] },
      { label: 'Body 1', sentences: [
        '{topic}[[signpost|Firstly]], shorter weeks [[hedge|seem to]] reduce burnout.',
        '{source}A trial of 61 firms [[reporting|found]] that most employees [[reporting|reported]] lower levels of exhaustion after six months [[source|(Lewis and Grant, 2023)]].',
        '{limitation}[[signpost|However]], the companies volunteered for the trial, so [[refback|these results]] [[hedge|may]] overstate the benefits.',
        'Firms that saw the best results had also [[grammar|cutted]] [[informal|loads of]] unnecessary meetings.'
      ] },
      { label: 'Body 2', sentences: [
        '{counter,topic}Critics [[reporting|argue]] that customer-facing businesses cannot close for an extra day.',
        '[[booster|Certainly]], a hospital or a call centre cannot simply shut on Fridays.',
        '{rebuttal}[[signpost|Nevertheless]], staggered rotas allow each employee to work four days while the business stays open for five.',
        '{definition}A staggered rota [[passive|can be defined]] as a schedule in which staff [[passive|are assigned]] different days off.',
        '{example}[[signpost|For instance]], one software company split its team into two groups, which [[grammar,passive|was given]] Mondays and Fridays off respectively.'
      ] },
      { label: 'Conclusion', sentences: [
        '{conclusion}[[signpost|In conclusion]], [[nominal|the success of]] a four-day week depends on [[nominal|the redesign of]] work itself.',
        '[[refback|This point]] [[hedge|suggests]] that cutting hours is [[booster|clearly]] not enough on its own.'
      ] }
    ]
  },

  {
    id: 'emi',
    title: 'Teaching degrees in English',
    discipline: 'Linguistics',
    paragraphs: [
      { label: 'Introduction', sentences: [
        'Universities in many non-English-speaking countries now teach entire degrees in English.',
        '[[refback|This trend]], which [[passive|is known]] as English-medium instruction (EMI), [[passive,hedge|is often promoted]] as a route to global competitiveness.',
        '{thesis}I argue that EMI benefits students only when universities provide strong language support.'
      ] },
      { label: 'Body 1', sentences: [
        '{topic}[[signpost|Firstly]], EMI [[hedge|may]] limit how deeply students understand their subject.',
        '{source}Kim and Sato (2020) [[reporting|observed]] that engineering students who studied in English asked fewer questions than [[grammar|those student]] who studied in Korean.',
        '{limitation}[[signpost|However]], the research covered only two classes, so [[refback|its findings]] [[hedge|might]] not apply elsewhere.',
        'Lecturers also [[reporting|note]] that students [[informal|really]] struggle with technical vocabulary at first.'
      ] },
      { label: 'Body 2', sentences: [
        '{counter,topic}Supporters of EMI [[reporting|contend]] that early difficulties disappear as students’ English improves.',
        '[[booster|Undoubtedly]], language skills develop over the course of a degree.',
        '{rebuttal}[[signpost|Nevertheless]], students who fall behind in their first year struggle to catch up, so early support matters.',
        '{definition}Language support, in [[refback|this context]], [[passive|is defined]] as English teaching that focuses on the language of a particular subject.',
        '{example}[[signpost|For example]], one Dutch university [[grammar|offer]] writing workshops for each faculty.'
      ] },
      { label: 'Conclusion', sentences: [
        '{conclusion}[[signpost|In conclusion]], [[nominal|the adoption of]] English as a medium of instruction is not a problem in itself.',
        '[[booster|Clearly]], [[nominal|the provision of]] language support decides whether EMI helps or harms learning.'
      ] }
    ]
  },

  {
    id: 'diets',
    title: 'Plant-based diets and the climate',
    discipline: 'Environmental science',
    paragraphs: [
      { label: 'Introduction', sentences: [
        'Food production accounts for [[hedge|roughly]] a quarter of global greenhouse gas emissions.',
        'Much of [[refback|this impact]] comes from meat and dairy.',
        '{thesis}I argue that governments should encourage plant-based diets through pricing and public catering rather than through personal persuasion alone.'
      ] },
      { label: 'Body 1', sentences: [
        '{topic}[[signpost|Firstly]], shifting diets [[hedge|could]] cut emissions substantially.',
        '{source}Moreno and Clarke (2018) [[reporting|estimated]] that removing animal products from diets [[hedge|could]] halve food-related emissions.',
        '{limitation}[[signpost|However]], [[refback|this estimate]] assumes a complete global shift, which is unrealistic.',
        'Most people are [[informal|pretty]] fond of the food they [[grammar|growed]] up with.'
      ] },
      { label: 'Body 2', sentences: [
        '{counter,topic}Opponents [[reporting|argue]] that diet is a personal choice and that governments should not interfere.',
        '[[booster|Certainly]], outright bans on meat would be unpopular.',
        '{rebuttal}[[signpost|Nevertheless]], governments already shape diets through subsidies, so [[refback|this objection]] misunderstands how food choices [[passive|are made]].',
        '{definition}A “default nudge” [[passive|can be defined]] as an arrangement in which the greener option [[passive|is presented]] first.',
        '{example}[[signpost|For example]], when two canteens made vegetarian meals the default, meat sales [[grammar|fall]] by [[hedge|around]] 40% [[source|(Hughes, 2019)]].'
      ] },
      { label: 'Conclusion', sentences: [
        '{conclusion}[[signpost|In conclusion]], [[nominal|the reduction of]] dietary emissions requires structural change, not just personal goodwill.',
        '[[refback|This conclusion]] [[hedge|suggests]] that canteens and supermarkets matter more than awareness campaigns.'
      ] }
    ]
  },

  {
    id: 'polarisation',
    title: 'Social media and political division',
    discipline: 'Politics',
    paragraphs: [
      { label: 'Introduction', sentences: [
        'Political debate increasingly takes place on social media.',
        'Many commentators blame [[refback|these platforms]] for deepening divisions between voters.',
        '{thesis}I argue that social media amplifies polarisation but does not create it.'
      ] },
      { label: 'Body 1', sentences: [
        '{topic}[[signpost|Firstly]], recommendation algorithms [[hedge|tend to]] show users content that matches their existing views.',
        '{source}Ortiz and Brandt (2021) [[reporting|showed]] that users who followed mainly partisan accounts [[passive|were exposed]] to fewer opposing arguments over time.',
        '{limitation}[[signpost|However]], the study tracked only one platform, so [[refback|its results]] [[hedge|may]] not generalise.',
        '[[informal|Loads of]] people also [[grammar|reads]] news from several sources each day.'
      ] },
      { label: 'Body 2', sentences: [
        '{counter,topic}Critics of the platforms [[reporting|claim]] that social media is the main cause of polarisation.',
        '{rebuttal}[[signpost|Nevertheless]], polarisation in the United States began rising in the 1980s, long before social media existed [[source|(Haldane, 2019)]].',
        '[[booster|Clearly]], other forces were already at work.',
        '{definition}Affective polarisation [[passive|is defined]] as the dislike and distrust that supporters of one party feel towards the other.',
        '{example}[[signpost|For example]], in 1960 only a small minority of Americans [[grammar|says]] they would be upset if their child married a supporter of the other party.'
      ] },
      { label: 'Conclusion', sentences: [
        '{conclusion}[[signpost|In conclusion]], [[nominal|the regulation of]] social media [[hedge|might]] slow polarisation, but it [[hedge|is unlikely to]] reverse it.',
        '[[nominal|The repair of]] political trust requires reforms that reach beyond [[refback|these platforms]].'
      ] }
    ]
  }
];
