import { createHash } from 'node:crypto';

import { getColumnNames, quoteSheetName, spreadsheetColumnName } from '../lib/sheets-config.mjs';

export const CLAIM_CHECK_NAME = 'Confirm Credits appearance links';
export const CLAIM_CHECK_ACTION_ID = 'apply-claims';
export const CLAIM_CHECK_MARKER = '<!-- sitcon-credits-profile-claim-confirmation -->';
export const CLAIM_COMMENT_APPLY_MARKER = '<!-- sitcon-credits-profile-claim-apply -->';
export const CLAIM_COMMENT_METADATA_MARKER = 'sitcon-credits-profile-claim';

const GITHUB_USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const SITE_PROFILE_REF_PATTERN = /^site:[a-z0-9](?:[a-z0-9-]{0,128}[a-z0-9])?$/;
const CLAIM_URL_PATTERN = /https?:\/\/[^\s<>)"]+/g;

export function buildProfileClaimPlan({ pullRequest, files, sourceIssue = null, exportPayload, acceptAppliedClaims = false }) {
  const usernames = collectChangedProfileUsernames(files);
  const username = usernames[0] ?? '';
  if (!GITHUB_USERNAME_PATTERN.test(username) || usernames.length !== 1) {
    return {
      status: 'not_applicable',
      reason: 'expected-one-profile-username',
      username,
      updates: [],
    };
  }

  const plan = buildProfileClaimPlanFromText({
    username,
    text: [
      pullRequest?.body ?? '',
      sourceIssue?.body ?? '',
    ].join('\n\n'),
    exportPayload,
    acceptAppliedClaims,
  });
  if (plan.status !== 'ready') {
    return plan;
  }
  return {
    ...plan,
    planHash: profileClaimPlanHash({
      pullNumber: pullRequest?.number,
      headSha: pullRequest?.head?.sha,
      username,
      updates: plan.updates,
    }),
  };
}

export function buildProfileClaimPlanFromText({ username, text, exportPayload, acceptAppliedClaims = false, hashContext = {} }) {
  if (!GITHUB_USERNAME_PATTERN.test(username)) {
    return {
      status: 'not_applicable',
      reason: 'invalid-profile-username',
      username,
      updates: [],
    };
  }

  const claimUrls = extractClaimUrls([
    text ?? '',
  ].join('\n\n'));
  const tokens = uniqueClaimTokens(claimUrls.flatMap((url) => parseClaimTokensFromUrl(url)));
  if (tokens.length === 0) {
    return {
      status: 'not_applicable',
      reason: 'no-site-claim-tokens',
      username,
      updates: [],
    };
  }

  const issues = [];
  const updates = [];
  const appearances = exportPayload?.sheets?.appearances?.rows;
  const events = exportPayload?.sheets?.events?.rows;
  if (!Array.isArray(appearances)) {
    throw new Error('export payload must include sheets.appearances.rows.');
  }
  if (!Array.isArray(events)) {
    throw new Error('export payload must include sheets.events.rows.');
  }
  const eventsById = new Map(events.map((event) => [event.event_id, event]));

  for (const token of tokens) {
    const matches = appearances.filter((row) => (
      String(row.event_id ?? '').trim() === token.eventId &&
      String(row.github_username ?? '').trim() === token.profileRef
    ));
    if (matches.length === 0) {
      const appliedMatches = acceptAppliedClaims ? appearances.filter((row) => (
        String(row.event_id ?? '').trim() === token.eventId &&
        String(row.github_username ?? '').trim().toLowerCase() === username.toLowerCase()
      )) : [];
      if (appliedMatches.length === 0) {
        issues.push({
          token: token.raw,
          message: '找不到目前仍使用這個 site: reference 的 canonical appearance',
        });
      }
      continue;
    }

    const event = eventsById.get(token.eventId);
    for (const row of matches) {
      updates.push({
        rowNumber: Number(row._row),
        eventId: token.eventId,
        eventName: event?.event_name_zh || event?.event_name_en || token.eventId,
        displayNameAtEvent: String(row.display_name_at_event ?? '').trim(),
        roleGroup: String(row.role_group_zh || row.role_group_en || '').trim(),
        roleTitle: String(row.role_title_zh || row.role_title_en || '').trim(),
        currentValue: token.profileRef,
        nextValue: username,
        token: token.raw,
      });
    }
  }

  if (issues.length > 0) {
    return {
      status: 'blocked',
      reason: 'claim-token-mismatch',
      username,
      tokens,
      updates,
      issues,
    };
  }

  if (updates.length === 0) {
    return {
      status: 'not_applicable',
      reason: tokens.length > 0 ? 'claim-updates-already-applied' : 'no-matching-claim-updates',
      username,
      tokens,
      updates,
    };
  }

  return {
    status: 'ready',
    reason: 'ready',
    username,
    tokens,
    updates,
    planHash: profileClaimPlanHash({
      ...hashContext,
      username,
      updates,
    }),
  };
}

