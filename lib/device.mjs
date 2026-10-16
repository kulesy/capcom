// A short label for a browser, such as "Chrome 141 on macOS", read from its User-Agent. The browser makes that claim itself,
// so the label tells two sign-ins apart and is never something to trust.
const BROWSERS = [
  [/EdgA?\/(\d+)|EdgiOS\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/FxiOS\/(\d+)|Firefox\/(\d+)/, 'Firefox'],
  [/CriOS\/(\d+)|Chrome\/(\d+)/, 'Chrome'],
  [/Version\/(\d+)[^]*Safari\//, 'Safari'],
];

const SYSTEMS = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

export function deviceLabel(userAgent) {
  const ua = String(userAgent || '').slice(0, 400);
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];
  for (const [pattern, name] of BROWSERS) {
    const match = ua.match(pattern);
    if (match) return [`${name} ${match.slice(1).find(Boolean)}`, system && `on ${system}`].filter(Boolean).join(' ');
  }
  return system ? `Browser on ${system}` : 'Unknown browser';
}
