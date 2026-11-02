import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// The fixed category list. "Project" doesn't get its own per-project
// categories — a project is a keyword, not a category. "Future" is
// deliberately excluded (it's a timeframe, not a topic).
// New categories go at the end: ids are `cat_<index>_<name>`.
export const CANONICAL_CATEGORIES = [
  'Career', 'Personal', 'Health', 'Research', 'Travel', 'Financial',
  'Project', 'Interests', 'Technical', 'Relationships', 'Preferences',
  'Mind'
]

// Hand-authored starting set - "these two topics tend to overlap in
// practice." Deliberately small; easy to add to later without touching code
// (it's just table rows). Boost values are read at scoring time, not
// hardcoded in scoring.js, so tuning this doesn't need a deploy.
const ADJACENT_CATEGORY_PAIRS = [
  ['Career', 'Project', 0.04],
  ['Career', 'Financial', 0.04],
  ['Career', 'Technical', 0.04],
  ['Health', 'Personal', 0.04],
  ['Travel', 'Interests', 0.04],
  ['Travel', 'Personal', 0.04],
  ['Research', 'Technical', 0.04],
  ['Project', 'Technical', 0.04],
  ['Relationships', 'Personal', 0.04],
  ['Preferences', 'Interests', 0.04],
  ['Mind', 'Health', 0.04],
  ['Mind', 'Personal', 0.04]
]

const __dirname = dirname(fileURLToPath(import.meta.url))
// BRAIN_DATA_DIR points the app at another data folder - the smoke tests
// (test/) use it so they never touch the real brain.
export const DATA_DIR = process.env.BRAIN_DATA_DIR || join(__dirname, '../../data')
const DB_FILE = join(DATA_DIR, 'brain.db')

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

// `keywords` is a JSON copy of the keyword terms for the full-text index
// (node_fts below); node_keywords holds the real links. A function so the
// clean-up in dropRetiredColumns() can rebuild the table from the same
// definition.
function nodesTableSql(name) {
  return `CREATE TABLE IF NOT EXISTS ${name} (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    thread TEXT NOT NULL DEFAULT 'General',
    timestamp TEXT NOT NULL,
    embedding TEXT NOT NULL
  );`
}

export const db = new Database(DB_FILE)
sqliteVec.load(db)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  ${nodesTableSql('nodes')}

  CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    strength REAL NOT NULL,
    type TEXT NOT NULL,
    UNIQUE(source, target)
  );

  CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
  CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
  CREATE INDEX IF NOT EXISTS idx_nodes_thread ON nodes(thread);

  -- Categories (seeded from CANONICAL_CATEGORIES) and keywords, linked to
  -- memories through node_categories / node_keywords.
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS node_categories (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (node_id, category_id)
  );

  CREATE TABLE IF NOT EXISTS keywords (
    id TEXT PRIMARY KEY,
    term TEXT NOT NULL COLLATE NOCASE UNIQUE,
    embedding TEXT NOT NULL DEFAULT '[]',
    description TEXT,
    defining_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS node_keywords (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
    PRIMARY KEY (node_id, keyword_id)
  );

  CREATE INDEX IF NOT EXISTS idx_node_categories_category ON node_categories(category_id);
  CREATE INDEX IF NOT EXISTS idx_node_keywords_keyword ON node_keywords(keyword_id);

  -- Small hand-authored "these categories are conceptually close" table. Each unordered pair stored once; scoring.js
  -- queries both directions.
  CREATE TABLE IF NOT EXISTS category_adjacency (
    category_a TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    category_b TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    boost REAL NOT NULL,
    PRIMARY KEY (category_a, category_b)
  );

  -- Weekly digests written from the Stats page (server/routes/stats.js).
  -- Kept forever as a dated history; deliberately NOT graph nodes (they're
  -- summaries of memories, so as nodes they'd link to everything and
  -- double-count in stats/search).
  CREATE TABLE IF NOT EXISTS digests (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    memory_count INTEGER NOT NULL,
    model TEXT NOT NULL,
    text TEXT NOT NULL
  );

  -- Wishlist (server/routes/wishlist.js): things Sarah is thinking about
  -- buying. Deliberately NOT graph nodes - an item has a lifecycle (idea ->
  -- bought/dropped) and a mention history, which a one-sentence memory
  -- doesn't. 'categories'/'keywords' are JSON string arrays tagged like a
  -- memory's (keywords matched to the brain's vocabulary, never creating new
  -- keyword rows); 'notes' and 'options' are JSON arrays of {at, text}.
  CREATE TABLE IF NOT EXISTS wishlist_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    categories TEXT NOT NULL DEFAULT '[]',
    keywords TEXT NOT NULL DEFAULT '[]',
    why TEXT,
    status TEXT NOT NULL DEFAULT 'idea',
    price TEXT,
    notes TEXT NOT NULL DEFAULT '[]',
    options TEXT NOT NULL DEFAULT '[]',
    mention_count INTEGER NOT NULL DEFAULT 1,
    first_mentioned TEXT NOT NULL,
    last_mentioned TEXT NOT NULL,
    status_changed_at TEXT NOT NULL,
    checked_in_at TEXT
  );
