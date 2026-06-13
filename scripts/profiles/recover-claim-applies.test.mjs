import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildProfileClaimPlan,
  formatClaimCommentBody,
} from './claim-confirmation.mjs';
import {
  parseArgs,
  recoverProfileClaimApplies,
} from './recover-claim-applies.mjs';

const claimUrl = 'https://sitcon.org/credits/?claim=1&claims=SITCON-Camp-2026%2Fsite%3Aabc123';

test('parseArgs reads claim recovery options', () => {
  const parsed = parseArgs([
    '--owner', 'sitcon-tw',
    '--repo', 'credits-profiles',
    '--target-owner', 'sitcon-tw',
    '--target-repo', 'credits',
    '--export', 'tmp/export.json',
    '--assistant-login', 'sitcon-credits',
    '--since-hours', '12',
    '--limit', '25',
    '--exclude-comment-id', '123',
    '--config', 'custom.json',
    '--apply',
  ]);

  assert.equal(parsed.owner, 'sitcon-tw');
  assert.equal(parsed.repo, 'credits-profiles');
  assert.equal(parsed.targetOwner, 'sitcon-tw');
  assert.equal(parsed.targetRepo, 'credits');
  assert.equal(parsed.exportPath, 'tmp/export.json');
  assert.equal(parsed.assistantLogin, 'sitcon-credits');
  assert.equal(parsed.sinceHours, 12);
  assert.equal(parsed.limit, 25);
  assert.deepEqual([...parsed.excludeCommentIds], ['123']);
  assert.equal(parsed.configPath, 'custom.json');
  assert.equal(parsed.apply, true);
});

test('recoverProfileClaimApplies dry-runs checked comments that still need apply', async () => {
  const exportPayload = exportWithGithubUsername('site:abc123');
  const body = claimCommentBody({
    pullNumber: 58,
    headSha: 'abc123',
    username: 'octocat',
    exportPayload,
  });
  const calls = [];
  const restore = mockFetch(async (route) => {
    calls.push(route);
    if (route === 'GET /repos/sitcon-tw/credits-profiles/issues/comments?since=2026-06-12T12%3A00%3A00.000Z&per_page=100') {
      return jsonResponse([comment({ id: 987, issueNumber: 58, body, updatedAt: '2026-06-13T01:00:00Z' })]);
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/pulls/58') {
      return jsonResponse(pullRequest({ number: 58, headSha: 'abc123' }));
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/pulls/58/files?per_page=100') {
      return jsonResponse([{ filename: 'profiles/octocat.json', status: 'added' }]);
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/issues/82') {
      return jsonResponse({ number: 82, body: claimUrl, state: 'open' });
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/issues/58/comments?per_page=100') {
      return jsonResponse([comment({ id: 987, issueNumber: 58, body })]);
    }
    throw new Error(`Unexpected route: ${route}`);
  });

  try {
    const results = await recoverProfileClaimApplies({
      owner: 'sitcon-tw',
      repo: 'credits-profiles',
      targetOwner: 'sitcon-tw',
      targetRepo: 'credits',
      exportPath: await writeExport(exportPayload),
      assistantLogin: 'sitcon-credits',
      sinceHours: 24,
      limit: 10,
      apply: false,
      excludeCommentIds: new Set(),
    }, {}, 'token');

    assert.deepEqual(results.map((result) => result.decision), ['would-apply']);
    assert.equal(calls.some((route) => route.startsWith('POST /repos/sitcon-tw/credits/dispatches')), false);
  } finally {
    restore();
  }
});

