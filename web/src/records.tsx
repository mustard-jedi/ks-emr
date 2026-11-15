import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, fieldLabel, fmt, fmtDateTime, fromDisplay, pretty, toDisplay, today, type FieldDef, type Patient, type Rec, type RecordTypeDef, type UnitSystem } from './api';
import { Dialog, ErrorLine, useAction, useLoad } from './ui';

export interface Lookup { value: number; label: string }
export type Lookups = Record<string, Lookup[]>;

export const canSee = (p: Patient, key: string) => p.shared_sections === 'all' || p.shared_sections.split(',').includes(key);
export const canWrite = (p: Patient) => p.access_level !== 'viewer';

const nowLocal = () => {
  const d = new Date();
  return `${d.toLocaleDateString('sv-SE')}T${d.toTimeString().slice(0, 5)}`;
};

/** Stored value -> the string an input shows. */
function toInput(f: FieldDef, v: unknown, units: UnitSystem): string {
  if (v === null || v === undefined) return '';
  if (f.type === 'boolean') return v ? 'true' : 'false';
  if (f.quantity) return String(toDisplay(f.quantity, Number(v), units));
  return String(v);
}

/** Input string -> value for the API. Empty means "clear". */
function fromInput(f: FieldDef, s: string, units: UnitSystem): unknown {
  if (s.trim() === '') return null;
  if (f.type === 'boolean') return s === 'true';
  if (f.type === 'number' || f.type === 'integer') {
    const n = Number(s);
    return f.quantity && Number.isFinite(n) ? fromDisplay(f.quantity, n, units) : n;
  }
  return s;
}

function initialValues(fields: FieldDef[], rec: Rec | undefined, units: UnitSystem): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (rec) out[f.name] = toInput(f, rec[f.name], units);
    else if (f.default === 'now') out[f.name] = nowLocal();
    else if (f.default === 'today') out[f.name] = today();
    else out[f.name] = f.default !== undefined ? String(f.default) : '';
  }
  // A new entry starts with the suggestion that goes with another field's value (e.g. dose times for a frequency).
  if (!rec) for (const f of fields) if (f.suggestFrom && !out[f.name]) out[f.name] = f.suggestFrom.map[out[f.suggestFrom.field]] ?? '';
  return out;
}

/**
 * Form generated from field definitions. Used for every chart page and for the patient details.
 * `record` set = amend (sends only changed fields); unset = new entry.
 */
