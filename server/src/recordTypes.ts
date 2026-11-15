/**
 * The single source of truth for every chart page.
 *
 * Each record type below drives: the SQLite table, input validation, the REST
 * routes, the OpenAPI document, the MCP tools, backup/restore and the web forms.
 *
 * Rules that keep payloads easy for small local AI models:
 *  - flat objects only (no nesting, no arrays)
 *  - only string, number, integer, boolean
 *  - dates are strings "YYYY-MM-DD"; date-times are strings "YYYY-MM-DDTHH:MM"
 *  - field names carry their unit (weight_kg, amount_ml)
 *  - closed lists are enums of lowercase_snake_case words
 */

export type FieldType = 'string' | 'text' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime' | 'enum';
export type Quantity = 'weight' | 'length' | 'temperature' | 'glucose';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  description: string;
  required?: boolean;
  values?: string[];
  /** Value used when the field is omitted on create. "now" / "today" are resolved at write time. */
  default?: string | number | boolean;
  min?: number;
  max?: number;
  /** Stored metric; the web UI converts for display when the user picks imperial. */
  quantity?: Quantity;
  /** Set by the server, never accepted as input. */
  readOnly?: boolean;
  /** Suggested value that follows another field: used when this field is left empty, and prefilled (still editable) in the web form. */
  suggestFrom?: { field: string; map: Record<string, string> };
}

export interface RecordTypeDef {
  key: string;
  /** Used in MCP tool names: add_<tool>. */
  tool: string;
  label: string;
  singular: string;
  tab: string;
  description: string;
  sortBy: string;
  /** Columns shown in list views, in order. */
  columns: string[];
  fields: FieldDef[];
}

type Opt = Partial<Omit<FieldDef, 'name' | 'label' | 'type' | 'description'>>;
const mk = (type: FieldType) => (name: string, label: string, description: string, opt: Opt = {}): FieldDef => ({
  name, label, type, description, ...opt,
});
/** Suggested clock times per frequency. Only a starting point: any times can be typed instead. */
export const SUGGESTED_TIMES: Record<string, string> = {
  once_daily: '08:00', twice_daily: '08:00,20:00', three_times_daily: '06:00,14:00,22:00',
  four_times_daily: '06:00,12:00,18:00,22:00', every_other_day: '08:00', weekly: '08:00',
};
const str = mk('string');
const text = mk('text');
const num = mk('number');
const int = mk('integer');
const bool = mk('boolean');
const date = mk('date');
const datetime = mk('datetime');
const enm = (name: string, label: string, description: string, values: string[], opt: Opt = {}): FieldDef => ({
  name, label, type: 'enum', description, values, ...opt,
});
const req: Opt = { required: true };
const notes = text('notes', 'Notes', 'Free-text remarks.');

export const TABS = [
  { key: 'face', label: 'Face Sheet' },
  { key: 'history', label: 'History' },
  { key: 'meds', label: 'Meds' },
  { key: 'vitals', label: 'Vitals' },
  { key: 'labs', label: 'Labs' },
  { key: 'notes', label: 'Notes' },
  { key: 'visits', label: 'Visits & Docs' },
] as const;

