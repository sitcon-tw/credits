import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { getServiceAccountAccessToken } from '../lib/google-auth.mjs';
import { githubPaginate, githubRequest } from '../lib/github-api.mjs';
import { SHEETS_API, sheetsFetch } from '../lib/google-sheets-api.mjs';
import { DEFAULT_CONFIG_PATH, readSheetsConfig } from '../lib/sheets-config.mjs';
import {
  buildProfileClaimPlan,
  buildProfileClaimPlanFromIssue,
  buildSheetValueUpdates,
  formatApplyFailureOutput,
} from './claim-confirmation.mjs';
import {
  isApplyCheckboxChecked,
  parseClaimMetadata,
} from './create-claim-comment.mjs';
import { extractLinkedIssueNumber } from './create-claim-check.mjs';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required.');
  }

  try {
    const result = await applyProfileClaims(options, env, token);
    console.log(formatApplyPlan(result.plan));
  } catch (error) {
    if (options.checkRunId) {
      await updateCheckRun(token, options, formatApplyFailureOutput(error instanceof Error ? error.message : String(error)));
    }
    throw error;
  }
}

export async function applyProfileClaims(options, env, token) {
  const [config, exportPayload] = await Promise.all([
    readSheetsConfig(options.configPath),
    readJson(options.exportPath),
  ]);
  const result = options.issueNumber
    ? await buildIssueModeApplyResult(options, token, exportPayload)
    : await buildPullRequestModeApplyResult(options, token, exportPayload);
  const { plan } = result;
  validateConfirmedComment(result.comment, options, plan);

  if (plan.status !== 'ready') {
    throw new Error(`profile claim plan is not ready: ${plan.reason}`);
  }

  if (!options.apply) {
    return { plan, applied: false };
  }

  if (options.planOutputPath) {
    await writeFile(options.planOutputPath, `${JSON.stringify(plan, null, 2)}\n`);
  }

  const credentialsPath = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS must point to a local service account JSON file.');
  }
  const accessToken = await getServiceAccountAccessToken(credentialsPath, SCOPE);
  await applySheetValueUpdates(config, buildSheetValueUpdates(config, plan), accessToken);

  return { plan, applied: true };
}

