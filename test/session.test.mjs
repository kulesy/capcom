// Run with `npm test`. A chat's controller is plain functions on plain data, so it runs here against a fake page,
// event stream and server, with no browser.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const streams = [];
class FakeStream {
  constructor(url) { this.url = url; this.heard = {}; streams.push(this); }
  addEventListener(type, fn) { this.heard[type] = fn; }
  close() {}
  emit(type, data) { this.heard[type]({ data: JSON.stringify(data) }); }
}
globalThis.document = { getElementById: () => ({ dataset: {} }), addEventListener() {}, removeEventListener() {}, hidden: false };
globalThis.EventSource = FakeStream;
globalThis.fetch = async url => {
  const body = String(url).endsWith('/chips') ? { chips: [] } : { items: [], start: 0, end: 0, hasEarlier: false };
  return { status: 200, ok: true, json: async () => body };
};
// The page reads the document as the module loads, so the fake has to be in place first.
const { createChat } = await import('../public/ui/session.js');

async function openChat(id) {
  const chat = createChat({ id, refreshIndex() {} });
  await chat.open();
  return { chat, stream: streams.at(-1) };
}
const undelivered = id => ({ id, from: 'Worker', state: 'dropped', outcome: 'expired' });
const cards = chat => chat.store.get().holdsEnded.map(d => d.id);

test('the grey cards of a chat are still there when the owner opens another chat and comes back', async () => {
  const one = await openChat('chat-switch');
  one.stream.emit('hold-ended', undelivered('a'));
  one.stream.emit('hold-ended', { id: 'r', from: 'Worker', state: 'released', outcome: '' });
  one.stream.emit('hold-ended', undelivered('b'));
  one.chat.close();
  const other = await openChat('chat-elsewhere');
  assert.deepEqual(cards(other.chat), [], 'another chat has none of them');
  other.chat.close();
  assert.deepEqual(cards(createChat({ id: 'chat-switch', refreshIndex() {} })), ['a', 'b'], 'there as the pane is built, and a released hold left none');
});

test('a card goes when the owner dismisses it, and stays gone the next time the chat is opened', async () => {
  const one = await openChat('chat-dismiss');
  for (const id of ['a', 'b', 'c']) one.stream.emit('hold-ended', undelivered(id));
  one.chat.dismissHold(['a', 'b']);
  assert.deepEqual(cards(one.chat), ['c']);
  one.chat.close();
  assert.deepEqual(cards(createChat({ id: 'chat-dismiss', refreshIndex() {} })), ['c']);
});

test('a chat keeps its 100 newest undelivered messages and drops the oldest first', async () => {
  const one = await openChat('chat-many');
  for (let n = 0; n < 105; n++) one.stream.emit('hold-ended', undelivered(`m${n}`));
  one.chat.close();
  const kept = cards(createChat({ id: 'chat-many', refreshIndex() {} }));
  assert.equal(kept.length, 100);
  assert.deepEqual([kept[0], kept.at(-1)], ['m5', 'm104']);
});

// A fake server for one test: the chat opens on `starts[0]`, each Load earlier moves to the next start, and `pictures` answers the list of pictures.
async function withServer({ starts, pictures }, run) {
  const real = globalThis.fetch;
  const asked = [];
  let moved = 0;
  const reply = body => ({ status: 200, ok: true, json: async () => body });
  globalThis.fetch = async url => {
    const address = String(url);
    if (address.includes('/images?')) { asked.push(address); return pictures(address); }
    if (address.endsWith('/chips')) return reply({ chips: [] });
    const start = starts[address.includes('/messages?before=') ? ++moved : 0];
    return reply({ items: [], start, end: 900, hasEarlier: start > 0 });
  };
  try { await run(asked); } finally { globalThis.fetch = real; }
}
const failure = error => ({ status: 500, ok: false, json: async () => ({ error }) });
const listing = ref => ({ status: 200, ok: true, json: async () => ({ items: [{ kind: 'user', images: [{ ref, type: 'image/png' }] }] }) });

