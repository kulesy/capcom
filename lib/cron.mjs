// Five fields in the Mac's local time: minute, hour, day of month, month, day of week. Each takes *, lists (1,15), ranges (1-5)
// and steps (*/10); day of week is 0 to 7 with Sunday 0 or 7. As in Vixie cron, if both day fields are restricted, either may match.

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
];

// A 29 February schedule can be four years away, so the search gives up after eight.
const SEARCH_MS = 8 * 366 * 86400_000;

function parseField(text, { name, min, max }) {
  const values = new Set();
  for (const part of text.split(',')) {
    const m = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`Cannot read "${part}" in the ${name} field.`);
    const step = m[3] === undefined ? 1 : Number(m[3]);
    const from = m[1] === undefined ? min : Number(m[1]);
    const to = m[2] !== undefined ? Number(m[2]) : m[1] !== undefined && m[3] === undefined ? from : max;
    if (step < 1) throw new Error(`The step in "${part}" in the ${name} field must be 1 or more.`);
    if (from < min || to > max || from > to) throw new Error(`"${part}" is outside ${min} to ${max} in the ${name} field.`);
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

export function parseCron(expression) {
  const parts = String(expression ?? '').trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`A schedule needs five fields (minute hour day-of-month month day-of-week), not "${expression}".`);
  const [minute, hour, dom, month, dow] = parts.map((part, i) => parseField(part, FIELDS[i]));
  if (dow.delete(7)) dow.add(0);
  return { minute, hour, dom, month, dow, domStar: parts[2].startsWith('*'), dowStar: parts[4].startsWith('*') };
}

const dayMatches = (spec, d) => {
  const dom = spec.dom.has(d.getDate());
  const dow = spec.dow.has(d.getDay());
  return spec.domStar || spec.dowStar ? dom && dow : dom || dow;
};

// True in the second pass through an hour that repeats when clocks go back. A wall-clock time that shows twice counts once.
const repeated = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()).getTime() < d.getTime();

// The first matching minute strictly after `after` (milliseconds), or null if none comes within eight years. A time that
// does not exist when clocks go forward is skipped for that day, and one that shows twice when they go back counts once.
// NOTE: [15 Oct 2026] EK - The hour and minute steps add real milliseconds instead of calling setMinutes. In the second pass
// through the hour that repeats when clocks go back, setMinutes lands an hour earlier (seen in Australia/Sydney, 4 Apr 2027).
export function nextSlot(spec, after) {
  const d = new Date((Math.floor(after / 60_000) + 1) * 60_000);
  const limit = after + SEARCH_MS;
  while (d.getTime() <= limit) {
    if (!spec.month.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
    } else if (!dayMatches(spec, d)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
    } else if (!spec.hour.has(d.getHours())) {
      d.setTime(d.getTime() + (60 - d.getMinutes()) * 60_000);
    } else if (!spec.minute.has(d.getMinutes()) || repeated(d)) {
      d.setTime(d.getTime() + 60_000);
    } else {
      return d.getTime();
    }
  }
  return null;
}

const parsed = new Map();

// When a routine with this schedule fires next after `after`: the next matching minute, then the jitter on top as a fixed
// offset, which is how Desktop spreads its routines. `after` and the result are milliseconds; null means it never fires.
export function nextFire(cron, after, jitterSeconds = 0) {
  if (!parsed.has(cron)) parsed.set(cron, parseCron(cron));
  const jitter = jitterSeconds * 1000;
  const slot = nextSlot(parsed.get(cron), after - jitter);
  return slot === null ? null : slot + jitter;
}
