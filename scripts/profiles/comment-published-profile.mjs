import { pathToFileURL } from 'node:url';

import { githubPaginate, githubRequest } from '../lib/github-api.mjs';

export const PROFILE_PUBLISHED_COMMENT_MARKER = '<!-- sitcon-credits-profile-published -->';

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required.');
  }
  if ((!options.pullNumber && !options.issueNumber && !options.sweepOpenProfileRequests) || (!options.username && !options.sweepOpenProfileRequests)) {
    console.log('Profile published comment skipped: issue or pull number and username are required.');
    return;
  }

  if (options.pullNumber) {
    await commentOnPublishedProfilePull(token, options, options.pullNumber, options.username);
  }
  if (options.issueNumber) {
    await commentOnPublishedProfileIssue(token, options, options.issueNumber, options.username);
  }
  if (options.sweepOpenProfileRequests) {
    const count = await sweepOpenProfileRequestIssues(token, options);
    console.log(`Profile published sweep processed ${count} open profile request issue(s).`);
  }
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
      options.pullNumber = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--issue-number') {
      options.issueNumber = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--username') {
      options.username = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--assistant-login') {
      options.assistantLogin = readNextArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--sweep-open-profile-requests') {
      options.sweepOpenProfileRequests = true;
      continue;
    }
    if (arg === '--sweep-limit') {
      options.sweepLimit = Number(readNextArg(argv, index, arg));
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  for (const key of ['owner', 'repo']) {
    if (!options[key]) {
      throw new Error(`Missing required option: ${key}`);
    }
  }
  if (options.sweepLimit !== undefined && (!Number.isInteger(options.sweepLimit) || options.sweepLimit < 1 || options.sweepLimit > 100)) {
    throw new Error('--sweep-limit must be an integer from 1 to 100.');
  }
  return options;
}

export function formatProfilePublishedComment(username) {
  const profileUrl = `https://sitcon.org/credits/#person=${encodeURIComponent(username)}`;
  return [
    PROFILE_PUBLISHED_COMMENT_MARKER,
    `\`${username}\` 的 profile 已合併並部署到 SITCON Credits。`,
    '',
    `可以透過 ${profileUrl} 查看公開呈現效果。`,
  ].join('\n');
}

export async function upsertProfilePublishedComment(token, options, issueNumber, body) {
  const comments = await githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/issues/${issueNumber}/comments?per_page=100`);
  const existing = comments.find((comment) => isAssistantProfilePublishedComment(comment, options.assistantLogin));
  if (existing) {
    if (existing.body !== body) {
      await githubRequest(token, `PATCH /repos/${options.owner}/${options.repo}/issues/comments/${existing.id}`, { body });
    }
    return;
  }
  await githubRequest(token, `POST /repos/${options.owner}/${options.repo}/issues/${issueNumber}/comments`, { body });
}

export async function closeProfileRequestIssue(token, options, issueNumber) {
  await githubRequest(token, `PATCH /repos/${options.owner}/${options.repo}/issues/${issueNumber}`, {
    state: 'closed',
    state_reason: 'completed',
  });
}

export function extractLinkedIssueNumber(body) {
  const match = body?.match(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

export function profileUsernameFromFiles(files) {
  const usernames = new Set();
  for (const file of files) {
    if (file.status === 'removed' || file.status === 'renamed') {
      continue;
    }
    const match = /^profiles\/([^/_][^/]*)\.json$/.exec(file.filename);
    if (match) {
      usernames.add(match[1]);
    }
  }
  return usernames.size === 1 ? [...usernames][0] : '';
}

export async function commentOnPublishedProfilePull(token, options, pullNumber, username = '') {
  const pullRequest = await githubRequest(token, `GET /repos/${options.owner}/${options.repo}/pulls/${pullNumber}`);
  const resolvedUsername = username || await profileUsernameFromPull(token, options, pullNumber);
  if (!resolvedUsername) {
    console.log(`Profile published comment skipped: PR #${pullNumber} does not modify exactly one profile file.`);
    return false;
  }

  const body = formatProfilePublishedComment(resolvedUsername);
  await upsertProfilePublishedComment(token, options, pullNumber, body);
  const linkedIssueNumber = extractLinkedIssueNumber(pullRequest.body ?? '');
  if (linkedIssueNumber) {
    const linkedIssue = await fetchClosableProfileRequestIssue(token, options, linkedIssueNumber);
    if (linkedIssue) {
      await upsertProfilePublishedComment(token, options, linkedIssueNumber, body);
      await closeProfileRequestIssue(token, options, linkedIssueNumber);
    }
  }
  console.log(`Profile published comment updated for PR #${pullNumber}.`);
  return true;
}

export async function commentOnPublishedProfileIssue(token, options, issueNumber, username) {
  const body = formatProfilePublishedComment(username);
  await upsertProfilePublishedComment(token, options, issueNumber, body);
  await closeProfileRequestIssue(token, options, issueNumber);
  console.log(`Profile published comment updated for issue #${issueNumber}.`);
}

export async function sweepOpenProfileRequestIssues(token, options) {
  const limit = options.sweepLimit ?? 50;
  const issues = await githubRequest(
    token,
    `GET /repos/${options.owner}/${options.repo}/issues?state=open&labels=profile-request&sort=updated&direction=desc&per_page=${limit}`,
  );
  let count = 0;
  for (const issue of issues) {
    if (issue.pull_request) {
      continue;
    }
    const pullNumber = await findMergedProfilePullForIssue(token, options, issue.number);
    if (!pullNumber) {
      continue;
    }
    const processed = await commentOnPublishedProfilePull(token, options, pullNumber);
    if (processed) {
      count += 1;
    }
  }
  return count;
}

async function findMergedProfilePullForIssue(token, options, issueNumber) {
  const query = encodeURIComponent(`repo:${options.owner}/${options.repo} is:pr is:merged "#${issueNumber}"`);
  const result = await githubRequest(token, `GET /search/issues?q=${query}&per_page=10`);
  for (const item of result.items ?? []) {
    if (!item.pull_request || item.state !== 'closed') {
      continue;
    }
    const pullRequest = await githubRequest(token, `GET /repos/${options.owner}/${options.repo}/pulls/${item.number}`);
    if (pullRequest.merged_at && extractLinkedIssueNumber(pullRequest.body ?? '') === issueNumber) {
      return item.number;
    }
  }
  return null;
}

async function profileUsernameFromPull(token, options, pullNumber) {
  const files = await githubPaginate(token, `GET /repos/${options.owner}/${options.repo}/pulls/${pullNumber}/files?per_page=100`);
  return profileUsernameFromFiles(files);
}

async function fetchClosableProfileRequestIssue(token, options, issueNumber) {
  const issue = await githubRequest(token, `GET /repos/${options.owner}/${options.repo}/issues/${issueNumber}`);
  if (issue.pull_request || issue.state !== 'open') {
    return null;
  }
  const labels = issue.labels ?? [];
  const hasProfileRequestLabel = labels.some((label) => label.name === 'profile-request');
  return hasProfileRequestLabel ? issue : null;
}

export function isAssistantProfilePublishedComment(comment, assistantLogin = '') {
  if (!comment.body?.includes(PROFILE_PUBLISHED_COMMENT_MARKER)) {
    return false;
  }
  const login = comment.user?.login;
  const allowed = new Set([
    assistantLogin,
    assistantLogin ? `${assistantLogin}[bot]` : '',
    assistantLogin ? `app/${assistantLogin}` : '',
    'sitcon-credits[bot]',
  ].filter(Boolean));
  return allowed.has(login);
}

function readNextArg(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
