import { CLAIMS_PARAM, CLAIM_MODE_PARAM, claimSearch } from './claim.js';
import { BASE } from './base.js';
import { createField } from './field/field.js';

const CLAIM_PAGE = `${BASE}/claim.html`;
const LIST_LIMIT = 150;

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

if (redirectClaimRequests()) {
  // The document is being replaced by the claim page; stop before touching the DOM.
} else {
  start();
}

function redirectClaimRequests() {
  const params = new URLSearchParams(window.location.search);
  if (params.get(CLAIM_MODE_PARAM) !== '1' && !params.has(CLAIMS_PARAM)) {
    return false;
  }
  window.location.replace(`${CLAIM_PAGE}${window.location.search}${window.location.hash}`);
  return true;
}

function start() {
  const elements = {
    hud: document.querySelector('#hud'),
    fieldStage: document.querySelector('#fieldStage'),
    canvas: document.querySelector('#fieldCanvas'),
    fieldLabel: document.querySelector('#fieldLabel'),
    searchInput: document.querySelector('#searchInput'),
    yearFilter: document.querySelector('#yearFilter'),
    seriesFilter: document.querySelector('#seriesFilter'),
    roleFilter: document.querySelector('#roleFilter'),
    listToggle: document.querySelector('#listToggle'),
    resultCount: document.querySelector('#resultCount'),
    resultList: document.querySelector('#resultList'),
    personPanel: document.querySelector('#personPanel'),
    statPeople: document.querySelector('#statPeople'),
    statAppearances: document.querySelector('#statAppearances'),
    statEvents: document.querySelector('#statEvents'),
    modeButtons: document.querySelectorAll('[data-mode]'),
  };

  const state = {
    data: null,
    nodes: [],
    appearancesByNode: new Map(),
    matches: null,
    visible: [],
    mode: 'core',
    currentNodeId: '',
    field: null,
    fieldNotice: '',
    filters: { query: '', year: '', series: '', role: '' },
  };

  init().catch((error) => {
    elements.resultCount.textContent = `無法載入資料：${error.message}`;
  });

  async function init() {
    const response = await fetch(`${BASE}/assets/index-data.json`);
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    state.data = await response.json();
    state.nodes = state.data.nodes;
    state.matches = new Float32Array(state.nodes.length).fill(1);
    for (const appearance of state.data.appearances) {
      const list = state.appearancesByNode.get(appearance.nodeId);
      if (list) {
        list.push(appearance);
      } else {
        state.appearancesByNode.set(appearance.nodeId, [appearance]);
      }
    }

    fillStats();
    fillFilters();
    bindEvents();
    startField();
    render();
    syncFromHash();
  }

  function fillStats() {
    elements.statPeople.textContent = formatNumber(state.data.stats.people);
    elements.statAppearances.textContent = formatNumber(state.data.stats.appearances);
    elements.statEvents.textContent = formatNumber(state.data.stats.events);
  }

  function fillFilters() {
    addOptions(elements.yearFilter, state.data.filters.years);
    addOptions(elements.seriesFilter, state.data.filters.eventSeries);
    addOptions(elements.roleFilter, state.data.filters.roleGroups);
  }

  function addOptions(select, values) {
    const fragment = document.createDocumentFragment();
    for (const value of values ?? []) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      fragment.append(option);
    }
    select.append(fragment);
  }

  function startField() {
    state.field = createField({
      canvas: elements.canvas,
      nodes: state.nodes,
      events: state.data.events,
      atlas: state.data.atlas,
      baseUrl: BASE,
      label: elements.fieldLabel,
      hudRoot: elements.hud,
      onSelect: (nodeId) => openNode(nodeId),
    });

    if (!state.field.supported) {
      elements.fieldStage.hidden = true;
      state.fieldNotice = '這個瀏覽器不支援 WebGL2，改以列表呈現。';
      setListOpen(true);
      return;
    }
    window.__creditsField = state.field;
  }

  function bindEvents() {
    elements.searchInput.addEventListener('input', () => {
      state.filters.query = elements.searchInput.value.trim().toLowerCase();
      render();
    });
    for (const [element, key] of [
      [elements.yearFilter, 'year'],
      [elements.seriesFilter, 'series'],
      [elements.roleFilter, 'role'],
    ]) {
      element.addEventListener('change', () => {
        state.filters[key] = element.value;
        render();
      });
    }
    for (const button of elements.modeButtons) {
      button.addEventListener('click', () => setMode(button.dataset.mode));
    }
    elements.listToggle.addEventListener('click', () => {
      setListOpen(elements.resultList.hidden);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !elements.personPanel.hidden) {
        closePanel();
      }
    });
    window.addEventListener('resize', () => state.field?.resize?.());
    window.addEventListener('hashchange', syncFromHash);
    window.addEventListener('popstate', syncFromHash);
  }

  function setMode(mode) {
    if (!mode || mode === state.mode) {
      return;
    }
    state.mode = mode;
    for (const button of elements.modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
    state.field?.setMode?.(mode);
  }

  function setListOpen(open) {
    elements.resultList.hidden = !open;
    elements.listToggle.setAttribute('aria-expanded', String(open));
    elements.listToggle.textContent = open ? '關閉列表' : '列表檢視';
    if (open) {
      renderList();
    }
  }

  function matchesFilters(node) {
    const { query, year, series, role } = state.filters;
    if (query && !node.search.includes(query)) {
      return false;
    }
    if (year && !node.years.includes(year)) {
      return false;
    }
    if (role && !node.roleGroups.includes(role)) {
      return false;
    }
    if (series) {
      const appearances = state.appearancesByNode.get(node.id) ?? [];
      if (!appearances.some((appearance) => appearance.eventSeries === series)) {
        return false;
      }
    }
    return true;
  }

  function render() {
    state.visible = [];
    for (const [index, node] of state.nodes.entries()) {
      const hit = matchesFilters(node);
      state.matches[index] = hit ? 1 : 0;
      if (hit) {
        state.visible.push(index);
      }
    }
    state.field?.setMatches?.(state.matches);

    const summary = `顯示 ${formatNumber(state.visible.length)} / ${formatNumber(state.nodes.length)} 位夥伴`;
    elements.resultCount.textContent = state.fieldNotice ? `${summary} · ${state.fieldNotice}` : summary;
    if (!elements.resultList.hidden) {
      renderList();
    }
  }

  function renderList() {
    const fragment = document.createDocumentFragment();
    if (state.visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'result-list-empty';
      empty.textContent = '沒有符合條件的紀錄。';
      fragment.append(empty);
    }
    for (const index of state.visible.slice(0, LIST_LIMIT)) {
      fragment.append(resultRow(state.nodes[index]));
    }
    if (state.visible.length > LIST_LIMIT) {
      const note = document.createElement('p');
      note.className = 'result-list-empty';
      note.textContent = `列表僅顯示前 ${formatNumber(LIST_LIMIT)} 筆，請縮小搜尋範圍或直接點選畫面上的徽章。`;
      fragment.append(note);
    }
    elements.resultList.replaceChildren(fragment);
  }

  function resultRow(node) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'result-row';
    row.dataset.nodeId = node.id;
    row.classList.toggle('is-active', node.id === state.currentNodeId);
    row.append(avatarElement(node, 40));

    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'result-row-name';
    name.textContent = node.displayName;
    const note = document.createElement('span');
    note.className = 'result-row-note';
    note.textContent = [node.topRole, yearRange(node.years)].filter(Boolean).join(' · ');
    text.append(name, note);
    row.append(text);

    row.addEventListener('click', () => {
      state.field?.focusNode?.(node.id);
      openNode(node.id);
    });
    return row;
  }

  function avatarElement(node, size) {
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    if (node.avatarUrl) {
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.width = size;
      image.height = size;
      image.alt = '';
      image.src = node.avatarUrl;
      image.addEventListener('error', () => {
        avatar.replaceChildren(document.createTextNode(initials(node.displayName)));
      });
      avatar.append(image);
    } else {
      avatar.textContent = initials(node.displayName);
    }
    return avatar;
  }

  function openNode(nodeId) {
    if (!showNode(nodeId)) {
      return;
    }
    pushPersonHash(nodeId);
  }

  function showNode(nodeId) {
    const node = state.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      return false;
    }
    state.currentNodeId = node.id;
    renderPanel(node);
    elements.personPanel.hidden = false;
    if (!elements.resultList.hidden) {
      renderList();
    }
    return true;
  }

  function renderPanel(node) {
    const appearances = [...(state.appearancesByNode.get(node.id) ?? [])].sort(
      (a, b) => a.eventOrder - b.eventOrder,
    );
    const panel = document.createDocumentFragment();

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel-close';
    close.setAttribute('aria-label', '關閉');
    close.textContent = '×';
    close.addEventListener('click', closePanel);
    panel.append(close);

    const head = document.createElement('header');
    head.className = 'panel-head';
    head.append(avatarElement(node, 64));

    const heading = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = node.displayName;
    heading.append(title);

    const badges = document.createElement('div');
    badges.className = 'badges';
    for (const text of [
      node.kind === 'github' && node.username ? `@${node.username}` : '',
      `${formatNumber(appearances.length)} 筆`,
      node.eventIds.length ? `${formatNumber(node.eventIds.length)} 場活動` : '',
      yearRange(node.years),
    ].filter(Boolean)) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = text;
      badges.append(badge);
    }
    heading.append(badges);

    if (node.roleGroups.length > 0) {
      const chips = document.createElement('div');
      chips.className = 'role-chips';
      for (const group of node.roleGroups.slice(0, 6)) {
        const chip = document.createElement('span');
        chip.className = 'role-chip';
        chip.textContent = group;
        chips.append(chip);
      }
      heading.append(chips);
    }

    const links = linkList(node);
    if (links) {
      heading.append(links);
    }
    head.append(heading);
    panel.append(head);

    if (node.bio) {
      const bio = document.createElement('p');
      bio.className = 'bio';
      bio.textContent = node.bio;
      panel.append(bio);
    }

    const timeline = document.createElement('section');
    timeline.className = 'timeline';
    timeline.setAttribute('aria-label', '貢獻紀錄');
    for (const appearance of appearances) {
      timeline.append(appearanceRow(appearance));
    }
    panel.append(timeline);

    if (node.memberKeys.length > 1) {
      const note = document.createElement('p');
      note.className = 'merge-note';
      note.textContent = `這顆徽章合併了 ${formatNumber(
        node.memberKeys.length,
      )} 筆同名/同來源的公開紀錄，僅為顯示分群。`;
      panel.append(note);
    }

    if (node.claimTokens.length > 0) {
      const claim = document.createElement('a');
      claim.className = 'claim-cta';
      claim.href = `${CLAIM_PAGE}${claimSearch(node.claimTokens, '')}`;
      claim.textContent = '這是我';
      panel.append(claim);
    }

    elements.personPanel.replaceChildren(panel);
    elements.personPanel.scrollTop = 0;
  }

  function appearanceRow(appearance) {
    const row = document.createElement('article');
    row.className = 'appearance';

    const event = document.createElement('span');
    event.className = 'appearance-event';
    event.textContent = appearance.eventName || appearance.eventId;
    row.append(event);

    const role = document.createElement('span');
    role.className = 'appearance-role';
    role.textContent = [appearance.roleGroup, appearance.roleTitle].filter(Boolean).join(' · ');
    row.append(role);

    if (appearance.displayNameAtEvent) {
      const name = document.createElement('span');
      name.className = 'appearance-role';
      name.textContent = `當時署名：${appearance.displayNameAtEvent}`;
      row.append(name);
    }

    if (appearance.sourceUrl) {
      const link = document.createElement('a');
      link.href = appearance.sourceUrl;
      link.rel = 'noreferrer';
      link.target = '_blank';
      link.textContent = '公開來源';
      row.append(link);
    }
    return row;
  }

  function linkList(node) {
    const links = [...(node.links ?? [])];
    if (node.username && !links.some((link) => link.type === 'github')) {
      links.unshift({ type: 'github', url: `https://github.com/${node.username}` });
    }
    if (node.publicEmail) {
      links.push({ label: 'Email', url: `mailto:${node.publicEmail}` });
    }
    if (links.length === 0) {
      return null;
    }
    const container = document.createElement('div');
    container.className = 'panel-links';
    for (const link of links) {
      if (!link.url) {
        continue;
      }
      const anchor = document.createElement('a');
      anchor.href = link.url;
      anchor.rel = 'noreferrer';
      anchor.target = '_blank';
      anchor.textContent = link.label || STANDARD_LINK_LABELS.get(link.type) || link.type || link.url;
      container.append(anchor);
    }
    return container;
  }

  function closePanel() {
    elements.personPanel.hidden = true;
    elements.personPanel.replaceChildren();
    state.currentNodeId = '';
    state.field?.clearSelection?.();
    clearPersonHash();
    if (!elements.resultList.hidden) {
      renderList();
    }
  }

  function syncFromHash() {
    const nodeId = nodeIdFromHash();
    if (!nodeId) {
      if (!elements.personPanel.hidden) {
        elements.personPanel.hidden = true;
        elements.personPanel.replaceChildren();
        state.currentNodeId = '';
      }
      return;
    }
    if (nodeId === state.currentNodeId) {
      return;
    }
    if (showNode(nodeId)) {
      state.field?.focusNode?.(nodeId);
    }
  }

  function nodeIdFromHash() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const value = params.get('person');
    if (!value) {
      return '';
    }
    if (state.nodes.some((node) => node.id === value)) {
      return value;
    }
    const byUsername = state.nodes.find(
      (node) => node.username && node.username.toLowerCase() === value.toLowerCase(),
    );
    if (byUsername) {
      return byUsername.id;
    }
    return state.nodes.find((node) => node.memberKeys.includes(value))?.id ?? '';
  }

  function personHashValue(nodeId) {
    const node = state.nodes.find((candidate) => candidate.id === nodeId);
    return node?.kind === 'github' && node.username ? node.username : nodeId;
  }

  function pushPersonHash(nodeId) {
    const params = new URLSearchParams(window.location.hash.slice(1));
    params.set('person', personHashValue(nodeId));
    const nextHash = params.toString();
    if (window.location.hash.slice(1) === nextHash) {
      return;
    }
    window.history.pushState(null, '', `${window.location.pathname}${window.location.search}#${nextHash}`);
  }

  function clearPersonHash() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    params.delete('person');
    const nextHash = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`,
    );
  }
}

function yearRange(years) {
  if (!years || years.length === 0) {
    return '';
  }
  if (years.length === 1) {
    return years[0];
  }
  return `${years.at(-1)}–${years[0]}`;
}

function initials(name) {
  const text = String(name ?? '').trim();
  if (!text) {
    return '?';
  }
  const ascii = text.match(/[A-Za-z0-9]/gu);
  if (ascii && /^[\x20-\x7e]+$/u.test(text)) {
    return ascii.slice(0, 2).join('').toUpperCase();
  }
  return [...text][0];
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-Hant-TW').format(value);
}
