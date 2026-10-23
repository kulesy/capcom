// Puts text on the clipboard. A page the browser does not count as secure has no clipboard API, so the old way is the fallback.
// Resolves to whether the text was copied.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const area = document.createElement('textarea');
  const was = document.activeElement;
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(area);
  area.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch {}
  area.remove();
  was?.focus?.({ preventScroll: true });
  return copied;
}
