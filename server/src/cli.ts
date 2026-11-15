#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ATTACH_DIR, DATA_DIR, ROOT } from './config.js';
import { endSessionsFor, hashPassword, randomCode } from './auth.js';
import { backupTo, restoreFrom } from './backup.js';
import { getDb, type Row } from './db.js';

const HELP = `KS EMR command line

  ks-emr backup [file] [--with-attachments]   Write every record to one plain-text NDJSON file.
                                              Default: backups/ks-emr-backup-<date>-<time>.ndjson
                                              --with-attachments also writes a .tar.gz of the uploaded files.
  ks-emr restore <file> --yes                 REPLACE the whole database with a backup file.
  ks-emr reset-password <username>            Set a new temporary password for a family account.
  ks-emr users                                List accounts.

Data directory: ${DATA_DIR}
Uploaded files: ${ATTACH_DIR}  (copy with scp, rsync or SFTP)`;

const [cmd, ...args] = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const stamp = () => new Date().toLocaleString('sv-SE').replace(/[-:]/g, '').replace(' ', '-');
const table = (counts: Record<string, number>) => Object.entries(counts).filter(([, n]) => n).map(([t, n]) => `  ${t}: ${n}`).join('\n');

async function main() {
  switch (cmd) {
    case 'backup': {
      const file = path.resolve(positional[0] || path.join(ROOT, 'backups', `ks-emr-backup-${stamp()}.ndjson`));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const counts = backupTo(file);
      console.log(`Backup written: ${file}\n${table(counts)}`);
      if (flags.has('--with-attachments')) {
        const tar = file.replace(/\.ndjson$/, '') + '-attachments.tar.gz';
        const r = spawnSync('tar', ['-czf', tar, '-C', DATA_DIR, 'attachments'], { stdio: 'inherit' });
        if (r.status !== 0) throw new Error('tar failed; copy the attachments folder by hand');
        fs.chmodSync(tar, 0o600);
        console.log(`Attachments written: ${tar}`);
      } else {
        console.log(`Uploaded files are not in this file. They live in ${ATTACH_DIR}`);
      }
      break;
    }
    case 'restore': {
      const file = positional[0];
      if (!file) throw new Error('Usage: ks-emr restore <file> --yes');
      if (!flags.has('--yes')) throw new Error('Restore REPLACES every account and record. Stop the server, then add --yes to confirm.');
      const counts = await restoreFrom(path.resolve(file));
      console.log(`Restored from ${file}\n${table(counts)}\nEveryone must sign in again.`);
      break;
    }
    case 'reset-password': {
      const username = positional[0];
      const db = getDb();
      const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '') as Row | undefined;
      if (!u) throw new Error(`No account named "${username}"`);
      const password = randomCode(3);
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, disabled = 0 WHERE id = ?').run(hashPassword(password), u.id);
      endSessionsFor(u.id);
      console.log(`Temporary password for ${u.username}: ${password}\nThey will be asked to choose a new one at next sign-in.`);
      break;
    }
    case 'users': {
      for (const u of getDb().prepare('SELECT * FROM users ORDER BY id').all() as Row[]) {
        console.log(`${String(u.id).padStart(3)}  ${u.username.padEnd(20)} ${u.role.padEnd(7)} ${u.disabled ? 'disabled' : ''} ${u.expires_at ? `expires ${u.expires_at}` : ''}`);
      }
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
