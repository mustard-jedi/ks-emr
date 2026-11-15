import { localNow, localToday } from './config.js';
import type { FieldDef } from './recordTypes.js';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: string[]) {
    super(message);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Coerce one value to its field type. Lenient on purpose: small models send "120" or "Yes". */
function coerce(f: FieldDef, raw: unknown): { value?: unknown; error?: string } {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { value: null };
  switch (f.type) {
    case 'string':
    case 'text': {
      if (typeof raw === 'object') return { error: `${f.name} must be a string` };
      const s = String(raw).trim();
      const max = f.type === 'text' ? 20000 : 500;
      if (s.length > max) return { error: `${f.name} is too long (max ${max} characters)` };
      return { value: s };
    }
    case 'number':
    case 'integer': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
      if (!Number.isFinite(n)) return { error: `${f.name} must be a number` };
      if (f.type === 'integer' && !Number.isInteger(n)) return { error: `${f.name} must be a whole number` };
      if (f.min !== undefined && n < f.min) return { error: `${f.name} must be at least ${f.min}` };
      if (f.max !== undefined && n > f.max) return { error: `${f.name} must be at most ${f.max}` };
      return { value: n };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw ? 1 : 0 };
      const s = String(raw).trim().toLowerCase();
      if (['true', 'yes', '1', 'y'].includes(s)) return { value: 1 };
      if (['false', 'no', '0', 'n'].includes(s)) return { value: 0 };
      return { error: `${f.name} must be true or false` };
    }
    case 'date': {
      const s = String(raw).trim().slice(0, 10);
      if (!DATE_RE.test(s) || !isRealDate(s)) return { error: `${f.name} must be a date like 2026-01-31 (YYYY-MM-DD)` };
      return { value: s };
    }
    case 'datetime': {
      const s = String(raw).trim();
      if (DATE_RE.test(s) && isRealDate(s)) return { value: `${s}T00:00` };
      const m = DATETIME_RE.exec(s);
      if (!m || !isRealDate(m[1])) return { error: `${f.name} must be a date and time like 2026-01-31T08:30 (YYYY-MM-DDTHH:MM)` };
      // A value with an explicit offset is converted to server wall-clock time.
      if (m[5]) return { value: localNow(new Date(s.replace(' ', 'T'))) };
      return { value: `${m[1]}T${m[2]}` };
    }
    case 'enum': {
      const s = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (!f.values!.includes(s)) return { error: `${f.name} must be one of: ${f.values!.join(', ')}` };
      return { value: s };
    }
  }
}

/**
 * Validate a flat input object against field definitions.
 * create: applies defaults and checks required fields. update: only touches fields that are present.
 */
export function validateInput(fields: FieldDef[], input: unknown, mode: 'create' | 'update'): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'Request body must be a JSON object');
  const src = input as Record<string, unknown>;
  const writable = fields.filter((f) => !f.readOnly);
  const names = new Set(writable.map((f) => f.name));
  const errors: string[] = [];
  for (const k of Object.keys(src)) {
    if (!names.has(k)) errors.push(`Unknown field "${k}". Allowed fields: ${[...names].join(', ')}`);
  }
  const out: Record<string, unknown> = {};
  for (const f of writable) {
    const present = Object.prototype.hasOwnProperty.call(src, f.name);
    if (!present && mode === 'update') continue;
    const r = coerce(f, src[f.name]);
    if (r.error) { errors.push(r.error); continue; }
    let v = r.value;
    if (v === null && mode === 'create' && f.default !== undefined) {
      v = f.default === 'now' ? localNow() : f.default === 'today' ? localToday() : f.default;
    }
    if (v === null && f.required) { errors.push(`${f.name} is required`); continue; }
    out[f.name] = v;
  }
  if (errors.length) throw new ApiError(400, errors.join('; '), errors);
  return out;
}

/** JSON Schema for a flat field list. Used by both OpenAPI and MCP so they never drift. */
export function jsonSchema(fields: FieldDef[], mode: 'create' | 'update' | 'output') {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    if (f.readOnly && mode !== 'output') continue;
    const p: Record<string, unknown> = { description: f.description };
    if (f.type === 'number') p.type = 'number';
    else if (f.type === 'integer') p.type = 'integer';
    else if (f.type === 'boolean') p.type = 'boolean';
    else p.type = 'string';
    if (f.type === 'enum') p.enum = f.values;
    if (f.type === 'date') p.description = `${f.description} Format: YYYY-MM-DD.`;
    if (f.type === 'datetime') p.description = `${f.description} Format: YYYY-MM-DDTHH:MM (24-hour local time).`;
    if (f.default !== undefined && mode === 'create') p.description = `${p.description} Default: ${f.default}.`;
    properties[f.name] = p;
    if (mode === 'create' && f.required && f.default === undefined) required.push(f.name);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

export function requireString(v: unknown, name: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim()) throw new ApiError(400, `${name} is required`);
  if (v.length > max) throw new ApiError(400, `${name} is too long`);
  return v.trim();
}

export function requireInt(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, `${name} must be a positive whole number`);
  return n;
}
