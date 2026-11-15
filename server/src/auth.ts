import crypto from 'node:crypto';
import { utcNow } from './config.js';
import { audit, getDb, type Actor, type Row } from './db.js';
import { ApiError } from './validate.js';

const SESSION_DAYS = 30;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/i;

// ---- passwords -------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function checkPasswordPolicy(password: unknown): string {
  if (typeof password !== 'string' || password.length < 10) throw new ApiError(400, 'Password must be at least 10 characters');
  if (password.length > 200) throw new ApiError(400, 'Password is too long');
  return password;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Readable random code without look-alike characters, e.g. "K7QD-M2XP-9RTA". */
export function randomCode(groups: number, size = 4): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const out: string[] = [];
  for (let g = 0; g < groups; g++) {
    let s = '';
    for (let i = 0; i < size; i++) s += alphabet[crypto.randomInt(alphabet.length)];
    out.push(s);
  }
  return out.join('-');
}

// ---- users -----------------------------------------------------------------

export function countUsers(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as Row).n;
}

export function createUser(o: {
  username: string; displayName: string; password: string; role: Actor['role'];
  expiresAt?: string | null; createdBy?: number | null; mustChangePassword?: boolean;
}): number {
  if (!USERNAME_RE.test(o.username)) {
    throw new ApiError(400, 'Username must be 3-40 characters: letters, digits, dot, dash or underscore');
  }
  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(o.username)) throw new ApiError(409, 'That username is already taken');
  const r = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role, expires_at, must_change_password, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(o.username.toLowerCase(), o.displayName, hashPassword(o.password), o.role, o.expiresAt ?? null,
    o.mustChangePassword ? 1 : 0, utcNow(), o.createdBy ?? null);
  return Number(r.lastInsertRowid);
}

export function publicUser(u: Row) {
  return {
    id: u.id, username: u.username, display_name: u.display_name, role: u.role, unit_system: u.unit_system,
    expires_at: u.expires_at, disabled: !!u.disabled, must_change_password: !!u.must_change_password, created_at: u.created_at,
  };
}

function usable(u: Row | undefined): u is Row {
  if (!u || u.disabled) return false;
  if (u.expires_at && u.expires_at <= utcNow()) return false;
  return true;
}

function toActor(u: Row, via: Actor['via'], readOnly = false): Actor {
  return { userId: u.id, username: u.username, displayName: u.display_name, role: u.role, readOnly, via };
}

export function actorForUsername(username: string, via: Actor['via']): Actor {
  const u = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as Row | undefined;
  if (!usable(u)) throw new ApiError(401, `No usable account named "${username}"`);
  return toActor(u, via);
}

// ---- login throttle (in memory; resets on restart) -------------------------

const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map<string, number[]>();

function recentFails(key: string): number[] {
  const cutoff = Date.now() - WINDOW_MS;
  const list = (fails.get(key) || []).filter((t) => t > cutoff);
  fails.set(key, list);
  return list;
}
function noteFail(key: string) {
  recentFails(key).push(Date.now());
}

// ---- sessions --------------------------------------------------------------

export function login(username: unknown, password: unknown, ip: string): { token: string; actor: Actor; maxAgeMs: number } {
  if (typeof username !== 'string' || typeof password !== 'string') throw new ApiError(400, 'username and password are required');
  const userKey = `u:${username.toLowerCase()}`;
  const ipKey = `ip:${ip}`;
  if (recentFails(userKey).length >= 5 || recentFails(ipKey).length >= 30) {
    throw new ApiError(429, 'Too many failed sign-in attempts. Wait 15 minutes and try again.');
  }
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as Row | undefined;
  // Always run the hash so response time does not reveal whether the username exists.
  const ok = verifyPassword(password, u?.password_hash || hashPasswordDummy) && usable(u);
  if (!ok || !u) {
    noteFail(userKey);
    noteFail(ipKey);
    audit(null, 'login_failed', { detail: { username: String(username).slice(0, 40) } });
    throw new ApiError(401, 'Wrong username or password, or the account has expired');
  }
  fails.delete(userKey);
  const token = randomToken();
  let expires = Date.now() + SESSION_DAYS * 86400_000;
  if (u.expires_at) expires = Math.min(expires, Date.parse(u.expires_at));
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(sha256(token), u.id, utcNow(), new Date(expires).toISOString());
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(utcNow());
  const actor = toActor(u, 'session');
  audit(actor, 'login');
  return { token, actor, maxAgeMs: expires - Date.now() };
}
const hashPasswordDummy = hashPassword(randomToken());

export function logout(token: string | undefined) {
  if (token) getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
}

export function endSessionsFor(userId: number) {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function actorFromSession(token: string | undefined): Actor | null {
  if (!token) return null;
  const db = getDb();
  const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?').get(sha256(token), utcNow()) as Row | undefined;
  if (!s) return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id) as Row | undefined;
  return usable(u) ? toActor(u, 'session') : null;
}

// ---- API tokens ------------------------------------------------------------

export const TOKEN_PREFIX = 'ksemr_';

export function createApiToken(actor: Actor, name: string, readOnly: boolean): { id: number; token: string } {
  if (actor.role === 'guest') throw new ApiError(403, 'Guest accounts cannot create API tokens');
  const token = TOKEN_PREFIX + randomToken();
  const r = getDb().prepare('INSERT INTO api_tokens (user_id, name, token_hash, read_only, created_at) VALUES (?,?,?,?,?)')
    .run(actor.userId, name, sha256(token), readOnly ? 1 : 0, utcNow());
  audit(actor, 'token_created', { detail: { name, read_only: readOnly } });
  return { id: Number(r.lastInsertRowid), token };
}

export function actorFromBearer(token: string | undefined): Actor | null {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  const db = getDb();
  const t = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ? AND revoked = 0').get(sha256(token)) as Row | undefined;
  if (!t) return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(t.user_id) as Row | undefined;
  if (!usable(u)) return null;
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(utcNow(), t.id);
  return toActor(u, 'token', !!t.read_only);
}
