export const local = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(`capcom.${k}`)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(`capcom.${k}`, JSON.stringify(v)); } catch {} },
};