export function buildProfileClaimPlanFromIssue({ issue, username, exportPayload, acceptAppliedClaims = false }) {
  return buildProfileClaimPlanFromText({
    username,
    text: issue?.body ?? '',
    exportPayload,
    acceptAppliedClaims,
    hashContext: {
      issueNumber: issue?.number,
    },
  });
}

export function buildSheetValueUpdates(config, plan) {
  const appearancesSheet = config.sheets.find((sheet) => sheet.title === 'appearances');
  if (!appearancesSheet) {
    throw new Error('config is missing the appearances sheet.');
  }
  const columns = getColumnNames(appearancesSheet);
  const columnIndex = columns.indexOf('github_username');
  if (columnIndex < 0) {
    throw new Error('appearances sheet is missing github_username.');
  }
  const columnName = spreadsheetColumnName(columnIndex + 1);

  return plan.updates.map((update) => ({
    range: `${quoteSheetName('appearances')}!${columnName}${update.rowNumber}`,
    values: [[update.nextValue]],
  }));
}

export function formatClaimCheckOutput(plan, options = {}) {
  if (plan.status === 'ready') {
    return {
      title: `等待維護者確認 ${plan.updates.length} 筆歷史貢獻連結`,
      summary: [
        CLAIM_CHECK_MARKER,
        `profile username: \`${plan.username}\``,
        '',
        '下列 canonical appearances 目前仍使用活動網站來源的 `site:` reference。若確認這些項目是在記錄此 PR 的使用者，請按下 **更新 Sheet**。',
        '',
        formatUpdatesTable(plan.updates),
        '',
        fallbackText(options),
      ].filter(Boolean).join('\n'),
      text: [
        '按下確認後，系統會重新讀取 canonical Google Sheet，確認目前值仍完全符合上表的 `site:` reference，才會寫入裸 GitHub username。',
        '',
        '這個動作代表維護者確認身份連結；profile PR 仍會回到既有自動 review 流程處理。',
      ].join('\n'),
      conclusion: 'action_required',
    };
  }

  return {
    title: '無法建立可套用的歷史貢獻連結確認',
    summary: [
      CLAIM_CHECK_MARKER,
      `profile username: \`${plan.username || 'unknown'}\``,
      '',
      `狀態：${plan.reason}`,
      '',
      plan.issues?.length ? formatIssues(plan.issues) : '',
      plan.updates?.length ? formatUpdatesTable(plan.updates) : '',
      '',
      '請維護者人工檢查 PR 內的貢獻紀錄標記網址與 canonical Google Sheet。',
    ].filter(Boolean).join('\n'),
    text: '',
    conclusion: 'neutral',
  };
}

export function formatApplySuccessOutput(plan) {
  return {
    title: `已更新 ${plan.updates.length} 筆 canonical appearances`,
    summary: [
      CLAIM_CHECK_MARKER,
      `profile username: \`${plan.username}\``,
      '',
      formatUpdatesTable(plan.updates),
      '',
      '已重新匯出並驗證 canonical data；profile PR review 會接續重跑。',
    ].join('\n'),
    text: '',
    conclusion: 'success',
  };
}

export function formatApplyFailureOutput(message) {
  return {
    title: '更新 canonical appearances 失敗',
    summary: [
      CLAIM_CHECK_MARKER,
      '系統沒有完成 Google Sheet 更新。',
      '',
      `錯誤：${message}`,
    ].join('\n'),
    text: '',
    conclusion: 'failure',
  };
}

