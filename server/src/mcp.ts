import { dueReminders } from './reminders.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { localToday, VERSION } from './config.js';
import type { Actor, Row } from './db.js';
import { listPatients } from './access.js';
import { createRecord, getMar, listRecords, markEnteredInError, updateRecord } from './records.js';
import { RECORD_TYPES, SECTION_KEYS } from './recordTypes.js';
import { getSummary } from './summary.js';
import { ApiError, jsonSchema, requireInt } from './validate.js';

/**
 * MCP tools are generated from the same record definitions as the REST API.
 * Every tool takes one flat object of strings, numbers and booleans, so small local models can fill it in reliably.
 */

export interface Tool {
  name: string;
  description: string;
  inputSchema: Row;
  writes: boolean;
  run: (actor: Actor, args: Row) => unknown;
}

const PATIENT_ID = { type: 'integer', description: 'ID of the chart (the person). Call list_patients to find it.' };
const obj = (properties: Row, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });

export function buildTools(): Tool[] {
  const tools: Tool[] = [
    {
      name: 'list_patients', writes: false,
      description: 'List the charts (people) you can access, with their patient_id. Call this first.',
      inputSchema: obj({}, []),
      run: (actor) => listPatients(actor),
    },
    {
      name: 'get_patient_summary', writes: false,
      description: 'Get the one-page summary of a person: allergies, conditions, current medications, family history, last visit, latest vital signs, abnormal lab results and contacts.',
      inputSchema: obj({ patient_id: PATIENT_ID }, ['patient_id']),
      run: (actor, a) => getSummary(actor, requireInt(a.patient_id, 'patient_id')),
    },
    {
      name: 'list_doses_for_day', writes: false,
      description: 'List every medication dose scheduled for one day, with its dose_id and status (due, given, missed, refused, held).',
      inputSchema: obj({ patient_id: PATIENT_ID, date: { type: 'string', description: 'Day to list. Format: YYYY-MM-DD. Default: today.' } }, ['patient_id']),
      run: (actor, a) => getMar(actor, requireInt(a.patient_id, 'patient_id'), a.date ? String(a.date) : undefined),
    },
    {
      name: 'list_due_reminders', writes: false,
      description: 'List what needs doing right now across all charts: medication doses that are due and not yet recorded, and monitoring checks that are due (e.g. "Check temperature").',
      inputSchema: obj({}, []),
      run: (actor) => dueReminders(actor),
    },
    {
      name: 'record_dose', writes: true,
      description: 'Record what happened to a scheduled dose: given, missed, refused or held. Get dose_id from list_doses_for_day.',
      inputSchema: obj({
        patient_id: PATIENT_ID,
        dose_id: { type: 'integer', description: 'ID of the dose.' },
        dose_status: { type: 'string', enum: ['given', 'missed', 'refused', 'held', 'due'], description: 'What happened to the dose.' },
        given_at: { type: 'string', description: 'When it was taken. Format: YYYY-MM-DDTHH:MM. Default: now.' },
        remarks: { type: 'string', description: 'Optional comment, e.g. "Took with breakfast".' },
      }, ['patient_id', 'dose_id', 'dose_status']),
      run: (actor, a) => {
        const { patient_id, dose_id, ...rest } = a;
        return updateRecord(actor, requireInt(patient_id, 'patient_id'), 'med_doses', requireInt(dose_id, 'dose_id'), rest);
      },
    },
    {
      name: 'stop_prescription', writes: true,
      description: 'Mark a prescription as stopped or completed so no more doses are scheduled.',
      inputSchema: obj({
        patient_id: PATIENT_ID,
        prescription_id: { type: 'integer', description: 'ID of the prescription.' },
        prescription_status: { type: 'string', enum: ['stopped', 'completed'], description: 'stopped = discontinued early, completed = course finished.' },
        end_date: { type: 'string', description: 'Last day it was taken. Format: YYYY-MM-DD. Default: today.' },
      }, ['patient_id', 'prescription_id', 'prescription_status']),
      run: (actor, a) => updateRecord(actor, requireInt(a.patient_id, 'patient_id'), 'prescriptions', requireInt(a.prescription_id, 'prescription_id'), {
        prescription_status: a.prescription_status, end_date: a.end_date || localToday(),
      }),
    },
    {
      name: 'mark_entered_in_error', writes: true,
      description: 'Strike out an entry that was recorded by mistake. Entries are never deleted; they are marked as entered in error.',
      inputSchema: obj({
        patient_id: PATIENT_ID,
        record_type: { type: 'string', enum: SECTION_KEYS, description: 'Which kind of entry.' },
        record_id: { type: 'integer', description: 'ID of the entry.' },
        reason: { type: 'string', description: 'Why it is wrong.' },
      }, ['patient_id', 'record_type', 'record_id', 'reason']),
      run: (actor, a) => markEnteredInError(actor, requireInt(a.patient_id, 'patient_id'), String(a.record_type), requireInt(a.record_id, 'record_id'), a.reason),
    },
  ];

  for (const t of RECORD_TYPES) {
    const sort = t.fields.find((f) => f.name === t.sortBy)!;
    const dated = sort.type === 'date' || sort.type === 'datetime';
    const listProps: Row = { patient_id: PATIENT_ID, limit: { type: 'integer', description: 'Maximum number of entries to return. Default: 50.' } };
    if (dated) {
      listProps.from_date = { type: 'string', description: 'Only entries on or after this day. Format: YYYY-MM-DD.' };
      listProps.to_date = { type: 'string', description: 'Only entries on or before this day. Format: YYYY-MM-DD.' };
    }
    tools.push({
      name: `list_${t.key}`, writes: false,
      description: `List ${t.label.toLowerCase()} for a person${dated ? ', newest first' : ''}. ${t.description}`,
      inputSchema: obj(listProps, ['patient_id']),
      run: (actor, a) => listRecords(actor, requireInt(a.patient_id, 'patient_id'), t.key, {
        limit: Number(a.limit) || 50, from: a.from_date ? String(a.from_date) : undefined, to: a.to_date ? String(a.to_date) : undefined,
      }),
    });
    const create = jsonSchema(t.fields, 'create');
    tools.push({
      name: `add_${t.tool}`, writes: true,
      description: `Add one ${t.singular.toLowerCase()} to a person's chart. ${t.description}`,
      inputSchema: obj({ patient_id: PATIENT_ID, ...create.properties }, ['patient_id', ...create.required]),
      run: (actor, a) => {
        const { patient_id, ...fields } = a;
        return createRecord(actor, requireInt(patient_id, 'patient_id'), t.key, fields);
      },
    });
  }
  return tools;
}

