import { PUBLIC_URL, utcNow } from './config.js';
import { audit, getDb, type Actor, type Row } from './db.js';
import { createUser, endSessionsFor, randomCode } from './auth.js';
import { PATIENT_FIELDS, SECTION_KEYS } from './recordTypes.js';
import { ApiError, requireString, validateInput } from './validate.js';

export type Level = 'manager' | 'editor' | 'viewer';
export interface Access {
  level: Level;
  /** '*' or the list of record type keys this user may see. */
  sections: '*' | string[];
}

const LEVELS: Level[] = ['manager', 'editor', 'viewer'];

function parseSections(s: string): '*' | string[] {
  return s === '*' ? '*' : s.split(',').filter(Boolean);
}

/** Charts are private: access exists only through an unexpired patient_access row. Being the owner grants nothing. */
export function getAccess(actor: Actor, patientId: number): Access | null {
  const row = getDb().prepare(
    `SELECT a.level, a.sections FROM patient_access a JOIN patients p ON p.id = a.patient_id
     WHERE a.patient_id = ? AND a.user_id = ? AND p.archived = 0 AND (a.expires_at IS NULL OR a.expires_at > ?)`,
  ).get(patientId, actor.userId, utcNow()) as Row | undefined;
  if (!row) return null;
  return { level: actor.role === 'guest' ? 'viewer' : row.level, sections: parseSections(row.sections) };
}

export function canSee(access: Access, section: string): boolean {
  return access.sections === '*' || access.sections.includes(section);
}

/** 404 rather than 403 so a chart's existence is not revealed to people without access. */
export function requireRead(actor: Actor, patientId: number, section?: string): Access {
  const access = getAccess(actor, patientId);
  if (!access) throw new ApiError(404, `No chart with patient_id ${patientId} is available to you`);
  if (section && !canSee(access, section)) throw new ApiError(403, `The "${section}" section of this chart is not shared with you`);
  return access;
}

export function requireWrite(actor: Actor, patientId: number, section?: string): Access {
  const access = requireRead(actor, patientId, section);
  if (actor.readOnly) throw new ApiError(403, 'This API token is read-only');
  if (access.level === 'viewer') throw new ApiError(403, 'You have view-only access to this chart');
  return access;
}

export function requireManage(actor: Actor, patientId: number): Access {
  const access = requireWrite(actor, patientId);
  if (access.level !== 'manager') throw new ApiError(403, 'Only a manager of this chart can do that');
  return access;
}

export function requireMember(actor: Actor) {
  if (actor.role === 'guest') throw new ApiError(403, 'Guest accounts cannot do that');
  if (actor.readOnly) throw new ApiError(403, 'This API token is read-only');
}

// ---- patients --------------------------------------------------------------

const PATIENT_COLS = PATIENT_FIELDS.map((f) => f.name);

