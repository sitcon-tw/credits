import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hasConfirmedIssueClaimComment,
  isAssistantIssueClaimComment,
  parseArgs,
  validateIssue,
} from './create-claim-issue-comment.mjs';

function confirmedIssueClaimBody({ checked = true, issueNumber = 82, username = 'octocat' } = {}) {
  return [
    '<!-- sitcon-credits-profile-claim-confirmation -->',
    `<!-- sitcon-credits-profile-claim: {"mode":"issue","issue_number":${issueNumber},"plan_hash":"hash","username":"${username}"} -->`,
    `${checked ? '- [x]' : '- [ ]'} 我已確認上述 1 筆歷史貢獻連結，請更新 SITCON Credits canonical Google Sheets。 <!-- sitcon-credits-profile-claim-apply -->`,
  ].join('\n');
}

test('parseArgs reads issue claim comment options', () => {
  assert.deepEqual(parseArgs([
    '--owner', 'sitcon-tw',
    '--repo', 'credits-profiles',
    '--issue-number', '82',
    '--username', 'octocat',
    '--export', 'tmp/export.json',
    '--assistant-login', 'sitcon-credits',
    '--plan-output', 'tmp/claim-plan.json',
  ]), {
    owner: 'sitcon-tw',
    repo: 'credits-profiles',
    issueNumber: 82,
    username: 'octocat',
    exportPath: 'tmp/export.json',
    assistantLogin: 'sitcon-credits',
    planOutputPath: 'tmp/claim-plan.json',
  });
});

test('validateIssue accepts open profile request from the requested username', () => {
  assert.equal(validateIssue({
    username: 'OctoCat',
  }, {
    state: 'open',
    user: { login: 'octocat' },
    labels: [{ name: 'profile-request' }],
  }), null);
});

test('validateIssue skips invalid issue contexts without throwing', () => {
  assert.equal(validateIssue({ username: 'octocat' }, {
    pull_request: {},
    state: 'open',
    user: { login: 'octocat' },
    labels: [{ name: 'profile-request' }],
  }).reason, 'issue-is-pull-request');

  assert.equal(validateIssue({ username: 'octocat' }, {
    state: 'closed',
    user: { login: 'octocat' },
    labels: [{ name: 'profile-request' }],
  }).reason, 'issue-not-open');

  assert.equal(validateIssue({ username: 'octocat' }, {
    state: 'open',
    user: { login: 'octocat' },
    labels: [],
  }).reason, 'missing-profile-request-label');

  assert.equal(validateIssue({ username: 'octocat' }, {
    state: 'open',
    user: { login: 'someone-else' },
    labels: [{ name: 'profile-request' }],
  }).reason, 'issue-author-username-mismatch');
});

test('isAssistantIssueClaimComment requires assistant-authored issue mode metadata', () => {
  assert.equal(isAssistantIssueClaimComment({
    user: { login: 'sitcon-credits[bot]' },
    body: confirmedIssueClaimBody(),
  }, 'sitcon-credits'), true);

  assert.equal(isAssistantIssueClaimComment({
    user: { login: 'denny0223' },
    body: confirmedIssueClaimBody(),
  }, 'sitcon-credits'), false);

  assert.equal(isAssistantIssueClaimComment({
    user: { login: 'sitcon-credits[bot]' },
    body: '<!-- sitcon-credits-profile-claim-confirmation -->\n<!-- sitcon-credits-profile-claim: {"mode":"pull_request","pull_number":58,"head_sha":"abc"} -->',
  }, 'sitcon-credits'), false);
});

test('hasConfirmedIssueClaimComment requires checked box and matching issue metadata', () => {
  const options = {
    assistantLogin: 'sitcon-credits',
    issueNumber: 82,
    username: 'octocat',
  };

  assert.equal(hasConfirmedIssueClaimComment([
    {
      user: { login: 'sitcon-credits[bot]' },
      body: confirmedIssueClaimBody(),
    },
  ], options), true);

  assert.equal(hasConfirmedIssueClaimComment([
    {
      user: { login: 'sitcon-credits[bot]' },
      body: confirmedIssueClaimBody({ checked: false }),
    },
  ], options), false);

  assert.equal(hasConfirmedIssueClaimComment([
    {
      user: { login: 'sitcon-credits[bot]' },
      body: confirmedIssueClaimBody({ issueNumber: 83 }),
    },
  ], options), false);

  assert.equal(hasConfirmedIssueClaimComment([
    {
      user: { login: 'sitcon-credits[bot]' },
      body: confirmedIssueClaimBody({ username: 'someone-else' }),
    },
  ], options), false);
});
