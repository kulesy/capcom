import { md } from '../md.mjs';
import { duration, tokenCount } from './format.js';
import { threadImages } from './gallery.js';
import { html, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from './html.js';
import { useClock, useFields, useStick, useStore } from './hooks.js';
import { isChip, Row, Thought } from './rows.js';
import { activity, display } from './thread.js';
import { closeViewer, openViewer } from './viewer.js';

// Claude's thinking as it is written. It is open while it grows and folds once the block ends.
function LiveThink({ think }) {
  const body = useRef(null);
  useStick(body);
  return html`<div class="live-think"><div class="think"><${Thought} text=${think.text} name=${think.done ? 'Thought' : 'Thinking'} open=${!think.done} bodyRef=${body} /></div></div>`;
}

// What Claude is doing now, how long the turn has run, and the tokens of the replies it has finished.
function Working({ work, since, on }) {
  useClock(on);
  const { doing, detail } = activity(work);
  const meta = [work && duration(Date.now() - since), work?.tokens > 0 && `${tokenCount(work.tokens)} tokens`].filter(Boolean).join(' · ');
  return html`<p class="working" id="working" hidden=${!on}><span class="lamp" data-state="working"></span>
    <span class="working-text" id="workingText"><span class="working-doing">${doing}</span>${detail ? html`<span class="working-detail">${detail}</span>` : null}</span>
    <span class="working-meta" title="Time since the turn began, and the tokens in the replies Claude has finished this turn. The count moves when a reply ends, not while it is written.">${meta}</span></p>`;
}

// The thinking and the reply as they are written, and the line that says what Claude is doing.
function Live({ ctrl, box }) {
  const { live, think, work, turnStart } = useFields(ctrl.store, 'live', 'think', 'work', 'turnStart');
  const state = useStore(ctrl.store, s => s.status?.state || 'idle');
  useStick(box);
  return html`${think ? html`<${LiveThink} think=${think} />` : null}
    <div class="msg claude live" id="live" hidden=${!live} dangerouslySetInnerHTML=${{ __html: live ? md(live) : '' }}></div>
    <${Working} work=${work} since=${turnStart} on=${state === 'working'} />`;
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

  // The viewer steps through the pictures as the thread holds them when one is clicked, and closes with the chat.
  const viewImage = useCallback((key, from) => {
    const { items: saved, sending: unsent } = ctrl.store.get();
    const images = threadImages(saved, unsent, ctrl.imageUrl);
    openViewer(images, Math.max(0, images.findIndex(i => i.key === key)), from);
  }, [ctrl]);
  useEffect(() => closeViewer, []);

  return html`<div class="transcript" id="transcript" ref=${box}>
    ${ctrl.draft ? html`<p class="quiet pad" id="newHint">Pick a folder, then say what Claude should do. The session starts there.</p>` : null}
    <button class="button earlier" id="earlier" type="button" hidden=${!hasEarlier} disabled=${loadingEarlier} onClick=${loadEarlier}>Load earlier</button>
    <ol class="items" id="items">
      ${rows.map(i => html`<${Row} key=${i.key} item=${i} chip=${isChip(i) ? chips.get(i.id) : undefined} cwd=${isChip(i) ? session?.cwd : undefined} onChip=${ctrl.chip} imageUrl=${ctrl.imageUrl} onImage=${viewImage} />`)}
      ${sending.map((m, n) => html`<${Row} key=${`sending${n}`} item=${{ kind: 'user', text: m.text, images: m.images, sending: true }} onImage=${viewImage} />`)}
    </ol>
    <${Live} ctrl=${ctrl} box=${box} />
  </div>`;
}
