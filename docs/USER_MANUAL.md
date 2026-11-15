# KS EMR User's Manual

KS EMR (KnightSoft Electronic Medical Record) keeps your family's health records in one place, laid out like the paper chart a hospital keeps at the nurses' station: a binder with coloured tab dividers, one binder per person.

> KS EMR is a record-keeping tool. It does not give medical advice and is not a certified medical device. In an emergency, call your local emergency number.

## 1. Getting started

### First run

The first time anyone opens KS EMR it asks you to create an account. That first account is the **owner**. The owner can add accounts for the rest of the family and gets their own chart straight away.

### Signing in

Type your username and password. After five wrong passwords the account is locked for 15 minutes.

If the owner gave you a temporary password, you are asked to choose your own before you can continue.

### Who sees what

- Every family member has their own account and their own chart.
- **A chart is private until it is shared.** Nobody else can open your chart, not even the owner, unless you share it.
- The owner manages accounts (adding people, resetting passwords). The owner does not get access to anyone's chart by being owner.

## 2. The screen

| Part | What it is for |
|---|---|
| Title bar | Shows whose chart is open. |
| Menu bar | **Chart** picker, **New chart**, **Units**, **Share**, **Account**, **Family** (owner only), **Help**, **Sign out**. |
| Patient strip | Name, age, sex, date of birth and blood type. **Edit details** changes them. |
| Tabs | The seven dividers of the binder. |
| Status bar | Who you are signed in as and what you may do in this chart. |

On a phone the tabs scroll sideways and tables turn into stacked cards. On a computer the chart opens as a wide window.

### The seven tabs

