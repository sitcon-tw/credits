import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { githubPaginate, githubRequest } from '../lib/github-api.mjs';
import {
  CLAIM_CHECK_MARKER,
  CLAIM_COMMENT_APPLY_MARKER,
  CLAIM_COMMENT_METADATA_MARKER,
  buildProfileClaimPlan,
  formatClaimCommentBody,
} from './claim-confirmation.mjs';
import { extractLinkedIssueNumber } from './create-claim-check.mjs';

const DEFAULT_ASSISTANT_LOGIN = 'sitcon-credits';
export const CLAIM_ISSUE_WAITING_MARKER = '<!-- sitcon-credits-profile-claim-waiting -->';

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

  const [files, sourceIssue, exportPayload, comments] = await Promise.all([
    githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/pulls/${options.pullNumber}/files?per_page=100`),
    fetchLinkedIssue(token, options, pullRequest),
    readJson(options.exportPath),
    githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/issues/${options.pullNumber}/comments?per_page=100`),
  ]);
  const plan = buildProfileClaimPlan({
    pullRequest,
    files,
    sourceIssue,
    exportPayload,
    acceptAppliedClaims: hasConfirmedClaimComment(comments, options),
  });
  await writeClaimPlan(options, plan);
  if (plan.status === 'not_applicable') {
    if (plan.reason === 'claim-updates-already-applied') {
      const deleted = await deleteClaimComments(token, options);
      console.log(`Profile claim confirmation skipped: ${plan.reason}; deleted ${deleted} stale comment(s).`);
      return;
    }
    console.log(`Profile claim confirmation skipped: ${plan.reason}.`);
    return;
  }

  const body = formatClaimCommentBody(plan, {
    pullNumber: options.pullNumber,
    headSha: options.headSha,
  });
  const comment = await upsertClaimComment(token, options, body);
  if (plan.status === 'ready' && sourceIssue?.number) {
    await upsertClaimWaitingIssueComment(token, options, sourceIssue.number, formatClaimWaitingIssueComment({
      pullNumber: options.pullNumber,
      username: plan.username,
      updates: plan.updates,
    }));
  }
  console.log(`Profile claim confirmation comment ${comment.id}: ${plan.reason}.`);
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

  for (const key of ['owner', 'repo', 'pullNumber', 'headSha', 'exportPath']) {
    if (!options[key]) {
      throw new Error(`Missing required option: ${key}`);
    }
  }
  return options;
}

export async function upsertClaimComment(token, options, body) {
  const comments = await githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/issues/${options.pullNumber}/comments?per_page=100`);
  const existing = comments.find((comment) => isAssistantClaimComment(comment, options.assistantLogin));
  if (existing) {
    return githubRequest(token, `PATCH /repos/${options.owner}/${options.repo}/issues/comments/${existing.id}`, { body });
  }
  return githubRequest(token, `POST /repos/${options.owner}/${options.repo}/issues/${options.pullNumber}/comments`, { body });
}

export async function deleteClaimComments(token, options) {
  const comments = await githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/issues/${options.pullNumber}/comments?per_page=100`);
  const matching = comments.filter((comment) => isAssistantClaimComment(comment, options.assistantLogin));
  for (const comment of matching) {
    await githubRequest(token, `DELETE /repos/${options.owner}/${options.repo}/issues/comments/${comment.id}`);
  }
  return matching.length;
}

export async function upsertClaimWaitingIssueComment(token, options, issueNumber, body) {
  const comments = await githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/issues/${issueNumber}/comments?per_page=100`);
  const existing = comments.find((comment) => isAssistantClaimWaitingIssueComment(comment, options.assistantLogin));
  if (existing) {
    return githubRequest(token, `PATCH /repos/${options.owner}/${options.repo}/issues/comments/${existing.id}`, { body });
  }
  return githubRequest(token, `POST /repos/${options.owner}/${options.repo}/issues/${issueNumber}/comments`, { body });
}

export function formatClaimWaitingIssueComment({ pullNumber, username, updates }) {
  const updateCount = updates?.length ?? 0;
  return [
    CLAIM_ISSUE_WAITING_MARKER,
    `\`${username}\` 的 profile 資料格式已通過；目前不需要你修改資料。`,
    '',
    `因為你提供了貢獻紀錄標記網址，接下來會由維護者確認 ${updateCount} 筆公開活動紀錄是否可以連到你的 GitHub 帳號。確認完成後，系統才會更新 SITCON Credits 的主資料。`,
    '',
    `你可以到 PR #${pullNumber} 查看完整檢查紀錄。若等候很久都沒有回應，可以找熟悉 SITCON Credits 或這次活動紀錄的夥伴協助確認。`,
  ].join('\n');
}

export function isAssistantClaimWaitingIssueComment(comment, assistantLogin = DEFAULT_ASSISTANT_LOGIN) {
  return comment.body?.includes(CLAIM_ISSUE_WAITING_MARKER) &&
    assistantCommentLogins(assistantLogin).has(comment.user?.login);
}

async function writeClaimPlan(options, plan) {
  if (!options.planOutputPath) {
    return;
  }
  await writeFile(options.planOutputPath, `${JSON.stringify(plan, null, 2)}\n`);
}

export function isAssistantClaimComment(comment, assistantLogin = DEFAULT_ASSISTANT_LOGIN) {
  return comment.body?.includes(CLAIM_CHECK_MARKER) &&
    assistantCommentLogins(assistantLogin).has(comment.user?.login);
}

export function hasConfirmedClaimComment(comments, options) {
  return (comments ?? []).some((comment) => {
    if (!isAssistantClaimComment(comment, options.assistantLogin)) {
      return false;
    }
    if (!isApplyCheckboxChecked(comment.body)) {
      return false;
    }
    const metadata = parseClaimMetadata(comment.body);
    return metadata?.pull_number === options.pullNumber &&
      metadata?.head_sha === options.headSha;
  });
}

export function isApplyCheckboxChecked(body) {
  return new RegExp(`-\\s*\\[[xX]\\][^\\n]*${escapeRegExp(CLAIM_COMMENT_APPLY_MARKER)}`).test(String(body ?? ''));
}

export function parseClaimMetadata(body) {
  const pattern = new RegExp(`<!--\\s*${CLAIM_COMMENT_METADATA_MARKER}:\\s*([\\s\\S]*?)\\s*-->`);
  const match = String(body ?? '').match(pattern);
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[1]);
    return {
      pull_number: Number(parsed.pull_number),
      head_sha: String(parsed.head_sha ?? ''),
    };
  } catch {
    return null;
  }
}

export function assistantCommentLogins(assistantLogin = DEFAULT_ASSISTANT_LOGIN) {
  const logins = new Set([
    DEFAULT_ASSISTANT_LOGIN,
    `${DEFAULT_ASSISTANT_LOGIN}[bot]`,
    'sitcon-credits-assistant[bot]',
  ]);
  const bareLogin = String(assistantLogin ?? '').replace(/\[bot\]$/, '');
  for (const login of [assistantLogin, bareLogin]) {
    if (!login) {
      continue;
    }
    logins.add(login);
    logins.add(`${login}[bot]`);
    logins.add(`app/${login}`);
  }
  return logins;
}

async function fetchLinkedIssue(token, options, pullRequest) {
  const issueNumber = extractLinkedIssueNumber(pullRequest.body ?? '');
  if (!issueNumber) {
    return null;
  }
  return githubRequest(token, `GET /repos/${options.owner}/${options.repo}/issues/${issueNumber}`);
}

function readNextArg(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
