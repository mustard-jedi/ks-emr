import fs from 'node:fs';
import readline from 'node:readline';
import type Database from 'better-sqlite3';
import { utcNow, VERSION } from './config.js';
import { audit, CORE_TABLES, getDb, type Actor, type Row } from './db.js';
import { createPatient, requireManage } from './access.js';
import { PATIENT_FIELDS, RECORD_TYPES, SYSTEM_FIELDS } from './recordTypes.js';
import { ApiError } from './validate.js';

// ---- one chart, as plain JSON (web UI: Export / Import) ---------------------

export function exportChart(actor: Actor, patientId: number) {
  requireManage(actor, patientId);
  const db = getDb();
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId) as Row;
  const records: Record<string, Row[]> = {};
  for (const t of RECORD_TYPES) records[t.key] = db.prepare(`SELECT * FROM ${t.key} WHERE patient_id = ? ORDER BY id`).all(patientId) as Row[];
  audit(actor, 'export_chart', { patientId });
  return {
    format: 'ks-emr-chart', format_version: 1, app_version: VERSION, exported_at: utcNow(),
    patient: Object.fromEntries(PATIENT_FIELDS.map((f) => [f.name, p[f.name] ?? null])),
    records,
  };
}

/** Import a chart export as a NEW chart managed by the caller. Uploaded files are not part of an export. */
export function importChart(actor: Actor, data: any) {
  if (!data || data.format !== 'ks-emr-chart' || typeof data.patient !== 'object' || typeof data.records !== 'object') {
    throw new ApiError(400, 'This is not a KS EMR chart export file');
  }
  const db = getDb();
  return db.transaction(() => {
    const patient = createPatient(actor, data.patient);
    const idMap: Record<string, Map<number, number>> = {};
    const counts: Record<string, number> = {};
    // documents and prescriptions first: lab results and doses point at them.
    const order = [...RECORD_TYPES].sort((a, b) => Number(['lab_results', 'med_doses'].includes(a.key)) - Number(['lab_results', 'med_doses'].includes(b.key)));
    for (const t of order) {
      const rows: Row[] = Array.isArray(data.records[t.key]) ? data.records[t.key] : [];
      idMap[t.key] = new Map();
      const cols = [...SYSTEM_FIELDS.filter((c) => c !== 'id' && c !== 'patient_id'), ...t.fields.map((f) => f.name)];
      const insert = db.prepare(`INSERT INTO ${t.key} (patient_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(',')})`);
      for (const r of rows) {
        const row: Row = { ...r, created_by: actor.userId };
        row.created_at ??= utcNow();
        row.updated_at ??= row.created_at;
        row.record_status ??= 'active';
        if (t.key === 'med_doses' && row.prescription_id != null) row.prescription_id = idMap.prescriptions.get(row.prescription_id) ?? null;
        if (t.key === 'lab_results' && row.document_id != null) row.document_id = idMap.documents.get(row.document_id) ?? null;
        const values = cols.map((c) => {
          const v = row[c];
          return v === undefined ? null : typeof v === 'boolean' ? Number(v) : typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
        });
        const res = insert.run(patient.id, ...values);
        if (typeof r.id === 'number') idMap[t.key].set(r.id, Number(res.lastInsertRowid));
      }
      counts[t.key] = rows.length;
    }
    audit(actor, 'import_chart', { patientId: patient.id, detail: counts });
    return { patient, imported: counts };
  })();
}

// ---- whole database, as one NDJSON text file (CLI: backup / restore) --------

const ALL_TABLES = [...CORE_TABLES, ...RECORD_TYPES.map((t) => t.key)];

/**
 * One JSON object per line: a header line, then {"table": "...", "row": {...}} for every row.
 * Plain text, greppable, diffable. Attachment FILES are not included, only their names (documents.file_name).
 */
export function backupTo(file: string, db: Database.Database = getDb()): Record<string, number> {
  const out = fs.openSync(file, 'w', 0o600);
  const counts: Record<string, number> = {};
  try {
    fs.writeSync(out, `${JSON.stringify({ ks_emr_backup: 1, app_version: VERSION, created_at: utcNow(), tables: ALL_TABLES })}\n`);
    for (const table of ALL_TABLES) {
      counts[table] = 0;
      for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY id`).iterate()) {
        fs.writeSync(out, `${JSON.stringify({ table, row })}\n`);
        counts[table]++;
      }
    }
  } finally {
    fs.closeSync(out);
  }
  return counts;
}

/** Replace the whole database with the contents of a backup file. All-or-nothing. */
export async function restoreFrom(file: string, db: Database.Database = getDb()): Promise<Record<string, number>> {
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  const rows: { table: string; row: Row }[] = [];
  let header: Row | undefined;
  let n = 0;
  for await (const line of lines) {
    n++;
    if (!line.trim()) continue;
    let obj: Row;
    try { obj = JSON.parse(line); } catch { throw new Error(`Line ${n} is not valid JSON`); }
    if (!header) {
      if (obj.ks_emr_backup !== 1) throw new Error('Not a KS EMR backup file (missing header line)');
      header = obj;
      continue;
    }
    if (!ALL_TABLES.includes(obj.table) || typeof obj.row !== 'object') throw new Error(`Line ${n}: unknown table "${obj.table}"`);
    rows.push({ table: obj.table, row: obj.row });
  }
  if (!header) throw new Error('Backup file is empty');

  const counts: Record<string, number> = {};
  const columns = new Map(ALL_TABLES.map((t) => [t, new Set((db.prepare(`PRAGMA table_info(${t})`).all() as Row[]).map((c) => c.name as string))]));
  db.transaction(() => {
    for (const t of [...ALL_TABLES, 'sessions']) db.exec(`DELETE FROM ${t}`);
    for (const { table, row } of rows) {
      // Columns the current version no longer has are skipped; new columns stay NULL.
      const cols = Object.keys(row).filter((c) => columns.get(table)!.has(c));
      db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
      counts[table] = (counts[table] || 0) + 1;
    }
  })();
  return counts;
}