const TOOLS = buildTools();

export function toolsFor(actor: Actor): Tool[] {
  return actor.readOnly || actor.role === 'guest' ? TOOLS.filter((t) => !t.writes) : TOOLS;
}

export function callTool(actor: Actor, name: string, args: Row) {
  const tool = toolsFor(actor).find((t) => t.name === name);
  try {
    if (!tool) throw new ApiError(404, `Unknown tool "${name}"`);
    const result = tool.run(actor, args || {});
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 1) }] };
  } catch (e) {
    if (!(e instanceof ApiError)) console.error(e);
    const msg = e instanceof ApiError ? e.message : 'Internal error';
    return { isError: true, content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
  }
}

export function createMcpServer(actor: Actor): Server {
  const server = new Server(
    { name: 'ks-emr', version: VERSION },
    {
      capabilities: { tools: {} },
      instructions: 'KS EMR is a family medical record. Call list_patients first to get a patient_id, then use the list_* tools to read and the add_* tools to write. '
        + 'Dates are YYYY-MM-DD. Date-times are YYYY-MM-DDTHH:MM in 24-hour local time. Measurements are metric.',
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsFor(actor).map((t) => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema as any,
      annotations: { readOnlyHint: !t.writes, destructiveHint: false },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(actor, req.params.name, (req.params.arguments || {}) as Row));
  return server;
}
