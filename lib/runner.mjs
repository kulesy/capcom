// One headless `claude -p` process per open chat, spoken to in stream-json. The session file stays the
// record of what was said; this layer adds only what the file cannot hold: streaming text, approvals and state.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { label } from './notices.mjs';
import { toolSummary } from './transcripts.mjs';
import { SERVER, TOOL_NAMES, handleMcp } from './tools.mjs';
import { createWork } from './work.mjs';

// Every Chrome action asks first, even ones the user's own settings already allow, so each one reaches Capcom. Bypass answers
// them without a card; the rule stays on there so a switch to a stricter mode applies at once, with no restart.
// NOTE: [15 Oct 2026] EK - The rule beats the permission mode, so Chrome asks in Bypass and Auto too. Checked on CLI 2.1.300.
const CHROME_SETTINGS = JSON.stringify({ permissions: { ask: ['mcp__claude-in-chrome'] } });
const CHROME_TOOL = 'mcp__claude-in-chrome__';

const chats = new Map();
const RESULT_ERRORS = {
  error_max_turns: 'Claude hit the limit on turns for one request.',
  error_during_execution: 'The turn ended with an error.',
};
const rid = () => crypto.randomUUID();

class Chat {
  constructor({ id, cwd, mode, model, shownModel, effort, resume, claude, chrome = true, chips }) {
    Object.assign(this, { id, cwd, mode, model, shownModel, effort, resume, claude, chrome, chips });
    this.proc = null;
    this.state = 'idle';
    this.pending = new Map();
    this.holds = new Map();
    this.replies = new Map();
    this.events = [];
    this.seq = 0;
    this.listeners = new Set();
    this.live = '';
    this.work = createWork(cwd);
    this.lastError = '';
    this.stderr = '';
    this.lastActive = Date.now();
    this.onSession = null;
  }

  emit(type, data = {}) {
    const ev = { seq: ++this.seq, type, data };
    this.events.push(ev);
    if (this.events.length > 2000) this.events.splice(0, 500);
    for (const fn of this.listeners) fn(ev);
  }

  setState(state) {
    if (this.state === state) return;
    const was = this.state;
    this.state = state;
    if (was === 'idle') this.relay(this.work.begin());
    if (state === 'idle') this.work.end();
    this.emit('state', { state });
  }

  relay(events) {
    for (const [type, data] of events) this.emit(type, data);
  }

  status() {
    return { state: this.state, running: !!this.proc, mode: this.mode, model: this.model, shownModel: this.shownModel, effort: this.effort, chrome: this.chrome, live: this.live, think: this.work.thought(), work: this.work.snapshot(), lastError: this.lastError, pending: [...this.pending.values()], holds: [...this.holds.values()] };
  }

