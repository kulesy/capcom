// How an attached file is named on its card, and how the mentions of files at the start of a message are read. Plain functions with no DOM
// and no imports, so they run without a browser, and the server imports them too.

const KINDS = {
  pdf: 'PDF', csv: 'CSV', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel', ppt: 'PowerPoint', pptx: 'PowerPoint',
  txt: 'Text', md: 'Markdown', json: 'JSON', zip: 'ZIP',
};

// The last extension, lowercased, as the server reads it: a name that is only a dot and letters, like .gitignore, has none.
export const extension = name => /.\.([A-Za-z0-9]{1,10})$/s.exec(String(name ?? ''))?.[1].toLowerCase() ?? '';

export function kindLabel(name) {
  const ext = extension(name);
  return Object.hasOwn(KINDS, ext) ? KINDS[ext] : ext ? ext.toUpperCase() : 'File';
}

// The glyph on the card: the extension in capitals, cut to fit the square.
export const glyph = name => extension(name).toUpperCase().slice(0, 4) || 'FILE';

// A size in bytes, then KB, then MB with one decimal.
export function sizeLabel(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = Math.round(bytes / 1024);
  return kb < 1024 ? `${kb} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

// The quiet line under the name. A file still on its way up has no size worth showing.
export const metaLine = file => (file.uploading ? 'Uploading…' : [kindLabel(file.name), sizeLabel(file.size)].filter(Boolean).join(' · '));

const RUN = /^@"\/[^"\n]+"(?: @"\/[^"\n]+")*(?:\n|$)/;
const ONE = /@"(\/[^"\n]+)"/g;

// A leading run of @"/path" mentions that ends at a newline or the end of the text, and the text after it.
// NOTE: [23 Oct 2026] EK - The shape is Claude Desktop's, and lib/uploads.mjs writes it (withMentions). Change the two together.
export function leadingMentions(text) {
  const run = RUN.exec(text);
  return run ? { paths: [...run[0].matchAll(ONE)].map(m => m[1]), text: text.slice(run[0].length) } : { paths: [], text };
}
