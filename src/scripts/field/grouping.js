/**
 * Display grouping and per-mode spatial targets for the 3D badge field.
 *
 * This module is pure and deterministic — no `Math.random()`, no DOM, no three.js — so the
 * arrangement of every mode can be asserted in `node --test`. It decides *where each mode
 * wants a node to be*; `simulation.js` decides how the cloud actually gets there.
 */

export const MODES = ['core', 'year', 'event', 'role'];

const GOLDEN_ANGLE = 2.399963229728653;
const RADIUS_UNIT = 13;
// How much air the cloud carries. A ball of radius `PACK_SLACK * cbrt(sum of r^3)` holds
// badges whose summed volume fills only `1 / PACK_SLACK^3` of it. Badges pack into a volume,
// so this is a cube root; the 2D `sqrt(sum of r^2)` form overestimates roughly fourfold at
// published scale. The value is not a packing bound but a look decision: at 1.25 the field
// is a solid ball whose opaque near shell hides everything behind it, so neither the depth
// fade nor the leaders at the core are visible. Gaps are the point.
const PACK_SLACK = 1.85;
const OTHER_ROLE_LABEL = '其他';
const ALL_LABEL = '全部';

// Grouped-mode spacing is derived from each cluster's own measured extent so neighbouring
// clusters just clear each other. Sizing everything off the widest cluster instead inflated
// the year corridor past 6000 world units at published scale, further than the cloud can
// travel in a readable transition.
const CLEARANCE = 1.2;
const YEAR_WOBBLE = 0.28;
const EVENT_TILT = 0.384; // 22 degrees about X
// Spherical-cap coverage: n caps of area pi*R^2 over a sphere of area 4*pi*S^2 at ~70% fill.
const ROLE_FILL = 2.8;

export function hash32(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function radiusOf(node) {
  return RADIUS_UNIT * (node.sizeScore || 1);
}

export function groupsFor(nodes, mode, events = []) {
  if (mode === 'core') {
    return [{ key: 'core', label: ALL_LABEL, members: nodes.map((_, index) => index) }];
  }

  const eventsById = new Map(events.map((event) => [event.id, event]));
  const buckets = new Map();
  for (const [index, node] of nodes.entries()) {
    const key = groupKey(node, mode);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      buckets.set(key, [index]);
    }
  }

  const groups = [...buckets.entries()].map(([key, members]) => ({
    key,
    label: groupLabel(key, mode, eventsById),
    members,
  }));

  if (mode === 'year') {
    groups.sort((a, b) => Number(b.key) - Number(a.key) || compareLabel(a.label, b.label));
  } else if (mode === 'event') {
    groups.sort(
      (a, b) =>
        (eventsById.get(a.key)?.order ?? Number.MAX_SAFE_INTEGER) -
          (eventsById.get(b.key)?.order ?? Number.MAX_SAFE_INTEGER) || compareLabel(a.label, b.label),
    );
  } else {
    groups.sort((a, b) => b.members.length - a.members.length || compareLabel(a.label, b.label));
  }

  return groups;
}

/**
 * Assign each badge in a cluster the radius of the shell it belongs on.
 *
 * `radii` must arrive ordered most-important-first. Each badge is placed on the shell that
 * already encloses the volume of everything ranked above it, so the newest annual conference
 * leaders end up innermost and the crowd fans out around them.
 *
 * This is a *shell* target rather than a single centre point on purpose. Pulling every badge
 * in a 216-member cluster toward one point makes the leaders — whose pull scales with their
 * radius — squeeze the crowd between them, and `forceCollide` can only relieve overlap
 * locally, so the cluster settles crushed. Giving each badge its own equilibrium radius
 * removes the inward pressure entirely instead of fighting it.
 */
export function packShells(radii) {
  const shells = new Float64Array(radii.length);
  let covered = 0;
  let extent = 1;
  for (let index = 0; index < radii.length; index += 1) {
    shells[index] = PACK_SLACK * Math.cbrt(covered);
    covered += radii[index] ** 3;
    const reach = shells[index] + radii[index];
    if (reach > extent) {
      extent = reach;
    }
  }
  return { shells, extent };
}

/**
 * Cluster centres for a mode, spaced from the clusters' measured extents.
 *
 * Group 0 is always the one the default camera faces: the newest year at the near end of the
 * corridor, the largest role group on +Z.
 */