  write(obj) {
    if (this.proc?.stdin.writable) this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  start() {
    // The CLI refuses a later switch into Bypass unless the process was launched allowing it.
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', this.mode,
      '--allow-dangerously-skip-permissions'];
    if (this.resume) args.push('--resume', this.id);
    if (this.model) args.push('--model', this.model);
    if (this.effort) args.push('--effort', this.effort);
    if (this.chrome) args.push('--chrome', '--settings', CHROME_SETTINGS);
    const cwd = this.cwd && fs.existsSync(this.cwd) ? this.cwd : os.homedir();
    const proc = spawn(this.claude, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.stderr = '';
    this.lastError = '';
    proc.on('error', e => { this.lastError = e.message; this.emit('error', { message: e.message }); });
    proc.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
    readline.createInterface({ input: proc.stdout }).on('line', line => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      this.handle(m);
    });
    proc.on('exit', code => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (this.state !== 'idle') {
        this.lastError = this.stderr.trim().split('\n').pop() || `Claude stopped (exit ${code})`;
        this.emit('turn-end', { error: true, message: this.lastError });
      }
      this.pending.clear();
      this.holds.clear();
      for (const done of this.replies.values()) done({ subtype: 'error', error: 'Claude stopped before it answered.' });
      this.replies.clear();
      this.live = '';
      this.setState('idle');
      this.emit('exit', { code });
    });
    this.write({ type: 'control_request', request_id: rid(), request: { subtype: 'initialize', sdkMcpServers: [SERVER] } });
    // NOTE: [16 Oct 2026] EK - A headless CLI redacts thinking, so thinking_delta has no text. This asks for the summary. It is an
    // Agent SDK control request, not a published contract (checked on CLI 2.1.301). A CLI that ignores it works but shows no thinking.
    this.write({ type: 'control_request', request_id: rid(), request: { subtype: 'set_max_thinking_tokens', thinking_display: 'summarized' } });
  }

  respond(requestId, response) {
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  }

  // Resolves with the CLI's reply to a control request of ours, or an error reply if none comes.
  request(request, timeoutMs = 15_000) {
    return new Promise(resolve => {
      const id = rid();
      const timer = setTimeout(() => { this.replies.delete(id); resolve({ subtype: 'error', error: 'Claude did not answer in time.' }); }, timeoutMs);
      this.replies.set(id, reply => { clearTimeout(timer); resolve(reply); });
      this.write({ type: 'control_request', request_id: id, request });
    });
  }

  handle(m) {
    this.lastActive = Date.now();
    if (m.type === 'control_response') {
      const done = this.replies.get(m.response?.request_id);
      if (done) { this.replies.delete(m.response.request_id); done(m.response); }
      return;
    }
    if (m.type === 'control_request') {
      const r = m.request || {};
      if (r.subtype === 'mcp_message' && r.server_name === SERVER) {
        this.respond(m.request_id, { mcp_response: handleMcp(r.message || {}, { chips: this.chips, sessionId: this.id, cwd: this.cwd }) });
        return;
      }
      // Capcom's own tools only draw in the page, so they never need the user's say-so. Chrome is allowed the same way in Bypass.
      const bypassChrome = this.mode === 'bypassPermissions' && r.tool_name?.startsWith(CHROME_TOOL);
      if (r.subtype === 'can_use_tool' && (TOOL_NAMES.includes(r.tool_name) || bypassChrome)) {
        this.respond(m.request_id, { behavior: 'allow', updatedInput: r.input || {} });
        return;
      }
      if (r.subtype !== 'can_use_tool') {
        this.write({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: `Capcom does not handle ${r.subtype}` } });
        return;
      }
      const p = { requestId: m.request_id, tool: r.tool_name, label: r.display_name || r.tool_name, input: r.input || {},
        summary: toolSummary(r.tool_name, r.input, this.cwd), description: r.description || '', suggestions: r.permission_suggestions || [], at: Date.now() };
      this.pending.set(p.requestId, p);
      this.setState('waiting');
      this.emit('approval', p);
      return;
    }
    if (m.type === 'system' && m.subtype === 'init') {
      if (m.session_id && m.session_id !== this.id) this.onSession?.(m.session_id);
      this.emit('init', { sessionId: m.session_id, model: m.model });
      return;
    }
    if (m.type === 'system' && m.subtype === 'peer_message_hold') { this.hold(m); return; }
    if (m.type === 'system' && m.subtype === 'status' && m.status === 'requesting') { this.setState(this.pending.size ? 'waiting' : 'working'); return; }
    this.relay(this.work.feed(m));
    if (m.type === 'stream_event') {
      const e = m.event || {};
      if (e.type === 'message_start') this.live = '';
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        this.live += e.delta.text;
        this.emit('delta', { text: e.delta.text });
      }
      return;
    }
    if (m.type === 'assistant' || m.type === 'user') {
      if (m.type === 'assistant' && (m.message?.content || []).some(b => b.type === 'text')) this.live = '';
      this.emit('changed');
      return;
    }
    if (m.type === 'result') {
      // A turn the user stopped also ends as an error, which is not worth reporting.
      const error = !!m.is_error && !this.interrupted;
      this.interrupted = false;
      if (error) this.lastError = typeof m.result === 'string' && m.result ? m.result : RESULT_ERRORS[m.subtype] || 'The turn ended with an error.';
      this.live = '';
      this.setState(this.pending.size ? 'waiting' : 'idle');
      this.emit('turn-end', { error, message: error ? this.lastError : '', cost: m.total_cost_usd });
      this.emit('changed');
    }
  }

  // NOTE: [16 Oct 2026] EK - The CLI announces a message from another session that it parks as a peer_message_hold system message,
  // and a headless CLI has no request that approves one, so a hold is only shown (checked on CLI 2.1.301).
  hold(m) {
    // The sender chose its own name and the message id, so both are cut to size.
    const id = String(m.message_uuid || m.uuid || '').slice(0, 100);
    const from = label(m.from_name || m.from, 60);
    if (m.state === 'held') {
      const held = { id, from, cause: String(m.cause || '').slice(0, 40), at: Date.now() };
      this.holds.set(id, held);
      this.emit('hold', held);
    } else if (m.state === 'released' || m.state === 'dropped') {
      this.holds.delete(id);
      this.emit('hold-ended', { id, from, state: m.state, outcome: String(m.outcome || '').slice(0, 40) });
    }
  }

  send(text, images = []) {
    // A process told to stop still exists until it exits, but can no longer take a message, so start a fresh one.
    if (!this.proc?.stdin.writable) this.start();
    this.lastActive = Date.now();
    // With images the content is a list of blocks: the images first, then the text if there is any.
    const content = images.length
      ? [...images.map(({ mediaType, data }) => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })), ...(text.trim() ? [{ type: 'text', text }] : [])]
      : text;
    // Sent mid-turn, the CLI holds the message until the running tool finishes, then Claude reads it before its next step.
    this.write({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' });
    this.setState(this.pending.size ? 'waiting' : 'working');
    this.emit('sent', { text });
  }

  // A question is answered by allowing the call with the answers added to its input; allowing it unchanged
  // tells Claude the user did not answer.
  answer(requestId, decision, answers) {
    const p = this.pending.get(requestId);
    if (!p) return false;
    const response = decision === 'deny'
      ? { behavior: 'deny', message: p.tool === 'AskUserQuestion' ? 'The user skipped these questions in Capcom.' : 'The user denied this from Capcom.' }
      : decision === 'answer'
        ? { behavior: 'allow', updatedInput: { ...p.input, answers } }
        : { behavior: 'allow', updatedInput: p.input, ...(decision === 'always' && p.suggestions.length && !p.tool?.startsWith(CHROME_TOOL) ? { updatedPermissions: p.suggestions } : {}) };
    this.respond(requestId, response);
    this.pending.delete(requestId);
    this.lastActive = Date.now();
    this.setState(this.pending.size ? 'waiting' : 'working');
    this.emit('approval-resolved', { requestId, decision });
    return true;
  }

  interrupt() {
    if (!this.proc) return;
    this.interrupted = true;
    for (const id of [...this.pending.keys()]) this.answer(id, 'deny');
    this.write({ type: 'control_request', request_id: rid(), request: { subtype: 'interrupt' } });
  }

  // The mode changes only once the CLI accepts it, because Bypass decides here whether Chrome is allowed without a card.
  async setMode(mode) {
    await this.change('set_permission_mode', { mode });
    this.mode = mode;
    this.emit('mode', { mode });
  }

  // NOTE: [14 Oct 2026] EK - set_model and apply_flag_settings are the Agent SDK's control requests, not a published
  // contract; proven on CLI 2.1.299. apply_flag_settings accepts any effortLevel, so server.mjs checks the level first.
  // Both apply from the next request, even mid-turn. A process told to stop picks the new value up when it restarts.
  async setModel(model) {
    await this.change('set_model', { model });
    Object.assign(this, { model, shownModel: model });
    this.emit('model', { model });
  }

  async setEffort(effort) {
    await this.change('apply_flag_settings', { settings: { effortLevel: effort } });
    this.effort = effort;
    this.emit('effort', { effort });
  }

  async change(subtype, body) {
    if (!this.proc?.stdin.writable) return;
    const reply = await this.request({ subtype, ...body });
    if (reply.subtype === 'error') throw new Error(reply.error || 'Claude refused that change.');
  }

  stop() {
    const proc = this.proc;
    if (!proc) return;
    proc.stdin.end();
    setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGTERM'); }, 5000).unref();
  }
}

