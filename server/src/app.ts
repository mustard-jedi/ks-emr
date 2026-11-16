import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ATTACH_DIR, COOKIE_NAME, ENV_LABEL, MANUAL_FILE, MAX_UPLOAD_BYTES, PRODUCTION, VERSION, WEB_DIR, localNow, utcNow } from './config.js';
import { audit, getDb, type Actor, type Row } from './db.js';
import {
  actorFromBearer, actorFromSession, checkPasswordPolicy, countUsers, createApiToken, createUser, endSessionsFor,
  hashPassword, login, logout, publicUser, verifyPassword,
} from './auth.js';
import {
  createPatient, createPhysicianShare, getPatient, listPatients, listShares, removeShare, requireManage, requireMember,
  requireRead, requireWrite, shareWithUser, updatePatient,
} from './access.js';
import { createRecord, getMar, getRecord, listRecords, markEnteredInError, updateRecord } from './records.js';
import { getSummary, sectionCounts } from './summary.js';
import { exportFhir } from './fhir.js';
import { exportChart, importChart } from './backup.js';
import { buildOpenApi } from './openapi.js';
import { createMcpServer } from './mcp.js';
import { PATIENT_FIELDS, RECORD_TYPES, TABS, TYPE_BY_KEY } from './recordTypes.js';
import { dueReminders, markReminderDone } from './reminders.js';
import { ApiError, requireInt, requireString } from './validate.js';

const COOKIE = COOKIE_NAME;
const UPLOAD_TYPES: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};

