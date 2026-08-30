import assert from 'node:assert/strict';
import { test } from 'node:test';

import { targetsFor } from './grouping.js';
import { TUNING, createSimulation } from './simulation.js';

const EVENTS = [
  { id: 'SITCON-Camp-2026', order: 0, series: 'SITCON Camp', name: 'SITCON Camp 2026', year: '2026' },
  { id: 'SITCON-2026', order: 1, series: 'SITCON 年會', name: 'SITCON 2026', year: '2026' },
  { id: 'SITCON-2025', order: 2, series: 'SITCON 年會', name: 'SITCON 2025', year: '2025' },
  { id: 'SITCON-2024', order: 3, series: 'SITCON 年會', name: 'SITCON 2024', year: '2024' },
];

const STEP_MS = 50;

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

/** A simulation on a controllable clock, so the transition window is deterministic. */
function build(nodes, mode = 'core') {
  const state = { now: 0 };
  const sim = createSimulation({ nodes, mode, events: EVENTS, clock: () => state.now });
  return {
    sim,
    run(ticks) {
      for (let tick = 0; tick < ticks; tick += 1) {
        state.now += STEP_MS;
        sim.step(1);
      }
    },
  };
}

function positionOf(sim, index) {
  return [sim.positions[index * 3], sim.positions[index * 3 + 1], sim.positions[index * 3 + 2]];
}

function worstOverlap(sim) {
  let worst = 0;
  for (let a = 0; a < sim.nodeCount; a += 1) {
    for (let b = a + 1; b < sim.nodeCount; b += 1) {
      const [ax, ay, az] = positionOf(sim, a);
      const [bx, by, bz] = positionOf(sim, b);
      const sum = sim.radii[a] + sim.radii[b];
      const overlap = (sum - Math.hypot(bx - ax, by - ay, bz - az)) / sum;
      if (overlap > worst) {
        worst = overlap;
      }
    }
  }
  return worst;
}

function meanDistanceFromOrigin(sim, indexes) {
  return (
    indexes.reduce((total, index) => total + Math.hypot(...positionOf(sim, index)), 0) / Math.max(indexes.length, 1)
  );
}

test('the settled field keeps badges from interpenetrating', () => {
  const { sim, run } = build(fixture());
  run(200);
  assert.ok(worstOverlap(sim) <= 0.05, `worst overlap was ${worstOverlap(sim)}`);
  for (const value of sim.positions) {
    assert.ok(Number.isFinite(value));
  }
});

test('leaders settle closer to the field centre than the crowd', () => {
  const nodes = fixture();
  const { sim, run } = build(nodes);
  run(200);

  const leaders = nodes.map((node, index) => (node.core ? index : -1)).filter((index) => index >= 0);
  const crowd = nodes.map((node, index) => (node.core ? -1 : index)).filter((index) => index >= 0);
  const near = meanDistanceFromOrigin(sim, leaders);
  const far = meanDistanceFromOrigin(sim, crowd);
  assert.ok(near < far, `${near} !< ${far}`);
});

test('the field keeps drifting instead of freezing', () => {
  const { sim, run } = build(fixture());
  run(200);
  const before = Array.from(sim.positions);
  run(40);

  let moved = 0;
  for (let index = 0; index < sim.positions.length; index += 1) {
    moved += Math.abs(sim.positions[index] - before[index]);
  }
  assert.ok(moved > 0, 'the simulation stopped moving');
});

test('two identically driven simulations stay bit-identical', () => {
  const nodes = fixture();
  const first = build(nodes);
  const second = build(nodes);
  first.run(120);
  second.run(120);
  assert.deepEqual(Array.from(first.sim.positions), Array.from(second.sim.positions));
});

test('retarget streams every badge into its new cluster', () => {
  const nodes = fixture();
  for (const mode of ['year', 'event', 'role']) {
    const { sim, run } = build(nodes);
    run(40);
    sim.retarget(mode);
    assert.equal(sim.mode, mode);
    run(120);

    const targets = targetsFor(nodes, mode, EVENTS);
    for (let index = 0; index < nodes.length; index += 1) {
      const group = targets.groupOf[index];
      const [x, y, z] = positionOf(sim, index);
      const distance = Math.hypot(
        x - targets.centres[group * 3],
        y - targets.centres[group * 3 + 1],
        z - targets.centres[group * 3 + 2],
      );
      assert.ok(
        distance <= 1.5 * targets.extents[group],
        `mode ${mode} node ${index}: ${distance} > ${1.5 * targets.extents[group]}`,
      );
    }
    assert.ok(worstOverlap(sim) <= 0.05, `mode ${mode} worst overlap was ${worstOverlap(sim)}`);
  }
});

