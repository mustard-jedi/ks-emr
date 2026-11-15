import { utcNow } from './config.js';
import { getDb, type Actor, type Row } from './db.js';
import { canSee, requireRead } from './access.js';
import { listRaw, typeDef } from './records.js';

/**
 * Export one chart as an HL7 FHIR R4 Bundle (type "collection").
 * Coded values are sent as plain text except vital signs, which carry LOINC codes.
 */

const LOINC: Record<string, [code: string, display: string, unit: string, ucum: string]> = {
  heart_rate_bpm: ['8867-4', 'Heart rate', 'beats/minute', '/min'],
  respiratory_rate_per_min: ['9279-1', 'Respiratory rate', 'breaths/minute', '/min'],
  temperature_c: ['8310-5', 'Body temperature', 'C', 'Cel'],
  spo2_percent: ['2708-6', 'Oxygen saturation in Arterial blood', '%', '%'],
  weight_kg: ['29463-7', 'Body weight', 'kg', 'kg'],
  height_cm: ['8302-2', 'Body height', 'cm', 'cm'],
  head_circumference_cm: ['9843-4', 'Head Occipital-frontal circumference', 'cm', 'cm'],
  blood_glucose_mg_dl: ['2339-0', 'Glucose [Mass/volume] in Blood', 'mg/dL', 'mg/dL'],
  pain_score: ['72514-3', 'Pain severity - 0-10 verbal numeric rating', '{score}', '{score}'],
};

const iso = (local: string | null) => (local ? new Date(local).toISOString() : undefined);
const text = (s: string | null) => (s ? { text: s } : undefined);
const note = (s: string | null) => (s ? [{ text: s }] : undefined);
const clean = <T extends Row>(o: T): T => JSON.parse(JSON.stringify(o));