test('the viewer asks for the pictures before the loaded messages once for each start, again after Load earlier, and again after a failed answer', async () => {
  let failing = false;
  const pictures = address => (failing ? failure('Could not list the pictures.') : listing(`${/before=(\d+)/.exec(address)[1]}.0.u`));
  await withServer({ starts: [600, 200, 100], pictures }, async asked => {
    const { chat } = await openChat('chat-pictures');
    const refs = async () => (await chat.earlierImages()).map(item => item.images[0].ref);
    assert.deepEqual(await refs(), ['600.0.u']);
    assert.deepEqual(await refs(), ['600.0.u']);
    assert.deepEqual(asked, ['api/sessions/chat-pictures/images?before=600'], 'once for the start the chat opened with');

    await chat.loadEarlier();
    assert.deepEqual(await refs(), ['200.0.u']);
    assert.deepEqual(await refs(), ['200.0.u']);
    assert.deepEqual(asked.slice(1), ['api/sessions/chat-pictures/images?before=200'], 'and once more now that the start has moved');

    await chat.loadEarlier();
    failing = true;
    await assert.rejects(chat.earlierImages(), /Could not list the pictures/);
    failing = false;
    assert.deepEqual(await refs(), ['100.0.u'], 'a failed answer is not kept');
    assert.deepEqual(await refs(), ['100.0.u']);
    assert.equal(asked.length, 4);
    chat.close();
  });
});

test('an answer that fails after the start has moved on is dropped without taking away the answer for the new start', async () => {
  let failSlow;
  const pictures = address => (address.endsWith('before=600')
    ? new Promise(resolve => { failSlow = () => resolve(failure('Too slow.')); })
    : listing('200.0.u'));
  await withServer({ starts: [600, 200], pictures }, async asked => {
    const { chat } = await openChat('chat-moved-on');
    const slow = assert.rejects(chat.earlierImages(), /Too slow/);
    await chat.loadEarlier();
    const fresh = await chat.earlierImages();
    failSlow();
    await slow;
    assert.equal(await chat.earlierImages(), fresh, 'the answer for the new start is still the one kept');
    assert.equal(asked.length, 2);
    chat.close();
  });
});

test('connector names that Desktop gives after the chat opened reach it, and the same names again leave its session as it was', async () => {
  const real = globalThis.fetch;
  const planner = '5b6c7d8e-2222-4f3a-8b9c-abcdef012345';
  let connectors = {};
  globalThis.fetch = async url => {
    const body = String(url).endsWith('/chips')
      ? { chips: [] }
      : { items: [], start: 0, end: 10, hasEarlier: false, session: connectors && { id: 'chat-names', title: 'Moved to Desktop', connectors: { ...connectors } } };
    return { status: 200, ok: true, json: async () => body };
  };
  const settled = () => new Promise(resolve => setImmediate(resolve));
  try {
    const { chat, stream } = await openChat('chat-names');
    const session = () => chat.store.get().session;
    assert.deepEqual(session().connectors, {}, 'Desktop had no record when the chat opened');

    connectors = { [planner]: 'Planner' };
    stream.emit('changed', {});
    await settled();
    assert.deepEqual(session(), { id: 'chat-names', title: 'Moved to Desktop', connectors: { [planner]: 'Planner' } });

    const held = session();
    stream.emit('changed', {});
    await settled();
    assert.equal(session(), held, 'the same names again change nothing');

    connectors = null;
    stream.emit('changed', {});
    await settled();
    assert.equal(session(), held, 'a reply with no session keeps the names');
    chat.close();
  } finally {
    globalThis.fetch = real;
  }
});

// The page times a turn by its own clock, so the tests below set the clock the handlers read and put it back after.
const turnOf = (startedAt, turnMs) => ({ tools: [], tokens: 0, turnMs, startedAt });
async function onClock(id, run) {
  const { chat, stream } = await openChat(id);
  const real = Date.now;
  const clock = at => { Date.now = () => at; };
  try {
    run({ stream, clock, now: () => chat.store.get() });
  } finally {
    Date.now = real;
    chat.close();
  }
}

test('the start of a turn another app runs only moves earlier while it is the same turn, begins again for a new turn, and clears when the turn ends', async () => {
  await onClock('chat-outside-start', ({ stream, clock, now }) => {
    clock(1_000_000);
    stream.emit('outside', turnOf(5000, 30_000));
    assert.deepEqual([now().outside.startedAt, now().outsideStart], [5000, 970_000], 'timed from the page\'s clock');

    clock(1_002_000);
    stream.emit('outside', turnOf(5000, 31_000));
    assert.equal(now().outsideStart, 970_000, 'a report that is late for the same turn does not step the timer back');

    clock(1_003_000);
    stream.emit('outside', turnOf(5000, 40_000));
    assert.equal(now().outsideStart, 963_000, 'one that puts the start earlier moves it');

    clock(1_004_000);
    stream.emit('outside', turnOf(9000, 2000));
    assert.equal(now().outsideStart, 1_002_000, 'a new turn starts the timer again, though that is later');

    stream.emit('outside', null);
    assert.deepEqual([now().outside, now().outsideStart], [null, 0]);

    clock(1_005_000);
    stream.emit('outside', turnOf(9000, 4000));
    assert.equal(now().outsideStart, 1_001_000, 'after an end the same start is a turn of its own, with nothing earlier to keep');
  });
});

