import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractLinkedIssueNumber,
  formatProfilePublishedComment,
  isAssistantProfilePublishedComment,
  parseArgs,
  profileUsernameFromFiles,
  sweepOpenProfileRequestIssues,
} from './comment-published-profile.mjs';

test('parseArgs reads published profile comment options', () => {
  assert.deepEqual(parseArgs([
    '--owner', 'sitcon-tw',
    '--repo', 'credits-profiles',
    '--pull-number', '58',
    '--issue-number', '82',
    '--username', 'JadarTheObscurity',
    '--assistant-login', 'sitcon-credits',
    '--sweep-open-profile-requests',
    '--sweep-limit', '25',
  ]), {
    owner: 'sitcon-tw',
    repo: 'credits-profiles',
    pullNumber: '58',
    issueNumber: '82',
    username: 'JadarTheObscurity',
    assistantLogin: 'sitcon-credits',
    sweepOpenProfileRequests: true,
    sweepLimit: 25,
  });
});

test('formatProfilePublishedComment points to the deployed Credits profile anchor', () => {
  const comment = formatProfilePublishedComment('JadarTheObscurity');

  assert.match(comment, /sitcon-credits-profile-published/);
  assert.match(comment, /已合併並部署/);
  assert.match(comment, /https:\/\/sitcon\.org\/credits\/#person=JadarTheObscurity/);
});

test('extractLinkedIssueNumber reads closing and reference keywords from PR body', () => {
  assert.equal(extractLinkedIssueNumber('Closes #69'), 69);
  assert.equal(extractLinkedIssueNumber('fixes #70'), 70);
  assert.equal(extractLinkedIssueNumber('Refs #71'), 71);
  assert.equal(extractLinkedIssueNumber('No linked issue'), null);
});

test('profileUsernameFromFiles requires exactly one changed profile file', () => {
  assert.equal(profileUsernameFromFiles([
    { filename: 'profiles/alice.json', status: 'added' },
    { filename: 'README.md', status: 'modified' },
  ]), 'alice');
  assert.equal(profileUsernameFromFiles([
    { filename: 'profiles/alice.json', status: 'added' },
    { filename: 'profiles/bob.json', status: 'added' },
  ]), '');
  assert.equal(profileUsernameFromFiles([
    { filename: 'profiles/alice.json', status: 'removed' },
  ]), '');
});

test('sweepOpenProfileRequestIssues comments and closes open issues linked to merged profile PRs', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(url);
    calls.push({ method: options.method, path: requestUrl.pathname, search: requestUrl.search, body: options.body });
    const route = `${options.method} ${requestUrl.pathname}${requestUrl.search}`;
    if (route === 'GET /repos/sitcon-tw/credits-profiles/issues?state=open&labels=profile-request&sort=updated&direction=desc&per_page=10') {
      return jsonResponse([
        { number: 82, state: 'open', labels: [{ name: 'profile-request' }] },
        { number: 83, state: 'open', labels: [{ name: 'profile-request' }] },
      ]);
    }
    if (route === 'GET /search/issues?q=repo%3Asitcon-tw%2Fcredits-profiles%20is%3Apr%20is%3Amerged%20%22%2382%22&per_page=10') {
      return jsonResponse({
        items: [{ number: 58, state: 'closed', pull_request: { url: 'https://api.github.com/repos/sitcon-tw/credits-profiles/pulls/58' } }],
      });
    }
    if (route === 'GET /search/issues?q=repo%3Asitcon-tw%2Fcredits-profiles%20is%3Apr%20is%3Amerged%20%22%2383%22&per_page=10') {
      return jsonResponse({ items: [] });
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/pulls/58') {
      return jsonResponse({ number: 58, merged_at: '2026-06-13T02:24:30Z', body: 'Refs #82' });
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/pulls/58/files?per_page=100') {
      return jsonResponse([{ filename: 'profiles/alice.json', status: 'added' }]);
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/issues/58/comments?per_page=100') {
      return jsonResponse([]);
    }
    if (route === 'POST /repos/sitcon-tw/credits-profiles/issues/58/comments') {
      return jsonResponse({ id: 1 });
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/issues/82') {
      return jsonResponse({ number: 82, state: 'open', labels: [{ name: 'profile-request' }] });
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/issues/82/comments?per_page=100') {
      return jsonResponse([]);
    }
    if (route === 'POST /repos/sitcon-tw/credits-profiles/issues/82/comments') {
      return jsonResponse({ id: 2 });
    }
    if (route === 'PATCH /repos/sitcon-tw/credits-profiles/issues/82') {
      return jsonResponse({ number: 82, state: 'closed' });
    }
    throw new Error(`Unexpected request: ${route}`);
  };

  try {
    const count = await sweepOpenProfileRequestIssues('token', {
      owner: 'sitcon-tw',
      repo: 'credits-profiles',
      assistantLogin: 'sitcon-credits',
      sweepLimit: 10,
    });

    assert.equal(count, 1);
    assert.equal(calls.some((call) => call.method === 'POST' && call.path === '/repos/sitcon-tw/credits-profiles/issues/82/comments'), true);
    assert.equal(calls.some((call) => call.method === 'PATCH' && call.path === '/repos/sitcon-tw/credits-profiles/issues/82'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('isAssistantProfilePublishedComment ignores user marker comments', () => {
  const body = formatProfilePublishedComment('octocat');

  assert.equal(isAssistantProfilePublishedComment({
    user: { login: 'denny0223' },
    body,
  }, 'sitcon-credits'), false);
  assert.equal(isAssistantProfilePublishedComment({
    user: { login: 'sitcon-credits[bot]' },
    body,
  }, 'sitcon-credits'), true);
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
