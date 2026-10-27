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
