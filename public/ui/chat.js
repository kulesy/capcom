// The chat pane: header, transcript and the dock under it. It owns one chat controller for as long as it is on screen.
import { Approvals } from './approvals.js';
import { copyText } from './clipboard.js';
import { Composer } from './composer.js';
import { HOME } from './env.js';
import { folderName, settingsLine } from './format.js';
import { Holds } from './holds.js';
import { useDocumentTitle, useFields, useStore } from './hooks.js';
import { html, memo, useCallback, useEffect, useLayoutEffect, useRef } from './html.js';
import { draw, icons } from './menu.js';
import { Panel } from './panel.js';
import { panelOf, panels, togglePanel } from './panel-state.js';
import { runFromClick } from './run.js';
import { createChat } from './session.js';
import { keyHint, shortcut } from './shortcuts.js';
import { runnableBlock } from './terminal-rules.js';
import { toast } from './toast.js';
import { Transcript } from './transcript.js';

export const Back = () => html`<a class="btn back" data-variant="ghost" data-size="sm" href="#/" aria-label="Back to sessions"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Sessions</a>`;

function TerminalButton({ ctrl }) {
  const open = useStore(panels, s => panelOf(s, ctrl.id).open);
  return html`<button class="btn" id="terminalButton" type="button" data-variant="ghost" data-size="icon-sm" aria-label="Terminal" aria-expanded=${open} aria-controls="panel" data-tip="Terminal" data-tip-key=${keyHint('Ctrl', '`')} onClick=${e => togglePanel(ctrl.id, e.currentTarget, open)}>${draw(icons.terminal, 'icon')}</button>`;
}

// `kind` names the chat in place of its folder and branch, as a group's session does.
function ChatHead({ ctrl, kind }) {
  const { session, status, outside, terminal } = useFields(ctrl.store, 'session', 'status', 'outside', 'terminal');
  const draft = !!ctrl.draft;
  const state = status?.state || 'idle';
  useDocumentTitle(draft ? 'New session · GhostShell' : session?.title ? `${session.title} · GhostShell` : 'GhostShell');
  const place = kind ? [kind] : session ? [folderName(session.cwd, HOME), session.branch, session.routine ? `${session.routine} routine` : ''] : [];
  const meta = draft
    ? 'Starts Claude Code in your home folder'
    : session ? [...place, settingsLine(status)].filter(Boolean).join('  ') : '';
  const lamp = html`<span class="lamp" id="chatLamp" data-state=${state === 'idle' && outside ? 'working' : state} aria-hidden="true"></span>`;
  return html`<header class="chat-head">
    <${Back} />
    <div class="chat-title">
      <h2 id="title">${draft ? 'New session' : session?.title || 'Session'}</h2>
      <p class="chat-meta" id="meta">${meta}</p>
    </div>
    ${terminal ? html`<div class="chat-tools"><${TerminalButton} ctrl=${ctrl} />${lamp}</div>` : lamp}
  </header>`;
}

// Copy and Run on the code blocks of the chat's replies. Run reads the block's own text as the button is pressed, and only a real click
// on a finished reply runs anything. Nothing else on the page calls runFromClick with a block's text.
function blockClick(ctrl, e) {
  const button = e.target.closest?.('button[data-code]');
  const code = button?.closest('.code-block')?.querySelector('pre.code');
  if (!code) return;
  if (button.dataset.code === 'copy') {
    copyText(code.textContent).then(ok => toast(ok ? 'Copied to clipboard' : 'Could not copy the code', { problem: !ok, duration: 2000 }));
    return;
  }
  if (button.dataset.code !== 'run' || !e.isTrusted || button.getAttribute('aria-disabled') === 'true') return;
  // A file open in the panel is drawn like a reply but is not one, so its blocks have Copy only.
  if (!ctrl.store.get().terminal || !button.closest('.msg.claude:not(.live, .file-doc)')) return;
  const block = runnableBlock(code.dataset.lang, code.textContent);
  if (block && !block.hidden) runFromClick(ctrl.term, block.command, 'block', button);
}

function Notice({ ctrl }) {
  const text = useStore(ctrl.store, s => s.notice);
  return html`<p class="notice" id="notice" role="alert" hidden=${!text}>${text}</p>`;
}

// `row` is the list's entry for the session, which names it until the transcript answers. It is read once, so a
// fresh copy of the list never redraws the chat. Only `title`, which is passed apart, is followed, so a rename in the list reaches
// the header and the page title. The list's title wins over the chat's own, including one from a first page of messages that left
// the server before the rename.
// `meta` stands in the header for the folder and branch, and `aside` is drawn between the header and the transcript. `aside` must be
// one element that follows a store of its own, because a new element on each render would redraw the whole chat.
export const ChatPane = memo(function ChatPane({ id, row, title, refreshIndex, meta, aside }) {
  const held = useRef(null);
  if (!held.current) held.current = createChat({ id, draft: id === null, row, refreshIndex });
  const ctrl = held.current;
  const named = useStore(ctrl.store, s => s.session?.title);
  const terminal = useStore(ctrl.store, s => s.terminal);
  const onBlock = useCallback(e => blockClick(ctrl, e), [ctrl]);
  useLayoutEffect(() => {
    ctrl.open();
    return ctrl.close;
  }, [ctrl]);
  useLayoutEffect(() => {
    const { session } = ctrl.store.get();
    if (title && session && session.title !== title) ctrl.store.set({ session: { ...session, title } });
  }, [ctrl, title, named]);
  useEffect(() => {
    const onKey = e => {
      if (shortcut(e) !== 'terminal' || !ctrl.store.get().terminal) return;
      e.preventDefault();
      const here = document.activeElement;
      togglePanel(ctrl.id, here === document.body ? null : here, panelOf(panels.get(), ctrl.id).open);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ctrl]);
  return html`<section class="session" id="session" data-terminal=${terminal ? '' : undefined} onClick=${onBlock}>
    <${ChatHead} ctrl=${ctrl} kind=${meta} />
    ${aside}
    <${Transcript} ctrl=${ctrl} />
    <div class="dock">
      <${Approvals} ctrl=${ctrl} />
      <${Holds} ctrl=${ctrl} />
      <${Notice} ctrl=${ctrl} />
      <${Composer} ctrl=${ctrl} />
    </div>
    <${Panel} ctrl=${ctrl} />
  </section>`;
}, (a, b) => a.id === b.id && a.title === b.title && a.refreshIndex === b.refreshIndex && a.meta === b.meta && a.aside === b.aside);
