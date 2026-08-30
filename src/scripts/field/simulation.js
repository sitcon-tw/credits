import { forceCollide, forceManyBody, forceSimulation } from 'd3-force-3d';

import { radiusOf, targetsFor } from './grouping.js';

const GOLDEN_ANGLE = 2.399963229728653;

/**
 * Every constant the cloud's behaviour depends on, in one object so it can be swept from a
 * measurement script instead of guessed. The committed values were measured against the
 * invariants asserted in simulation.test.js at both fixture scale (30 nodes) and published
 * scale (1481 nodes).
 */
export const TUNING = {
  // Seeding already places every badge on its equilibrium shell, so the warm-up only has to
  // take the edge off the initial collisions. The rest resolves on screen in the first
  // second, which reads as the field settling into place rather than as a stall.
  warmAlpha: 1,
  warmTicks: 24,
  livingAlpha: 0.34,
  retargetAlpha: 1,
  retargetMs: 2500,

  // Retains 45% of velocity per tick. Heavier damping makes the field static; lighter makes
  // it slosh. Together with the shell/collision frustration this is what keeps the cloud
  // drifting instead of freezing into a lattice.
  velocityDecay: 0.55,

  collidePadding: 1.04,
  collideStrength: 0.85,
  collideIterations: 2,

  // Local repulsion. With the shell force resisting radial inflation this cannot blow a
  // cluster up; what it does is keep shuffling badges *tangentially*, which is the entire
  // source of the cloud's idle drift. Without it the field settles into a dead lattice.
  // theta 1.5 halves the Barnes-Hut traversal cost versus 0.9 with no visible difference.
  repelScale: -0.35,
  repelDistanceMax: 140,
  repelTheta: 1.5,

  // Pull toward each badge's own shell radius around its cluster centre. Hold strength keeps
  // clusters at their packed size; while the cloud is streaming to a new arrangement it is
  // multiplied so the trip actually completes inside the transition window. Alpha alone
  // cannot do that job, because `forceCollide` ignores alpha entirely.
  shellStrength: 0.05,
  travelBoost: 8,
  // A frozen field (prefers-reduced-motion) still has to arrive at a new arrangement. It
  // does so in one synchronous batch instead of as an animation.
  settleTicks: 40,

  // Reach is a multiple of the hovered badge's radius. Measured at published scale, the
  // median nearest-neighbour centre distance for a crowd badge is about 3x its radius, so a
  // reach of 2.4 caught nothing at all and the effect was invisible.
  hoverReach: 5,
  hoverPush: 1.6,
};

export function createSimulation({ nodes, mode = 'core', events = [], clock = Date.now, tuning }) {
  const config = { ...TUNING, ...tuning };
  const count = nodes.length;
  const radii = new Float64Array(count);
  const positions = new Float32Array(count * 3);
  const prevPositions = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    radii[index] = radiusOf(nodes[index]);
  }

  let currentMode = mode;
  let targets = targetsFor(nodes, currentMode, events);
  let frozen = false;
  let retargetUntil = 0;

  const dNodes = seedNodes(nodes, radii, targets);
  const shell = shellForce(config);
  const hover = hoverForce(config);

  const sim = forceSimulation(dNodes, 3)
    .alphaMin(0)
    .alphaDecay(0)
    .velocityDecay(config.velocityDecay)
    .force(
      'collide',
      forceCollide()
        .radius((d) => d.r * config.collidePadding)
        .strength(config.collideStrength)
        .iterations(config.collideIterations),
    )
    .force('shell', shell)
    .force(
      'repel',
      forceManyBody()
        .strength((d) => config.repelScale * d.r)
        .distanceMax(config.repelDistanceMax)
        .theta(config.repelTheta),
    )
    .force('hover', hover)
    // forceSimulation starts its own d3-timer on construction; the render loop drives ticks.
    .stop();

  sim.alpha(config.warmAlpha);
  sim.tick(config.warmTicks);
  sim.alpha(config.livingAlpha);
  writePositions();
  prevPositions.set(positions);

  function writePositions() {
    for (let index = 0; index < count; index += 1) {
      const node = dNodes[index];
      positions[index * 3] = node.x;
      positions[index * 3 + 1] = node.y;
      positions[index * 3 + 2] = node.z;
    }
  }

  function step(ticks = 1) {
    if (frozen || ticks <= 0) {
      return;
    }
    prevPositions.set(positions);
    if (retargetUntil !== 0 && clock() >= retargetUntil) {
      retargetUntil = 0;
      sim.alpha(config.livingAlpha);
      shell.boost(1);
    }
    sim.tick(ticks);
    writePositions();
  }

  function retarget(nextMode) {
    if (!nextMode || nextMode === currentMode) {
      return;
    }
    currentMode = nextMode;
    targets = targetsFor(nodes, currentMode, events);
    for (let index = 0; index < count; index += 1) {
      const node = dNodes[index];
      node.tx = targets.tx[index];
      node.ty = targets.ty[index];
      node.tz = targets.tz[index];
      node.shell = targets.shell[index];
    }
    if (frozen) {
      shell.boost(config.travelBoost);
      sim.alpha(config.retargetAlpha);
      sim.tick(config.settleTicks);
      shell.boost(1);
      sim.alpha(0);
      writePositions();
      prevPositions.set(positions);
      return;
    }
    shell.boost(config.travelBoost);
    sim.alpha(config.retargetAlpha);
    retargetUntil = clock() + config.retargetMs;
  }

  function setHovered(index) {
    hover.set(frozen ? -1 : index);
  }

  function freeze() {
    frozen = true;
    retargetUntil = 0;
    hover.set(-1);
    shell.boost(1);
    sim.alpha(0);
  }

  function boundingRadius() {
    let worst = 1;
    for (let index = 0; index < count; index += 1) {
      const distance =
        Math.hypot(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]) + radii[index];
      if (distance > worst) {
        worst = distance;
      }
    }
    return worst;
  }

  return {
    nodeCount: count,
    positions,
    prevPositions,
    radii,
    step,
    retarget,
    setHovered,
    freeze,
    boundingRadius,
    get mode() {
      return currentMode;
    },
    get extent() {
      return targets.extent;
    },
    get targets() {
      return targets;
    },
  };
}

