import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MODES, clusterCentres, groupsFor, packShells, radiusOf, targetsFor } from './grouping.js';

const EVENTS = [
  { id: 'SITCON-Camp-2026', order: 0, series: 'SITCON Camp', name: 'SITCON Camp 2026', year: '2026' },
  { id: 'SITCON-2026', order: 1, series: 'SITCON 年會', name: 'SITCON 2026', year: '2026' },
  { id: 'SITCON-2025', order: 2, series: 'SITCON 年會', name: 'SITCON 2025', year: '2025' },
  { id: 'SITCON-2024', order: 3, series: 'SITCON 年會', name: 'SITCON 2024', year: '2024' },
];

function fixture() {
  const nodes = [];
  for (let index = 0; index < 30; index += 1) {
    const leader = index < 6;
    const event = EVENTS[index % EVENTS.length];
    nodes.push({
      id: `node-${String(index).padStart(2, '0')}`,
      core: leader,
      sizeScore: leader ? 2.4 + (index % 3) * 0.5 : 1 + (index % 4) * 0.2,
      eventIds: [event.id],
      years: [event.year],
      roleGroups: [index % 3 === 0 ? '議程組' : index % 3 === 1 ? '網站組' : ''],
    });
  }
  return nodes;
}

test('MODES lists the four grouping modes', () => {
  assert.deepEqual(MODES, ['core', 'year', 'event', 'role']);
});

test('groupsFor year mode orders groups newest first', () => {
  const groups = groupsFor(fixture(), 'year', EVENTS);
  assert.deepEqual(
    groups.map((group) => group.key),
    ['2026', '2025', '2024'],
  );
  assert.equal(
    groups.reduce((total, group) => total + group.members.length, 0),
    30,
  );
});

test('groupsFor event mode orders groups by event order and labels them', () => {
  const groups = groupsFor(fixture(), 'event', EVENTS);
  assert.deepEqual(
    groups.map((group) => group.key),
    ['SITCON-Camp-2026', 'SITCON-2026', 'SITCON-2025', 'SITCON-2024'],
  );
  assert.equal(groups[0].label, 'SITCON Camp 2026');
});

test('groupsFor role mode buckets blank role groups under 其他 and sorts by size', () => {
  const groups = groupsFor(fixture(), 'role', EVENTS);
  assert.deepEqual(
    groups.map((group) => group.members.length).sort((a, b) => b - a),
    groups.map((group) => group.members.length),
  );
  assert.ok(groups.some((group) => group.key === '其他'));
});

test('groupsFor core mode returns a single group holding every node', () => {
  const nodes = fixture();
  const groups = groupsFor(nodes, 'core', EVENTS);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, nodes.length);
});

test('packShells puts the first badge innermost and grows shells by enclosed volume', () => {
  const { shells, extent } = packShells([26, 13, 13, 13, 13, 13, 13, 13]);

  assert.equal(shells.length, 8);
  for (let index = 1; index < shells.length; index += 1) {
    assert.ok(shells[index] > shells[index - 1], `shell ${index} did not grow`);
  }
  assert.ok(shells[0] < 26, 'the leading badge should sit near the cluster centre');
  assert.ok(extent >= shells.at(-1) + 13);
  // A ball of this extent must be able to hold the summed badge volume.
  const summed = 26 ** 3 + 7 * 13 ** 3;
  assert.ok(extent ** 3 > summed, `${extent ** 3} !> ${summed}`);
});

test('packShells tolerates empty and single-badge clusters', () => {
  assert.equal(packShells([]).shells.length, 0);
  assert.equal(packShells([]).extent, 1);
  const single = packShells([40]);
  assert.equal(single.shells[0], 0);
  assert.equal(single.extent, 40);
});

test('year centres recede along -Z with the newest year nearest the camera', () => {
  const centres = clusterCentres(Float64Array.from([100, 80, 60]), 'year');

  assert.equal(Math.abs(centres[2]), 0);
  for (let index = 1; index < 3; index += 1) {
    assert.ok(
      centres[index * 3 + 2] < centres[(index - 1) * 3 + 2],
      `group ${index} did not recede: ${centres[index * 3 + 2]}`,
    );
  }
  // Each step clears both clusters it separates.
  assert.ok(centres[2] - centres[5] >= 100 + 80);
  assert.ok(centres[5] - centres[8] >= 80 + 60);
});

