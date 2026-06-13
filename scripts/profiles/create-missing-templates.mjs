import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_EXPORT_PATH = 'tmp/sheets-export/export.json';
const DEFAULT_PROFILES_DIR = 'tmp/credits-profiles/profiles';
const GITHUB_USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const payload = JSON.parse(await readFile(options.exportPath, 'utf8'));
  const people = extractPeopleRows(payload);
  const result = await createMissingProfileTemplates(people, options.profilesDir);

  for (const filePath of result.createdFiles) {
    console.log(`Created ${filePath}`);
  }
  console.log(`Created ${result.createdFiles.length} missing profile templates.`);
}

export function parseArgs(argv) {
  const options = {
    exportPath: DEFAULT_EXPORT_PATH,
    profilesDir: DEFAULT_PROFILES_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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

export function extractPeopleRows(payload) {
  const rows = payload?.sheets?.people?.rows;
  if (!Array.isArray(rows)) {
    throw new Error('export payload must include sheets.people.rows.');
  }
  return rows;
}

export async function createMissingProfileTemplates(peopleRows, profilesDir) {
  await mkdir(profilesDir, { recursive: true });
  const existingUsernames = await readExistingProfileUsernames(profilesDir);
  const createdFiles = [];

  for (const username of collectPeopleUsernames(peopleRows)) {
    if (existingUsernames.has(username.toLowerCase())) {
      continue;
    }

    const filePath = path.join(profilesDir, `${username}.json`);
    await writeFile(filePath, `${JSON.stringify(blankProfileTemplate(username), null, 2)}\n`);
    existingUsernames.add(username.toLowerCase());
    createdFiles.push(filePath);
  }

  return { createdFiles };
}

export function collectPeopleUsernames(peopleRows) {
  const usernames = [];
  const seen = new Set();

  for (const row of peopleRows) {
    const username = String(row?.github_username ?? '').trim();
    if (username === '') {
      continue;
    }
    if (!GITHUB_USERNAME_PATTERN.test(username)) {
      throw new Error(`people github_username "${username}" is not a valid GitHub username.`);
    }

    const normalized = username.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    usernames.push(username);
  }

  return usernames.sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
}

async function readExistingProfileUsernames(profilesDir) {
  const entries = await readdir(profilesDir, { withFileTypes: true });
  const usernames = new Set();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('_')) {
      continue;
    }
    usernames.add(path.basename(entry.name, '.json').toLowerCase());
  }

  return usernames;
}

function blankProfileTemplate(username) {
  return {
    $schema: '../schemas/profile.schema.json',
    display_name: '',
    bio: '',
    avatar_url: `https://github.com/${username}.png?size=512`,
    public_email: '',
    links: [],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
