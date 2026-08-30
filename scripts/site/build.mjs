import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildAvatarAtlases } from './avatars.mjs';
import { attachTiles, buildBubbleData } from './bubbles.mjs';

const DEFAULT_EXPORT_PATH = 'tmp/sheets-export/export.json';
const DEFAULT_PROFILES_DIR = '../credits-profiles/profiles';
const DEFAULT_SITE_PROFILES_DIR = '../credits-profiles/site-profiles';
const DEFAULT_ASSETS_DIR = 'public/assets';
const DEFAULT_AVATAR_CACHE_DIR = 'tmp/avatar-cache';
// The badge shader in src/scripts/field/badges.js binds one sampler per atlas layer.
const MAX_ATLAS_LAYERS = 4;

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const payload = await readJson(options.exportPath);
  const [profiles, siteProfiles] = await Promise.all([
    readContributorProfiles(options.profilesDir),
    readSiteProfiles(options.siteProfilesDir),
  ]);
  const siteData = buildSiteData(payload, { profiles, siteProfiles });
  const bubbleData = buildBubbleData(siteData);
  const atlas = await buildAvatarAtlases(bubbleData.nodes, {
    cacheDir: options.avatarCacheDir,
    skip: options.skipAvatars,
  });
  attachTiles(bubbleData.nodes, atlas.tiles);
  bubbleData.atlas.files = atlas.files.map((file) => file.name);

  if (atlas.files.length > MAX_ATLAS_LAYERS) {
    throw new Error(
      `Avatar atlas needs ${atlas.files.length} layers but the badge shader supports ${MAX_ATLAS_LAYERS}; ` +
        'raise the sampler count in src/scripts/field/badges.js.',
    );
  }

  await mkdir(options.assetsDir, { recursive: true });
  await writeFile(path.join(options.assetsDir, 'site-data.json'), `${JSON.stringify(siteData, null, 2)}\n`);
  await writeFile(path.join(options.assetsDir, 'index-data.json'), `${JSON.stringify(bubbleData)}\n`);
  for (const file of atlas.files) {
    await writeFile(path.join(options.assetsDir, file.name), file.buffer);
  }

  console.log(
    `Built ${options.assetsDir}: ${siteData.people.length} profile cards, ${siteData.appearances.length} appearances, ` +
      `${siteData.events.length} events, ${bubbleData.nodes.length} bubbles, ${atlas.tiles.size} avatar tiles (${atlas.misses} missing).`,
  );
}

