// Types mirror server/src/recordTypes.ts; the definitions themselves arrive from GET /api/meta.

export type FieldType = 'string' | 'text' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime' | 'enum';
export type Quantity = 'weight' | 'length' | 'temperature' | 'glucose';
/** What the screen shows. Temperature can differ from the rest (e.g. pounds and inches, but degrees C). */
export interface UnitSystem { system: 'metric' | 'imperial'; temperature: 'c' | 'f' }
export function unitsOf(u: Pick<User, 'unit_system' | 'temperature_unit'>): UnitSystem {
  const temperature = u.temperature_unit === 'c' || u.temperature_unit === 'f' ? u.temperature_unit : u.unit_system === 'imperial' ? 'f' : 'c';
  return { system: u.unit_system, temperature };
}
const sysFor = (q: Quantity, u: UnitSystem) => (q === 'temperature' ? (u.temperature === 'f' ? 'imperial' : 'metric') : u.system);

export interface FieldDef {
  name: string; label: string; type: FieldType; description: string;
  required?: boolean; values?: string[]; default?: string | number | boolean;
  min?: number; max?: number; quantity?: Quantity; readOnly?: boolean;
  suggestFrom?: { field: string; map: Record<string, string> };
}
export interface RecordTypeDef {
  key: string; tool: string; label: string; singular: string; tab: string; description: string;
  sortBy: string; columns: string[]; fields: FieldDef[];
}
export interface Meta { tabs: { key: string; label: string }[]; record_types: RecordTypeDef[]; patient_fields: FieldDef[] }
export type Rec = Record<string, any>;
export interface Patient extends Rec { id: number; full_name: string; access_level: 'manager' | 'editor' | 'viewer'; shared_sections: string }
export interface User { id: number; username: string; display_name: string; role: 'owner' | 'member' | 'guest'; unit_system: 'metric' | 'imperial'; temperature_unit: 'auto' | 'c' | 'f'; theme: string; must_change_password: boolean; expires_at: string | null; disabled: boolean }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'X-KS-EMR': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* plain text */ }
  if (!res.ok) throw new HttpError(res.status, data?.error || `Request failed (${res.status})`);
  return data as T;
}

export async function uploadFile(url: string, file: File): Promise<Rec> {
  const res = await fetch(`/api${url}`, {
    method: 'PUT',
    headers: { 'X-KS-EMR': '1', 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, data?.error || `Upload failed (${res.status})`);
  return data;
}

// ---- units: everything is stored metric; conversion happens only at the screen ----

const CONV: Record<Quantity, { metric: string; imperial: string; to: (v: number) => number; from: (v: number) => number; digits: [number, number] }> = {
  weight: { metric: 'kg', imperial: 'lb', to: (v) => v * 2.2046226, from: (v) => v / 2.2046226, digits: [1, 1] },
  length: { metric: 'cm', imperial: 'in', to: (v) => v / 2.54, from: (v) => v * 2.54, digits: [1, 1] },
  temperature: { metric: '°C', imperial: '°F', to: (v) => v * 9 / 5 + 32, from: (v) => (v - 32) * 5 / 9, digits: [1, 1] },
  // Glucose is stored in mg/dL (the US unit); metric users see mmol/L.
  glucose: { metric: 'mmol/L', imperial: 'mg/dL', to: (v) => v, from: (v) => v, digits: [1, 0] },
};
const GLUCOSE = 18.016;
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function unitLabel(q: Quantity, units: UnitSystem): string {
  return CONV[q][sysFor(q, units)];
}
/** Stored value -> number shown on screen. */
export function toDisplay(q: Quantity, v: number, units: UnitSystem): number {
  const sys = sysFor(q, units);
  if (q === 'glucose') return sys === 'metric' ? round(v / GLUCOSE, 1) : round(v, 0);
  return sys === 'metric' ? round(v, CONV[q].digits[0]) : round(CONV[q].to(v), CONV[q].digits[1]);
}
/** Number typed on screen -> stored value. */
export function fromDisplay(q: Quantity, v: number, units: UnitSystem): number {
  const sys = sysFor(q, units);
  if (q === 'glucose') return sys === 'metric' ? round(v * GLUCOSE, 1) : v;
  return sys === 'metric' ? v : round(CONV[q].from(v), 2);
}

export function fieldLabel(f: FieldDef, sys: UnitSystem): string {
  return f.quantity ? `${f.label} (${unitLabel(f.quantity, sys)})` : f.label;
}

export const pretty = (s: string) => {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
export const fmtDateTime = (s: string | null | undefined) => (s ? s.replace('T', ' ').slice(0, 16) : '');

export function fmt(f: FieldDef, v: unknown, sys: UnitSystem): string {
  if (v === null || v === undefined || v === '') return '';
  switch (f.type) {
    case 'enum': return pretty(String(v));
    case 'boolean': return v ? 'Yes' : 'No';
    case 'datetime': return fmtDateTime(String(v));
    case 'number': case 'integer':
      return f.quantity ? String(toDisplay(f.quantity, Number(v), sys)) : String(v);
    default: return String(v);
  }
}

export const today = () => new Date().toLocaleDateString('sv-SE');
export function shiftDay(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}
