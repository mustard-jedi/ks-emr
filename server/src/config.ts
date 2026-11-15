import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Project root: two levels above server/src (dev) or dist/server (built). */
export const ROOT = path.resolve(here, '..', '..');

// Minimal .env loader so PM2, systemd and plain `node` all behave the same.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const VERSION = '0.1.0';
export const PORT = Number(process.env.PORT || 4700);
export const HOST = process.env.HOST || '127.0.0.1';
export const PRODUCTION = process.env.NODE_ENV === 'production';
export const DATA_DIR = path.resolve(ROOT, process.env.KS_DATA_DIR || './data');
export const ATTACH_DIR = path.join(DATA_DIR, 'attachments');
export const DB_FILE = path.join(DATA_DIR, 'ks-emr.db');
export const PUBLIC_URL = (process.env.KS_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
export const WEB_DIR = path.join(ROOT, 'dist', 'web');
export const MANUAL_FILE = path.join(ROOT, 'docs', 'USER_MANUAL.md');
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Local wall-clock "YYYY-MM-DDTHH:MM" in the server timezone (set TZ). */
export function localNow(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function localToday(): string {
  return localNow().slice(0, 10);
}
export function utcNow(): string {
  return new Date().toISOString();
}
