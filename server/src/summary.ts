import { localToday } from './config.js';
import { getDb, type Actor, type Row } from './db.js';
import { canSee, getPatient, requireRead } from './access.js';
import { addDays, getMar, listRaw, typeDef } from './records.js';
import { SECTION_KEYS } from './recordTypes.js';

const VITAL_KEYS = ['systolic_mmhg', 'diastolic_mmhg', 'heart_rate_bpm', 'respiratory_rate_per_min', 'temperature_c', 'spo2_percent',
  'weight_kg', 'height_cm', 'blood_glucose_mg_dl', 'pain_score'];

const pick = (rows: Row[], keys: string[]) => rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));

/**
 * The Face Sheet: everything a stranger needs to know about this person on one page.
 * Sections that are not shared with the caller come back as null and are listed in hidden_sections.
 */
export function getSummary(actor: Actor, patientId: number) {
  const access = requireRead(actor, patientId);
  const today = localToday();
  const see = (k: string) => canSee(access, k);
  const all = (k: string) => listRaw(typeDef(k), patientId, { limit: 1000 });

  const out: Row = {
    patient: getPatient(actor, patientId),
    generated_on: today,
    hidden_sections: SECTION_KEYS.filter((k) => !see(k)),
    allergies: null, conditions: null, current_medications: null, family_history: null, last_visit: null,
    next_follow_up_date: null, latest_vitals: null, immunizations_due: null, abnormal_labs: null, doses_today: null, contacts: null,
    past_procedures: null,
  };

  if (see('allergies')) out.allergies = pick(all('allergies'), ['id', 'substance', 'reaction', 'severity']);
  if (see('conditions')) {
    out.conditions = pick(all('conditions').filter((c) => c.clinical_status !== 'resolved'), ['id', 'name', 'clinical_status', 'onset_date']);
  }
  if (see('prescriptions')) {
    out.current_medications = pick(
      all('prescriptions').filter((p) => p.prescription_status === 'active' && (!p.end_date || p.end_date >= today)),
      ['id', 'medication_name', 'dose_amount', 'dose_unit', 'route', 'frequency', 'schedule_times', 'indication', 'instructions'],
    );
  }
  if (see('family_history')) out.family_history = pick(all('family_history'), ['id', 'relation', 'condition', 'age_at_onset', 'is_deceased']);
  if (see('procedures')) out.past_procedures = pick(all('procedures'), ['id', 'name', 'procedure_date']);
  if (see('visits')) {
    const visits = all('visits');
    const past = visits.find((v) => v.visit_date <= today);
    out.last_visit = past ? pick([past], ['id', 'visit_date', 'visit_type', 'provider_name', 'reason', 'diagnosis'])[0] : null;
    const followUps = visits.map((v) => v.follow_up_date).filter((d) => d && d >= today).sort();
    out.next_follow_up_date = followUps[0] ?? null;
  }
  if (see('vitals')) {
    // Most recent non-empty value of each measurement, with the time it was taken.
    const latest: Row = {};
    for (const v of all('vitals')) {
      for (const k of VITAL_KEYS) if (v[k] != null && !(k in latest)) latest[k] = { value: v[k], recorded_at: v.recorded_at };
    }
    out.latest_vitals = Object.entries(latest).map(([measure, v]) => ({ measure, value: (v as Row).value, recorded_at: (v as Row).recorded_at }));
  }
  if (see('immunizations')) {
    out.immunizations_due = pick(
      all('immunizations').filter((i) => i.next_due_date && i.next_due_date <= addDays(today, 60)),
      ['id', 'vaccine', 'next_due_date'],
    );
  }
  if (see('lab_results')) {
    // Latest result of each test, kept only when it is out of range.
    const seen = new Set<string>();
    const abnormal: Row[] = [];
    for (const l of all('lab_results')) {
      const name = String(l.test_name).toLowerCase();
      if (seen.has(name)) continue;
      seen.add(name);
      if (l.flag && l.flag !== 'normal') abnormal.push(l);
    }
    out.abnormal_labs = pick(abnormal, ['id', 'test_name', 'collected_date', 'value_number', 'value_text', 'unit', 'flag']);
  }
  if (see('med_doses')) {
    const { doses } = getMar(actor, patientId, today);
    const count = (s: string) => doses.filter((d) => d.dose_status === s).length;
    out.doses_today = {
      due: count('due'), overdue: doses.filter((d) => d.is_overdue).length, given: count('given'),
      missed: count('missed'), refused: count('refused'), held: count('held'),
    };
  }
  if (see('contacts')) out.contacts = pick(all('contacts'), ['id', 'contact_type', 'name', 'relationship_or_specialty', 'phone', 'policy_number']);
  return out;
}

/** Which sections hold at least one entry: lets the UI hide empty sections without loading them. */
export function sectionCounts(actor: Actor, patientId: number): Record<string, number> {
  const access = requireRead(actor, patientId);
  const db = getDb();
  const out: Record<string, number> = {};
  for (const k of SECTION_KEYS) {
    if (!canSee(access, k)) continue;
    out[k] = (db.prepare(`SELECT COUNT(*) AS n FROM ${k} WHERE patient_id = ? AND record_status = 'active'`).get(patientId) as Row).n;
  }
  return out;
}
