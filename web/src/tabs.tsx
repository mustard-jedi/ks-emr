import { Fragment, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, fieldLabel, fmtDateTime, pretty, shiftDay, toDisplay, today, unitLabel, uploadFile, type FieldDef, type Meta, type Patient, type Rec, type UnitSystem } from './api';
import { DEFAULT_SCHEDULE, isObservation, nextRound, ObservationChart, ObservationKey, outOfRange, whenLabel, type Schedule } from './observations';
import { canSee, canWrite, RecordForm, RecordSection, useLookups } from './records';
import { ErrorLine, TrendChart, useAction, useLoad, type Series } from './ui';

export interface TabProps { meta: Meta; patient: Patient; units: UnitSystem; refreshKey: number; onChanged: () => void; goTab: (key: string) => void }

const typeOf = (meta: Meta, key: string) => meta.record_types.find((t) => t.key === key)!;

/** Render the sections of a tab that are shared with this user. Empty ones collapse to chips at the bottom. */
function Sections({ keys, ...p }: TabProps & { keys: string[] }) {
  const visible = keys.filter((k) => canSee(p.patient, k));
  if (!visible.length) return <p className="muted">Nothing on this page is shared with you.</p>;
  return (
    <div className="sections">
      {visible.map((k) => (
        <RecordSection key={k} def={typeOf(p.meta, k)} patient={p.patient} units={p.units} refreshKey={p.refreshKey} onChanged={p.onChanged}
          layout={k === 'notes' ? 'notes' : 'table'} />
      ))}
    </div>
  );
}

// ---- Face Sheet ------------------------------------------------------------

function Box({ title, tone, children, onOpen }: { title: string; tone?: 'alert'; children: ReactNode; onOpen?: () => void }) {
  return (
    <fieldset className={`box${tone ? ` ${tone}` : ''}`}>
      <legend>{onOpen ? <button className="link" onClick={onOpen}>{title}</button> : title}</legend>
      {children}
    </fieldset>
  );
}
const None = ({ text = 'None recorded' }: { text?: string }) => <p className="muted">{text}</p>;

const VITAL_LABELS: Record<string, [label: string, unit: string, q?: 'weight' | 'length' | 'temperature' | 'glucose']> = {
  heart_rate_bpm: ['Pulse', 'bpm'], respiratory_rate_per_min: ['Resp', '/min'], temperature_c: ['Temp', '', 'temperature'],
  spo2_percent: ['SpO2', '%'], weight_kg: ['Weight', '', 'weight'], height_cm: ['Height', '', 'length'],
  blood_glucose_mg_dl: ['Glucose', '', 'glucose'], pain_score: ['Pain', '/10'],
};

