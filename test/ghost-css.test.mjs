// Run with `npm test`. What ghost.css promises about its own rules, read from its text with no page: nothing moves unless the system has no wish
// for less motion, and nothing reaches the standard look but the one rule that hides the shell drawings there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { styleRules } from './css.mjs';

const NO_PREFERENCE = '@media (prefers-reduced-motion: no-preference)';
const SCOPED = /^(:root)?\[data-look="ghost"\]/;
const HIDER = { selectors: ['.shell-spin', '.brand-mark', '.emblem'], declarations: { display: 'none' }, within: [] };

const ghost = fs.readFileSync(new URL('../public/ghost.css', import.meta.url), 'utf8');

const animates = rule => Object.keys(rule.declarations).some(property => /^animation(-|$)/.test(property));
const isHider = ({ selectors, declarations, within }) => isDeepStrictEqual({ selectors, declarations, within }, HIDER);

// The selectors of each rule that sets an animation outside the query that holds when the system has no wish for less motion.
const unmoved = css => styleRules(css).filter(rule => animates(rule) && !rule.within.includes(NO_PREFERENCE)).map(rule => rule.selectors.join(', '));

// The selectors that would reach the standard look: each one not under the Ghost attribute, bar the hiding rule's.
const unscoped = css => styleRules(css).filter(rule => !isHider(rule)).flatMap(rule => rule.selectors).filter(selector => !SCOPED.test(selector));

test('every animation in ghost.css is inside the query for a system with no wish for less motion', () => {
  assert.ok(styleRules(ghost).some(animates), 'ghost.css sets no animation, so this check looked at nothing');
  assert.deepEqual(unmoved(ghost), []);
});

test('every selector in ghost.css is under the Ghost attribute, except the rule that hides the shell drawings', () => {
  assert.deepEqual(unscoped(ghost), []);
});

test('ghost.css has exactly one rule that hides the shell drawings in the standard look', () => {
  assert.equal(styleRules(ghost).filter(isHider).length, 1);
});

test('the motion check flags an animation set by the shorthand or a longhand outside the query, and passes one inside it', () => {
  const inside = rule => `@media (prefers-reduced-motion: no-preference) { @supports (x: y) { ${rule} } }`;
  assert.deepEqual(unmoved('[data-look="ghost"] .a { animation: spin 1s infinite; }'), ['[data-look="ghost"] .a']);
  assert.deepEqual(unmoved('[data-look="ghost"] .a, [data-look="ghost"] .b { animation-name: spin; }'), ['[data-look="ghost"] .a, [data-look="ghost"] .b']);
  assert.deepEqual(unmoved('@media (prefers-reduced-motion: reduce) { [data-look="ghost"] .a { animation: spin 1s; } }'), ['[data-look="ghost"] .a']);
  assert.deepEqual(unmoved('@media (min-width: 0px) { [data-look="ghost"] .a { animation: spin 1s; } }'), ['[data-look="ghost"] .a']);
  assert.deepEqual(unmoved(inside('[data-look="ghost"] .a { animation: spin 1s; }')), []);
  assert.deepEqual(unmoved('[data-look="ghost"] .a { transform: none; }'), []);
});

test('the scope check flags a selector outside the Ghost attribute in any list, at any depth, and passes the root and an ancestor carrying it', () => {
  assert.deepEqual(unscoped('.a { color: red; }'), ['.a']);
  assert.deepEqual(unscoped('[data-look="ghost"] .a, .b { color: red; }'), ['.b']);
  assert.deepEqual(unscoped('@media (prefers-color-scheme: dark) { .a { color: red; } }'), ['.a']);
  assert.deepEqual(unscoped('@supports (x: y) { @media (min-width: 0px) { .a { color: red; } } }'), ['.a']);
  assert.deepEqual(unscoped('[data-look="ghostly"] .a { color: red; }'), ['[data-look="ghostly"] .a']);
  assert.deepEqual(unscoped(':root[data-look="ghost"] { --a: red; } [data-look="ghost"] .a { color: red; }'), []);
});

test('the scope check lets through only the hiding rule as ghost.css writes it, at the top level', () => {
  assert.deepEqual(unscoped('.shell-spin, .brand-mark, .emblem { display: none; }'), []);
  assert.deepEqual(unscoped('.shell-spin, .brand-mark { display: none; }'), ['.shell-spin', '.brand-mark']);
  assert.deepEqual(unscoped('.shell-spin, .brand-mark, .emblem { display: none; opacity: 0; }'), ['.shell-spin', '.brand-mark', '.emblem']);
  assert.deepEqual(unscoped('.shell-spin, .brand-mark, .emblem { display: block; }'), ['.shell-spin', '.brand-mark', '.emblem']);
  assert.deepEqual(unscoped('@media (min-width: 0px) { .shell-spin, .brand-mark, .emblem { display: none; } }'), ['.shell-spin', '.brand-mark', '.emblem']);
  assert.equal(styleRules('.shell-spin, .brand-mark, .emblem { display: none; }\n.shell-spin, .brand-mark, .emblem { display: none; }').filter(isHider).length, 2);
});
