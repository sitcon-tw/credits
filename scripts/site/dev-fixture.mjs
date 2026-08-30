import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SOURCE_URL = 'https://sitcon.org/credits/assets/site-data.json';
const DEFAULT_OUTPUT_DIR = 'tmp/dev';

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const siteData = await fetchSiteData(options.sourceUrl);
  const fixture = buildDevFixture(siteData);
  await writeDevFixture(fixture, options.outputDir);

  console.log(
    [
      `Wrote ${options.outputDir} from ${options.sourceUrl}:`,
      `${fixture.export.sheets.events.rows.length} events,`,
      `${fixture.export.sheets.appearances.rows.length} appearances,`,
      `${fixture.export.sheets.people.rows.length} people rows,`,
      `${fixture.profiles.length} contributor profiles,`,
      `${fixture.siteProfiles.length} site profiles.`,
    ].join(' '),
  );
}

export function parseArgs(argv) {
  const options = { sourceUrl: DEFAULT_SOURCE_URL, outputDir: DEFAULT_OUTPUT_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--source-url' || arg.startsWith('--source-url=')) {
      options.sourceUrl = readValue(argv, index, '--source-url');
      index += arg.includes('=') ? 0 : 1;
      continue;
    }
    if (arg === '--output-dir' || arg.startsWith('--output-dir=')) {
      options.outputDir = readValue(argv, index, '--output-dir');
      index += arg.includes('=') ? 0 : 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function readValue(argv, index, name) {
  const arg = argv[index];
  if (arg.startsWith(`${name}=`)) {
    const inline = arg.slice(`${name}=`.length);
    if (!inline) {
      throw new Error(`${name} requires a value.`);
    }
    return inline;
  }
  const next = argv[index + 1];
  if (!next || next.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return next;
}

async function fetchSiteData(sourceUrl) {
  const response = await fetch(sourceUrl, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download ${sourceUrl}: ${response.status}`);
  }
  return response.json();
}

export function buildDevFixture(siteData) {
  const people = siteData.people ?? [];
  const peopleByKey = new Map(people.map((person) => [person.key, person]));

  const events = (siteData.events ?? []).map((event) => ({
    event_id: event.id,
    event_series: event.series,
    event_name_zh: event.name,
    event_name_en: event.nameEn ?? '',
    event_year: event.year,
    official_site_url: event.officialSiteUrl ?? '',
    staff_source_url: event.staffSourceUrl ?? '',
    speaker_source_url: event.speakerSourceUrl ?? '',
  }));

  const appearances = (siteData.appearances ?? []).map((appearance) => ({
    event_id: appearance.eventId,
    display_name_at_event: appearance.displayNameAtEvent,
    github_username: appearance.profileRef ?? peopleByKey.get(appearance.personKey)?.profileRef ?? '',
    role_group_zh: appearance.roleGroup,
    role_group_en: '',
    role_title_zh: appearance.roleTitle,
    role_title_en: '',
    source_url_override: appearance.sourceUrl ?? '',
  }));

  const peopleRows = people
    .filter((person) => person.profileKind === 'github')
    .map((person) => ({
      github_username: person.username || person.profileRef,
      display_name: person.displayName,
    }));

  const profiles = people
    .filter((person) => person.profileKind === 'github' && (person.username || person.profileRef))
    .map((person) => ({
      username: (person.username || person.profileRef).toLowerCase(),
      profile: profileBody(person),
    }));

  const siteProfiles = people
    .filter((person) => person.profileKind === 'site' && person.sourcePersonId)
    .map((person) => ({
      eventId: person.eventIds?.[0] ?? '',
      sourcePersonId: person.sourcePersonId,
      profile: profileBody(person),
    }))
    .filter((entry) => entry.eventId);

  return {
    export: {
      exportedAt: siteData.sourceExportedAt || siteData.generatedAt || new Date().toISOString(),
      sheets: {
        events: { rows: events },
        appearances: { rows: appearances },
        people: { rows: peopleRows },
      },
    },
    profiles,
    siteProfiles,
  };
}

function profileBody(person) {
  return {
    display_name: person.displayName ?? '',
    avatar_url: person.avatarUrl ?? '',
    bio: person.bio ?? '',
    public_email: person.publicEmail ?? '',
    links: person.links ?? [],
  };
}

async function writeDevFixture(fixture, outputDir) {
  await mkdir(outputDir, { recursive: true });
  await mkdir(path.join(outputDir, 'profiles'), { recursive: true });
  await writeFile(path.join(outputDir, 'export.json'), `${JSON.stringify(fixture.export)}\n`);

  for (const entry of fixture.profiles) {
    await writeFile(
      path.join(outputDir, 'profiles', `${entry.username}.json`),
      `${JSON.stringify(entry.profile, null, 2)}\n`,
    );
  }

  const eventDirs = new Set();
  for (const entry of fixture.siteProfiles) {
    const dir = path.join(outputDir, 'site-profiles', entry.eventId);
    if (!eventDirs.has(dir)) {
      await mkdir(dir, { recursive: true });
      eventDirs.add(dir);
    }
    await writeFile(path.join(dir, `${entry.sourcePersonId}.json`), `${JSON.stringify(entry.profile, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