export function FaceSheet(p: TabProps) {
  const { patient, units } = p;
  const { data: s, error } = useLoad(() => api<Rec>('GET', `/patients/${patient.id}/summary`), [patient.id, p.refreshKey]);
  if (error) return <ErrorLine error={error} />;
  if (!s) return <p className="muted">Loading&hellip;</p>;

  const vitals: Rec[] = s.latest_vitals || [];
  const v = (m: string) => vitals.find((x) => x.measure === m);
  const sys = v('systolic_mmhg'), dia = v('diastolic_mmhg');
  const dose = (m: Rec) => [m.dose_amount, m.dose_unit, m.frequency && pretty(m.frequency).toLowerCase(), m.schedule_times && `at ${m.schedule_times.replace(/,/g, ', ')}`]
    .filter(Boolean).join(' ');

  return (
    <div className="facesheet">
      <div className="face-actions no-print">
        <span className="muted">One-page summary. Generated {s.generated_on}.</span>
        <button className="btn small" onClick={() => window.print()}>Print</button>
      </div>
      {s.hidden_sections.length > 0 && (
        <p className="notice">Only part of this chart is shared with you. Not shown: {s.hidden_sections.map(pretty).join(', ')}.</p>
      )}
      <div className="boxes">
        {(s.allergies || patient.important_notes) && (
          <Box title="Alerts & Allergies" tone="alert" onOpen={s.allergies ? () => p.goTab('history') : undefined}>
            {patient.important_notes && <p className="important">{patient.important_notes}</p>}
            {s.allergies && (s.allergies.length ? (
              <ul>{s.allergies.map((a: Rec) => (
                <li key={a.id}><strong>{a.substance}</strong>{a.reaction ? `: ${a.reaction}` : ''}{a.severity ? ` (${pretty(a.severity).toLowerCase()})` : ''}</li>
              ))}</ul>
            ) : <None text="No known allergies recorded" />)}
          </Box>
        )}
        {s.conditions && (
          <Box title="Existing Conditions" onOpen={() => p.goTab('history')}>
            {s.conditions.length ? <ul>{s.conditions.map((c: Rec) => <li key={c.id}>{c.name}{c.onset_date ? ` (since ${c.onset_date.slice(0, 4)})` : ''}</li>)}</ul> : <None />}
          </Box>
        )}
        {s.current_medications && (
          <Box title="Current Medications" onOpen={() => p.goTab('meds')}>
            {s.current_medications.length ? (
              <ul>{s.current_medications.map((m: Rec) => (
                <li key={m.id}><strong>{m.medication_name}</strong>{dose(m) ? `, ${dose(m)}` : ''}{m.indication ? ` (for ${m.indication})` : ''}</li>
              ))}</ul>
            ) : <None text="No current medications" />}
            {s.doses_today && (s.doses_today.due + s.doses_today.given + s.doses_today.missed + s.doses_today.refused + s.doses_today.held > 0) && (
              <p className={s.doses_today.overdue ? 'warn' : 'muted'}>
                Today: {s.doses_today.given} given, {s.doses_today.due} still due{s.doses_today.overdue ? ` (${s.doses_today.overdue} overdue)` : ''}
                {s.doses_today.missed + s.doses_today.refused ? `, ${s.doses_today.missed + s.doses_today.refused} missed or refused` : ''}.
              </p>
            )}
          </Box>
        )}
        {s.latest_vitals && (
          <Box title="Latest Vital Signs" onOpen={() => p.goTab('vitals')}>
            {vitals.length ? (
              <dl className="kv">
                {(sys || dia) && <><dt>Blood pressure</dt><dd>{sys?.value ?? '?'}/{dia?.value ?? '?'} mmHg <small>{fmtDateTime((sys || dia)!.recorded_at)}</small></dd></>}
                {Object.entries(VITAL_LABELS).map(([k, [label, unit, q]]) => {
                  const x = v(k);
                  if (!x) return null;
                  return <Fragment key={k}><dt>{label}</dt><dd>{q ? `${toDisplay(q, x.value, units)} ${unitLabel(q, units)}` : `${x.value} ${unit}`} <small>{fmtDateTime(x.recorded_at)}</small></dd></Fragment>;
                })}
              </dl>
            ) : <None />}
          </Box>
        )}
        {s.hidden_sections.includes('visits') ? null : (
          <Box title="Visits" onOpen={() => p.goTab('visits')}>
            <dl className="kv">
              <dt>Last visit</dt>
              <dd>{s.last_visit ? `${s.last_visit.visit_date}, ${pretty(s.last_visit.visit_type).toLowerCase()}${s.last_visit.provider_name ? ` with ${s.last_visit.provider_name}` : ''}${s.last_visit.reason ? `: ${s.last_visit.reason}` : ''}` : 'None recorded'}</dd>
              <dt>Next follow-up</dt>
              <dd>{s.next_follow_up_date || 'None scheduled'}</dd>
            </dl>
          </Box>
        )}
        {s.family_history && (
          <Box title="Family History" onOpen={() => p.goTab('history')}>
            {s.family_history.length ? <ul>{s.family_history.map((f: Rec) => (
              <li key={f.id}>{pretty(f.relation)}: {f.condition}{f.age_at_onset != null ? ` (age ${f.age_at_onset})` : ''}</li>
            ))}</ul> : <None />}
          </Box>
        )}
        {s.abnormal_labs?.length > 0 && (
          <Box title="Out-of-Range Lab Results" onOpen={() => p.goTab('labs')}>
            <ul>{s.abnormal_labs.map((l: Rec) => (
              <li key={l.id}><strong>{l.test_name}</strong>: {l.value_number ?? l.value_text} {l.unit || ''} <span className={`flag ${l.flag}`}>{pretty(l.flag)}</span> <small>{l.collected_date}</small></li>
            ))}</ul>
          </Box>
        )}
        {s.immunizations_due?.length > 0 && (
          <Box title="Immunizations Due" onOpen={() => p.goTab('history')}>
            <ul>{s.immunizations_due.map((i: Rec) => <li key={i.id}>{i.vaccine}: due {i.next_due_date}</li>)}</ul>
          </Box>
        )}
        {s.past_procedures?.length > 0 && (
          <Box title="Procedures & Surgeries" onOpen={() => p.goTab('history')}>
            <ul>{s.past_procedures.map((x: Rec) => <li key={x.id}>{x.name}{x.procedure_date ? ` (${x.procedure_date.slice(0, 4)})` : ''}</li>)}</ul>
          </Box>
        )}
      </div>
      <Sections {...p} keys={['contacts']} />
    </div>
  );
}