export function RecordForm(props: {
  title: string; fields: FieldDef[]; record?: Rec; presets?: Rec; units: UnitSystem; lookups?: Lookups; readOnly?: boolean;
  onSubmit: (payload: Rec) => Promise<unknown>; onClose: () => void; footer?: ReactNode; submitLabel?: string;
}) {
  const { fields, record, units, lookups = {}, readOnly } = props;
  const writable = useMemo(() => fields.filter((f) => !f.readOnly), [fields]);
  const start = useMemo(() => ({ ...initialValues(writable, record, units), ...Object.fromEntries(Object.entries(props.presets || {}).map(([k, v]) => [k, String(v)])) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record, writable, units]);
  const [values, setValues] = useState(start);
  const act = useAction();
  const set = (name: string, v: string) => setValues((old) => {
    const next = { ...old, [name]: v };
    // Fields suggested from this one follow it, unless someone has typed their own value there.
    for (const f of writable) {
      const s = f.suggestFrom;
      if (s && s.field === name && (!old[f.name] || old[f.name] === s.map[old[name]])) next[f.name] = s.map[v] ?? '';
    }
    return next;
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Rec = {};
    const base = record ? initialValues(writable, record, units) : {};
    for (const f of writable) {
      const s = values[f.name] ?? '';
      if (record ? s !== base[f.name] : s.trim() !== '') payload[f.name] = fromInput(f, s, units);
    }
    void act.run(async () => { await props.onSubmit(payload); props.onClose(); });
  };

  const input = (f: FieldDef) => {
    const common = { id: `f-${f.name}`, value: values[f.name] ?? '', disabled: readOnly, required: !!f.required && f.default === undefined,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(f.name, e.target.value) };
    if (lookups[f.name]) {
      return (
        <select {...common}>
          <option value="">(none)</option>
          {lookups[f.name].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    switch (f.type) {
      case 'enum': return (
        <select {...common}>
          {!(f.required && f.default !== undefined) && <option value="">(not set)</option>}
          {f.values!.map((v) => <option key={v} value={v}>{pretty(v)}</option>)}
        </select>
      );
      case 'boolean': return (
        <select {...common}><option value="">(not set)</option><option value="true">Yes</option><option value="false">No</option></select>
      );
      case 'text': return <textarea {...common} rows={4} />;
      case 'date': return <input {...common} type="date" />;
      case 'datetime': return <input {...common} type="datetime-local" />;
      case 'number': case 'integer':
        return <input {...common} type="number" inputMode="decimal" step={f.type === 'integer' ? 1 : 'any'} />;
      default: return <input {...common} type="text" maxLength={500} />;
    }
  };

  return (
    <Dialog title={props.title} onClose={props.onClose}>
      <form onSubmit={submit} className="form">
        {writable.map((f) => (
          <div className={`field${f.type === 'text' ? ' full' : ''}`} key={f.name}>
            <label htmlFor={`f-${f.name}`} title={f.description}>{fieldLabel(f, units)}{f.required ? ' *' : ''}</label>
            {input(f)}
          </div>
        ))}
        <ErrorLine error={act.error} />
        <div className="buttons full">
          {!readOnly && <button type="submit" className="btn default" disabled={act.busy}>{props.submitLabel || (record ? 'Save changes' : 'Add')}</button>}
          <button type="button" className="btn" onClick={props.onClose}>{readOnly ? 'Close' : 'Cancel'}</button>
        </div>
        {props.footer}
      </form>
    </Dialog>
  );
}

/** Open an existing entry: amend it, or strike it out as "entered in error" (entries are never deleted). */
function EditEntry({ def, patient, record, units, lookups, onDone, onClose }: {
  def: RecordTypeDef; patient: Patient; record: Rec; units: UnitSystem; lookups: Lookups; onDone: () => void; onClose: () => void;
}) {
  const [striking, setStriking] = useState(false);
  const [reason, setReason] = useState('');
  const act = useAction();
  const base = `/patients/${patient.id}/${def.key}/${record.id}`;
  const struck = record.record_status !== 'active';
  const editable = canWrite(patient) && !struck;
  return (
    <RecordForm
      title={`${def.singular}${struck ? ' (entered in error)' : ''}`} fields={def.fields} record={record} units={units} lookups={lookups}
      readOnly={!editable} onClose={onClose}
      onSubmit={async (payload) => { if (Object.keys(payload).length) await api('PATCH', base, payload); onDone(); }}
      footer={(
        <div className="full entry-meta">
          <p className="muted">
            Entry #{record.id}, recorded by {record.created_by_name || 'unknown'} on {fmtDateTime(record.created_at)} UTC
            {record.updated_at !== record.created_at ? `, amended ${fmtDateTime(record.updated_at)} UTC` : ''}.
            {struck ? ` Struck out: ${record.error_reason}` : ''}
          </p>
          {editable && !striking && <button type="button" className="btn small" onClick={() => setStriking(true)}>Entered in error&hellip;</button>}
          {striking && (
            <div className="strike-box">
              <label htmlFor="strike-reason">Why is this entry wrong? It will be struck out, not deleted.</label>
              <input id="strike-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong person" />
              <ErrorLine error={act.error} />
              <button type="button" className="btn small" disabled={act.busy || !reason.trim()}
                onClick={() => act.run(async () => { await api('POST', `${base}/entered-in-error`, { reason }); onDone(); onClose(); })}>
                Strike out entry
              </button>
            </div>
          )}
        </div>
      )}
    />
  );
}

/** Dropdown choices for fields that point at other entries in the same chart. */
export function useLookups(def: RecordTypeDef, patient: Patient, refreshKey: number): Lookups {
  const needRx = def.fields.some((f) => f.name === 'prescription_id') && canSee(patient, 'prescriptions');
  const needDoc = def.fields.some((f) => f.name === 'document_id') && canSee(patient, 'documents');
  const [lookups, setLookups] = useState<Lookups>({});
  useEffect(() => {
    let live = true;
    (async () => {
      const out: Lookups = {};
      if (needRx) out.prescription_id = (await api<Rec[]>('GET', `/patients/${patient.id}/prescriptions`)).map((r) => ({ value: r.id, label: r.medication_name }));
      if (needDoc) out.document_id = (await api<Rec[]>('GET', `/patients/${patient.id}/documents`)).map((r) => ({ value: r.id, label: `${r.doc_date} ${r.title}` }));
      if (live) setLookups(out);
    })().catch(() => undefined);
    return () => { live = false; };
  }, [needRx, needDoc, patient.id, refreshKey]);
  return lookups;
}

/**
 * One chart section (e.g. Allergies): heading, list, add and amend.
 * When the section is empty it shrinks to a single "+ Add" chip so the page is not cluttered.
 */
export function RecordSection(props: {
  def: RecordTypeDef; patient: Patient; units: UnitSystem; refreshKey: number; onChanged: () => void;
  layout?: 'table' | 'notes'; onLoaded?: (rows: Rec[]) => void; children?: ReactNode;
  renderCell?: (f: FieldDef, r: Rec) => ReactNode | undefined; rowClass?: (r: Rec) => string;
  /** Show only some of the type's entries (e.g. the vitals entries that hold a weight). */
  filter?: (r: Rec) => boolean;
  /** Open this entry for amending, as if its row had been clicked. */
  editId?: number | null; onEditHandled?: () => void;
}) {
  const { def, patient, units, refreshKey, onChanged, filter } = props;
  const [showStruck, setShowStruck] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Rec | null>(null);
  const lookups = useLookups(def, patient, refreshKey);
  const { data: loaded, error } = useLoad(
    () => api<Rec[]>('GET', `/patients/${patient.id}/${def.key}?limit=500${showStruck ? '&include_errors=true' : ''}`),
    [patient.id, def.key, refreshKey, showStruck],
  );
  const rows = useMemo(() => (loaded && filter ? loaded.filter(filter) : loaded), [loaded, filter]);
  const { editId, onEditHandled } = props;
  useEffect(() => {
    if (editId == null || !rows) return;
    const r = rows.find((x) => x.id === editId);
    if (r) setEditing(r);
    onEditHandled?.();
  }, [editId, rows, onEditHandled]);
  const { onLoaded } = props;
  useEffect(() => { if (rows && onLoaded) onLoaded(rows.filter((r) => r.record_status === 'active')); }, [rows, onLoaded]);

  const writable = canWrite(patient);
  const fieldBy = useMemo(() => new Map(def.fields.map((f) => [f.name, f])), [def]);
  // Columns with no data at all are hidden, so a sparse section (vitals) stays narrow.
  const columns = useMemo(
    () => def.columns.map((c) => fieldBy.get(c)!).filter((f) => (rows || []).some((r) => r[f.name] !== null && r[f.name] !== '')),
    [def, fieldBy, rows],
  );

  const addForm = adding && (
    <RecordForm title={`Add ${def.singular.toLowerCase()}`} fields={def.fields} units={units} lookups={lookups} onClose={() => setAdding(false)}
      onSubmit={async (payload) => { await api('POST', `/patients/${patient.id}/${def.key}`, payload); onChanged(); }} />
  );

  if (error) return <section className="section"><h3>{def.label}</h3><ErrorLine error={error} /></section>;
  if (!rows) return <section className="section"><h3>{def.label}</h3><p className="muted">Loading&hellip;</p></section>;

  if (!rows.length && !showStruck) {
    if (!writable) return null;
    return (
      <div className="empty-chip">
        <button className="btn small" onClick={() => setAdding(true)}>+ Add {def.label.toLowerCase()}</button>
        {addForm}
      </div>
    );
  }

  const cell = (f: FieldDef, r: Rec) => props.renderCell?.(f, r) ?? fmt(f, r[f.name], units);
  const rowClass = (r: Rec) => `${r.record_status !== 'active' ? 'struck ' : ''}${props.rowClass?.(r) || ''}`;

  return (
    <section className="section">
      <div className="section-head">
        <h3>{def.label} <span className="count">({rows.filter((r) => r.record_status === 'active').length})</span></h3>
        <label className="check"><input type="checkbox" checked={showStruck} onChange={(e) => setShowStruck(e.target.checked)} /> Show struck-out</label>
        {writable && <button className="btn small" onClick={() => setAdding(true)}>+ Add</button>}
      </div>
      {props.children}
      {props.layout === 'notes' ? (
        <div className="notes">
          {rows.map((r) => (
            <article key={r.id} className={`note ${rowClass(r)}`} onClick={() => setEditing(r)} tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') setEditing(r); }}>
              <header>{fmtDateTime(r.noted_at)} &middot; {pretty(r.note_type)} &middot; {r.author_name}</header>
              <p>{r.text}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr>{columns.map((f) => <th key={f.name}>{fieldLabel(f, units)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={rowClass(r)} onClick={() => setEditing(r)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') setEditing(r); }}>
                  {columns.map((f) => <td key={f.name} data-label={fieldLabel(f, units)}>{cell(f, r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {addForm}
      {editing && (
        <EditEntry def={def} patient={patient} record={editing} units={units} lookups={lookups} onDone={onChanged} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