| Tab | What is on it |
|---|---|
| **Face Sheet** | The one-page summary, plus contacts and providers. |
| **History** | Allergies, conditions, family history, procedures and surgeries, immunizations. |
| **Meds** | The medication administration record (today's doses) and prescriptions. |
| **Vitals** | Vital signs with a trend chart, and intake and output. |
| **Labs** | Lab results with flags and a trend chart. |
| **Notes** | Dated notes: nursing, progress, symptoms, general. |
| **Visits & Docs** | Visits and uploaded documents. |

A section with nothing in it shrinks to a small **+ Add** button at the bottom of its tab, so empty sections do not clutter the page.

## 3. The Face Sheet

The Face Sheet answers the questions a doctor, a paramedic or a babysitter asks first:

- **Alerts & Allergies**, including the Important notes from the patient details
- **Existing Conditions** (active and chronic ones)
- **Current Medications**, and how many of today's doses are given or still due
- **Latest Vital Signs**, each with the time it was taken
- **Visits**: the last visit and the next follow-up date
- **Family History**
- **Out-of-Range Lab Results**: the latest result of each test, shown only when it is outside its normal range
- **Immunizations Due** in the next 60 days
- **Procedures & Surgeries**
- **Contacts & Providers**: emergency contacts, doctors, pharmacy, insurance

Click a box title to jump to the tab where that information lives. **Print** produces a clean one-page copy to take to an appointment.

## 4. Adding and correcting entries

### Add

Press **+ Add** in a section, fill in what you know, and press **Add**. Only fields marked with * are required. Dates and times default to now.

### Amend

Click an entry to open it, change it, and press **Save changes**. The previous values are kept in the access log, so nothing is lost.

### Entered in error

Chart entries are never deleted. If an entry is simply wrong (wrong person, typo that makes it meaningless), open it, press **Entered in error...**, and give a reason. The entry is struck out and disappears from normal view. Tick **Show struck-out** in a section to see struck-out entries again.

## 5. Medications

### Prescriptions

Add each medicine as a prescription: name, dose, how often, and at what times. Times use the 24-hour clock, separated by commas, for example `08:00,20:00`. If you leave the times empty, sensible defaults are used.

Use frequency **As needed** for medicines taken only when required. They do not appear on the schedule.

When a medicine is finished or stopped, open the prescription and set its status to **Completed** or **Stopped**. Doses already recorded are kept; future ones are removed.

### The medication administration record

The top of the Meds tab lists every dose due on the chosen day. For each dose press:

- **Given** to record it as taken now, by you
- **Missed**, **Refused** or **Held** to open a small form where you can add **remarks** ("felt dizzy", "asleep", "doctor said to skip")

Click any dose to change its status, the time it was given, who gave it, or the remarks.

A dose whose time has passed without being recorded shows as **Overdue**.

**+ Unscheduled dose** records a one-off: an as-needed medicine, or something bought over the counter.

Use the arrows or the date box to look at another day.

## 6. Vital signs and units

Record only what you measured; every measurement is optional. The chart at the top shows the trend of any measurement. For children, the weight and height trends serve as a simple growth chart (there are no percentile curves yet).

**Intake & Output** tracks fluids in and out in millilitres, with today's totals and balance.

### Metric or imperial

The **Units** button in the menu bar switches between metric (kg, cm, degrees C, mmol/L) and imperial (lb, in, degrees F, mg/dL). The choice is yours alone and is remembered. It changes only what you see and type: records are always stored in metric, so two people using different units see the same data.

## 7. Lab results and documents

Enter one row per test: the test name, the value, its unit, and the normal range printed on the report. KS EMR flags the result **Low**, **High** or **Normal** from the range. A test with two or more numeric results gets a trend chart with the normal range shaded.

To keep the original report:

1. On **Visits & Docs**, add a **Document** entry (date, type, title).
2. Press **Attach file** on that entry and choose a PDF or photo (up to 25 MB).
3. Optionally, open a lab result and pick that document under **Document ID**. A **[report]** link then appears beside the test.

Files are stored on the server under a meaningful name: document date, upload time, document type and entry number, for example `20261104-143210_lab_report_12.pdf`.

## 8. Charts for children and parents

Press **New chart** to create a chart for someone who does not sign in themselves: a child, an elderly parent. You become its **manager**.

To let another adult look after the same chart, share it with them as **Manager** (co-guardian).

When the person is old enough for their own account, the owner creates an account for them with **Create their own chart** unticked, and you share the chart with them as **Manager**.

## 9. Sharing

Open the chart and press **Share**. Only a manager of a chart can share it.

### With a family member

Choose the person, the access level, and which sections they may see.

| Level | Can do |
|---|---|
| Viewer | Read the chosen sections. |
| Editor | Read and add or amend entries in the chosen sections. |
| Manager | Everything, including sharing. |

**Remove** takes the access away at once.

### Temporary access for a physician

1. Under **Temporary access for a physician**, type who it is for, how many days it should last (1 to 90, normally 7), and tick the sections to share.
2. Press **Create physician access**.
3. KS EMR shows a web address, a one-time username and a password. **Copy them now**: the password is never shown again. Give them to the physician.

The physician can read and print the chosen sections and nothing else. They cannot change anything. The account stops working on the expiry date, or the moment you press **Remove**. Every page the physician opens is written to the **Access log** at the bottom of the Share window.

## 10. Backup and restore

### One chart (from the web app)

In **Share**, **Download chart (JSON)** saves the whole chart as a plain-text file you can read in any text editor. **Import a chart file** loads such a file as a new chart that you manage. Uploaded files are not inside the export; only their names are.

### Everything (on the server)

The person who runs the server can back up every account and every chart into one plain-text file:

```
npm run backup
```

This writes `backups/ks-emr-backup-<date>-<time>.ndjson`: one line of JSON per record. Add `-- --with-attachments` to also pack the uploaded files into a `.tar.gz` beside it.

To restore, stop the service and run:

```
npm run restore -- backups/ks-emr-backup-20261115-020000.ndjson --yes
```

Restore **replaces** everything in the database with the contents of the file.

### Uploaded files

Uploaded PDFs and photos live in the `data/attachments` folder on the server, one sub-folder per chart. Copy that folder with any tool you like, for example:

```
rsync -av user@your-server:/opt/ks-emr/data/attachments/ ./ks-emr-attachments/
```

SFTP clients such as FileZilla or WinSCP work too.

## 11. Exchanging records with other health systems

In **Share**, **Download HL7 FHIR bundle** exports the chart in FHIR R4, the current HL7 standard that hospital systems and patient portals read. The bundle contains the patient, allergies, conditions, family history, procedures, immunizations, medication orders and doses, vital signs (with LOINC codes), lab results, visits and document references.

Importing records from a hospital system is not available yet.

## 12. AI agents and scripts

KS EMR can be used by programs as well as people.

1. Open **Account** and create an **API token**. Tick **Read only** if the program should only look. Copy the token; it is shown once.
2. The program sends the token with every request: `Authorization: Bearer ksemr_...`

A token acts as you and sees every chart you can see. Revoke it under **Account** when it is no longer needed.

### REST API

The address is `/api` on your server, and a machine-readable description is at `/api/openapi.json`. Example:

```
curl -H "Authorization: Bearer ksemr_..." https://emr.example.com/api/patients

curl -X POST https://emr.example.com/api/patients/1/vitals \
  -H "Authorization: Bearer ksemr_..." -H "Content-Type: application/json" \
  -d '{"systolic_mmhg": 128, "diastolic_mmhg": 82, "heart_rate_bpm": 72}'
```

### MCP (Model Context Protocol)

AI assistants that speak MCP connect to `/mcp` on your server with the same token. Example configuration:

```
{
  "mcpServers": {
    "ks-emr": {
      "type": "http",
      "url": "https://emr.example.com/mcp",
      "headers": { "Authorization": "Bearer ksemr_..." }
    }
  }
}
```

An assistant running on the server itself can use the local version instead: `KS_EMR_USER=<username> npm run mcp`.

The tools are simple on purpose so that small local models can use them: `list_patients`, `get_patient_summary`, one `list_...` and one `add_...` tool per section, `list_doses_for_day`, `record_dose`, `stop_prescription` and `mark_entered_in_error`. Every tool takes a flat list of plain values. Dates are `YYYY-MM-DD`, date-times are `YYYY-MM-DDTHH:MM`, and measurements are always metric.

## 13. Accounts (owner)

**Family** in the menu bar lists the family accounts.

- **Add a family member**: choose a username and a temporary password of at least 10 characters. They choose their own password at first sign-in.
- **Reset password**: sets a new temporary password and signs the person out everywhere.
- **Disable**: stops the account from signing in without removing any records.

If the owner forgets their own password, the person who runs the server can run `npm run cli -- reset-password <username>`.

## 14. Privacy and security

- Use a long password that you do not use anywhere else.
- Always reach KS EMR through its `https://` address.
- Charts are private inside the app, but the records are not encrypted on the server's disk. Whoever administers the server can read the database file and the backups. Keep the server and the backup files somewhere you trust.
- There is no two-step sign-in yet.
- Physician accounts expire by themselves, but remove them when the visit is over.
- Sign out on shared computers.

## 15. Questions

**I added something to the wrong person.** Open the entry, press **Entered in error...**, then add it to the right chart.

**The times on the medication schedule are off by some hours.** The server's timezone is wrong. Ask whoever runs it to set `TZ` in the `.env` file.

**I lost a physician's password.** Remove that access and create a new one.

**Can two people edit a chart at once?** Yes. Each save changes only the fields you changed.

**A tab is missing.** If a chart is shared with you read-only, tabs with nothing in them (or nothing shared with you) are hidden.
