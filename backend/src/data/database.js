const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { DB } = require('../config/constants');

const dbFile = path.isAbsolute(DB.FILE) ? DB.FILE : path.join(__dirname, '..', '..', DB.FILE);
const dataDir = path.dirname(dbFile);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pen_name TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS letters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    parent_id INTEGER,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id),
    FOREIGN KEY (parent_id) REFERENCES letters(id)
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    letter_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, letter_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (letter_id) REFERENCES letters(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS read_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receiver_id INTEGER NOT NULL,
    letter_id INTEGER NOT NULL,
    read_at INTEGER NOT NULL,
    UNIQUE(receiver_id, letter_id),
    FOREIGN KEY (receiver_id) REFERENCES users(id),
    FOREIGN KEY (letter_id) REFERENCES letters(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_letters_sender ON letters(sender_id);
  CREATE INDEX IF NOT EXISTS idx_letters_receiver ON letters(receiver_id);
  CREATE INDEX IF NOT EXISTS idx_letters_parent ON letters(parent_id);
  CREATE INDEX IF NOT EXISTS idx_receipts_letter ON read_receipts(letter_id);
  CREATE INDEX IF NOT EXISTS idx_receipts_receiver ON read_receipts(receiver_id);
`);

// Migration (schema v1): backfill read receipts for letters that existed
// before the feature, so longtime travelers are not flooded with unread
// badges. Runs exactly once; letters created afterwards start unread.
const SCHEMA_VERSION = 1;
if (db.pragma('user_version', { simple: true }) < SCHEMA_VERSION) {
  const existing = db
    .prepare(
      `SELECT l.id, l.receiver_id, l.created_at
       FROM letters l
       LEFT JOIN read_receipts r
         ON r.letter_id = l.id AND r.receiver_id = l.receiver_id
       WHERE r.id IS NULL`
    )
    .all();
  const insertReceipt = db.prepare(
    'INSERT OR IGNORE INTO read_receipts (receiver_id, letter_id, read_at) VALUES (?, ?, ?)'
  );
  const backfill = db.transaction((rows) => {
    for (const row of rows) insertReceipt.run(row.receiver_id, row.id, row.created_at);
  });
  backfill(existing);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  if (existing.length) {
    console.log(`[db] backfilled read receipts for ${existing.length} existing letters`);
  }
}

module.exports = db;