test('recoverProfileClaimApplies dispatches review for already-applied PR claims', async () => {
  const exportPayload = exportWithGithubUsername('octocat');
  const body = [
    '<!-- sitcon-credits-profile-claim-confirmation -->',
    '<!-- sitcon-credits-profile-claim: {"mode":"pull_request","pull_number":58,"head_sha":"abc123","plan_hash":"oldhash","username":"octocat"} -->',
    '- [x] 我已確認上述 1 筆歷史貢獻連結，請更新 SITCON Credits canonical Google Sheets。 <!-- sitcon-credits-profile-claim-apply -->',
  ].join('\n');
  const dispatched = [];
  const restore = mockFetch(async (route) => {
    if (route === 'GET /repos/sitcon-tw/credits-profiles/issues/comments?since=2026-06-12T12%3A00%3A00.000Z&per_page=100') {
      return jsonResponse([comment({ id: 987, issueNumber: 58, body, updatedAt: '2026-06-13T01:00:00Z' })]);
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/pulls/58') {
      return jsonResponse(pullRequest({ number: 58, headSha: 'abc123' }));
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/pulls/58/files?per_page=100') {
      return jsonResponse([{ filename: 'profiles/octocat.json', status: 'added' }]);
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/issues/82') {
      return jsonResponse({ number: 82, body: claimUrl, state: 'open' });
    }
    if (route === 'GET /repos/sitcon-tw/credits-profiles/issues/58/comments?per_page=100') {
      return jsonResponse([comment({ id: 987, issueNumber: 58, body })]);
    }
    throw new Error(`Unexpected route: ${route}`);
  });

  try {
    const results = await recoverProfileClaimApplies({
      owner: 'sitcon-tw',
      repo: 'credits-profiles',
      targetOwner: 'sitcon-tw',
      targetRepo: 'credits',
      exportPath: await writeExport(exportPayload),
      assistantLogin: 'sitcon-credits',
      sinceHours: 24,
      limit: 10,
      apply: true,
      excludeCommentIds: new Set(),
    }, {}, 'token', {
      dispatchProfileReview: async (_token, _options, pullNumber, headSha) => {
        dispatched.push({ pullNumber, headSha });
      },
    });

    assert.deepEqual(results.map((result) => result.decision), ['already-applied-dispatched-review']);
    assert.deepEqual(dispatched, [{ pullNumber: 58, headSha: 'abc123' }]);
  } finally {
    restore();
  }
});

function claimCommentBody({ pullNumber, headSha, username, exportPayload }) {
  const pull = pullRequest({ number: pullNumber, headSha, body: claimUrl });
  const plan = buildProfileClaimPlan({
    pullRequest: pull,
    files: [{ filename: `profiles/${username}.json`, status: 'added' }],
    sourceIssue: { body: claimUrl },
    exportPayload,
  });
  return formatClaimCommentBody(plan, { pullNumber, headSha }).replace('- [ ]', '- [x]');
}

function pullRequest({ number, headSha, body = `Refs #82\n\n${claimUrl}` }) {
  return {
    number,
    state: 'open',
    body,
    head: { sha: headSha },
  };
}

function comment({ id, issueNumber, body, updatedAt = '2026-06-13T00:00:00Z' }) {
  return {
    id,
    body,
    issue_url: `https://api.github.com/repos/sitcon-tw/credits-profiles/issues/${issueNumber}`,
    user: { login: 'sitcon-credits[bot]' },
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

function exportWithGithubUsername(githubUsername) {
  return {
    sheets: {
      appearances: {
        rows: [{
          _row: 7,
          event_id: 'SITCON-Camp-2026',
          display_name_at_event: 'Octo',
          github_username: githubUsername,
          role_group_zh: '議程',
          role_title_zh: '講者',
        }],
      },
      events: {
        rows: [{
          event_id: 'SITCON-Camp-2026',
          event_name_zh: 'SITCON Camp 2026',
        }],
      },
    },
  };
}

async function writeExport(payload) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sitcon-credits-recovery-'));
  const filePath = path.join(dir, 'export.json');
  await writeFile(filePath, `${JSON.stringify(payload)}\n`);
  return filePath;
}

function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  const fixedNow = new Date('2026-06-13T12:00:00.000Z').valueOf();
  const originalDateNow = Date.now;
  Date.now = () => fixedNow;
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const route = `${init.method ?? 'GET'} ${parsed.pathname}${parsed.search}`;
    return handler(route, init);
  };
  return () => {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  };
}

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}
