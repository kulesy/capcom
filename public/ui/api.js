// Every URL is relative, so Capcom keeps working when a proxy mounts it under a sub-path such as /chat.
export async function api(path, body) {
  const r = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (r.status === 401) { location.reload(); throw new Error('Signed out'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { data, status: r.status });
  return data;
}
