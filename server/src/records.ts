import { localNow, localToday, utcNow } from './config.js';
import { audit, getDb, type Actor, type Row } from './db.js';
import { requireRead, requireWrite } from './access.js';
import { SUGGESTED_TIMES, TYPE_BY_KEY, type RecordTypeDef } from './recordTypes.js';
import { ApiError, validateInput } from './validate.js';

export function typeDef(key: string): RecordTypeDef {
  const def = TYPE_BY_KEY.get(key);
  if (!def) throw new ApiError(404, `Unknown record type "${key}". Valid types: ${[...TYPE_BY_KEY.keys()].join(', ')}`);
  return def;
}

function rowOut(def: RecordTypeDef, row: Row): Row {
  const out: Row = { ...row };
  for (const f of def.fields) if (f.type === 'boolean' && out[f.name] != null) out[f.name] = !!out[f.name];
  return out;
}

// ---- dates -----------------------------------------------------------------

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
}

// ---- per-type rules --------------------------------------------------------

/** Accepts "08:00", "8:00", "0800", "8", "7am", "3:30pm"; returns sorted, de-duplicated "HH:MM,HH:MM". */
function normaliseTimes(s: string): string {
  const parts = s.toLowerCase().replace(/\s+(am|pm)\b/g, '$1').split(/[,;\s]+/).filter(Boolean).map((t) => {
    const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/.exec(t);
    let h = m ? Number(m[1]) : NaN;
    const min = m && m[2] ? Number(m[2]) : 0;
    if (m && m[3]) {
      if (h < 1 || h > 12) h = NaN;
      else h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
    }
    if (!m || !(h >= 0 && h <= 23) || min > 59) {
      throw new ApiError(400, `schedule_times must be clock times separated by commas, e.g. "07:00,15:00,23:00" (got "${t}")`);
    }
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  });
  return [...new Set(parts)].sort().join(',');
}

function labFlag(v: Row): string | null {
  if (v.value_number == null) return null;
  if (v.reference_low != null && v.value_number < v.reference_low) return 'low';
  if (v.reference_high != null && v.value_number > v.reference_high) return 'high';
  if (v.reference_low != null || v.reference_high != null) return 'normal';
  return null;
}

/** Fill in derived values and check cross-record references. `merged` is the full row as it will be stored. */
function applyRules(def: RecordTypeDef, actor: Actor, patientId: number, input: Row, merged: Row, isCreate: boolean) {
  const db = getDb();
  if (def.key === 'prescriptions') {
    if (input.schedule_times) input.schedule_times = normaliseTimes(input.schedule_times);
    // Store the suggested times on a new prescription so they are visible and can be changed later.
    else if (isCreate && SUGGESTED_TIMES[merged.frequency]) input.schedule_times = SUGGESTED_TIMES[merged.frequency];
    // A changed frequency replaces suggested times with the new suggestion, but never times someone typed themselves.
    else if (!isCreate && input.frequency && input.schedule_times === undefined && SUGGESTED_TIMES[merged.frequency]
      && (!merged.schedule_times || Object.values(SUGGESTED_TIMES).includes(merged.schedule_times))) input.schedule_times = SUGGESTED_TIMES[merged.frequency];
    if (merged.end_date && merged.start_date && merged.end_date < merged.start_date) throw new ApiError(400, 'end_date cannot be before start_date');
  }
  if (def.key === 'med_doses') {
    if (merged.prescription_id != null) {
      const rx = db.prepare('SELECT medication_name FROM prescriptions WHERE id = ? AND patient_id = ?').get(merged.prescription_id, patientId) as Row | undefined;
      if (!rx) throw new ApiError(400, `prescription_id ${merged.prescription_id} does not exist in this chart`);
      if (!merged.medication_name) input.medication_name = rx.medication_name;
    } else if (!merged.medication_name) {
      throw new ApiError(400, 'Give either prescription_id or medication_name');
    }
    // Undo: putting a dose back to "due" clears who gave it and when. The audit log keeps the earlier values.
    if (!isCreate && input.dose_status === 'due') { input.given_at = null; input.given_by = null; }
    if (merged.dose_status === 'given' && input.dose_status !== 'due') {
      if (!merged.given_at) input.given_at = localNow();
      if (!merged.given_by) input.given_by = actor.displayName;
    }
  }
  if (def.key === 'lab_results') {
    if (merged.value_number == null && !merged.value_text) throw new ApiError(400, 'Give value_number or value_text');
    const touched = ['value_number', 'reference_low', 'reference_high'].some((k) => k in input);
    if ((isCreate && !merged.flag) || (!isCreate && touched && !('flag' in input))) input.flag = labFlag(merged);
    if (merged.document_id != null && !db.prepare('SELECT 1 FROM documents WHERE id = ? AND patient_id = ?').get(merged.document_id, patientId)) {
      throw new ApiError(400, `document_id ${merged.document_id} does not exist in this chart`);
    }
  }
  if (def.key === 'notes' && isCreate && !merged.author_name) input.author_name = actor.displayName;
}

