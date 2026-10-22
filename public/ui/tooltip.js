// shadcn's tooltip for every icon-only button. A button opts in with `data-tip` (its words) and `data-tip-key` (its shortcut, drawn
// as a <kbd>), and the listeners below are on the document, so a button needs nothing else. There is one host, so one tooltip shows
// at a time. Radix opens on the first pointer move over the trigger, at once on keyboard focus, and never for a touch. It closes
// on a press, a click, the pointer leaving, the trigger losing focus, a scroll, a resize and another tooltip opening.
// An empty `data-tip` keeps the button a trigger and shows nothing, which is how a button hides its tooltip while its popover is open.
const GAP = 10;
const ARROW = 10;
const SKIP_DELAY = 300;

// Where a tooltip of `size` goes for a trigger at `t`, in a window of `view`: centred over the trigger and GAP above it, slid along
// the edge to stay in the window without leaving the trigger, and under the trigger when there is no room above. `arrow` is how far
// along the tooltip its arrow sits, or null when the trigger's centre is not under the tooltip.
export function place(t, size, view) {
  const need = size.height + GAP;
  const above = t.top;
  const below = view.height - (t.top + t.height);
  const side = above >= need || (below < need && above >= below) ? 'top' : 'bottom';
  const inWindow = Math.min(Math.max(t.left + t.width / 2 - size.width / 2, 0), view.width - size.width);
  const x = Math.min(Math.max(inWindow, t.left - size.width), t.left + t.width);
  const y = side === 'top' ? t.top - need : t.top + t.height + GAP;
  const along = t.left + t.width / 2 - x - ARROW / 2;
  return { side, x: Math.round(x), y: Math.round(y), arrow: along >= 0 && along <= size.width - ARROW ? along : null };
}

let host = null;
let tip = null;
let leaving = null;
let timer = 0;
let skip = 0;
let delayed = true;
let moved = null;
let pressed = false;
let touched = false;
let count = 0;
let installed = false;

const triggerOf = el => el?.closest?.('[data-tip]') ?? null;

const describe = (trigger, id, on) => {
  const rest = (trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== id);
  if (on) rest.push(id);
  if (rest.length) trigger.setAttribute('aria-describedby', rest.join(' '));
  else trigger.removeAttribute('aria-describedby');
};

function build(trigger, how, id) {
  const content = document.createElement('div');
  content.dataset.slot = 'tooltip-content';
  content.dataset.state = how;
  content.dataset.align = 'center';
  const line = document.createElement('div');
  line.dataset.part = 'tooltip-content-line';
  line.append(trigger.dataset.tip);
  if (trigger.dataset.tipKey) {
    const kbd = document.createElement('kbd');
    kbd.textContent = trigger.dataset.tipKey;
    line.append(kbd);
  }
  const arrow = document.createElement('span');
  arrow.dataset.part = 'tooltip-arrow';
  arrow.innerHTML = '<svg data-part="tooltip-content-arrow" width="10" height="5" viewBox="0 0 30 10" preserveAspectRatio="none"><polygon points="0,0 30,0 15,10"/></svg>';
  const copy = document.createElement('span');
  copy.id = id;
  copy.className = 'sr';
  copy.setAttribute('role', 'tooltip');
  copy.textContent = [trigger.dataset.tip, trigger.dataset.tipKey].filter(Boolean).join(' ');
  content.append(line, arrow, copy);
  return { content, arrow };
}

function show(trigger, how) {
  clearTimeout(timer);
  if (tip?.trigger === trigger || !trigger.dataset.tip || !trigger.isConnected) return;
  hide();
  leaving?.();
  clearTimeout(skip);
  delayed = false;
  const id = `tooltip-${++count}`;
  const { content, arrow } = build(trigger, how, id);
  if (!host) {
    host = document.createElement('div');
    host.dataset.part = 'tooltip-host';
    document.body.append(host);
  }
  host.replaceChildren(content);
  const t = trigger.getBoundingClientRect();
  const at = place(t, { width: host.offsetWidth, height: host.offsetHeight }, { width: innerWidth, height: innerHeight });
  host.style.transform = `translate(${at.x}px, ${at.y}px)`;
  content.dataset.side = at.side;
  const tail = at.side === 'top' ? `${host.offsetHeight + GAP}px` : `${-GAP}px`;
  content.style.setProperty('--radix-tooltip-content-transform-origin', `${at.arrow === null ? '50%' : `${at.arrow + ARROW / 2}px`} ${tail}`);
  if (at.arrow === null) arrow.style.visibility = 'hidden';
  else arrow.style.left = `${at.arrow}px`;
  describe(trigger, id, true);
  const watch = new MutationObserver(() => { if (!trigger.isConnected) hide(); });
  watch.observe(document.body, { childList: true, subtree: true });
  tip = { trigger, content, id, watch };
}

function hide() {
  clearTimeout(timer);
  if (!tip) return;
  const { trigger, content, id, watch } = tip;
  tip = null;
  watch.disconnect();
  describe(trigger, id, false);
  content.dataset.state = 'closed';
  clearTimeout(skip);
  skip = setTimeout(() => { delayed = true; }, SKIP_DELAY);
  if (getComputedStyle(content).animationName === 'none') { content.remove(); return; }
  const stop = setTimeout(() => done(), 500);
  const end = e => { if (e.target === content) done(); };
  const done = () => {
    clearTimeout(stop);
    content.removeEventListener('animationend', end);
    content.removeEventListener('animationcancel', end);
    content.remove();
    if (leaving === done) leaving = null;
  };
  content.addEventListener('animationend', end);
  content.addEventListener('animationcancel', end);
  leaving = done;
}

export function installTooltips() {
  if (installed) return;
  installed = true;
  const on = (type, fn, target = document) => target.addEventListener(type, fn, true);

  on('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const trigger = triggerOf(e.target);
    if (!trigger || trigger === moved) return;
    moved = trigger;
    if (delayed) timer = setTimeout(() => show(trigger, 'delayed-open'), 0);
    else show(trigger, 'instant-open');
  });

  on('pointerout', e => {
    const trigger = triggerOf(e.target);
    if (!trigger || trigger.contains(e.relatedTarget)) return;
    if (moved === trigger) moved = null;
    clearTimeout(timer);
    if (tip?.trigger === trigger) hide();
  });

  on('pointerdown', e => {
    touched = e.pointerType === 'touch';
    hide();
    if (!triggerOf(e.target)) return;
    pressed = true;
    document.addEventListener('pointerup', () => { pressed = false; }, { once: true, capture: true });
  });

  on('click', e => { if (triggerOf(e.target)) hide(); });

  on('focusin', e => {
    const trigger = triggerOf(e.target);
    if (trigger && !pressed && !touched && trigger.matches(':focus-visible')) show(trigger, 'instant-open');
  });

  on('focusout', e => { if (tip && triggerOf(e.target) === tip.trigger) hide(); });

  // Esc hides the tooltip and goes on to whatever else it closes, so a tooltip on a dialog's own button cannot cost a second press.
  // It marks the key as used, so the composer does not also stop a running chat.
  on('keydown', e => { touched = false; if (e.key === 'Escape') { if (tip) e.preventDefault(); hide(); } });
  on('scroll', e => { if (tip && e.target.contains?.(tip.trigger)) hide(); }, window);
  on('resize', hide, window);
}
