# KS EMR

**KnightSoft Electronic Medical Record**: a multi-person family medical record modelled on the paper chart a hospital keeps for each patient, with a Windows 3.1 / TabWorks tabbed-binder look.

> KS EMR is a personal record-keeping tool. It is not a certified medical device and gives no medical advice.

## What it does

- **One chart per person**, with seven tabs: Face Sheet, History, Meds, Vitals, Labs, Notes, Visits & Docs
- **Face Sheet**: a one-page summary (allergies, conditions, current medications, family history, last visit, latest vitals, out-of-range labs), printable
- **Medication administration record**: prescriptions generate scheduled doses that you mark given, missed, refused or held, with remarks
- **Vitals and labs** with trend charts; metric/imperial toggle per user
- **Private by default**: each family member has a login; a chart is visible only to people it is shared with, by section and access level
- **Managed profiles** for children and parents who do not sign in
- **Temporary physician access**: an expiring, read-only account limited to chosen sections, with an access log
- **Paper-chart integrity**: entries are amended or struck out ("entered in error"), never deleted; every change is audited
- **REST API and MCP server** with flat, simple-typed schemas that small local AI models can fill in
- **HL7 FHIR R4 export** for exchange with other health systems
- **Plain-text backup and restore** (NDJSON for the whole database, JSON per chart)
- **Mobile first**, wider layout on desktop

The user's manual is in [docs/USER_MANUAL.md](docs/USER_MANUAL.md) and inside the app under **Help**.

## Quick start (development)

Requires Node.js 20 or newer.

```bash
npm install
npm run build
npm start
```

Open http://localhost:4700 and create the owner account.

To try it with made-up demo data instead (fresh install only):

```bash
node scripts/seed-demo.mjs
```

While developing, run the API with reload and the web app with hot reload in two terminals:

```bash
npm run dev
```

```bash
npm run dev:web
```

Run the tests:

```bash
npm test
```

## Deploying on Linux

1. Install Node.js 20+, git and [Caddy](https://caddyserver.com/docs/install).
2. Clone the repository on the server, for example into `/opt/ks-emr`.
3. Create the settings file and edit it (at least `KS_PUBLIC_URL` and `TZ`):

   ```bash
   cp .env.example .env
   ```

4. Run the deploy script. It installs PM2 if needed, builds, and starts the service:

   ```bash
   ./deploy/deploy.sh
   ```

5. Make it start at boot (run the command that PM2 prints):

   ```bash
   pm2 startup
   ```

6. Put HTTPS in front: edit the domain in [deploy/Caddyfile](deploy/Caddyfile), copy it to `/etc/caddy/Caddyfile`, and reload Caddy. Caddy obtains and renews the certificate automatically. Ports 80 and 443 must be open; port 4700 must **not** be exposed (the app listens on 127.0.0.1 only).

**Updating** is the same script. It takes a plain-text backup, pulls from GitHub, installs dependencies, builds, removes build-only packages, reloads PM2 and checks that the service answers:

```bash
./deploy/deploy.sh
```

Prefer systemd to PM2? Use [deploy/ks-emr.service](deploy/ks-emr.service) instead; instructions are in the file.

### Settings (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4700` | Port the app listens on. |
| `HOST` | `127.0.0.1` | Address to bind. Keep it local behind a proxy. |
| `KS_DATA_DIR` | `./data` | Database and uploaded files. |
| `KS_PUBLIC_URL` | `http://localhost:4700` | Address shown in physician share details. |
| `NODE_ENV` | | Set to `production` on the server (HTTPS-only cookies). |
| `TZ` | system | Timezone for medication schedules and "now". |

## Backup and restore

Everything is plain text.

```bash
npm run backup
```

writes `backups/ks-emr-backup-<date>-<time>.ndjson` (one JSON object per line; add `-- --with-attachments` for a `.tar.gz` of the uploaded files).

```bash
npm run restore -- backups/<file>.ndjson --yes
```

replaces the whole database with the backup. Stop the service first.

Uploaded files live in `data/attachments/<chart id>/` and can be copied with `rsync`, `scp` or SFTP. The backup file records only their names.

A nightly backup with cron:

```
0 2 * * * cd /opt/ks-emr && /usr/bin/node dist/server/cli.js backup --with-attachments >> backups/backup.log 2>&1
```

Backups contain medical records and password hashes. Store them somewhere private.

## API and MCP

Create an API token in the app under **Account**, then:

```bash
curl -H "Authorization: Bearer ksemr_..." http://localhost:4700/api/patients
```

- OpenAPI description: `GET /api/openapi.json`
- MCP over HTTP: `POST /mcp` with the same bearer token
- MCP over stdio (agent on the same machine): `KS_EMR_USER=<username> npm run mcp`
- FHIR R4 bundle: `GET /api/patients/{patient_id}/fhir`

All payloads are flat JSON objects of strings, numbers and booleans. Dates are `YYYY-MM-DD`, date-times `YYYY-MM-DDTHH:MM`, measurements metric with the unit in the field name (`weight_kg`, `systolic_mmhg`).

## How it is built

One Node.js process serves the REST API, the MCP endpoint and the built web app, backed by a single SQLite file.

```
server/src/recordTypes.ts   every chart section defined once: drives tables, validation, REST, OpenAPI, MCP and forms
server/src/records.ts       generic create / amend / strike-out, medication schedule
server/src/access.ts        who may see which chart and section; sharing; physician access
server/src/auth.ts          passwords (scrypt), sessions, API tokens, sign-in throttling
server/src/app.ts           HTTP routes
server/src/mcp.ts           MCP tools
server/src/fhir.ts          FHIR R4 export
server/src/backup.ts        plain-text backup, restore, chart export/import
server/src/cli.ts           backup / restore / reset-password commands
web/src/                    React web app (Vite)
tests/api.test.ts           end-to-end API tests
deploy/                     deploy script, Caddyfile, systemd unit
```

To add a field or a whole new chart section, edit `recordTypes.ts`; the database column, API, MCP tool and form follow from it.

## Security notes

- Passwords are hashed with scrypt; sessions are HttpOnly cookies; API tokens are stored hashed.
- Sign-in is throttled (5 failures per account, 30 per address, per 15 minutes).
- Data is **not encrypted at rest**. Anyone with access to the server's disk or the backup files can read the records. Use full-disk encryption on the server if that matters to you.
- There is no two-factor sign-in yet.
- Run it only behind HTTPS.

## Not in this version

FHIR import, HL7 v2 messaging, appointment reminders, two-factor sign-in, encryption at rest, growth-chart percentile curves.
