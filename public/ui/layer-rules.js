// The rules a menu and a dialog share, as Radix writes them, that need no page.

// A lock that any number of layers can hold at once. `on` runs for the first to take it and `off` for the last to let go. Each
// call returns the way to let go, which does nothing the second time.
export function counted(on, off) {
  let holders = 0;
  return () => {
    if (holders++ === 0) on();
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      if (--holders === 0) off();
    };
  };
}

// A press that opens a context menu on the system it came from, which a layer treats as a press on what lies under it and not as a
// click outside.
export const isSecondary = e => e.button === 2 || (e.button === 0 && e.ctrlKey === true);

// Where a Tab key goes among `count` tabbable elements in a layer. `at` is the one that has the focus, or -1 when the layer itself
// has it. The result is the element to focus, 'stay' for a layer with nothing to focus, or null where the browser's own move is right.
export function tabTarget(count, at, shift) {
  if (!count) return 'stay';
  if (at < 0) return shift ? count - 1 : 0;
  if (!shift && at === count - 1) return 0;
  if (shift && at === 0) return count - 1;
  return null;
}
