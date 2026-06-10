import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { githubPaginate, githubRequest } from '../lib/github-api.mjs';
import {
  CLAIM_CHECK_ACTION_ID,
  CLAIM_CHECK_NAME,
  buildProfileClaimPlan,
  formatClaimCheckOutput,
} from './claim-confirmation.mjs';

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required.');
  }

  const pullRequest = await githubRequest(token, `GET /repos/${options.owner}/${options.repo}/pulls/${options.pullNumber}`);
  if (pullRequest.state !== 'open') {
    console.log(`Profile claim confirmation skipped: PR #${options.pullNumber} is ${pullRequest.state}.`);
    return;
  }
  if (pullRequest.head?.sha !== options.headSha) {
    console.log('Profile claim confirmation skipped: stale-pr-head.');
    return;
  }

  const [files, sourceIssue, exportPayload] = await Promise.all([
    githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/pulls/${options.pullNumber}/files?per_page=100`),
    fetchLinkedIssue(token, options, pullRequest),
    readJson(options.exportPath),
  ]);
  const plan = buildProfileClaimPlan({ pullRequest, files, sourceIssue, exportPayload });
  if (plan.status === 'not_applicable') {
    console.log(`Profile claim confirmation skipped: ${plan.reason}.`);
    return;
  }

  const output = formatClaimCheckOutput(plan, { workflowUrl: options.workflowUrl });
  const checkRun = await upsertClaimCheckRun(token, options, pullRequest, plan, output);
  console.log(`Profile claim confirmation check ${checkRun.id}: ${plan.reason}.`);
}

export function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--owner') {
      options.owner = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--repo') {
      options.repo = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--pull-number') {
      options.pullNumber = Number(readNextArg(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--head-sha') {
      options.headSha = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--export') {
      options.exportPath = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--workflow-url') {
      options.workflowUrl = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  for (const key of ['owner', 'repo', 'pullNumber', 'headSha', 'exportPath']) {
    if (!options[key]) {
      throw new Error(`Missing required option: ${key}`);
    }
  }
  return options;
}

export async function upsertClaimCheckRun(token, options, pullRequest, plan, output) {
  const externalId = claimCheckExternalId(options.pullNumber, options.headSha, plan.planHash ?? plan.reason);
  const checkRuns = await githubRequest(
    token,
    `GET /repos/${options.owner}/${options.repo}/commits/${options.headSha}/check-runs?check_name=${encodeURIComponent(CLAIM_CHECK_NAME)}&per_page=100`,
  );
  const existing = (checkRuns.check_runs ?? []).find((checkRun) => checkRun.external_id === externalId);
  const commonBody = {
    status: 'completed',
    conclusion: output.conclusion,
    details_url: pullRequest.html_url,
    output: {
      title: output.title,
      summary: output.summary,
      text: output.text,
    },
    actions: plan.status === 'ready'
      ? [
          {
            label: '更新 Sheet',
            description: '將已確認的 site: 標記改成此 PR 的 GitHub username',
            identifier: CLAIM_CHECK_ACTION_ID,
          },
        ]
      : [],
  };
  const createBody = {
    ...commonBody,
    name: CLAIM_CHECK_NAME,
    head_sha: options.headSha,
    external_id: externalId,
  };

  if (existing) {
    return githubRequest(token, `PATCH /repos/${options.owner}/${options.repo}/check-runs/${existing.id}`, commonBody);
  }
  return githubRequest(token, `POST /repos/${options.owner}/${options.repo}/check-runs`, createBody);
}

export function claimCheckExternalId(pullNumber, headSha, planHash) {
  return `profile-claims:${pullNumber}:${headSha}:${planHash}`;
}

async function fetchLinkedIssue(token, options, pullRequest) {
  const issueNumber = extractLinkedIssueNumber(pullRequest.body ?? '');
  if (!issueNumber) {
    return null;
  }
  return githubRequest(token, `GET /repos/${options.owner}/${options.repo}/issues/${issueNumber}`);
}

export function extractLinkedIssueNumber(body) {
  const match = String(body ?? '').match(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function readNextArg(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
