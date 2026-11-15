import { useEffect, useMemo, useRef, useState } from 'react';
import { toDisplay, unitLabel, type Patient, type Rec, type UnitSystem } from './api';

/**
 * Observation chart: temperature, pulse, respiration, blood pressure and pain on one grid,
 * one column per round, like the chart kept at a hospital bedside.
 *
 * The scales line up as on paper so that normal readings sit together:
 * pulse 60 = blood pressure 110 = 37 degrees C share the heavy line.
 * Everything is drawn on one internal scale "v" (the pulse scale, 0 to 200).
 */

export interface Schedule { intervalMinutes: number; anchor: string; fromReminder: boolean }

/** Used when no monitoring reminder sets the rounds: every 4 hours on the clock (02, 06, 10, 14, 18, 22). */
export const DEFAULT_SCHEDULE: Schedule = { intervalMinutes: 240, anchor: '2000-01-01T02:00', fromReminder: false };

const ROW = 22;           // pixels per 10 units of v
const COL = 56;           // pixels per round
const TOP = 50;           // top of the grid
const V_MAX = 200;
const BOTTOM = TOP + (V_MAX / 10) * ROW;
const HEIGHT = BOTTOM + 34;
const AXIS_W = 158;
const MAX_COLS = 130;

const y = (v: number) => BOTTOM - (Math.max(0, Math.min(V_MAX, v)) / 10) * ROW;
const V = {
  pulse: (n: number) => n,
  resp: (n: number) => n,
  bp: (n: number) => n - 50,
  temp: (c: number) => 30 + (c - 34) * 10,
  pain: (n: number) => 100 + n * 10,
};

const ms = (local: string) => new Date(local).getTime();
const p2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (t: number) => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const dayLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
export const whenLabel = (t: number) => `${dayLabel(t)} ${hhmm(t)}`;

/** A check this close to a round is drawn in that round's column (never more than half the interval). */
const toleranceMs = (s: Schedule) => Math.min(60, Math.floor(s.intervalMinutes / 2)) * 60_000;

/** The round nearest to a time. */
function nearestRound(t: number, s: Schedule): number {
  const iv = s.intervalMinutes * 60_000, a = ms(s.anchor);
  return a + Math.round((t - a) / iv) * iv;
}
/** The first round after a time: when the next check is due. */
export function nextRound(t: number, s: Schedule): number {
  const iv = s.intervalMinutes * 60_000, a = ms(s.anchor);
  return a + (Math.floor((t - a) / iv) + 1) * iv;
}

export const OBS_FIELDS = ['temperature_c', 'heart_rate_bpm', 'respiratory_rate_per_min', 'systolic_mmhg', 'diastolic_mmhg', 'spo2_percent', 'pain_score'];
export const isObservation = (r: Rec) => OBS_FIELDS.some((f) => r[f] != null);

/** Adult resting ranges, used only to highlight a value. Not applied to children, whose normal ranges differ. */
export function outOfRange(field: string, value: unknown, patient: Patient): boolean {
  if (value == null || (patient.age_years != null && patient.age_years < 16)) return false;
  const n = Number(value);
  switch (field) {
    case 'temperature_c': return n >= 38 || n < 35.5;
    case 'heart_rate_bpm': return n > 100 || n < 50;
    case 'respiratory_rate_per_min': return n > 20 || n < 12;
    case 'systolic_mmhg': return n >= 140 || n < 90;
    case 'diastolic_mmhg': return n >= 90 || n < 50;
    case 'spo2_percent': return n < 95;
    default: return false;
  }
}

interface Mark { x: number; y: number; text: string; id: number }

