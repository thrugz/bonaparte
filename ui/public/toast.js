/** Shared toast notification utility. Include after brand.css. */
(function () {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  window.toast = function (message, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 3500);
  };
})();
