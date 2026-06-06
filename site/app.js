import {
  claimSearch,
  claimShareUrl,
  claimTokensFromSearch,
  isClaimMode,
  isClaimUrlTooLong,
  profileRequestIssueUrl,
} from './claim.js';

const state = {
  data: null,
  people: [],
  view: 'grid',
  sort: isClaimMode(window.location.search) ? 'canonical' : 'daily',
  shuffleSeed: '',
  currentPersonKey: '',
  syncingDialogFromUrl: false,
  claimMode: isClaimMode(window.location.search),
  selectedClaimTokens: new Set(),
  claimPinnedTokens: new Set(),
  filters: {
    query: '',
    year: '',
    series: '',
    role: '',
  },
};

const elements = {
  pageTitle: document.querySelector('#pageTitle'),
  pageLede: document.querySelector('#pageLede'),
  claimEntryLink: document.querySelector('#claimEntryLink'),
  searchInput: document.querySelector('#searchInput'),
  yearFilter: document.querySelector('#yearFilter'),
  seriesFilter: document.querySelector('#seriesFilter'),
  roleFilter: document.querySelector('#roleFilter'),
  resultCount: document.querySelector('#resultCount'),
  sourceMeta: document.querySelector('#sourceMeta'),
  peopleGrid: document.querySelector('#peopleGrid'),
  peopleList: document.querySelector('#peopleList'),
  personDialog: document.querySelector('#personDialog'),
  personDetail: document.querySelector('#personDetail'),
  claimPanel: document.querySelector('#claimPanel'),
  claimIssueButton: document.querySelector('#claimIssueButton'),
  claimCopyLinkButton: document.querySelector('#claimCopyLinkButton'),
  claimClearButton: document.querySelector('#claimClearButton'),
  claimCount: document.querySelector('#claimCount'),
  claimSelection: document.querySelector('#claimSelection'),
  claimNotice: document.querySelector('#claimNotice'),
  avatarTemplate: document.querySelector('#avatarTemplate'),
  moreFiltersBtn: document.querySelector('#moreFiltersBtn'),
  toolbarFilters: document.querySelector('#toolbarFilters'),
  viewButtons: document.querySelectorAll('[data-view]'),
  sortButtons: document.querySelectorAll('[data-sort]'),
  statPeople: document.querySelector('[data-stat="people"]'),
  statAppearances: document.querySelector('[data-stat="appearances"]'),
  statEvents: document.querySelector('[data-stat="events"]'),
};

const STANDARD_LINK_LABELS = new Map([
  ['github', 'GitHub'],
  ['gitlab', 'GitLab'],
  ['website', 'Website'],
  ['blog', 'Blog'],
  ['linkedin', 'LinkedIn'],
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['threads', 'Threads'],
  ['x', 'X'],
  ['discord', 'Discord'],
  ['telegram', 'Telegram'],
  ['mastodon', 'Mastodon'],
  ['youtube', 'YouTube'],
  ['slides', 'Slides'],
]);

init().catch((error) => {
  elements.peopleGrid.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});

async function init() {
  const response = await fetch('./assets/site-data.json');
  if (!response.ok) {
    throw new Error(`無法載入資料：${response.status}`);
  }
  state.data = await response.json();
  state.people = state.data.people;
  state.shuffleSeed = `session:${Date.now()}:${Math.random()}`;
  const initialClaimTokens = validClaimTokens(claimTokensFromSearch(window.location.search));
  state.selectedClaimTokens = new Set(initialClaimTokens);
  state.claimPinnedTokens = new Set(initialClaimTokens);

  fillStats();
  fillFilters();
  bindEvents();
  syncViewButtons();
  syncSortButtons();
  render();
  syncStateFromUrl();
}

function fillStats() {
  elements.statPeople.textContent = formatNumber(state.data.stats.people);
  elements.statAppearances.textContent = formatNumber(state.data.stats.appearances);
  elements.statEvents.textContent = formatNumber(state.data.stats.events);
  elements.sourceMeta.textContent = state.data.sourceExportedAt
    ? `資料匯出時間：${formatDateTime(state.data.sourceExportedAt)}`
    : `Prototype 產生時間：${formatDateTime(state.data.generatedAt)}`;
}

function fillFilters() {
  addOptions(elements.yearFilter, state.data.filters.years);
  addOptions(elements.seriesFilter, state.data.filters.eventSeries);
  addOptions(elements.roleFilter, state.data.filters.roleGroups);
}

