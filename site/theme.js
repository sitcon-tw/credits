// Light / dark switch in the top bar. The inline script in index.html sets the initial theme
// (stored choice, else the OS setting) before the first paint; this only handles the buttons.
const root = document.documentElement;
const buttons = document.querySelectorAll('[data-theme-set]');

function sync() {
  for (const button of buttons) {
    button.setAttribute('aria-pressed', String(button.dataset.themeSet === root.dataset.theme));
  }
}

for (const button of buttons) {
  button.addEventListener('click', () => {
    root.dataset.theme = button.dataset.themeSet;
    sync();
    try {
      localStorage.setItem('credits-theme', root.dataset.theme);
    } catch {
      // Storage may be unavailable (private mode); the choice then lasts for this page view only.
    }
  });
}

sync();
