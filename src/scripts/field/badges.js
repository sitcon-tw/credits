import * as THREE from 'three';

import { hash32, radiusOf } from './grouping.js';

/** One sampler per atlas layer; scripts/site/build.mjs fails the build past this. */
export const MAX_ATLAS_LAYERS = 4;

/** The page background. Distant badges dissolve into it rather than into a grey haze. */
export const FOG_COLOR = [246 / 255, 244 / 255, 238 / 255];

const MAX_TILT = 0.1047; // 6 degrees
const ATLAS_SIZE = 2048;

const VERTEX_SHADER = /* glsl */ `
precision highp float;

in vec3 position;
in vec3 iOffset;
in vec4 iState;
in float iRadius;
in vec4 iTile;
in vec3 iColor;
in vec2 iTilt;

uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uCameraPos;
uniform float uTime;
uniform float uProjScaleY;
uniform float uAtlasSize;

out vec2 vLocal;
out vec2 vUv;
out float vLayer;
out vec3 vColor;
out float vMatch;
out float vHover;
out float vSelected;
out float vViewDist;
out float vScreenPx;
out float vCellPx;
out vec3 vNormalW;
out vec3 vTangentW;
out vec3 vBitangentW;
out vec3 vViewDirW;

void main() {
  float match = iState.x;
  float hover = iState.y;
  float selected = iState.z;
  float phase = iState.w;

  // Camera basis, straight out of the view matrix: camFwd points from the scene toward the
  // camera, so badges always face the viewer no matter where the orbit ends up.
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 camFwd   = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);

  // Fixed per-badge tilt plus a one-degree shimmer. Frozen when uTime is held constant.
  float yaw = iTilt.x + sin(uTime * 0.35 + phase) * 0.017;
  float cy = cos(yaw);
  float sy = sin(yaw);
  vec3 right1 = normalize(camRight * cy + camFwd * sy);
  vec3 fwd1   = normalize(camFwd * cy - camRight * sy);
  float cp = cos(iTilt.y);
  float sp = sin(iTilt.y);
  vec3 up2  = normalize(camUp * cp + fwd1 * sp);
  vec3 fwd2 = normalize(fwd1 * cp - camUp * sp);

  float emphasis = max(hover, selected);
  float radius = iRadius * mix(0.75, 1.0, match) * mix(1.0, 1.32, emphasis);

  // The pop travels along camFwd, so an emphasised badge genuinely occludes its neighbours
  // instead of merely growing.
  vec3 worldPos = iOffset
                + camFwd * (emphasis * radius * 0.85)
                + (right1 * position.x + up2 * position.y) * (radius * 2.0);

  vec4 mv = viewMatrix * vec4(worldPos, 1.0);
  gl_Position = projectionMatrix * mv;

  vLocal = position.xy * 2.0;
  vUv = iTile.xy + vec2(position.x + 0.5, 0.5 - position.y) * iTile.z;
  vLayer = iTile.w;
  vColor = iColor;
  vMatch = match;
  vHover = hover;
  vSelected = selected;
  vViewDist = -mv.z;
  vScreenPx = radius * uProjScaleY / max(vViewDist, 0.001);
  vCellPx = iTile.z * uAtlasSize;
  vNormalW = fwd2;
  vTangentW = right1;
  vBitangentW = up2;
  vViewDirW = uCameraPos - worldPos;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

in vec2 vLocal;
in vec2 vUv;
in float vLayer;
in vec3 vColor;
in float vMatch;
in float vHover;
in float vSelected;
in float vViewDist;
in float vScreenPx;
in float vCellPx;
in vec3 vNormalW;
in vec3 vTangentW;
in vec3 vBitangentW;
in vec3 vViewDirW;

uniform sampler2D uAtlas0;
uniform sampler2D uAtlas1;
uniform sampler2D uAtlas2;
uniform sampler2D uAtlas3;
uniform sampler2D uSelectedTex;
uniform float uSelectedReady;
uniform float uLayerCount;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogStrength;
uniform vec3 uLightDir;

out vec4 outColor;

const float BEVEL = 0.18;

vec3 sampleAtlas(int layer, vec2 uv, float lod) {
  // Sampler arrays cannot be indexed by a non-constant in GLSL ES, so this is unrolled.
  if (layer == 0) return textureLod(uAtlas0, uv, lod).rgb;
  if (layer == 1) return textureLod(uAtlas1, uv, lod).rgb;
  if (layer == 2) return textureLod(uAtlas2, uv, lod).rgb;
  return textureLod(uAtlas3, uv, lod).rgb;
}

void main() {
  float d = length(vLocal);
  if (d > 1.0) discard;

  // The depth fade, from real view distance inside a camera-relative band. Dollying in
  // tightens the band around what you are looking at; orbiting moves it with the target.
  float fog = clamp((vViewDist - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  fog = fog * fog * (3.0 - 2.0 * fog);

  // Pin badge: flat printed face, edge rolling through 90 degrees at the rim. The specular
  // highlight landing on that band is what gives the disc its thickness.
  float t = clamp((d - (1.0 - BEVEL)) / BEVEL, 0.0, 1.0);
  float ang = t * 1.5707963;
  vec2 rd = d > 1e-4 ? vLocal / d : vec2(0.0);
  vec3 nLocal = vec3(rd * sin(ang), cos(ang));
  vec3 N = normalize(vTangentW * nLocal.x + vBitangentW * nLocal.y + vNormalW * nLocal.z);

  float lod = clamp(log2(max(vCellPx / max(vScreenPx * 2.0, 1.0), 1.0)) + fog * 2.5, 0.0, 4.0);
  vec3 albedo = vColor;
  if (vSelected > 0.5 && uSelectedReady > 0.5) {
    albedo = texture(uSelectedTex, vec2(vLocal.x * 0.5 + 0.5, 0.5 - vLocal.y * 0.5)).rgb;
  } else if (vLayer >= 0.0 && float(int(vLayer + 0.5)) < uLayerCount) {
    albedo = sampleAtlas(int(vLayer + 0.5), vUv, lod);
  }

  vec3 V = normalize(vViewDirW);
  vec3 H = normalize(uLightDir + V);
  float diff = 0.62 + 0.38 * max(dot(N, uLightDir), 0.0);
  float spec = pow(max(dot(N, H), 0.0), 48.0) * 0.55;
  float rimT = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  vec3 color = albedo * diff + vec3(spec) + vColor * rimT * 0.30;
  color += vColor * vHover * 0.55 * smoothstep(1.0 - BEVEL - 0.02, 1.0, d);
  // Filtered-out badges recede toward the page background instead of turning translucent,
  // which would reintroduce the depth-sorting problem opaque badges avoid.
  color = mix(uFogColor, color, mix(0.18, 1.0, vMatch));
  color = mix(color, uFogColor, fog * uFogStrength);

  outColor = vec4(color, 1.0);
}
`;

