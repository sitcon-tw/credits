import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { githubPaginate, githubRequest } from '../lib/github-api.mjs';
import { DEFAULT_CONFIG_PATH } from '../lib/sheets-config.mjs';
import {
  buildProfileClaimPlan,
  buildProfileClaimPlanFromIssue,
} from './claim-confirmation.mjs';
import {
  applyProfileClaims,
  validateConfirmedComment,
} from './apply-claims.mjs';
import {
  hasConfirmedClaimComment,
  isApplyCheckboxChecked,
  isAssistantClaimComment,
  parseClaimMetadata,
} from './create-claim-comment.mjs';
import { extractLinkedIssueNumber } from './create-claim-check.mjs';

const DEFAULT_TARGET_OWNER = 'sitcon-tw';
const DEFAULT_TARGET_REPO = 'credits';

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required.');
  }

  const results = await recoverProfileClaimApplies(options, env, token);
  for (const result of results) {
    console.log([
      `Profile claim recovery: ${result.decision}`,
      result.mode ? `mode=${result.mode}` : '',
      result.pullNumber ? `pull=#${result.pullNumber}` : '',
      result.issueNumber ? `issue=#${result.issueNumber}` : '',
      result.commentId ? `comment=${result.commentId}` : '',
      result.reason ? `reason=${result.reason}` : '',
    ].filter(Boolean).join(' '));
  }
  console.log(`Profile claim recovery inspected ${results.length} checked confirmation comment(s).`);
}

