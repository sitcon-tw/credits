import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSiteData } from './build.mjs';

function exportPayload() {
  return {
    exportedAt: '2026-06-04T00:00:00.000Z',
    sheets: {
      events: {
        rows: [
          {
            event_id: 'EVENT-B',
            event_series: 'Series',
            event_name_zh: 'Event B',
            event_name_en: '',
            event_year: '2026',
            official_site_url: 'https://example.test/b',
            staff_source_url: '',
            speaker_source_url: '',
          },
          {
            event_id: 'EVENT-A',
            event_series: 'Series',
            event_name_zh: 'Event A',
            event_name_en: '',
            event_year: '2025',
            official_site_url: 'https://example.test/a',
            staff_source_url: '',
            speaker_source_url: '',
          },
        ],
      },
      people: {
        rows: [
          {
            github_username: 'Alice',
            display_name: 'Alice Helper',
          },
        ],
      },
      appearances: {
        rows: [
          {
            event_id: 'EVENT-A',
            role_group_zh: '議程組',
            role_group_en: '',
            role_title_zh: '組員',
            role_title_en: '',
            display_name_at_event: 'Alice A',
            github_username: 'Alice',
            source_url_override: '',
          },
          {
            event_id: 'EVENT-B',
            role_group_zh: '網站組',
            role_group_en: '',
            role_title_zh: '組長',
            role_title_en: '',
            display_name_at_event: 'Alice B',
            github_username: 'alice',
            source_url_override: '',
          },
          {
            event_id: 'EVENT-B',
            role_group_zh: '紀錄組',
            role_group_en: '',
            role_title_zh: '組員',
            role_title_en: '',
            display_name_at_event: 'Site Person',
            github_username: 'site:source-1',
            source_url_override: '',
          },
          {
            event_id: 'EVENT-B',
            role_group_zh: '紀錄組',
            role_group_en: '',
            role_title_zh: '組員',
            role_title_en: '',
            display_name_at_event: 'Fallback Person',
            github_username: '',
            source_url_override: '',
          },
        ],
      },
    },
  };
}

test('buildSiteData aggregates all appearances into people by profile reference', () => {
  const data = buildSiteData(exportPayload(), {
    profiles: new Map([
      [
        'alice',
        {
          username: 'Alice',
          displayName: 'Alice Profile',
          bio: 'Bio',
          avatarUrl: 'https://example.test/alice.jpg',
          publicEmail: 'alice@example.test',
          links: [
            { type: 'github', url: 'https://github.com/alice' },
            { type: 'custom', label: 'Portfolio', url: 'https://example.test/alice' },
          ],
          form: {
            displayName: '',
            bio: 'Bio',
            avatarUrl: '',
            publicEmail: 'alice@example.test',
            links: [
              { type: 'github', url: 'https://github.com/alice' },
              { type: 'custom', label: 'Portfolio', url: 'https://example.test/alice' },
            ],
          },
        },
      ],
      [
        'unused',
        {
          username: 'unused',
          displayName: 'Unused Profile',
          bio: '',
          avatarUrl: '',
          publicEmail: '',
          links: [],
          form: {
            displayName: 'Unused Profile',
            bio: '',
            avatarUrl: '',
            publicEmail: '',
            links: [],
          },
        },
      ],
    ]),
    siteProfiles: new Map([
      [
        'EVENT-B/source-1',
        {
          displayName: 'Site Profile',
          avatarUrl: 'https://example.test/site.jpg',
        },
      ],
    ]),
  });

  assert.equal(data.appearances.length, 4);
  assert.equal(data.people.length, 3);
  assert.equal(data.stats.contributorProfiles, 1);
  assert.equal(data.stats.siteProfiles, 1);
  assert.equal(data.stats.fallbackProfiles, 1);

  const alice = data.people.find((person) => person.key === 'github:alice');
  assert.equal(alice.displayName, 'Alice Profile');
  assert.deepEqual(data.profileForms.alice, {
    displayName: '',
    bio: 'Bio',
    avatarUrl: '',
    publicEmail: 'alice@example.test',
    links: [
      { type: 'github', url: 'https://github.com/alice' },
      { type: 'custom', label: 'Portfolio', url: 'https://example.test/alice' },
    ],
  });
  assert.deepEqual(data.profileForms.unused, {
    displayName: 'Unused Profile',
    bio: '',
    avatarUrl: '',
    publicEmail: '',
    links: [],
  });
  assert.equal(alice.claimable, true);
  assert.equal(alice.claimToken, 'Alice');
  assert.equal(alice.appearanceCount, 2);
  assert.equal(alice.eventCount, 2);
  assert.equal(alice.primaryEventName, 'Event B');
  assert.equal(alice.summary, '2 筆 / 2 場活動');
  assert.equal(alice.canonicalOrder, 0);
  assert.deepEqual(alice.eventIds, ['EVENT-B', 'EVENT-A']);
  assert.deepEqual(alice.roleSummary, ['網站組', '議程組']);

  const sitePerson = data.people.find((person) => person.key === 'site:EVENT-B/source-1');
  assert.equal(sitePerson.displayName, 'Site Profile');
  assert.equal(sitePerson.claimable, true);
  assert.equal(sitePerson.claimToken, 'EVENT-B/site:source-1');
  assert.equal(sitePerson.appearanceCount, 1);
  assert.equal(sitePerson.eventCount, 1);
  assert.equal(sitePerson.primaryEventName, 'Event B');
  assert.equal(sitePerson.summary, '1 筆 / 1 場活動');

  const fallback = data.people.find((person) => person.key === 'appearance:EVENT-B/3');
  assert.equal(fallback.displayName, 'Fallback Person');
  assert.equal(fallback.claimable, false);
  assert.equal(fallback.claimToken, '');
  assert.equal(fallback.primaryEventName, 'Event B');

  assert.deepEqual(data.appearances.map((appearance) => appearance.eventId), [
    'EVENT-B',
    'EVENT-B',
    'EVENT-B',
    'EVENT-A',
  ]);
});
