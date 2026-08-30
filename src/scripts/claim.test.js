import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ISSUE_FORM_AVATAR_URL_FIELD,
  ISSUE_FORM_BIO_FIELD,
  ISSUE_FORM_CUSTOM_LINK_LABEL_FIELD,
  ISSUE_FORM_CUSTOM_LINK_URL_FIELD,
  ISSUE_FORM_DISPLAY_NAME_FIELD,
  ISSUE_FORM_HINTS_FIELD,
  ISSUE_FORM_PUBLIC_EMAIL_FIELD,
  claimSearch,
  claimShareUrl,
  claimTokensFromSearch,
  githubUsernameFromClaimUrl,
  isClaimMode,
  isClaimUrlTooLong,
  profileRequestIssueUrl,
} from './claim.js';

test('claimSearch enables claim mode and round trips tokens', () => {
  const search = claimSearch(['EVENT-B/site:source-1', 'Alice'], '?q=alice');

  assert.equal(search, '?q=alice&claim=1&claims=Alice%2CEVENT-B%2Fsite%3Asource-1');
  assert.equal(isClaimMode(search), true);
  assert.deepEqual(claimTokensFromSearch(search), ['Alice', 'EVENT-B/site:source-1']);
});

test('claimShareUrl writes claim tokens into the query and preserves hash deep links', () => {
  const url = claimShareUrl({
    pathname: '/credits/',
    search: '?q=alice',
    hash: '#person=Alice',
  }, ['Alice']);

  assert.equal(url, '/credits/?q=alice&claim=1&claims=Alice#person=Alice');
});

test('profileRequestIssueUrl pre-fills the historical hints field with a claim URL', () => {
  const claimUrl = 'https://example.test/credits/?claim=1&claims=Alice';
  const url = new URL(profileRequestIssueUrl(claimUrl));

  assert.equal(url.searchParams.get('template'), 'profile-request.yml');
  assert.equal(url.searchParams.get(ISSUE_FORM_HINTS_FIELD), claimUrl);
  assert.equal(isClaimUrlTooLong(claimUrl), false);
});

test('profileRequestIssueUrl pre-fills existing profile data for a single claim username', () => {
  const claimUrl = 'https://sitcon.org/credits/?claim=1&claims=SITCON-2017%2Fsite%3A8df2bcdc-312a-5a03-bca2-e34229513395%2Csciuridae0603';
  const url = new URL(profileRequestIssueUrl(claimUrl, {
    profileForms: {
      sciuridae0603: {
        displayName: '小松鼠',
        bio: '公開簡介',
        avatarUrl: '',
        publicEmail: 'public@example.com',
        links: [
          { type: 'github', url: 'https://github.com/existing-public-link' },
          { type: 'custom', label: '作品集', url: 'https://example.test' },
        ],
      },
    },
  }));

  assert.equal(url.searchParams.get(ISSUE_FORM_HINTS_FIELD), claimUrl);
  assert.equal(url.searchParams.get(ISSUE_FORM_DISPLAY_NAME_FIELD), '小松鼠');
  assert.equal(url.searchParams.get(ISSUE_FORM_BIO_FIELD), '公開簡介');
  assert.equal(url.searchParams.has(ISSUE_FORM_AVATAR_URL_FIELD), false);
  assert.equal(url.searchParams.get(ISSUE_FORM_PUBLIC_EMAIL_FIELD), 'public@example.com');
  assert.equal(url.searchParams.get('link_github'), 'https://github.com/existing-public-link');
  assert.equal(url.searchParams.get(ISSUE_FORM_CUSTOM_LINK_LABEL_FIELD), '作品集');
  assert.equal(url.searchParams.get(ISSUE_FORM_CUSTOM_LINK_URL_FIELD), 'https://example.test');
  assert.equal(githubUsernameFromClaimUrl(claimUrl), 'sciuridae0603');
});

test('profileRequestIssueUrl does not infer profile fields without exactly one existing profile', () => {
  const missingProfileUrl = new URL(profileRequestIssueUrl(
    'https://sitcon.org/credits/?claim=1&claims=sciuridae0603',
    { profileForms: {} },
  ));
  assert.equal(missingProfileUrl.searchParams.get(ISSUE_FORM_HINTS_FIELD), 'https://sitcon.org/credits/?claim=1&claims=sciuridae0603');
  assert.equal(missingProfileUrl.searchParams.has('link_github'), false);

  const multiUsernameUrl = new URL(profileRequestIssueUrl(
    'https://sitcon.org/credits/?claim=1&claims=alice%2Cbob',
    {
      profileForms: {
        alice: { displayName: 'Alice', links: [{ type: 'github', url: 'https://github.com/alice' }] },
      },
    },
  ));
  assert.equal(multiUsernameUrl.searchParams.has(ISSUE_FORM_DISPLAY_NAME_FIELD), false);
  assert.equal(multiUsernameUrl.searchParams.has('link_github'), false);
  assert.equal(githubUsernameFromClaimUrl('https://sitcon.org/credits/?claim=1&claims=alice%2Cbob'), '');
});
