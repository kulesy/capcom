// Preact and htm, bound once so every component file imports from here.
import { h, render, Fragment } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export { render, Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState };

function shallowEqual(a, b) {
  for (const k in a) if (a[k] !== b[k]) return false;
  for (const k in b) if (!(k in a)) return false;
  return true;
}

// Preact skips an update when shouldComponentUpdate returns false, so a memoised row renders only when its props change.
export function memo(Component, same = shallowEqual) {
  function Memo(props) {
    this.shouldComponentUpdate = next => !same(this.props, next);
    return h(Component, props);
  }
  return Memo;
}
