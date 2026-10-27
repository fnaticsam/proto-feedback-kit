window.order = window.order.concat('manifest');
document.write('<script src="screens/one.js"><\/script>');
window.loadTwo = function () {
  var s = document.createElement('script');
  s.src = 'screens/two.js?v=1';
  s.onload = function () { window.order = window.order.concat('two loaded'); };
  document.head.appendChild(s);
};
