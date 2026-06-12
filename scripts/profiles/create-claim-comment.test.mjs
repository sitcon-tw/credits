import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assistantCommentLogins,
  formatSkippedClaimPlan,
  hasConfirmedClaimComment,
  isApplyCheckboxChecked,
  isAssistantClaimComment,
  parseArgs,
  parseClaimMetadata,
} from './create-claim-comment.mjs';

const claimBody = '<!-- sitcon-credits-profile-claim-confirmation -->\nbody';

function confirmedClaimBody({ checked = true, pullNumber = 58, headSha = 'abc123' } = {}) {
  return [
    '<!-- sitcon-credits-profile-claim-confirmation -->',
    `<!-- sitcon-credits-profile-claim: {"pull_number":${pullNumber},"head_sha":"${headSha}","plan_hash":"hash","username":"octocat"} -->`,
    `${checked ? '- [x]' : '- [ ]'} 我已確認上述 1 筆歷史貢獻連結，請更新 SITCON Credits canonical Google Sheets。 <!-- sitcon-credits-profile-claim-apply -->`,
  ].join('\n');
}

test('parseArgs reads claim comment options', () => {
  assert.deepEqual(parseArgs([
    '--owner', 'sitcon-tw',
    '--repo', 'credits-profiles',
    '--pull-number', '58',
    '--head-sha', 'abc123',
    '--export', 'tmp/export.json',
    '--assistant-login', 'sitcon-credits',
    '--plan-output', 'tmp/claim-plan.json',
  ]), {
    owner: 'sitcon-tw',
    repo: 'credits-profiles',
    pullNumber: 58,
    headSha: 'abc123',
    exportPath: 'tmp/export.json',
    assistantLogin: 'sitcon-credits',
    planOutputPath: 'tmp/claim-plan.json',
  });
});

test('formatSkippedClaimPlan writes a non-blocking stale PR claim plan', () => {
  assert.deepEqual(formatSkippedClaimPlan({
    reason: 'stale-pr-head',
    pullRequest: {
      state: 'open',
      head: { sha: 'new-head' },
    },
  }), {
    status: 'not_applicable',
    reason: 'stale-pr-head',
    username: '',
    updates: [],
    pullRequestState: 'open',
    pullRequestHeadSha: 'new-head',
  });
});

test('formatSkippedClaimPlan writes a non-blocking closed PR claim plan', () => {
  assert.deepEqual(formatSkippedClaimPlan({
    reason: 'pull-request-not-open',
    pullRequest: {
      state: 'closed',
      head: { sha: 'old-head' },
    },
  }), {
    status: 'not_applicable',
    reason: 'pull-request-not-open',
    username: '',
    updates: [],
    pullRequestState: 'closed',
    pullRequestHeadSha: 'old-head',
  });
});

test('isAssistantClaimComment ignores user-authored marker comments', () => {
  assert.equal(isAssistantClaimComment({
    user: { login: 'denny0223' },
    body: claimBody,
  }), false);
});

test('isAssistantClaimComment accepts assistant login variants', () => {
  assert.equal(isAssistantClaimComment({
    user: { login: 'sitcon-credits[bot]' },
    body: claimBody,
  }), true);
  assert.equal(isAssistantClaimComment({
    user: { login: 'configured-app[bot]' },
    body: claimBody,
  }, 'configured-app'), true);
});

test('assistantCommentLogins includes app slug and bot suffix forms', () => {
  const logins = assistantCommentLogins('sitcon-credits');
  assert.equal(logins.has('sitcon-credits'), true);
  assert.equal(logins.has('sitcon-credits[bot]'), true);
  assert.equal(logins.has('app/sitcon-credits'), true);
});

test('isApplyCheckboxChecked detects checked claim confirmation item', () => {
  assert.equal(isApplyCheckboxChecked(confirmedClaimBody({ checked: true })), true);
  assert.equal(isApplyCheckboxChecked(confirmedClaimBody({ checked: false })), false);
});

test('parseClaimMetadata reads claim comment metadata', () => {
  assert.deepEqual(parseClaimMetadata(confirmedClaimBody()), {
    mode: 'pull_request',
    pull_number: 58,
    issue_number: undefined,
    head_sha: 'abc123',
    plan_hash: 'hash',
    username: 'octocat',
  });
});

test('hasConfirmedClaimComment requires assistant author, checked box, and matching head', () => {
  const options = {
    assistantLogin: 'sitcon-credits',
    pullNumber: 58,
    headSha: 'abc123',
  };

  assert.equal(hasConfirmedClaimComment([
    {
      user: { login: 'sitcon-credits[bot]' },
      body: confirmedClaimBody(),
    },
  ], options), true);
  assert.equal(hasConfirmedClaimComment([
    {
      user: { login: 'sitcon-credits[bot]' },
      body: confirmedClaimBody({ checked: false }),
    },
  ], options), false);
  assert.equal(hasConfirmedClaimComment([
    {
      user: { login: 'denny0223' },
      body: confirmedClaimBody(),
    },
  ], options), false);
  assert.equal(hasConfirmedClaimComment([
    {
      user: { login: 'sitcon-credits[bot]' },
      body: confirmedClaimBody({ headSha: 'old-head' }),
    },
  ], options), false);
});
