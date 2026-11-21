// Styled dropdowns for the toolbar filters. The native <select> stays in the page as the source of
// truth: picking an option sets select.value and fires the same `change` event app.js listens to,
// so filtering, URLs and state handling are unchanged. Touch devices keep the native picker.

const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)');
let uid = 0;

function enhance(select) {
  const id = `select-${++uid}`;
  const label = select.closest('label')?.querySelector('span');
  if (label && !label.id) {
    label.id = `${id}-label`;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'select';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${id}-list`);
  const triggerText = document.createElement('span');
  triggerText.className = 'select-value';
  triggerText.id = `${id}-value`;
  trigger.append(triggerText);
  if (label) {
    trigger.setAttribute('aria-labelledby', `${label.id} ${triggerText.id}`);
  }

  const list = document.createElement('ul');
  list.className = 'select-menu';
  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');
  list.tabIndex = -1;
  list.hidden = true;
  if (label) {
    list.setAttribute('aria-labelledby', label.id);
  }

  select.classList.add('select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.after(wrapper);
  wrapper.append(select, trigger, list);

  let active = -1;
  let typed = '';
  let typedTimer = 0;

  const items = () => [...list.children];

  function render() {
    list.replaceChildren(
      ...[...select.options].map((option, index) => {
        const item = document.createElement('li');
        item.id = `${id}-option-${index}`;
        item.setAttribute('role', 'option');
        item.dataset.value = option.value;
        item.textContent = option.textContent;
        item.setAttribute('aria-selected', String(option.selected));
        return item;
      }),
    );
    triggerText.textContent = select.selectedOptions[0]?.textContent ?? '';
  }

  function setActive(index) {
    const all = items();
    if (!all.length) {
      return;
    }
    active = Math.max(0, Math.min(all.length - 1, index));
    all.forEach((item, i) => item.classList.toggle('is-active', i === active));
    list.setAttribute('aria-activedescendant', all[active].id);
    all[active].scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (!list.hidden) {
      return;
    }
    render();
    list.hidden = false;
    wrapper.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    setActive(select.selectedIndex);
    list.focus({ preventScroll: true });
    document.addEventListener('pointerdown', onOutside, true);
  }

  function close({ focusTrigger = true } = {}) {
    if (list.hidden) {
      return;
    }
    list.hidden = true;
    wrapper.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    list.removeAttribute('aria-activedescendant');
    document.removeEventListener('pointerdown', onOutside, true);
    if (focusTrigger) {
      trigger.focus({ preventScroll: true });
    }
  }

  function choose(index) {
    const option = select.options[index];
    if (option && select.selectedIndex !== index) {
      select.selectedIndex = index;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    render();
    close();
  }

  function onOutside(event) {
    if (!wrapper.contains(event.target)) {
      close({ focusTrigger: false });
    }
  }

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    if (list.hidden) {
      open();
    } else {
      close();
    }
  });

  trigger.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      open();
    }
  });

  list.addEventListener('keydown', (event) => {
    const count = items().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive(active + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive(active - 1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(count - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Tab':
        close({ focusTrigger: false });
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          // Type-ahead: jump to the first option starting with what was typed.
          typed += event.key.toLowerCase();
          window.clearTimeout(typedTimer);
          typedTimer = window.setTimeout(() => {
            typed = '';
          }, 600);
          const match = items().findIndex((item) => item.textContent.toLowerCase().startsWith(typed));
          if (match >= 0) {
            setActive(match);
          }
        }
    }
  });

  list.addEventListener('pointermove', (event) => {
    const item = event.target.closest('[role="option"]');
    if (item) {
      setActive(items().indexOf(item));
    }
  });

  list.addEventListener('click', (event) => {
    event.preventDefault();
    const item = event.target.closest('[role="option"]');
    if (item) {
      choose(items().indexOf(item));
    }
  });

  // app.js fills the options after the data loads; mirror them whenever they change.
  new MutationObserver(render).observe(select, { childList: true, subtree: true, characterData: true });
  select.addEventListener('change', render);
  render();
}

if (FINE_POINTER.matches) {
  document.querySelectorAll('.toolbar select').forEach(enhance);
}