export function parseArgs(argv) {
  const options = {
    exportPath: DEFAULT_EXPORT_PATH,
    profilesDir: DEFAULT_PROFILES_DIR,
    siteProfilesDir: DEFAULT_SITE_PROFILES_DIR,
    assetsDir: DEFAULT_ASSETS_DIR,
    avatarCacheDir: DEFAULT_AVATAR_CACHE_DIR,
    skipAvatars: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--export') {
      options.exportPath = readNextArg(argv, index, '--export');
      index += 1;
      continue;
    }
    if (arg.startsWith('--export=')) {
      options.exportPath = readInlineArg(arg, '--export');
      continue;
    }
    if (arg === '--profiles-dir') {
      options.profilesDir = readNextArg(argv, index, '--profiles-dir');
      index += 1;
      continue;
    }
    if (arg.startsWith('--profiles-dir=')) {
      options.profilesDir = readInlineArg(arg, '--profiles-dir');
      continue;
    }
    if (arg === '--site-profiles-dir') {
      options.siteProfilesDir = readNextArg(argv, index, '--site-profiles-dir');
      index += 1;
      continue;
    }
    if (arg.startsWith('--site-profiles-dir=')) {
      options.siteProfilesDir = readInlineArg(arg, '--site-profiles-dir');
      continue;
    }
    if (arg === '--assets-dir') {
      options.assetsDir = readNextArg(argv, index, '--assets-dir');
      index += 1;
      continue;
    }
    if (arg.startsWith('--assets-dir=')) {
      options.assetsDir = readInlineArg(arg, '--assets-dir');
      continue;
    }
    if (arg === '--avatar-cache-dir') {
      options.avatarCacheDir = readNextArg(argv, index, '--avatar-cache-dir');
      index += 1;
      continue;
    }
    if (arg.startsWith('--avatar-cache-dir=')) {
      options.avatarCacheDir = readInlineArg(arg, '--avatar-cache-dir');
      continue;
    }
    if (arg === '--skip-avatars') {
      options.skipAvatars = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function readNextArg(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function readInlineArg(arg, name) {
  const value = arg.slice(`${name}=`.length);
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readContributorProfiles(profilesDir) {
  const profiles = new Map();
  for (const entry of await readdir(profilesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('_')) {
      continue;
    }
    const username = path.basename(entry.name, '.json');
    const profile = await readJson(path.join(profilesDir, entry.name));
    profiles.set(username.toLowerCase(), normalizeContributorProfile(username, profile));
  }
  return profiles;
}

function normalizeContributorProfile(username, profile) {
  return {
    username,
    form: normalizeContributorProfileForm(profile),
    displayName: cleanText(profile.display_name) || username,
    bio: cleanText(profile.bio),
    avatarUrl: cleanUrl(profile.avatar_url),
    publicEmail: cleanText(profile.public_email),
    links: Array.isArray(profile.links)
      ? profile.links
          .map((link) => ({
            type: cleanText(link.type),
            label: cleanText(link.label),
            url: cleanUrl(link.url),
          }))
          .filter((link) => link.type && link.url)
      : [],
  };
}

function normalizeContributorProfileForm(profile) {
  return {
    displayName: cleanText(profile.display_name),
    bio: cleanText(profile.bio),
    avatarUrl: cleanUrl(profile.avatar_url),
    publicEmail: cleanText(profile.public_email),
    links: Array.isArray(profile.links)
      ? profile.links
          .map((link) => ({
            type: cleanText(link.type),
            label: cleanText(link.label),
            url: cleanUrl(link.url),
          }))
          .filter((link) => link.type && link.url)
      : [],
  };
}

async function readSiteProfiles(siteProfilesDir) {
  const profiles = new Map();
  for (const eventEntry of await readdir(siteProfilesDir, { withFileTypes: true })) {
    if (!eventEntry.isDirectory()) {
      continue;
    }
    const eventId = eventEntry.name;
    const eventDir = path.join(siteProfilesDir, eventId);
    for (const profileEntry of await readdir(eventDir, { withFileTypes: true })) {
      if (!profileEntry.isFile() || !profileEntry.name.endsWith('.json')) {
        continue;
      }
      const sourcePersonId = path.basename(profileEntry.name, '.json');
      const profile = await readJson(path.join(eventDir, profileEntry.name));
      profiles.set(siteProfileKey(eventId, sourcePersonId), {
        displayName: cleanText(profile.display_name),
        avatarUrl: cleanUrl(profile.avatar_url),
      });
    }
  }
  return profiles;
}

export function buildSiteData(payload, profileData) {
  const events = getSheetRows(payload, 'events');
  const peopleRows = getSheetRows(payload, 'people');
  const appearances = getSheetRows(payload, 'appearances');
  const eventsById = new Map(events.map((event, index) => [event.event_id, normalizeEvent(event, index)]));
  const helperPeople = new Map(
    peopleRows
      .map((person) => [cleanText(person.github_username).toLowerCase(), cleanText(person.display_name)])
      .filter(([username]) => username),
  );
  const peopleByKey = new Map();
  const normalizedAppearances = [];

  for (const [index, row] of appearances.entries()) {
    if (!row.event_id || !row.display_name_at_event) {
      continue;
    }

    const event = eventsById.get(row.event_id) ?? fallbackEvent(row.event_id);
    const profileRef = cleanText(row.github_username);
    const profileKind = classifyProfileRef(profileRef);
    const personKey = personKeyFor(row, profileKind, index, profileRef);
    const roleGroup = cleanText(row.role_group_zh) || cleanText(row.role_group_en);
    const roleTitle = cleanText(row.role_title_zh) || cleanText(row.role_title_en);
    const appearance = {
      id: `${row.event_id}:${index}`,
      personKey,
      claimToken: claimTokenFor(row, profileKind, profileRef),
      eventId: row.event_id,
      eventName: event.name,
      eventSeries: event.series,
      eventYear: event.year,
      eventOrder: event.order,
      roleGroup,
      roleTitle,
      displayNameAtEvent: cleanText(row.display_name_at_event),
      profileRef,
      profileKind,
      sourceUrl: cleanUrl(row.source_url_override) || event.staffSourceUrl || event.speakerSourceUrl || event.officialSiteUrl,
    };
    normalizedAppearances.push(appearance);

    const current =
      peopleByKey.get(personKey) ??
      createPerson(row, profileKind, profileData, helperPeople, event, personKey, profileRef);
    current.appearanceIds.push(appearance.id);
    current.eventYears.add(event.year);
    current.eventIds.add(row.event_id);
    current.roleGroups.add(roleGroup);
    current.sortOrder = Math.min(current.sortOrder, event.order);
    current.searchText.push(
      appearance.displayNameAtEvent,
      appearance.profileRef,
      appearance.eventName,
      appearance.eventSeries,
      appearance.roleGroup,
      appearance.roleTitle,
    );
    peopleByKey.set(personKey, current);
  }

  const people = [...peopleByKey.values()]
    .map((person) => finalizePerson(person, eventsById))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName, 'zh-Hant'));
  const profileForms = Object.fromEntries(
    [...profileData.profiles.values()]
      .sort((left, right) => left.username.toLowerCase().localeCompare(right.username.toLowerCase()))
      .map((profile) => [profile.username.toLowerCase(), profile.form]),
  );

  return {
    generatedAt: new Date().toISOString(),
    sourceExportedAt: cleanText(payload.exportedAt),
    stats: {
      people: people.length,
      appearances: normalizedAppearances.length,
      events: eventsById.size,
      contributorProfiles: people.filter((person) => person.profileKind === 'github').length,
      siteProfiles: people.filter((person) => person.profileKind === 'site').length,
      fallbackProfiles: people.filter((person) => person.profileKind === 'appearance').length,
    },
    filters: {
      years: uniqueSorted(people.flatMap((person) => person.eventYears), eventYearSorter(eventsById)),
      eventSeries: uniqueSorted([...eventsById.values()].map((event) => event.series).filter(Boolean)),
      roleGroups: uniqueSorted(people.flatMap((person) => person.roleGroups)),
    },
    events: [...eventsById.values()].sort((a, b) => a.order - b.order),
    appearances: normalizedAppearances.sort(
      (a, b) => a.eventOrder - b.eventOrder || a.displayNameAtEvent.localeCompare(b.displayNameAtEvent, 'zh-Hant'),
    ),
    people,
    profileForms,
  };
}

function getSheetRows(payload, sheetName) {
  const rows = payload?.sheets?.[sheetName]?.rows;
  if (!Array.isArray(rows)) {
    throw new Error(`Export payload is missing sheets.${sheetName}.rows.`);
  }
  return rows;
}

function normalizeEvent(event, order) {
  return {
    id: cleanText(event.event_id),
    order,
    series: cleanText(event.event_series),
    name: cleanText(event.event_name_zh) || cleanText(event.event_name_en) || cleanText(event.event_id),
    nameEn: cleanText(event.event_name_en),
    year: cleanText(event.event_year),
    officialSiteUrl: cleanUrl(event.official_site_url),
    staffSourceUrl: cleanUrl(event.staff_source_url),
    speakerSourceUrl: cleanUrl(event.speaker_source_url),
  };
}

function fallbackEvent(eventId) {
  return {
    id: eventId,
    order: Number.MAX_SAFE_INTEGER,
    series: '',
    name: eventId,
    nameEn: '',
    year: '',
    officialSiteUrl: '',
    staffSourceUrl: '',
    speakerSourceUrl: '',
  };
}

function classifyProfileRef(profileRef) {
  if (profileRef.startsWith('site:')) {
    return 'site';
  }
  if (profileRef) {
    return 'github';
  }
  return 'appearance';
}

function personKeyFor(row, profileKind, index, profileRef = cleanText(row.github_username)) {
  if (profileKind === 'github') {
    return `github:${profileRef.toLowerCase()}`;
  }
  if (profileKind === 'site') {
    return `site:${row.event_id}/${profileRef.slice('site:'.length)}`;
  }
  return `appearance:${row.event_id}/${index}`;
}

function claimTokenFor(row, profileKind, profileRef) {
  if (profileKind === 'github') {
    return profileRef;
  }
  if (profileKind === 'site') {
    return `${row.event_id}/${profileRef}`;
  }
  return '';
}

function createPerson(row, profileKind, { profiles, siteProfiles }, helperPeople, event, personKey, profileRef) {
  const sourcePersonId = profileKind === 'site' ? profileRef.slice('site:'.length) : '';
  const contributor = profileKind === 'github' ? profiles.get(profileRef.toLowerCase()) : null;
  const siteProfile = profileKind === 'site' ? siteProfiles.get(siteProfileKey(row.event_id, sourcePersonId)) : null;
  const displayName =
    contributor?.displayName ||
    helperPeople.get(profileRef.toLowerCase()) ||
    siteProfile?.displayName ||
    cleanText(row.display_name_at_event) ||
    profileRef ||
    '未命名';

  return {
    key: personKey,
    profileKind,
    profileRef,
    username: contributor?.username || (profileKind === 'github' ? profileRef : ''),
    sourcePersonId,
    displayName,
    avatarUrl: contributor?.avatarUrl || siteProfile?.avatarUrl || '',
    bio: contributor?.bio || '',
    publicEmail: contributor?.publicEmail || '',
    links: contributor?.links || [],
    firstEventName: event.name,
    sortOrder: event.order,
    appearanceIds: [],
    eventYears: new Set(),
    eventIds: new Set(),
    roleGroups: new Set(),
    searchText: [displayName],
  };
}

function siteProfileKey(eventId, sourcePersonId) {
  return `${eventId}/${sourcePersonId}`;
}

function finalizePerson(person, eventsById) {
  const eventIds = [...person.eventIds].filter(Boolean).sort(eventIdSorter(eventsById));
  const eventYears = [...person.eventYears].filter(Boolean).sort(eventYearSorter(eventsById));
  const roleGroups = [...person.roleGroups].filter(Boolean).sort();
  const appearanceCount = person.appearanceIds.length;
  const eventCount = eventIds.length;
  const primaryEventName = eventsById.get(eventIds[0])?.name || person.firstEventName || '';
  const roleSummary = roleGroups.slice(0, 2);
  const summaryParts = [`${appearanceCount} 筆`];
  if (eventCount > 0) {
    summaryParts.push(`${eventCount} 場活動`);
  }

  return {
    ...person,
    canonicalOrder: person.sortOrder,
    claimToken: claimTokenForPerson(person),
    claimable: person.profileKind === 'github' || person.profileKind === 'site',
    eventYears,
    eventIds,
    eventCount,
    primaryEventName,
    roleGroups,
    roleSummary,
    appearanceCount,
    summary: summaryParts.join(' / '),
    searchText: person.searchText.filter(Boolean).join(' ').toLowerCase(),
  };
}

function claimTokenForPerson(person) {
  if (person.profileKind === 'github') {
    return person.username || person.profileRef;
  }
  if (person.profileKind === 'site') {
    return `${person.eventIds.values().next().value}/${person.profileRef}`;
  }
  return '';
}

function uniqueSorted(values, sorter = (a, b) => String(a).localeCompare(String(b), 'zh-Hant')) {
  return [...new Set(values.filter(Boolean))].sort(sorter);
}

function eventIdSorter(eventsById) {
  return (a, b) => (eventsById.get(a)?.order ?? Number.MAX_SAFE_INTEGER) - (eventsById.get(b)?.order ?? Number.MAX_SAFE_INTEGER);
}

function eventYearSorter(eventsById) {
  const orderByYear = new Map();
  for (const event of eventsById.values()) {
    if (!event.year || orderByYear.has(event.year)) {
      continue;
    }
    orderByYear.set(event.year, event.order);
  }
  return (a, b) => (orderByYear.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderByYear.get(b) ?? Number.MAX_SAFE_INTEGER);
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function cleanUrl(value) {
  const text = cleanText(value);
  return /^https?:\/\//.test(text) ? text : '';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