test('event centres sit on one tilted ring at a constant distance from the origin', () => {
  const extents = Float64Array.from([120, 90, 90, 70, 60]);
  const centres = clusterCentres(extents, 'event');

  const distances = [...extents].map((_, index) =>
    Math.hypot(centres[index * 3], centres[index * 3 + 1], centres[index * 3 + 2]),
  );
  for (const distance of distances) {
    assert.ok(Math.abs(distance - distances[0]) < 1e-9, `${distance} !== ${distances[0]}`);
  }
  // The tilt must leave the screen plane, otherwise the ring reads as flat.
  const deepest = Math.max(...[...extents].map((_, i) => Math.abs(centres[i * 3 + 2])));
  assert.ok(deepest > 0.3 * distances[0], `${deepest} is too shallow for ${distances[0]}`);
});

test('role centres lie on one sphere with the largest group facing the camera', () => {
  const extents = Float64Array.from([150, 120, 90, 70, 60, 40]);
  const centres = clusterCentres(extents, 'role');

  const radius = Math.hypot(centres[0], centres[1], centres[2]);
  for (let index = 0; index < extents.length; index += 1) {
    const distance = Math.hypot(centres[index * 3], centres[index * 3 + 1], centres[index * 3 + 2]);
    assert.ok(Math.abs(distance - radius) < 1e-9, `${distance} !== ${radius}`);
  }
  assert.ok(Math.abs(centres[0]) < 1e-9 && Math.abs(centres[1]) < 1e-9);
  assert.ok(centres[2] > 0, 'group 0 should sit on +Z');
});

test('core mode collapses to a single centre at the origin', () => {
  const centres = clusterCentres(Float64Array.from([200]), 'core');
  assert.deepEqual(Array.from(centres), [0, 0, 0]);
});

test('targetsFor gives leaders the innermost shells of their own cluster', () => {
  const nodes = fixture();
  for (const mode of MODES) {
    const targets = targetsFor(nodes, mode, EVENTS);
    for (const [groupIndex, group] of targets.groups.entries()) {
      const members = group.members.filter((member) => nodes[member].core);
      const others = group.members.filter((member) => !nodes[member].core);
      if (members.length === 0 || others.length === 0) {
        continue;
      }
      const worstLeader = Math.max(...members.map((member) => targets.shell[member]));
      const bestOther = Math.min(...others.map((member) => targets.shell[member]));
      assert.ok(worstLeader <= bestOther, `mode ${mode} group ${groupIndex}: ${worstLeader} > ${bestOther}`);
    }
  }
});

test('targetsFor assigns every node its own cluster centre and a usable extent', () => {
  const nodes = fixture();
  for (const mode of MODES) {
    const targets = targetsFor(nodes, mode, EVENTS);
    assert.equal(targets.tx.length, nodes.length);
    for (const [groupIndex, group] of targets.groups.entries()) {
      for (const member of group.members) {
        assert.equal(targets.groupOf[member], groupIndex);
        assert.equal(targets.tx[member], targets.centres[groupIndex * 3]);
        assert.equal(targets.tz[member], targets.centres[groupIndex * 3 + 2]);
        assert.ok(targets.shell[member] + radiusOf(nodes[member]) <= targets.extents[groupIndex] + 1e-9);
      }
    }
    const widest = Math.max(...nodes.map((node) => radiusOf(node)));
    assert.ok(targets.extent >= widest, `mode ${mode} extent ${targets.extent} < ${widest}`);
  }
});

test('targetsFor is deterministic across calls and across modes', () => {
  const nodes = fixture();
  for (const mode of MODES) {
    const first = targetsFor(nodes, mode, EVENTS);
    const second = targetsFor(nodes, mode, EVENTS);
    for (const key of ['tx', 'ty', 'tz', 'shell', 'centres', 'extents']) {
      assert.deepEqual(Array.from(first[key]), Array.from(second[key]), `mode ${mode} ${key} drifted`);
    }
    assert.equal(first.extent, second.extent);
  }
});

test('targetsFor separates grouped clusters far enough to clear each other', () => {
  const nodes = fixture();
  const targets = targetsFor(nodes, 'year', EVENTS);
  for (let a = 0; a < targets.groups.length; a += 1) {
    for (let b = a + 1; b < targets.groups.length; b += 1) {
      const distance = Math.hypot(
        targets.centres[a * 3] - targets.centres[b * 3],
        targets.centres[a * 3 + 1] - targets.centres[b * 3 + 1],
        targets.centres[a * 3 + 2] - targets.centres[b * 3 + 2],
      );
      assert.ok(
        distance >= targets.extents[a] + targets.extents[b],
        `clusters ${a} and ${b} overlap: ${distance} < ${targets.extents[a] + targets.extents[b]}`,
      );
    }
  }
});

test('targetsFor tolerates an empty node list', () => {
  const targets = targetsFor([], 'core', EVENTS);
  assert.equal(targets.tx.length, 0);
  assert.equal(targets.extent, 1);
});
