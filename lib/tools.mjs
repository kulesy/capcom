// Capcom's own MCP server, served to each chat the way Claude Desktop serves its built-ins: declared in the
// initialize request and spoken over the session's stdio as mcp_message control requests.
// NOTE: [7 Oct 2026] EK - initialize.sdkMcpServers and mcp_message are the Agent SDK's wire format, not a published
// contract; proven on CLI 2.1.292. If chips stop appearing after a CLI update, check this first.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SERVER = 'capcom';

const TOOLS = [
  {
    name: 'spawn_task',
    description: 'Suggest a follow-up task to the user as a chip card in Capcom. They can start it later as its own session with one tap, or dismiss it. Use it for work that surfaces beside the current task. The prompt must stand alone: include paths and the context the new session needs.',
    inputSchema: { type: 'object', properties: {
      title: { type: 'string', description: 'Under 60 characters, an imperative phrase.' },
      tldr: { type: 'string', description: 'One or two plain sentences on why, shown on the card.' },
      prompt: { type: 'string', description: 'The first message for the new session.' },
      cwd: { type: 'string', description: 'Absolute folder for the new session. Defaults to this session\'s folder.' },
    }, required: ['title', 'prompt'] },
  },
  {
    name: 'dismiss_task',
    description: 'Withdraw a chip created with spawn_task that is now stale or superseded.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, reason: { type: 'string' } }, required: ['task_id'] },
  },
  {
    name: 'mark_chapter',
    description: 'Mark the start of a new chapter in this session. Capcom shows it as a titled divider in the chat. Use it sparingly, when the work moves to a meaningfully different phase.',
    inputSchema: { type: 'object', properties: { title: { type: 'string', description: 'A short noun phrase.' }, summary: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'widget_guide',
    description: 'Returns how to write a widget for Capcom: the size, theme, variables, sandbox and limits that show_widget works within. Call it once per chat, before the first show_widget.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'show_widget',
    description: 'Show a chart, diagram or small interactive widget inline in the chat. Call widget_guide once per chat before your first widget. widget_code is an HTML or SVG fragment that runs in a sandboxed frame and loads from cdnjs.cloudflare.com, esm.sh, cdn.jsdelivr.net and unpkg.com only.',
    inputSchema: { type: 'object', properties: {
      loading_messages: { type: 'array', items: { type: 'string' }, description: 'One to four short phrases, a few words each, shown while the widget is written. Put this field first.' },
      title: { type: 'string', description: 'A short snake_case name for the widget.' },
      widget_code: { type: 'string' },
    }, required: ['title', 'widget_code'] },
  },
];

export const TOOL_NAMES = TOOLS.map(t => `mcp__${SERVER}__${t.name}`);

export function makeChips(stateDir) {
  const file = path.join(stateDir, 'chips.json');
  let chips = {};
  try { chips = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const save = () => fs.writeFileSync(file, JSON.stringify(chips));
  return {
    // Keyed by the tool_use id, so a chip in any transcript, Desktop's included, can be looked up from the chat.
    forSession: sessionId => Object.values(chips).filter(c => c.sessionId === sessionId),
    get: toolUseId => chips[toolUseId] || null,
    put(chip) { chips[chip.toolUseId] = { ...chips[chip.toolUseId], ...chip }; save(); return chips[chip.toolUseId]; },
    byTaskId: taskId => Object.values(chips).find(c => c.id === taskId) || null,
  };
}

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

// Read when asked for, so an edit to the guide shows in the next chat without a restart.
const GUIDE = new URL('./widget-guide.md', import.meta.url);

function widgetGuide() {
  try {
    return text(fs.readFileSync(GUIDE, 'utf8'));
  } catch (err) {
    return text(`The widget guide could not be read (${err.code || 'error'}). Write the widget from the show_widget description, and keep it a small fragment.`, true);
  }
}

function callTool(name, args, ctx) {
  if (name === 'spawn_task') {
    if (!args.title || !args.prompt) return text('spawn_task needs a title and a prompt.', true);
    const chip = ctx.chips.put({
      id: `task_${crypto.randomBytes(4).toString('hex')}`, toolUseId: ctx.toolUseId || `chip-${crypto.randomUUID()}`, sessionId: ctx.sessionId,
      title: String(args.title).slice(0, 120), tldr: args.tldr || '', prompt: args.prompt, cwd: args.cwd || ctx.cwd, status: 'open', at: Date.now(),
    });
    return text(`Chip created (task_id: ${chip.id}). The user sees a card with Start and Dismiss in Capcom. Carry on with the current task.`);
  }
  if (name === 'dismiss_task') {
    const chip = ctx.chips.byTaskId(args.task_id);
    if (!chip) return text(`No chip with task_id ${args.task_id}.`, true);
    if (chip.status !== 'open') return text(`That chip was already ${chip.status}, so it was left alone.`);
    ctx.chips.put({ ...chip, status: 'dismissed', reason: args.reason || '' });
    return text('Chip withdrawn.');
  }
  if (name === 'mark_chapter') return text('Chapter marked.');
  if (name === 'widget_guide') return widgetGuide();
  if (name === 'show_widget') return text('The widget is showing in the chat.');
  return text(`Capcom has no tool called ${name}.`, true);
}

// One JSON-RPC message from the CLI in, one reply out. Notifications get the empty acknowledgement the CLI expects.
export function handleMcp(message, ctx) {
  const reply = result => ({ jsonrpc: '2.0', id: message.id ?? 0, result });
  if (!message.method || message.method.startsWith('notifications/')) return { jsonrpc: '2.0', result: {}, id: 0 };
  if (message.method === 'initialize') {
    return reply({ protocolVersion: message.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: SERVER, version: '0.1.0' } });
  }
  if (message.method === 'tools/list') return reply({ tools: TOOLS });
  if (message.method === 'tools/call') {
    const toolUseId = message.params?._meta?.['claudecode/toolUseId'];
    return reply(callTool(message.params?.name, message.params?.arguments || {}, { ...ctx, toolUseId }));
  }
  return { jsonrpc: '2.0', id: message.id ?? 0, error: { code: -32601, message: `Method not found: ${message.method}` } };
}