function addOptions(select, values) {
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

function bindEvents() {
  elements.searchInput.addEventListener('input', () => {
    state.filters.query = elements.searchInput.value.trim().toLowerCase();
    render();
  });
  elements.yearFilter.addEventListener('change', () => {
    state.filters.year = elements.yearFilter.value;
    render();
  });
  elements.seriesFilter.addEventListener('change', () => {
    state.filters.series = elements.seriesFilter.value;
    render();
  });
  elements.roleFilter.addEventListener('change', () => {
    state.filters.role = elements.roleFilter.value;
    render();
  });
  for (const button of elements.viewButtons) {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      syncViewButtons();
      render();
    });
  }
  elements.moreFiltersBtn?.addEventListener('click', () => {
    const isOpen = elements.toolbarFilters.classList.toggle('is-open');
    elements.moreFiltersBtn.setAttribute('aria-expanded', String(isOpen));
  });
  for (const button of elements.sortButtons) {
    button.addEventListener('click', () => {
      if (button.dataset.sort === 'shuffle') {
        state.sort = 'shuffle';
        state.shuffleSeed = `session:${Date.now()}:${Math.random()}`;
      } else {
        state.sort = button.dataset.sort;
      }
      syncSortButtons();
      render();
    });
  }
  elements.claimIssueButton.addEventListener('click', () => {
    const claimUrl = currentClaimUrl();
    if (isClaimUrlTooLong(claimUrl)) {
      showClaimNotice('標記網址較長，請先減少標記項目後再開啟表單。');
      return;
    }
    window.open(profileRequestIssueUrl(claimUrl), '_blank', 'noopener');
  });
  elements.claimCopyLinkButton.addEventListener('click', () => {
    copyText(currentClaimUrl())
      .then(() => showClaimNotice('已複製分享網址。'))
      .catch(() => showClaimNotice('無法自動複製，請手動複製瀏覽器網址。'));
  });
  elements.claimClearButton.addEventListener('click', () => {
    state.selectedClaimTokens.clear();
    writeClaimSearch();
    render();
  });
  elements.personDialog.querySelector('.close-button').addEventListener('click', () => {
    elements.personDialog.close();
  });
  elements.personDialog.addEventListener('click', (event) => {
    if (event.target === elements.personDialog) {
      elements.personDialog.close();
    }
  });
  elements.personDialog.addEventListener('close', () => {
    const closedPersonKey = state.currentPersonKey;
    state.currentPersonKey = '';
    if (state.syncingDialogFromUrl || !closedPersonKey || profileKeyFromHash() !== closedPersonKey) {
      return;
    }
    clearProfileHash();
  });
  window.addEventListener('hashchange', syncStateFromUrl);
  window.addEventListener('popstate', syncStateFromUrl);
}

function render() {
  const people = sortedPeople(filteredPeople());
  elements.resultCount.textContent = formatNumber(people.length);
  elements.peopleGrid.hidden = state.view !== 'grid';
  elements.peopleList.hidden = state.view !== 'list';

  if (state.view === 'grid') {
    renderGrid(people);
  } else {
    renderList(people);
  }
  updateClaimPanel();
}

function filteredPeople() {
  return state.people.filter((person) => {
    if (state.filters.query && !person.searchText.includes(state.filters.query)) {
      return false;
    }
    if (state.filters.year && !person.eventYears.includes(state.filters.year)) {
      return false;
    }
    if (state.filters.role && !person.roleGroups.includes(state.filters.role)) {
      return false;
    }
    if (state.filters.series) {
      const appearances = appearancesFor(person);
      if (!appearances.some((appearance) => appearance.eventSeries === state.filters.series)) {
        return false;
      }
    }
    return true;
  });
}

function sortedPeople(people) {
  const sorted = [...people];
  const baseSorter =
    state.sort === 'canonical'
      ? canonicalPeopleSorter
      : (a, b) => {
          const seed = state.sort === 'shuffle' ? state.shuffleSeed : dailySeed();
          return seededScore(a.key, seed) - seededScore(b.key, seed) || canonicalPeopleSorter(a, b);
        };

  if (!state.claimMode || state.selectedClaimTokens.size === 0) {
    return sorted.sort(baseSorter);
  }

  const claimRanks = new Map([...state.claimPinnedTokens].map((token, index) => [token, index]));
  return sorted.sort((a, b) => claimRankFor(a, claimRanks) - claimRankFor(b, claimRanks) || baseSorter(a, b));
}