export function ageFrom(dob: string | null): number | null {
  if (!dob) return null;
  const now = new Date();
  const [y, m, d] = dob.split('-').map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

function patientOut(p: Row, access: Access) {
  const out: Row = { id: p.id };
  for (const c of PATIENT_COLS) out[c] = p[c] ?? null;
  out.age_years = ageFrom(p.date_of_birth);
  out.has_own_login = p.user_id != null;
  out.access_level = access.level;
  out.shared_sections = access.sections === '*' ? 'all' : access.sections.join(',');
  return out;
}

export function listPatients(actor: Actor): Row[] {
  const rows = getDb().prepare(
    `SELECT p.*, a.level, a.sections FROM patients p JOIN patient_access a ON a.patient_id = p.id
     WHERE a.user_id = ? AND p.archived = 0 AND (a.expires_at IS NULL OR a.expires_at > ?)
     ORDER BY (p.user_id = a.user_id) DESC, p.full_name`,
  ).all(actor.userId, utcNow()) as Row[];
  return rows.map((p) => patientOut(p, { level: actor.role === 'guest' ? 'viewer' : p.level, sections: parseSections(p.sections) }));
}

export function getPatient(actor: Actor, patientId: number): Row {
  const access = requireRead(actor, patientId);
  return patientOut(getDb().prepare('SELECT * FROM patients WHERE id = ?').get(patientId) as Row, access);
}

/** Create a chart. linkUserId set = that person's own chart; unset = a managed profile (child, parent). */
export function createPatient(actor: Actor, input: unknown, linkUserId: number | null = null): Row {
  requireMember(actor);
  const v = validateInput(PATIENT_FIELDS, input, 'create');
  const db = getDb();
  const now = utcNow();
  const cols = Object.keys(v);
  const r = db.prepare(
    `INSERT INTO patients (user_id, created_at, updated_at, created_by, ${cols.join(', ')}) VALUES (?,?,?,?,${cols.map(() => '?').join(',')})`,
  ).run(linkUserId, now, now, actor.userId, ...cols.map((c) => v[c]));
  const id = Number(r.lastInsertRowid);
  db.prepare('INSERT INTO patient_access (patient_id, user_id, level, sections, created_at, created_by) VALUES (?,?,?,?,?,?)')
    .run(id, linkUserId ?? actor.userId, 'manager', '*', now, actor.userId);
  audit(actor, 'create', { type: 'patients', id, patientId: id });
  return getPatient(linkUserId ? { ...actor, userId: linkUserId } : actor, id);
}

export function updatePatient(actor: Actor, patientId: number, input: unknown): Row {
  requireManage(actor, patientId);
  const v = validateInput(PATIENT_FIELDS, input, 'update');
  const cols = Object.keys(v);
  if (cols.length) {
    const db = getDb();
    const before = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId) as Row;
    if ('full_name' in v && !v.full_name) throw new ApiError(400, 'full_name is required');
    db.prepare(`UPDATE patients SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...cols.map((c) => v[c]), utcNow(), patientId);
    audit(actor, 'update', { type: 'patients', id: patientId, patientId, detail: { before: Object.fromEntries(cols.map((c) => [c, before[c]])), after: v } });
  }
  return getPatient(actor, patientId);
}

// ---- sharing ---------------------------------------------------------------

function cleanSections(input: unknown): string {
  if (input === undefined || input === null || input === '*' || input === 'all') return '*';
  const list = Array.isArray(input) ? input.map(String) : String(input).split(',');
  const picked = [...new Set(list.map((s) => s.trim()).filter(Boolean))];
  const bad = picked.filter((s) => !SECTION_KEYS.includes(s));
  if (bad.length) throw new ApiError(400, `Unknown section(s): ${bad.join(', ')}. Valid sections: ${SECTION_KEYS.join(', ')}`);
  if (!picked.length) throw new ApiError(400, 'Choose at least one section to share');
  return picked.length === SECTION_KEYS.length ? '*' : picked.join(',');
}

export function listShares(actor: Actor, patientId: number): Row[] {
  requireManage(actor, patientId);
  const rows = getDb().prepare(
    `SELECT a.id, a.level, a.sections, a.label, a.expires_at, a.created_at, u.username, u.display_name, u.role
     FROM patient_access a JOIN users u ON u.id = a.user_id WHERE a.patient_id = ? ORDER BY a.id`,
  ).all(patientId) as Row[];
  const now = utcNow();
  return rows.map((r) => ({
    id: r.id, username: r.username, display_name: r.display_name, level: r.level,
    sections: r.sections === '*' ? 'all' : r.sections, label: r.label, expires_at: r.expires_at,
    is_physician_share: r.role === 'guest', is_expired: !!r.expires_at && r.expires_at <= now, created_at: r.created_at,
  }));
}

export function shareWithUser(actor: Actor, patientId: number, body: Row): Row[] {
  requireManage(actor, patientId);
  const username = requireString(body.username, 'username');
  const level = String(body.level || 'viewer') as Level;
  if (!LEVELS.includes(level)) throw new ApiError(400, `level must be one of: ${LEVELS.join(', ')}`);
  const sections = cleanSections(body.sections);
  const db = getDb();
  const u = db.prepare("SELECT * FROM users WHERE username = ? AND role != 'guest' AND disabled = 0").get(username) as Row | undefined;
  if (!u) throw new ApiError(404, `No family account named "${username}"`);
  if (u.id === actor.userId) throw new ApiError(400, 'You already manage this chart');
  db.prepare(
    `INSERT INTO patient_access (patient_id, user_id, level, sections, created_at, created_by) VALUES (?,?,?,?,?,?)
     ON CONFLICT (patient_id, user_id) DO UPDATE SET level = excluded.level, sections = excluded.sections, expires_at = NULL`,
  ).run(patientId, u.id, level, sections, utcNow(), actor.userId);
  audit(actor, 'share', { patientId, detail: { with: u.username, level, sections } });
  return listShares(actor, patientId);
}

export function removeShare(actor: Actor, patientId: number, accessId: number): Row[] {
  requireManage(actor, patientId);
  const db = getDb();
  const row = db.prepare(
    'SELECT a.*, u.role, u.username FROM patient_access a JOIN users u ON u.id = a.user_id WHERE a.id = ? AND a.patient_id = ?',
  ).get(accessId, patientId) as Row | undefined;
  if (!row) throw new ApiError(404, 'Share not found');
  if (row.level === 'manager') {
    const managers = (db.prepare("SELECT COUNT(*) AS n FROM patient_access WHERE patient_id = ? AND level = 'manager'").get(patientId) as Row).n;
    if (managers <= 1) throw new ApiError(400, 'A chart must keep at least one manager');
  }
  db.prepare('DELETE FROM patient_access WHERE id = ?').run(accessId);
  if (row.role === 'guest') {
    // A physician account exists only for its share: disable it and sign it out at once.
    db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(row.user_id);
    endSessionsFor(row.user_id);
  }
  audit(actor, 'unshare', { patientId, detail: { with: row.username } });
  return listShares(actor, patientId);
}

/** Temporary read-only account for a physician. The password is returned once and never stored in clear. */
export function createPhysicianShare(actor: Actor, patientId: number, body: Row) {
  requireManage(actor, patientId);
  const label = requireString(body.label, 'label (who the share is for)', 100);
  const sections = cleanSections(body.sections);
  const days = Number(body.expires_in_days ?? 7);
  if (!Number.isFinite(days) || days < 1 || days > 90) throw new ApiError(400, 'expires_in_days must be between 1 and 90');
  const expiresAt = new Date(Date.now() + days * 86400_000).toISOString();
  const username = `dr-${randomCode(1, 6).toLowerCase()}`;
  const password = randomCode(3);
  const db = getDb();
  const share = db.transaction(() => {
    const userId = createUser({ username, displayName: label, password, role: 'guest', expiresAt, createdBy: actor.userId });
    db.prepare('INSERT INTO patient_access (patient_id, user_id, level, sections, label, expires_at, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(patientId, userId, 'viewer', sections, label, expiresAt, utcNow(), actor.userId);
  });
  share();
  audit(actor, 'physician_share', { patientId, detail: { label, sections, expires_at: expiresAt, username } });
  return { username, password, expires_at: expiresAt, sections: sections === '*' ? 'all' : sections, login_url: PUBLIC_URL, label };
}
