import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildBubbleData, groupPeople, normalizeDisplayName, roleWeight } from './bubbles.mjs';

const EVENTS = [
  { id: 'SITCON-2026', order: 0, series: 'SITCON 年會', name: 'SITCON 2026', year: '2026' },
  { id: 'SITCON-Camp-2025', order: 1, series: 'SITCON Camp', name: 'SITCON Camp 2025', year: '2025' },
  { id: 'SITCON-2025', order: 2, series: 'SITCON 年會', name: 'SITCON 2025', year: '2025' },
  { id: 'SITCON-2022', order: 3, series: 'SITCON 年會', name: 'SITCON 2022', year: '2022' },
];

function person(overrides) {
  return {
    key: '',
    profileKind: 'site',
    profileRef: '',
    username: '',
    sourcePersonId: '',
    displayName: '',
    avatarUrl: '',
    bio: '',
    publicEmail: '',
    links: [],
    claimToken: '',
    eventIds: [],
    eventYears: [],
    roleGroups: [],
    appearanceIds: [],
    ...overrides,
  };
}

function appearance(overrides) {
  const event = EVENTS.find((candidate) => candidate.id === overrides.eventId);
  return {
    id: `${overrides.eventId}:${overrides.personKey}`,
    personKey: '',
    claimToken: '',
    eventId: '',
    eventName: event?.name ?? '',
    eventSeries: event?.series ?? '',
    eventYear: event?.year ?? '',
    eventOrder: event?.order ?? Number.MAX_SAFE_INTEGER,
    roleGroup: '議程組',
    roleTitle: '組員',
    displayNameAtEvent: '',
    profileRef: '',
    profileKind: 'site',
    sourceUrl: 'https://sitcon.org/2026/',
    ...overrides,
  };
}

function siteProfilePerson(eventId, sourceId, displayName, extras = {}) {
  const key = `site:${eventId}/${sourceId}`;
  return person({
    key,
    profileKind: 'site',
    profileRef: `site:${sourceId}`,
    sourcePersonId: sourceId,
    displayName,
    claimToken: `${eventId}/site:${sourceId}`,
    eventIds: [eventId],
    ...extras,
  });
}

test('normalizeDisplayName folds whitespace, width and case', () => {
  assert.equal(normalizeDisplayName(' Ａ Ｂc '), 'abc');
  assert.equal(normalizeDisplayName(null), '');
});

test('roleWeight ranks leadership titles and 股長 above the crowd', () => {
  assert.equal(roleWeight('總召'), 3);
  assert.equal(roleWeight('總召集人'), 3);
  assert.equal(roleWeight('副召'), 2.4);
  assert.equal(roleWeight('組長'), 1.9);
  assert.equal(roleWeight('副組長'), 1.7);
  assert.equal(roleWeight('餐飲股長'), 1.4);
  assert.equal(roleWeight('組員'), 1);
  assert.equal(roleWeight(''), 1);
});

test('groupPeople merges site records that share a source person id', () => {
  const people = [
    siteProfilePerson('SITCON-2026', 'hash-a', '小明'),
    siteProfilePerson('SITCON-2022', 'hash-a', '不同暱稱'),
  ];
  const appearances = [
    appearance({ personKey: people[0].key, eventId: 'SITCON-2026' }),
    appearance({ personKey: people[1].key, eventId: 'SITCON-2022' }),
  ];

  const clusters = groupPeople(people, appearances, EVENTS);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].id, 'site:SITCON-2026/hash-a');
  assert.deepEqual(clusters[0].memberKeys, ['site:SITCON-2026/hash-a', 'site:SITCON-2022/hash-a']);
});

test('groupPeople merges same-name site records in adjacent event years', () => {
  const people = [
    siteProfilePerson('SITCON-2026', 'hash-a', '大助'),
    siteProfilePerson('SITCON-Camp-2025', 'hash-b', '大助'),
  ];
  const appearances = [
    appearance({ personKey: people[0].key, eventId: 'SITCON-2026' }),
    appearance({ personKey: people[1].key, eventId: 'SITCON-Camp-2025' }),
  ];

  const clusters = groupPeople(people, appearances, EVENTS);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].id, 'site:SITCON-2026/hash-a');
});

