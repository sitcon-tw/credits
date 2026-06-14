import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildProfileClaimPlan,
  buildProfileClaimPlanFromIssue,
  buildProfileClaimPlanFromText,
  buildSheetValueUpdates,
  collectChangedProfileUsernames,
  extractClaimUrls,
  formatClaimCommentBody,
  formatClaimCheckOutput,
  parseClaimTokensFromUrl,
} from './claim-confirmation.mjs';

function pullRequest(body, headSha = 'head-sha') {
  return {
    number: 58,
    body,
    head: { sha: headSha },
  };
}

function profileFile(username) {
  return { filename: `profiles/${username}.json`, status: 'added' };
}

function exportPayload() {
  return {
    sheets: {
      events: {
        rows: [
          { event_id: 'SITCON-2022', event_name_zh: 'SITCON 2022' },
          { event_id: 'SITCON-2024', event_name_zh: 'SITCON 2024' },
        ],
      },
      appearances: {
        rows: [
          {
            _row: 2,
            event_id: 'SITCON-2022',
            display_name_at_event: 'Jadar',
            role_group_zh: '議程',
            role_title_zh: '講者',
            github_username: 'site:fd7f60e68311eea3de7c840fd1f53b0a',
          },
          {
            _row: 3,
            event_id: 'SITCON-2024',
            display_name_at_event: 'Jadar',
            role_group_zh: '議程',
            role_title_zh: '講者',
            github_username: 'site:07b366482de4213eee9ec3e3d42c6c347c83eb3d726318b1e35eaa486d33b966',
          },
        ],
      },
    },
  };
}

test('parseClaimTokensFromUrl accepts site claim tokens', () => {
  const tokens = parseClaimTokensFromUrl(
    'https://sitcon.org/credits/?claim=1&claims=SITCON-2022%2Fsite%3Afd7f60e68311eea3de7c840fd1f53b0a',
  );

  assert.deepEqual(tokens, [
    {
      raw: 'SITCON-2022/site:fd7f60e68311eea3de7c840fd1f53b0a',
      eventId: 'SITCON-2022',
      profileRef: 'site:fd7f60e68311eea3de7c840fd1f53b0a',
    },
  ]);
});

test('extractClaimUrls ignores non-claim links', () => {
  assert.deepEqual(extractClaimUrls([
    'See https://example.com/',
    'https://sitcon.org/credits/?claim=1&claims=EVENT%2Fsite%3Asource-1',
  ].join('\n')), [
    'https://sitcon.org/credits/?claim=1&claims=EVENT%2Fsite%3Asource-1',
  ]);
});

test('collectChangedProfileUsernames reads GitHub pull file shapes', () => {
  assert.deepEqual(collectChangedProfileUsernames([
    profileFile('JadarTheObscurity'),
    { path: 'profiles/other.json', changeType: 'removed' },
  ]), ['JadarTheObscurity']);
});

test('buildProfileClaimPlan creates updates for matching site refs', () => {
  const plan = buildProfileClaimPlan({
    pullRequest: pullRequest('https://sitcon.org/credits/?claim=1&claims=SITCON-2022%2Fsite%3Afd7f60e68311eea3de7c840fd1f53b0a%2CSITCON-2024%2Fsite%3A07b366482de4213eee9ec3e3d42c6c347c83eb3d726318b1e35eaa486d33b966'),
    files: [profileFile('JadarTheObscurity')],
    exportPayload: exportPayload(),
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.username, 'JadarTheObscurity');
  assert.equal(plan.updates.length, 2);
  assert.deepEqual(plan.updates.map((update) => update.rowNumber), [2, 3]);
  assert(plan.planHash);
});

test('buildProfileClaimPlanFromIssue creates claim-only updates from issue body', () => {
  const plan = buildProfileClaimPlanFromIssue({
    issue: {
      number: 82,
      body: 'https://sitcon.org/credits/?claim=1&claims=SITCON-2022%2Fsite%3Afd7f60e68311eea3de7c840fd1f53b0a%2CJadarTheObscurity',
    },
    username: 'JadarTheObscurity',
    exportPayload: exportPayload(),
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.username, 'JadarTheObscurity');
  assert.deepEqual(plan.updates.map((update) => update.rowNumber), [2]);
  assert.equal(plan.tokens.length, 1);
  assert.equal(plan.tokens[0].raw, 'SITCON-2022/site:fd7f60e68311eea3de7c840fd1f53b0a');
  assert(plan.planHash);
});

test('buildProfileClaimPlanFromText rejects invalid explicit usernames', () => {
  const plan = buildProfileClaimPlanFromText({
    username: '-bad',
    text: 'https://sitcon.org/credits/?claim=1&claims=SITCON-2022%2Fsite%3Afd7f60e68311eea3de7c840fd1f53b0a',
    exportPayload: exportPayload(),
  });

  assert.equal(plan.status, 'not_applicable');
  assert.equal(plan.reason, 'invalid-profile-username');
});

test('buildProfileClaimPlan still creates updates when username already appears elsewhere', () => {
  const payload = exportPayload();
  payload.sheets.appearances.rows.push({
    _row: 4,
    event_id: 'SITCON-2024',
    display_name_at_event: 'Jadar',
    role_group_zh: '議程',
    role_title_zh: '講者',
    github_username: 'JadarTheObscurity',
  });

  const plan = buildProfileClaimPlan({
    pullRequest: pullRequest('https://sitcon.org/credits/?claim=1&claims=SITCON-2022%2Fsite%3Afd7f60e68311eea3de7c840fd1f53b0a'),
    files: [profileFile('JadarTheObscurity')],
    exportPayload: payload,
  });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.updates.map((update) => update.rowNumber), [2]);
});

test('buildProfileClaimPlan does not block when claim updates are already applied', () => {
  const payload = exportPayload();
  payload.sheets.appearances.rows[0].github_username = 'JadarTheObscurity';

  const plan = buildProfileClaimPlan({
    pullRequest: pullRequest('https://sitcon.org/credits/?claim=1&claims=SITCON-2022%2Fsite%3Afd7f60e68311eea3de7c840fd1f53b0a'),
    files: [profileFile('JadarTheObscurity')],
    exportPayload: payload,
  });

  assert.equal(plan.status, 'not_applicable');
  assert.equal(plan.reason, 'claim-updates-already-applied');
});

test('buildProfileClaimPlan blocks claims that match neither site ref nor target username', () => {
  const payload = exportPayload();
  payload.sheets.appearances.rows[0].github_username = 'someoneElse';

  const plan = buildProfileClaimPlan({
    pullRequest: pullRequest('https://sitcon.org/credits/?claim=1&claims=SITCON-2022%2Fsite%3Afd7f60e68311eea3de7c840fd1f53b0a'),
    files: [profileFile('JadarTheObscurity')],
    exportPayload: payload,
  });

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.reason, 'claim-token-mismatch');
});