`)

// Columns added after a table was first created - ensureColumn() makes this
// idempotent across restarts.
function ensureColumn(table, column, ddl) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}
// Entities: a keyword that names a specific person,
// place, organisation or project gets a `kind`; NULL means a plain concept.
// `kind_source` is 'model' (set by extraction) or 'sarah' (set by hand) -
// extraction never overwrites Sarah's choice.
ensureColumn('keywords', 'kind', 'kind TEXT')
ensureColumn('keywords', 'kind_source', 'kind_source TEXT')
// Other names for a keyword ("AI Brain" -> Neuroverse). Resolved before any
// matching, so an alias never comes back as a keyword of its own.
db.exec(`
  CREATE TABLE IF NOT EXISTS keyword_aliases (
    alias TEXT PRIMARY KEY COLLATE NOCASE,
    keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE
  );
`)
// Axon's inbox (server/routes/inbox.js): the daily
// options and other things Axon proposes, and what Sarah did with them.
// Like the wishlist, NOT graph nodes - an item has a lifecycle (new ->
// done / later / rejected / expired) and an outcome note. impact, effort
// are 1-3; for_date is the local day (YYYY-MM-DD) an option is meant for.
// start_* is the one-click start (open the doc, the email draft, ...).
// xp_events gets one row per thing actually done - never for suggestions.
db.exec(`
  CREATE TABLE IF NOT EXISTS inbox_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'option',
    title TEXT NOT NULL,
    why TEXT,
    category TEXT,
    impact INTEGER,
    effort INTEGER,
    minutes INTEGER,
    series TEXT,
    series_step TEXT,
    needs_note INTEGER NOT NULL DEFAULT 0,
    start_kind TEXT,
    start_url TEXT,
    start_label TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    for_date TEXT,
    started_at TEXT,
    outcome_note TEXT,
    reason TEXT,
    source TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    status_changed_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox_items(status);

  CREATE TABLE IF NOT EXISTS xp_events (
    id TEXT PRIMARY KEY,
    item_id TEXT REFERENCES inbox_items(id) ON DELETE SET NULL,
    category TEXT,
    points INTEGER NOT NULL,
    reason TEXT NOT NULL,
    at TEXT NOT NULL
  );
`)

// A photo (file name in data/wishlist-images, see services/wishlistPhotos.js)
// and the shop page it came from.
ensureColumn('wishlist_items', 'image', 'image TEXT')
ensureColumn('wishlist_items', 'link', 'link TEXT')
// An idea's embedding (title + why), so Axon can't suggest the same idea
// twice in 90 days (server/routes/inbox.js). Options don't get one.
ensureColumn('inbox_items', 'embedding', 'embedding TEXT')
// The parts of an edge's score (services/scoring.js).
ensureColumn('edges', 'embedding_similarity', 'embedding_similarity REAL')
ensureColumn('edges', 'keyword_overlap', 'keyword_overlap REAL')
ensureColumn('edges', 'category_boost', 'category_boost REAL')

// Vector index for k-NN search. Kept in sync manually alongside `nodes`
// (vec0 virtual tables can't hold real foreign keys or triggers to `nodes`).
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS node_embeddings USING vec0(
    id TEXT PRIMARY KEY,
    embedding FLOAT[1536]
  );
`)

// Before the full-text block below, which recreates the triggers a
// rebuilt `nodes` table loses.
dropRetiredColumns()

// Full-text (BM25) index over each memory's title, content and keywords, so
// search can match exact words - names, acronyms - that embeddings blur.
// Unlike vec0, triggers keep it in sync with `nodes`, so every write path is
// covered automatically. It stores the node id itself rather than pointing at
// `nodes.rowid`, which a VACUUM may renumber (`nodes` has a TEXT primary key).
// `porter` stems words so "running" also matches "run".
const ftsExisted = db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'node_fts'`).get()
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS node_fts USING fts5(
    id UNINDEXED, title, content, keywords,
    tokenize='porter unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS nodes_fts_insert AFTER INSERT ON nodes BEGIN
    INSERT INTO node_fts(id, title, content, keywords)
    VALUES (new.id, new.title, new.content, new.keywords);
  END;

  CREATE TRIGGER IF NOT EXISTS nodes_fts_delete AFTER DELETE ON nodes BEGIN
    DELETE FROM node_fts WHERE id = old.id;
  END;

  CREATE TRIGGER IF NOT EXISTS nodes_fts_update AFTER UPDATE OF title, content, keywords ON nodes BEGIN
    DELETE FROM node_fts WHERE id = old.id;
    INSERT INTO node_fts(id, title, content, keywords)
    VALUES (new.id, new.title, new.content, new.keywords);
  END;
`)
// Small key/value store for app-wide settings that belong with the data,
// not the install: the owner's name and whether the First Light intro has
// been completed.
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value))
}