test('retarget ignores a repeated mode and an empty mode', () => {
  const { sim, run } = build(fixture());
  run(40);
  const before = Array.from(sim.positions);
  sim.retarget('core');
  sim.retarget('');
  assert.equal(sim.mode, 'core');
  sim.step(0);
  assert.deepEqual(Array.from(sim.positions), before);
});

test('hovering pushes neighbours away and releasing lets them back', () => {
  const nodes = fixture();
  const { sim, run } = build(nodes);
  run(200);

  // Pick the largest badge and the neighbours inside its hover reach.
  let hovered = 0;
  for (let index = 1; index < nodes.length; index += 1) {
    if (sim.radii[index] > sim.radii[hovered]) {
      hovered = index;
    }
  }
  const reach = TUNING.hoverReach * sim.radii[hovered];
  const neighbours = [];
  for (let index = 0; index < nodes.length; index += 1) {
    if (index === hovered) {
      continue;
    }
    const [ax, ay, az] = positionOf(sim, hovered);
    const [bx, by, bz] = positionOf(sim, index);
    if (Math.hypot(bx - ax, by - ay, bz - az) < reach) {
      neighbours.push(index);
    }
  }
  assert.ok(neighbours.length > 0, 'the largest badge has no neighbours to push');

  const spread = () => {
    const [ax, ay, az] = positionOf(sim, hovered);
    return (
      neighbours.reduce((total, index) => {
        const [bx, by, bz] = positionOf(sim, index);
        return total + Math.hypot(bx - ax, by - ay, bz - az);
      }, 0) / neighbours.length
    );
  };

  const resting = spread();
  sim.setHovered(hovered);
  run(30);
  const pushed = spread();
  assert.ok(pushed > resting, `${pushed} !> ${resting}`);

  sim.setHovered(-1);
  run(200);
  const returned = spread();
  assert.ok(
    Math.abs(returned - resting) / resting <= 0.15,
    `neighbours did not come back: ${returned} vs ${resting}`,
  );
});

test('freeze stops the field completely', () => {
  const { sim, run } = build(fixture());
  run(60);
  sim.freeze();
  const before = Array.from(sim.positions);
  run(60);
  assert.deepEqual(Array.from(sim.positions), before);

  // A frozen field still arrives at a new arrangement; it just gets there in one batch
  // instead of as an animation, and then holds still again.
  sim.retarget('year');
  assert.equal(sim.mode, 'year');
  const settled = Array.from(sim.positions);
  assert.notDeepEqual(settled, before);
  const targets = targetsFor(fixture(), 'year', EVENTS);
  for (let index = 0; index < sim.nodeCount; index += 1) {
    const group = targets.groupOf[index];
    const [x, y, z] = positionOf(sim, index);
    const distance = Math.hypot(
      x - targets.centres[group * 3],
      y - targets.centres[group * 3 + 1],
      z - targets.centres[group * 3 + 2],
    );
    assert.ok(distance <= 1.5 * targets.extents[group], `node ${index}: ${distance}`);
  }
  run(20);
  assert.deepEqual(Array.from(sim.positions), settled);
});

test('extent and boundingRadius describe the arrangement the camera has to frame', () => {
  const nodes = fixture();
  const { sim, run } = build(nodes);
  run(120);
  assert.ok(sim.extent > 0);
  assert.ok(sim.boundingRadius() > 0);

  const core = sim.extent;
  sim.retarget('year');
  run(120);
  assert.ok(sim.extent > core, `year mode should need more room than core: ${sim.extent} vs ${core}`);
});

test('an empty field does not throw', () => {
  const { sim, run } = build([]);
  run(10);
  assert.equal(sim.nodeCount, 0);
  assert.equal(sim.boundingRadius(), 1);
});
