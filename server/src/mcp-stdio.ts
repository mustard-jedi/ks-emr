#!/usr/bin/env node
/**
 * MCP over stdio, for AI agents running on the same machine as KS EMR.
 * The agent acts as the family account named in KS_EMR_USER and sees exactly the charts that account can see.
 *
 *   KS_EMR_USER=alice node dist/server/mcp-stdio.js
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { actorForUsername } from './auth.js';
import { getDb } from './db.js';
import { createMcpServer } from './mcp.js';

const username = process.env.KS_EMR_USER;
if (!username) {
  console.error('Set KS_EMR_USER to the username the agent should act as.');
  process.exit(1);
}
getDb();
const actor = actorForUsername(username, 'stdio');
if (actor.role === 'guest') {
  console.error('Guest accounts cannot use MCP.');
  process.exit(1);
}
if (process.env.KS_EMR_READ_ONLY === '1') actor.readOnly = true;
await createMcpServer(actor).connect(new StdioServerTransport());
console.error(`KS EMR MCP server ready (acting as ${actor.username}${actor.readOnly ? ', read-only' : ''})`);
