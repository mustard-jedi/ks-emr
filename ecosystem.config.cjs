// PM2 process file for KS EMR.
//   pm2 startOrReload ecosystem.config.cjs --env production && pm2 save
// Settings (port, data directory, public URL, timezone) are read by the app from the .env file next to this one.
const fs = require('node:fs');
const path = require('node:path');

// The process name can be changed in .env (KS_PM2_NAME) so two installs can run under PM2 on one machine.
let name = 'ks-emr';
try {
  const m = /^\s*KS_PM2_NAME\s*=\s*["']?([A-Za-z0-9_.-]+)["']?\s*$/m.exec(fs.readFileSync(path.join(__dirname, '.env'), 'utf8'));
  if (m) name = m[1];
} catch { /* no .env yet */ }

module.exports = {
  apps: [
    {
      name,
      script: 'dist/server/index.js',
      cwd: __dirname,
      // SQLite is a single-writer database: run exactly one process.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      kill_timeout: 5000,
      time: true,
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
