// The resolve hook for test/load.test.mjs: it resolves each import in public/ as the browser would on the page named by ?page= in the
// importer's URL, so a module that page cannot load fails to link. Imports from anywhere else go straight to Node.
let served, maps;

// NOTE: [22 Oct 2026] EK - Mirrors TYPES and asset() in server.mjs: a module loads only as a .js or .mjs file under public/, found by
// its raw (still percent-encoded) path. Change this with them, or the test passes imports the browser cannot load.
const SCRIPT = /^[\w./-]+\.m?js$/;

export function initialize(data) {
  ({ served, maps } = data);
}

export async function resolve(specifier, context, next) {
  if (!context.parentURL?.startsWith(served)) return next(specifier, context);
  const parent = new URL(context.parentURL);
  const page = parent.searchParams.get('page');
  parent.search = '';
  // Check the path the browser asks for as well as the file Node finds: Node decodes %xx and follows symlinks, so the file alone can
  // pass where the request would 404.
  const asked = locate(specifier, parent, page);
  vet(asked, specifier, parent);
  const found = await next(asked, context);
  vet(found.url, specifier, parent);
  const tagged = new URL(found.url);
  tagged.searchParams.set('page', page);
  return { ...found, url: tagged.href };
}

function vet(url, specifier, parent) {
  const below = url.startsWith(served) ? url.slice(served.length) : '';
  if (!SCRIPT.test(below)) throw new Error(`${specifier} in ${parent.href} resolves to ${below || url}, which the server does not send as a module`);
}

// public/ is the site root, so the browser resolves ./ and ../ against URL paths: ../public/ui/x.js from app.js asks for /public/ui/x.js.
function locate(specifier, parent, page) {
  if (Object.hasOwn(maps[page], specifier)) return maps[page][specifier];
  const site = new URL(parent.href.slice(served.length), 'https://capcom.invalid/');
  const url = /^(\/|\.\/|\.\.\/)/.test(specifier) ? new URL(specifier, site) : null;
  if (url?.origin !== site.origin) throw new Error(`${specifier} in ${parent.href} is not in ${page}'s import map`);
  return served + url.pathname.slice(1);
}