test('buildProfileClaimPlan updates every row for a repeated event site ref', () => {
  const payload = exportPayload();
  payload.sheets.appearances.rows.push({
    _row: 4,
    event_id: 'SITCON-2022',
    display_name_at_event: 'Jadar',
    role_group_zh: '行政組',
    role_title_zh: '組員',
    github_username: 'site:fd7f60e68311eea3de7c840fd1f53b0a',
  });

  const plan = buildProfileClaimPlan({
    pullRequest: pullRequest('https://sitcon.org/credits/?claim=1&claims=SITCON-2022%2Fsite%3Afd7f60e68311eea3de7c840fd1f53b0a'),
    files: [profileFile('JadarTheObscurity')],
    exportPayload: payload,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.reason, 'ready');
  assert.deepEqual(plan.updates.map((update) => update.rowNumber), [2, 4]);
});

test('buildProfileClaimPlan blocks when a token no longer matches exactly', () => {
  const plan = buildProfileClaimPlan({
    pullRequest: pullRequest('https://sitcon.org/credits/?claim=1&claims=SITCON-2022%2Fsite%3Amissing'),
    files: [profileFile('JadarTheObscurity')],
    exportPayload: exportPayload(),
  });

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.reason, 'claim-token-mismatch');
  assert.match(plan.issues[0].message, /找不到/);
});

test('buildSheetValueUpdates targets appearances github_username cells', () => {
  const config = {
    sheets: [
      {
        title: 'appearances',
        columns: [
          { name: 'event_id' },
          { name: 'display_name_at_event' },
          { name: 'github_username' },
        ],
      },
    ],
  };
  const plan = {
    updates: [
      { rowNumber: 5, nextValue: 'octocat' },
    ],
  };

  assert.deepEqual(buildSheetValueUpdates(config, plan), [
    { range: "'appearances'!C5", values: [['octocat']] },
  ]);
});

test('formatClaimCheckOutput includes an action-oriented summary', () => {
  const output = formatClaimCheckOutput({
    status: 'ready',
    username: 'octocat',
    updates: [
      {
        rowNumber: 2,
        eventName: 'SITCON 2024',
        displayNameAtEvent: 'Octo',
        currentValue: 'site:source-1',
        nextValue: 'octocat',
      },
    ],
  });

  assert.equal(output.conclusion, 'action_required');
  assert.match(output.summary, /更新 Sheet/);
  assert.match(output.summary, /site:source-1/);
});

test('formatClaimCommentBody includes maintainer checkbox and metadata', () => {
  const body = formatClaimCommentBody({
    status: 'ready',
    username: 'octocat',
    planHash: 'plan-hash',
    updates: [
      {
        rowNumber: 2,
        eventName: 'SITCON 2024',
        displayNameAtEvent: 'Octo',
        currentValue: 'site:source-1',
        nextValue: 'octocat',
      },
    ],
  }, {
    pullNumber: 58,
    headSha: 'head-sha',
  });

  assert.match(body, /sitcon-credits-profile-claim-confirmation/);
  assert.match(body, /"pull_number":58/);
  assert.match(body, /"head_sha":"head-sha"/);
  assert.match(body, /- \[ \] 我已確認上述 1 筆歷史貢獻連結/);
  assert.match(body, /sitcon-credits-profile-claim-apply/);
});

test('formatClaimCommentBody supports issue-mode metadata', () => {
  const body = formatClaimCommentBody({
    status: 'ready',
    username: 'octocat',
    planHash: 'plan-hash',
    updates: [
      {
        rowNumber: 2,
        eventName: 'SITCON 2024',
        displayNameAtEvent: 'Octo',
        currentValue: 'site:source-1',
        nextValue: 'octocat',
      },
    ],
  }, {
    mode: 'issue',
    issueNumber: 82,
  });

  assert.match(body, /"mode":"issue"/);
  assert.match(body, /"issue_number":82/);
  assert.doesNotMatch(body, /"pull_number"/);
  assert.doesNotMatch(body, /"head_sha"/);
});
