import { useCallback, useEffect, useState, type ReactNode } from 'react';

/** Windows 3.1 style modal dialog. */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`window dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="titlebar">
          <button className="sysbtn" onClick={onClose} aria-label="Close" title="Close">&#x2500;</button>
          <span className="title">{title}</span>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

export function ErrorLine({ error }: { error: string | null | undefined }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}

/** Load data, and reload when deps change or reload() is called. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fn().then((d) => { if (live) { setData(d); setError(null); } }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}

/** Run an action with busy and error state, for buttons and forms. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); return true; } catch (e: any) { setError(e.message || 'Something went wrong'); return false; } finally { setBusy(false); }
  }, []);
  return { busy, error, run, setError };
}

// ---- trend chart -----------------------------------------------------------

export interface Series { name: string; points: { x: string; y: number }[] }
const SERIES_COLORS = ['#000080', '#800000', '#008000'];

/** Small line chart drawn in plain SVG. x values are ISO dates or date-times. */
export function TrendChart({ series, unit, low, high }: { series: Series[]; unit: string; low?: number | null; high?: number | null }) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return <p className="muted">At least two readings are needed to draw a trend.</p>;
  const W = 600, H = 260, L = 58, R = 14, T = 14, B = 36;
  const xs = all.map((p) => Date.parse(p.x));
  const ys = all.map((p) => p.y).concat(low != null ? [low] : [], high != null ? [high] : []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = (y1 - y0) * 0.1 || 1;
  y0 -= pad; y1 += pad;
  const px = (x: string) => L + ((Date.parse(x) - x0) / (x1 - x0 || 1)) * (W - L - R);
  const py = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const ticks = [0, 1, 2, 3, 4].map((i) => y0 + ((y1 - y0) * i) / 4);
  const digits = y1 - y0 < 10 ? 1 : 0;
  const firstDay = new Date(x0).toLocaleDateString('sv-SE');
  const lastDay = new Date(x1).toLocaleDateString('sv-SE');
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Trend of ${series.map((s) => s.name).join(' and ')}`}>
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="#fff" stroke="#000" />
        {low != null && high != null && <rect x={L} y={py(high)} width={W - L - R} height={Math.max(0, py(low) - py(high))} fill="#c0e8c0" />}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} stroke="#c0c0c0" strokeDasharray="2 3" />
            <text x={L - 6} y={py(t) + 5} textAnchor="end" fontSize="16">{t.toFixed(digits)}</text>
          </g>
        ))}
        {series.map((s, i) => {
          const pts = [...s.points].sort((a, b) => Date.parse(a.x) - Date.parse(b.x));
          return (
            <g key={s.name}>
              <polyline fill="none" stroke={SERIES_COLORS[i % 3]} strokeWidth="2" points={pts.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} />
              {pts.map((p, j) => (
                <rect key={j} x={px(p.x) - 3} y={py(p.y) - 3} width="6" height="6" fill={SERIES_COLORS[i % 3]}>
                  <title>{`${s.name}: ${p.y} ${unit} on ${p.x.replace('T', ' ')}`}</title>
                </rect>
              ))}
            </g>
          );
        })}
        <text x={L} y={H - 12} fontSize="16">{firstDay}</text>
        <text x={W - R} y={H - 12} fontSize="16" textAnchor="end">{lastDay}</text>
      </svg>
      <figcaption>
        {series.map((s, i) => <span key={s.name}><i style={{ background: SERIES_COLORS[i % 3] }} /> {s.name}</span>)}
        <span>Unit: {unit}</span>
        {low != null && high != null && <span><i style={{ background: '#c0e8c0' }} /> Normal range</span>}
      </figcaption>
    </figure>
  );
}

// ---- markdown (just enough for the user manual; builds elements, never raw HTML) ----

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={m.index}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={m.index}>{t.slice(1, -1)}</code>);
    else {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!;
      const safe = /^(https?:|\/|#)/.test(href);
      out.push(safe ? <a key={m.index} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{label}</a> : label);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(<pre key={i}>{code.join('\n')}</pre>);
    } else if (/^#{1,4} /.test(line)) {
      const level = line.indexOf(' ');
      const content = line.slice(level + 1);
      const Tag = `h${Math.min(level + 1, 5)}` as 'h2';
      out.push(<Tag key={i} id={slug(content)}>{inline(content)}</Tag>);
      i++;
    } else if (/^\s*([-*]|\d+\.) /.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].replace(/^\s*([-*]|\d+\.) /, ''))}</li>);
        i++;
      }
      out.push(ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>);
    } else if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!/^\|[\s|:-]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split('|').map((c) => c.trim()));
        i++;
      }
      out.push(
        <div className="table-wrap" key={i}>
          <table className="grid plain">
            <thead><tr>{rows[0].map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
            <tbody>{rows.slice(1).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else if (line.startsWith('> ')) {
      out.push(<blockquote key={i}>{inline(line.slice(2))}</blockquote>);
      i++;
    } else if (!line.trim()) {
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4} |```|\||> |\s*([-*]|\d+\.) )/.test(lines[i])) para.push(lines[i++]);
      out.push(<p key={i}>{inline(para.join(' '))}</p>);
    }
  }
  return <div className="markdown">{out}</div>;
}
