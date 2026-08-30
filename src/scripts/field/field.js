import gsap from 'gsap';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { FOG_COLOR, createBadges } from './badges.js';
import { createSimulation } from './simulation.js';

const STEP_MS = 50; // 20 Hz simulation, per the measured 13 ms tick cost at published scale
const MAX_CATCHUP = 2;
const MAX_DPR = 2;
const FOV = 45;
const HALF_FOV_SIN = Math.sin((FOV / 2) * (Math.PI / 180));
const EASE = 0.18;
const CLICK_SLOP = 6;

/**
 * Where each mode's camera sits, and how tightly it frames that arrangement.
 *
 * Paddings are close to 1 so the cloud roughly fills the viewport: any tighter and the badges
 * swallow the chrome, any looser and the field becomes a small ball on an empty page. The
 * rim of the cloud is where the fog band bites, so the strips of chrome sit over its faded
 * edge rather than over its dense middle.
 */
const FRAMING = {
  core: { azimuth: -0.6, polar: 1.15, padding: 0.88 },
  // Deliberately inside the corridor, so the near years are large and the far ones fade.
  year: { azimuth: -0.95, polar: 1.3, padding: 0.8 },
  event: { azimuth: -0.5, polar: 0.95, padding: 0.9 },
  role: { azimuth: -0.6, polar: 1.15, padding: 0.92 },
};

