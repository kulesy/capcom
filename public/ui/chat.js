// The chat pane: header, transcript and the dock under it. It owns one chat controller for as long as it is on screen.
import { Approvals } from './approvals.js';
import { Composer, FolderBar } from './composer.js';
import { HOME } from './env.js';
import { folderName, settingsLine } from './format.js';
import { Holds } from './holds.js';
import { useDocumentTitle, useFields, useStore } from './hooks.js';
import { html, memo, useLayoutEffect, useRef } from './html.js';
import { createChat } from './session.js';
import { Transcript } from './transcript.js';

function ChatHead({ ctrl }) {
  const { session, status, outside } = useFields(ctrl.store, 'session', 'status', 'outside');
  const draft = !!ctrl.draft;
  const state = status?.state || 'idle';
  useDocumentTitle(draft ? 'New session · Capcom' : session?.title ? `${session.title} · Capcom` : 'Capcom');
  const meta = draft
    ? 'Starts Claude Code in the folder you pick'
    : session ? [folderName(session.cwd, HOME), session.branch, session.routine ? `${session.routine} routine` : '', settingsLine(status)].filter(Boolean).join('  ') : '';
  return html`<header class="chat-head">
    <a class="btn back" data-variant="ghost" data-size="sm" href="#/" aria-label="Back to sessions"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Sessions</a>
    <div class="chat-title">
      <h2 id="title">${draft ? 'New session' : session?.title || 'Session'}</h2>
      <p class="chat-meta" id="meta">${meta}</p>
    </div>
    <span class="lamp" id="chatLamp" data-state=${state === 'idle' && outside ? 'working' : state} aria-hidden="true"></span>
  </header>`;
}

function Notice({ ctrl }) {
  const text = useStore(ctrl.store, s => s.notice);
  return html`<p class="notice" id="notice" role="alert" hidden=${!text}>${text}</p>`;
}

// `row` is the list's entry for the session, which names it until the transcript answers. It is read once, so a
// fresh copy of the list never redraws the chat. Only `title`, which is passed apart, is followed, so a rename in the list reaches
// the header and the page title. The list's title wins over the chat's own, including one from a first page of messages that left
// the server before the rename.
export const ChatPane = memo(function ChatPane({ id, row, title, refreshIndex }) {
  const held = useRef(null);
  if (!held.current) held.current = createChat({ id, draft: id === null, row, refreshIndex });
  const ctrl = held.current;
  const named = useStore(ctrl.store, s => s.session?.title);
  useLayoutEffect(() => {
    ctrl.open();
    return ctrl.close;
  }, [ctrl]);
  useLayoutEffect(() => {
    const { session } = ctrl.store.get();
    if (title && session && session.title !== title) ctrl.store.set({ session: { ...session, title } });
  }, [ctrl, title, named]);
  return html`<section class="session" id="session">
    <${ChatHead} ctrl=${ctrl} />
    <${Transcript} ctrl=${ctrl} />
    <div class="dock">
      <${Approvals} ctrl=${ctrl} />
      <${Holds} ctrl=${ctrl} />
      <${Notice} ctrl=${ctrl} />
      ${ctrl.draft ? html`<${FolderBar} ctrl=${ctrl} />` : null}
      <${Composer} ctrl=${ctrl} />
    </div>
  </section>`;
}, (a, b) => a.id === b.id && a.title === b.title && a.refreshIndex === b.refreshIndex);
