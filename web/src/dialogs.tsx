import { useState } from 'react';
import { api, fmtDateTime, pretty, type Meta, type Patient, type Rec, type UnitSystem, type User } from './api';
import { ReminderSettingsForm } from './reminders';
import { AUTO, THEMES } from './theme';
import { RecordForm } from './records';
import { Dialog, ErrorLine, Markdown, useAction, useLoad } from './ui';

// ---- sign in / first-run setup ------------------------------------------------

export function SignIn({ setup, onDone }: { setup: boolean; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const act = useAction();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (setup && password !== confirm) { act.setError('The two passwords do not match'); return; }
    void act.run(async () => {
      await api('POST', setup ? '/setup' : '/login', setup ? { username, display_name: displayName, password } : { username, password });
      onDone();
    });
  };
  return (
    <div className="desktop center">
      <div className="window signin">
        <div className="titlebar"><span className="sysbtn" aria-hidden="true"></span><span className="title">{setup ? 'KS EMR Setup' : 'KS EMR - Sign In'}</span></div>
        <form className="form single" onSubmit={submit}>
          <div className="brand full"><span className="logo" aria-hidden="true">+</span><div><strong>KS EMR</strong><br /><small>KnightSoft Electronic Medical Record</small></div></div>
          {setup && <p className="full">Welcome. Create the first account. It becomes the <strong>owner</strong>, who can add accounts for the rest of the family.</p>}
          <div className="field full"><label htmlFor="su">Username</label>
            <input id="su" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required autoFocus /></div>
          {setup && <div className="field full"><label htmlFor="sd">Your full name</label>
            <input id="sd" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" required /></div>}
          <div className="field full"><label htmlFor="sp">Password{setup ? ' (10 characters or more)' : ''}</label>
            <input id="sp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? 'new-password' : 'current-password'} required /></div>
          {setup && <div className="field full"><label htmlFor="sc">Password again</label>
            <input id="sc" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></div>}
          <ErrorLine error={act.error} />
          <div className="buttons full"><button className="btn default" disabled={act.busy}>{setup ? 'Create owner account' : 'Sign in'}</button></div>
        </form>
      </div>
    </div>
  );
}

// ---- account: password and API tokens -----------------------------------------

function PasswordForm({ onDone, forced }: { onDone: () => void; forced?: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const act = useAction();
  return (
    <form className="form single" onSubmit={(e) => {
      e.preventDefault();
      if (next !== confirm) { act.setError('The two new passwords do not match'); return; }
      void act.run(async () => { await api('POST', '/me/password', { current_password: current, new_password: next }); setDone(true); setCurrent(''); setNext(''); setConfirm(''); onDone(); });
    }}>
      {forced && <p className="full">You are using a temporary password. Choose your own before continuing.</p>}
      <div className="field full"><label htmlFor="pc">{forced ? 'Temporary password' : 'Current password'}</label><input id="pc" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></div>
      <div className="field full"><label htmlFor="pn">New password (10 characters or more)</label><input id="pn" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={10} /></div>
      <div className="field full"><label htmlFor="pk">New password again</label><input id="pk" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></div>
      <ErrorLine error={act.error} />
      {done && <p className="ok full">Password changed. Other devices were signed out.</p>}
      <div className="buttons full"><button className="btn default" disabled={act.busy}>Change password</button></div>
    </form>
  );
}

export function ForcePassword({ onDone }: { onDone: () => void }) {
  return (
    <div className="desktop center">
      <div className="window signin">
        <div className="titlebar"><span className="sysbtn" aria-hidden="true"></span><span className="title">Choose a Password</span></div>
        <PasswordForm forced onDone={onDone} />
      </div>
    </div>
  );
}

type Settings = Partial<Pick<User, 'unit_system' | 'temperature_unit' | 'theme'>>;

/** A miniature binder drawn with one theme's tokens: the wrapper carries that theme's data-theme. */
function ThemePreview({ ids }: { ids: string[] }) {
  return (
    <span className="theme-preview" aria-hidden="true">
      {ids.map((id) => (
        <span className="tp" data-theme={id} key={id}>
          <span className="tp-tabs"><i /><i /><i /></span>
          <span className="tp-page"><b /><b /></span>
        </span>
      ))}
    </span>
  );
}

function DisplaySettings({ user, onSetting }: { user: User; onSetting: (s: Settings) => Promise<void> }) {
  const act = useAction();
  const choice = user.theme === AUTO || THEMES.some((t) => t.id === user.theme) ? user.theme : AUTO;
  const options = [
    { id: AUTO, label: 'Match device', description: 'Modern light, or Modern dark when your device is in dark mode.', preview: ['modern-light', 'modern-dark'] },
    ...THEMES.map((t) => ({ id: t.id, label: t.label, description: t.description, preview: [t.id] })),
  ];
  const save = (s: Settings) => void act.run(() => onSetting(s));
  return (
    <>
      <h4>Theme</h4>
      <p className="muted">Changes only how KS EMR looks for you. It is remembered on your account.</p>
      <fieldset className="theme-grid">
        {options.map((o) => (
          <label key={o.id} className={`theme-card${choice === o.id ? ' selected' : ''}`}>
            <ThemePreview ids={o.preview} />
            <span className="check"><input type="radio" name="theme" checked={choice === o.id} onChange={() => save({ theme: o.id })} /> {o.label}</span>
            <small>{o.description}</small>
          </label>
        ))}
      </fieldset>
      <h4>Units</h4>
      <div className="form">
        <div className="field"><label htmlFor="set-units">Weight, height and glucose</label>
          <select id="set-units" value={user.unit_system} onChange={(e) => save({ unit_system: e.target.value as User['unit_system'] })}>
            <option value="metric">Metric (kg, cm, mmol/L)</option>
            <option value="imperial">Imperial (lb, in, mg/dL)</option>
          </select></div>
        <div className="field"><label htmlFor="set-temp">Temperature</label>
          <select id="set-temp" value={user.temperature_unit} onChange={(e) => save({ temperature_unit: e.target.value as User['temperature_unit'] })}>
            <option value="auto">Follow the units above</option>
            <option value="c">Always Celsius (°C)</option>
            <option value="f">Always Fahrenheit (°F)</option>
          </select></div>
      </div>
      <ErrorLine error={act.error} />
    </>
  );
}

export function AccountDialog({ user, onSetting, onClose }: { user: User; onSetting: (s: Settings) => Promise<void>; onClose: () => void }) {
  const tokens = useLoad(() => api<Rec[]>('GET', '/tokens'), []);
  const [name, setName] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const act = useAction();
  const origin = window.location.origin;
  return (
    <Dialog title={`Account - ${user.display_name}`} onClose={onClose} wide>
      <DisplaySettings user={user} onSetting={onSetting} />
      <ReminderSettingsForm />
      <h4>Password</h4>
      <PasswordForm onDone={() => undefined} />
      <h4>API tokens for AI agents and scripts</h4>
      <p className="muted">
        A token lets a program act as you: it can see every chart you can see. REST API: <code>{origin}/api</code> (description at <a href="/api/openapi.json" target="_blank" rel="noreferrer">/api/openapi.json</a>).
        MCP endpoint: <code>{origin}/mcp</code>. Send the token as <code>Authorization: Bearer &lt;token&gt;</code>.
      </p>
      <ErrorLine error={tokens.error || act.error} />
      {fresh && (
        <div className="secret">
          <p><strong>Copy this token now. It will not be shown again.</strong></p>
          <code className="token">{fresh}</code>
          <button className="btn small" onClick={() => navigator.clipboard?.writeText(fresh)}>Copy</button>
        </div>
      )}
      <div className="table-wrap">
        <table className="grid plain">
          <thead><tr><th>Name</th><th>Access</th><th>Created</th><th>Last used</th><th /></tr></thead>
          <tbody>
            {(tokens.data || []).map((t) => (
              <tr key={t.id}>
                <td data-label="Name">{t.name}</td><td data-label="Access">{t.read_only ? 'Read only' : 'Read and write'}</td>
                <td data-label="Created">{fmtDateTime(t.created_at)}</td><td data-label="Last used">{fmtDateTime(t.last_used_at) || 'Never'}</td>
                <td><button className="btn small" onClick={() => act.run(async () => { await api('DELETE', `/tokens/${t.id}`); tokens.reload(); })}>Revoke</button></td>
              </tr>
            ))}
            {tokens.data?.length === 0 && <tr><td colSpan={5} className="muted">No tokens yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <form className="inline-form" onSubmit={(e) => {
        e.preventDefault();
        void act.run(async () => { const r = await api<Rec>('POST', '/tokens', { name, read_only: readOnly }); setFresh(r.token); setName(''); tokens.reload(); });
      }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. Home assistant" required aria-label="Token name" />
        <label className="check"><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read only</label>
        <button className="btn" disabled={act.busy}>Create token</button>
      </form>
    </Dialog>
  );
}

// ---- family accounts (owner) --------------------------------------------------

export function FamilyDialog({ me, onClose }: { me: User; onClose: () => void }) {
  const users = useLoad(() => api<User[]>('GET', '/users'), []);
  const [form, setForm] = useState({ username: '', display_name: '', password: '', create_chart: true });
  const [reset, setReset] = useState<{ user: User; password: string } | null>(null);
  const act = useAction();
  return (
    <Dialog title="Family Accounts" onClose={onClose} wide>
      <p className="muted">Each person signs in with their own account and sees only their own chart until someone shares another with them. As owner you manage accounts, not charts: you cannot open anyone else's chart from here.</p>
      <ErrorLine error={users.error || act.error} />
      <div className="table-wrap">
        <table className="grid plain">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(users.data || []).map((u) => (
              <tr key={u.id}>
                <td data-label="Name">{u.display_name}</td><td data-label="Username">{u.username}</td><td data-label="Role">{pretty(u.role)}</td>
                <td data-label="Status">{u.disabled ? 'Disabled' : u.must_change_password ? 'Temporary password' : 'Active'}</td>
                <td className="actions">
                  {u.id !== me.id && (
                    <>
                      <button className="btn small" onClick={() => setReset({ user: u, password: '' })}>Reset password&hellip;</button>
                      <button className="btn small" onClick={() => act.run(async () => { await api('PATCH', `/users/${u.id}`, { disabled: !u.disabled }); users.reload(); })}>
                        {u.disabled ? 'Enable' : 'Disable'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {reset && (
        <form className="inline-form" onSubmit={(e) => {
          e.preventDefault();
          void act.run(async () => { await api('PATCH', `/users/${reset.user.id}`, { new_password: reset.password }); setReset(null); users.reload(); });
        }}>
          <label htmlFor="rp">Temporary password for {reset.user.display_name}:</label>
          <input id="rp" type="text" value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} minLength={10} required autoComplete="off" />
          <button className="btn" disabled={act.busy}>Set</button>
          <button type="button" className="btn" onClick={() => setReset(null)}>Cancel</button>
        </form>
      )}
      <h4>Add a family member</h4>
      <form className="form" onSubmit={(e) => {
        e.preventDefault();
        void act.run(async () => { await api('POST', '/users', form); setForm({ username: '', display_name: '', password: '', create_chart: true }); users.reload(); });
      }}>
        <div className="field"><label htmlFor="nu">Username</label><input id="nu" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoCapitalize="none" autoComplete="off" /></div>
        <div className="field"><label htmlFor="nd">Full name</label><input id="nd" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required autoComplete="off" /></div>
        <div className="field"><label htmlFor="np">Temporary password (10+ characters)</label><input id="np" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={10} autoComplete="off" /></div>
        <div className="field"><label className="check"><input type="checkbox" checked={form.create_chart} onChange={(e) => setForm({ ...form, create_chart: e.target.checked })} /> Create their own chart</label>
          <small className="muted">Untick if a guardian already keeps a chart for this person and will hand it over by sharing it as manager.</small></div>
        <div className="buttons full"><button className="btn default" disabled={act.busy}>Add account</button></div>
      </form>
    </Dialog>
  );
}

// ---- sharing, physician access, export -----------------------------------------

function SectionPicker({ meta, value, onChange }: { meta: Meta; value: string[]; onChange: (v: string[]) => void }) {
  const all = meta.record_types.map((t) => t.key);
  return (
    <fieldset className="box picker">
      <legend>Sections to share</legend>
      <div className="picker-actions">
        <button type="button" className="btn small" onClick={() => onChange(all)}>All</button>
        <button type="button" className="btn small" onClick={() => onChange([])}>None</button>
      </div>
      {meta.record_types.map((t) => (
        <label key={t.key} className="check">
          <input type="checkbox" checked={value.includes(t.key)} onChange={(e) => onChange(e.target.checked ? [...value, t.key] : value.filter((k) => k !== t.key))} /> {t.label}
        </label>
      ))}
    </fieldset>
  );
}

export function ShareDialog({ meta, patient, onClose, onImported }: { meta: Meta; patient: Patient; onClose: () => void; onImported: () => void }) {
  const base = `/patients/${patient.id}`;
  const all = meta.record_types.map((t) => t.key);
  const shares = useLoad(() => api<Rec[]>('GET', `${base}/shares`), [patient.id]);
  const directory = useLoad(() => api<Rec[]>('GET', '/directory'), []);
  const [family, setFamily] = useState({ username: '', level: 'viewer', sections: all });
  const [doctor, setDoctor] = useState({ label: '', expires_in_days: 7, sections: all });
  const [creds, setCreds] = useState<Rec | null>(null);
  const [showLog, setShowLog] = useState(false);
  const log = useLoad(() => (showLog ? api<Rec[]>('GET', `${base}/audit?limit=100`) : Promise.resolve([] as Rec[])), [showLog, patient.id]);
  const act = useAction();
  const names = (s: string) => (s === 'all' ? 'Whole chart' : s.split(',').map((k) => meta.record_types.find((t) => t.key === k)?.label || k).join(', '));
  const credText = creds ? `KS EMR chart access for ${patient.full_name}\nAddress: ${creds.login_url}\nUsername: ${creds.username}\nPassword: ${creds.password}\nValid until: ${fmtDateTime(creds.expires_at)} UTC (read-only)` : '';

  return (
    <Dialog title={`Share - ${patient.full_name}`} onClose={onClose} wide>
      <ErrorLine error={shares.error || act.error} />
      <h4>Who can open this chart</h4>
      <div className="table-wrap">
        <table className="grid plain">
          <thead><tr><th>Who</th><th>Access</th><th>Sections</th><th>Expires</th><th /></tr></thead>
          <tbody>
            {(shares.data || []).map((s) => (
              <tr key={s.id} className={s.is_expired ? 'struck' : ''}>
                <td data-label="Who">{s.display_name} <small>({s.username})</small>{s.is_physician_share ? ' [physician]' : ''}</td>
                <td data-label="Access">{pretty(s.level)}</td>
                <td data-label="Sections">{names(s.sections)}</td>
                <td data-label="Expires">{s.expires_at ? `${fmtDateTime(s.expires_at)} UTC${s.is_expired ? ' (expired)' : ''}` : 'Never'}</td>
                <td><button className="btn small" disabled={act.busy} onClick={() => act.run(async () => { await api('DELETE', `${base}/shares/${s.id}`); shares.reload(); })}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4>Temporary access for a physician</h4>
      <p className="muted">Creates a read-only account with a one-time username and password that stops working on the expiry date. Everything the physician opens is written to the access log.</p>
      {creds && (
        <div className="secret">
          <p><strong>Give these details to {creds.label}. The password will not be shown again.</strong></p>
          <pre>{credText}</pre>
          <button className="btn small" onClick={() => navigator.clipboard?.writeText(credText)}>Copy</button>
        </div>
      )}
      <form className="form" onSubmit={(e) => {
        e.preventDefault();
        void act.run(async () => { setCreds(await api('POST', `${base}/physician-shares`, doctor)); setDoctor({ ...doctor, label: '' }); shares.reload(); });
      }}>
        <div className="field"><label htmlFor="dl">For whom</label><input id="dl" value={doctor.label} onChange={(e) => setDoctor({ ...doctor, label: e.target.value })} placeholder="e.g. Dr. Patel, cardiology" required /></div>
        <div className="field"><label htmlFor="dd">Valid for (days)</label><input id="dd" type="number" min={1} max={90} value={doctor.expires_in_days} onChange={(e) => setDoctor({ ...doctor, expires_in_days: Number(e.target.value) })} required /></div>
        <div className="full"><SectionPicker meta={meta} value={doctor.sections} onChange={(sections) => setDoctor({ ...doctor, sections })} /></div>
        <div className="buttons full"><button className="btn default" disabled={act.busy}>Create physician access</button></div>
      </form>

      <h4>Share with a family member</h4>
      {directory.data?.length === 0 ? <p className="muted">There are no other family accounts yet. The owner can add them under Family.</p> : (
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          void act.run(async () => { await api('POST', `${base}/shares`, family); shares.reload(); });
        }}>
          <div className="field"><label htmlFor="fu">Family member</label>
            <select id="fu" value={family.username} onChange={(e) => setFamily({ ...family, username: e.target.value })} required>
              <option value="">(choose)</option>
              {(directory.data || []).map((u) => <option key={u.username} value={u.username}>{u.display_name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="fl">Access</label>
            <select id="fl" value={family.level} onChange={(e) => setFamily({ ...family, level: e.target.value })}>
              <option value="viewer">Viewer: can read</option>
              <option value="editor">Editor: can read and add entries</option>
              <option value="manager">Manager: full control, can share (co-guardian)</option>
            </select></div>
          <div className="full"><SectionPicker meta={meta} value={family.sections} onChange={(sections) => setFamily({ ...family, sections })} /></div>
          <div className="buttons full"><button className="btn default" disabled={act.busy}>Share</button></div>
        </form>
      )}

      <h4>Export and import (plain text)</h4>
      <p className="muted">The chart file is readable JSON you can keep as a backup and import again later as a new chart. FHIR is the HL7 standard other health systems read. Uploaded files are not included in either.</p>
      <div className="buttons">
        <a className="btn" href={`/api${base}/export`}>Download chart (JSON)</a>
        <a className="btn" href={`/api${base}/fhir`}>Download HL7 FHIR bundle</a>
        <label className="btn">Import a chart file&hellip;
          <input type="file" accept="application/json,.json" hidden onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void act.run(async () => { await api('POST', '/patients/import', JSON.parse(await file.text())); onImported(); onClose(); });
          }} />
        </label>
      </div>

      <h4>Access log</h4>
      {!showLog ? <button className="btn small" onClick={() => setShowLog(true)}>Show the last 100 events</button> : (
        <div className="table-wrap log">
          <table className="grid plain">
            <thead><tr><th>When (UTC)</th><th>Who</th><th>What</th><th>Entry</th></tr></thead>
            <tbody>
              {(log.data || []).map((l) => (
                <tr key={l.id}><td data-label="When">{fmtDateTime(l.at)}</td><td data-label="Who">{l.user_name}</td><td data-label="What">{pretty(l.action)}</td>
                  <td data-label="Entry">{l.record_type ? `${pretty(l.record_type)} #${l.record_id}` : l.action === 'guest_view' ? JSON.parse(l.detail || '{}').path : ''}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

// ---- chart details / new chart -------------------------------------------------

export function PatientDialog({ meta, patient, units, onClose, onSaved }: { meta: Meta; patient?: Patient; units: UnitSystem; onClose: () => void; onSaved: (p: Patient) => void }) {
  return (
    <RecordForm
      title={patient ? `Details - ${patient.full_name}` : 'New Chart (person without their own login)'} fields={meta.patient_fields} record={patient} units={units}
      readOnly={!!patient && patient.access_level !== 'manager'} submitLabel={patient ? 'Save changes' : 'Create chart'} onClose={onClose}
      onSubmit={async (payload) => {
        const saved = patient ? await api<Patient>('PATCH', `/patients/${patient.id}`, payload) : await api<Patient>('POST', '/patients', payload);
        onSaved(saved);
      }}
      footer={!patient ? <p className="muted full">Use this for a child, a parent, or anyone you keep records for. You become the chart's manager and can share it with other family members.</p> : undefined}
    />
  );
}

// ---- help ----------------------------------------------------------------------

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const manual = useLoad(async () => {
    const res = await fetch('/api/manual');
    return res.text();
  }, []);
  return (
    <Dialog title="KS EMR Help" onClose={onClose} wide>
      <ErrorLine error={manual.error} />
      {manual.data ? <Markdown text={manual.data} /> : <p className="muted">Loading&hellip;</p>}
    </Dialog>
  );
}
