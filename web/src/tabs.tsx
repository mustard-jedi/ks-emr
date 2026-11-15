import { Fragment, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, fieldLabel, fmtDateTime, pretty, shiftDay, toDisplay, today, unitLabel, uploadFile, type FieldDef, type Meta, type Patient, type Rec, type UnitSystem } from './api';
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
                      )) : <button className="btn small" onClick={() => setEditing({ dose: d })}>Edit&hellip;</button>}
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

export function VitalsTab(p: TabProps) {
  const { units, patient } = p;
  const def = typeOf(p.meta, 'vitals');
  const ioDef = typeOf(p.meta, 'intake_output');
  const [rows, setRows] = useState<Rec[]>([]);
  const [io, setIo] = useState<Rec[]>([]);
  const [measure, setMeasure] = useState('bp');
  const onVitals = useCallback((r: Rec[]) => setRows(r), []);
  const onIo = useCallback((r: Rec[]) => setIo(r), []);

  const numeric = def.fields.filter((f) => f.type === 'number' || (f.type === 'integer' && f.name === 'pain_score'));
  const available = numeric.filter((f) => !['systolic_mmhg', 'diastolic_mmhg'].includes(f.name) && rows.filter((r) => r[f.name] != null).length >= 1);
  const hasBp = rows.some((r) => r.systolic_mmhg != null);
  const selected = measure === 'bp' && !hasBp && available[0] ? available[0].name : measure;

  let series: Series[] = [];
  let unit = 'mmHg';
  if (selected === 'bp') {
    series = [
      { name: 'Systolic', points: rows.filter((r) => r.systolic_mmhg != null).map((r) => ({ x: r.recorded_at, y: r.systolic_mmhg })) },
      { name: 'Diastolic', points: rows.filter((r) => r.diastolic_mmhg != null).map((r) => ({ x: r.recorded_at, y: r.diastolic_mmhg })) },
    ];
  } else {
    const f = def.fields.find((x) => x.name === selected) as FieldDef | undefined;
    if (f) {
      unit = f.quantity ? unitLabel(f.quantity, units) : f.name === 'pain_score' ? '0-10' : f.name.endsWith('bpm') ? 'bpm' : f.name.endsWith('percent') ? '%' : '/min';
      series = [{ name: f.label, points: rows.filter((r) => r[f.name] != null).map((r) => ({ x: r.recorded_at, y: f.quantity ? toDisplay(f.quantity, r[f.name], units) : r[f.name] })) }];
    }
  }

  const day = today();
  const total = (dir: string) => io.filter((r) => r.direction === dir && r.recorded_at.startsWith(day)).reduce((n, r) => n + r.amount_ml, 0);

  return (
    <div className="sections">
      {canSee(patient, 'vitals') && (
        <RecordSection def={def} patient={patient} units={units} refreshKey={p.refreshKey} onChanged={p.onChanged} onLoaded={onVitals}>
          {rows.length > 0 && (
            <div className="trend">
              <label htmlFor="measure">Trend (also serves as the growth chart for weight and height): </label>
              <select id="measure" value={selected} onChange={(e) => setMeasure(e.target.value)}>
                {hasBp && <option value="bp">Blood pressure</option>}
                {available.map((f) => <option key={f.name} value={f.name}>{fieldLabel(f, units)}</option>)}
              </select>
              <TrendChart series={series} unit={unit} />
            </div>
          )}
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
