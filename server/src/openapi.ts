import { PUBLIC_URL, VERSION } from './config.js';
import { PATIENT_FIELDS, RECORD_TYPES } from './recordTypes.js';
import { jsonSchema } from './validate.js';

/** OpenAPI 3.0 document generated from the record definitions. Served at /api/openapi.json. */
export function buildOpenApi() {
  const paths: Record<string, any> = {};
  const schemas: Record<string, any> = {
    Error: { type: 'object', properties: { error: { type: 'string' } } },
    PatientInput: jsonSchema(PATIENT_FIELDS, 'create'),
  };
  const pid = { name: 'patient_id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Chart ID from GET /api/patients.' };
  const rid = { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Entry ID.' };
  const json = (schema: any) => ({ content: { 'application/json': { schema } } });
  const ok = (description: string, schema: any = { type: 'object' }) => ({ 200: { description, ...json(schema) } });
  const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });

  paths['/api/patients'] = {
    get: { summary: 'List the charts you can access', operationId: 'list_patients', responses: ok('Charts', { type: 'array', items: { type: 'object' } }) },
    post: { summary: 'Create a managed chart (a person without their own login)', operationId: 'create_patient', requestBody: json(ref('PatientInput')), responses: ok('The new chart') },
  };
  paths['/api/patients/{patient_id}/summary'] = {
    get: { summary: 'One-page summary (Face Sheet) of a person', operationId: 'get_patient_summary', parameters: [pid], responses: ok('Summary') },
  };
  paths['/api/patients/{patient_id}/mar'] = {
    get: {
      summary: 'Medication doses scheduled for one day', operationId: 'list_doses_for_day',
      parameters: [pid, { name: 'date', in: 'query', schema: { type: 'string' }, description: 'YYYY-MM-DD. Default: today.' }],
      responses: ok('Doses'),
    },
  };
  paths['/api/patients/{patient_id}/fhir'] = {
    get: { summary: 'Export the chart as an HL7 FHIR R4 Bundle', operationId: 'export_fhir', parameters: [pid], responses: ok('FHIR Bundle') },
  };

  for (const t of RECORD_TYPES) {
    const name = t.key;
    schemas[`${name}_create`] = jsonSchema(t.fields, 'create');
    schemas[`${name}_update`] = jsonSchema(t.fields, 'update');
    const base = `/api/patients/{patient_id}/${name}`;
    paths[base] = {
      get: {
        summary: `List ${t.label.toLowerCase()}`, description: t.description, operationId: `list_${name}`, tags: [t.label],
        parameters: [pid,
          { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'Maximum entries. Default 200.' },
          { name: 'from', in: 'query', schema: { type: 'string' }, description: 'Earliest date, YYYY-MM-DD.' },
          { name: 'to', in: 'query', schema: { type: 'string' }, description: 'Latest date, YYYY-MM-DD.' },
          { name: 'include_errors', in: 'query', schema: { type: 'boolean' }, description: 'Include entries marked entered in error.' }],
        responses: ok('Entries', { type: 'array', items: { type: 'object' } }),
      },
      post: {
        summary: `Add one ${t.singular.toLowerCase()}`, description: t.description, operationId: `add_${t.tool}`, tags: [t.label],
        parameters: [pid], requestBody: json(ref(`${name}_create`)), responses: ok('The new entry'),
      },
    };
    paths[`${base}/{id}`] = {
      get: { summary: `Get one ${t.singular.toLowerCase()}`, operationId: `get_${t.tool}`, tags: [t.label], parameters: [pid, rid], responses: ok('The entry') },
      patch: {
        summary: `Amend one ${t.singular.toLowerCase()}`, description: 'Send only the fields to change. The previous values are kept in the audit log.',
        operationId: `update_${t.tool}`, tags: [t.label], parameters: [pid, rid], requestBody: json(ref(`${name}_update`)), responses: ok('The amended entry'),
      },
    };
    paths[`${base}/{id}/entered-in-error`] = {
      post: {
        summary: `Strike out one ${t.singular.toLowerCase()} recorded by mistake`, operationId: `mark_${t.tool}_entered_in_error`, tags: [t.label],
        parameters: [pid, rid],
        requestBody: json({ type: 'object', properties: { reason: { type: 'string', description: 'Why the entry is wrong.' } }, required: ['reason'] }),
        responses: ok('The struck-out entry'),
      },
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'KS EMR API', version: VERSION,
      description: 'Family medical record. Authenticate with an API token: "Authorization: Bearer ksemr_...". '
        + 'All payloads are flat JSON objects. Dates are YYYY-MM-DD, date-times are YYYY-MM-DDTHH:MM (24-hour local time), measurements are metric.',
    },
    servers: [{ url: PUBLIC_URL }],
    security: [{ bearer: [] }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }, schemas },
    paths,
  };
}
