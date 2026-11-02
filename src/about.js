// What the About page says (AboutView.jsx). Kept here as plain data so the
// words can be edited without touching the layout.
//
// `keywords` on a question links it to the memory graph: the page counts
// the memories tagged with any of them and offers to show them in 3D.
// `status` on a source says how it relates to the code: used (in the code
// today), tried (an experiment), planned (on the roadmap) or
// reading (an idea it connects to, not code).

export const ABOUT_WHY = {
  // Drafted from what the brain knows (memories tagged neuroscience, memory
  // systems, lifelogging). Sarah to rewrite in her own words; set draft to
  // false once she has.
  draft: true,
  paragraphs: [
    'I\'ve always been curious about how memories are represented: by brains, by cognitive science, and now by machines. Neuroverse started as a way to find out what it takes to engineer one for a real person.',
    'Every conversation with Claude taught it something about me, and then most of it was gone. I wanted those things to live somewhere I could see, search and correct, rather than in a black box.',
    'Building it turned philosophy questions into design decisions. What counts as one memory? Who gets to write it? Should anything ever be forgotten? I had to answer each one in code.',
    'The long-term idea is one place that holds the context of my life (projects, health, routines, work) that any AI I use can draw on, and that stays on my own computer.'
  ]
}

export const ABOUT_QUESTIONS = [
  {
    title: 'Whose mind is it?',
    body: 'Clark and Chalmers argue that a notebook can be part of your memory if you rely on it the way you rely on your own. Neuroverse is that notebook, except Claude writes in it without asking. Does a memory you never endorsed still count as yours? It\'s why nothing here merges or deletes without you.',
    keywords: ['extended mind', 'philosophy']
  },
  {
    title: 'What makes a self?',
    body: 'Locke tied identity to memory; Parfit said what matters is how connected your memories are; Dennett called the self a centre of narrative gravity. Neuroverse puts your name at the centre and links everything else to it, so it is a small, literal picture of all three.',
    keywords: ['personal identity', 'philosophy']
  },
  {
    title: 'What should a memory forget?',
    body: 'Brains consolidate while you sleep: they merge what\'s related, strengthen what\'s revisited and let trivia fade. Borges\' Funes, who forgets nothing, can\'t think at all. A planned "Sleep" pass would do the same for the brain, without ever deleting anything on its own.',
    keywords: ['sleep', 'memory', 'neuroscience']
  },
  {
    title: 'Could a brain become a chip?',
    body: 'Living neurons grown on chips have learned to play Pong, and "organoid intelligence" asks whether brain tissue could compute. If brains can run on chips, and chips can hold something like memories, where does a mind stop?',
    keywords: ['brain-to-chip', 'brain stem cells', 'biocomputing']
  },
  {
    title: 'If an AI were raised like a baby, would it become the same person?',
    body: 'Give an AI every sight, sound and touch a baby gets, for years. Would it end up with the baby\'s personality? I suspect not: a baby chooses its own inputs by acting, starts with evolution\'s built-in assumptions, and has a body with something at stake. A model trained on one child\'s headcam footage has already learned words, though. Neuroverse is a tiny version of the same experiment: it gets one person\'s conversations and builds a model of who they are.',
    keywords: ['nature vs nurture', 'embodied cognition']
  }
]

export const ABOUT_SOURCE_GROUPS = [
  {
    title: 'Built into Neuroverse',
    note: 'Methods from papers that are in the code, or tested against the real brain.',
    sources: [
      {
        title: 'Reciprocal rank fusion outperforms Condorcet and individual rank learning methods',
        authors: 'Cormack, Clarke & Büttcher',
        year: 2009,
        url: 'https://doi.org/10.1145/1571941.1572114',
        status: 'used',
        use: 'Search merges meaning-based and exact-word results this way, so names are never missed.'
      },
      {
        title: 'Fast unfolding of communities in large networks (Louvain)',
        authors: 'Blondel, Guillaume, Lambiotte & Lefebvre',
        year: 2008,
        url: 'https://arxiv.org/abs/0803.0476',
        status: 'tried',
        use: 'Run on the brain\'s links, it found about 17 clusters that match real parts of life, stable across random seeds.'
      },
      {
        title: 'The use of MMR, diversity-based reranking for reordering documents and producing summaries',
        authors: 'Carbonell & Goldstein',
        year: 1998,
        url: 'https://doi.org/10.1145/290941.291025',
        status: 'planned',
        use: 'Picks varied papers for Research Radar and varied example memories for entity overviews.'
      },
      {
        title: 'BERTopic: neural topic modeling with a class-based TF-IDF procedure',
        authors: 'Grootendorst',
        year: 2022,
        url: 'https://arxiv.org/abs/2203.05794',
        status: 'planned',
        use: 'Labels clusters of memories by their most distinctive keywords, with no paid model call.'
      }
    ]
  },
  {
    title: 'Ideas it connects to',
    note: 'Philosophy and neuroscience behind the questions above.',
    sources: [
      {
        title: 'As We May Think',
        authors: 'Vannevar Bush',
        year: 1945,
        url: 'https://www.theatlantic.com/magazine/archive/1945/07/as-we-may-think/303881/',
        status: 'reading',
        use: 'The memex: a personal machine for associative memory, 80 years early.'
      },
      {
        title: 'The Extended Mind',
        authors: 'Clark & Chalmers',
        year: 1998,
        url: 'https://doi.org/10.1093/analys/58.1.7',
        status: 'reading',
        use: 'Otto\'s notebook, and the question of whose mind Neuroverse is part of.'
      },
      {
        title: 'Why there are complementary learning systems in the hippocampus and neocortex',
        authors: 'McClelland, McNaughton & O\'Reilly',
        year: 1995,
        url: 'https://doi.org/10.1037/0033-295X.102.3.419',
        status: 'reading',
        use: 'Fast storage of single memories plus slow integration: the model for "Sleep".'
      },
      {
        title: 'Funes the Memorious',
        authors: 'Jorge Luis Borges',
        year: 1942,
        status: 'reading',
        use: 'Perfect memory as a curse. The case for letting things fade.'
      },
      {
        title: 'The Self as a Center of Narrative Gravity',
        authors: 'Daniel Dennett',
        year: 1992,
        status: 'reading',
        use: 'The self as what a story is organised around, like the name star at the centre.'
      },
      {
        title: 'Grounded language acquisition through the eyes and ears of a single child',
        authors: 'Vong, Wang, Orhan & Lake',
        year: 2024,
        url: 'https://doi.org/10.1126/science.adi1374',
        status: 'reading',
        use: 'A model trained on one child\'s headcam footage learned word meanings: part of the raised-like-a-baby question.'
      },
      {
        title: 'In vitro neurons learn and exhibit sentience when embodied in a simulated game-world',
        authors: 'Kagan et al.',
        year: 2022,
        url: 'https://doi.org/10.1016/j.neuron.2022.09.001',
        status: 'reading',
        use: 'Neurons on a chip learning Pong.'
      },
      {
        title: 'Organoid intelligence (OI): the new frontier in biocomputing and intelligence-in-a-dish',
        authors: 'Smirnova et al.',
        year: 2023,
        url: 'https://doi.org/10.3389/fsci.2023.1017235',
        status: 'reading',
        use: 'Brain organoids as a computing substrate.'
      }
    ]
  }
]

export const ABOUT_SIMILAR = ['Graphiti / Zep', 'mem0', 'Cognee', 'mcp-memory-service', 'basic-memory', 'agentmemory']
