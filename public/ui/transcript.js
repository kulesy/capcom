import { md } from '../md.mjs';
import { duration, tokenCount } from './format.js';
import { threadImages } from './gallery.js';
import { html, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from './html.js';
import { useClock, useFields, useStick, useStore } from './hooks.js';
import { isChip, Row, Thought } from './rows.js';
import { activity, display } from './thread.js';
import { closeViewer, openViewer } from './viewer.js';
import { DEFAULT_TEXT, hasRow, HOLD_MS, nextHold, ROTATE_MS, waitText } from './widget-wait.js';

// Claude's thinking as it is written. It is open while it grows and folds once the block ends.
function LiveThink({ think }) {
  const body = useRef(null);
  useStick(body);
  return html`<div class="live-think"><div class="think"><${Thought} text=${think.text} name=${think.done ? 'Thought' : 'Thinking'} open=${!think.done} bodyRef=${body} /></div></div>`;
}

// What Claude is doing now, how long the turn has run, and the tokens of the replies it has finished.
function Working({ work, since, on, names }) {
  useClock(on);
  const { doing, detail } = activity(work, names);
  const meta = [work && duration(Date.now() - since), work?.tokens > 0 && `${tokenCount(work.tokens)} tokens`].filter(Boolean).join(' · ');
  return html`<p class="working" id="working" hidden=${!on}><span class="lamp" data-state="working"></span>
    <span class="working-text" id="workingText"><span class="working-doing">${doing}</span>${detail ? html`<span class="working-detail">${detail}</span>` : null}</span>
    <span class="working-meta" title="Time since the turn began, and the tokens in the replies Claude has finished this turn. The count moves when a reply ends, not while it is written.">${meta}</span></p>`;
}

// The phrases Claude sent with the widget call, one after another, where the widget will draw. A different call gets a new one.
function WidgetPlaceholder({ loading }) {
  const [step, setStep] = useState(0);
  const rotates = loading.length > 1;
  useEffect(() => {
    if (!rotates) return undefined;
    const timer = setInterval(() => setStep(n => n + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [rotates]);
  return html`<div class="widget-wait" aria-hidden="true"><span class="widget-wait-text" key=${step}>${waitText(loading, step)}</span></div>`;
}

// Holds a place for a widget from the moment Claude starts writing it until its row is in the thread. The phrases are for the eye: a
// screen reader hears one status line when the place appears, and is not read every change of phrase.
function WidgetWait({ ctrl, work }) {
  const items = useStore(ctrl.store, s => s.items);
  const held = useRef(null);
  const [, recheck] = useReducer(n => n + 1, 0);
  held.current = nextHold({ held: held.current, tools: work?.tools, inThread: id => hasRow(items, id), now: Date.now() });
  const place = held.current;
  // Nothing else draws the page again when the hold runs out, so a timer does.
  useEffect(() => {
    if (place?.since == null) return undefined;
    const timer = setTimeout(recheck, Math.max(0, HOLD_MS - (Date.now() - place.since)) + 20);
    return () => clearTimeout(timer);
  }, [place?.id, place?.since]);
  return html`<p class="sr" role="status">${place ? DEFAULT_TEXT : ''}</p>
    ${place ? html`<${WidgetPlaceholder} key=${place.id} loading=${place.loading} />` : null}`;
}

// The thinking and the reply as they are written, the place held for a widget, and the line that says what Claude is doing.
function Live({ ctrl, box }) {
  const { live, think, work, turnStart } = useFields(ctrl.store, 'live', 'think', 'work', 'turnStart');
  const state = useStore(ctrl.store, s => s.status?.state || 'idle');
  const names = useStore(ctrl.store, s => s.session?.connectors);
  useStick(box);
  return html`${think ? html`<${LiveThink} think=${think} />` : null}
    <div class="msg claude live" id="live" hidden=${!live} dangerouslySetInnerHTML=${{ __html: live ? md(live) : '' }}></div>
    <${WidgetWait} ctrl=${ctrl} work=${work} />
    <${Working} work=${work} since=${turnStart} on=${state === 'working'} names=${names} />`;
}

export function Transcript({ ctrl }) {
  const box = useRef(null);
  const fromBottom = useRef(0);
  const { items, chips, sending, hasEarlier, loadingEarlier, loaded, jump, earlierSeq, session } = useFields(
    ctrl.store, 'items', 'chips', 'sending', 'hasEarlier', 'loadingEarlier', 'loaded', 'jump', 'earlierSeq', 'session',
  );
  const rows = useMemo(() => display(items), [items]);
  useStick(box);
  // Opening a session and sending a message both end at the bottom; loading earlier keeps what you were looking at.
  useLayoutEffect(() => { if (loaded || jump) box.current.scrollTop = box.current.scrollHeight; }, [loaded, jump]);
  useLayoutEffect(() => { if (earlierSeq) box.current.scrollTop = box.current.scrollHeight - fromBottom.current; }, [earlierSeq]);

  const loadEarlier = () => {
    fromBottom.current = box.current.scrollHeight - box.current.scrollTop;
    ctrl.loadEarlier();
  };

  // The viewer steps through the pictures the thread holds when one is clicked, and back through those of the unloaded messages, which the server lists. It closes with the chat.
  const viewImage = useCallback((key, from) => {
    const names = () => ctrl.store.get().session?.connectors;
    const thread = () => {
      const { items: saved, sending: unsent } = ctrl.store.get();
      return threadImages(saved, unsent, ctrl.imageUrl, names());
    };
    const images = thread();
    const earlier = ctrl.store.get().hasEarlier ? ctrl.earlierImages().then(list => threadImages(list, [], ctrl.imageUrl, names())) : null;
    openViewer(images, Math.max(0, images.findIndex(i => i.key === key)), from, thread, earlier);
  }, [ctrl]);
  useEffect(() => closeViewer, []);

  return html`<div class="transcript" id="transcript" ref=${box}>
    ${ctrl.draft ? html`<p class="quiet pad" id="newHint">Pick a folder, then say what Claude should do. The session starts there.</p>` : null}
    <button class="button earlier" id="earlier" type="button" hidden=${!hasEarlier} disabled=${loadingEarlier} onClick=${loadEarlier}>Load earlier</button>
    <ol class="items" id="items">
      ${rows.map(i => html`<${Row} key=${i.key} item=${i} chip=${isChip(i) ? chips.get(i.id) : undefined} cwd=${isChip(i) ? session?.cwd : undefined} onChip=${ctrl.chip} imageUrl=${ctrl.imageUrl} onImage=${viewImage} connectors=${session?.connectors} onPrompt=${ctrl.prompt} />`)}
      ${sending.map((m, n) => html`<${Row} key=${`sending${n}`} item=${{ kind: 'user', text: m.text, images: m.images, sending: true }} onImage=${viewImage} />`)}
    </ol>
    <${Live} ctrl=${ctrl} box=${box} />
  </div>`;
}