export function ObservationChart({ rows, schedule, units, days, selectedId, onSelect }: {
  rows: Rec[]; schedule: Schedule; units: UnitSystem; days: number; selectedId: number | null; onSelect: (id: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ left: number; top: number; text: string } | null>(null);
  const now = Date.now();
  const iv = schedule.intervalMinutes * 60_000;

  // Columns: from the first round inside the chosen period up to the next round that is due.
  const last = nextRound(now, schedule);
  let first = nearestRound(now - days * 86400_000, schedule);
  if ((last - first) / iv + 1 > MAX_COLS) first = last - (MAX_COLS - 1) * iv;
  const count = Math.round((last - first) / iv) + 1;
  const width = count * COL;
  const t0 = first - iv / 2;
  const xAt = (t: number) => ((t - t0) / iv) * COL;

  const points = useMemo(() => {
    const tol = toleranceMs(schedule);
    return rows.filter(isObservation).map((r) => {
      const t = ms(r.recorded_at);
      const round = nearestRound(t, schedule);
      const snapped = Math.abs(t - round) <= tol;
      return { r, t, snapped, at: snapped ? round : t };
    }).filter((p) => p.at >= t0 && p.at <= last + iv / 2).sort((a, b) => a.t - b.t);
  }, [rows, schedule, t0, last, iv]);

  // Show the newest readings first: the chart opens scrolled to the right.
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth; }, [width, rows.length]);

  const tempUnit = unitLabel('temperature', units);
  const series = (field: string, toV: (n: number) => number, label: (n: number, r: Rec) => string, dx = 0): Mark[] =>
    points.filter((p) => p.r[field] != null).map((p) => ({
      x: xAt(p.at) + dx, y: y(toV(p.r[field])), id: p.r.id, text: `${whenLabel(p.t)} · ${label(p.r[field], p.r)}${p.snapped ? '' : ' (extra check)'}`,
    }));
  const temp = series('temperature_c', V.temp, (n) => `Temp ${toDisplay('temperature', n, units)} ${tempUnit}`);
  const pulse = series('heart_rate_bpm', V.pulse, (n) => `Pulse ${n}`);
  const resp = series('respiratory_rate_per_min', V.resp, (n) => `Resp ${n}`);
  const pain = series('pain_score', V.pain, (n) => `Pain ${n}`, 9);
  const bp = points.filter((p) => p.r.systolic_mmhg != null || p.r.diastolic_mmhg != null).map((p) => {
    const sys = p.r.systolic_mmhg, dia = p.r.diastolic_mmhg;
    const top = y(V.bp(sys ?? dia)), bottom = y(V.bp(dia ?? sys));
    return { x: xAt(p.at) - 9, top, bottom, id: p.r.id, text: `${whenLabel(p.t)} · BP ${sys ?? '?'}/${dia ?? '?'}${p.snapped ? '' : ' (extra check)'}` };
  });
  const line = (m: Mark[]) => m.map((p) => `${p.x},${p.y}`).join(' ');

  const hover = (m: { x: number; text: string }, top: number) => ({
    onMouseEnter: () => setTip({ left: m.x, top, text: m.text }),
    onMouseLeave: () => setTip(null),
  });
  /** Invisible, larger target over a mark: instant helper text on hover, select on click or tap. */
  const target = (m: Mark, key: string) => (
    <circle key={key} cx={m.x} cy={m.y} r="11" className="obs-hit" {...hover(m, m.y)} onClick={() => { onSelect(m.id); setTip({ left: m.x, top: m.y, text: m.text }); }}>
      <title>{m.text}</title>
    </circle>
  );

  const rounds = Array.from({ length: count }, (_, i) => first + i * iv);
  const midnights = rounds.filter((t, i) => i > 0 && new Date(t).getDate() !== new Date(rounds[i - 1]).getDate())
    .map((t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); });
  const dayStarts = [rounds[0], ...rounds.filter((t, i) => i > 0 && new Date(t).getDate() !== new Date(rounds[i - 1]).getDate())];
  const selected = points.find((p) => p.r.id === selectedId);
  const tempTicks = [34, 35, 36, 37, 38, 39, 40, 41, 42];
  const tens = Array.from({ length: 18 }, (_, i) => (i + 1) * 10);

  return (
    <div className="obs">
      <svg className="obs-axis" width={AXIS_W} height={HEIGHT} aria-hidden="true">
        <g className="obs-head">
          <text x="22" y="19" className="obs-pulse">PULSE</text><text x="22" y="33" className="obs-resp">RESP</text>
          <text x="62" y="26">BP</text>
          <text x="100" y="19">TEMP</text><text x="100" y="33">{tempUnit}</text>
          <text x="138" y="26">PAIN</text>
        </g>
        <g className="obs-ticks">
          {tens.map((v) => <text key={`p${v}`} x="22" y={y(v) + 4} className={v === 60 ? 'strong' : ''}>{v}</text>)}
          {[...tens, 190, 200].map((v) => <text key={`b${v}`} x="62" y={y(v) + 4} className={v === 60 ? 'strong' : ''}>{v + 50}</text>)}
          {tempTicks.map((c) => <text key={`t${c}`} x="100" y={y(V.temp(c)) + 4} className={c === 37 ? 'strong' : ''}>{toDisplay('temperature', c, units)}</text>)}
          {Array.from({ length: 11 }, (_, n) => <text key={`n${n}`} x="138" y={y(V.pain(n)) + 4}>{n}</text>)}
          <text x={AXIS_W - 6} y={BOTTOM + 22} className="obs-spo2-label">SpO2 %</text>
        </g>
      </svg>

      <div className="obs-scroll" ref={scroller}>
        <svg width={width} height={HEIGHT} role="img"
          aria-label={`Observation chart: temperature, pulse, respiration, blood pressure and pain for ${points.length} checks. The same values are in the table below.`}>
          <rect x="0" y={TOP} width={width} height={BOTTOM - TOP} className="obs-plot" />
          {selected && <rect x={xAt(selected.at) - COL / 2} y="26" width={COL} height={HEIGHT - 26} className="obs-selected" />}
          {Array.from({ length: V_MAX / 10 + 1 }, (_, i) => <line key={`h${i}`} x1="0" x2={width} y1={TOP + i * ROW} y2={TOP + i * ROW} className="obs-grid" />)}
          {rounds.map((t, i) => (
            <g key={t}>
              <line x1={i * COL} x2={i * COL} y1={TOP} y2={BOTTOM} className="obs-grid" />
              <line x1={i * COL + COL / 2} x2={i * COL + COL / 2} y1={TOP} y2={BOTTOM} className="obs-grid faint" />
              <text x={i * COL + COL / 2} y="43" className={`obs-time${t > now ? ' future' : ''}`}>{hhmm(t)}</text>
            </g>
          ))}
          <line x1="0" x2={width} y1={y(60)} y2={y(60)} className="obs-heavy" />
          <rect x="0" y={TOP} width={width} height={BOTTOM - TOP} className="obs-frame" />
          {midnights.map((t) => <line key={`m${t}`} x1={xAt(t)} x2={xAt(t)} y1="4" y2={HEIGHT - 4} className="obs-heavy" />)}
          {dayStarts.map((t, i) => <text key={`d${t}`} x={(i === 0 ? 0 : xAt(new Date(t).setHours(0, 0, 0, 0))) + 6} y="19" className="obs-day">{dayLabel(t)}</text>)}
          {/* Extra checks get their time at the foot of the grid, clear of the round times in the header. */}
          {points.filter((p) => !p.snapped).map((p) => (
            <g key={`x${p.r.id}`}>
              <line x1={xAt(p.at)} x2={xAt(p.at)} y1={BOTTOM - 14} y2={BOTTOM} className="obs-grid" />
              <text x={xAt(p.at)} y={BOTTOM - 17} className="obs-time extra">{hhmm(p.t)}</text>
            </g>
          ))}
          <line x1={xAt(now)} x2={xAt(now)} y1={TOP} y2={BOTTOM} className="obs-now" />
          {schedule.fromReminder && <text x={xAt(last)} y={y(100)} className="obs-time future">due</text>}

          {bp.map((b) => (
            <g key={`bp${b.id}`}>
              <path d={`M${b.x - 6} ${b.top}h12M${b.x} ${b.top}V${b.bottom}M${b.x - 6} ${b.bottom}h12`} className="obs-bp" />
              <rect x={b.x - 8} y={b.top - 4} width="16" height={b.bottom - b.top + 8} className="obs-hit" {...hover(b, b.top)}
                onClick={() => { onSelect(b.id); setTip({ left: b.x, top: b.top, text: b.text }); }}><title>{b.text}</title></rect>
            </g>
          ))}
          <polyline points={line(resp)} className="obs-line obs-resp" />
          {resp.map((m) => <circle key={`r${m.id}`} cx={m.x} cy={m.y} r="4" className="obs-resp-mark" />)}
          <polyline points={line(temp)} className="obs-line obs-temp" />
          {temp.map((m) => <path key={`t${m.id}`} d={`M${m.x} ${m.y - 6}l6 10h-12z`} className="obs-temp-mark" />)}
          <polyline points={line(pulse)} className="obs-line obs-pulse" />
          {pulse.map((m) => <circle key={`p${m.id}`} cx={m.x} cy={m.y} r="5" className="obs-pulse-mark" />)}
          <polyline points={line(pain)} className="obs-line obs-pain dashed" />
          {pain.map((m) => <path key={`n${m.id}`} d={`M${m.x - 4} ${m.y - 4}l8 8M${m.x + 4} ${m.y - 4}l-8 8`} className="obs-pain-mark" />)}
          {points.filter((p) => p.r.spo2_percent != null).map((p) => (
            <text key={`s${p.r.id}`} x={xAt(p.at)} y={BOTTOM + 22} className="obs-spo2"><title>{`${whenLabel(p.t)} · SpO2 ${p.r.spo2_percent} %`}</title>{p.r.spo2_percent}</text>
          ))}

          {resp.map((m) => target(m, `hr${m.id}`))}
          {temp.map((m) => target(m, `ht${m.id}`))}
          {pulse.map((m) => target(m, `hp${m.id}`))}
          {pain.map((m) => target(m, `hn${m.id}`))}
        </svg>
        {tip && <div className="obs-tip" role="status" style={{ left: Math.max(110, Math.min(width - 110, tip.left)), top: tip.top }}>{tip.text}</div>}
      </div>
    </div>
  );
}

export function ObservationKey() {
  return (
    <p className="obs-key">
      <strong>Key</strong>
      <span><svg aria-hidden="true" width="14" height="20" viewBox="0 0 14 20"><path d="M2 2h10M7 2v16M2 18h10" className="obs-bp" /></svg> Blood pressure</span>
      <span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M8 2l6 11H2z" className="obs-temp-mark" /></svg> Temperature</span>
      <span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" className="obs-pulse-mark" /></svg> Pulse</span>
      <span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.5" className="obs-resp-mark" /></svg> Respiration</span>
      <span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" className="obs-pain-mark" /></svg> Pain</span>
      <span className="muted">Point at a mark, or tap it, for its date, time and value.</span>
    </p>
  );
}