test('the status sets the turn another app runs and its timer, and a status without one clears them', async () => {
  await onClock('chat-outside-status', ({ stream, clock, now }) => {
    clock(2_000_000);
    stream.emit('status', { state: 'idle', pending: [], outside: turnOf(7000, 60_000) });
    assert.deepEqual([now().outside.startedAt, now().outsideStart], [7000, 1_940_000]);
    assert.equal(now().work, null);
    assert.equal(now().turnStart, 0);

    stream.emit('status', { state: 'idle', pending: [], outside: null });
    assert.deepEqual([now().outside, now().outsideStart], [null, 0], 'a status with no turn');

    stream.emit('status', { state: 'idle', pending: [], outside: turnOf(7000, 60_000) });
    stream.emit('status', { state: 'idle', pending: [] });
    assert.deepEqual([now().outside, now().outsideStart], [null, 0], 'and one from a server that does not say');
  });
});

test('Capcom\'s work in a chat takes over from the turn another app ran, and the end of that work leaves a turn that came back as it is', async () => {
  await onClock('chat-outside-state', ({ stream, clock, now }) => {
    clock(3_000_000);
    stream.emit('outside', turnOf(7000, 60_000));
    stream.emit('work', { thinking: false, writing: false, tools: [], tokens: 5, turnMs: 1000 });
    assert.deepEqual([now().outsideStart, now().turnStart], [2_940_000, 2_999_000]);

    for (const state of ['working', 'waiting']) {
      stream.emit('outside', turnOf(7000, 60_000));
      stream.emit('state', { state });
      assert.deepEqual([now().outside, now().outsideStart], [null, 0], `the turn of the other app goes when the chat is ${state}`);
      assert.equal(now().status.state, state);
      assert.equal(now().work.tokens, 5, 'and Capcom\'s own work stays');
      assert.equal(now().turnStart, 2_999_000);
    }

    stream.emit('outside', turnOf(7000, 61_000));
    stream.emit('state', { state: 'idle' });
    assert.deepEqual([now().work, now().turnStart], [null, 0], 'Capcom\'s work goes when the chat is idle');
    assert.deepEqual([now().outside.startedAt, now().outsideStart], [7000, 2_939_000], 'and a turn of another app is left alone');
    assert.equal(now().status.state, 'idle');
  });
});

// A fake server for the context. `respond(detail, n)` gives the reply to the nth request, which asks for `detail`, and every request is logged.
const answer = body => ({ status: 200, ok: true, json: async () => body });
const figure = { source: 'process', detail: 'summary', total: 47_760, window: 300_000, autoCompactAt: 267_000, model: 'claude-haiku-5-5' };
const counted = {
  ...figure, detail: 'full',
  categories: [{ id: 'messages', name: 'Messages', tokens: 30_000 }, { id: 'system_prompt', name: 'System prompt', tokens: 14_300 }],
  buffer: { name: 'Autocompact buffer', tokens: 33_000 },
  free: { name: 'Free space', tokens: 219_240 },
};
const settled = () => new Promise(resolve => setImmediate(resolve));

async function withContext(respond, run) {
  const real = globalThis.fetch;
  const asked = [];
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.endsWith('/context')) {
      calls.push({ address, method: options?.method, body: options?.body });
      asked.push(JSON.parse(options.body).detail);
      return respond(asked.at(-1), asked.length);
    }
    if (address.endsWith('/model')) return answer({ state: 'idle', pending: [], model: JSON.parse(options.body).model });
    return real(url, options);
  };
  try { await run(asked, calls); } finally { globalThis.fetch = real; }
}

