// What Claude is doing right now, read from the CLI's stream and never saved: the thinking so far, each tool call from the
// moment it is written, and the output tokens of the replies finished this turn. The transcript stays the record.
import { label } from './notices.mjs';
import { toolSummary } from './transcripts.mjs';

const oneLine = s => String(s).replace(/\s+/g, ' ').trim().slice(0, 200);

// A widget tool call can open with a few phrases to show while the code is written. They are read as they stream, and from a finished
// message for a CLI that streams nothing partial. The page shows them, so they are cut to short single lines.
const WIDGET = /__show_widget$/;
const LOADING_MAX = 4;
const LOADING_CHARS = 80;
// The key as the CLI streams it. The same words inside widget_code have their quotes escaped, so they never match here.
const LOADING_KEY = /[{,]\s*"loading_messages"\s*:\s*\[/g;
// A search that finds nothing starts again this far back, which is longer than the key and the space round it, so a key split
// between two deltas is still found without reading the whole input again.
const KEY_LOOKBACK = 64;
// A phrase this long is no phrase, so reading stops there instead of rereading it on every delta.
const LITERAL_MAX = 400;

const isWidget = name => typeof name === 'string' && WIDGET.test(name);
const loadingLine = text => (typeof text === 'string' ? [...label(text)].slice(0, LOADING_CHARS).join('').trim() : '');
const loadingList = values => (Array.isArray(values) ? values.map(loadingLine).filter(Boolean).slice(0, LOADING_MAX) : []);
const sameList = (a = [], b = []) => a.length === b.length && a.every((text, i) => text === b[i]);

// Reads the strings of a widget call's loading_messages out of the input so far. `scan` holds where the last look ended, so each
// delta is read once. It returns true when the list grew.
function readLoading(scan, json) {
  if (scan.done) return false;
  if (scan.at < 0) {
    LOADING_KEY.lastIndex = scan.from;
    const key = LOADING_KEY.exec(json);
    if (!key) {
      scan.from = Math.max(scan.from, json.length - KEY_LOOKBACK);
      return false;
    }
    scan.at = key.index + key[0].length;
  }
  const before = scan.messages.length;
  while (!scan.done) {
    let start = scan.at;
    while (start < json.length && /[\s,]/.test(json[start])) start++;
    scan.at = start;
    if (start >= json.length) break;
    if (json[start] !== '"') {
      scan.done = true;
      break;
    }
    let end = start + 1;
    while (end < json.length && json[end] !== '"' && end - start < LITERAL_MAX) end += json[end] === '\\' ? 2 : 1;
    if (end >= json.length || end - start >= LITERAL_MAX) {
      scan.done = end - start >= LITERAL_MAX;
      break;
    }
    scan.at = end + 1;
    let line = '';
    try { line = loadingLine(JSON.parse(json.slice(start, end + 1))); } catch {}
    if (line) scan.messages.push(line);
    if (scan.messages.length >= LOADING_MAX) scan.done = true;
  }
  return scan.messages.length > before;
}

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
    if (e.delta?.type === 'input_json_delta') {
      block.json += e.delta.partial_json || '';
      // A new array each time, because a snapshot already sent shares the old one.
      if (block.scan && readLoading(block.scan, block.json) && tools.has(block.id)) {
        tools.get(block.id).loading = [...block.scan.messages];
        report(out);
      }
    }
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
      const block = { type: b.type, id: b.id, name: b.name, json: '', first: true };
      if (b.type === 'tool_use' && isWidget(b.name)) block.scan = { from: 0, at: -1, done: false, messages: [] };
      open.set(e.index, block);
      if (b.type === 'tool_use') tools.set(b.id, { id: b.id, name: typeof b.name === 'string' ? b.name : '', summary: '' });
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
      else if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
        for (const b of m.message.content) {
          if (b?.type !== 'tool_use') continue;
          const summary = oneLine(toolSummary(b.name, b.input, cwd));
          const known = tools.get(b.id);
          const finished = isWidget(b.name) ? loadingList(b.input?.loading_messages) : [];
          const loading = finished.length ? finished : known?.loading;
          if (known?.summary === summary && sameList(known.loading, loading)) continue;
          tools.set(b.id, { id: b.id, name: typeof b.name === 'string' ? b.name : '', summary, ...(loading ? { loading } : {}) });
          report(out);
        }
      } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
        let finished = false;
        for (const b of m.message.content) if (b?.type === 'tool_result' && tools.delete(b.tool_use_id)) finished = true;
        if (finished) report(out);
      }
      return out;
    },
    snapshot,
    // Only a block still being written: a finished one is already in the transcript.
    thought: () => (think && !think.done ? { ...think } : null),
  };
}
