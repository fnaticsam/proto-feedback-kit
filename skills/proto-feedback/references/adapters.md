# Custom adapters

An adapter reads and drives the prototype in its same-origin iframe. The kit ships
`generic`: hash routes, document title, hashchange/popstate events, and document
scrolling. Use it unless the prototype needs different routing or a pin target.

Place optional `adapters.js` beside the published `index.html`. Register objects
with `(window.kitAdapters = window.kitAdapters || []).push(adapter)`. The shell loads
this file before detecting the prototype; a missing or failing file is harmless.

```js
{
  name: 'sprout',                     // unique, lowercase
  detect(win) {},                     // boolean: recognises the iframe prototype
  screen(win) {},                     // { id, title, hash }
  onChange(win, cb) {},                // call cb on screen changes; return unsubscribe
  target(win) {},                     // { el, scroller }
  go(win, comment) {}                 // return to comment.hash
}
```

Selection: use the adapter named by `versions.json.adapter`; otherwise use the first
registered adapter whose `detect(win)` returns true; otherwise use `generic`.
An unknown name warns in the console and falls back to detection.

Explicit selection is immediate by default, even if `detect()` returns false.
For asynchronous initialization, set `versions.json.adapterWaitMs` to an integer
from 0 through 8000 milliseconds. A positive value polls only the named custom
adapter's `detect()` every 100ms and binds when ready; false or throwing detectors
fall back to `generic` at the deadline. Each frame load starts a fresh wait.
`detect()` must stay synchronous and return `false` until the app is ready: a
returned Promise counts as ready and binds at once.
Omitted, zero or invalid values preserve immediate selection. Explicit `generic`
always binds immediately; unknown or absent names keep automatic detection's
two-second limit. Keep app routing, navigation subscriptions and scrolling-target
selection in the custom adapter, including any phone/desktop differences.

Optional adapter methods add a screens rail in the wide layout:

```js
screens(win)       // [{ name, items: [{ id, title, hash, job }] }], or null
side(win)          // 'phone' or 'web'; omit for no Phone/Web switch
setSide(win, key)  // switch sides
reset(win)         // reset prototype state; adds a Reset link
```

When `screens` returns a nonempty list, the shell shows a 32px strip fixed to the
window's left edge, hidden below 760px. Its button opens a 280px list with group
headings, screen buttons and optional Phone/Web and Reset controls. Group names
should use sentence case; `job` is an optional screen tooltip. Hover opens after
120ms and closes 220ms after leaving unless pinned; clicking toggles/pins, focus
opens, and focus leaving, outside pointerdown (including the iframe), or Escape
closes. Escape refocuses the rail button. Selecting a screen calls
`go(win, { hash })` and closes for non-mouse pointers. Current screen and side use
`aria-current` and `aria-pressed`. The list rebuilds only when JSON of
`[groups, side]` changes; otherwise aria state updates in place. Call the adapter's
`onChange` callback when groups or side change; polling also refreshes the rail.

## Complete small example

This fictional Sprout prototype uses hash routes. Its visible screen has
`data-sprout-screen`, contains an `h1`, and optionally contains a scrolling element
marked `data-sprout-scroll`. Its router responds to `hashchange`. Save this as
`adapters.js` and set `"adapter": "sprout"` in the manifest:

```js
(window.kitAdapters = window.kitAdapters || []).push({
  name: 'sprout',
  detect(win) {
    return !!win.document.querySelector('[data-sprout-screen]');
  },
  screen(win) {
    const el = win.document.querySelector('[data-sprout-screen]');
    const hash = win.location.hash || '#plants';
    return {
      id: hash.slice(1),
      title: el?.querySelector('h1')?.textContent.trim() || 'Plants',
      hash
    };
  },
  onChange(win, cb) {
    win.addEventListener('hashchange', cb);
    win.addEventListener('popstate', cb);
    return () => {
      win.removeEventListener('hashchange', cb);
      win.removeEventListener('popstate', cb);
    };
  },
  target(win) {
    const doc = win.document;
    const el = doc.querySelector('[data-sprout-screen]') || doc.documentElement;
    const scroller = el.querySelector('[data-sprout-scroll]') ||
      doc.scrollingElement || doc.documentElement;
    return { el, scroller };
  },
  go(win, comment) {
    win.location.hash = comment.hash || '#plants';
  }
});
```

For a router that uses `history.replaceState`, listen to its navigation event in
`onChange`; changing history alone does not fire `hashchange`. Use its navigation
API in `go`. Keep IDs stable across versions so old feedback still finds its screen.
Return the actual scrolling element: pin `y` is measured in its content coordinates.
Check navigation to old comments, scrolling pins, and listener cleanup on version
switches. Test custom adapters without adding app-specific behavior to the shell.