export function exportFhir(actor: Actor, patientId: number) {
  const access = requireRead(actor, patientId);
  const p = getDb().prepare('SELECT * FROM patients WHERE id = ?').get(patientId) as Row;
  const subject = { reference: `Patient/${patientId}`, display: p.full_name };
  const resources: Row[] = [];
  const rows = (k: string) => (canSee(access, k) ? listRaw(typeDef(k), patientId, { limit: 1000 }) : []);
  const quantity = (value: number, unit: string, code: string) => ({ value, unit, system: 'http://unitsofmeasure.org', code });
  const vitalCategory = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }];

  resources.push({
    resourceType: 'Patient', id: String(patientId),
    name: [{ text: p.full_name }],
    birthDate: p.date_of_birth ?? undefined,
    gender: p.sex ?? undefined,
  });

  for (const r of rows('allergies')) {
    resources.push({
      resourceType: 'AllergyIntolerance', id: `allergy-${r.id}`, patient: subject, code: text(r.substance),
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
      criticality: r.severity === 'life_threatening' || r.severity === 'severe' ? 'high' : r.severity ? 'low' : undefined,
      onsetDateTime: r.noted_date ?? undefined,
      reaction: r.reaction ? [{ manifestation: [{ text: r.reaction }], severity: r.severity === 'life_threatening' ? 'severe' : r.severity ?? undefined }] : undefined,
      note: note(r.notes),
    });
  }
  for (const r of rows('conditions')) {
    resources.push({
      resourceType: 'Condition', id: `condition-${r.id}`, subject, code: text(r.name),
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: r.clinical_status === 'resolved' ? 'resolved' : 'active' }] },
      onsetDateTime: r.onset_date ?? undefined, abatementDateTime: r.resolved_date ?? undefined, note: note(r.notes),
    });
  }
  for (const r of rows('family_history')) {
    resources.push({
      resourceType: 'FamilyMemberHistory', id: `family-${r.id}`, status: 'completed', patient: subject,
      relationship: { text: r.relation }, deceasedBoolean: r.is_deceased ?? undefined,
      condition: [{ code: { text: r.condition }, onsetAge: r.age_at_onset != null ? quantity(r.age_at_onset, 'years', 'a') : undefined }],
      note: note(r.notes),
    });
  }
  for (const r of rows('procedures')) {
    resources.push({
      resourceType: 'Procedure', id: `procedure-${r.id}`, status: 'completed', subject, code: text(r.name),
      performedDateTime: r.procedure_date ?? undefined, outcome: text(r.outcome), note: note(r.notes),
    });
  }
  for (const r of rows('immunizations')) {
    resources.push({
      resourceType: 'Immunization', id: `immunization-${r.id}`, status: 'completed', patient: subject, vaccineCode: text(r.vaccine),
      occurrenceDateTime: r.date_given, lotNumber: r.lot_number ?? undefined,
      protocolApplied: r.dose_number ? [{ doseNumberPositiveInt: r.dose_number }] : undefined, note: note(r.notes),
    });
  }
  for (const r of rows('prescriptions')) {
    const dose = [r.dose_amount, r.dose_unit, r.route, String(r.frequency).replace(/_/g, ' '), r.schedule_times && `at ${r.schedule_times}`]
      .filter(Boolean).join(' ');
    resources.push({
      resourceType: 'MedicationRequest', id: `prescription-${r.id}`, intent: 'order', subject,
      status: r.prescription_status === 'active' ? 'active' : r.prescription_status === 'completed' ? 'completed' : 'stopped',
      medicationCodeableConcept: text(r.medication_name), authoredOn: r.start_date,
      requester: r.prescriber_name ? { display: r.prescriber_name } : undefined,
      reasonCode: r.indication ? [{ text: r.indication }] : undefined,
      dosageInstruction: [{ text: dose, patientInstruction: r.instructions ?? undefined, asNeededBoolean: r.frequency === 'as_needed' }],
      dispenseRequest: { validityPeriod: { start: r.start_date, end: r.end_date ?? undefined } },
    });
  }
  for (const r of rows('med_doses')) {
    if (r.dose_status === 'due') continue;
    resources.push({
      resourceType: 'MedicationAdministration', id: `dose-${r.id}`, subject,
      status: r.dose_status === 'given' ? 'completed' : 'not-done',
      statusReason: r.dose_status !== 'given' ? [{ text: r.dose_status }] : undefined,
      medicationCodeableConcept: text(r.medication_name),
      effectiveDateTime: iso(r.given_at || r.scheduled_at),
      request: r.prescription_id ? { reference: `MedicationRequest/prescription-${r.prescription_id}` } : undefined,
      note: note(r.remarks),
    });
  }
  for (const r of rows('vitals')) {
    const effectiveDateTime = iso(r.recorded_at);
    if (r.systolic_mmhg != null || r.diastolic_mmhg != null) {
      const comp = (code: string, display: string, v: number | null) => (v == null ? undefined
        : { code: { coding: [{ system: 'http://loinc.org', code, display }] }, valueQuantity: quantity(v, 'mmHg', 'mm[Hg]') });
      resources.push({
        resourceType: 'Observation', id: `vitals-${r.id}-bp`, status: 'final', category: vitalCategory, subject, effectiveDateTime,
        code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' }] },
        component: [comp('8480-6', 'Systolic blood pressure', r.systolic_mmhg), comp('8462-4', 'Diastolic blood pressure', r.diastolic_mmhg)].filter(Boolean),
      });
    }
    for (const [field, [code, display, unit, ucum]] of Object.entries(LOINC)) {
      if (r[field] == null) continue;
      resources.push({
        resourceType: 'Observation', id: `vitals-${r.id}-${field}`, status: 'final', category: vitalCategory, subject, effectiveDateTime,
        code: { coding: [{ system: 'http://loinc.org', code, display }] }, valueQuantity: quantity(r[field], unit, ucum),
      });
    }
  }
  for (const r of rows('lab_results')) {
    const flag = { low: 'L', high: 'H', critical: 'AA', normal: 'N' }[r.flag as string];
    resources.push({
      resourceType: 'Observation', id: `lab-${r.id}`, status: 'final', subject, code: text(r.test_name),
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      effectiveDateTime: r.collected_date,
      valueQuantity: r.value_number != null ? { value: r.value_number, unit: r.unit ?? undefined } : undefined,
      valueString: r.value_number == null ? r.value_text ?? undefined : undefined,
      referenceRange: r.reference_low != null || r.reference_high != null
        ? [{ low: r.reference_low != null ? { value: r.reference_low } : undefined, high: r.reference_high != null ? { value: r.reference_high } : undefined }]
        : undefined,
      interpretation: flag ? [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: flag }] }] : undefined,
      performer: r.lab_name ? [{ display: r.lab_name }] : undefined, note: note(r.notes),
    });
  }
  for (const r of rows('visits')) {
    resources.push({
      resourceType: 'Encounter', id: `visit-${r.id}`, status: 'finished', subject,
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: r.visit_type === 'emergency' ? 'EMER' : r.visit_type === 'hospital_admission' ? 'IMP' : 'AMB' },
      type: [{ text: String(r.visit_type).replace(/_/g, ' ') }], period: { start: r.visit_date },
      reasonCode: r.reason ? [{ text: r.reason }] : undefined,
      participant: r.provider_name ? [{ individual: { display: r.provider_name } }] : undefined,
      serviceProvider: r.facility ? { display: r.facility } : undefined,
    });
  }
  for (const r of rows('notes')) {
    resources.push({
      resourceType: 'Observation', id: `note-${r.id}`, status: 'final', subject, effectiveDateTime: iso(r.noted_at),
      code: { text: `${r.note_type} note` }, valueString: r.text, performer: r.author_name ? [{ display: r.author_name }] : undefined,
    });
  }
  for (const r of rows('documents')) {
    resources.push({
      resourceType: 'DocumentReference', id: `document-${r.id}`, status: 'current', subject, date: iso(`${r.doc_date}T00:00`),
      type: { text: String(r.doc_type).replace(/_/g, ' ') }, description: r.title,
      content: [{ attachment: { contentType: r.mime_type ?? undefined, title: r.file_name ?? r.title, size: r.size_bytes ?? undefined } }],
    });
  }

  return clean({
    resourceType: 'Bundle', type: 'collection', timestamp: utcNow(),
    entry: resources.map((resource) => ({ fullUrl: `urn:ks-emr:${resource.resourceType}/${resource.id}`, resource })),
  });
}