test('groupPeople keeps same-event same-name site records apart', () => {
  const people = [
    siteProfilePerson('SITCON-2026', 'hash-a', '大助'),
    siteProfilePerson('SITCON-2026', 'hash-b', '大助'),
  ];
  const appearances = [
    appearance({ personKey: people[0].key, eventId: 'SITCON-2026' }),
    appearance({ personKey: people[1].key, eventId: 'SITCON-2026' }),
  ];

  const clusters = groupPeople(people, appearances, EVENTS);
  assert.equal(clusters.length, 2);
});

test('groupPeople keeps same-name site records three years apart', () => {
  const people = [
    siteProfilePerson('SITCON-2025', 'hash-a', '大助'),
    siteProfilePerson('SITCON-2022', 'hash-b', '大助'),
  ];
  const appearances = [
    appearance({ personKey: people[0].key, eventId: 'SITCON-2025' }),
    appearance({ personKey: people[1].key, eventId: 'SITCON-2022' }),
  ];

  const clusters = groupPeople(people, appearances, EVENTS);
  assert.equal(clusters.length, 2);
});

test('groupPeople never merges a site record into a github or unlinked person', () => {
  const people = [
    person({
      key: 'github:alice',
      profileKind: 'github',
      profileRef: 'Alice',
      username: 'Alice',
      displayName: '大助',
      claimToken: 'Alice',
      eventIds: ['SITCON-2026'],
    }),
    siteProfilePerson('SITCON-2025', 'hash-a', '大助'),
    person({
      key: 'appearance:SITCON-2025/9',
      profileKind: 'appearance',
      displayName: '大助',
      eventIds: ['SITCON-2025'],
    }),
  ];
  const appearances = [
    appearance({ personKey: 'github:alice', eventId: 'SITCON-2026', profileKind: 'github' }),
    appearance({ personKey: 'site:SITCON-2025/hash-a', eventId: 'SITCON-2025' }),
    appearance({ personKey: 'appearance:SITCON-2025/9', eventId: 'SITCON-2025', profileKind: 'appearance' }),
  ];

  const clusters = groupPeople(people, appearances, EVENTS);
  assert.equal(clusters.length, 3);
  assert.deepEqual(
    clusters.map((cluster) => cluster.memberKeys.length),
    [1, 1, 1],
  );
});

function siteData(people, appearances) {
  return {
    sourceExportedAt: '2026-08-01T00:00:00.000Z',
    stats: { people: people.length, appearances: appearances.length, events: EVENTS.length },
    filters: { years: ['2026', '2025', '2022'], eventSeries: ['SITCON 年會', 'SITCON Camp'], roleGroups: ['議程組'] },
    events: EVENTS,
    appearances,
    people,
  };
}

test('buildBubbleData clamps sizeScore at 4 and grows it with event count', () => {
  const people = [
    person({
      key: 'github:chief',
      profileKind: 'github',
      profileRef: 'Chief',
      username: 'Chief',
      displayName: '總召大人',
      bio: '哈囉',
      links: [{ label: 'website', url: 'https://example.org/' }],
      claimToken: 'Chief',
      eventIds: ['SITCON-2026', 'SITCON-2025', 'SITCON-2022'],
    }),
    siteProfilePerson('SITCON-2022', 'hash-solo', '組員一號'),
  ];
  const appearances = [
    appearance({ personKey: 'github:chief', eventId: 'SITCON-2026', roleTitle: '總召', profileKind: 'github' }),
    appearance({ personKey: 'github:chief', eventId: 'SITCON-2025', roleTitle: '組長', profileKind: 'github' }),
    appearance({ personKey: 'github:chief', eventId: 'SITCON-2022', roleTitle: '組員', profileKind: 'github' }),
    appearance({ personKey: 'site:SITCON-2022/hash-solo', eventId: 'SITCON-2022' }),
  ];

  const data = buildBubbleData(siteData(people, appearances));
  const chief = data.nodes.find((node) => node.id === 'github:chief');
  const solo = data.nodes.find((node) => node.id === 'site:SITCON-2022/hash-solo');

  assert.equal(chief.sizeScore, 4);
  assert.equal(chief.topRole, '總召');
  assert.equal(chief.username, 'Chief');
  assert.equal(chief.bio, '哈囉');
  assert.deepEqual(chief.eventIds, ['SITCON-2026', 'SITCON-2025', 'SITCON-2022']);
  assert.deepEqual(chief.years, ['2026', '2025', '2022']);
  assert.deepEqual(chief.claimTokens, ['Chief']);
  assert.equal(solo.sizeScore, 1);
  assert.equal(solo.bio, '');
  assert.equal(data.stats.nodes, 2);
  assert.equal(data.appearances.length, 4);
  assert.equal(
    data.appearances.every((entry) => data.nodes.some((node) => node.id === entry.nodeId)),
    true,
  );
});