export const getChat = id => chats.get(id) || null;

export function chatFor(id, { cwd, mode, model, shownModel, effort, claude, chrome, chips }) {
  let chat = chats.get(id);
  if (!chat) {
    chat = new Chat({ id, cwd, mode, model, shownModel, effort, resume: true, claude, chrome, chips });
    chats.set(id, chat);
  }
  return chat;
}

// A new session has no id until the CLI's init message names it, so it waits under a temporary key.
export function startChat({ cwd, mode, model, shownModel, effort, text, images, claude, chrome, chips, timeoutMs = 60_000 }) {
  const chat = new Chat({ id: `new-${rid()}`, cwd, mode, model, shownModel, effort, resume: false, claude, chrome, chips });
  chats.set(chat.id, chat);
  return new Promise((resolve, reject) => {
    // A start that times out is stopped and forgotten, so a slow CLI cannot become a session that nothing knows about.
    const timer = setTimeout(() => {
      chat.onSession = null;
      chats.delete(chat.id);
      chat.stop();
      reject(new Error(chat.lastError || `Claude did not start within ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    chat.onSession = sessionId => {
      clearTimeout(timer);
      chats.delete(chat.id);
      chat.id = sessionId;
      chat.resume = true;
      chat.onSession = null;
      chats.set(sessionId, chat);
      resolve(chat);
    };
    chat.send(text, images);
  });
}

export function sweep(idleMinutes) {
  const limit = idleMinutes * 60_000;
  for (const [id, chat] of chats) {
    const idle = Date.now() - chat.lastActive > limit && chat.state === 'idle' && !chat.listeners.size;
    if (idle && chat.proc) chat.stop();
    else if (idle) chats.delete(id);
  }
}

export const activeStates = () => Object.fromEntries([...chats.values()].map(c => [c.id, c.state]));
