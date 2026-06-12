export const PROFILE_REQUEST_FORM_URL = 'https://github.com/sitcon-tw/credits-profiles/issues/new';
export const ISSUE_FORM_TEMPLATE = 'profile-request.yml';
export const ISSUE_FORM_DISPLAY_NAME_FIELD = 'display_name';
export const ISSUE_FORM_BIO_FIELD = 'bio';
export const ISSUE_FORM_AVATAR_URL_FIELD = 'avatar_url';
export const ISSUE_FORM_PUBLIC_EMAIL_FIELD = 'public_email';
export const ISSUE_FORM_HINTS_FIELD = 'historical_hints';
export const ISSUE_FORM_CUSTOM_LINK_LABEL_FIELD = 'link_custom_label';
export const ISSUE_FORM_CUSTOM_LINK_URL_FIELD = 'link_custom_url';
export const CLAIM_MODE_PARAM = 'claim';
export const CLAIMS_PARAM = 'claims';
export const MAX_CLAIM_URL_LENGTH = 7000;
const GITHUB_USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const STANDARD_LINK_FIELDS = new Map([
  ['github', 'link_github'],
  ['website', 'link_website'],
  ['blog', 'link_blog'],
  ['instagram', 'link_instagram'],
  ['telegram', 'link_telegram'],
  ['linkedin', 'link_linkedin'],
  ['facebook', 'link_facebook'],
  ['youtube', 'link_youtube'],
  ['slides', 'link_slides'],
  ['gitlab', 'link_gitlab'],
  ['discord', 'link_discord'],
  ['mastodon', 'link_mastodon'],
  ['threads', 'link_threads'],
  ['x', 'link_x'],
]);

export function isClaimMode(search) {
  return searchParams(search).get(CLAIM_MODE_PARAM) === '1';
}

export function claimTokensFromSearch(search) {
  const params = searchParams(search);
  return parseClaimTokens(params.get(CLAIMS_PARAM) || '');
}

export function claimSearch(tokens, currentSearch = '') {
  const params = searchParams(currentSearch);
  const normalized = normalizeTokens(tokens);
  params.set(CLAIM_MODE_PARAM, '1');
  if (normalized.length > 0) {
    params.set(CLAIMS_PARAM, normalized.join(','));
  } else {
    params.delete(CLAIMS_PARAM);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function claimShareUrl(locationLike, tokens) {
  const base = locationLike.pathname || '/';
  const hash = locationLike.hash || '';
  return `${base}${claimSearch(tokens, locationLike.search || '')}${hash}`;
}

export function profileRequestIssueUrl(claimUrl, options = {}) {
  const baseUrl = typeof options === 'string' ? options : options.baseUrl || PROFILE_REQUEST_FORM_URL;
  const url = new URL(baseUrl);
  url.searchParams.set('template', ISSUE_FORM_TEMPLATE);
  const profile = profileFormForClaimUrl(claimUrl, options.profileForms);
  if (profile) {
    appendProfileFormParams(url.searchParams, profile);
  }
  url.searchParams.set(ISSUE_FORM_HINTS_FIELD, claimUrl);
  return url.toString();
}

export function isClaimUrlTooLong(claimUrl) {
  return claimUrl.length > MAX_CLAIM_URL_LENGTH;
}

function parseClaimTokens(value) {
  return normalizeTokens(String(value || '').split(','));
}

export function githubUsernameFromClaimUrl(claimUrl) {
  let url;
  try {
    url = new URL(String(claimUrl || ''));
  } catch {
    return '';
  }
  const usernames = claimTokensFromSearch(url.search)
    .filter((token) => GITHUB_USERNAME_PATTERN.test(token) && !token.includes('/'));
  return usernames.length === 1 ? usernames[0] : '';
}

export function profileFormForClaimUrl(claimUrl, profileForms = {}) {
  const username = githubUsernameFromClaimUrl(claimUrl);
  if (!username || !profileForms) {
    return null;
  }
  if (profileForms instanceof Map) {
    return profileForms.get(username.toLowerCase()) || null;
  }
  return profileForms[username.toLowerCase()] || null;
}

export function appendProfileFormParams(params, profile) {
  setParamIfPresent(params, ISSUE_FORM_DISPLAY_NAME_FIELD, profile?.displayName);
  setParamIfPresent(params, ISSUE_FORM_BIO_FIELD, profile?.bio);
  setParamIfPresent(params, ISSUE_FORM_AVATAR_URL_FIELD, profile?.avatarUrl);
  setParamIfPresent(params, ISSUE_FORM_PUBLIC_EMAIL_FIELD, profile?.publicEmail);
  for (const link of profile?.links ?? []) {
    if (link.type === 'custom') {
      if (!params.has(ISSUE_FORM_CUSTOM_LINK_URL_FIELD)) {
        setParamIfPresent(params, ISSUE_FORM_CUSTOM_LINK_LABEL_FIELD, link.label);
        setParamIfPresent(params, ISSUE_FORM_CUSTOM_LINK_URL_FIELD, link.url);
      }
      continue;
    }
    const field = STANDARD_LINK_FIELDS.get(link.type);
    if (field && !params.has(field)) {
      setParamIfPresent(params, field, link.url);
    }
  }
}

function setParamIfPresent(params, key, value) {
  const text = String(value ?? '').trim();
  if (text) {
    params.set(key, text);
  }
}

function normalizeTokens(tokens) {
  return [...new Set(Array.from(tokens, (token) => String(token || '').trim()).filter(Boolean))].sort();
}

function searchParams(search) {
  const text = String(search || '').replace(/^\?/, '');
  return new URLSearchParams(text);
}
