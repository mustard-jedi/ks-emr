import { createApp } from './app.js';
import { DATA_DIR, HOST, PORT, PRODUCTION, VERSION } from './config.js';
import { getDb } from './db.js';
import { countUsers } from './auth.js';

getDb();
const app = createApp();
const server = app.listen(PORT, HOST, () => {
  console.log(`KS EMR ${VERSION} listening on http://${HOST}:${PORT} (${PRODUCTION ? 'production' : 'development'})`);
  console.log(`Data directory: ${DATA_DIR}`);
  if (countUsers() === 0) console.log('No accounts yet: open the app in a browser to create the owner account.');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      getDb().close();
      process.exit(0);
    });
  });
}
