import { html, memo, useLayoutEffect, useMemo, useRef, useState } from './html.js';

// Widgets run in a sandbox with no same-origin access, so model-written HTML cannot read Capcom's cookie or press its buttons.
function widgetDoc(code) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">
<style>:root{color-scheme:light dark;font:15px/1.45 -apple-system,system-ui,sans-serif}html,body{height:auto!important;min-height:0!important}body{margin:0;padding:4px}</style></head><body>${code}
<script>(function(){var lastIH=0,lastD=null,send=function(){var b=document.body,h=Math.ceil(Math.max(b.scrollHeight,b.getBoundingClientRect().height)),d=h-innerHeight;if(innerHeight!==lastIH&&d===lastD)return;lastIH=innerHeight;lastD=d;parent.postMessage({capcomHeight:h},'*')};new ResizeObserver(send).observe(document.body);addEventListener('load',send);send()})()</script></body></html>`;
}

// The frame's srcdoc only changes if the code does, so a tool result arriving later never reloads a running widget.
export const Widget = memo(function Widget({ t }) {
  const doc = useMemo(() => widgetDoc(t.input?.widget_code || ''), [t.input?.widget_code]);
  const frame = useRef(null);
  const [height, setHeight] = useState(0);
  // A layout effect, so the listener is in place before the frame can send its first height.
  useLayoutEffect(() => {
    const onMessage = e => {
      if (typeof e.data?.capcomHeight === 'number' && e.source === frame.current?.contentWindow) setHeight(Math.min(Math.max(e.data.capcomHeight, 40), 1600));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return html`<li class="widget"><iframe ref=${frame} sandbox="allow-scripts" title=${t.input?.title || 'Widget'} srcdoc=${doc} style=${height ? { height: `${height}px` } : undefined}></iframe></li>`;
});