/**
 * Seed positions before the simulation is constructed, so d3 leaves them alone.
 *
 * Every badge starts on the shell it wants, spread over a Fibonacci sphere around its
 * cluster centre. The field therefore opens already in equilibrium and the warm-up ticks
 * only have to resolve collisions, not discover the arrangement.
 */
function seedNodes(nodes, radii, targets) {
  const count = nodes.length;
  const dNodes = new Array(count);
  for (let index = 0; index < count; index += 1) {
    const shell = targets.shell[index];
    const z = count === 1 ? 0 : 1 - (2 * index) / (count - 1);
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const angle = index * GOLDEN_ANGLE;
    dNodes[index] = {
      index,
      r: radii[index],
      sizeScore: nodes[index].sizeScore || 1,
      x: targets.tx[index] + Math.cos(angle) * ring * shell,
      y: targets.ty[index] + Math.sin(angle) * ring * shell,
      z: targets.tz[index] + z * shell,
      vx: 0,
      vy: 0,
      vz: 0,
      tx: targets.tx[index],
      ty: targets.ty[index],
      tz: targets.tz[index],
      shell,
    };
  }
  return dNodes;
}

/**
 * Pull each badge toward the sphere of radius `shell` centred on its cluster.
 *
 * Radial-only: a badge already on its shell feels nothing, so it is free to drift
 * tangentially, which is where the cloud's motion comes from. There is deliberately no pull
 * toward the cluster centre itself — that is what crushed dense clusters.
 */
function shellForce(config) {
  let nodes = [];
  let boost = 1;

  function force(alpha) {
    const strength = config.shellStrength * boost * alpha;
    for (const node of nodes) {
      const dx = node.x - node.tx;
      const dy = node.y - node.ty;
      const dz = node.z - node.tz;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance < 1e-6) {
        continue;
      }
      const pull = ((distance - node.shell) / distance) * strength;
      node.vx -= dx * pull;
      node.vy -= dy * pull;
      node.vz -= dz * pull;
    }
  }

  force.initialize = (incoming) => {
    nodes = incoming;
  };
  force.boost = (value) => {
    boost = value;
  };

  return force;
}

/**
 * Neighbours give way to the hovered badge.
 *
 * A plain outward velocity kick inside a reach proportional to the hovered badge's radius.
 * Releasing the hover simply stops applying it, and the standing shell/collision balance
 * closes the gap again — no scripted return animation.
 */
function hoverForce(config) {
  let nodes = [];
  let hovered = -1;

  function force(alpha) {
    if (hovered < 0 || hovered >= nodes.length) {
      return;
    }
    const target = nodes[hovered];
    const reach = config.hoverReach * target.r;
    for (const node of nodes) {
      if (node === target) {
        continue;
      }
      let dx = node.x - target.x;
      let dy = node.y - target.y;
      let dz = node.z - target.z;
      let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance >= reach) {
        continue;
      }
      if (distance < 1e-6) {
        dx = 1;
        dy = 0;
        dz = 0;
        distance = 1;
      }
      const push = ((1 - distance / reach) * config.hoverPush * target.r * alpha) / distance;
      node.vx += dx * push;
      node.vy += dy * push;
      node.vz += dz * push;
    }
  }

  force.initialize = (incoming) => {
    nodes = incoming;
  };
  force.set = (index) => {
    hovered = Number.isInteger(index) && index >= 0 ? index : -1;
  };

  return force;
}
