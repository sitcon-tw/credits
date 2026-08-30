import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import sharp from 'sharp';

import { attachTiles } from './bubbles.mjs';
import { ATLAS_SIZE, CROWD_TILE, HERO_LIMIT, HERO_TILE, buildAvatarAtlases, planAtlasSlots } from './avatars.mjs';

const originalFetch = globalThis.fetch;
const cacheDirs = [];

after(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(cacheDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function cacheDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'sitcon-avatars-'));
  cacheDirs.push(dir);
  return dir;
}

function node(id, overrides = {}) {
  return { id, avatarUrl: `https://avatars.test/${id}.png`, core: false, sizeScore: 1, tile: null, ...overrides };
}

async function pngPixels(size = 4) {
  return sharp({ create: { width: size, height: size, channels: 3, background: '#1f7a63' } })
    .png()
    .toBuffer();
}

function stubFetch(png, { rejectFor = new Set() } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (rejectFor.has(String(url))) {
      throw new Error('network down');
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    };
  };
  return calls;
}

test('buildAvatarAtlases with skip performs no network access and emits no atlas', async () => {
  const calls = stubFetch(await pngPixels());
  const nodes = [node('a'), node('b')];

  const result = await buildAvatarAtlases(nodes, { skip: true, cacheDir: await cacheDir() });

  assert.deepEqual(result.files, []);
  assert.equal(result.tiles.size, 0);
  assert.equal(result.misses, 2);
  assert.equal(calls.length, 0);
  assert.deepEqual(
    attachTiles(nodes, result.tiles).map((entry) => entry.tile),
    [null, null],
  );
});

test('buildAvatarAtlases places a small set on the hero layer with 256px cells', async () => {
  const png = await pngPixels();
  stubFetch(png);
  const nodes = [
    node('lead', { core: true, sizeScore: 3 }),
    node('mid', { sizeScore: 1.9 }),
    node('crowd'),
    node('no-avatar', { avatarUrl: '' }),
  ];

  const result = await buildAvatarAtlases(nodes, { cacheDir: await cacheDir(), concurrency: 4 });

  assert.deepEqual(
    result.files.map((file) => file.name),
    ['avatars-hero.webp'],
  );
  assert.deepEqual(result.tiles.get('lead'), [0, 0, 0, HERO_TILE]);
  assert.deepEqual(result.tiles.get('mid'), [0, HERO_TILE, 0, HERO_TILE]);
  assert.deepEqual(result.tiles.get('crowd'), [0, HERO_TILE * 2, 0, HERO_TILE]);
  assert.equal(result.tiles.has('no-avatar'), false);
  assert.equal(result.misses, 1);

  const meta = await sharp(result.files[0].buffer).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, ATLAS_SIZE);
  assert.equal(meta.height, ATLAS_SIZE);
});

test('buildAvatarAtlases overflows past the hero limit onto a crowd layer', async () => {
  const png = await pngPixels();
  stubFetch(png);
  const nodes = [];
  for (let index = 0; index < HERO_LIMIT + 3; index += 1) {
    nodes.push(node(`p${String(index).padStart(3, '0')}`));
  }

  const result = await buildAvatarAtlases(nodes, { cacheDir: await cacheDir(), concurrency: 8 });

  assert.deepEqual(
    result.files.map((file) => file.name),
    ['avatars-0.webp', 'avatars-hero.webp'],
  );
  assert.deepEqual(result.tiles.get('p000'), [1, 0, 0, HERO_TILE]);
  assert.deepEqual(result.tiles.get(`p${String(HERO_LIMIT).padStart(3, '0')}`), [0, 0, 0, CROWD_TILE]);
  assert.deepEqual(result.tiles.get(`p${String(HERO_LIMIT + 1).padStart(3, '0')}`), [0, CROWD_TILE, 0, CROWD_TILE]);
  assert.equal(result.misses, 0);
});

test('buildAvatarAtlases drops nodes whose avatar fetch fails and counts them as misses', async () => {
  const png = await pngPixels();
  const calls = stubFetch(png, { rejectFor: new Set(['https://avatars.test/broken.png']) });
  const nodes = [node('ok'), node('broken')];

  const result = await buildAvatarAtlases(nodes, { cacheDir: await cacheDir(), concurrency: 2 });

  attachTiles(nodes, result.tiles);
  assert.equal(nodes.find((entry) => entry.id === 'broken').tile, null);
  assert.notEqual(nodes.find((entry) => entry.id === 'ok').tile, null);
  assert.equal(result.misses, 1);
  assert.equal(calls.filter((url) => url.endsWith('broken.png')).length, 2);
});

test('buildAvatarAtlases reuses the disk cache instead of refetching', async () => {
  const png = await pngPixels();
  const dir = await cacheDir();
  const nodes = [node('cached')];

  const firstCalls = stubFetch(png);
  await buildAvatarAtlases(nodes, { cacheDir: dir });
  assert.equal(firstCalls.length, 1);

  const secondCalls = stubFetch(png);
  const again = await buildAvatarAtlases(nodes, { cacheDir: dir });
  assert.equal(secondCalls.length, 0);
  assert.deepEqual(again.tiles.get('cached'), [0, 0, 0, HERO_TILE]);
});

test('planAtlasSlots sorts core and high-score nodes onto the hero layer first', () => {
  const nodes = [
    node('zzz', { sizeScore: 4 }),
    node('aaa', { core: true, sizeScore: 1 }),
    node('mmm', { sizeScore: 4 }),
  ];
  const { slots } = planAtlasSlots(nodes);
  assert.deepEqual(
    slots.map((slot) => slot.node.id),
    ['aaa', 'mmm', 'zzz'],
  );
});