export const RECORD_TYPES: RecordTypeDef[] = [
  {
    key: 'allergies', tool: 'allergy', label: 'Allergies', singular: 'Allergy', tab: 'history',
    description: 'Allergies and adverse reactions to medicines, foods or other substances.',
    sortBy: 'substance', columns: ['substance', 'reaction', 'severity', 'noted_date'],
    fields: [
      str('substance', 'Substance', 'What the person is allergic to, e.g. "Penicillin" or "Peanuts".', req),
      str('reaction', 'Reaction', 'What happens, e.g. "Hives" or "Anaphylaxis".'),
      enm('severity', 'Severity', 'How serious the reaction is.', ['mild', 'moderate', 'severe', 'life_threatening']),
      date('noted_date', 'First noted', 'Date the allergy was first noticed.'),
      notes,
    ],
  },
  {
    key: 'conditions', tool: 'condition', label: 'Conditions', singular: 'Condition', tab: 'history',
    description: 'Problem list: diagnoses and ongoing or past health conditions.',
    sortBy: 'onset_date', columns: ['name', 'clinical_status', 'onset_date', 'resolved_date'],
    fields: [
      str('name', 'Condition', 'Name of the condition, e.g. "Type 2 diabetes".', req),
      enm('clinical_status', 'Status', 'active = current, chronic = long-term and ongoing, resolved = no longer a problem.',
        ['active', 'chronic', 'resolved'], { required: true, default: 'active' }),
      date('onset_date', 'Onset', 'Date the condition started or was diagnosed.'),
      date('resolved_date', 'Resolved', 'Date the condition ended, if resolved.'),
      notes,
    ],
  },
  {
    key: 'family_history', tool: 'family_history', label: 'Family History', singular: 'Family history entry', tab: 'history',
    description: 'Health conditions of blood relatives.',
    sortBy: 'relation', columns: ['relation', 'condition', 'age_at_onset', 'is_deceased'],
    fields: [
      enm('relation', 'Relative', 'Which blood relative.',
        ['mother', 'father', 'sister', 'brother', 'grandmother', 'grandfather', 'aunt', 'uncle', 'child', 'other'], req),
      str('condition', 'Condition', 'The relative\'s condition, e.g. "Heart attack".', req),
      int('age_at_onset', 'Age at onset', 'Relative\'s age in years when the condition started.', { min: 0, max: 130 }),
      bool('is_deceased', 'Deceased', 'true if the relative has died.'),
      notes,
    ],
  },
  {
    key: 'procedures', tool: 'procedure', label: 'Procedures & Surgeries', singular: 'Procedure', tab: 'history',
    description: 'Surgeries and other procedures.',
    sortBy: 'procedure_date', columns: ['name', 'procedure_date', 'facility', 'outcome'],
    fields: [
      str('name', 'Procedure', 'Name of the procedure, e.g. "Appendectomy".', req),
      date('procedure_date', 'Date', 'Date the procedure was done.'),
      str('facility', 'Facility', 'Hospital or clinic.'),
      str('provider_name', 'Provider', 'Surgeon or doctor who performed it.'),
      str('outcome', 'Outcome', 'Result or complications.'),
      notes,
    ],
  },
  {
    key: 'immunizations', tool: 'immunization', label: 'Immunizations', singular: 'Immunization', tab: 'history',
    description: 'Vaccines received.',
    sortBy: 'date_given', columns: ['vaccine', 'date_given', 'dose_number', 'next_due_date'],
    fields: [
      str('vaccine', 'Vaccine', 'Vaccine name, e.g. "MMR" or "Influenza".', req),
      date('date_given', 'Date given', 'Date the vaccine was given.', { required: true, default: 'today' }),
      int('dose_number', 'Dose #', 'Which dose in the series: 1, 2, 3...', { min: 1, max: 20 }),
      str('lot_number', 'Lot number', 'Lot number from the vial or card.'),
      str('provider_name', 'Given by', 'Clinic or person who gave it.'),
      date('next_due_date', 'Next due', 'Date the next dose or booster is due.'),
      notes,
    ],
  },
  {
    key: 'prescriptions', tool: 'prescription', label: 'Prescriptions', singular: 'Prescription', tab: 'meds',
    description: 'Medication orders. Active prescriptions with a schedule generate due doses on the medication administration record.',
    sortBy: 'start_date',
    columns: ['medication_name', 'dose_amount', 'dose_unit', 'frequency', 'schedule_times', 'prescription_status', 'start_date', 'end_date'],
    fields: [
      str('medication_name', 'Medication', 'Medicine name and strength, e.g. "Metformin 500 mg tablet".', req),
      num('dose_amount', 'Dose', 'Amount taken each time, as a number, e.g. 1 or 2.5.', { min: 0 }),
      str('dose_unit', 'Dose unit', 'Unit for the dose amount, e.g. "tablet", "mg", "ml", "puff".'),
      enm('route', 'Route', 'How it is taken.',
        ['oral', 'topical', 'inhaled', 'injection', 'eye', 'ear', 'nasal', 'rectal', 'other']),
      enm('frequency', 'Frequency', 'How often. Use as_needed for medicines taken only when required.',
        ['once_daily', 'twice_daily', 'three_times_daily', 'four_times_daily', 'every_other_day', 'weekly', 'as_needed'],
        { required: true, default: 'once_daily' }),
      str('schedule_times', 'Times', 'Clock times for each dose, 24-hour, comma separated, e.g. "07:00,15:00,23:00". Any times are allowed. Leave empty to use the suggested times for the frequency.',
        { suggestFrom: { field: 'frequency', map: SUGGESTED_TIMES } }),
      date('start_date', 'Start', 'First day of the prescription.', { required: true, default: 'today' }),
      date('end_date', 'End', 'Last day of the prescription. Leave empty if ongoing.'),
      str('prescriber_name', 'Prescriber', 'Doctor who prescribed it.'),
      str('indication', 'For', 'What it treats, e.g. "Blood pressure".'),
      text('instructions', 'Instructions', 'Special instructions, e.g. "Take with food".'),
      enm('prescription_status', 'Status', 'active = currently taking, completed = course finished, stopped = discontinued early.',
        ['active', 'completed', 'stopped'], { required: true, default: 'active' }),
    ],
  },
  {
    key: 'med_doses', tool: 'med_dose', label: 'Medication Administration Record', singular: 'Dose', tab: 'meds',
    description: 'One row per dose: scheduled doses generated from prescriptions, and unscheduled doses added by hand.',
    sortBy: 'scheduled_at',
    columns: ['scheduled_at', 'medication_name', 'dose_status', 'given_at', 'given_by', 'remarks'],
    fields: [
      int('prescription_id', 'Prescription ID', 'ID of the prescription this dose belongs to. Leave empty for an over-the-counter or one-off medicine.'),
      str('medication_name', 'Medication', 'Medicine name. Filled automatically when prescription_id is given.'),
      datetime('scheduled_at', 'Scheduled', 'When the dose was due.', { required: true, default: 'now' }),
      enm('dose_status', 'Status', 'due = not yet taken, given = taken, missed = not taken, refused = person declined, held = deliberately skipped. Set back to due to undo a mistake.',
        ['due', 'given', 'missed', 'refused', 'held'], { required: true, default: 'given' }),
      datetime('given_at', 'Given at', 'When the dose was actually taken. Defaults to now when the status is given.'),
      str('given_by', 'Given by', 'Who gave or took the dose.'),
      text('remarks', 'Remarks', 'Comments, e.g. "Took late, felt nauseous".'),
    ],
  },
  {
    key: 'vitals', tool: 'vital_signs', label: 'Vital Signs', singular: 'Vital signs entry', tab: 'vitals',
    description: 'Vital sign measurements. Every measurement is optional; record only what was measured. Values are always metric.',
    sortBy: 'recorded_at',
    columns: ['recorded_at', 'systolic_mmhg', 'diastolic_mmhg', 'heart_rate_bpm', 'temperature_c', 'spo2_percent',
      'respiratory_rate_per_min', 'weight_kg', 'height_cm', 'blood_glucose_mg_dl', 'pain_score'],
    fields: [
      datetime('recorded_at', 'Time', 'When the measurement was taken.', { required: true, default: 'now' }),
      num('systolic_mmhg', 'Systolic', 'Blood pressure top number in mmHg, e.g. 120.', { min: 30, max: 300 }),
      num('diastolic_mmhg', 'Diastolic', 'Blood pressure bottom number in mmHg, e.g. 80.', { min: 10, max: 200 }),
      num('heart_rate_bpm', 'Pulse', 'Heart rate in beats per minute.', { min: 10, max: 300 }),
      num('respiratory_rate_per_min', 'Resp', 'Breaths per minute.', { min: 1, max: 120 }),
      num('temperature_c', 'Temp', 'Body temperature in degrees Celsius, e.g. 37.2.', { min: 25, max: 45, quantity: 'temperature' }),
      num('spo2_percent', 'SpO2', 'Oxygen saturation in percent, e.g. 98.', { min: 30, max: 100 }),
      num('weight_kg', 'Weight', 'Body weight in kilograms.', { min: 0.2, max: 500, quantity: 'weight' }),
      num('height_cm', 'Height', 'Height or length in centimetres.', { min: 20, max: 260, quantity: 'length' }),
      num('head_circumference_cm', 'Head circ.', 'Head circumference in centimetres (infants).', { min: 15, max: 80, quantity: 'length' }),
      num('blood_glucose_mg_dl', 'Glucose', 'Blood glucose in mg/dL.', { min: 10, max: 1500, quantity: 'glucose' }),
      enm('glucose_context', 'Glucose timing', 'When the glucose reading was taken relative to food.',
        ['fasting', 'before_meal', 'after_meal', 'bedtime', 'random']),
      int('pain_score', 'Pain', 'Pain from 0 (none) to 10 (worst).', { min: 0, max: 10 }),
      notes,
    ],
  },
  {
    key: 'intake_output', tool: 'intake_output', label: 'Intake & Output', singular: 'Intake/output entry', tab: 'vitals',
    description: 'Fluids and food taken in, and urine or other output, measured in millilitres.',
    sortBy: 'recorded_at', columns: ['recorded_at', 'direction', 'io_type', 'amount_ml', 'notes'],
    fields: [
      datetime('recorded_at', 'Time', 'When it happened.', { required: true, default: 'now' }),
      enm('direction', 'Direction', 'intake = went in, output = came out.', ['intake', 'output'], req),
      enm('io_type', 'Type', 'What kind of intake or output.',
        ['oral_fluid', 'iv_fluid', 'tube_feeding', 'food', 'urine', 'stool', 'vomit', 'drain', 'other'], req),
      num('amount_ml', 'Amount (ml)', 'Volume in millilitres.', { required: true, min: 0, max: 20000 }),
      notes,
    ],
  },
  {
    key: 'reminders', tool: 'reminder', label: 'Monitoring Reminders', singular: 'Reminder', tab: 'vitals',
    description: 'Recurring checks for someone who is being watched closely, e.g. "Check temperature every 2 hours". The web app alerts whoever looks after the chart when a check is due. Dose reminders need no entry here: they come from the prescriptions.',
    sortBy: 'start_at', columns: ['title', 'check_type', 'interval_minutes', 'start_at', 'end_at', 'reminder_status'],
    fields: [
      str('title', 'What to do', 'Short instruction shown in the alert, e.g. "Check temperature".', req),
      enm('check_type', 'Done when', 'vital_signs = done when vital signs are recorded within an hour of the round. intake_output = done when an intake/output entry is added. other = marked done by hand.',
        ['vital_signs', 'intake_output', 'other'], { required: true, default: 'vital_signs' }),
      int('interval_minutes', 'Every (minutes)', 'Minutes between rounds, e.g. 240 for every 4 hours. Rounds fall at start + 1 interval, start + 2 intervals, and so on.', { required: true, min: 5, max: 10080 }),
      datetime('start_at', 'Start', 'The time the rounds are counted from. Start 14:00 with 240 minutes gives rounds at 18:00, 22:00, 02:00 and so on.', { required: true, default: 'now' }),
      datetime('end_at', 'End', 'When to stop reminding. Leave empty to continue until stopped.'),
      enm('reminder_status', 'Status', 'active = keep reminding, stopped = no more alerts.', ['active', 'stopped'], { required: true, default: 'active' }),
      datetime('last_done_at', 'Last done', 'When the check was last marked done by hand.'),
      notes,
    ],
  },
  {
    key: 'lab_results', tool: 'lab_result', label: 'Lab Results', singular: 'Lab result', tab: 'labs',
    description: 'One row per test result. Use value_number for numeric results so they can be trended.',
    sortBy: 'collected_date',
    columns: ['collected_date', 'test_name', 'value_number', 'value_text', 'unit', 'reference_low', 'reference_high', 'flag'],
    fields: [
      str('test_name', 'Test', 'Name of the test, e.g. "Hemoglobin A1c".', req),
      date('collected_date', 'Collected', 'Date the sample was taken.', { required: true, default: 'today' }),
      num('value_number', 'Value', 'Numeric result, e.g. 6.4.'),
      str('value_text', 'Text result', 'Non-numeric result, e.g. "Negative".'),
      str('unit', 'Unit', 'Unit of the numeric result, e.g. "%" or "mmol/L".'),
      num('reference_low', 'Ref. low', 'Lower limit of the normal range.'),
      num('reference_high', 'Ref. high', 'Upper limit of the normal range.'),
      enm('flag', 'Flag', 'Leave empty to have it worked out from the reference range.', ['normal', 'low', 'high', 'critical']),
      str('panel_name', 'Panel', 'Group the test belongs to, e.g. "Lipid panel".'),
      str('lab_name', 'Laboratory', 'Lab or hospital that ran the test.'),
      int('document_id', 'Document ID', 'ID of an uploaded document (PDF report) that backs this result.'),
      notes,
    ],
  },
  {
    key: 'notes', tool: 'note', label: 'Notes', singular: 'Note', tab: 'notes',
    description: 'Dated narrative notes: nursing notes, symptoms, progress.',
    sortBy: 'noted_at', columns: ['noted_at', 'note_type', 'author_name', 'text'],
    fields: [
      datetime('noted_at', 'Time', 'When the note applies.', { required: true, default: 'now' }),
      enm('note_type', 'Type', 'nursing = care given, progress = how things are going, symptom = something the person feels, general = anything else.',
        ['nursing', 'progress', 'symptom', 'general'], { required: true, default: 'general' }),
      str('author_name', 'Author', 'Who wrote the note. Defaults to the signed-in user.'),
      text('text', 'Note', 'The note itself.', req),
    ],
  },
  {
    key: 'visits', tool: 'visit', label: 'Visits', singular: 'Visit', tab: 'visits',
    description: 'Appointments, emergency visits and hospital stays.',
    sortBy: 'visit_date', columns: ['visit_date', 'visit_type', 'provider_name', 'reason', 'diagnosis', 'follow_up_date'],
    fields: [
      date('visit_date', 'Date', 'Date of the visit.', { required: true, default: 'today' }),
      enm('visit_type', 'Type', 'Kind of visit.',
        ['checkup', 'sick_visit', 'emergency', 'hospital_admission', 'specialist', 'telehealth', 'dental', 'other'],
        { required: true, default: 'checkup' }),
      str('provider_name', 'Provider', 'Doctor or clinician seen.'),
      str('facility', 'Facility', 'Clinic or hospital.'),
      str('reason', 'Reason', 'Why the visit happened.'),
      str('diagnosis', 'Diagnosis', 'What the provider concluded.'),
      text('summary', 'Summary', 'What was discussed and decided.'),
      date('follow_up_date', 'Follow-up', 'Date of the next planned visit.'),
    ],
  },
  {
    key: 'documents', tool: 'document', label: 'Documents', singular: 'Document', tab: 'visits',
    description: 'Uploaded PDFs and images kept for reference. The file itself is uploaded separately after the record is created.',
    sortBy: 'doc_date', columns: ['doc_date', 'doc_type', 'title', 'file_name'],
    fields: [
      date('doc_date', 'Date', 'Date on the document.', { required: true, default: 'today' }),
      enm('doc_type', 'Type', 'Kind of document.',
        ['lab_report', 'prescription', 'imaging', 'discharge_summary', 'insurance', 'other'], { required: true, default: 'other' }),
      str('title', 'Title', 'Short description, e.g. "CBC report from City Lab".', req),
      notes,
      str('file_name', 'Stored file', 'Name of the stored file in the attachments folder.', { readOnly: true }),
      str('original_name', 'Original name', 'File name as uploaded.', { readOnly: true }),
      str('mime_type', 'File type', 'MIME type of the file.', { readOnly: true }),
      int('size_bytes', 'Size', 'File size in bytes.', { readOnly: true }),
    ],
  },
  {
    key: 'contacts', tool: 'contact', label: 'Contacts & Providers', singular: 'Contact', tab: 'face',
    description: 'Emergency contacts, doctors, pharmacy and insurance.',
    sortBy: 'contact_type', columns: ['contact_type', 'name', 'relationship_or_specialty', 'phone'],
    fields: [
      enm('contact_type', 'Type', 'Kind of contact.',
        ['emergency_contact', 'primary_doctor', 'specialist', 'pharmacy', 'insurance', 'dentist', 'other'], req),
      str('name', 'Name', 'Person or organisation name.', req),
      str('relationship_or_specialty', 'Relationship / specialty', 'e.g. "Spouse" or "Cardiologist".'),
      str('phone', 'Phone', 'Phone number.'),
      str('email', 'Email', 'Email address.'),
      str('address', 'Address', 'Postal address.'),
      str('policy_number', 'Policy / member #', 'Insurance policy or member number.'),
      notes,
    ],
  },
];

export const TYPE_BY_KEY = new Map(RECORD_TYPES.map((t) => [t.key, t]));
export const SECTION_KEYS = RECORD_TYPES.map((t) => t.key);

export const PATIENT_FIELDS: FieldDef[] = [
  str('full_name', 'Full name', 'Legal name.', req),
  str('preferred_name', 'Preferred name', 'What the person likes to be called.'),
  date('date_of_birth', 'Date of birth', 'Date of birth.'),
  enm('sex', 'Sex', 'Sex recorded for clinical purposes.', ['female', 'male', 'other', 'unknown']),
  enm('blood_type', 'Blood type', 'ABO and Rh blood type.',
    ['a_positive', 'a_negative', 'b_positive', 'b_negative', 'ab_positive', 'ab_negative', 'o_positive', 'o_negative', 'unknown']),
  text('important_notes', 'Important notes', 'Anything a stranger treating this person must know first, e.g. "Pacemaker" or "Needs interpreter".'),
];

/** System columns present on every record table. */
export const SYSTEM_FIELDS = ['id', 'patient_id', 'record_status', 'error_reason', 'created_at', 'updated_at', 'created_by', 'created_by_name'];
