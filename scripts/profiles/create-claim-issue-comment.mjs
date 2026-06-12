import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { githubPaginate, githubRequest } from '../lib/github-api.mjs';
import {
  buildProfileClaimPlanFromIssue,
  formatClaimCommentBody,
} from './claim-confirmation.mjs';
import {
  assistantCommentLogins,
  isApplyCheckboxChecked,
  parseClaimMetadata,
} from './create-claim-comment.mjs';

const DEFAULT_ASSISTANT_LOGIN = 'sitcon-credits';

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required.');
  }

  const [issue, exportPayload, comments] = await Promise.all([
    githubRequest(token, `GET /repos/${options.owner}/${options.repo}/issues/${options.issueNumber}`),
    readJson(options.exportPath),
    githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/issues/${options.issueNumber}/comments?per_page=100`),
  ]);

  const skipped = validateIssue(options, issue);
  if (skipped) {
    await writeClaimPlan(options, skipped);
    console.log(`Profile claim issue confirmation skipped: ${skipped.reason}.`);
    return;
  }

  const plan = buildProfileClaimPlanFromIssue({
    issue,
    username: options.username,
    exportPayload,
    acceptAppliedClaims: hasConfirmedIssueClaimComment(comments, options),
  });
  await writeClaimPlan(options, plan);
  if (plan.status === 'not_applicable') {
    if (plan.reason === 'claim-updates-already-applied') {
      const deleted = await deleteClaimIssueComments(token, options);
      console.log(`Profile claim issue confirmation skipped: ${plan.reason}; deleted ${deleted} stale comment(s).`);
      return;
    }
    console.log(`Profile claim issue confirmation skipped: ${plan.reason}.`);
    return;
  }

  const body = formatClaimCommentBody(plan, {
    mode: 'issue',
    issueNumber: options.issueNumber,
  });
  const comment = await upsertClaimIssueComment(token, options, body);
  console.log(`Profile claim issue confirmation comment ${comment.id}: ${plan.reason}.`);
}

export function parseArgs(argv) {
  const options = {
    assistantLogin: DEFAULT_ASSISTANT_LOGIN,
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
    if (arg === '--export') {
      options.exportPath = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--assistant-login') {
      options.assistantLogin = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--plan-output') {
      options.planOutputPath = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  for (const key of ['owner', 'repo', 'issueNumber', 'username', 'exportPath']) {
    if (!options[key]) {
      throw new Error(`Missing required option: ${key}`);
    }
  }
  return options;
}

export function validateIssue(options, issue) {
  if (issue.pull_request) {
    return skippedPlan(options, 'issue-is-pull-request');
  }
  if (issue.state !== 'open') {
    return skippedPlan(options, 'issue-not-open');
  }
  const labels = new Set((issue.labels ?? []).map((label) => typeof label === 'string' ? label : label.name));
  if (!labels.has('profile-request')) {
    return skippedPlan(options, 'missing-profile-request-label');
  }
  if (String(issue.user?.login ?? '').toLowerCase() !== String(options.username).toLowerCase()) {
    return skippedPlan(options, 'issue-author-username-mismatch');
  }
  return null;
}

export async function upsertClaimIssueComment(token, options, body) {
  const comments = await githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/issues/${options.issueNumber}/comments?per_page=100`);
  const existing = comments.find((comment) => isAssistantIssueClaimComment(comment, options.assistantLogin));
  if (existing) {
    if (existing.body === body) {
      return existing;
    }
    return githubRequest(token, `PATCH /repos/${options.owner}/${options.repo}/issues/comments/${existing.id}`, { body });
  }
  return githubRequest(token, `POST /repos/${options.owner}/${options.repo}/issues/${options.issueNumber}/comments`, { body });
}

export async function deleteClaimIssueComments(token, options) {
  const comments = await githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/issues/${options.issueNumber}/comments?per_page=100`);
  const matching = comments.filter((comment) => isAssistantIssueClaimComment(comment, options.assistantLogin));
  for (const comment of matching) {
    await githubRequest(token, `DELETE /repos/${options.owner}/${options.repo}/issues/comments/${comment.id}`);
  }
  return matching.length;
}

export function isAssistantIssueClaimComment(comment, assistantLogin = DEFAULT_ASSISTANT_LOGIN) {
  if (!comment.body?.includes('<!-- sitcon-credits-profile-claim-confirmation -->')) {
    return false;
  }
  const metadata = parseClaimMetadata(comment.body);
  return metadata?.mode === 'issue' &&
    assistantCommentLogins(assistantLogin).has(comment.user?.login);
}

export function hasConfirmedIssueClaimComment(comments, options) {
  return (comments ?? []).some((comment) => {
    if (!isAssistantIssueClaimComment(comment, options.assistantLogin)) {
      return false;
    }
    if (!isApplyCheckboxChecked(comment.body)) {
      return false;
    }
    const metadata = parseClaimMetadata(comment.body);
    return metadata?.issue_number === options.issueNumber &&
      String(metadata?.username ?? '').toLowerCase() === String(options.username).toLowerCase();
  });
}

function skippedPlan(options, reason) {
  return {
    status: 'not_applicable',
    reason,
    username: options.username ?? '',
    updates: [],
  };
}

async function writeClaimPlan(options, plan) {
  if (!options.planOutputPath) {
    return;
  }
  await writeFile(options.planOutputPath, `${JSON.stringify(plan, null, 2)}\n`);
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