function canonicalPeopleSorter(a, b) {
  return (
    (a.canonicalOrder ?? Number.MAX_SAFE_INTEGER) - (b.canonicalOrder ?? Number.MAX_SAFE_INTEGER) ||
    a.displayName.localeCompare(b.displayName, 'zh-Hant')
  );
}

function claimRankFor(person, claimRanks) {
  return state.selectedClaimTokens.has(person.claimToken) && claimRanks.has(person.claimToken)
    ? claimRanks.get(person.claimToken)
    : Number.MAX_SAFE_INTEGER;
}

function renderGrid(people) {
  elements.peopleGrid.replaceChildren();
  if (people.length === 0) {
    elements.peopleGrid.innerHTML = '<p class="empty-state">沒有符合條件的紀錄。</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const person of people) {
    const card = elements.avatarTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector('.avatar').replaceChildren(renderAvatar(person));
    card.querySelector('.person-name').textContent = person.displayName;
    card.querySelector('.person-note').textContent = cardSummary(person);
    decorateClaimableElement(card, person);
    card.addEventListener('click', () => openPerson(person.key));
    bindKeyboardActivation(card, () => openPerson(person.key));
    fragment.append(card);
  }
  elements.peopleGrid.append(fragment);
}

function renderList(people) {
  elements.peopleList.replaceChildren();
  if (people.length === 0) {
    elements.peopleList.innerHTML = '<p class="empty-state">沒有符合條件的紀錄。</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const person of people) {
    const row = document.createElement('article');
    row.className = 'list-row';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.innerHTML = `
      <span class="avatar"></span>
      <span class="list-main">
        <strong>${escapeHtml(person.displayName)}</strong>
        <span>${escapeHtml(personSubtitle(person))}</span>
      </span>
      <span class="list-summary">${escapeHtml(person.summary || cardSummary(person))}</span>
      <span class="list-roles">${renderRoleChips(person)}</span>
    `;
    row.querySelector('.avatar').replaceChildren(renderAvatar(person));
    decorateClaimableElement(row, person);
    row.addEventListener('click', () => openPerson(person.key));
    bindKeyboardActivation(row, () => openPerson(person.key));
    fragment.append(row);
  }
  elements.peopleList.append(fragment);
}

function bindKeyboardActivation(element, callback) {
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    callback();
  });
}

function decorateClaimableElement(element, person) {
  const selected = person.claimable && state.selectedClaimTokens.has(person.claimToken);
  element.classList.toggle('is-claim-mode', state.claimMode);
  element.classList.toggle('is-claimed', selected);
  element.classList.toggle('is-unclaimable', state.claimMode && !person.claimable);

  if (!state.claimMode) {
    element.removeAttribute('aria-pressed');
    element.title = '查看貢獻紀錄';
    return;
  }

  element.setAttribute('aria-pressed', person.claimable ? String(selected) : 'false');
  element.title = person.claimable ? '查看貢獻紀錄' : '這個項目目前沒有穩定的 profile reference，暫時不能標記';
  element.append(renderClaimToggle(person, selected));
}

function renderClaimToggle(person, selected) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'claim-toggle';
  button.disabled = !person.claimable;
  button.textContent = selected ? '已標記' : '標記';
  button.setAttribute('aria-pressed', person.claimable ? String(selected) : 'false');
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleClaim(person);
  });
  return button;
}

function toggleClaim(person) {
  if (!person.claimable || !person.claimToken) {
    showClaimNotice('這個項目目前沒有穩定的 profile reference，暫時不能標記。');
    return;
  }
  if (state.selectedClaimTokens.has(person.claimToken)) {
    state.selectedClaimTokens.delete(person.claimToken);
  } else {
    state.selectedClaimTokens.add(person.claimToken);
  }
  preserveViewportScroll(() => {
    writeClaimSearch();
    render();
  });
}

function preserveViewportScroll(callback) {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  callback();
  window.scrollTo(scrollX, scrollY);
  window.requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
}

function openPerson(personKey) {
  const didOpen = showPerson(personKey);
  if (didOpen) {
    pushProfileHash(personKey);
  }
}

