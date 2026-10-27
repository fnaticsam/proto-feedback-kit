(() => {
  const version = document.querySelector('meta[name="kit:version"]').content;
  document.body.classList.toggle('round-two', version === '2');
  document.getElementById('round').textContent = version === '2' ? 'Round two · a fresh direction' : 'Round one · the first idea';
  function render() {
    const id = ['#/home', '#/list', '#/detail'].includes(location.hash) ? location.hash.slice(2) : 'home';
    if (!location.hash) history.replaceState(null, '', '#/home');
    document.querySelectorAll('[data-screen]').forEach(el => { el.hidden = el.dataset.screen !== id; });
    document.title = id[0].toUpperCase() + id.slice(1);
    window.scrollTo(0, 0);
  }
  addEventListener('hashchange', render);
  render();
})();
