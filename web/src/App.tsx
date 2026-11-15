import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, HttpError, pretty, type Meta, type Patient, type User } from './api';
import { AccountDialog, FamilyDialog, ForcePassword, HelpDialog, PatientDialog, ShareDialog, SignIn } from './dialogs';
import { canSee } from './records';
import { FaceSheet, HistoryTab, LabsTab, MedsTab, NotesTab, VisitsTab, VitalsTab, type TabProps } from './tabs';
import { ErrorLine, useLoad } from './ui';

const TAB_VIEWS: Record<string, (p: TabProps) => React.ReactNode> = {
  face: FaceSheet, history: HistoryTab, meds: MedsTab, vitals: VitalsTab, labs: LabsTab, notes: NotesTab, visits: VisitsTab,
};

interface Session { user: User; patients: Patient[] }
type DialogName = 'account' | 'family' | 'share' | 'help' | 'details' | 'new-chart' | null;

const remember = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const recall = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

export function App() {
  const [phase, setPhase] = useState<'loading' | 'setup' | 'signin' | 'ready'>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<number | null>(() => Number(recall('ks.patient')) || null);
  const [tab, setTab] = useState(() => recall('ks.tab') || 'face');
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<DialogName>(null);

  const load = useCallback(async () => {
    try {
      const status = await api('GET', '/status');
      if (status.needs_setup) { setPhase('setup'); return; }
      const [s, m] = await Promise.all([api<Session>('GET', '/me'), api<Meta>('GET', '/meta')]);
      setSession(s);
      setMeta(m);
      setPhase('ready');
    } catch (e: any) {
      if (e instanceof HttpError && e.status === 401) { setSession(null); setPhase('signin'); } else setFatal(e.message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const changed = useCallback(() => setRefreshKey((k) => k + 1), []);
  const goTab = useCallback((key: string) => { setTab(key); remember('ks.tab', key); window.scrollTo({ top: 0 }); }, []);
  const pickPatient = useCallback((id: number) => { setPatientId(id); remember('ks.patient', String(id)); }, []);

  const patient = useMemo(() => session?.patients.find((p) => p.id === patientId) || session?.patients[0], [session, patientId]);
  const counts = useLoad(
    () => (patient ? api<Record<string, number>>('GET', `/patients/${patient.id}/counts`) : Promise.resolve({} as Record<string, number>)),
    [patient?.id, refreshKey],
  );

  if (fatal) return <div className="desktop center"><div className="window signin"><div className="titlebar"><span className="title">KS EMR</span></div><div className="dialog-body"><ErrorLine error={`Cannot reach the server: ${fatal}`} /><button className="btn" onClick={() => { setFatal(null); void load(); }}>Retry</button></div></div></div>;
  if (phase === 'loading') return <div className="desktop center"><p className="loading">Loading KS EMR&hellip;</p></div>;
  if (phase === 'setup' || phase === 'signin') return <SignIn setup={phase === 'setup'} onDone={load} />;
  if (!session || !meta) return null;

  const { user } = session;
  if (user.must_change_password) return <ForcePassword onDone={load} />;
  const guest = user.role === 'guest';
  const viewer = patient?.access_level === 'viewer';

  // A tab is offered when at least one of its sections is shared; for read-only users, also only when it holds something.
  const tabs = meta.tabs.filter((t) => {
    if (t.key === 'face' || !patient) return true;
    const keys = meta.record_types.filter((r) => r.tab === t.key).map((r) => r.key).filter((k) => canSee(patient, k));
    if (!keys.length) return false;
    return !viewer || !counts.data || keys.some((k) => (counts.data![k] || 0) > 0);
  });
  const active = tabs.some((t) => t.key === tab) ? tab : 'face';
  const View = TAB_VIEWS[active];
  const tabIndex = meta.tabs.findIndex((t) => t.key === active);

  const toggleUnits = async () => {
    const next = user.unit_system === 'metric' ? 'imperial' : 'metric';
    const r = await api<{ user: User }>('PATCH', '/me', { unit_system: next });
    setSession({ ...session, user: r.user });
  };
  const signOut = async () => { await api('POST', '/logout'); setSession(null); setPhase('signin'); };

  return (
    <div className="desktop">
      <div className="window app">
        <div className="titlebar no-print">
          <span className="sysbtn" aria-hidden="true">&#x2500;</span>
          <span className="title">KS EMR{patient ? ` - [${patient.full_name}]` : ''}</span>
        </div>
        <nav className="menubar no-print" aria-label="Main">
          {session.patients.length > 0 && (
            <label className="chart-pick">Chart:{' '}
              <select value={patient?.id} onChange={(e) => pickPatient(Number(e.target.value))}>
                {session.patients.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.access_level !== 'manager' ? ` (${p.access_level})` : ''}</option>)}
              </select>
            </label>
          )}
          {!guest && <button className="btn small" onClick={() => setDialog('new-chart')}>New chart&hellip;</button>}
          <button className="btn small" onClick={toggleUnits} title="Switch between metric and imperial units">
            Units: <strong>{user.unit_system === 'metric' ? 'Metric' : 'Imperial'}</strong>
          </button>
          {patient?.access_level === 'manager' && <button className="btn small" onClick={() => setDialog('share')}>Share&hellip;</button>}
          {!guest && <button className="btn small" onClick={() => setDialog('account')}>Account&hellip;</button>}
          {user.role === 'owner' && <button className="btn small" onClick={() => setDialog('family')}>Family&hellip;</button>}
          <button className="btn small" onClick={() => setDialog('help')}>Help</button>
          <button className="btn small" onClick={signOut}>Sign out</button>
        </nav>

        {!patient ? (
          <div className="page solo">
            <p>You do not have a chart yet. Create one, or ask a family member to share a chart with you.</p>
            {!guest && <button className="btn default" onClick={() => setDialog('new-chart')}>New chart&hellip;</button>}
          </div>
        ) : (
          <>
            <header className="patient-strip">
              <div className="who">
                <h1>{patient.full_name}{patient.preferred_name ? <small> &ldquo;{patient.preferred_name}&rdquo;</small> : null}</h1>
                <p>
                  {[patient.age_years != null && `${patient.age_years} years`, patient.sex && pretty(patient.sex), patient.date_of_birth && `born ${patient.date_of_birth}`,
                    patient.blood_type && patient.blood_type !== 'unknown' && `blood type ${pretty(patient.blood_type).replace(' positive', '+').replace(' negative', '-').toUpperCase()}`]
                    .filter(Boolean).join(' · ') || 'No details entered yet'}
                </p>
              </div>
              <button className="btn small no-print" onClick={() => setDialog('details')}>{patient.access_level === 'manager' ? 'Edit details' : 'Details'}&hellip;</button>
            </header>
            <div className="binder">
              <div className="tabs no-print" role="tablist" aria-label="Chart pages">
                {tabs.map((t) => {
                  const i = meta.tabs.findIndex((x) => x.key === t.key);
                  return (
                    <button key={t.key} role="tab" aria-selected={t.key === active} className={`tab tab-${i}${t.key === active ? ' active' : ''}`} onClick={() => goTab(t.key)}>
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <main className={`page tab-${tabIndex}`} role="tabpanel">
                <h2 className="page-title">{meta.tabs[tabIndex].label}</h2>
                <View key={`${patient.id}-${active}`} meta={meta} patient={patient} units={user.unit_system} refreshKey={refreshKey} onChanged={changed} goTab={goTab} />
              </main>
            </div>
          </>
        )}
        <footer className="statusbar no-print">
          <span>{user.display_name} ({guest ? 'physician access' : user.role})</span>
          {patient && <span>{patient.access_level === 'viewer' ? 'Read-only' : pretty(patient.access_level)}</span>}
          {user.expires_at && <span>Access ends {user.expires_at.slice(0, 16).replace('T', ' ')} UTC</span>}
        </footer>
      </div>

      {dialog === 'account' && <AccountDialog user={user} onClose={() => setDialog(null)} />}
      {dialog === 'family' && <FamilyDialog me={user} onClose={() => setDialog(null)} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'share' && patient && <ShareDialog meta={meta} patient={patient} onClose={() => setDialog(null)} onImported={load} />}
      {dialog === 'details' && patient && (
        <PatientDialog meta={meta} patient={patient} units={user.unit_system} onClose={() => setDialog(null)} onSaved={() => { void load(); changed(); }} />
      )}
      {dialog === 'new-chart' && (
        <PatientDialog meta={meta} units={user.unit_system} onClose={() => setDialog(null)} onSaved={(p) => { pickPatient(p.id); goTab('face'); void load(); }} />
      )}
    </div>
  );
}
