// Run with `npm test`. The markdown the chat is drawn with, and the file links it can add. The server reads the same code to
// learn which paths a chat links to, so what is drawn as a link here is what a chat may open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileTarget, linkedFiles, md } from '../public/md.mjs';

const href = (path, line) => `/f?p=${encodeURIComponent(path)}${line ? `&l=${line}` : ''}`;

// The file links in some markup, as { file, line, text }.
const links = markup => [...markup.matchAll(/<a class="file-link" href="[^"]*" target="_blank" rel="noopener" data-file="([^"]*)"(?: data-line="(\d+)")?>(.*?)<\/a>/g)]
  .map(([, file, line, text]) => ({ file, line: line ? Number(line) : null, text }));
const found = src => links(md(src, href));

test('a link whose target is an absolute path, a ~/ path or a file URL is a file link, and the page decides where it goes', () => {
  assert.equal(md('[the plan](/Users/eli/plan.md)', href),
    '<p><a class="file-link" href="/f?p=%2FUsers%2Feli%2Fplan.md" target="_blank" rel="noopener" data-file="/Users/eli/plan.md">the plan</a></p>');
  assert.deepEqual(found('[a](~/notes/a.md)'), [{ file: '~/notes/a.md', line: null, text: 'a' }]);
  assert.deepEqual(found('[a](file:///Users/eli/a.md)'), [{ file: '/Users/eli/a.md', line: null, text: 'a' }]);
  assert.deepEqual(found('[a](</Users/eli/my notes/a b.md>)'), [{ file: '/Users/eli/my notes/a b.md', line: null, text: 'a' }]);
});

test('a line after the path is a line to open at, and a column after that is dropped', () => {
  assert.equal(md('[a](/Users/eli/a.js:12)', href),
    '<p><a class="file-link" href="/f?p=%2FUsers%2Feli%2Fa.js&amp;l=12" target="_blank" rel="noopener" data-file="/Users/eli/a.js" data-line="12">a</a></p>');
  assert.deepEqual(found('[a](/Users/eli/a.js:12:5)'), [{ file: '/Users/eli/a.js', line: 12, text: 'a' }]);
  assert.deepEqual(found('[a](</Users/eli/my file.js:7>)'), [{ file: '/Users/eli/my file.js', line: 7, text: 'a' }]);
  assert.deepEqual(found('see /Users/eli/a.js:44 now'), [{ file: '/Users/eli/a.js', line: 44, text: '/Users/eli/a.js:44' }]);
  assert.equal(fileTarget('/Users/eli/a.js:0').line, null, 'line 0 is not a line, so the colon stays in the name');
  assert.equal(fileTarget('/Users/eli/a.js:0').path, '/Users/eli/a.js:0');
});

test('a file URL is the absolute path it names, with its percent escapes decoded', () => {
  assert.deepEqual(fileTarget('file:///Users/eli/a%20b.md'), { path: '/Users/eli/a b.md', line: null });
  assert.deepEqual(fileTarget('file://localhost/Users/eli/a.md:3'), { path: '/Users/eli/a.md', line: 3 });
  assert.equal(fileTarget('file://host/Users/eli/a.md'), null, 'a file on another host is not a file here');
  assert.equal(fileTarget('file:///Users/eli/%zz'), null, 'an escape that does not decode is refused');
  assert.equal(fileTarget('file:///Users/eli/a%00b'), null, 'a decoded NUL is refused');
  assert.equal(fileTarget('file:///Users/eli/%2e%2e/b'), null, 'a decoded .. is refused');
});

test('a bare path in prose is a file link without the punctuation that ends the sentence', () => {
  assert.deepEqual(found('I changed /Users/eli/a.md.'), [{ file: '/Users/eli/a.md', line: null, text: '/Users/eli/a.md' }]);
  assert.equal(md('I changed /Users/eli/a.md, and it works.', href).endsWith('</a>, and it works.</p>'), true);
  assert.equal(md('Did you open /Users/eli/a.md?', href).endsWith('</a>?</p>'), true);
  assert.deepEqual(found('(see /tmp/out.log)').map(l => l.file), ['/tmp/out.log']);
  assert.deepEqual(found('**/Users/eli/a.md** and ~/b.md').map(l => l.file), ['/Users/eli/a.md', '~/b.md']);
  assert.deepEqual(found('- /Users/eli/a.md\n- /Users/eli/b.md').map(l => l.file), ['/Users/eli/a.md', '/Users/eli/b.md']);
});

test('text that only looks like a route is not linked: /api/x and a bare /Users stay text', () => {
  for (const src of ['the /api/sessions route', 'at /Users alone', 'under /Users/', 'a/b/c.md', 'https://example.com/Users/eli/a.md']) {
    assert.deepEqual(found(src), [], src);
  }
  assert.equal(md('the /api/sessions route', href), '<p>the /api/sessions route</p>');
});

test('a target that is the root, a folder written with a slash, or has a . or .. in it is refused and drawn as before', () => {
  for (const target of ['/', '/Users/eli/', '/Users/eli/.', '/Users/eli/..', '/Users/eli/../b', '/Users//eli', '~/', '~/a/../b']) {
    assert.equal(fileTarget(target), null, target);
    assert.deepEqual(found(`[a](${target})`), [], target);
    assert.equal(md(`[a](${target})`, href), md(`[a](${target})`), target);
  }
  assert.equal(fileTarget('relative/path.md'), null);
  assert.equal(fileTarget('/Users/eli/a\u0000.md'), null);
  assert.equal(fileTarget('/Users/eli/a\n.md'), null);
});

test('a path inside a code block is text', () => {
  assert.deepEqual(found('```\n/Users/eli/a.md\n[a](/Users/eli/a.md)\n```'), []);
});

test('a code span links only when all of it is a rooted path, and keeps its code styling', () => {
  assert.equal(md('`/Users/eli/a.md`', href),
    '<p><a class="file-link" href="/f?p=%2FUsers%2Feli%2Fa.md" target="_blank" rel="noopener" data-file="/Users/eli/a.md"><code>/Users/eli/a.md</code></a></p>');
  assert.deepEqual(found('`~/b.md`').map(l => l.file), ['~/b.md']);
  assert.deepEqual(found('`ls /Users/eli/a.md`'), []);
  assert.deepEqual(found('`/Users/eli/a.md --flag`'), []);
  assert.deepEqual(found('`/api/x`'), []);
  assert.equal(md('`ls /Users/eli/a.md`', href), '<p><code>ls /Users/eli/a.md</code></p>');
});

test('a link already made around a code span is one anchor, not two', () => {
  assert.deepEqual(found('[`/Users/eli/a.md`](/Users/eli/a.md)'), [{ file: '/Users/eli/a.md', line: null, text: '<code>/Users/eli/a.md</code>' }]);
  assert.equal((md('[a path /Users/eli/b.md](/Users/eli/a.md)', href).match(/<a /g) || []).length, 1);
});

test('a path with a quote, an angle bracket or an ampersand is escaped in the attributes and in the text', () => {
  const markup = md('[a](/Users/eli/a"b<c&d.md) and /Users/eli/e"f.md', href);
  assert.deepEqual(links(markup).map(l => l.file), ['/Users/eli/a&quot;b&lt;c&amp;d.md', '/Users/eli/e&quot;f.md']);
  assert.equal(/<c|"b/.test(markup.replace(/<a [^>]*>|<\/a>|<\/?p>/g, '')), false);
  assert.equal(markup.includes('href="/f?p=%2FUsers%2Feli%2Fa%22b%3Cc%26d.md"'), true);
  assert.deepEqual([...linkedFiles('[a](/Users/eli/a"b<c&d.md)')], ['/Users/eli/a"b<c&d.md']);
});

test('links appear in lists, headings, quotes and tables, and a path the page does not link is drawn as it was', () => {
  const src = '# See /Users/eli/h.md\n\n- /Users/eli/l.md\n\n> /Users/eli/q.md\n\n|a|b|\n|---|---|\n|/Users/eli/t.md|[x](/Users/eli/u.md)|';
  assert.deepEqual(found(src).map(l => l.file), ['/Users/eli/h.md', '/Users/eli/l.md', '/Users/eli/q.md', '/Users/eli/t.md', '/Users/eli/u.md']);
  assert.equal(md('[a](/Users/eli/a.md) /Users/eli/b.md `/Users/eli/c.md`', () => null), md('[a](/Users/eli/a.md) /Users/eli/b.md `/Users/eli/c.md`'));
  assert.equal(md('[a](/Users/eli/a.md) /Users/eli/b.md', p => (p.endsWith('a.md') ? href(p) : null)).match(/<a /g).length, 1);
});

test('http links and plain emphasis are the same with and without the file callback', () => {
  const src = 'See [site](https://example.com) and https://example.com/a_b_c with *em* and **strong** and `code`.';
  assert.equal(md(src, href), md(src));
});

test('with no callback the output is exactly what it was before file links', () => {
  const was = [
  ["[a](/Users/x/a.md:12) and [b](<~/my file.md>) and /Users/x/c.md.",
    "<p><code title=\"/Users/x/a.md:12\">a</code> and [b](&lt;~/my file.md&gt;) and /Users/x/c.md.</p>"],
  ["`/Users/x/a.md` and `ls`",
    "<p><code>/Users/x/a.md</code> and <code>ls</code></p>"],
  ["# Title\n\n- one [a](/Users/x/a.md)\n- two **bold** _it_\n\n> quote /tmp/b.txt\n\n| a | b |\n|---|---|\n| /Users/x/a.md | `c` |",
    "<h3>Title</h3><ul><li>one <code title=\"/Users/x/a.md\">a</code></li><li>two <strong>bold</strong> <em>it</em></li></ul><blockquote><p>quote /tmp/b.txt</p></blockquote><div class=\"table\"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>/Users/x/a.md</td><td><code>c</code></td></tr></tbody></table></div>"],
  ["Visit https://example.com/a_b_c and [site](https://example.com). Mixed *em* and __strong__.",
    "<p>Visit <a href=\"https://example.com/a_b_c\" target=\"_blank\" rel=\"noopener noreferrer\">https://example.com/a_b_c</a> and <a href=\"https://example.com\" target=\"_blank\" rel=\"noopener noreferrer\">site</a>. Mixed <em>em</em> and __strong__.</p>"]
  ];
  for (const [text, markup] of was) {
    assert.equal(md(text), markup, text);
    assert.equal(md(text, null), markup, text);
    assert.equal(md(text, undefined), markup, text);
  }
});

test('linkedFiles is every path the markdown links, each once, and none for text with no file in it', () => {
  const src = 'a [x](/Users/eli/a.md:3) b /Users/eli/a.md c `~/b.md` d [y](<~/my c.md>) e `ls /tmp/z` f [z](https://example.com)';
  assert.deepEqual([...linkedFiles(src)].sort(), ['/Users/eli/a.md', '~/b.md', '~/my c.md']);
  assert.equal(linkedFiles('nothing to see, /api/x').size, 0);
  assert.equal(linkedFiles('').size, 0);
});

test('linkedFiles names the path with no line, so a link with a line and one without are the same file', () => {
  assert.deepEqual([...linkedFiles('[a](/Users/eli/a.md:3) [b](/Users/eli/a.md:9)')], ['/Users/eli/a.md']);
});

test('fileTarget takes only a string', () => {
  for (const bad of [undefined, null, 4, {}, ['/Users/eli/a']]) assert.equal(fileTarget(bad), null);
});
