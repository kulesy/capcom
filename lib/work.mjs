// What Claude is doing right now, read from the CLI's stream and never saved: the thinking so far, each tool call from the
// moment it is written, and the output tokens of the replies finished this turn. The transcript stays the record.
import { toolSummary } from './transcripts.mjs';

const oneLine = s => String(s).replace(/\s+/g, ' ').trim().slice(0, 200);

// `feed` takes each message the CLI prints and returns the [type, data] events the page should hear about.
export function createWork(cwd, now = Date.now) {
  let since = 0;
  let messageId = '';
  let think = null;
  const spent = new Map();
  const open = new Map();
  const tools = new Map();

  const isOpen = type => [...open.values()].some(b => b.type === type);
  const tokens = () => [...spent.values()].reduce((sum, n) => sum + n, 0);
  const snapshot = () => (since ? { thinking: isOpen('thinking'), writing: isOpen('text'), tools: [...tools.values()].map(t => ({ ...t })), tokens: tokens(), turnMs: now() - since } : null);
  const report = out => out.push(['work', snapshot()]);

  function delta(e, out) {
    const block = open.get(e.index);
    if (!block) return;
    if (e.delta?.type === 'input_json_delta') block.json += e.delta.partial_json || '';
    if (e.delta?.type !== 'thinking_delta' || !e.delta.thinking) return;
    if (think?.id !== messageId) think = { id: messageId, text: '', done: false };
    const text = (block.first && think.text ? '\n\n' : '') + e.delta.thinking;
    block.first = false;
    think.done = false;
    think.text += text;
    out.push(['think', { id: messageId, text }]);
  }

  function stop(e, out) {
    const block = open.get(e.index);
    if (!block) return;
    open.delete(e.index);
    if (block.type === 'thinking' && think?.id === messageId) {
      think.done = true;
      out.push(['think', { id: messageId, done: true }]);
    }
    if (block.type === 'tool_use' && tools.has(block.id)) {
      let input = {};
      try { input = JSON.parse(block.json || '{}'); } catch {}
      tools.get(block.id).summary = oneLine(toolSummary(block.name, input, cwd));
    }
    report(out);
  }

  function stream(e, out) {
    if (e.type === 'message_start') {
      messageId = e.message?.id || '';
      open.clear();
    } else if (e.type === 'content_block_start') {
      const b = e.content_block || {};
      open.set(e.index, { type: b.type, id: b.id, name: b.name, json: '', first: true });
      if (b.type === 'tool_use') tools.set(b.id, { id: b.id, name: b.name, summary: '' });
      report(out);
    } else if (e.type === 'content_block_delta') {
      delta(e, out);
    } else if (e.type === 'content_block_stop') {
      stop(e, out);
    } else if (e.type === 'message_delta' && e.usage?.output_tokens) {
      spent.set(messageId, e.usage.output_tokens);
      report(out);
    }
  }

  return {
    begin() {
      if (since) return [];
      since = now();
      return [['work', snapshot()]];
    },
    end() {
      since = 0;
      think = null;
      spent.clear();
      open.clear();
      tools.clear();
    },
    // A tool is also learned from the finished message, for a CLI that sends no partial ones, and is done when its result comes back.
    feed(m) {
      const out = [];
      if (!since || m.parent_tool_use_id) return out;
      if (m.type === 'stream_event') stream(m.event || {}, out);
      else if (m.type === 'assistant') {
        for (const b of m.message?.content || []) {
          if (b.type !== 'tool_use') continue;
          const summary = oneLine(toolSummary(b.name, b.input, cwd));
          if (tools.get(b.id)?.summary === summary) continue;
          tools.set(b.id, { id: b.id, name: b.name, summary });
          report(out);
        }
      } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
        let finished = false;
        for (const b of m.message.content) if (b.type === 'tool_result' && tools.delete(b.tool_use_id)) finished = true;
        if (finished) report(out);
      }
      return out;
    },
    snapshot,
    // Only a block still being written: a finished one is already in the transcript.
    thought: () => (think && !think.done ? { ...think } : null),
  };
}