// ---- Meds: medication administration record + prescriptions -----------------

const DOSE_ACTIONS = ['given', 'missed', 'refused', 'held'] as const;

function Mar(p: TabProps) {
  const { patient, units } = p;
  const def = typeOf(p.meta, 'med_doses');
  const [date, setDate] = useState(today());
  const [editing, setEditing] = useState<{ dose: Rec; status?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const lookups = useLookups(def, patient, p.refreshKey);
  const { data, error } = useLoad(() => api<Rec>('GET', `/patients/${patient.id}/mar?date=${date}`), [patient.id, date, p.refreshKey]);
  const act = useAction();
  const writable = canWrite(patient);
  const doseFields = useMemo(() => def.fields.filter((f) => ['dose_status', 'given_at', 'given_by', 'remarks'].includes(f.name)), [def]);
  const doses: Rec[] = data?.doses || [];

  return (
    <section className="section">
      <div className="section-head">
        <h3>Medication Administration Record</h3>
        {writable && <button className="btn small" onClick={() => setAdding(true)}>+ Unscheduled dose</button>}
      </div>
      <div className="daynav">
        <button className="btn small" onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day">&#9664;</button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
        <button className="btn small" onClick={() => setDate(shiftDay(date, 1))} aria-label="Next day">&#9654;</button>
        {date !== today() && <button className="btn small" onClick={() => setDate(today())}>Today</button>}
      </div>
      <ErrorLine error={error || act.error} />
      {data && !doses.length && <p className="muted">No doses scheduled for this day. Add a prescription with a schedule below, or record an unscheduled dose.</p>}
      {doses.length > 0 && (
        <div className="table-wrap">
          <table className="grid mar">
            <thead><tr><th>Time</th><th>Medication</th><th>Status</th><th>Remarks</th>{writable && <th>Record</th>}</tr></thead>
            <tbody>
              {doses.map((d) => (
                <tr key={d.id} className={d.is_overdue ? 'overdue' : ''} onClick={() => setEditing({ dose: d })} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setEditing({ dose: d }); }}>
                  <td data-label="Time">{d.scheduled_at.slice(11)}</td>
                  <td data-label="Medication"><strong>{d.medication_name}</strong>{d.dose_amount ? ` ${d.dose_amount} ${d.dose_unit || ''}` : ''}{d.instructions ? <small> {d.instructions}</small> : null}</td>
                  <td data-label="Status">
                    <span className={`status ${d.dose_status}`}>{d.is_overdue ? 'Overdue' : pretty(d.dose_status)}</span>
                    {d.dose_status === 'given' && <small> {fmtDateTime(d.given_at).slice(11)} by {d.given_by}</small>}
                  </td>
                  <td data-label="Remarks">{d.remarks}</td>
                  {writable && (
                    <td data-label="Record" className="actions" onClick={(e) => e.stopPropagation()}>
                      {d.dose_status === 'due' ? DOSE_ACTIONS.map((a) => (
                        <button key={a} className={`btn small${a === 'given' ? ' default' : ''}`} disabled={act.busy}
                          onClick={() => (a === 'given'
                            ? act.run(async () => { await api('PATCH', `/patients/${patient.id}/med_doses/${d.id}`, { dose_status: 'given' }); p.onChanged(); })
                            : setEditing({ dose: d, status: a }))}>
                          {pretty(a)}
                        </button>
                      )) : (
                        <>
                          <button className="btn small" disabled={act.busy} title={d.prescription_id ? 'Put this dose back to Due' : 'Remove this dose (it is kept, struck out, in the record)'}
                            onClick={() => act.run(async () => {
                              // A scheduled dose goes back to Due; a one-off dose has no schedule to return to, so it is struck out.
                              if (d.prescription_id) await api('PATCH', `/patients/${patient.id}/med_doses/${d.id}`, { dose_status: 'due' });
                              else await api('POST', `/patients/${patient.id}/med_doses/${d.id}/entered-in-error`, { reason: 'Recorded by mistake (undone)' });
                              p.onChanged();
                            })}>
                            Undo
                          </button>
                          <button className="btn small" onClick={() => setEditing({ dose: d })}>Edit&hellip;</button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <RecordForm title={`${editing.dose.medication_name}, ${editing.dose.scheduled_at.replace('T', ' ')}`} fields={doseFields} units={units}
          record={editing.dose} presets={editing.status ? { dose_status: editing.status } : undefined} readOnly={!writable}
          submitLabel="Record" onClose={() => setEditing(null)}
          onSubmit={async (payload) => {
            if (Object.keys(payload).length) await api('PATCH', `/patients/${patient.id}/med_doses/${editing.dose.id}`, payload);
            p.onChanged();
          }} />
      )}
      {adding && (
        <RecordForm title="Record an unscheduled dose" fields={def.fields} units={units} lookups={lookups} presets={{ scheduled_at: `${date}T${new Date().toTimeString().slice(0, 5)}` }}
          onClose={() => setAdding(false)}
          onSubmit={async (payload) => { await api('POST', `/patients/${patient.id}/med_doses`, payload); p.onChanged(); }} />
      )}
    </section>
  );
}

export function MedsTab(p: TabProps) {
  return (
    <>
      {canSee(p.patient, 'med_doses') && <Mar {...p} />}
      <Sections {...p} keys={['prescriptions']} />
    </>
  );
}

// ---- Vitals ----------------------------------------------------------------

const OBS_NAMES = ['recorded_at', 'temperature_c', 'heart_rate_bpm', 'respiratory_rate_per_min', 'systolic_mmhg', 'diastolic_mmhg', 'spo2_percent', 'pain_score', 'notes'];
const BODY_NAMES = ['recorded_at', 'weight_kg', 'height_cm', 'head_circumference_cm', 'notes'];
const GLUCOSE_NAMES = ['recorded_at', 'blood_glucose_mg_dl', 'glucose_context', 'notes'];
const hasAny = (names: string[]) => (r: Rec) => names.some((n) => n !== 'recorded_at' && n !== 'notes' && r[n] != null);
const isBody = hasAny(BODY_NAMES);
const isGlucose = hasAny(GLUCOSE_NAMES);
const localStamp = (t: number) => { const d = new Date(t); return `${d.toLocaleDateString('sv-SE')}T${d.toTimeString().slice(0, 5)}`; };
const everyLabel = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`);

/**
 * Vitals are one record type ("vitals") shown as three logs, because they are taken on different rhythms:
 * observations (T, P, R, BP, SpO2, pain) every few hours, weight and height now and then, glucose around meals.
 */
export function VitalsTab(p: TabProps) {
  const { units, patient } = p;
  const def = typeOf(p.meta, 'vitals');
  const ioDef = typeOf(p.meta, 'intake_output');
  const [obs, setObs] = useState<Rec[]>([]);
  const [body, setBody] = useState<Rec[]>([]);
  const [glucose, setGlucose] = useState<Rec[]>([]);
  const [io, setIo] = useState<Rec[]>([]);
  const [days, setDays] = useState(2);
  const [picked, setPicked] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [bodyMeasure, setBodyMeasure] = useState('weight_kg');
  const onIo = useCallback((r: Rec[]) => setIo(r), []);
  const clearEdit = useCallback(() => setEditId(null), []);
  const act = useAction();

  const sub = useCallback((names: string[], label: string, singular: string) => ({
    ...def, label, singular, columns: names,
    fields: names.map((n) => def.fields.find((f) => f.name === n)!).map((f) => (f.name === 'notes' ? { ...f, label: 'Remarks' } : f)),
  }), [def]);
  const obsDef = useMemo(() => sub(OBS_NAMES, 'Observations', 'Observation'), [sub]);
  const bodyDef = useMemo(() => sub(BODY_NAMES, 'Weight & Height', 'Weight or height entry'), [sub]);
  const glucoseDef = useMemo(() => sub(GLUCOSE_NAMES, 'Blood Glucose', 'Glucose reading'), [sub]);

  // The rounds come from the first active "vital signs" monitoring reminder; without one, every 4 hours on the clock.
  const seeReminders = canSee(patient, 'reminders');
  const reminders = useLoad(() => (seeReminders ? api<Rec[]>('GET', `/patients/${patient.id}/reminders`) : Promise.resolve([] as Rec[])), [patient.id, seeReminders, p.refreshKey]);
  const schedule: Schedule = useMemo(() => {
    const r = (reminders.data || []).filter((x) => x.record_status === 'active' && x.reminder_status === 'active' && x.check_type === 'vital_signs')
      .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
    return r ? { intervalMinutes: r.interval_minutes, anchor: r.start_at, fromReminder: true } : DEFAULT_SCHEDULE;
  }, [reminders.data]);

  const latest = obs[0];
  const selected = obs.find((r) => r.id === picked) || latest;
  const flag = (field: string, r: Rec, text: string) => (outOfRange(field, r[field], patient) ? <strong className="oor">{text}</strong> : text);
  const temp = (r: Rec) => `${toDisplay('temperature', r.temperature_c, units)} ${unitLabel('temperature', units)}`;

  const remindMe = () => act.run(async () => {
    const start = nextRound(Date.now(), DEFAULT_SCHEDULE) - DEFAULT_SCHEDULE.intervalMinutes * 60_000;
    await api('POST', `/patients/${patient.id}/reminders`, { title: 'Check vital signs', check_type: 'vital_signs', interval_minutes: DEFAULT_SCHEDULE.intervalMinutes, start_at: localStamp(start) });
    p.onChanged();
  });

  const bodyField = bodyDef.fields.find((f) => f.name === bodyMeasure)!;
  const bodyPoints = body.filter((r) => r[bodyMeasure] != null).map((r) => ({ x: r.recorded_at, y: toDisplay(bodyField.quantity!, r[bodyMeasure], units) }));
  const glucosePoints = glucose.filter((r) => r.blood_glucose_mg_dl != null).map((r) => ({ x: r.recorded_at, y: toDisplay('glucose', r.blood_glucose_mg_dl, units) }));
  const day = today();
  const total = (dir: string) => io.filter((r) => r.direction === dir && r.recorded_at.startsWith(day)).reduce((n, r) => n + r.amount_ml, 0);

  return (
    <div className="sections">
      {canSee(patient, 'vitals') && (
        <RecordSection def={obsDef} patient={patient} units={units} refreshKey={p.refreshKey} onChanged={p.onChanged} onLoaded={setObs} filter={isObservation}
          editId={editId} onEditHandled={clearEdit} rowClass={(r) => (selected && r.id === selected.id ? 'picked' : '')}
          renderCell={(f, r) => (r[f.name] != null && outOfRange(f.name, r[f.name], patient)
            ? <strong className="oor">{f.name === 'temperature_c' ? toDisplay('temperature', r[f.name], units) : r[f.name]}</strong> : undefined)}>
          {obs.length > 0 && (
            <div className="obs-wrap">
              <div className="obs-controls">
                <ObservationKey />
                <label>Show{' '}
                  <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    <option value={1}>Last 24 hours</option><option value={2}>Last 2 days</option><option value={7}>Last 7 days</option>
                  </select>
                </label>
              </div>
              {selected && (
                <p className="obs-readout">
                  <strong>{whenLabel(new Date(selected.recorded_at).getTime())}</strong>
                  {selected.temperature_c != null && <span>Temp {flag('temperature_c', selected, temp(selected))}</span>}
                  {selected.heart_rate_bpm != null && <span>Pulse {flag('heart_rate_bpm', selected, String(selected.heart_rate_bpm))}</span>}
                  {selected.respiratory_rate_per_min != null && <span>Resp {flag('respiratory_rate_per_min', selected, String(selected.respiratory_rate_per_min))}</span>}
                  {(selected.systolic_mmhg != null || selected.diastolic_mmhg != null) && (
                    <span>BP {flag('systolic_mmhg', selected, String(selected.systolic_mmhg ?? '?'))}/{flag('diastolic_mmhg', selected, String(selected.diastolic_mmhg ?? '?'))}</span>
                  )}
                  {selected.spo2_percent != null && <span>SpO2 {flag('spo2_percent', selected, `${selected.spo2_percent} %`)}</span>}
                  {selected.pain_score != null && <span>Pain {selected.pain_score}</span>}
                  <small>{selected.created_by_name ? `Recorded by ${selected.created_by_name}` : ''}{selected.notes ? ` · ${selected.notes}` : ''}</small>
                  <button className="btn small" onClick={() => setEditId(selected.id)}>{canWrite(patient) ? 'Edit' : 'Open'}&hellip;</button>
                </p>
              )}
              <ObservationChart rows={obs} schedule={schedule} units={units} days={days} selectedId={selected?.id ?? null} onSelect={setPicked} />
              <p className="muted">
                The scales line up as on a paper chart: pulse 60, blood pressure 110 and {toDisplay('temperature', 37, units)} {unitLabel('temperature', units)} share the heavy line.
                A check within an hour of a round sits in that round's column; an extra check is plotted at its own time. A value that was not taken is left out.
              </p>
              <p className="obs-rounds">
                {schedule.fromReminder
                  ? <>Rounds every <strong>{everyLabel(schedule.intervalMinutes)}</strong> &middot; next due <strong>{whenLabel(nextRound(Date.now(), schedule))}</strong>. Change it under Monitoring Reminders below.</>
                  : <>Columns show a round every 4 hours (02, 06, 10, 14, 18, 22).</>}
                {!schedule.fromReminder && seeReminders && canWrite(patient) && (
                  <button className="btn small" disabled={act.busy} onClick={() => void remindMe()}>Remind me every 4 hours</button>
                )}
              </p>
              <ErrorLine error={act.error} />
            </div>
          )}
        </RecordSection>
      )}
      {seeReminders && (
        <RecordSection def={typeOf(p.meta, 'reminders')} patient={patient} units={units} refreshKey={p.refreshKey} onChanged={p.onChanged}>
          <p className="muted">While KS EMR is open, whoever looks after this chart is reminded when a round is due. A "vital signs" reminder also sets the columns of the observation chart. Dose reminders come from the prescriptions and need no entry here.</p>
        </RecordSection>
      )}
      {canSee(patient, 'vitals') && (
        <RecordSection def={bodyDef} patient={patient} units={units} refreshKey={p.refreshKey} onChanged={p.onChanged} onLoaded={setBody} filter={isBody}>
          {body.length > 0 && (
            <div className="trend">
              <label htmlFor="body-measure">Trend (also the growth chart for children): </label>
              <select id="body-measure" value={bodyMeasure} onChange={(e) => setBodyMeasure(e.target.value)}>
                {bodyDef.fields.filter((f) => f.quantity && body.some((r) => r[f.name] != null)).map((f) => <option key={f.name} value={f.name}>{fieldLabel(f, units)}</option>)}
              </select>
              <TrendChart series={[{ name: bodyField.label, points: bodyPoints }]} unit={unitLabel(bodyField.quantity!, units)} />
            </div>
          )}
        </RecordSection>
      )}
      {canSee(patient, 'vitals') && (
        <RecordSection def={glucoseDef} patient={patient} units={units} refreshKey={p.refreshKey} onChanged={p.onChanged} onLoaded={setGlucose} filter={isGlucose}>
          {glucose.length > 0 && <div className="trend"><TrendChart series={[{ name: 'Glucose', points: glucosePoints }]} unit={unitLabel('glucose', units)} /></div>}
        </RecordSection>
      )}
      {canSee(patient, 'intake_output') && (
        <RecordSection def={ioDef} patient={patient} units={units} refreshKey={p.refreshKey} onChanged={p.onChanged} onLoaded={onIo}>
          <p className="totals">Today: intake <strong>{total('intake')} ml</strong>, output <strong>{total('output')} ml</strong>, balance <strong>{total('intake') - total('output')} ml</strong></p>
        </RecordSection>
      )}
    </div>
  );
}

// ---- Labs ------------------------------------------------------------------

export function LabsTab(p: TabProps) {
  const { patient, units } = p;
  const def = typeOf(p.meta, 'lab_results');
  const [rows, setRows] = useState<Rec[]>([]);
  const [test, setTest] = useState('');
  const onLoaded = useCallback((r: Rec[]) => setRows(r), []);
  const trendable = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.value_number != null) counts.set(r.test_name, (counts.get(r.test_name) || 0) + 1);
    return [...counts.entries()].filter(([, n]) => n >= 2).map(([name]) => name).sort();
  }, [rows]);
  const chosen = trendable.includes(test) ? test : trendable[0];
  const points = rows.filter((r) => r.test_name === chosen && r.value_number != null);
  const latest = points[0];

  if (!canSee(patient, 'lab_results')) return <p className="muted">Lab results are not shared with you.</p>;
  return (
    <div className="sections">
      <RecordSection def={def} patient={patient} units={units} refreshKey={p.refreshKey} onChanged={p.onChanged} onLoaded={onLoaded}
        rowClass={(r) => (r.flag && r.flag !== 'normal' ? 'abnormal' : '')}
        renderCell={(f, r) => {
          if (f.name === 'flag' && r.flag) return <span className={`flag ${r.flag}`}>{pretty(r.flag)}</span>;
          if (f.name === 'test_name' && r.document_id && canSee(patient, 'documents')) {
            return <>{r.test_name} <a className="doc-link" href={`/api/patients/${patient.id}/documents/${r.document_id}/file`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>[report]</a></>;
          }
          return undefined;
        }}>
        {trendable.length > 0 && (
          <div className="trend">
            <label htmlFor="labtest">Trend: </label>
            <select id="labtest" value={chosen} onChange={(e) => setTest(e.target.value)}>
              {trendable.map((t) => <option key={t}>{t}</option>)}
            </select>
            <TrendChart series={[{ name: chosen, points: points.map((r) => ({ x: r.collected_date, y: r.value_number })) }]} unit={latest?.unit || ''}
              low={latest?.reference_low} high={latest?.reference_high} />
          </div>
        )}
      </RecordSection>
    </div>
  );
}

// ---- Visits & Documents ----------------------------------------------------

function FileCell({ patient, doc, onChanged }: { patient: Patient; doc: Rec; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const act = useAction();
  const url = `/patients/${patient.id}/documents/${doc.id}/file`;
  return (
    <span className="filecell" onClick={(e) => e.stopPropagation()}>
      {doc.file_name && <a href={`/api${url}`} target="_blank" rel="noreferrer" title={doc.file_name}>View</a>}
      {canWrite(patient) && doc.record_status === 'active' && (
        <>
          <button className="btn small" disabled={act.busy} onClick={() => input.current?.click()}>{act.busy ? 'Uploading…' : doc.file_name ? 'Replace' : 'Attach file'}</button>
          <input ref={input} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void act.run(async () => { await uploadFile(url, file); onChanged(); });
            }} />
        </>
      )}
      {!doc.file_name && !canWrite(patient) && <span className="muted">No file</span>}
      {act.error && <small className="error"> {act.error}</small>}
    </span>
  );
}

export function VisitsTab(p: TabProps) {
  const { patient, units } = p;
  return (
    <div className="sections">
      {canSee(patient, 'visits') && (
        <RecordSection def={typeOf(p.meta, 'visits')} patient={patient} units={units} refreshKey={p.refreshKey} onChanged={p.onChanged} />
      )}
      {canSee(patient, 'documents') && (
        <RecordSection def={{ ...typeOf(p.meta, 'documents'), columns: ['doc_date', 'doc_type', 'title', 'notes'] }} patient={patient} units={units}
          refreshKey={p.refreshKey} onChanged={p.onChanged}
          renderCell={(f, r) => (f.name === 'title' ? <>{r.title} <FileCell patient={patient} doc={r} onChanged={p.onChanged} /></> : undefined)}>
          <p className="muted">Add the document entry first, then attach a PDF or photo (up to 25 MB) to it.</p>
        </RecordSection>
      )}
    </div>
  );
}

export function HistoryTab(p: TabProps) {
  return <Sections {...p} keys={['allergies', 'conditions', 'family_history', 'procedures', 'immunizations']} />;
}
export function NotesTab(p: TabProps) {
  return <Sections {...p} keys={['notes']} />;
}
