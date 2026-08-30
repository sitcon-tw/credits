const CORE_SERIES = 'SITCON 年會';
const CORE_ROLE_WEIGHT = 1.7;
const SIZE_SCORE_MIN = 1;
const SIZE_SCORE_MAX = 4;
const PALETTE = ['#1f7a63', '#b44e33', '#d99a2b', '#315f9f'];

const ROLE_WEIGHTS = new Map([
  ['總召', 3],
  ['總召集人', 3],
  ['副召', 2.4],
  ['組長', 1.9],
  ['副組長', 1.7],
]);

export function normalizeDisplayName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .toLowerCase();
}

export function roleWeight(roleTitle) {
  const title = String(roleTitle ?? '').trim();
  const exact = ROLE_WEIGHTS.get(title);
  if (exact !== undefined) {
    return exact;
  }
  if (title.includes('股長')) {
    return 1.4;
  }
  return 1;
}

export function hash32(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Display-only clustering of public site-profile records.
 *
 * Site records that share a source_person_id, or share a normalized display name in
 * adjacent event years, are drawn as one bubble. This never links an appearance to a
 * GitHub username and never merges a site record into a GitHub-linked profile.
 */
export function groupPeople(people, appearances, events) {
  const eventIndex = new Map(
    (events ?? []).map((event) => [
      event.id,
      { order: Number.isFinite(event.order) ? event.order : Number.MAX_SAFE_INTEGER, year: parseYear(event.year) },
    ]),
  );
  const personEvents = new Map();
  for (const appearance of appearances ?? []) {
    const list = personEvents.get(appearance.personKey) ?? [];
    if (!list.some((entry) => entry.id === appearance.eventId)) {
      const known = eventIndex.get(appearance.eventId);
      list.push({
        id: appearance.eventId,
        order: known?.order ?? (Number.isFinite(appearance.eventOrder) ? appearance.eventOrder : Number.MAX_SAFE_INTEGER),
        year: known?.year ?? parseYear(appearance.eventYear),
      });
      list.sort((a, b) => a.order - b.order || compareKeys(a.id, b.id));
      personEvents.set(appearance.personKey, list);
    }
  }

  const parents = new Map(people.map((person) => [person.key, person.key]));
  const find = (key) => {
    let root = key;
    while (parents.get(root) !== root) {
      root = parents.get(root);
    }
    let cursor = key;
    while (parents.get(cursor) !== root) {
      const next = parents.get(cursor);
      parents.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a === b) {
      return;
    }
    if (compareKeys(a, b) <= 0) {
      parents.set(b, a);
    } else {
      parents.set(a, b);
    }
  };

  const sitePeople = people.filter((person) => person.profileKind === 'site');

  const bySourceId = new Map();
  for (const person of sitePeople) {
    const sourceId = String(person.sourcePersonId ?? '').trim();
    if (!sourceId) {
      continue;
    }
    const previous = bySourceId.get(sourceId);
    if (previous) {
      union(previous, person.key);
    } else {
      bySourceId.set(sourceId, person.key);
    }
  }

  const byName = new Map();
  for (const person of sitePeople) {
    const name = normalizeDisplayName(person.displayName);
    if (!name) {
      continue;
    }
    const bucket = byName.get(name) ?? [];
    bucket.push(person);
    byName.set(name, bucket);
  }
  for (const bucket of byName.values()) {
    if (bucket.length < 2) {
      continue;
    }
    for (let i = 0; i < bucket.length; i += 1) {
      const left = newestEvent(personEvents, bucket[i]);
      if (!left || left.year === null) {
        continue;
      }
      for (let j = i + 1; j < bucket.length; j += 1) {
        const right = newestEvent(personEvents, bucket[j]);
        if (!right || right.year === null || left.id === right.id) {
          continue;
        }
        if (Math.abs(left.year - right.year) <= 1) {
          union(bucket[i].key, bucket[j].key);
        }
      }
    }
  }

  const clusters = new Map();
  for (const person of people) {
    const root = find(person.key);
    const members = clusters.get(root) ?? [];
    members.push(person.key);
    clusters.set(root, members);
  }

  const sortMembers = (keys) =>
    [...keys].sort((a, b) => memberOrder(personEvents, a) - memberOrder(personEvents, b) || compareKeys(a, b));

  return [...clusters.values()]
    .map((members) => {
      const memberKeys = sortMembers(members);
      return { id: memberKeys[0], memberKeys };
    })
    .sort((a, b) => memberOrder(personEvents, a.id) - memberOrder(personEvents, b.id) || compareKeys(a.id, b.id));
}

export function buildBubbleData(siteData, options = {}) {
  const coreSeries = options.coreSeries ?? CORE_SERIES;
  const atlas = options.atlas ?? { size: 2048, crowdTile: 64, heroTile: 256, files: [] };
  const events = siteData.events ?? [];
  const people = siteData.people ?? [];
  const appearances = siteData.appearances ?? [];
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const peopleByKey = new Map(people.map((person) => [person.key, person]));

  const coreEvent = events.find((event) => event.series === coreSeries) ?? events[0] ?? null;
  const coreEventId = coreEvent?.id ?? '';

  const appearancesByPerson = new Map();
  for (const appearance of appearances) {
    const list = appearancesByPerson.get(appearance.personKey) ?? [];
    list.push(appearance);
    appearancesByPerson.set(appearance.personKey, list);
  }

  const clusters = groupPeople(people, appearances, events);
  const nodeIdByPersonKey = new Map();
  for (const cluster of clusters) {
    for (const memberKey of cluster.memberKeys) {
      nodeIdByPersonKey.set(memberKey, cluster.id);
    }
  }

  const nodes = clusters.map((cluster) => {
    const members = cluster.memberKeys.map((key) => peopleByKey.get(key)).filter(Boolean);
    const primary = members[0];
    const githubMember = members.find((member) => member.profileKind === 'github') ?? null;
    const nodeAppearances = cluster.memberKeys
      .flatMap((key) => appearancesByPerson.get(key) ?? [])
      .sort((a, b) => a.eventOrder - b.eventOrder || compareKeys(a.id, b.id));

    const eventIds = uniqueInOrder(nodeAppearances.map((appearance) => appearance.eventId));
    const years = uniqueInOrder(nodeAppearances.map((appearance) => appearance.eventYear).filter(Boolean));
    const roleGroups = uniqueInOrder(nodeAppearances.map((appearance) => appearance.roleGroup).filter(Boolean));

    const maxRoleWeight = nodeAppearances.reduce(
      (best, appearance) => Math.max(best, roleWeight(appearance.roleTitle)),
      1,
    );
    const topRole =
      nodeAppearances.find((appearance) => appearance.roleTitle && roleWeight(appearance.roleTitle) === maxRoleWeight)
        ?.roleTitle ?? '';

    const eventCount = Math.max(eventIds.length, 1);
    const sizeScore = clamp(
      maxRoleWeight * (1 + 0.35 * Math.log2(eventCount)),
      SIZE_SCORE_MIN,
      SIZE_SCORE_MAX,
    );
    const core = nodeAppearances.some(
      (appearance) => appearance.eventId === coreEventId && roleWeight(appearance.roleTitle) >= CORE_ROLE_WEIGHT,
    );

    const displayName = primary?.displayName ?? cluster.id;
    const avatarUrl = members.map((member) => member.avatarUrl).find(Boolean) ?? '';
    const claimTokens = uniqueInOrder(members.map((member) => member.claimToken).filter(Boolean));
    const searchParts = [
      displayName,
      ...members.map((member) => member.displayName),
      ...members.map((member) => member.username),
      ...nodeAppearances.map((appearance) => appearance.displayNameAtEvent),
      ...nodeAppearances.map((appearance) => appearance.eventName),
      ...nodeAppearances.map((appearance) => appearance.eventSeries),
      ...nodeAppearances.map((appearance) => appearance.eventYear),
      ...roleGroups,
      ...uniqueInOrder(nodeAppearances.map((appearance) => appearance.roleTitle).filter(Boolean)),
    ];

    return {
      id: cluster.id,
      displayName,
      kind: primary?.profileKind ?? 'appearance',
      username: githubMember?.username ?? '',
      memberKeys: cluster.memberKeys,
      eventIds,
      years,
      roleGroups,
      topRole,
      sizeScore: round(sizeScore, 4),
      core,
      appearanceIds: nodeAppearances.map((appearance) => appearance.id),
      tile: null,
      color: PALETTE[hash32(cluster.id) % PALETTE.length],
      avatarUrl,
      bio: githubMember?.bio ?? '',
      publicEmail: githubMember?.publicEmail ?? '',
      links: githubMember?.links ?? [],
      claimTokens,
      search: uniqueInOrder(searchParts.filter(Boolean)).join(' ').toLowerCase(),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    sourceExportedAt: siteData.sourceExportedAt ?? '',
    stats: {
      people: people.length,
      appearances: appearances.length,
      events: eventsById.size,
      nodes: nodes.length,
      coreEventId,
    },
    filters: siteData.filters ?? { years: [], eventSeries: [], roleGroups: [] },
    events,
    atlas: {
      size: atlas.size ?? 2048,
      crowdTile: atlas.crowdTile ?? 64,
      heroTile: atlas.heroTile ?? 256,
      files: atlas.files ?? [],
    },
    nodes,
    appearances: appearances.map((appearance) => ({
      id: appearance.id,
      nodeId: nodeIdByPersonKey.get(appearance.personKey) ?? appearance.personKey,
      eventId: appearance.eventId,
      eventName: appearance.eventName,
      eventSeries: appearance.eventSeries,
      eventYear: appearance.eventYear,
      eventOrder: appearance.eventOrder,
      roleGroup: appearance.roleGroup,
      roleTitle: appearance.roleTitle,
      displayNameAtEvent: appearance.displayNameAtEvent,
      sourceUrl: appearance.sourceUrl,
    })),
  };
}

export function attachTiles(nodes, tiles) {
  for (const node of nodes) {
    node.tile = tiles.get(node.id) ?? null;
  }
  return nodes;
}

function newestEvent(personEvents, person) {
  return personEvents.get(person.key)?.[0] ?? null;
}

function memberOrder(personEvents, key) {
  return personEvents.get(key)?.[0]?.order ?? Number.MAX_SAFE_INTEGER;
}

function parseYear(value) {
  const year = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(year) ? year : null;
}

function compareKeys(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueInOrder(values) {
  return [...new Set(values)];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