test('buildBubbleData marks the newest SITCON 年會 leaders as core', () => {
  const people = [
    siteProfilePerson('SITCON-2026', 'lead', '議程組長'),
    siteProfilePerson('SITCON-2026', 'crowd', '議程組員'),
    siteProfilePerson('SITCON-2025', 'oldlead', '前年組長'),
  ];
  const appearances = [
    appearance({ personKey: 'site:SITCON-2026/lead', eventId: 'SITCON-2026', roleTitle: '組長' }),
    appearance({ personKey: 'site:SITCON-2026/crowd', eventId: 'SITCON-2026', roleTitle: '組員' }),
    appearance({ personKey: 'site:SITCON-2025/oldlead', eventId: 'SITCON-2025', roleTitle: '組長' }),
  ];

  const data = buildBubbleData(siteData(people, appearances));
  assert.equal(data.stats.coreEventId, 'SITCON-2026');
  assert.deepEqual(
    data.nodes.filter((node) => node.core).map((node) => node.id),
    ['site:SITCON-2026/lead'],
  );
});

test('buildBubbleData falls back to the newest event when the core series is absent', () => {
  const events = [
    { id: 'CAMP-2026', order: 0, series: 'SITCON Camp', name: 'Camp 2026', year: '2026' },
    { id: 'CAMP-2025', order: 1, series: 'SITCON Camp', name: 'Camp 2025', year: '2025' },
  ];
  const people = [
    person({ key: 'site:CAMP-2026/a', profileKind: 'site', sourcePersonId: 'a', displayName: '隊長', eventIds: ['CAMP-2026'] }),
    person({ key: 'site:CAMP-2025/b', profileKind: 'site', sourcePersonId: 'b', displayName: '學員', eventIds: ['CAMP-2025'] }),
  ];
  const appearances = [
    {
      id: 'CAMP-2026:0',
      personKey: 'site:CAMP-2026/a',
      eventId: 'CAMP-2026',
      eventName: 'Camp 2026',
      eventSeries: 'SITCON Camp',
      eventYear: '2026',
      eventOrder: 0,
      roleGroup: '議程組',
      roleTitle: '副召',
      displayNameAtEvent: '隊長',
      sourceUrl: '',
    },
    {
      id: 'CAMP-2025:1',
      personKey: 'site:CAMP-2025/b',
      eventId: 'CAMP-2025',
      eventName: 'Camp 2025',
      eventSeries: 'SITCON Camp',
      eventYear: '2025',
      eventOrder: 1,
      roleGroup: '議程組',
      roleTitle: '組長',
      displayNameAtEvent: '學員',
      sourceUrl: '',
    },
  ];

  const data = buildBubbleData({ events, people, appearances, filters: { years: [], eventSeries: [], roleGroups: [] } });
  assert.equal(data.stats.coreEventId, 'CAMP-2026');
  assert.deepEqual(
    data.nodes.filter((node) => node.core).map((node) => node.id),
    ['site:CAMP-2026/a'],
  );
});

test('buildBubbleData keeps colors, atlas metadata and search text deterministic', () => {
  const people = [siteProfilePerson('SITCON-2026', 'hash-a', '小明')];
  const appearances = [appearance({ personKey: 'site:SITCON-2026/hash-a', eventId: 'SITCON-2026', displayNameAtEvent: '小明' })];

  const first = buildBubbleData(siteData(people, appearances));
  const second = buildBubbleData(siteData(people, appearances), { atlas: { size: 2048, crowdTile: 64, heroTile: 256, files: ['avatars-0.webp'] } });

  assert.equal(first.nodes[0].color, second.nodes[0].color);
  assert.match(first.nodes[0].color, /^#[0-9a-f]{6}$/);
  assert.equal(first.nodes[0].tile, null);
  assert.deepEqual(first.atlas.files, []);
  assert.deepEqual(second.atlas.files, ['avatars-0.webp']);
  assert.equal(first.nodes[0].search.includes('sitcon 2026'), true);
  assert.equal(first.nodes[0].search.includes('議程組'), true);
});