export function parseArgs(argv) {
  const options = {
    assistantLogin: 'sitcon-credits',
    targetOwner: DEFAULT_TARGET_OWNER,
    targetRepo: DEFAULT_TARGET_REPO,
    configPath: DEFAULT_CONFIG_PATH,
    sinceHours: 24,
    limit: 100,
    apply: false,
    excludeCommentIds: new Set(),
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
    if (arg === '--target-owner') {
      options.targetOwner = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--target-repo') {
      options.targetRepo = readNextArg(argv, index, arg);
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
    if (arg === '--config') {
      options.configPath = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--since-hours') {
      options.sinceHours = Number(readNextArg(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      options.limit = Number(readNextArg(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--exclude-comment-id') {
      options.excludeCommentIds.add(String(readNextArg(argv, index, arg)));
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
  if (!Number.isFinite(options.sinceHours) || options.sinceHours <= 0 || options.sinceHours > 168) {
    throw new Error('--since-hours must be a number from 1 to 168.');
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('--limit must be an integer from 1 to 100.');
  }
  return options;
}

export async function recoverProfileClaimApplies(options, env, token, deps = {}) {
  const exportPayload = await readJson(options.exportPath);
  const comments = await listRecentCheckedClaimComments(token, options);
  const results = [];
  let appliedInThisRun = false;

  for (const comment of comments) {
    const result = await recoverClaimComment(token, options, env, exportPayload, comment, {
      applyClaim: deps.applyClaim ?? applyProfileClaims,
      dispatchProfileReview: deps.dispatchProfileReview ?? dispatchProfileReview,
      dispatchPagesRebuild: deps.dispatchPagesRebuild ?? dispatchPagesRebuild,
      canApplySheetChange: !appliedInThisRun,
    });
    results.push(result);
    if (result.decision === 'applied') {
      appliedInThisRun = true;
    }
  }

  return results;
}

export async function recoverClaimComment(token, options, env, exportPayload, comment, deps) {
  const commentId = String(comment.id ?? '');
  const metadata = parseClaimMetadata(comment.body);
  const issueNumber = issueNumberFromComment(comment);
  if (!metadata) {
    return decision('skipped-missing-metadata', comment, { issueNumber });
  }
  if (metadata.mode === 'issue') {
    return recoverIssueModeClaim(token, options, env, exportPayload, comment, metadata, deps);
  }
  return recoverPullRequestModeClaim(token, options, env, exportPayload, comment, metadata, deps);
}

async function recoverPullRequestModeClaim(token, options, env, exportPayload, comment, metadata, deps) {
  const pullNumber = metadata.pull_number;
  const base = { mode: 'pull_request', pullNumber, commentId: String(comment.id) };
  if (!pullNumber || issueNumberFromComment(comment) !== pullNumber) {
    return { ...base, decision: 'skipped-metadata-mismatch', reason: 'pull-number-mismatch' };
  }
  if (!metadata.head_sha) {
    return { ...base, decision: 'skipped-metadata-mismatch', reason: 'missing-head-sha' };
  }

  const pullRequest = await githubRequest(token, `GET /repos/${options.owner}/${options.repo}/pulls/${pullNumber}`);
  if (pullRequest.state !== 'open') {
    return { ...base, decision: 'skipped-closed-or-merged', reason: pullRequest.state };
  }
  if (pullRequest.head?.sha !== metadata.head_sha) {
    return { ...base, decision: 'skipped-stale-head', reason: 'head-sha-changed' };
  }

  const [files, sourceIssue, comments] = await Promise.all([
    githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/pulls/${pullNumber}/files?per_page=100`),
    fetchLinkedIssue(token, options, pullRequest),
    githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/issues/${pullNumber}/comments?per_page=100`),
  ]);
  const plan = buildProfileClaimPlan({ pullRequest, files, sourceIssue, exportPayload });
  if (plan.status === 'ready') {
    try {
      validateConfirmedComment(comment, {
        pullNumber,
        headSha: metadata.head_sha,
      }, plan);
    } catch (error) {
      return { ...base, decision: 'skipped-plan-hash-changed', reason: error.message };
    }
    if (!deps.canApplySheetChange) {
      return { ...base, decision: 'skipped-refresh-required', reason: 'another-claim-applied-in-this-run' };
    }
    if (!options.apply) {
      return { ...base, decision: 'would-apply' };
    }
    await deps.applyClaim(applyOptions(options, {
      pullNumber,
      headSha: metadata.head_sha,
      confirmationCommentId: String(comment.id),
    }), env, token);
    await deps.dispatchProfileReview(token, options, pullNumber, metadata.head_sha);
    return { ...base, decision: 'applied' };
  }

  const appliedPlan = buildProfileClaimPlan({
    pullRequest,
    files,
    sourceIssue,
    exportPayload,
    acceptAppliedClaims: hasConfirmedClaimComment(comments, {
      pullNumber,
      headSha: metadata.head_sha,
      assistantLogin: options.assistantLogin,
    }),
  });
  if (appliedPlan.reason === 'claim-updates-already-applied') {
    if (options.apply) {
      await deps.dispatchProfileReview(token, options, pullNumber, metadata.head_sha);
      return { ...base, decision: 'already-applied-dispatched-review' };
    }
    return { ...base, decision: 'would-dispatch-review' };
  }

  return { ...base, decision: 'skipped-not-ready', reason: plan.reason };
}

async function recoverIssueModeClaim(token, options, env, exportPayload, comment, metadata, deps) {
  const issueNumber = metadata.issue_number;
  const base = { mode: 'issue', issueNumber, commentId: String(comment.id) };
  if (!issueNumber || issueNumberFromComment(comment) !== issueNumber) {
    return { ...base, decision: 'skipped-metadata-mismatch', reason: 'issue-number-mismatch' };
  }
  if (!metadata.username) {
    return { ...base, decision: 'skipped-metadata-mismatch', reason: 'missing-username' };
  }

  const issue = await githubRequest(token, `GET /repos/${options.owner}/${options.repo}/issues/${issueNumber}`);
  if (issue.pull_request || issue.state !== 'open') {
    return { ...base, decision: 'skipped-closed-or-merged', reason: issue.pull_request ? 'pull-request' : issue.state };
  }
  const plan = buildProfileClaimPlanFromIssue({ issue, username: metadata.username, exportPayload });
  if (plan.status === 'ready') {
    try {
      validateConfirmedComment(comment, {
        issueNumber,
        username: metadata.username,
      }, plan);
    } catch (error) {
      return { ...base, decision: 'skipped-plan-hash-changed', reason: error.message };
    }
    if (!deps.canApplySheetChange) {
      return { ...base, decision: 'skipped-refresh-required', reason: 'another-claim-applied-in-this-run' };
    }
    if (!options.apply) {
      return { ...base, decision: 'would-apply' };
    }
    await deps.applyClaim(applyOptions(options, {
      issueNumber,
      username: metadata.username,
      confirmationCommentId: String(comment.id),
    }), env, token);
    await deps.dispatchPagesRebuild(token, options, issueNumber, metadata.username);
    return { ...base, decision: 'applied' };
  }

  const appliedPlan = buildProfileClaimPlanFromIssue({
    issue,
    username: metadata.username,
    exportPayload,
    acceptAppliedClaims: true,
  });
  if (appliedPlan.reason === 'claim-updates-already-applied') {
    if (options.apply) {
      await deps.dispatchPagesRebuild(token, options, issueNumber, metadata.username);
      return { ...base, decision: 'already-applied-dispatched-pages' };
    }
    return { ...base, decision: 'would-dispatch-pages' };
  }

  return { ...base, decision: 'skipped-not-ready', reason: plan.reason };
}

async function listRecentCheckedClaimComments(token, options) {
  const since = new Date(Date.now() - options.sinceHours * 60 * 60 * 1000).toISOString();
  const comments = await githubPaginate(
    token,
    `GET /repos/${options.owner}/${options.repo}/issues/comments?since=${encodeURIComponent(since)}&per_page=100`,
  );
  return comments
    .filter((comment) => !options.excludeCommentIds.has(String(comment.id)))
    .filter((comment) => isAssistantClaimComment(comment, options.assistantLogin))
    .filter((comment) => isApplyCheckboxChecked(comment.body))
    .sort((left, right) => new Date(left.updated_at ?? left.created_at) - new Date(right.updated_at ?? right.created_at))
    .slice(0, options.limit);
}

function applyOptions(options, overrides) {
  return {
    owner: options.owner,
    repo: options.repo,
    exportPath: options.exportPath,
    configPath: options.configPath,
    apply: true,
    ...overrides,
  };
}

async function dispatchProfileReview(token, options, pullNumber, headSha) {
  await githubRequest(token, `POST /repos/${options.targetOwner}/${options.targetRepo}/dispatches`, {
    event_type: 'review-profile-pr',
    client_payload: {
      source_repository: `${options.owner}/${options.repo}`,
      pull_number: Number(pullNumber),
      head_sha: headSha,
    },
  });
}

async function dispatchPagesRebuild(token, options, issueNumber, username) {
  await githubRequest(token, `POST /repos/${options.targetOwner}/${options.targetRepo}/dispatches`, {
    event_type: 'rebuild-pages-from-profiles',
    client_payload: {
      source_repository: `${options.owner}/${options.repo}`,
      profile_issue_number: Number(issueNumber),
      profile_username: username,
    },
  });
}

async function fetchLinkedIssue(token, options, pullRequest) {
  const linkedIssueNumber = extractLinkedIssueNumber(pullRequest.body ?? '');
  if (!linkedIssueNumber) {
    return null;
  }
  return githubRequest(token, `GET /repos/${options.owner}/${options.repo}/issues/${linkedIssueNumber}`);
}

function issueNumberFromComment(comment) {
  const match = String(comment.issue_url ?? '').match(/\/issues\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function decision(value, comment, extra = {}) {
  return {
    decision: value,
    commentId: String(comment.id ?? ''),
    ...extra,
  };
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