/**
 * The instanced badge mesh.
 *
 * One draw call for the whole field. Badges are opaque with depth testing, so occlusion is
 * correct and no per-frame depth sort is needed; the circular edge is antialiased by the
 * renderer's MSAA, which covers the `discard` boundary.
 *
 * Colour management is deliberately naive: atlas textures are uploaded as `NoColorSpace` and
 * the renderer outputs `LinearSRGBColorSpace`, so all shading arithmetic happens directly on
 * the stored sRGB values. Converting this to a linear workflow would silently restyle every
 * colour on the page.
 */
export function createBadges({ nodes, atlas, baseUrl, anisotropy = 1 }) {
  const count = nodes.length;
  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute('position', plane.getAttribute('position'));
  geometry.instanceCount = count;

  const offsets = new Float32Array(count * 3);
  const states = new Float32Array(count * 4);
  const radii = new Float32Array(count);
  const tiles = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const tilts = new Float32Array(count * 2);

  const atlasSize = atlas?.size || ATLAS_SIZE;
  const scratch = new THREE.Color();
  for (const [index, node] of nodes.entries()) {
    radii[index] = radiusOf(node);

    // build.mjs emits `tile` as [layer, xPx, yPx, cellPx]; the shader wants normalized UVs.
    const tile = node.tile;
    tiles[index * 4] = tile ? tile[1] / atlasSize : 0;
    tiles[index * 4 + 1] = tile ? tile[2] / atlasSize : 0;
    tiles[index * 4 + 2] = tile ? tile[3] / atlasSize : 0;
    tiles[index * 4 + 3] = tile ? tile[0] : -1;

    scratch.set(node.color || '#cccccc');
    colors[index * 3] = scratch.r;
    colors[index * 3 + 1] = scratch.g;
    colors[index * 3 + 2] = scratch.b;

    const seed = hash32(node.id);
    tilts[index * 2] = (((seed & 0x3ff) / 1023) * 2 - 1) * MAX_TILT;
    tilts[index * 2 + 1] = ((((seed >>> 10) & 0x3ff) / 1023) * 2 - 1) * MAX_TILT;

    states[index * 4] = 1;
    states[index * 4 + 3] = (seed % 6283) / 1000;
  }

  const offsetAttribute = new THREE.InstancedBufferAttribute(offsets, 3).setUsage(THREE.DynamicDrawUsage);
  const stateAttribute = new THREE.InstancedBufferAttribute(states, 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('iOffset', offsetAttribute);
  geometry.setAttribute('iState', stateAttribute);
  geometry.setAttribute('iRadius', new THREE.InstancedBufferAttribute(radii, 1));
  geometry.setAttribute('iTile', new THREE.InstancedBufferAttribute(tiles, 4));
  geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(colors, 3));
  geometry.setAttribute('iTilt', new THREE.InstancedBufferAttribute(tilts, 2));

  const blank = blankTexture();
  const uniforms = {
    uCameraPos: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uProjScaleY: { value: 500 },
    uAtlasSize: { value: atlasSize },
    uAtlas0: { value: blank },
    uAtlas1: { value: blank },
    uAtlas2: { value: blank },
    uAtlas3: { value: blank },
    uSelectedTex: { value: blank },
    uSelectedReady: { value: 0 },
    uLayerCount: { value: 0 },
    uFogColor: { value: new THREE.Vector3(...FOG_COLOR) },
    uFogNear: { value: 1 },
    uFogFar: { value: 1000 },
    uFogStrength: { value: 0.92 },
    uLightDir: { value: new THREE.Vector3(0.45, 0.8, 0.55).normalize() },
  };

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Positions live in an instance attribute the CPU bounding sphere never sees.
  mesh.frustumCulled = false;

  const atlasTextures = [];
  let selectedTexture = null;

  function setPositions(source) {
    offsets.set(source);
    offsetAttribute.needsUpdate = true;
  }

  function setInstanceState(index, match, hover, selected) {
    states[index * 4] = match;
    states[index * 4 + 1] = hover;
    states[index * 4 + 2] = selected;
  }

  function commitStates() {
    stateAttribute.needsUpdate = true;
  }

  async function loadAtlas() {
    const files = atlas?.files ?? [];
    const usable = Math.min(files.length, MAX_ATLAS_LAYERS);
    await Promise.all(
      files.slice(0, usable).map(async (file, layer) => {
        try {
          const response = await fetch(`${baseUrl}/assets/${file}`);
          if (!response.ok) {
            throw new Error(String(response.status));
          }
          const bitmap = await createImageBitmap(await response.blob());
          const texture = new THREE.Texture(bitmap);
          texture.colorSpace = THREE.NoColorSpace;
          texture.generateMipmaps = true;
          // The atlas is laid out with row 0 at the top, so the upload must not flip it.
          texture.flipY = false;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.anisotropy = anisotropy;
          texture.needsUpdate = true;
          atlasTextures[layer] = texture;
          uniforms[`uAtlas${layer}`].value = texture;
          // Layers become visible as they decode; until then those badges draw as enamel.
          uniforms.uLayerCount.value = atlasTextures.filter(Boolean).length;
        } catch {
          // A missing atlas layer only costs those badges their picture.
        }
      }),
    );
    return uniforms.uLayerCount.value;
  }

  /**
   * Swap in a full-resolution avatar for the one selected badge.
   *
   * Crowd badges live in 64 px atlas cells, which are visibly soft once the camera dollies
   * in. Hosts without `access-control-allow-origin` simply fail here and keep the atlas tile.
   */
  function setSelectedTexture(node) {
    if (selectedTexture) {
      selectedTexture.dispose();
      selectedTexture = null;
    }
    uniforms.uSelectedTex.value = blank;
    uniforms.uSelectedReady.value = 0;
    if (!node?.avatarUrl) {
      return;
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.addEventListener('load', () => {
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = true;
      texture.flipY = false;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
      selectedTexture = texture;
      uniforms.uSelectedTex.value = texture;
      uniforms.uSelectedReady.value = 1;
    });
    image.addEventListener('error', () => {
      uniforms.uSelectedReady.value = 0;
    });
    image.src = node.avatarUrl;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    plane.dispose();
    blank.dispose();
    for (const texture of atlasTextures) {
      texture?.dispose();
    }
    selectedTexture?.dispose();
  }

  return {
    mesh,
    material,
    uniforms,
    radii,
    setPositions,
    setInstanceState,
    commitStates,
    loadAtlas,
    setSelectedTexture,
    dispose,
  };
}

function blankTexture() {
  const texture = new THREE.DataTexture(new Uint8Array([204, 204, 204, 255]), 1, 1);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