function showPerson(personKey) {
  const person = personForKey(personKey);
  if (!person) {
    return false;
  }
  const appearances = appearancesFor(person);
  state.currentPersonKey = person.key;
  elements.personDetail.innerHTML = `
    <header class="detail-head">
      <span class="avatar"></span>
      <div>
        <h2>${escapeHtml(person.displayName)}</h2>
        <div class="badges">
          ${personSubtitle(person) ? `<span class="badge">${escapeHtml(personSubtitle(person))}</span>` : ''}
          <span class="badge">${escapeHtml(person.summary || cardSummary(person))}</span>
          ${person.eventYears.length ? `<span class="badge">${escapeHtml(compactYears(person.eventYears))}</span>` : ''}
        </div>
        ${renderLinks(person)}
      </div>
    </header>
    ${person.bio ? `<p class="bio">${escapeHtml(person.bio)}</p>` : ''}
    <section class="timeline" aria-label="貢獻紀錄">
      ${appearances.map(renderAppearance).join('')}
    </section>
  `;
  elements.personDetail.querySelector('.avatar').replaceChildren(renderAvatar(person));
  if (!elements.personDialog.open) {
    elements.personDialog.showModal();
  }
  return true;
}

function syncStateFromUrl() {
  state.claimMode = isClaimMode(window.location.search);
  const urlClaimTokens = validClaimTokens(claimTokensFromSearch(window.location.search));
  state.selectedClaimTokens = new Set(urlClaimTokens);
  state.claimPinnedTokens = new Set(urlClaimTokens);
  const personKey = profileKeyFromHash();
  state.syncingDialogFromUrl = true;
  try {
    if (!personKey) {
      if (elements.personDialog.open) {
        elements.personDialog.close();
      }
    } else {
      showPerson(personKey);
    }
  } finally {
    state.syncingDialogFromUrl = false;
  }
  render();
}

function profileKeyFromHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) {
    return '';
  }
  const params = new URLSearchParams(hash);
  const value = params.get('person');
  if (!value) {
    return '';
  }
  if (state.people.some((person) => person.key === value)) {
    return value;
  }
  const githubPerson = state.people.find(
    (person) => person.profileKind === 'github' && person.username.toLowerCase() === value.toLowerCase(),
  );
  return githubPerson?.key || '';
}

function pushProfileHash(personKey) {
  const hashValue = profileHashValue(personKey);
  const params = new URLSearchParams(window.location.hash.slice(1));
  params.set('person', hashValue);
  const nextHash = params.toString();
  if (window.location.hash.slice(1) === nextHash) {
    return;
  }
  window.history.pushState(null, '', `${window.location.pathname}${window.location.search}#${nextHash}`);
}

function clearProfileHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  params.delete('person');
  const nextHash = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`);
}

function personForKey(personKey) {
  return state.people.find((candidate) => candidate.key === personKey);
}

function profileHashValue(personKey) {
  const person = personForKey(personKey);
  if (person?.profileKind === 'github' && person.username) {
    return person.username;
  }
  return personKey;
}

function writeClaimSearch() {
  const nextSearch = claimSearch(state.selectedClaimTokens, window.location.search);
  window.history.replaceState(null, '', `${window.location.pathname}${nextSearch}${window.location.hash}`);
}

function validClaimTokens(tokens) {
  const valid = new Set(state.people.filter((person) => person.claimable).map((person) => person.claimToken));
  return tokens.filter((token) => valid.has(token));
}

function updateClaimPanel() {
  syncPageMode();
  elements.claimPanel.hidden = !state.claimMode;
  if (!state.claimMode) {
    return;
  }

  const count = state.selectedClaimTokens.size;
  const hasClaims = count > 0;
  elements.claimCount.textContent = formatNumber(count);
  elements.claimIssueButton.disabled = !hasClaims;
  elements.claimCopyLinkButton.disabled = !hasClaims;
  elements.claimClearButton.disabled = !hasClaims;
  elements.claimIssueButton.classList.toggle('is-ready', hasClaims);
  renderClaimSelection();
}

function syncPageMode() {
  elements.claimEntryLink.hidden = state.claimMode;
  elements.claimEntryLink.href = claimShareUrl(window.location, []);

  if (state.claimMode) {
    document.title = '標記我的貢獻紀錄 - SITCON Credits';
    elements.pageTitle.textContent = '標記我的貢獻紀錄';
    elements.pageLede.textContent =
      '合併紀錄或更新個人公開資料，完成後開啟表單填寫資料';
    return;
  }

  document.title = 'SITCON Credits';
  elements.pageTitle.textContent = '貢獻紀錄索引';
  elements.pageLede.textContent = '探索歷屆工作人員、講者與公開貢獻紀錄。';
}

function syncViewButtons() {
  for (const current of elements.viewButtons) {
    current.classList.toggle('is-active', current.dataset.view === state.view);
  }
}

function syncSortButtons() {
  for (const current of elements.sortButtons) {
    current.classList.toggle('is-active', current.dataset.sort === state.sort);
  }
}

function renderClaimSelection() {
  elements.claimSelection.replaceChildren();
  if (state.selectedClaimTokens.size === 0) {
    elements.claimSelection.textContent = '尚未標記任何項目。';
    return;
  }

  const peopleByToken = new Map(state.people.map((person) => [person.claimToken, person]));
  const fragment = document.createDocumentFragment();
  for (const token of state.selectedClaimTokens) {
    const person = peopleByToken.get(token);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'claim-selection-item';
    item.textContent = person ? person.displayName : token;
    item.title = person ? `${person.displayName} - ${person.summary || cardSummary(person)}` : token;
    item.addEventListener('click', () => {
      if (person) {
        openPerson(person.key);
      }
    });
    fragment.append(item);
  }
  elements.claimSelection.append(fragment);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error('clipboard API is unavailable');
}

function showClaimNotice(message) {
  elements.claimNotice.textContent = message;
}

function currentClaimUrl() {
  return new URL(claimShareUrl(window.location, state.selectedClaimTokens), window.location.href).toString();
}

function renderLinks(person) {
  const links = [...person.links];
  if (person.username && !links.some((link) => link.type === 'github')) {
    links.unshift({ type: 'github', url: `https://github.com/${person.username}` });
  }
  if (links.length === 0) {
    return '';
  }
  return `<nav class="links" aria-label="公開連結">${links
    .map(
      (link) =>
        `<a href="${escapeAttribute(link.url)}" rel="noreferrer" target="_blank">${escapeHtml(linkLabel(link))}</a>`,
    )
    .join('')}</nav>`;
}