test('a chat asks for its context when the first status arrives, by POST because an ask can save a window, and keeps the figure that comes back', async () => {
  await withContext(() => answer(figure), async (asked, calls) => {
    const { chat, stream } = await openChat('chat-context');
    assert.equal(chat.store.get().context, null, 'nothing before the first status');
    stream.emit('status', { state: 'idle', pending: [] });
    await settled();
    assert.deepEqual(asked, ['summary']);
    assert.deepEqual(calls, [{ address: 'api/sessions/chat-context/context', method: 'POST', body: '{"detail":"summary"}' }]);
    assert.deepEqual(chat.store.get().context, figure);
    chat.close();
  });
});

test('the context is counted at most once in 5 seconds, what comes sooner is counted when they are up, and a closed chat counts nothing more', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    await withContext(() => answer(figure), async asked => {
      const { chat, stream } = await openChat('chat-throttle');
      stream.emit('status', { state: 'idle', pending: [] });
      await settled();
      assert.equal(asked.length, 1, 'the first is counted at once');

      stream.emit('changed', {});
      stream.emit('changed', {});
      stream.emit('turn-end', {});
      mock.timers.tick(4999);
      await settled();
      assert.equal(asked.length, 1, 'three events inside the 5 seconds wait');
      mock.timers.tick(1);
      await settled();
      assert.equal(asked.length, 2, 'and are one count once the 5 seconds are up');

      stream.emit('exit', {});
      mock.timers.tick(5000);
      await settled();
      assert.equal(asked.length, 3, 'the end of the process is counted too');

      stream.emit('changed', {});
      chat.close();
      mock.timers.tick(10_000);
      await settled();
      assert.equal(asked.length, 3, 'a count that was waiting is dropped with the chat');
    });
  } finally {
    mock.timers.reset();
  }
});

test('a new session that has not started has no window to count', async () => {
  await withContext(() => answer(figure), async asked => {
    const chat = createChat({ draft: true, refreshIndex() {} });
    assert.equal(await chat.loadContext(), null);
    assert.equal(await chat.loadContext('full'), null);
    assert.deepEqual(asked, []);
    assert.equal(chat.store.get().context, null);
  });
});

test('an answer that comes after the chat has closed is dropped', async () => {
  let release;
  await withContext(() => new Promise(resolve => { release = () => resolve(answer(figure)); }), async () => {
    const { chat, stream } = await openChat('chat-late');
    stream.emit('status', { state: 'idle', pending: [] });
    await settled();
    chat.close();
    release();
    await settled();
    assert.equal(chat.store.get().context, null);
  });
});

test('a count that fails, or comes back as something else, leaves the last figure on show', async () => {
  const replies = [answer(figure), failure('Boom.'), answer({ items: [], start: 0, end: 0, hasEarlier: false }), answer({ source: 'none', compacted: true })];
  await withContext((detail, n) => replies[n - 1], async () => {
    const { chat } = await openChat('chat-failing');
    assert.deepEqual(await chat.loadContext(), figure);
    assert.equal(await chat.loadContext(), null, 'a failure gives nothing');
    assert.deepEqual(chat.store.get().context, figure);
    assert.deepEqual(await chat.loadContext(), figure, 'the page of messages is not a figure');
    assert.deepEqual(chat.store.get().context, figure);
    assert.deepEqual(await chat.loadContext(), { source: 'none', compacted: true }, 'a real answer that there is no figure now');
    assert.deepEqual(chat.store.get().context, { source: 'none', compacted: true });
    chat.close();
  });
});

test('a full count is asked for once however many ask, brings the parts, and is kept by a summary of the same count', async () => {
  let now = figure;
  await withContext(detail => answer(detail === 'full' ? counted : now), async asked => {
    const { chat } = await openChat('chat-parts');
    const first = chat.loadContext('full');
    assert.equal(chat.loadContext('full'), first, 'the second asker waits for the first');
    assert.deepEqual(await first, counted);
    assert.deepEqual(asked, ['full']);

    await chat.loadContext('summary');
    assert.deepEqual(chat.store.get().context.categories, counted.categories, 'the same count keeps its parts');

    now = { ...figure, total: 52_000 };
    await chat.loadContext('summary');
    assert.deepEqual(chat.store.get().context, now, 'a count that has moved on does not');
    chat.close();
  });
});

test('picking a model counts the window again, because a model can have a window of its own', async () => {
  await withContext(() => answer(figure), async asked => {
    const { chat } = await openChat('chat-model');
    await chat.pick('model', 'claude-haiku-5-5');
    await settled();
    assert.deepEqual(asked, ['summary']);
    await chat.pick('effort', 'high');
    await settled();
    assert.equal(asked.length, 1, 'an effort does not change it');
    chat.close();
  });
});

