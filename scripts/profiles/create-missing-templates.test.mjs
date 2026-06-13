import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  collectPeopleUsernames,
  createMissingProfileTemplates,
  parseArgs,
} from './create-missing-templates.mjs';

test('parseArgs accepts export and profiles directory paths', () => {
  assert.deepEqual(parseArgs(['--export=out/export.json', '--profiles-dir', 'profiles']), {
    exportPath: 'out/export.json',
    profilesDir: 'profiles',
  });
});

test('collectPeopleUsernames validates, deduplicates, and sorts usernames', () => {
  assert.deepEqual(
    collectPeopleUsernames([
      { github_username: 'Bob' },
      { github_username: 'alice' },
      { github_username: 'bob' },
      { github_username: '' },
    ]),
    ['alice', 'Bob'],
  );

  assert.throws(
    () => collectPeopleUsernames([{ github_username: '-invalid' }]),
    /not a valid GitHub username/,
  );
});

test('createMissingProfileTemplates writes only missing blank templates', async () => {
  const profilesDir = path.join(await mkdtemp(path.join(tmpdir(), 'sitcon-credits-profiles-')), 'profiles');
  await mkdir(profilesDir, { recursive: true });

  await createMissingProfileTemplates([
    { github_username: 'alice' },
    { github_username: 'Bob' },
  ], profilesDir);
  await createMissingProfileTemplates([
    { github_username: 'ALICE' },
    { github_username: 'bob' },
    { github_username: 'carol' },
  ], profilesDir);

  const alice = JSON.parse(await readFile(path.join(profilesDir, 'alice.json'), 'utf8'));
  const bob = JSON.parse(await readFile(path.join(profilesDir, 'Bob.json'), 'utf8'));
  const carol = JSON.parse(await readFile(path.join(profilesDir, 'carol.json'), 'utf8'));

  assert.equal(alice.display_name, '');
  assert.equal(alice.avatar_url, 'https://github.com/alice.png?size=512');
  assert.equal(bob.bio, '');
  assert.equal(bob.avatar_url, 'https://github.com/Bob.png?size=512');
  assert.equal(carol.avatar_url, 'https://github.com/carol.png?size=512');
  assert.deepEqual(carol.links, []);
});
