import { localNow, localToday } from './config.js';
import { getDb, type Actor, type Row } from './db.js';
import { canSee, getAccess, listPatients } from './access.js';
import { ensureDoses, updateRecord } from './records.js';

/**
 * Care reminders: what needs doing right now, across every chart the person may write to.
 *
 * Two sources, no second schedule:
 *  - doses: scheduled doses on the medication administration record that are due and not yet recorded
 *  - checks: rows of the "reminders" record type ("check vital signs every 4 hours"), which run in fixed rounds
 *
 * Read-only viewers and physician guests get none: a reminder is a prompt to act.
 */

export interface DueReminder {
  /** Stable while the same thing stays due; changes when it comes due again. */
  key: string;
  kind: 'dose' | 'check';
  patient_id: number;
  patient_name: string;
  title: string;
  detail: string;
  due_at: string;
  overdue_minutes: number;
  /** Chart tab where it is dealt with. */
  tab: string;
  record_type: string;
  record_id: number;
}

/** Doses that came due longer ago than this are left to the Meds tab, which shows them as overdue. */
const DOSE_WINDOW_MINUTES = 12 * 60;

const toMs = (local: string) => new Date(local).getTime(); // "YYYY-MM-DDTHH:MM" is read as server-local time
const addMinutes = (local: string, minutes: number) => localNow(new Date(toMs(local) + minutes * 60_000));

/** Which entries satisfy a check: the table, its time column, and what counts as a real check. */
const SATISFIED_BY: Record<string, { table: string; time: string; where: string } | undefined> = {
  // A weight-only or glucose-only entry is not a round of observations.
  vital_signs: {
    table: 'vitals', time: 'recorded_at',
    where: `(temperature_c IS NOT NULL OR heart_rate_bpm IS NOT NULL OR respiratory_rate_per_min IS NOT NULL
      OR systolic_mmhg IS NOT NULL OR diastolic_mmhg IS NOT NULL OR spo2_percent IS NOT NULL OR pain_score IS NOT NULL)`,
  },
  intake_output: { table: 'intake_output', time: 'recorded_at', where: '1 = 1' },
};

/** A check done this close to a round counts for that round (never more than half the interval). */
export const roundToleranceMinutes = (intervalMinutes: number) => Math.min(60, Math.floor(intervalMinutes / 2));

/**
 * Checks happen in fixed rounds: start + 1 interval, start + 2 intervals, and so on
 * (start 14:00, every 240 minutes: 18:00, 22:00, 02:00...).
 * Returns the latest round that has arrived and has not been done, or null.
 * A check within the tolerance before a round counts for it; an extra check between rounds does not.
 */
export function nextDue(r: Row, patientId: number, now = localNow()): string | null {
  const interval = r.interval_minutes * 60_000;
  const k = Math.floor((toMs(now) - toMs(r.start_at)) / interval);
  if (k < 1) return null;
  const round = localNow(new Date(toMs(r.start_at) + k * interval));
  if (r.end_at && round > r.end_at) return null;
  const since = addMinutes(round, -roundToleranceMinutes(r.interval_minutes));
  if (r.last_done_at && r.last_done_at >= since) return null;
  const by = SATISFIED_BY[r.check_type];
  if (by) {
    const done = getDb().prepare(
      `SELECT 1 FROM ${by.table} WHERE patient_id = ? AND record_status = 'active' AND ${by.time} >= ? AND ${by.where} LIMIT 1`,
    ).get(patientId, since);
    if (done) return null;
  }
  return round;
}

export function dueReminders(actor: Actor): { now: string; reminders: DueReminder[] } {
  const db = getDb();
  const now = localNow();
  const out: DueReminder[] = [];
  if (actor.role === 'guest') return { now, reminders: out };
  const minutesLate = (due: string) => Math.max(0, Math.round((toMs(now) - toMs(due)) / 60_000));

  for (const p of listPatients(actor)) {
    const access = getAccess(actor, p.id);
    if (!access || access.level === 'viewer') continue;

    if (canSee(access, 'med_doses')) {
      ensureDoses(p.id, localToday(), localToday());
      const doses = db.prepare(
        `SELECT d.id, d.medication_name, d.scheduled_at, rx.dose_amount, rx.dose_unit, rx.instructions FROM med_doses d
         LEFT JOIN prescriptions rx ON rx.id = d.prescription_id
         WHERE d.patient_id = ? AND d.record_status = 'active' AND d.dose_status = 'due' AND d.scheduled_at <= ? AND d.scheduled_at >= ?
         ORDER BY d.scheduled_at, d.id`,
      ).all(p.id, now, addMinutes(now, -DOSE_WINDOW_MINUTES)) as Row[];
      for (const d of doses) {
        out.push({
          key: `dose-${d.id}`, kind: 'dose', patient_id: p.id, patient_name: p.full_name,
          title: `Give ${d.medication_name}`,
          detail: [d.dose_amount != null ? `${d.dose_amount} ${d.dose_unit || ''}`.trim() : '', d.instructions || ''].filter(Boolean).join(', '),
          due_at: d.scheduled_at, overdue_minutes: minutesLate(d.scheduled_at), tab: 'meds', record_type: 'med_doses', record_id: d.id,
        });
      }
    }

    if (canSee(access, 'reminders')) {
      const rows = db.prepare(
        `SELECT * FROM reminders WHERE patient_id = ? AND record_status = 'active' AND reminder_status = 'active' AND start_at <= ?`,
      ).all(p.id, now) as Row[];
      for (const r of rows) {
        const due = nextDue(r, p.id, now);
        if (!due) continue;
        out.push({
          key: `check-${r.id}-${due}`, kind: 'check', patient_id: p.id, patient_name: p.full_name,
          title: r.title, detail: r.notes || '',
          due_at: due, overdue_minutes: minutesLate(due), tab: 'vitals', record_type: 'reminders', record_id: r.id,
        });
      }
    }
  }
  out.sort((a, b) => a.due_at.localeCompare(b.due_at));
  return { now, reminders: out };
}

/** Mark a check reminder as done now; it comes due again at the next round. */
export function markReminderDone(actor: Actor, patientId: number, id: number): Row {
  return updateRecord(actor, patientId, 'reminders', id, { last_done_at: localNow() });
}