export function clusterCentres(extents, mode) {
  const count = extents.length;
  const centres = new Float64Array(count * 3);
  if (mode === 'core' || count <= 1) {
    return centres;
  }

  let widest = 0;
  let summed = 0;
  let squared = 0;
  for (const extent of extents) {
    summed += extent;
    squared += extent * extent;
    if (extent > widest) {
      widest = extent;
    }
  }

  if (mode === 'year') {
    // A corridor receding along -Z. Each step only has to clear the two clusters it separates.
    let z = 0;
    for (let index = 0; index < count; index += 1) {
      if (index > 0) {
        z -= (extents[index - 1] + extents[index]) * CLEARANCE;
      }
      const angle = index * GOLDEN_ANGLE;
      centres[index * 3] = Math.cos(angle) * extents[index] * YEAR_WOBBLE;
      centres[index * 3 + 1] = Math.sin(angle) * extents[index] * YEAR_WOBBLE;
      centres[index * 3 + 2] = z;
    }
    return centres;
  }

  if (mode === 'event') {
    // A ring tilted out of the screen plane, so the far side reads as depth rather than as a
    // flat circle of clusters. The circumference is whatever the clusters need side by side.
    const ring = Math.max(widest * 2, (2 * summed * CLEARANCE) / (2 * Math.PI));
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * 2 * Math.PI;
      const flat = Math.sin(angle) * ring;
      centres[index * 3] = Math.cos(angle) * ring;
      centres[index * 3 + 1] = flat * Math.cos(EVENT_TILT);
      centres[index * 3 + 2] = flat * Math.sin(EVENT_TILT);
    }
    return centres;
  }

  // role: a sphere of orbs, sized so the clusters cover it as spherical caps without
  // crowding. Endpoint-inclusive spiral so group 0 lands exactly on +Z.
  const sphere = Math.max(widest * 2, Math.sqrt(squared / ROLE_FILL) * CLEARANCE);
  for (let index = 0; index < count; index += 1) {
    const z = 1 - (2 * index) / (count - 1);
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const angle = index * GOLDEN_ANGLE;
    centres[index * 3] = Math.cos(angle) * ring * sphere;
    centres[index * 3 + 1] = Math.sin(angle) * ring * sphere;
    centres[index * 3 + 2] = z * sphere;
  }
  return centres;
}

/**
 * Everything a mode's arrangement needs: which cluster each badge belongs to, that cluster's
 * centre, the shell radius the badge wants within it, and a bounding extent for framing.
 */
export function targetsFor(nodes, mode, events = []) {
  const groups = groupsFor(nodes, mode, events);
  const count = nodes.length;
  const tx = new Float64Array(count);
  const ty = new Float64Array(count);
  const tz = new Float64Array(count);
  const shell = new Float64Array(count);
  const groupOf = new Int32Array(count);
  const extents = new Float64Array(groups.length);

  const ordered = groups.map((group) => {
    const members = [...group.members].sort((a, b) => compareMembers(nodes[a], nodes[b]));
    const { shells, extent } = packShells(members.map((member) => radiusOf(nodes[member])));
    return { members, shells, extent };
  });
  for (const [index, entry] of ordered.entries()) {
    extents[index] = entry.extent;
  }

  const centres = clusterCentres(extents, mode);

  let extent = 0;
  for (const [groupIndex, entry] of ordered.entries()) {
    const cx = centres[groupIndex * 3];
    const cy = centres[groupIndex * 3 + 1];
    const cz = centres[groupIndex * 3 + 2];
    extent = Math.max(extent, Math.hypot(cx, cy, cz) + extents[groupIndex]);
    for (const [slot, member] of entry.members.entries()) {
      tx[member] = cx;
      ty[member] = cy;
      tz[member] = cz;
      shell[member] = entry.shells[slot];
      groupOf[member] = groupIndex;
    }
  }

  return { tx, ty, tz, shell, centres, extents, groups, groupOf, extent: Math.max(extent, 1) };
}

function groupKey(node, mode) {
  if (mode === 'year') {
    return node.years?.[0] || '';
  }
  if (mode === 'event') {
    return node.eventIds?.[0] || '';
  }
  return node.roleGroups?.[0] || OTHER_ROLE_LABEL;
}

function groupLabel(key, mode, eventsById) {
  if (mode === 'event') {
    return eventsById.get(key)?.name || key;
  }
  return key || OTHER_ROLE_LABEL;
}

function compareLabel(left, right) {
  return String(left).localeCompare(String(right), 'zh-Hant');
}

function compareMembers(left, right) {
  return (
    Number(Boolean(right.core)) - Number(Boolean(left.core)) ||
    (right.sizeScore || 1) - (left.sizeScore || 1) ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}
