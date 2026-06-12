import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatApplyPlan,
  parseArgs,
  validateConfirmedComment,
} from './apply-claims.mjs';

test('parseArgs reads apply claim options', () => {
  assert.deepEqual(parseArgs([
    '--owner', 'sitcon-tw',
    '--repo', 'credits-profiles',
    '--pull-number', '58',
    '--head-sha', 'abc123',
    '--export', 'tmp/export.json',
    '--confirmation-comment-id', '98765',
    '--check-run-id', '12345',
    '--plan-output', 'tmp/plan.json',
    '--config', 'custom.json',
    '--apply',
  ]), {
    owner: 'sitcon-tw',
    repo: 'credits-profiles',
    pullNumber: 58,
    headSha: 'abc123',
    exportPath: 'tmp/export.json',
    confirmationCommentId: '98765',
    checkRunId: '12345',
    planOutputPath: 'tmp/plan.json',
    configPath: 'custom.json',
    apply: true,
  });
});

test('parseArgs reads issue-mode apply claim options', () => {
  assert.deepEqual(parseArgs([
    '--owner', 'sitcon-tw',
    '--repo', 'credits-profiles',
    '--issue-number', '82',
    '--username', 'octocat',
    '--confirmation-comment-id', '98765',
    '--export', 'tmp/export.json',
  ]), {
    owner: 'sitcon-tw',
    repo: 'credits-profiles',
    issueNumber: 82,
    username: 'octocat',
    confirmationCommentId: '98765',
    exportPath: 'tmp/export.json',
    configPath: 'config/sheets.json',
    apply: false,
  });
});

test('validateConfirmedComment accepts matching issue-mode metadata', () => {
  assert.doesNotThrow(() => validateConfirmedComment({
    body: [
      '<!-- sitcon-credits-profile-claim-confirmation -->',
      '<!-- sitcon-credits-profile-claim: {"mode":"issue","issue_number":82,"plan_hash":"hash","username":"octocat"} -->',
      '- [x] 我已確認上述 1 筆歷史貢獻連結，請更新 SITCON Credits canonical Google Sheets。 <!-- sitcon-credits-profile-claim-apply -->',
    ].join('\n'),
  }, {
    issueNumber: 82,
    username: 'OctoCat',
  }, {
    planHash: 'hash',
  }));
});

test('validateConfirmedComment rejects stale plan hashes', () => {
  assert.throws(() => validateConfirmedComment({
    body: [
      '<!-- sitcon-credits-profile-claim-confirmation -->',
      '<!-- sitcon-credits-profile-claim: {"mode":"pull_request","pull_number":58,"head_sha":"abc123","plan_hash":"old","username":"octocat"} -->',
      '- [x] 我已確認上述 1 筆歷史貢獻連結，請更新 SITCON Credits canonical Google Sheets。 <!-- sitcon-credits-profile-claim-apply -->',
    ].join('\n'),
  }, {
    pullNumber: 58,
    headSha: 'abc123',
  }, {
    planHash: 'new',
  }), /plan hash/);
});

test('formatApplyPlan summarizes row updates', () => {
  assert.equal(formatApplyPlan({
    username: 'octocat',
    updates: [
      {
        rowNumber: 7,
        eventId: 'SITCON-2024',
        displayNameAtEvent: 'Octo',
        currentValue: 'site:source-1',
        nextValue: 'octocat',
      },
    ],
  }), [
    'Profile username: octocat',
    'Updates: 1',
    '- appearances row 7 | SITCON-2024 | Octo | site:source-1 -> octocat',
  ].join('\n'));
});