async function buildPullRequestModeApplyResult(options, token, exportPayload) {
  const pullRequest = await githubRequest(token, `GET /repos/${options.owner}/${options.repo}/pulls/${options.pullNumber}`);
  if (pullRequest.state !== 'open') {
    throw new Error(`PR #${options.pullNumber} is ${pullRequest.state}; only open PRs can apply profile claims.`);
  }
  if (pullRequest.head?.sha !== options.headSha) {
    throw new Error('PR head SHA changed; rerun profile review before applying claims.');
  }

  const [files, sourceIssue, comment] = await Promise.all([
    githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/pulls/${options.pullNumber}/files?per_page=100`),
    fetchLinkedIssue(token, options, pullRequest),
    fetchConfirmationComment(token, options),
  ]);
  const plan = buildProfileClaimPlan({ pullRequest, files, sourceIssue, exportPayload });
  return { plan, comment };
}

async function buildIssueModeApplyResult(options, token, exportPayload) {
  const [issue, comment] = await Promise.all([
    githubRequest(token, `GET /repos/${options.owner}/${options.repo}/issues/${options.issueNumber}`),
    fetchConfirmationComment(token, options),
  ]);
  if (issue.pull_request) {
    throw new Error(`#${options.issueNumber} is a pull request; issue-mode claims require a profile request issue.`);
  }
  if (issue.state !== 'open') {
    throw new Error(`Issue #${options.issueNumber} is ${issue.state}; only open issues can apply profile claims.`);
  }
  if (String(issue.user?.login ?? '').toLowerCase() !== String(options.username).toLowerCase()) {
    throw new Error('Issue author does not match the requested profile username.');
  }
  const plan = buildProfileClaimPlanFromIssue({
    issue,
    username: options.username,
    exportPayload,
  });
  return { plan, comment };
}

export function parseArgs(argv) {
  const options = {
    configPath: DEFAULT_CONFIG_PATH,
    apply: false,
  };

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
    if (arg === '--issue-number') {
      options.issueNumber = Number(readNextArg(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--username') {
      options.username = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--confirmation-comment-id') {
      options.confirmationCommentId = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--export') {
      options.exportPath = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--check-run-id') {
      options.checkRunId = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--plan-output') {
      options.planOutputPath = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--config') {
      options.configPath = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  for (const key of ['owner', 'repo', 'exportPath']) {
    if (!options[key]) {
      throw new Error(`Missing required option: ${key}`);
    }
  }
  if (options.issueNumber) {
    for (const key of ['issueNumber', 'username', 'confirmationCommentId']) {
      if (!options[key]) {
        throw new Error(`Missing required option: ${key}`);
      }
    }
  } else {
    for (const key of ['pullNumber', 'headSha', 'confirmationCommentId']) {
      if (!options[key]) {
        throw new Error(`Missing required option: ${key}`);
      }
    }
  }
  return options;
}

export async function applySheetValueUpdates(config, data, accessToken) {
  if (data.length === 0) {
    throw new Error('no sheet updates to apply.');
  }
  return sheetsFetch(`${SHEETS_API}/${config.spreadsheetId}/values:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data,
    }),
  });
}

export function formatApplyPlan(plan) {
  return [
    `Profile username: ${plan.username}`,
    `Updates: ${plan.updates.length}`,
    ...plan.updates.map((update) => [
      `- appearances row ${update.rowNumber}`,
      update.eventId,
      update.displayNameAtEvent,
      `${update.currentValue} -> ${update.nextValue}`,
    ].join(' | ')),
  ].join('\n');
}

async function updateCheckRun(token, options, output) {
  await githubRequest(token, `PATCH /repos/${options.owner}/${options.repo}/check-runs/${options.checkRunId}`, {
    status: 'completed',
    conclusion: output.conclusion,
    output: {
      title: output.title,
      summary: output.summary,
      text: output.text,
    },
  });
}

async function fetchLinkedIssue(token, options, pullRequest) {
  const issueNumber = extractLinkedIssueNumber(pullRequest.body ?? '');
  if (!issueNumber) {
    return null;
  }
  return githubRequest(token, `GET /repos/${options.owner}/${options.repo}/issues/${issueNumber}`);
}

async function fetchConfirmationComment(token, options) {
  if (!options.confirmationCommentId) {
    throw new Error('confirmation comment id is required.');
  }
  return githubRequest(token, `GET /repos/${options.owner}/${options.repo}/issues/comments/${options.confirmationCommentId}`);
}

export function validateConfirmedComment(comment, options, plan) {
  if (!isApplyCheckboxChecked(comment?.body)) {
    throw new Error('confirmation comment checkbox is not checked.');
  }
  const metadata = parseClaimMetadata(comment.body);
  if (!metadata) {
    throw new Error('confirmation comment metadata is missing.');
  }
  if (options.issueNumber) {
    if (metadata.mode !== 'issue') {
      throw new Error('confirmation comment is not issue mode.');
    }
    if (metadata.issue_number !== options.issueNumber) {
      throw new Error('confirmation comment issue number does not match.');
    }
    if (String(metadata.username ?? '').toLowerCase() !== String(options.username).toLowerCase()) {
      throw new Error('confirmation comment username does not match.');
    }
  } else {
    if (metadata.mode !== 'pull_request') {
      throw new Error('confirmation comment is not pull request mode.');
    }
    if (metadata.pull_number !== options.pullNumber) {
      throw new Error('confirmation comment pull number does not match.');
    }
    if (metadata.head_sha !== options.headSha) {
      throw new Error('confirmation comment head SHA does not match.');
    }
  }
  if (metadata.plan_hash !== plan.planHash) {
    throw new Error('confirmation comment plan hash does not match the latest canonical data.');
  }
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