// First run on an existing database: index the memories already there.
if (!ftsExisted) {
  db.exec(`INSERT INTO node_fts(id, title, content, keywords) SELECT id, title, content, keywords FROM nodes`)
}

// Both are INSERT OR IGNORE, so this also adds categories and pairs that
// were added to the lists after a brain was created (Mind, 2026-10-07).
seedCategories()
seedCategoryAdjacency()

function seedCategories() {
  const now = new Date().toISOString()
  const insert = db.prepare(`INSERT OR IGNORE INTO categories (id, name, created_at) VALUES (?, ?, ?)`)
  CANONICAL_CATEGORIES.forEach((name, i) => {
    if (insert.run(`cat_${i}_${name.toLowerCase()}`, name, now).changes) console.log(`🏷️  Added category ${name}`)
  })
}

// One-time clean-up (2026-10-07): drops columns
// nothing reads any more - the old single `category` from before the
// categories table, the 2D graph's positions and animated edges, the
// never-used parent/child hierarchy, and the category approval status.
// Takes a full copy of the database first.
function dropRetiredColumns() {
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
  const nodeColumns = columns('nodes')
  const rebuildNodes = ['category', 'position_x', 'position_y', 'parent_node_id'].some(c => nodeColumns.includes(c))
  const dropAnimated = columns('edges').includes('animated')
  const dropStatus = columns('categories').includes('status')
  if (!rebuildNodes && !dropAnimated && !dropStatus) return

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const backupName = `brain.db.pre-cleanup-${stamp}`
  if (!existsSync(join(DATA_DIR, backupName))) db.exec(`VACUUM INTO '${join(DATA_DIR, backupName)}'`)
  console.log(`🧹 Dropping retired columns (backup at data/${backupName})`)

  // parent_node_id is a foreign key, which SQLite can't drop in place, so
  // `nodes` is copied into a fresh table instead. Foreign keys go off for
  // the swap - with them on, dropping the old table would cascade-delete
  // every edge and tag.
  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      if (dropStatus) {
        // Anything still pending approval was never used for a memory.
        db.prepare(`DELETE FROM categories WHERE status != 'approved'`).run()
        db.exec(`ALTER TABLE categories DROP COLUMN status`)
      }
      if (dropAnimated) db.exec(`ALTER TABLE edges DROP COLUMN animated`)
      if (rebuildNodes) {
        db.exec(`
          DROP TABLE IF EXISTS nodes_rebuild;
          ${nodesTableSql('nodes_rebuild')}
          INSERT INTO nodes_rebuild (id, title, content, keywords, thread, timestamp, embedding)
            SELECT id, title, content, keywords, thread, timestamp, embedding FROM nodes;
          DROP TABLE nodes;
          ALTER TABLE nodes_rebuild RENAME TO nodes;
          CREATE INDEX IF NOT EXISTS idx_nodes_thread ON nodes(thread);
        `)
      }
      const broken = db.prepare('PRAGMA foreign_key_check').all()
      if (broken.length > 0) throw new Error(`${broken.length} broken foreign key(s) after clean-up`)
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function seedCategoryAdjacency() {
  const getCategoryIdByName = db.prepare(`SELECT id FROM categories WHERE name = ? COLLATE NOCASE`)
  const insert = db.prepare(`INSERT OR IGNORE INTO category_adjacency (category_a, category_b, boost) VALUES (?, ?, ?)`)

  let seeded = 0
  const tx = db.transaction(() => {
    for (const [nameA, nameB, boost] of ADJACENT_CATEGORY_PAIRS) {
      const a = getCategoryIdByName.get(nameA)
      const b = getCategoryIdByName.get(nameB)
      if (!a || !b) {
        console.warn(`   ⚠️  Skipping category_adjacency seed for "${nameA}"/"${nameB}" - category not found`)
        continue
      }
      seeded += insert.run(a.id, b.id, boost).changes
    }
  })
  tx()
  if (seeded) console.log(`🔗 Seeded ${seeded} category_adjacency pairs`)
}
