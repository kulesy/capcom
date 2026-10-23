// What the Routines page says and sends, as rules that need no page, so node can test them. Times are the Mac's, as the server writes them.
import { EFFORTS, LONG, MAIN, modelName } from './model-rules.js';

// A server that cannot say leaves the page read-only: the list, Run now and the switch work on every server, the rest only on this one.
export const supportsRoutineEdits = ix => !!ix?.features?.routineEdits;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = n => String(n).padStart(2, '0');
const clock = (h, m) => `${pad(h)}:${pad(m)}`;
const and = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0]);
const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

// The values of a field made of numbers, lists and ranges, or null for anything else, which includes a step.
function numbers(text, min, max) {
  const found = new Set();
  for (const part of text.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < min || to > max || from > to) return null;
    for (let n = from; n <= to; n++) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

function daysOf(dow) {
  const days = [...new Set(numbers(dow, 0, 7)?.map(d => d % 7))].sort((a, b) => (a + 6) % 7 - (b + 6) % 7);
  if (!days.length) return null;
  if (days.length === 7) return 'Every day';
  if (days.join() === '1,2,3,4,5') return 'Weekdays';
  if (days.join() === '6,0' || days.join() === '0,6') return 'Weekends';
  return days.length === 1 ? `${DAYS[days[0]]}s` : and(days.map(d => SHORT[d]));
}

function timeOf(minute, hour) {
  const step = /^\*\/(\d+)$/.exec(minute);
  if (hour === '*' && (minute === '*' || step)) {
    const every = minute === '*' ? 1 : Number(step[1]);
    if (every === 1) return 'every minute';
    return every < 60 && 60 % every === 0 ? `every ${every} minutes` : null;
  }
  const minutes = numbers(minute, 0, 59);
  if (!minutes) return null;
  if (hour === '*') {
    if (minutes.length !== 1) return null;
    return minutes[0] === 0 ? 'every hour, on the hour' : `every hour, at ${minutes[0]} ${minutes[0] === 1 ? 'minute' : 'minutes'} past`;
  }
  const hours = numbers(hour, 0, 23);
  if (!hours) return null;
  if (/^\d+-\d+$/.test(hour) && hours.length > 3 && minutes.length === 1) return `every hour from ${clock(hours[0], minutes[0])} to ${clock(hours.at(-1), minutes[0])}`;
  const times = hours.flatMap(h => minutes.map(m => clock(h, m)));
  return times.length <= 6 ? `at ${and(times)}` : null;
}

// "12 min 17 s" for 737, in the units a person would say it in.
export function jitterWords(seconds) {
  const s = Number(seconds) || 0;
  const parts = [[Math.floor(s / 3600), 'h'], [Math.floor(s / 60) % 60, 'min'], [s % 60, 's']].filter(([n]) => n > 0).map(([n, unit]) => `${n} ${unit}`);
  return parts.join(' ');
}

// A schedule in plain words, or null when it is not one of the plain shapes, so the page shows the cron alone rather than a wrong sentence.
export function scheduleWords(cron, jitterSeconds = 0) {
  const fields = typeof cron === 'string' ? cron.trim().split(/\s+/) : [];
  if (fields.length !== 5) return null;
  const [minute, hour, dom, month, dow] = fields;
  if (month !== '*') return null;
  let day;
  if (dom === '*') day = daysOf(dow === '*' ? '0-6' : dow);
  else if (dow === '*') {
    const dates = numbers(dom, 1, 31);
    day = dates && `The ${and(dates.map(ordinal))} of each month`;
  }
  const time = day && timeOf(minute, hour);
  if (!time) return null;
  const base = day === 'Every day' && time.startsWith('every') ? `${time[0].toUpperCase()}${time.slice(1)}` : `${day}${time.startsWith('at ') ? ' ' : ', '}${time}`;
  const jitter = jitterWords(jitterSeconds);
  return jitter ? `${base}, plus ${jitter}` : base;
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

// "Today, 07:42", "Tomorrow, 07:42", "Yesterday, 07:42" or "Fri 24 Oct, 07:42", with the year only when it is not this one. It reads the
// clock as the Mac wrote it, so a phone in another zone sees the time the schedule means. An empty string for a time it cannot read.
export function fireTime(iso, now = Date.now()) {
  const m = typeof iso === 'string' ? WALL.exec(iso) : null;
  if (!m) return '';
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  const offset = m[6] === undefined ? null : m[6] === 'Z' ? 0 : (m[6][0] === '-' ? -1 : 1) * (Number(m[6].slice(1, 3)) * 60 + Number(m[6].slice(-2)));
  const here = offset === null ? new Date(now) : new Date(now + offset * 60_000);
  const [ty, tm, td] = offset === null ? [here.getFullYear(), here.getMonth(), here.getDate()] : [here.getUTCFullYear(), here.getUTCMonth(), here.getUTCDate()];
  const day = Date.UTC(y, mo - 1, d);
  const apart = Math.round((day - Date.UTC(ty, tm, td)) / 86_400_000);
  const at = clock(h, mi);
  if (apart === 0) return `Today, ${at}`;
  if (apart === 1) return `Tomorrow, ${at}`;
  if (apart === -1) return `Yesterday, ${at}`;
  return `${SHORT[new Date(day).getUTCDay()]} ${d} ${MONTHS[mo - 1]}${y === ty ? '' : ` ${y}`}, ${at}`;
}

const inSentence = text => (/^(Today|Tomorrow|Yesterday),/.test(text) ? `${text[0].toLowerCase()}${text.slice(1)}` : text);

// What the scheduler recorded when it passed over a fire: "Skipped the run due yesterday, 07:42: the previous run is still working."
export function skippedWords(skipped, now = Date.now()) {
  if (!skipped || typeof skipped !== 'object' || typeof skipped.reason !== 'string') return '';
  const due = fireTime(skipped.fireAt, now);
  return `Skipped the run${due ? ` due ${inSentence(due)}` : ''}: ${skipped.reason}.`;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export const byTitle = routines => [...routines].sort((a, b) => collator.compare(String(a.title ?? a.id ?? ''), String(b.title ?? b.id ?? '')) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// Both apps would run a routine that is on in both. Off here it is Desktop's alone, which is a fact and no fault.
export function desktopNote(r) {
  if (!r.enabledInDesktop) return null;
  return r.enabled
    ? { warn: true, text: 'Also on in Claude Desktop, so both apps run it. Switch it off in Desktop.' }
    : { warn: false, text: 'Claude Desktop still runs this one.' };
}

export const deleteDetail = r => `It stops running. Its earlier runs stay in the list, and its prompt file stays at ${r.file}.`;

export const promptSource = p => (p.ours
  ? `Read from and saved to ${p.file}`
  : `Read from ${p.file}. Saving copies it to ${p.copyTo}, and the file in Claude Desktop stays as it is.`);

// ---- the form ------------------------------------------------------------------------------------

// The order the form shows its fields, so the first refused one is the one to focus.
export const FIELDS = ['title', 'cron', 'jitterSeconds', 'cwd', 'model', 'effort', 'mode', 'prompt'];

export const JITTER_PROBLEM = 'Use a whole number of seconds from 0 to 86399.';

export const newForm = home => ({ title: '', cron: '', jitterSeconds: '0', cwd: home, model: '', effort: '', mode: '', prompt: '', enabled: true });

export const formOf = (r, prompt) => ({
  title: r.title ?? '', cron: r.cron ?? '', jitterSeconds: String(r.jitterSeconds ?? 0), cwd: r.cwd ?? '',
  model: r.model ?? '', effort: r.effort ?? '', mode: r.mode ?? '', prompt, enabled: r.enabled === true,
});

// The jitter as a number, or null when the text is not a whole number of seconds in range.
export function jitterOf(text) {
  const t = String(text ?? '').trim();
  if (t === '') return 0;
  const n = /^\d+$/.test(t) ? Number(t) : NaN;
  return Number.isInteger(n) && n <= 86399 ? n : null;
}

const same = (a, b) => (a || null) === (b || null);

// What to send. A new routine sends every field. An edit sends only what changed, so a folder that has since gone does not refuse a new
// title, and the prompt only when its text changed. `was` is { routine, prompt } as loaded.
export function requestOf(form, was) {
  const jitter = jitterOf(form.jitterSeconds);
  const all = {
    title: form.title.trim(), cron: form.cron.trim().replace(/\s+/g, ' '), jitterSeconds: jitter ?? form.jitterSeconds, cwd: form.cwd.trim(),
    model: form.model || null, effort: form.effort || null, mode: form.mode || null, enabled: form.enabled,
  };
  if (!was) return { ...all, prompt: form.prompt };
  const r = was.routine;
  const changed = {
    ...(all.title !== r.title && { title: all.title }),
    ...(all.cron !== (r.cron ?? '').trim().replace(/\s+/g, ' ') && { cron: all.cron }),
    ...(jitter !== (r.jitterSeconds ?? 0) && { jitterSeconds: all.jitterSeconds }),
    ...(all.cwd !== r.cwd && { cwd: all.cwd }),
    ...(!same(all.model, r.model) && { model: all.model }),
    ...(!same(all.effort, r.effort) && { effort: all.effort }),
    ...(!same(all.mode, r.mode) && { mode: all.mode }),
    ...(all.enabled !== (r.enabled === true) && { enabled: all.enabled }),
    ...(form.prompt !== was.prompt && { prompt: form.prompt }),
  };
  return changed;
}

// The refused fields of a 400 in the form's order, and the first of them.
export function refusals(error) {
  const found = error?.data?.problems && typeof error.data.problems === 'object' ? error.data.problems : {};
  const fields = Object.fromEntries(FIELDS.filter(key => typeof found[key] === 'string' && found[key]).map(key => [key, found[key]]));
  return { fields, first: FIELDS.find(key => fields[key]) ?? null };
}

// A select's options with Default first. A value the list does not hold, such as a model Desktop recorded, is kept as its own option.
export function choices(list, current, name = id => id) {
  const options = [['', 'Default'], ...list];
  if (current && !options.some(([id]) => id === current)) options.push([current, name(current)]);
  return options;
}

export const modelChoices = current => choices([...MAIN, LONG], current, modelName);

export const effortChoices = current => choices(EFFORTS, current);

// ---- where it lives ------------------------------------------------------------------------------

export const ROUTINES_HASH = '#/routines';
export const NEW_ROUTINE_HASH = '#/routines/new';

// `new` is the add form's address, so a routine whose id is new is addressed by its escaped first letter.
export const routineHash = id => (id === 'new' ? '#/routines/%6Eew' : `${ROUTINES_HASH}/${encodeURIComponent(id)}`);

// The routes of the page: the list, the add form (id null) and a routine's form. Anything else under #/routines is the list.
export function routineRoute(hash) {
  if (hash === ROUTINES_HASH) return { form: false, id: null };
  if (hash === NEW_ROUTINE_HASH) return { form: true, id: null };
  if (!hash.startsWith(`${ROUTINES_HASH}/`)) return null;
  try {
    const id = decodeURIComponent(hash.slice(ROUTINES_HASH.length + 1));
    return /^[\w-]+$/.test(id) ? { form: true, id } : { form: false, id: null };
  } catch {
    return { form: false, id: null };
  }
}

// The routine whose latest run a row of Home's Routines section is, or undefined for any other row. A run of a routine that
// routines.json no longer holds has none.
export function routineFor(ix, routines, rowId) {
  const group = ix?.routines?.find(g => g.latest?.id === rowId);
  return group && routines?.routines?.find(r => r.id === group.name);
}
