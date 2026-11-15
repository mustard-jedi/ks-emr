// PM2 process file for KS EMR.
//   pm2 startOrReload ecosystem.config.cjs --env production && pm2 save
// Settings (port, data directory, public URL, timezone) are read from the .env file next to this one.
module.exports = {
  apps: [
    {
      name: 'ks-emr',
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