/** Future un-recorded doses are regenerated from the prescription whenever it changes. */
function dropFutureDueDoses(prescriptionId: number, all = false) {
  getDb().prepare(`DELETE FROM med_doses WHERE prescription_id = ? AND dose_status = 'due' ${all ? '' : 'AND scheduled_at > ?'}`)
    .run(...(all ? [prescriptionId] : [prescriptionId, localNow()]));
}

// ---- generic CRUD ----------------------------------------------------------

export interface ListOptions { include_errors?: boolean; limit?: number; from?: string; to?: string }

export function listRecords(actor: Actor, patientId: number, key: string, o: ListOptions = {}): Row[] {
  const def = typeDef(key);
  requireRead(actor, patientId, key);
  return listRaw(def, patientId, o);
}

/** No access check: callers must have checked already. */
export function listRaw(def: RecordTypeDef, patientId: number, o: ListOptions = {}): Row[] {
  const sort = def.fields.find((f) => f.name === def.sortBy)!;
  const dated = sort.type === 'date' || sort.type === 'datetime';
  const where = ['patient_id = ?'];
  const args: unknown[] = [patientId];
  if (!o.include_errors) where.push("record_status = 'active'");
  if (dated && o.from) { where.push(`${sort.name} >= ?`); args.push(o.from); }
  if (dated && o.to) { where.push(`${sort.name} <= ?`); args.push(o.to.length === 10 && sort.type === 'datetime' ? `${o.to}T23:59` : o.to); }
  const limit = Math.min(Math.max(Number(o.limit) || 200, 1), 1000);
  const rows = getDb().prepare(
    `SELECT * FROM ${def.key} WHERE ${where.join(' AND ')} ORDER BY ${sort.name} ${dated ? 'DESC' : 'ASC'}, id DESC LIMIT ${limit}`,
  ).all(...args) as Row[];
  return rows.map((r) => rowOut(def, r));
}

function fetchRow(def: RecordTypeDef, patientId: number, id: number): Row {
  const row = getDb().prepare(`SELECT * FROM ${def.key} WHERE id = ? AND patient_id = ?`).get(id, patientId) as Row | undefined;
  if (!row) throw new ApiError(404, `No ${def.singular.toLowerCase()} with id ${id} in this chart`);
  return row;
}

export function getRecord(actor: Actor, patientId: number, key: string, id: number): Row {
  const def = typeDef(key);
  requireRead(actor, patientId, key);
  return rowOut(def, fetchRow(def, patientId, id));
}

export function createRecord(actor: Actor, patientId: number, key: string, input: unknown): Row {
  const def = typeDef(key);
  requireWrite(actor, patientId, key);
  const v = validateInput(def.fields, input, 'create');
  applyRules(def, actor, patientId, v, v, true);
  const cols = Object.keys(v);
  const now = utcNow();
  const r = getDb().prepare(
    `INSERT INTO ${def.key} (patient_id, created_at, updated_at, created_by, created_by_name, ${cols.join(', ')})
     VALUES (?,?,?,?,?,${cols.map(() => '?').join(',')})`,
  ).run(patientId, now, now, actor.userId, actor.displayName, ...cols.map((c) => v[c]));
  const id = Number(r.lastInsertRowid);
  audit(actor, 'create', { type: def.key, id, patientId });
  return rowOut(def, fetchRow(def, patientId, id));
}

