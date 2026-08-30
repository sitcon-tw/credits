import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// sharp is loaded on demand so `--skip-avatars` works on platforms where the
// native binary is unavailable.
let sharpModule = null;

async function loadSharp() {
  if (!sharpModule) {
    sharpModule = (await import('sharp')).default;
  }
  return sharpModule;
}

export const ATLAS_SIZE = 2048;
export const CROWD_TILE = 64;
export const HERO_TILE = 256;
export const HERO_LIMIT = 64;

const BACKGROUND = '#f6f4ee';
const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT = 'sitcon-credits-site-build';
const WEBP_QUALITY = 76;

export function sortForAtlas(nodes) {
  return [...nodes].sort(
    (a, b) =>
      Number(Boolean(b.core)) - Number(Boolean(a.core)) ||
      (b.sizeScore ?? 0) - (a.sizeScore ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function planAtlasSlots(nodes) {
  const ordered = sortForAtlas(nodes).filter((node) => node.avatarUrl);
  const heroes = ordered.slice(0, HERO_LIMIT);
  const crowd = ordered.slice(HERO_LIMIT);
  const perRowCrowd = ATLAS_SIZE / CROWD_TILE;
  const perLayerCrowd = perRowCrowd * perRowCrowd;
  const perRowHero = ATLAS_SIZE / HERO_TILE;
  const crowdLayers = Math.ceil(crowd.length / perLayerCrowd);
  const heroLayer = heroes.length > 0 ? crowdLayers : -1;

  const slots = crowd.map((node, index) => {
    const layer = Math.floor(index / perLayerCrowd);
    const cell = index % perLayerCrowd;
    return {
      node,
      layer,
      x: (cell % perRowCrowd) * CROWD_TILE,
      y: Math.floor(cell / perRowCrowd) * CROWD_TILE,
      cellPx: CROWD_TILE,
    };
  });
  for (const [index, node] of heroes.entries()) {
    slots.push({
      node,
      layer: heroLayer,
      x: (index % perRowHero) * HERO_TILE,
      y: Math.floor(index / perRowHero) * HERO_TILE,
      cellPx: HERO_TILE,
    });
  }

  const files = [];
  for (let layer = 0; layer < crowdLayers; layer += 1) {
    files.push(`avatars-${layer}.webp`);
  }
  if (heroLayer >= 0) {
    files.push('avatars-hero.webp');
  }

  return { slots, files, layerCount: files.length };
}

export async function buildAvatarAtlases(nodes, options = {}) {
  const { cacheDir = 'tmp/avatar-cache', concurrency = 16, skip = false } = options;
  if (skip) {
    return { files: [], tiles: new Map(), misses: nodes.length };
  }

  const { slots, files, layerCount } = planAtlasSlots(nodes);
  if (layerCount === 0) {
    return { files: [], tiles: new Map(), misses: nodes.length };
  }

  await mkdir(cacheDir, { recursive: true });

  const tiles = new Map();
  const compositesByLayer = Array.from({ length: layerCount }, () => []);
  let failures = 0;

  await runPool(slots, concurrency, async (slot) => {
    const raw = await loadAvatarTile(slot.node.avatarUrl, slot.cellPx, cacheDir);
    if (!raw) {
      failures += 1;
      return;
    }
    compositesByLayer[slot.layer].push({
      input: raw,
      raw: { width: slot.cellPx, height: slot.cellPx, channels: 3 },
      left: slot.x,
      top: slot.y,
    });
    tiles.set(slot.node.id, [slot.layer, slot.x, slot.y, slot.cellPx]);
  });

  const sharp = await loadSharp();
  const encoded = [];
  for (const [layer, name] of files.entries()) {
    const composites = compositesByLayer[layer].sort((a, b) => a.top - b.top || a.left - b.left);
    const buffer = await sharp({
      create: { width: ATLAS_SIZE, height: ATLAS_SIZE, channels: 3, background: BACKGROUND },
    })
      .composite(composites)
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    encoded.push({ name, buffer });
  }

  const misses = nodes.length - tiles.size;
  if (failures > 0) {
    console.log(`Avatar atlas: ${failures} avatar(s) could not be fetched or decoded; those bubbles render as flat discs.`);
  }

  return { files: encoded, tiles, misses };
}

async function loadAvatarTile(url, cellPx, cacheDir) {
  const source = await loadSource(url, cacheDir);
  if (!source) {
    return null;
  }
  const sharp = await loadSharp();
  try {
    return await sharp(source, { animated: false })
      .resize(cellPx, cellPx, { fit: 'cover', position: 'attention' })
      .flatten({ background: BACKGROUND })
      .removeAlpha()
      .raw()
      .toBuffer();
  } catch {
    return null;
  }
}

async function loadSource(url, cacheDir) {
  const cachePath = path.join(cacheDir, `${createHash('sha256').update(url).digest('hex')}.bin`);
  try {
    return await readFile(cachePath);
  } catch {
    // Not cached yet; fall through to the network.
  }

  const buffer = await fetchAvatar(url);
  if (!buffer) {
    return null;
  }
  try {
    await writeFile(cachePath, buffer);
  } catch {
    // A cache write failure must not fail the build.
  }
  return buffer;
}

async function fetchAvatar(url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.status >= 500 && attempt === 0) {
        continue;
      }
      if (!response.ok) {
        return null;
      }
      const contentType = response.headers?.get?.('content-type') ?? '';
      if (contentType && !contentType.startsWith('image/')) {
        return null;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch {
      if (attempt === 1) {
        return null;
      }
    }
  }
  return null;
}

async function runPool(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}
