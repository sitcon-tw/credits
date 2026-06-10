import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  claimCheckExternalId,
  extractLinkedIssueNumber,
  parseArgs,
} from './create-claim-check.mjs';

test('parseArgs reads claim check options', () => {
  assert.deepEqual(parseArgs([
    '--owner', 'sitcon-tw',
    '--repo', 'credits-profiles',
    '--pull-number', '58',
    '--head-sha', 'abc123',
    '--export', 'tmp/export.json',
    '--workflow-url', 'https://github.com/sitcon-tw/credits/actions/workflows/apply-profile-claims.yml',
  ]), {
    owner: 'sitcon-tw',
    repo: 'credits-profiles',
    pullNumber: 58,
    headSha: 'abc123',
    exportPath: 'tmp/export.json',
    workflowUrl: 'https://github.com/sitcon-tw/credits/actions/workflows/apply-profile-claims.yml',
  });
});

test('claimCheckExternalId includes pull number, head SHA, and plan hash', () => {
  assert.equal(claimCheckExternalId(58, 'abc123', 'hash'), 'profile-claims:58:abc123:hash');
});

test('extractLinkedIssueNumber reads closing and reference keywords', () => {
  assert.equal(extractLinkedIssueNumber('Closes #57'), 57);
  assert.equal(extractLinkedIssueNumber('Refs #58'), 58);
  assert.equal(extractLinkedIssueNumber('No issue'), null);
});
