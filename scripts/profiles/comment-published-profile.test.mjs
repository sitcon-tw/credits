import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractLinkedIssueNumber,
  formatProfilePublishedComment,
  isAssistantProfilePublishedComment,
  parseArgs,
} from './comment-published-profile.mjs';

test('parseArgs reads published profile comment options', () => {
  assert.deepEqual(parseArgs([
    '--owner', 'sitcon-tw',
    '--repo', 'credits-profiles',
    '--pull-number', '58',
    '--username', 'JadarTheObscurity',
    '--assistant-login', 'sitcon-credits',
  ]), {
    owner: 'sitcon-tw',
    repo: 'credits-profiles',
    pullNumber: '58',
    username: 'JadarTheObscurity',
    assistantLogin: 'sitcon-credits',
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
