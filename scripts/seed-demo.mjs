#!/usr/bin/env node
/**
 * Fill a FRESH KS EMR install with made-up demo data, for trying the app out.
 * Never run this against a real install: it only works when no account exists yet.
 *
 *   node scripts/seed-demo.mjs [http://localhost:4700]
 *
 * Demo sign-in: username "demo", password "demo-password-1" (change it, or delete ./data afterwards).
 */
const base = (process.argv[2] || 'http://localhost:4700').replace(/\/$/, '');
const DEMO = { username: 'demo', display_name: 'Alex Knight', password: 'demo-password-1' };
let cookie = '';

async function call(method, url, body) {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'X-KS-EMR': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${url}: ${data.error}`);
  return data;
}

const day = (offset) => new Date(Date.now() + offset * 86400_000).toLocaleDateString('sv-SE');

const status = await call('GET', '/status');
if (!status.needs_setup) {
  console.error('This install already has accounts. The demo seed only runs on a fresh install.');
  process.exit(1);
}
await call('POST', '/setup', DEMO);
const me = await call('GET', '/me');
const id = me.patients[0].id;
const add = (type, body, pid = id) => call('POST', `/patients/${pid}/${type}`, body);

await call('PATCH', `/patients/${id}`, { date_of_birth: '1978-04-12', sex: 'male', blood_type: 'o_positive', important_notes: 'Type 2 diabetic. Wears contact lenses.' });
await add('allergies', { substance: 'Penicillin', reaction: 'Hives, swelling', severity: 'severe', noted_date: '1995-06-01' });
await add('allergies', { substance: 'Shellfish', reaction: 'Itching', severity: 'mild' });
await add('conditions', { name: 'Type 2 diabetes', clinical_status: 'chronic', onset_date: '2019-03-10' });
await add('conditions', { name: 'Hypertension', clinical_status: 'chronic', onset_date: '2021-09-02' });
await add('conditions', { name: 'Broken wrist', clinical_status: 'resolved', onset_date: '2010-07-01', resolved_date: '2010-09-15' });
await add('family_history', { relation: 'father', condition: 'Heart attack', age_at_onset: 58, is_deceased: true });
await add('family_history', { relation: 'mother', condition: 'Type 2 diabetes', age_at_onset: 50 });
await add('procedures', { name: 'Appendectomy', procedure_date: '2002-11-20', facility: 'City General Hospital' });
await add('immunizations', { vaccine: 'Influenza', date_given: day(-300), next_due_date: day(40) });
await add('immunizations', { vaccine: 'Tetanus (Td)', date_given: '2019-05-05', next_due_date: '2029-05-05' });

await add('prescriptions', { medication_name: 'Metformin 500 mg tablet', dose_amount: 1, dose_unit: 'tablet', route: 'oral', frequency: 'twice_daily', schedule_times: '08:00,20:00', start_date: day(-90), prescriber_name: 'Dr. Rivera', indication: 'Diabetes', instructions: 'Take with food' });
await add('prescriptions', { medication_name: 'Lisinopril 10 mg tablet', dose_amount: 1, dose_unit: 'tablet', route: 'oral', frequency: 'once_daily', schedule_times: '08:00', start_date: day(-60), prescriber_name: 'Dr. Rivera', indication: 'Blood pressure' });
await add('prescriptions', { medication_name: 'Ibuprofen 200 mg', dose_amount: 2, dose_unit: 'tablet', route: 'oral', frequency: 'as_needed', start_date: day(-10), indication: 'Headache' });

const bp = [[142, 92, 84.2, 148], [138, 88, 83.6, 139], [135, 86, 83.1, 131], [131, 84, 82.4, 126], [128, 82, 81.9, 118]];
for (let i = 0; i < bp.length; i++) {
  const [systolic_mmhg, diastolic_mmhg, weight_kg, blood_glucose_mg_dl] = bp[i];
  await add('vitals', { recorded_at: `${day(-28 + i * 7)}T07:30`, systolic_mmhg, diastolic_mmhg, heart_rate_bpm: 76 - i, weight_kg, height_cm: 178, blood_glucose_mg_dl, glucose_context: 'fasting', temperature_c: 36.7, spo2_percent: 98 });
}
const a1c = [[-270, 7.9], [-180, 7.4], [-90, 7.0], [-5, 6.6]];
for (const [offset, value_number] of a1c) {
  await add('lab_results', { test_name: 'Hemoglobin A1c', collected_date: day(offset), value_number, unit: '%', reference_low: 4, reference_high: 5.6, lab_name: 'City Lab', panel_name: 'Diabetes' });
}
await add('lab_results', { test_name: 'LDL cholesterol', collected_date: day(-5), value_number: 96, unit: 'mg/dL', reference_low: 0, reference_high: 100, lab_name: 'City Lab', panel_name: 'Lipid panel' });
await add('lab_results', { test_name: 'Urine protein', collected_date: day(-5), value_text: 'Negative', lab_name: 'City Lab' });
await add('visits', { visit_date: day(-5), visit_type: 'checkup', provider_name: 'Dr. Rivera', facility: 'Lakeside Family Clinic', reason: 'Diabetes follow-up', diagnosis: 'Improving control', summary: 'A1c down again. Keep current doses. Recheck in three months.', follow_up_date: day(85) });
await add('notes', { note_type: 'symptom', text: 'Mild headache in the afternoon, gone after water and rest.' });
await add('notes', { noted_at: `${day(-5)}T16:00`, note_type: 'progress', text: 'Clinic visit went well. Doctor happy with the home blood pressure log.' });
await add('contacts', { contact_type: 'emergency_contact', name: 'Sam Knight', relationship_or_specialty: 'Spouse', phone: '555-0100' });
await add('contacts', { contact_type: 'primary_doctor', name: 'Dr. Rivera', relationship_or_specialty: 'Family medicine', phone: '555-0142' });
await add('contacts', { contact_type: 'insurance', name: 'Example Health Plan', policy_number: 'XH-0000000' });

// A managed profile: a child with no login of their own.
const kid = await call('POST', '/patients', { full_name: 'Robin Knight', date_of_birth: '2021-02-03', sex: 'female' });
for (const [offset, weight_kg, height_cm] of [[-700, 10.1, 76], [-400, 12.3, 86], [-150, 14.0, 93], [-10, 15.2, 98]]) {
  await add('vitals', { recorded_at: `${day(offset)}T10:00`, weight_kg, height_cm }, kid.id);
}
await add('immunizations', { vaccine: 'MMR', date_given: '2022-02-10', dose_number: 1, next_due_date: '2025-02-03' }, kid.id);
await add('allergies', { substance: 'Peanuts', reaction: 'Rash', severity: 'moderate' }, kid.id);

console.log(`Demo data loaded. Open ${base} and sign in as "${DEMO.username}" (password is in scripts/seed-demo.mjs).`);
