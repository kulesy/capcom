// Every URL is relative, so Capcom keeps working when a proxy mounts it under a sub-path such as /chat.
async function answer(r) {
  if (r.status === 401) { location.reload(); throw new Error('Signed out'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { data, status: r.status });
  return data;
}

export const api = async (path, body) => answer(await fetch(path, body === undefined ? { cache: 'no-store' } : {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

// The file itself is the body, and the browser sends its type. The name travels in a header, because the body has no room for it.
export const postFile = async (path, file, name, signal) => answer(await fetch(path, {
  method: 'POST', headers: { 'x-file-name': encodeURIComponent(name) }, body: file, signal,
}));
