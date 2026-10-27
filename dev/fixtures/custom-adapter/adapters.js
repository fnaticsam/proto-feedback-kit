(window.kitAdapters = window.kitAdapters || []).push({
  name: 'garden',
  detect(win) { return !!win.document.querySelector('#viewport [data-screen]'); },
  screen(win) {
    const el = win.document.querySelector('[data-screen]:not([hidden])');
    return { id: el.dataset.screen, title: el.querySelector('h1').textContent, hash: win.location.hash };
  },
  onChange(win, cb) {
    win.addEventListener('hashchange', cb);
    return () => win.removeEventListener('hashchange', cb);
  },
  target(win) {
    const el = win.document.getElementById('viewport');
    return { el, scroller: el };
  },
  go(win, comment) { win.location.hash = comment.hash; }
});
