import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/**
 * Care reminders: while the app is open it asks the server once a minute what is due
 * (doses not yet recorded, monitoring checks) and shows it in a bar above the chart.
 * There is no service worker or push server: nothing arrives once every KS EMR tab is closed.
 */

export interface DueReminder {
  key: string; kind: 'dose' | 'check'; patient_id: number; patient_name: string; title: string; detail: string;
  due_at: string; overdue_minutes: number; tab: string; record_type: string; record_id: number;
}

// ---- settings: kept in this browser, because alerts and notifications belong to a device ----

export interface ReminderSettings { on: boolean; notify: boolean; repeatMinutes: number }
const DEFAULTS: ReminderSettings = { on: true, notify: false, repeatMinutes: 30 };
const SETTINGS_KEY = 'ks.reminders';
const CHANGED = 'ks-reminder-settings';

export function loadReminderSettings(): ReminderSettings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return DEFAULTS; }
}
export function saveReminderSettings(s: ReminderSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(CHANGED));
}
export function useReminderSettings(): ReminderSettings {
  const [s, setS] = useState(loadReminderSettings);
  useEffect(() => {
    const update = () => setS(loadReminderSettings());
    window.addEventListener(CHANGED, update);
    return () => window.removeEventListener(CHANGED, update);
  }, []);
  return s;
}

export const notificationsSupported = () => typeof Notification !== 'undefined';

// ---- polling ----

const POLL_MS = 60_000;
const SNOOZE_MINUTES = 15;

/** `active` is false for people who get no reminders (physician guests) and before sign-in. */
export function useReminders(active: boolean, refreshKey: number) {
  const settings = useReminderSettings();
  const [all, setAll] = useState<DueReminder[]>([]);
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const notified = useRef<Record<string, number>>({});
  const on = active && settings.on;

  const reload = useCallback(async () => {
    if (!on) { setAll([]); return; }
    try { setAll((await api<{ reminders: DueReminder[] }>('GET', '/reminders/due')).reminders); } catch { /* offline or signed out: try again next time */ }
  }, [on]);

  useEffect(() => {
    void reload();
    if (!on) return;
    const timer = window.setInterval(() => void reload(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [on, reload, refreshKey]);

  const now = Date.now();
  const alerts = all.filter((a) => !(snoozed[a.key] > now));

  // Browser notifications: once when something comes due, and again every repeatMinutes while it stays due.
  useEffect(() => {
    if (!settings.notify || !notificationsSupported() || Notification.permission !== 'granted') return;
    const t = Date.now();
    for (const a of alerts) {
      const last = notified.current[a.key];
      if (last && t - last < settings.repeatMinutes * 60_000) continue;
      notified.current[a.key] = t;
      try {
        new Notification(`KS EMR: ${a.patient_name}`, { body: `${a.title}${a.detail ? ` (${a.detail})` : ''}, due ${a.due_at.slice(11)}`, tag: a.key });
      } catch { /* some browsers only allow notifications from a service worker */ }
    }
  }, [alerts, settings.notify, settings.repeatMinutes]);

  // The count also shows in the browser tab's title, so it is visible from another tab.
  useEffect(() => {
    document.title = alerts.length ? `(${alerts.length}) KS EMR` : 'KS EMR';
  }, [alerts.length]);

  const snooze = useCallback((key: string) => setSnoozed((s) => ({ ...s, [key]: Date.now() + SNOOZE_MINUTES * 60_000 })), []);
  return { alerts, reload, snooze };
}

const late = (minutes: number) => (minutes < 1 ? 'due now' : minutes < 60 ? `${minutes} min overdue` : `${Math.floor(minutes / 60)} h ${minutes % 60} min overdue`);

export function ReminderBar({ alerts, onOpen, onDone, onSnooze }: {
  alerts: DueReminder[]; onOpen: (a: DueReminder) => void; onDone: (a: DueReminder) => void; onSnooze: (key: string) => void;
}) {
  if (!alerts.length) return null;
  return (
    <section className="reminders no-print" aria-label="Reminders" aria-live="polite">
      <h2>Reminders <span className="count">({alerts.length})</span></h2>
      <ul>
        {alerts.map((a) => (
          <li key={a.key} className={a.overdue_minutes >= 30 ? 'late' : ''}>
            <span className="reminder-text">
              <strong>{a.patient_name}</strong>: {a.title}{a.detail ? <small> {a.detail}</small> : null}
              <small> &middot; {a.due_at.slice(11)}, {late(a.overdue_minutes)}</small>
            </span>
            <span className="actions">
              <button className="btn small default" onClick={() => onOpen(a)}>{a.kind === 'dose' ? 'Open Meds' : 'Open Vitals'}</button>
              {a.kind === 'check' && <button className="btn small" onClick={() => onDone(a)}>Done</button>}
              <button className="btn small" onClick={() => onSnooze(a.key)}>Snooze {SNOOZE_MINUTES} min</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Settings shown under Account. */
export function ReminderSettingsForm() {
  const s = useReminderSettings();
  const [denied, setDenied] = useState(false);
  const setNotify = async (want: boolean) => {
    if (want && notificationsSupported() && Notification.permission !== 'granted') {
      const answer = await Notification.requestPermission();
      if (answer !== 'granted') { setDenied(true); return; }
    }
    setDenied(false);
    saveReminderSettings({ ...s, notify: want });
  };
  return (
    <>
      <h4>Reminders</h4>
      <p className="muted">
        While KS EMR is open, it reminds you of doses that are due and of monitoring checks set up on the Vitals tab, for every chart you can edit.
        These settings apply to this browser only. Nothing is sent once every KS EMR tab is closed.
      </p>
      <div className="form single">
        <label className="check"><input type="checkbox" checked={s.on} onChange={(e) => saveReminderSettings({ ...s, on: e.target.checked })} /> Show reminders in this browser</label>
        {notificationsSupported() && (
          <label className="check"><input type="checkbox" checked={s.notify && s.on} disabled={!s.on} onChange={(e) => void setNotify(e.target.checked)} /> Also pop up a notification from the browser</label>
        )}
        {denied && <p className="error">The browser did not allow notifications. Allow them for this site in the browser's settings, then tick the box again.</p>}
        <div className="field"><label htmlFor="rem-repeat">Repeat the notification while something stays due</label>
          <select id="rem-repeat" value={s.repeatMinutes} disabled={!s.on || !s.notify} onChange={(e) => saveReminderSettings({ ...s, repeatMinutes: Number(e.target.value) })}>
            <option value={15}>Every 15 minutes</option><option value={30}>Every 30 minutes</option><option value={60}>Every hour</option>
          </select></div>
      </div>
    </>
  );
}
