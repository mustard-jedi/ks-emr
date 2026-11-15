import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Point the app at a throwaway data directory BEFORE loading it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-emr-test-'));
process.env.KS_DATA_DIR = tmp;
process.env.NODE_ENV = 'test';

const { createApp } = await import('../server/src/app.js');
const { getDb, openDb, setDb } = await import('../server/src/db.js');
const { backupTo, restoreFrom } = await import('../server/src/backup.js');
const { localToday } = await import('../server/src/config.js');

let server: Server;
let base = '';

/** A tiny browser: keeps its own session cookie. */
function client(token?: string) {
  let cookie = '';
  return async (method: string, url: string, body?: unknown, raw?: { type: string; data: Buffer }) => {
    const headers: Record<string, string> = { 'X-KS-EMR': '1' };
    if (cookie) headers.Cookie = cookie;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (raw) headers['Content-Type'] = raw.type;
    const res = await fetch(base + url, { method, headers, body: raw ? raw.data : body !== undefined ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json: any = text;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json };
  };
}

const owner = client();
const mom = client();
const PASSWORD = 'correct horse battery';
let ownerChart = 0;
let kidChart = 0;

before(async () => {
  setDb(openDb(':memory:'));
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('first run creates the owner and their chart; setup then locks', async () => {
  assert.equal((await owner('GET', '/api/status')).body.needs_setup, true);
  assert.equal((await owner('POST', '/api/setup', { username: 'dad', display_name: 'Dad Knight', password: 'short' })).status, 400);
  assert.equal((await owner('POST', '/api/setup', { username: 'dad', display_name: 'Dad Knight', password: PASSWORD })).status, 200);
  const me = (await owner('GET', '/api/me')).body;
  assert.equal(me.user.role, 'owner');
  assert.equal(me.patients.length, 1);
  ownerChart = me.patients[0].id;
  assert.equal((await client()('POST', '/api/setup', { username: 'x', display_name: 'X', password: PASSWORD })).status, 403);
});

test('requests without a session, or without the anti-CSRF header, are refused', async () => {
  assert.equal((await client()('GET', `/api/patients/${ownerChart}/summary`)).status, 401);
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('records: defaults, lenient coercion, validation errors, amend, strike out', async () => {
  const v = await owner('POST', `/api/patients/${ownerChart}/vitals`, { systolic_mmhg: '128', diastolic_mmhg: 82, weight_kg: 80.5 });
  assert.equal(v.status, 201);
  assert.equal(v.body.systolic_mmhg, 128);
  assert.match(v.body.recorded_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

  const bad = await owner('POST', `/api/patients/${ownerChart}/vitals`, { systolic: 120, pain_score: 11 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Unknown field "systolic"/);
  assert.match(bad.body.error, /pain_score must be at most 10/);

  const a = await owner('POST', `/api/patients/${ownerChart}/allergies`, { substance: 'Penicillin', severity: 'Life Threatening' });
  assert.equal(a.body.severity, 'life_threatening');
  assert.equal((await owner('POST', `/api/patients/${ownerChart}/allergies`, { reaction: 'rash' })).status, 400);

  const amended = await owner('PATCH', `/api/patients/${ownerChart}/allergies/${a.body.id}`, { reaction: 'Anaphylaxis' });
  assert.equal(amended.body.reaction, 'Anaphylaxis');
  const log = (await owner('GET', `/api/patients/${ownerChart}/audit`)).body;
  assert.ok(log.some((l: any) => l.action === 'update' && l.record_type === 'allergies' && l.detail.includes('Anaphylaxis')));

  const struck = await owner('POST', `/api/patients/${ownerChart}/vitals/${v.body.id}/entered-in-error`, { reason: 'wrong person' });
  assert.equal(struck.body.record_status, 'entered_in_error');
  assert.equal((await owner('GET', `/api/patients/${ownerChart}/vitals`)).body.length, 0);
  assert.equal((await owner('GET', `/api/patients/${ownerChart}/vitals?include_errors=true`)).body.length, 1);
  assert.equal((await owner('PATCH', `/api/patients/${ownerChart}/vitals/${v.body.id}`, { pain_score: 1 })).status, 400);
});

test('lab results are flagged from the reference range', async () => {
  const hi = await owner('POST', `/api/patients/${ownerChart}/lab_results`, { test_name: 'HbA1c', value_number: 7.2, unit: '%', reference_low: 4, reference_high: 5.6 });
  assert.equal(hi.body.flag, 'high');
  const fixed = await owner('PATCH', `/api/patients/${ownerChart}/lab_results/${hi.body.id}`, { value_number: 5.1 });
  assert.equal(fixed.body.flag, 'normal');
  assert.equal((await owner('POST', `/api/patients/${ownerChart}/lab_results`, { test_name: 'Nothing' })).status, 400);
});

test('a prescription generates due doses; recording and stopping work', async () => {
  const today = localToday();
  const rx = await owner('POST', `/api/patients/${ownerChart}/prescriptions`, { medication_name: 'Metformin 500 mg', frequency: 'twice_daily', schedule_times: '20:00, 8:00' });
  assert.equal(rx.body.schedule_times, '08:00,20:00');
  await owner('POST', `/api/patients/${ownerChart}/prescriptions`, { medication_name: 'Ibuprofen', frequency: 'as_needed' });

  let mar = (await owner('GET', `/api/patients/${ownerChart}/mar?date=${today}`)).body;
  assert.equal(mar.doses.length, 2);
  assert.deepEqual(mar.doses.map((d: any) => d.dose_status), ['due', 'due']);
  // Asking again must not duplicate doses.
  mar = (await owner('GET', `/api/patients/${ownerChart}/mar?date=${today}`)).body;
  assert.equal(mar.doses.length, 2);

  const given = await owner('PATCH', `/api/patients/${ownerChart}/med_doses/${mar.doses[0].id}`, { dose_status: 'given', remarks: 'with breakfast' });
  assert.equal(given.body.dose_status, 'given');
  assert.ok(given.body.given_at);
  assert.equal(given.body.given_by, 'Dad Knight');

  const summary = (await owner('GET', `/api/patients/${ownerChart}/summary`)).body;
  assert.equal(summary.current_medications.length, 2);
  assert.equal(summary.doses_today.given, 1);
  assert.equal(summary.allergies[0].substance, 'Penicillin');

  // Stopping removes tomorrow's un-recorded doses but keeps what was recorded.
  const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString('sv-SE');
  assert.equal((await owner('GET', `/api/patients/${ownerChart}/mar?date=${tomorrow}`)).body.doses.length, 2);
  await owner('PATCH', `/api/patients/${ownerChart}/prescriptions/${rx.body.id}`, { prescription_status: 'stopped' });
  assert.equal((await owner('GET', `/api/patients/${ownerChart}/mar?date=${tomorrow}`)).body.doses.length, 0);
  assert.ok((await owner('GET', `/api/patients/${ownerChart}/mar?date=${today}`)).body.doses.some((d: any) => d.dose_status === 'given'));
});

test('charts are private until shared, even from the owner', async () => {
  const made = await owner('POST', '/api/users', { username: 'mom', display_name: 'Mom Knight', password: PASSWORD });
  assert.equal(made.status, 200);
  assert.equal((await mom('POST', '/api/login', { username: 'mom', password: PASSWORD })).status, 200);
  const momChart = (await mom('GET', '/api/me')).body.patients[0].id;

  assert.equal((await owner('GET', `/api/patients/${momChart}/summary`)).status, 404);
  assert.equal((await mom('GET', `/api/patients/${ownerChart}/allergies`)).status, 404);
  assert.equal((await mom('GET', '/api/users')).status, 403);

  // Mom creates a managed profile for a child and shares it with Dad as a viewer of two sections.
  const kid = await mom('POST', '/api/patients', { full_name: 'Kid Knight', date_of_birth: '2020-05-01' });
  kidChart = kid.body.id;
  assert.equal(kid.body.has_own_login, false);
  await mom('POST', `/api/patients/${kidChart}/immunizations`, { vaccine: 'MMR', dose_number: 1 });
  await mom('POST', `/api/patients/${kidChart}/notes`, { text: 'Private note' });
  assert.equal((await owner('GET', `/api/patients/${kidChart}/immunizations`)).status, 404);
  assert.equal((await mom('POST', `/api/patients/${kidChart}/shares`, { username: 'dad', level: 'viewer', sections: ['immunizations', 'vitals'] })).status, 200);

  assert.equal((await owner('GET', `/api/patients/${kidChart}/immunizations`)).body.length, 1);
  assert.equal((await owner('GET', `/api/patients/${kidChart}/notes`)).status, 403);
  assert.equal((await owner('POST', `/api/patients/${kidChart}/vitals`, { weight_kg: 20 })).status, 403);
  assert.equal((await owner('GET', `/api/patients/${kidChart}/shares`)).status, 403);
  const s = (await owner('GET', `/api/patients/${kidChart}/summary`)).body;
  assert.ok(s.hidden_sections.includes('notes'));
  assert.equal(s.allergies, null);

  // Upgrading to editor lets Dad write.
  await mom('POST', `/api/patients/${kidChart}/shares`, { username: 'dad', level: 'editor' });
  assert.equal((await owner('POST', `/api/patients/${kidChart}/vitals`, { weight_kg: 20 })).status, 201);
});

test('physician share: expiring, read-only, limited to chosen sections, revocable, logged', async () => {
  const share = (await mom('POST', `/api/patients/${kidChart}/physician-shares`, { label: 'Dr. Patel', sections: ['immunizations'], expires_in_days: 3 })).body;
  assert.match(share.username, /^dr-/);
  const doc = client();
  assert.equal((await doc('POST', '/api/login', { username: share.username, password: share.password })).status, 200);
  assert.equal((await doc('GET', '/api/patients')).body.length, 1);
  assert.equal((await doc('GET', `/api/patients/${kidChart}/immunizations`)).body.length, 1);
  assert.equal((await doc('GET', `/api/patients/${kidChart}/vitals`)).status, 403);
  assert.equal((await doc('POST', `/api/patients/${kidChart}/immunizations`, { vaccine: 'Fake' })).status, 403);
  assert.equal((await doc('POST', '/api/patients', { full_name: 'Nope' })).status, 403);
  assert.equal((await doc('POST', '/api/tokens', { name: 'x' })).status, 403);
  assert.equal((await doc('GET', `/api/patients/${kidChart}/export`)).status, 403);

  const log = (await mom('GET', `/api/patients/${kidChart}/audit`)).body;
  assert.ok(log.some((l: any) => l.action === 'guest_view' && l.user_name === 'Dr. Patel'));

  // An expired share stops working at once, even with a live session.
  getDb().prepare("UPDATE users SET expires_at = '2000-01-01T00:00:00.000Z' WHERE username = ?").run(share.username);
  assert.equal((await doc('GET', '/api/patients')).status, 401);
  assert.equal((await client()('POST', '/api/login', { username: share.username, password: share.password })).status, 401);

  const share2 = (await mom('POST', `/api/patients/${kidChart}/physician-shares`, { label: 'Dr. Lee', sections: 'all' })).body;
  const doc2 = client();
  await doc2('POST', '/api/login', { username: share2.username, password: share2.password });
  const row = (await mom('GET', `/api/patients/${kidChart}/shares`)).body.find((r: any) => r.username === share2.username);
  await mom('DELETE', `/api/patients/${kidChart}/shares/${row.id}`);
  assert.equal((await doc2('GET', '/api/patients')).status, 401);
});

test('documents: upload gets a meaningful stored name and is served back', async () => {
  const d = (await owner('POST', `/api/patients/${ownerChart}/documents`, { title: 'CBC report', doc_type: 'lab_report', doc_date: '2026-03-04' })).body;
  const pdf = Buffer.from('%PDF-1.4\n% test\n');
  const up = await owner('PUT', `/api/patients/${ownerChart}/documents/${d.id}/file`, undefined, { type: 'application/pdf', data: pdf });
  assert.equal(up.status, 200);
  assert.match(up.body.file_name, new RegExp(`^20260304-\\d{6}_lab_report_${d.id}\\.pdf$`));
  assert.ok(fs.existsSync(path.join(tmp, 'attachments', String(ownerChart), up.body.file_name)));
  const res = await owner('GET', `/api/patients/${ownerChart}/documents/${d.id}/file`);
  assert.equal(res.status, 200);
  const notPdf = await owner('PUT', `/api/patients/${ownerChart}/documents/${d.id}/file`, undefined, { type: 'application/pdf', data: Buffer.from('<html>') });
  assert.equal(notPdf.status, 400);
  const html = await owner('PUT', `/api/patients/${ownerChart}/documents/${d.id}/file`, undefined, { type: 'text/html', data: Buffer.from('<html>') });
  assert.equal(html.status, 400);
});

test('API tokens and MCP: tools are listed, called, and respect read-only', async () => {
  const full = (await owner('POST', '/api/tokens', { name: 'agent' })).body.token;
  const ro = (await owner('POST', '/api/tokens', { name: 'reader', read_only: true })).body.token;
  assert.equal((await client(full)('GET', '/api/patients')).status, 200);
  assert.equal((await client(ro)('POST', `/api/patients/${ownerChart}/notes`, { text: 'x' })).status, 403);
  assert.equal((await client('ksemr_bogus')('GET', '/api/patients')).status, 401);

  const rpc = async (token: string, method: string, params: unknown) => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return (await res.json()) as any;
  };
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);

  const tools = (await rpc(full, 'tools/list', {})).result.tools;
  const names = tools.map((t: any) => t.name);
  for (const n of ['list_patients', 'get_patient_summary', 'add_vital_signs', 'list_lab_results', 'record_dose']) assert.ok(names.includes(n), n);
  // Every tool input is a flat object of simple types.
  for (const t of tools) {
    for (const [k, p] of Object.entries<any>(t.inputSchema.properties)) {
      assert.ok(['string', 'number', 'integer', 'boolean'].includes(p.type), `${t.name}.${k} has type ${p.type}`);
    }
  }
  assert.ok(!(await rpc(ro, 'tools/list', {})).result.tools.some((t: any) => t.name.startsWith('add_')));

  const added = await rpc(full, 'tools/call', { name: 'add_vital_signs', arguments: { patient_id: ownerChart, heart_rate_bpm: 72, temperature_c: 36.8 } });
  assert.equal(added.result.isError, undefined);
  assert.equal(JSON.parse(added.result.content[0].text).heart_rate_bpm, 72);
  const wrong = await rpc(full, 'tools/call', { name: 'add_vital_signs', arguments: { patient_id: ownerChart, pulse: 72 } });
  assert.equal(wrong.result.isError, true);
  assert.match(wrong.result.content[0].text, /Allowed fields/);
  const summary = await rpc(full, 'tools/call', { name: 'get_patient_summary', arguments: { patient_id: ownerChart } });
  assert.equal(JSON.parse(summary.result.content[0].text).patient.full_name, 'Dad Knight');
});

test('interop: FHIR bundle and OpenAPI document', async () => {
  const bundle = (await owner('GET', `/api/patients/${ownerChart}/fhir`)).body;
  assert.equal(bundle.resourceType, 'Bundle');
  const types = new Set(bundle.entry.map((e: any) => e.resource.resourceType));
  for (const t of ['Patient', 'AllergyIntolerance', 'MedicationRequest', 'Observation']) assert.ok(types.has(t), t);
  const api = (await owner('GET', '/api/openapi.json')).body;
  assert.ok(api.paths['/api/patients/{patient_id}/vitals'].post);
});

test('chart export/import and whole-database backup/restore round-trip as plain text', async () => {
  const chart = (await owner('GET', `/api/patients/${ownerChart}/export`)).body;
  assert.equal(chart.format, 'ks-emr-chart');
  const imported = (await owner('POST', '/api/patients/import', chart)).body;
  assert.equal(imported.imported.allergies, 1);
  const copy = (await owner('GET', `/api/patients/${imported.patient.id}/export`)).body;
  for (const k of Object.keys(chart.records)) assert.equal(copy.records[k].length, chart.records[k].length, k);
  // Doses in the copy point at the copied prescriptions, not the originals.
  const rxIds = new Set(copy.records.prescriptions.map((r: any) => r.id));
  assert.ok(copy.records.med_doses.every((d: any) => d.prescription_id == null || rxIds.has(d.prescription_id)));

  const file = path.join(tmp, 'backup.ndjson');
  const counts = backupTo(file);
  assert.ok(fs.readFileSync(file, 'utf8').split('\n')[0].includes('"ks_emr_backup":1'));
  const fresh = openDb(':memory:');
  const restored = await restoreFrom(file, fresh);
  assert.deepEqual(restored, Object.fromEntries(Object.entries(counts).filter(([, n]) => n)));
  const again = path.join(tmp, 'backup2.ndjson');
  backupTo(again, fresh);
  const body = (f: string) => fs.readFileSync(f, 'utf8').split('\n').slice(1).join('\n');
  assert.equal(body(again), body(file));
});

test('repeated wrong passwords lock the account for a while', async () => {
  const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await c('POST', '/api/login', { username: 'mom', password: 'wrong-password' })).status, 401);
  assert.equal((await c('POST', '/api/login', { username: 'mom', password: PASSWORD })).status, 429);
});
