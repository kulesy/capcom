import { Fragment, html, useLayoutEffect, useRef } from './html.js';
import { enter, hideOthers, holdPointer, holdScroll, onPressOutside, tabbables, topmost } from './layer.js';
import { isSecondary, tabTarget } from './layer-rules.js';
import { usePresence } from './presence.js';
import { shortcut } from './shortcuts.js';

const Cross = () => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>`;

// shadcn's Dialog, and its AlertDialog with `alert`, drawn in place beside the app. `sheet="left"` is shadcn's mobile sidebar instead:
// the same layer as a panel from that edge, with no close button. `onClose(why)` hears 'escape', 'press' (never for an alert) and
// 'close'; the owner turns `open` off, and the layer stays until its exit animation has played. `initial` is a ref to what takes the
// focus first, and `restoreTo()` gives the element that gets it back.
export function Dialog({ open, ...rest }) {
  const box = useRef(null);
  const present = usePresence(open, box);
  return present ? html`<${Layer} open=${open} box=${box} ...${rest} />` : null;
}

function Layer({ open, box, onClose, alert = false, sheet = null, part, label, labelledBy, describedBy, initial, restoreTo, children }) {
  const live = useRef(null);
  live.current = { open, onClose };
  const me = useRef({}).current;
  const from = useRef(undefined);
  // Read while rendering, because a child may have taken the focus by the time any effect runs.
  if (from.current === undefined) from.current = document.activeElement;
  const kind = sheet ? 'sheet' : alert ? 'alert-dialog' : 'dialog';
  const state = open ? 'open' : 'closed';

  useLayoutEffect(() => {
    if (!open) return;
    const content = box.current;
    // On top before it takes the focus, or the trap of the layer under it, such as the sheet under the search, takes the focus back.
    const leave = enter(me);
    if (initial?.current) initial.current.focus({ preventScroll: true });
    else if (!content.contains(document.activeElement)) (tabbables(content)[0] ?? content).focus({ preventScroll: true });
    return leave;
  }, [open]);

  // The page is locked for as long as the layer is in it, exit animation included. The focus trap and the keys end when `open` does.
  useLayoutEffect(() => {
    const content = box.current;
    const unlockScroll = holdScroll();
    const show = hideOthers(content);
    const unlockPointer = holdPointer();
    let last = null;
    // Only the top layer traps the focus, so the search can open over the sheet.
    const trapping = () => live.current.open && topmost(me);
    const onFocusIn = e => {
      if (!trapping()) return;
      if (content.contains(e.target)) last = e.target;
      else (last?.isConnected ? last : content).focus({ preventScroll: true });
    };
    const onFocusOut = e => {
      if (!trapping() || e.relatedTarget === null || content.contains(e.relatedTarget)) return;
      (last?.isConnected ? last : content).focus({ preventScroll: true });
    };
    const watch = new MutationObserver(records => {
      if (trapping() && document.activeElement === document.body && records.some(r => r.removedNodes.length)) content.focus({ preventScroll: true });
    });
    watch.observe(content, { childList: true, subtree: true });
    // The document hears every key first, so Esc closes only the top layer and cannot also stop a chat that is running behind it.
    const onKey = e => {
      if (!live.current.open || !topmost(me)) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); live.current.onClose('escape'); }
      else if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const items = tabbables(content);
        const to = tabTarget(items.length, items.indexOf(document.activeElement), e.shiftKey);
        if (to === null) return;
        e.preventDefault();
        if (to !== 'stay') items[to].focus({ preventScroll: true });
      } else if (alert && shortcut(e)) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKey, true);
    // A press on a toast is not a press outside, or undoing a note would close the dialog it was made in.
    const stop = alert ? null : onPressOutside(
      target => content.contains(target) || !!target.closest?.('[data-sonner-toaster]'),
      e => { if (live.current.open && topmost(me) && !isSecondary(e)) live.current.onClose('press'); },
    );
    return () => {
      stop?.();
      watch.disconnect();
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKey, true);
      unlockPointer();
      show();
      unlockScroll();
      // Hooks clean up before the DOM goes, so this is still the place to ask whether the focus was in the layer. The owner may have
      // moved it on already, and then it stays where the owner put it.
      const held = content.contains(document.activeElement) || document.activeElement === document.body;
      const to = restoreTo?.() ?? from.current;
      setTimeout(() => {
        if (held && to?.isConnected && (document.activeElement === document.body || !document.activeElement)) to.focus({ preventScroll: true });
      });
    };
  }, []);

  return html`<${Fragment}>
    <div data-slot=${`${kind}-overlay`} data-state=${state}></div>
    <div ref=${box} data-slot=${sheet ? 'sidebar' : `${kind}-content`} data-mobile=${sheet ? 'true' : undefined} data-side=${sheet || undefined} data-part=${part}
      data-size=${alert ? 'default' : undefined} data-state=${state} role=${alert ? 'alertdialog' : 'dialog'}
      aria-label=${label} aria-labelledby=${labelledBy} aria-describedby=${describedBy} tabindex="-1">
      ${sheet ? html`<div data-part="sidebar-mobile-inner">${children}</div>` : children}
      ${alert || sheet ? null : html`<button type="button" data-slot="dialog-close" onClick=${() => live.current.onClose('close')}><${Cross} /><span data-part="dialog-content-close-label">Close</span></button>`}
    </div>
  <//>`;
}