test('a model changed in another tab counts the window again, because the new model can have a window of its own', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    await withContext(() => answer(figure), async asked => {
      const { chat, stream } = await openChat('chat-other-tab');
      stream.emit('status', { state: 'idle', pending: [] });
      await settled();
      assert.equal(asked.length, 1);

      stream.emit('model', { model: 'claude-opus-5-5[1m]' });
      await settled();
      assert.equal(chat.store.get().status.model, 'claude-opus-5-5[1m]');
      assert.equal(asked.length, 1, 'inside the 5 seconds it waits like any other count');
      mock.timers.tick(5000);
      await settled();
      assert.deepEqual(asked, ['summary', 'summary']);
      chat.close();
    });
  } finally {
    mock.timers.reset();
  }
});

// The reply to each full count waits for the test to let it go.
const holding = (replies, otherwise) => {
  const release = [];
  const respond = (detail, n) => {
    if (detail !== 'full') return otherwise(n);
    const reply = answer(replies[release.length]);
    return new Promise(resolve => release.push(() => resolve(reply)));
  };
  return { respond, release };
};

test('a full count that lands after a newer summary does not put the older total back: it is asked for again, and whoever waited gets the parts', async () => {
  const older = { ...counted, total: 40_000 };
  const newer = { ...counted, total: 52_000 };
  const { respond, release } = holding([older, newer], () => answer({ ...figure, total: 52_000 }));
  await withContext(respond, async asked => {
    const { chat } = await openChat('chat-race');
    const totals = [];
    chat.store.subscribe(() => totals.push(chat.store.get().context?.total));
    const waiting = chat.loadContext('full');
    await chat.loadContext('summary');
    assert.equal(chat.store.get().context.total, 52_000);

    release[0]();
    await settled();
    assert.deepEqual(asked, ['full', 'summary', 'full'], 'the older count was dropped and counted again');
    assert.equal(chat.store.get().context.categories, undefined, 'the table waits for the new count');
    assert.equal(chat.loadContext('full'), waiting, 'and a new asker waits for the same one');

    release[1]();
    assert.deepEqual(await waiting, newer);
    assert.deepEqual(chat.store.get().context, newer);
    assert.equal(totals.includes(40_000), false, 'the older total was never on show');
    chat.close();
  });
});

test('a full count dropped twice is not asked for a third time, and the figure on show stays', async () => {
  const { respond, release } = holding([{ ...counted, total: 40_000 }, { ...counted, total: 52_000 }], n => answer({ ...figure, total: n === 2 ? 51_000 : 53_000 }));
  await withContext(respond, async asked => {
    const { chat } = await openChat('chat-twice');
    const waiting = chat.loadContext('full');
    await chat.loadContext('summary');
    release[0]();
    await settled();
    await chat.loadContext('summary');
    release[1]();
    const got = await waiting;
    await settled();
    assert.deepEqual(asked, ['full', 'summary', 'full', 'summary'], 'no third full count');
    assert.deepEqual([got.total, got.categories], [53_000, undefined]);
    assert.deepEqual(chat.store.get().context, got);
    assert.equal(chat.loadContext('full') === waiting, false, 'and the next ask starts fresh');
    chat.close();
  });
});

test('a summary that lands after a newer full count is dropped, so the parts stay and it is not asked for again', async () => {
  let release;
  await withContext(detail => (detail === 'summary' ? new Promise(resolve => { release = () => resolve(answer({ ...figure, total: 40_000 })); }) : answer(counted)), async asked => {
    const { chat } = await openChat('chat-slow-summary');
    const slow = chat.loadContext('summary');
    await chat.loadContext('full');
    release();
    assert.deepEqual(await slow, counted);
    assert.deepEqual(chat.store.get().context, counted);
    assert.deepEqual(asked, ['summary', 'full']);
    chat.close();
  });
});

test('a count that failed does not stand in the way of an older one that comes back', async () => {
  let release;
  await withContext((detail, n) => (n === 1 ? new Promise(resolve => { release = () => resolve(answer(figure)); }) : failure('Boom.')), async () => {
    const { chat } = await openChat('chat-failed-newer');
    const older = chat.loadContext('full');
    assert.equal(await chat.loadContext('summary'), null, 'the newer count failed');
    release();
    assert.deepEqual(await older, figure, 'so the older one is still the newest there is');
    assert.deepEqual(chat.store.get().context, figure);
    chat.close();
  });
});