export function formatClaimCommentBody(plan, options = {}) {
  const metadata = {
    mode: options.mode ?? 'pull_request',
    pull_number: options.pullNumber,
    issue_number: options.issueNumber,
    head_sha: options.headSha,
    plan_hash: plan.planHash ?? '',
    username: plan.username ?? '',
  };
  const metadataComment = `<!-- ${CLAIM_COMMENT_METADATA_MARKER}: ${JSON.stringify(metadata)} -->`;

  if (plan.status === 'ready') {
    return [
      CLAIM_CHECK_MARKER,
      metadataComment,
      '### 維護者確認歷史貢獻連結',
      '',
      `profile username: \`${plan.username}\``,
      '',
      `下列 canonical appearances 目前仍使用活動網站來源的 \`site:\` reference。若確認這些項目是在記錄此${options.mode === 'issue' ? ' issue' : ' PR'}的使用者，請勾選下面的確認項目。`,
      '',
      formatUpdatesTable(plan.updates),
      '',
      `- [ ] 我已確認上述 ${plan.updates.length} 筆歷史貢獻連結，請更新 SITCON Credits canonical Google Sheets。 ${CLAIM_COMMENT_APPLY_MARKER}`,
      '',
      '勾選後，系統會重新讀取 canonical Google Sheet，確認目前值仍完全符合上表的 `site:` reference，才會寫入裸 GitHub username。',
    ].join('\n');
  }

  return [
    CLAIM_CHECK_MARKER,
    metadataComment,
    '### 無法建立可套用的歷史貢獻連結確認',
    '',
    `profile username: \`${plan.username || 'unknown'}\``,
    '',
    `狀態：${plan.reason}`,
    '',
    plan.issues?.length ? formatIssues(plan.issues) : '',
    plan.updates?.length ? formatUpdatesTable(plan.updates) : '',
    '',
    `請維護者人工檢查${options.mode === 'issue' ? ' issue' : ' PR'} 內的貢獻紀錄標記網址與 canonical Google Sheet。`,
  ].filter(Boolean).join('\n');
}

export function extractClaimUrls(text) {
  return [...String(text ?? '').matchAll(CLAIM_URL_PATTERN)]
    .map((match) => match[0].replace(/[.,。]+$/, ''))
    .filter((url) => {
      try {
        return parseClaimTokensFromUrl(url).length > 0;
      } catch {
        return false;
      }
    });
}

export function parseClaimTokensFromUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    return [];
  }
  const claims = url.searchParams.get('claims') ?? '';
  return claims.split(',')
    .map((claim) => parseClaimToken(claim))
    .filter(Boolean);
}

export function parseClaimToken(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const slashIndex = raw.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }
  const eventId = raw.slice(0, slashIndex);
  const profileRef = raw.slice(slashIndex + 1);
  if (!eventId || !SITE_PROFILE_REF_PATTERN.test(profileRef)) {
    return null;
  }
  return { raw, eventId, profileRef };
}

export function collectChangedProfileUsernames(files) {
  const usernames = new Set();
  for (const file of files ?? []) {
    const filename = file.filename ?? file.path ?? '';
    const status = file.status ?? file.changeType ?? '';
    if (status === 'removed' || status === 'renamed') {
      continue;
    }
    const match = /^profiles\/([^/_][^/]*)\.json$/.exec(filename);
    if (match) {
      usernames.add(match[1]);
    }
  }
  return [...usernames].sort((left, right) => left.localeCompare(right));
}

export function profileClaimPlanHash(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 16);
}

function uniqueClaimTokens(tokens) {
  const byRaw = new Map();
  for (const token of tokens) {
    byRaw.set(token.raw, token);
  }
  return [...byRaw.values()].sort((left, right) => left.raw.localeCompare(right.raw));
}

function formatUpdatesTable(updates) {
  return [
    '| Sheet row | 活動 | 活動頁名稱 | 原值 | 新值 |',
    '| --- | --- | --- | --- | --- |',
    ...updates.map((update) => [
      update.rowNumber,
      update.eventName || update.eventId,
      update.displayNameAtEvent || '（未填）',
      `\`${update.currentValue}\``,
      `\`${update.nextValue}\``,
    ].join(' | ')).map((line) => `| ${line} |`),
  ].join('\n');
}

function formatIssues(issues) {
  return [
    '無法自動套用的標記：',
    ...issues.map((issue) => `- \`${issue.token}\`: ${issue.message}`),
  ].join('\n');
}

function fallbackText(options) {
  if (!options.workflowUrl) {
    return '';
  }
  return `若 GitHub 沒有觸發按鈕事件，可用 fallback workflow：${options.workflowUrl}`;
}
