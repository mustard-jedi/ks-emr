import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ATTACH_DIR, DATA_DIR, DB_FILE, utcNow } from './config.js';
import { PATIENT_FIELDS, RECORD_TYPES, type FieldDef } from './recordTypes.js';

export type Row = Record<string, any>;

function sqlType(f: FieldDef): string {
  if (f.type === 'number') return 'REAL';
  if (f.type === 'integer' || f.type === 'boolean') return 'INTEGER';
  return 'TEXT';
}

const CORE_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,              -- owner | member | guest
  unit_system TEXT NOT NULL DEFAULT 'metric',
  temperature_unit TEXT NOT NULL DEFAULT 'auto',  -- auto (follow unit_system) | c | f
  theme TEXT NOT NULL DEFAULT 'auto',             -- auto (match device) or a theme id from web/src/theme.ts
  expires_at TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,             -- sha256 of the cookie value
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  read_only INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,                 -- login that IS this person; NULL for a managed profile
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER
);
CREATE TABLE IF NOT EXISTS patient_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  level TEXT NOT NULL,             -- manager | editor | viewer
  sections TEXT NOT NULL DEFAULT '*',
  label TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  created_by INTEGER,
  UNIQUE (patient_id, user_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  record_type TEXT,
  record_id INTEGER,
  patient_id INTEGER,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_patient ON audit_log (patient_id, id);
`;

/** Tables that backup/restore copies verbatim, in restore order. Sessions are deliberately left out. */
export const CORE_TABLES = ['users', 'api_tokens', 'patients', 'patient_access', 'audit_log'];

function addMissingColumns(db: Database.Database, table: string, fields: FieldDef[]) {
  const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((c) => c.name));
  for (const f of fields) {
    if (!have.has(f.name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${f.name} ${sqlType(f)}`);
  }
}

export function migrate(db: Database.Database) {
  db.exec(CORE_SQL);
  // Per-user display settings added after the first release.
  const userCols = new Set((db.prepare('PRAGMA table_info(users)').all() as Row[]).map((c) => c.name));
  if (!userCols.has('temperature_unit')) db.exec("ALTER TABLE users ADD COLUMN temperature_unit TEXT NOT NULL DEFAULT 'auto'");
  if (!userCols.has('theme')) db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'auto'");
  addMissingColumns(db, 'patients', PATIENT_FIELDS);
  for (const t of RECORD_TYPES) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${t.key} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      record_status TEXT NOT NULL DEFAULT 'active',  -- active | entered_in_error
      error_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by INTEGER,
      created_by_name TEXT
    )`);
    addMissingColumns(db, t.key, t.fields);
    db.exec(`CREATE INDEX IF NOT EXISTS ${t.key}_patient ON ${t.key} (patient_id)`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS med_doses_slot ON med_doses (prescription_id, scheduled_at) WHERE prescription_id IS NOT NULL');
}

export function openDb(file = DB_FILE): Database.Database {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.mkdirSync(ATTACH_DIR, { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

let shared: Database.Database | undefined;
export function getDb(): Database.Database {
  if (!shared) shared = openDb();
  return shared;
}
/** Tests swap in an in-memory database. */
export function setDb(db: Database.Database) {
  shared = db;
}

export interface Actor {
  userId: number;
  username: string;
  displayName: string;
  role: 'owner' | 'member' | 'guest';
  /** True for read-only API tokens. */
  readOnly: boolean;
  via: 'session' | 'token' | 'stdio';
}

export function audit(actor: Actor | null, action: string, o: { type?: string; id?: number; patientId?: number; detail?: unknown } = {}) {
  getDb().prepare(
    'INSERT INTO audit_log (at, user_id, user_name, action, record_type, record_id, patient_id, detail) VALUES (?,?,?,?,?,?,?,?)',
  ).run(utcNow(), actor?.userId ?? null, actor?.displayName ?? null, action, o.type ?? null, o.id ?? null, o.patientId ?? null,
    o.detail === undefined ? null : JSON.stringify(o.detail));
}

export { DATA_DIR };
