const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'opportunities.db');

let _db;

function getDb() {
  if (_db) return _db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imap_uid INTEGER NOT NULL UNIQUE,
      message_id TEXT,
      from_address TEXT NOT NULL,
      from_name TEXT,
      subject TEXT NOT NULL,
      received_at TEXT NOT NULL,
      body_text TEXT,
      body_html TEXT,
      extracted_at TEXT,
      opportunity_id INTEGER REFERENCES opportunities(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      project_title TEXT,
      dedup_key TEXT UNIQUE,
      company_url TEXT,
      location TEXT,
      work_frequency TEXT,
      work_style TEXT,
      start_timing TEXT,
      compensation TEXT,
      compensation_min INTEGER,
      compensation_max INTEGER,
      summary TEXT,
      background TEXT,
      responsibilities TEXT,
      team_structure TEXT,
      required_skills TEXT,
      preferred_skills TEXT,
      highlights TEXT,
      agent_name TEXT,
      agent_company TEXT,
      agent_email TEXT,
      agent_phone TEXT,
      platform TEXT,
      status TEXT DEFAULT '新着' CHECK(status IN ('新着','検討中','エントリー済','面談済','辞退','成約','対象外')),
      notes TEXT,
      my_feedback TEXT,
      reply_draft TEXT,
      next_action TEXT,
      next_action_date TEXT,
      ai_fit_score INTEGER,
      ai_fit_reason TEXT,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
      old_status TEXT,
      new_status TEXT NOT NULL,
      note TEXT,
      changed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_emails_uid ON emails(imap_uid);
    CREATE INDEX IF NOT EXISTS idx_emails_opp ON emails(opportunity_id);
    CREATE INDEX IF NOT EXISTS idx_opps_status ON opportunities(status);
    CREATE INDEX IF NOT EXISTS idx_opps_dedup ON opportunities(dedup_key);
    CREATE INDEX IF NOT EXISTS idx_opps_compensation ON opportunities(compensation_min);
    CREATE INDEX IF NOT EXISTS idx_status_history_opp ON status_history(opportunity_id);
  `);

  // Migration: add '対象外' to status CHECK constraint
  // SQLite can't ALTER CHECK constraints, so we recreate the table if needed
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='opportunities'").get();
  if (tableInfo && !tableInfo.sql.includes('対象外')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE opportunities_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        project_title TEXT,
        dedup_key TEXT UNIQUE,
        company_url TEXT,
        location TEXT,
        work_frequency TEXT,
        work_style TEXT,
        start_timing TEXT,
        compensation TEXT,
        compensation_min INTEGER,
        compensation_max INTEGER,
        summary TEXT,
        background TEXT,
        responsibilities TEXT,
        team_structure TEXT,
        required_skills TEXT,
        preferred_skills TEXT,
        highlights TEXT,
        agent_name TEXT,
        agent_company TEXT,
        agent_email TEXT,
        agent_phone TEXT,
        platform TEXT,
        status TEXT DEFAULT '新着' CHECK(status IN ('新着','検討中','エントリー済','面談済','辞退','成約','対象外')),
        notes TEXT,
        my_feedback TEXT,
        reply_draft TEXT,
        next_action TEXT,
        next_action_date TEXT,
        ai_fit_score INTEGER,
        ai_fit_reason TEXT,
        first_seen_at TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO opportunities_new SELECT * FROM opportunities;
      DROP TABLE opportunities;
      ALTER TABLE opportunities_new RENAME TO opportunities;
      CREATE INDEX IF NOT EXISTS idx_opps_status ON opportunities(status);
      CREATE INDEX IF NOT EXISTS idx_opps_dedup ON opportunities(dedup_key);
      CREATE INDEX IF NOT EXISTS idx_opps_compensation ON opportunities(compensation_min);
    `);
    db.pragma('foreign_keys = ON');
  }
}

module.exports = { getDb, DB_PATH };