declare module 'express-serve-static-core' {
  interface Request { actor?: Actor }
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** True when the browser is on the server's own machine: that traffic never leaves it, so plain http is acceptable there. */
function isLocalRequest(req: Request): boolean {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function setSessionCookie(req: Request, res: Response, token: string, maxAgeMs: number) {
  // HTTPS-only in production, except when opened as http://localhost on the server itself (Safari refuses Secure cookies there).
  const secure = PRODUCTION && !(isLocalRequest(req) && !req.secure);
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}${secure ? '; Secure' : ''}`);
}

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  return h && h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : undefined;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Caddy (or another proxy) runs on the same machine; trust it for the client IP.
  app.set('trust proxy', 'loopback');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
        // Every URL in the app is relative, and HTTPS is enforced by the proxy in front plus HSTS below.
        // Upgrading here would break opening the app as http://localhost on the server itself.
        upgradeInsecureRequests: null,
      },
    },
    strictTransportSecurity: PRODUCTION,
  }));

  const api = express.Router();
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // Identify the caller: API token (agents) or session cookie (browser).
  api.use((req, _res, next) => {
    const token = bearer(req);
    if (token) {
      const actor = actorFromBearer(token);
      if (!actor) throw new ApiError(401, 'Invalid or revoked API token');
      req.actor = actor;
    } else {
      // Browsers attach cookies automatically; a custom header that other sites cannot send blocks cross-site requests.
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-ks-emr'] !== '1') {
        throw new ApiError(403, 'Missing X-KS-EMR header. Scripts and agents should use an API token instead.');
      }
      req.actor = actorFromSession(readCookie(req, COOKIE)) ?? undefined;
    }
    next();
  });

  const jsonBody = express.json({ limit: '1mb' });
  const bigJsonBody = express.json({ limit: '30mb' });
  const me = (req: Request): Actor => {
    if (!req.actor) throw new ApiError(401, 'Sign in first, or send an API token');
    return req.actor;
  };
  const pid = (req: Request) => requireInt(req.params.pid, 'patient_id');
  const body = (req: Request): Row => (req.body && typeof req.body === 'object' ? req.body : {});

  // ---- public ----------------------------------------------------------------

  api.get('/status', (_req, res) => { res.json({ app: 'KS EMR', version: VERSION, needs_setup: countUsers() === 0, env_label: ENV_LABEL }); });
  api.get('/openapi.json', (_req, res) => { res.json(buildOpenApi()); });
  api.get('/manual', (_req, res) => { res.type('text/markdown').send(fs.existsSync(MANUAL_FILE) ? fs.readFileSync(MANUAL_FILE, 'utf8') : '# Manual not found'); });
  api.get('/meta', (_req, res) => { res.json({ tabs: TABS, record_types: RECORD_TYPES, patient_fields: PATIENT_FIELDS }); });

  /** First run only: creates the owner account and the owner's own chart. */
  api.post('/setup', jsonBody, (req, res) => {
    if (countUsers() > 0) throw new ApiError(403, 'KS EMR is already set up');
    const b = body(req);
    const username = requireString(b.username, 'username', 40);
    const displayName = requireString(b.display_name, 'display_name', 100);
    const password = checkPasswordPolicy(b.password);
    const db = getDb();
    db.transaction(() => {
      const id = createUser({ username, displayName, password, role: 'owner' });
      const actor: Actor = { userId: id, username, displayName, role: 'owner', readOnly: false, via: 'session' };
      createPatient(actor, { full_name: displayName }, id);
      audit(actor, 'setup');
    })();
    const s = login(username, password, req.ip || '');
    setSessionCookie(req, res, s.token, s.maxAgeMs);
    res.json({ ok: true });
  });

  api.post('/login', jsonBody, (req, res) => {
    const b = body(req);
    const s = login(b.username, b.password, req.ip || '');
    setSessionCookie(req, res, s.token, s.maxAgeMs);
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    logout(readCookie(req, COOKIE));
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  // ---- account ---------------------------------------------------------------

  const userRow = (id: number) => getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as Row;

  api.get('/me', (req, res) => {
    const actor = me(req);
    res.json({ user: publicUser(userRow(actor.userId)), patients: listPatients(actor), server_time: localNow() });
  });

  api.patch('/me', jsonBody, (req, res) => {
    const actor = me(req);
    const b = body(req);
    if (b.unit_system !== undefined) {
      if (!['metric', 'imperial'].includes(b.unit_system)) throw new ApiError(400, 'unit_system must be metric or imperial');
      getDb().prepare('UPDATE users SET unit_system = ? WHERE id = ?').run(b.unit_system, actor.userId);
    }
    if (b.temperature_unit !== undefined) {
      if (!['auto', 'c', 'f'].includes(b.temperature_unit)) throw new ApiError(400, 'temperature_unit must be auto, c or f');
      getDb().prepare('UPDATE users SET temperature_unit = ? WHERE id = ?').run(b.temperature_unit, actor.userId);
    }
    if (b.theme !== undefined) {
      // Any theme id is accepted so that a new theme needs no server change; the web app falls back to "auto" for ids it does not know.
      if (typeof b.theme !== 'string' || !/^[a-z0-9-]{1,30}$/.test(b.theme)) throw new ApiError(400, 'theme must be a theme id such as auto, classic, modern-light or modern-dark');
      getDb().prepare('UPDATE users SET theme = ? WHERE id = ?').run(b.theme, actor.userId);
    }
    if (b.display_name !== undefined && actor.role !== 'guest') {
      getDb().prepare('UPDATE users SET display_name = ? WHERE id = ?').run(requireString(b.display_name, 'display_name', 100), actor.userId);
    }
    res.json({ user: publicUser(userRow(actor.userId)) });
  });

  /** Care reminders: doses due and monitoring checks due, across every chart this person may write to. */
  api.get('/reminders/due', (req, res) => { res.json(dueReminders(me(req))); });

  api.post('/me/password', jsonBody, (req, res) => {
    const actor = me(req);
    if (actor.via !== 'session' || actor.role === 'guest') throw new ApiError(403, 'Passwords can only be changed from the web app by a family account');
    const b = body(req);
    if (!verifyPassword(String(b.current_password || ''), userRow(actor.userId).password_hash)) throw new ApiError(400, 'Current password is wrong');
    const pw = checkPasswordPolicy(b.new_password);
    getDb().prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(pw), actor.userId);
    // Sign out everywhere, then sign this browser back in.
    endSessionsFor(actor.userId);
    const s = login(actor.username, pw, req.ip || '');
    setSessionCookie(req, res, s.token, s.maxAgeMs);
    audit(actor, 'password_changed');
    res.json({ ok: true });
  });

  api.get('/tokens', (req, res) => {
    const actor = me(req);
    res.json(getDb().prepare('SELECT id, name, read_only, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked = 0 ORDER BY id')
      .all(actor.userId).map((t: any) => ({ ...t, read_only: !!t.read_only })));
  });
  api.post('/tokens', jsonBody, (req, res) => {
    const actor = me(req);
    if (actor.via !== 'session') throw new ApiError(403, 'API tokens can only be created from the web app');
    const b = body(req);
    res.json(createApiToken(actor, requireString(b.name, 'name', 80), !!b.read_only));
  });
  api.delete('/tokens/:id', (req, res) => {
    const actor = me(req);
    getDb().prepare('UPDATE api_tokens SET revoked = 1 WHERE id = ? AND user_id = ?').run(requireInt(req.params.id, 'id'), actor.userId);
    audit(actor, 'token_revoked', { id: Number(req.params.id) });
    res.json({ ok: true });
  });

  // ---- family accounts (owner only) ------------------------------------------

  const owner = (req: Request): Actor => {
    const actor = me(req);
    if (actor.role !== 'owner' || actor.readOnly) throw new ApiError(403, 'Only the owner can manage accounts');
    return actor;
  };

  /** Names other family members can share a chart with. */
  api.get('/directory', (req, res) => {
    const actor = me(req);
    requireMember({ ...actor, readOnly: false });
    res.json(getDb().prepare("SELECT username, display_name FROM users WHERE role != 'guest' AND disabled = 0 AND id != ? ORDER BY display_name").all(actor.userId));
  });

  api.get('/users', (req, res) => {
    owner(req);
    res.json(getDb().prepare("SELECT * FROM users WHERE role != 'guest' ORDER BY id").all().map((u) => publicUser(u as Row)));
  });

  api.post('/users', jsonBody, (req, res) => {
    const actor = owner(req);
    const b = body(req);
    const username = requireString(b.username, 'username', 40);
    const displayName = requireString(b.display_name, 'display_name', 100);
    const password = checkPasswordPolicy(b.password);
    const id = getDb().transaction(() => {
      const uid = createUser({ username, displayName, password, role: 'member', createdBy: actor.userId, mustChangePassword: true });
      // The new member's own chart belongs to them alone; the owner gets no access to it.
      if (b.create_chart !== false) createPatient(actor, { full_name: displayName }, uid);
      return uid;
    })();
    audit(actor, 'user_created', { detail: { username } });
    res.json(publicUser(userRow(id)));
  });

  api.patch('/users/:id', jsonBody, (req, res) => {
    const actor = owner(req);
    const id = requireInt(req.params.id, 'id');
    const u = userRow(id);
    if (!u || u.role === 'guest') throw new ApiError(404, 'Account not found');
    const b = body(req);
    if (b.disabled !== undefined) {
      if (id === actor.userId) throw new ApiError(400, 'You cannot disable your own account');
      getDb().prepare('UPDATE users SET disabled = ? WHERE id = ?').run(b.disabled ? 1 : 0, id);
      if (b.disabled) endSessionsFor(id);
    }
    if (b.new_password !== undefined) {
      getDb().prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(checkPasswordPolicy(b.new_password)), id);
      endSessionsFor(id);
    }
    audit(actor, 'user_updated', { detail: { username: u.username, disabled: b.disabled, password_reset: b.new_password !== undefined } });
    res.json(publicUser(userRow(id)));
  });

  // ---- charts ----------------------------------------------------------------

  // Everything a temporary physician account opens is written to the chart's access log.
  api.use('/patients/:pid', (req, _res, next) => {
    if (req.actor?.role === 'guest' && req.method === 'GET') {
      const id = Number(req.params.pid);
      if (Number.isInteger(id)) audit(req.actor, 'guest_view', { patientId: id, detail: { path: req.path } });
    }
    next();
  });

  api.get('/patients', (req, res) => { res.json(listPatients(me(req))); });
  api.post('/patients', jsonBody, (req, res) => { res.json(createPatient(me(req), body(req))); });
  api.post('/patients/import', bigJsonBody, (req, res) => { res.json(importChart(me(req), req.body)); });
  api.get('/patients/:pid', (req, res) => { res.json(getPatient(me(req), pid(req))); });
  api.patch('/patients/:pid', jsonBody, (req, res) => { res.json(updatePatient(me(req), pid(req), body(req))); });
  api.get('/patients/:pid/summary', (req, res) => { res.json(getSummary(me(req), pid(req))); });
  api.get('/patients/:pid/counts', (req, res) => { res.json(sectionCounts(me(req), pid(req))); });
  api.get('/patients/:pid/mar', (req, res) => { res.json(getMar(me(req), pid(req), typeof req.query.date === 'string' ? req.query.date : undefined)); });
  api.get('/patients/:pid/fhir', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="ks-emr-patient-${pid(req)}-fhir.json"`);
    res.json(exportFhir(me(req), pid(req)));
  });
  api.get('/patients/:pid/export', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="ks-emr-chart-${pid(req)}-${localNow().slice(0, 10)}.json"`);
    res.type('application/json').send(JSON.stringify(exportChart(me(req), pid(req)), null, 2));
  });
  api.get('/patients/:pid/audit', (req, res) => {
    requireManage(me(req), pid(req));
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json(getDb().prepare('SELECT id, at, user_name, action, record_type, record_id, detail FROM audit_log WHERE patient_id = ? ORDER BY id DESC LIMIT ?')
      .all(pid(req), limit));
  });

  // ---- sharing ---------------------------------------------------------------

  api.get('/patients/:pid/shares', (req, res) => { res.json(listShares(me(req), pid(req))); });
  api.post('/patients/:pid/shares', jsonBody, (req, res) => { res.json(shareWithUser(me(req), pid(req), body(req))); });
  api.delete('/patients/:pid/shares/:id', (req, res) => { res.json(removeShare(me(req), pid(req), requireInt(req.params.id, 'id'))); });
  api.post('/patients/:pid/physician-shares', jsonBody, (req, res) => {
    const actor = me(req);
    if (actor.via !== 'session') throw new ApiError(403, 'Physician shares can only be created from the web app');
    res.json(createPhysicianShare(actor, pid(req), body(req)));
  });

  // ---- document files --------------------------------------------------------

  api.put('/patients/:pid/documents/:id/file', express.raw({ type: Object.keys(UPLOAD_TYPES), limit: MAX_UPLOAD_BYTES }), (req, res) => {
    const actor = me(req);
    const patientId = pid(req);
    const id = requireInt(req.params.id, 'id');
    requireWrite(actor, patientId, 'documents');
    const doc = getRecord(actor, patientId, 'documents', id);
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = UPLOAD_TYPES[mime];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) throw new ApiError(400, 'Upload a PDF, JPEG, PNG or WebP file');
    if (ext === 'pdf' && req.body.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ApiError(400, 'That file is not a valid PDF');
    // Meaningful, unique, sortable name: <document date>-<upload time>_<type>_<id>.<ext>
    const stamp = localNow().slice(11).replace(':', '') + String(new Date().getSeconds()).padStart(2, '0');
    const fileName = `${String(doc.doc_date).replace(/-/g, '')}-${stamp}_${doc.doc_type}_${id}.${ext}`;
    const dir = path.join(ATTACH_DIR, String(patientId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), req.body, { mode: 0o600 });
    let original = 'upload';
    try { original = decodeURIComponent(String(req.headers['x-file-name'] || 'upload')).replace(/[\r\n]/g, '').slice(0, 200); } catch { /* keep default */ }
    getDb().prepare('UPDATE documents SET file_name = ?, original_name = ?, mime_type = ?, size_bytes = ?, updated_at = ? WHERE id = ?')
      .run(fileName, original, mime, req.body.length, utcNow(), id);
    audit(actor, 'file_uploaded', { type: 'documents', id, patientId, detail: { file_name: fileName, replaced: doc.file_name || undefined } });
    res.json(getRecord(actor, patientId, 'documents', id));
  });

  api.get('/patients/:pid/documents/:id/file', (req, res) => {
    const doc = getRecord(me(req), pid(req), 'documents', requireInt(req.params.id, 'id'));
    const file = doc.file_name ? path.join(ATTACH_DIR, String(pid(req)), path.basename(doc.file_name)) : '';
    if (!file || !fs.existsSync(file)) throw new ApiError(404, 'No file is stored for this document');
    // Only PDF and image types are accepted on upload, and they are served with their exact type (plus nosniff from helmet).
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(doc.file_name)}"`);
    fs.createReadStream(file).pipe(res);
  });

  // ---- chart pages: one generic set of routes for every record type ------------

  const type = (req: Request, next: NextFunction): string | null => {
    const key = String(req.params.type);
    if (!TYPE_BY_KEY.has(key)) { next(); return null; }
    return key;
  };

  api.get('/patients/:pid/:type', (req, res, next) => {
    const key = type(req, next);
    if (!key) return;
    const q = req.query;
    res.json(listRecords(me(req), pid(req), key, {
      limit: Number(q.limit) || undefined, from: typeof q.from === 'string' ? q.from : undefined, to: typeof q.to === 'string' ? q.to : undefined,
      include_errors: q.include_errors === 'true' || q.include_errors === '1',
    }));
  });
  api.post('/patients/:pid/:type', jsonBody, (req, res, next) => {
    const key = type(req, next);
    if (key) res.status(201).json(createRecord(me(req), pid(req), key, req.body));
  });
  api.get('/patients/:pid/:type/:id', (req, res, next) => {
    const key = type(req, next);
    if (key) res.json(getRecord(me(req), pid(req), key, requireInt(req.params.id, 'id')));
  });
  api.patch('/patients/:pid/:type/:id', jsonBody, (req, res, next) => {
    const key = type(req, next);
    if (key) res.json(updateRecord(me(req), pid(req), key, requireInt(req.params.id, 'id'), req.body));
  });
  api.post('/patients/:pid/reminders/:id/done', (req, res) => {
    res.json(markReminderDone(me(req), pid(req), requireInt(req.params.id, 'id')));
  });
  api.post('/patients/:pid/:type/:id/entered-in-error', jsonBody, (req, res, next) => {
    const key = type(req, next);
    if (key) res.json(markEnteredInError(me(req), pid(req), key, requireInt(req.params.id, 'id'), body(req).reason));
  });

  api.use((_req, _res) => { throw new ApiError(404, 'No such API endpoint. See /api/openapi.json'); });
  app.use('/api', api);

  // ---- MCP over HTTP (stateless: one short-lived server per request) ----------

  app.post('/mcp', express.json({ limit: '1mb' }), async (req, res) => {
    const actor = actorFromBearer(bearer(req));
    if (!actor) {
      res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Send an API token: Authorization: Bearer ksemr_...' }, id: null });
      return;
    }
    const server = createMcpServer(actor);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST' }, id: null });
  });

  // ---- web app ---------------------------------------------------------------

  if (fs.existsSync(WEB_DIR)) {
    app.use(express.static(WEB_DIR, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(WEB_DIR, 'index.html'));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: err.message, details: err.details });
    } else if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'That upload is too large (limit 25 MB)' });
    } else if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      res.status(400).json({ error: 'Request body is not valid JSON' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return app;
}