function linkLabel(link) {
  if (link.type === 'custom') {
    return link.label || link.type;
  }
  return STANDARD_LINK_LABELS.get(link.type) || link.label || link.type;
}

function renderAppearance(appearance) {
  const role = [appearance.roleGroup, appearance.roleTitle].filter(Boolean).join(' / ');
  return `
    <article class="appearance">
      <strong class="appearance-year">${escapeHtml(appearance.eventYear)}</strong>
      <div>
        <h3>${escapeHtml(appearance.eventName)}</h3>
        <p>${escapeHtml(role || '公開貢獻紀錄')}</p>
        <p>活動顯示名稱：${escapeHtml(appearance.displayNameAtEvent)}</p>
      </div>
      ${appearance.sourceUrl ? `<a class="source-link" href="${escapeAttribute(appearance.sourceUrl)}" rel="noreferrer" target="_blank">來源</a>` : ''}
    </article>
  `;
}

function renderRoleChips(person) {
  const roles = person.roleSummary?.length ? person.roleSummary : person.roleGroups.slice(0, 2);
  if (roles.length === 0) {
    return '<span class="role-chip">未分類</span>';
  }
  const chips = roles.map((role) => `<span class="role-chip">${escapeHtml(role)}</span>`);
  const extra = person.roleGroups.length - roles.length;
  if (extra > 0) {
    chips.push(`<span class="role-chip">+${formatNumber(extra)}</span>`);
  }
  return chips.join('');
}

function renderAvatar(person) {
  if (person.avatarUrl) {
    const image = document.createElement('img');
    image.src = person.avatarUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      image.replaceWith(document.createTextNode(initials(person.displayName)));
    });
    return image;
  }
  return document.createTextNode(initials(person.displayName));
}

function appearancesFor(person) {
  const ids = new Set(person.appearanceIds);
  return state.data.appearances
    .filter((appearance) => ids.has(appearance.id))
    .sort((a, b) => a.eventOrder - b.eventOrder || a.eventName.localeCompare(b.eventName, 'zh-Hant'));
}

function personSubtitle(person) {
  if (person.username) {
    return `@${person.username}`;
  }
  return person.primaryEventName || person.firstEventName || '';
}

function cardSummary(person) {
  return person.summary || `${formatNumber(person.appearanceCount)} 筆`;
}

function compactYears(years) {
  if (years.length <= 3) {
    return years.join(', ');
  }
  return `${years.slice(0, 3).join(', ')} +${formatNumber(years.length - 3)}`;
}

function dailySeed() {
  return new Date().toISOString().slice(0, 10);
}

function seededScore(key, seed) {
  let hash = 2166136261;
  const text = `${seed}:${key}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function initials(name) {
  const normalized = String(name || '?').trim();
  const letters = [...normalized].filter((char) => !/\s/.test(char));
  return letters.slice(0, 2).join('').toUpperCase() || '?';
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-Hant-TW').format(value);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-Hant-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
