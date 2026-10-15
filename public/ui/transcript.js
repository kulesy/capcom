import { md } from '../md.mjs';
import { html, useLayoutEffect, useMemo, useRef } from './html.js';
import { useFields, useStick, useStore } from './hooks.js';
import { isChip, Row } from './rows.js';
import { display } from './thread.js';

// Claude's reply as it is written, and the working indicator before the first word.
function Live({ ctrl, box }) {
  const live = useStore(ctrl.store, s => s.live);
  const state = useStore(ctrl.store, s => s.status?.state || 'idle');
  useStick(box);
  return html`<div class="msg claude live" id="live" hidden=${!live} dangerouslySetInnerHTML=${{ __html: live ? md(live) : '' }}></div>
    <p class="working" id="working" hidden=${!(state === 'working' && !live)}><span class="lamp" data-state="working"></span><span id="workingText">Working</span></p>`;
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

  return html`<div class="transcript" id="transcript" ref=${box}>
    ${ctrl.draft ? html`<p class="quiet pad" id="newHint">Pick a folder, then say what Claude should do. The session starts there.</p>` : null}
    <button class="button earlier" id="earlier" type="button" hidden=${!hasEarlier} disabled=${loadingEarlier} onClick=${loadEarlier}>Load earlier</button>
    <ol class="items" id="items">
      ${rows.map(i => html`<${Row} key=${i.key} item=${i} chip=${isChip(i) ? chips.get(i.id) : undefined} cwd=${isChip(i) ? session?.cwd : undefined} onChip=${ctrl.chip} />`)}
      ${sending.map((m, n) => html`<${Row} key=${`sending${n}`} item=${{ kind: 'user', text: m.text, images: m.images, sending: true }} />`)}
    </ol>
    <${Live} ctrl=${ctrl} box=${box} />
  </div>`;
}
