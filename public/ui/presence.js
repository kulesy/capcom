import { useLayoutEffect, useRef, useState } from './html.js';

// Keeps a layer in the page until its exit animation has played. With no animation to play it goes at once. A layer opened again
// while it is leaving stays, and `onGone` is called when it has gone.
export function usePresence(open, box, onGone) {
  const [ended, setEnded] = useState(0);
  const turn = useRef(0);
  const was = useRef(false);
  if (open && !was.current) turn.current++;
  was.current = open;
  const present = open || ended !== turn.current;

  useLayoutEffect(() => {
    if (open || !present) return;
    const el = box.current;
    const gone = () => { setEnded(turn.current); onGone?.(); };
    if (!el || getComputedStyle(el).animationName === 'none') { gone(); return; }
    let over = false;
    const finish = e => { if (over || (e && e.target !== el)) return; over = true; gone(); };
    el.addEventListener('animationend', finish);
    el.addEventListener('animationcancel', finish);
    // A page in a background tab holds its animations, so the layer is removed whether or not they have played.
    const timer = setTimeout(finish, 500);
    return () => {
      over = true;
      clearTimeout(timer);
      el.removeEventListener('animationend', finish);
      el.removeEventListener('animationcancel', finish);
    };
  }, [open, present]);

  return present;
}