export function updateRecord(actor: Actor, patientId: number, key: string, id: number, input: unknown): Row {
  const def = typeDef(key);
  requireWrite(actor, patientId, key);
  const before = fetchRow(def, patientId, id);
  if (before.record_status !== 'active') throw new ApiError(400, 'This entry was marked "entered in error" and can no longer be changed');
  const v = validateInput(def.fields, input, 'update');
  const merged = { ...before, ...v };
  for (const f of def.fields) {
    if (f.required && !f.readOnly && merged[f.name] == null) throw new ApiError(400, `${f.name} is required`);
  }
  applyRules(def, actor, patientId, v, merged, false);
  const cols = Object.keys(v).filter((c) => v[c] !== before[c]);
  if (cols.length) {
    getDb().prepare(`UPDATE ${def.key} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...cols.map((c) => v[c]), utcNow(), id);
    // The audit row keeps the old values, so an amended entry can always be traced back.
    audit(actor, 'update', {
      type: def.key, id, patientId,
      detail: { before: Object.fromEntries(cols.map((c) => [c, before[c]])), after: Object.fromEntries(cols.map((c) => [c, v[c]])) },
    });
    if (def.key === 'prescriptions') dropFutureDueDoses(id);
  }
  return rowOut(def, fetchRow(def, patientId, id));
}

/** Chart entries are never deleted. A mistake is struck through, with a reason, like on paper. */
export function markEnteredInError(actor: Actor, patientId: number, key: string, id: number, reason: unknown): Row {
  const def = typeDef(key);
  requireWrite(actor, patientId, key);
  fetchRow(def, patientId, id);
  const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : 'No reason given';
  getDb().prepare(`UPDATE ${def.key} SET record_status = 'entered_in_error', error_reason = ?, updated_at = ? WHERE id = ?`).run(why, utcNow(), id);
  audit(actor, 'entered_in_error', { type: def.key, id, patientId, detail: { reason: why } });
  if (def.key === 'prescriptions') dropFutureDueDoses(id, true);
  return rowOut(def, fetchRow(def, patientId, id));
}

// ---- medication administration record --------------------------------------

/** Materialise scheduled doses for active prescriptions between two dates (inclusive). Safe to call repeatedly. */
export function ensureDoses(patientId: number, from: string, to: string) {
  const db = getDb();
  if (dayDiff(from, to) > 31) to = addDays(from, 31);
  const rxs = db.prepare(
    `SELECT * FROM prescriptions WHERE patient_id = ? AND record_status = 'active' AND prescription_status = 'active' AND frequency != 'as_needed'`,
  ).all(patientId) as Row[];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO med_doses (patient_id, created_at, updated_at, created_by_name, prescription_id, medication_name, scheduled_at, dose_status)
     VALUES (?,?,?,?,?,?,?,'due')`,
  );
  const now = utcNow();
  db.transaction(() => {
    for (const rx of rxs) {
      const times = (rx.schedule_times || SUGGESTED_TIMES[rx.frequency] || '08:00').split(',');
      const step = rx.frequency === 'every_other_day' ? 2 : rx.frequency === 'weekly' ? 7 : 1;
      for (let day = from; day <= to; day = addDays(day, 1)) {
        if (day < rx.start_date || (rx.end_date && day > rx.end_date)) continue;
        if (dayDiff(rx.start_date, day) % step !== 0) continue;
        for (const t of times) insert.run(patientId, now, now, 'schedule', rx.id, rx.medication_name, `${day}T${t}`);
      }
    }
  })();
}

export function getMar(actor: Actor, patientId: number, date?: string) {
  requireRead(actor, patientId, 'med_doses');
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localToday();
  ensureDoses(patientId, day, day);
  const doses = getDb().prepare(
    `SELECT d.*, p.dose_amount, p.dose_unit, p.route, p.instructions FROM med_doses d
     LEFT JOIN prescriptions p ON p.id = d.prescription_id
     WHERE d.patient_id = ? AND d.record_status = 'active' AND d.scheduled_at >= ? AND d.scheduled_at <= ?
     ORDER BY d.scheduled_at, d.id`,
  ).all(patientId, `${day}T00:00`, `${day}T23:59`) as Row[];
  const nowLocal = localNow();
  for (const d of doses) d.is_overdue = d.dose_status === 'due' && d.scheduled_at < nowLocal;
  return { date: day, doses };
}