export function createField({
  canvas,
  nodes,
  events = [],
  atlas,
  baseUrl = '',
  label = null,
  hudRoot = null,
  onSelect = () => {},
  onHover = () => {},
}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch {
    return { supported: false };
  }
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    return { supported: false };
  }

  const reducedMotion =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.setClearColor(new THREE.Color(FOG_COLOR[0], FOG_COLOR[1], FOG_COLOR[2]), 1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 20000);

  const sim = createSimulation({ nodes, mode: 'core', events });
  const badges = createBadges({
    nodes,
    atlas,
    baseUrl,
    anisotropy: renderer.capabilities.getMaxAnisotropy(),
  });
  scene.add(badges.mesh);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI - 0.15;

  const count = nodes.length;
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const viewPositions = new Float32Array(count * 3);
  const matchAmount = new Float32Array(count).fill(1);
  const hoverAmount = new Float32Array(count);
  const selectedAmount = new Float32Array(count);
  const animating = new Set();

  let mode = 'core';
  let hoverIndex = -1;
  let selectedIndex = -1;
  let frame = 0;
  let accumulator = 0;
  let last = 0;
  let elapsed = 0;
  let frameTimeMs = 0;
  let frameTarget = new THREE.Vector3();
  let leashRadius = 1;
  let disposed = false;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const scratch = new THREE.Vector3();
  const scratchB = new THREE.Vector3();

  viewPositions.set(sim.positions);
  badges.setPositions(viewPositions);
  applyFraming(0);
  resize();
  badges.loadAtlas();

  // --- framing ---------------------------------------------------------------------------

  /**
   * The sphere the camera has to frame, centred on the arrangement rather than the origin.
   * The year corridor runs from the origin into -Z, so framing it from the origin would put
   * half the field behind the camera.
   */
  function framingFor(activeMode) {
    const targets = sim.targets;
    const groups = targets.groups.length;
    const centre = new THREE.Vector3();
    for (let group = 0; group < groups; group += 1) {
      centre.x += targets.centres[group * 3];
      centre.y += targets.centres[group * 3 + 1];
      centre.z += targets.centres[group * 3 + 2];
    }
    centre.divideScalar(Math.max(groups, 1));

    let radius = 1;
    for (let group = 0; group < groups; group += 1) {
      const distance =
        scratch
          .set(targets.centres[group * 3], targets.centres[group * 3 + 1], targets.centres[group * 3 + 2])
          .distanceTo(centre) + targets.extents[group];
      if (distance > radius) {
        radius = distance;
      }
    }

    const plan = FRAMING[activeMode] ?? FRAMING.core;
    const distance = (radius / HALF_FOV_SIN) * plan.padding;
    const position = new THREE.Vector3()
      .setFromSpherical(new THREE.Spherical(distance, plan.polar, plan.azimuth))
      .add(centre);
    return { target: centre, position, radius };
  }

  function applyFraming(duration) {
    const plan = framingFor(mode);
    frameTarget = plan.target;
    leashRadius = plan.radius;
    controls.minDistance = Math.max(plan.radius * 0.12, 20);
    controls.maxDistance = plan.radius * 3.2;
    flyTo(plan.target, plan.position, duration);
  }

  function flyTo(target, position, duration) {
    gsap.killTweensOf([camera.position, controls.target]);
    if (reducedMotion || duration <= 0) {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.enabled = true;
      controls.update();
      return;
    }
    // OrbitControls also writes camera.position; leaving it enabled makes the two fight.
    controls.enabled = false;
    gsap.to(camera.position, { x: position.x, y: position.y, z: position.z, duration, ease: 'power2.inOut' });
    gsap.to(controls.target, {
      x: target.x,
      y: target.y,
      z: target.z,
      duration,
      ease: 'power2.inOut',
      onComplete: () => {
        controls.enabled = true;
        controls.update();
      },
    });
  }

  // --- state -----------------------------------------------------------------------------

  function setMatches(matches) {
    for (let index = 0; index < count; index += 1) {
      matchAmount[index] = matches[index];
      badges.setInstanceState(index, matchAmount[index], hoverAmount[index], selectedAmount[index]);
    }
    badges.commitStates();
  }

  function easeStates() {
    if (animating.size === 0) {
      return;
    }
    for (const index of animating) {
      const hoverGoal = index === hoverIndex ? 1 : 0;
      const selectedGoal = index === selectedIndex ? 1 : 0;
      hoverAmount[index] += (hoverGoal - hoverAmount[index]) * EASE;
      selectedAmount[index] += (selectedGoal - selectedAmount[index]) * EASE;
      const settled =
        Math.abs(hoverGoal - hoverAmount[index]) < 0.002 && Math.abs(selectedGoal - selectedAmount[index]) < 0.002;
      if (settled) {
        hoverAmount[index] = hoverGoal;
        selectedAmount[index] = selectedGoal;
        animating.delete(index);
      }
      badges.setInstanceState(index, matchAmount[index], hoverAmount[index], selectedAmount[index]);
    }
    badges.commitStates();
  }

  function setHover(index) {
    if (index === hoverIndex) {
      return;
    }
    if (hoverIndex >= 0) {
      animating.add(hoverIndex);
    }
    hoverIndex = index;
    if (index >= 0) {
      animating.add(index);
    }
    sim.setHovered(index);
    canvas.classList.toggle('is-pointing', index >= 0);
    onHover(index >= 0 ? nodes[index].id : null);
    updateLabel();
  }

  function setSelected(index) {
    if (index === selectedIndex) {
      return;
    }
    if (selectedIndex >= 0) {
      animating.add(selectedIndex);
    }
    selectedIndex = index;
    if (index >= 0) {
      animating.add(index);
    }
    badges.setSelectedTexture(index >= 0 ? nodes[index] : null);
  }

  function updateLabel() {
    if (!label) {
      return;
    }
    if (hoverIndex < 0) {
      label.classList.remove('is-visible');
      return;
    }
    const rect = canvas.getBoundingClientRect();
    scratchB
      .set(viewPositions[hoverIndex * 3], viewPositions[hoverIndex * 3 + 1], viewPositions[hoverIndex * 3 + 2])
      .project(camera);
    label.textContent = nodes[hoverIndex].displayName;
    label.style.left = `${((scratchB.x + 1) / 2) * rect.width}px`;
    label.style.top = `${((1 - scratchB.y) / 2) * rect.height}px`;
    label.classList.add('is-visible');
  }

  // --- picking ---------------------------------------------------------------------------

  function hitTest(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const origin = raycaster.ray.origin;
    const direction = raycaster.ray.direction;
    let bestIndex = -1;
    let bestT = Infinity;
    for (let index = 0; index < count; index += 1) {
      const ox = viewPositions[index * 3] - origin.x;
      const oy = viewPositions[index * 3 + 1] - origin.y;
      const oz = viewPositions[index * 3 + 2] - origin.z;
      const along = ox * direction.x + oy * direction.y + oz * direction.z;
      const radius = badges.radii[index];
      if (along < -radius) {
        continue;
      }
      const perpendicular = ox * ox + oy * oy + oz * oz - along * along;
      const squared = radius * radius;
      if (perpendicular > squared) {
        continue;
      }
      const half = Math.sqrt(squared - perpendicular);
      const hit = along - half >= 0 ? along - half : along + half;
      if (hit >= 0 && hit < bestT) {
        bestT = hit;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  // --- events ----------------------------------------------------------------------------

  let pressX = 0;
  let pressY = 0;
  let pressed = false;

  function onPointerDown(event) {
    pressed = true;
    pressX = event.clientX;
    pressY = event.clientY;
    canvas.classList.add('is-grabbing');
  }

  function onPointerMove(event) {
    if (pressed) {
      return;
    }
    setHover(hitTest(event.clientX, event.clientY));
  }

  function onPointerUp(event) {
    canvas.classList.remove('is-grabbing');
    if (!pressed) {
      return;
    }
    pressed = false;
    if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > CLICK_SLOP) {
      return;
    }
    const index = hitTest(event.clientX, event.clientY);
    if (index >= 0) {
      focusIndex(index, 1.1);
      onSelect(nodes[index].id);
    } else {
      clearSelection();
    }
  }

  function onPointerLeave() {
    pressed = false;
    canvas.classList.remove('is-grabbing');
    setHover(-1);
  }

  function onDoubleClick() {
    applyFraming(reducedMotion ? 0 : 1.2);
  }

  function onControlsStart() {
    hudRoot?.classList.add('is-interacting');
  }

  function onControlsEnd() {
    hudRoot?.classList.remove('is-interacting');
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('dblclick', onDoubleClick);
  controls.addEventListener('start', onControlsStart);
  controls.addEventListener('end', onControlsEnd);

  // --- public --------------------------------------------------------------------------

  function setMode(nextMode) {
    if (!nextMode || nextMode === mode) {
      return;
    }
    mode = nextMode;
    sim.retarget(nextMode);
    applyFraming(reducedMotion ? 0 : 1.4);
  }

  function focusIndex(index, duration) {
    setSelected(index);
    const point = new THREE.Vector3(
      viewPositions[index * 3],
      viewPositions[index * 3 + 1],
      viewPositions[index * 3 + 2],
    );
    // Keep the current viewing direction so selecting a badge does not spin the world.
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-6) {
      direction.set(0, 0, 1);
    }
    direction.normalize();
    const distance = Math.max(badges.radii[index] * 16, controls.minDistance * 1.2);
    flyTo(point, point.clone().addScaledVector(direction, distance), reducedMotion ? 0 : duration);
  }

  function focusNode(nodeId) {
    const index = indexById.get(nodeId);
    if (index === undefined) {
      return;
    }
    focusIndex(index, 1.1);
  }

  function clearSelection() {
    setSelected(-1);
  }

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    badges.uniforms.uProjScaleY.value =
      0.5 * renderer.getContext().drawingBufferHeight * camera.projectionMatrix.elements[5];
    updateLabel();
  }

  function destroy() {
    disposed = true;
    cancelAnimationFrame(frame);
    gsap.killTweensOf([camera.position, controls.target]);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('dblclick', onDoubleClick);
    controls.removeEventListener('start', onControlsStart);
    controls.removeEventListener('end', onControlsEnd);
    controls.dispose();
    badges.dispose();
    renderer.dispose();
  }

  // --- loop ------------------------------------------------------------------------------

  if (reducedMotion) {
    sim.freeze();
  }

  function fogFactorFor(index) {
    scratchB
      .set(viewPositions[index * 3], viewPositions[index * 3 + 1], viewPositions[index * 3 + 2])
      .applyMatrix4(camera.matrixWorldInverse);
    const distance = -scratchB.z;
    const near = badges.uniforms.uFogNear.value;
    const far = badges.uniforms.uFogFar.value;
    const t = Math.min(1, Math.max(0, (distance - near) / Math.max(1, far - near)));
    return t * t * (3 - 2 * t);
  }

  function tick(now) {
    frame = requestAnimationFrame(tick);
    if (disposed) {
      return;
    }
    const delta = last === 0 ? 16 : Math.min(now - last, 250);
    last = now;
    frameTimeMs = frameTimeMs === 0 ? delta : frameTimeMs * 0.9 + delta * 0.1;
    if (document.hidden) {
      return;
    }
    elapsed += delta;

    accumulator += delta;
    let steps = 0;
    while (accumulator >= STEP_MS && steps < MAX_CATCHUP) {
      sim.step(1);
      accumulator -= STEP_MS;
      steps += 1;
    }
    if (accumulator > STEP_MS * MAX_CATCHUP) {
      accumulator = STEP_MS * MAX_CATCHUP;
    }

    const blend = Math.min(1, accumulator / STEP_MS);
    for (let index = 0; index < viewPositions.length; index += 1) {
      const previous = sim.prevPositions[index];
      viewPositions[index] = previous + (sim.positions[index] - previous) * blend;
    }
    badges.setPositions(viewPositions);
    easeStates();

    controls.update();
    // Soft leash: the field can be panned off-centre, but it always drifts back into view.
    if (controls.target.distanceTo(frameTarget) > leashRadius * 1.1) {
      controls.target.lerp(frameTarget, 0.08);
    }

    const distance = camera.position.distanceTo(controls.target);
    // Camera-relative band. Capping the half-width at a fraction of the camera distance is
    // what makes dollying in *tighten* the fade instead of just sliding it: pulled back, the
    // band spans the whole cloud; pushed in, everything behind the badge you are reading
    // falls away. Exponential fog anchored at distance 0 cannot do both.
    const half = Math.min(leashRadius, distance * 0.6);
    badges.uniforms.uFogNear.value = Math.max(1, distance - half * 0.85);
    badges.uniforms.uFogFar.value = distance + half * 1.25;
    badges.uniforms.uCameraPos.value.copy(camera.position);
    badges.uniforms.uTime.value = reducedMotion ? 0 : elapsed / 1000;

    renderer.render(scene, camera);
    if (hoverIndex >= 0) {
      updateLabel();
    }
  }

  frame = requestAnimationFrame(tick);

  return {
    supported: true,
    setMode,
    setMatches,
    focusNode,
    clearSelection,
    resize,
    destroy,
    debug: {
      nodeCount: count,
      get mode() {
        return mode;
      },
      get positions() {
        return viewPositions;
      },
      get radii() {
        return badges.radii;
      },
      get layerCount() {
        return badges.uniforms.uLayerCount.value;
      },
      get camera() {
        return {
          position: camera.position.toArray(),
          target: controls.target.toArray(),
          distance: camera.position.distanceTo(controls.target),
        };
      },
      get fog() {
        return { near: badges.uniforms.uFogNear.value, far: badges.uniforms.uFogFar.value };
      },
      get frameTimeMs() {
        return frameTimeMs;
      },
      get hovered() {
        return hoverIndex;
      },
      get selected() {
        return selectedIndex;
      },
      get extent() {
        return sim.extent;
      },
      get targets() {
        return sim.targets;
      },
      get reducedMotion() {
        return reducedMotion;
      },
      fogFactorFor,
      hitTest,
    },
  };
}
