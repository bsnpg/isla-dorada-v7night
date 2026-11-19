// Isla Dorada — sky, sun and golden-hour lighting (REBUILD v2, NEW module).
// v1's sky was a flat orange wash with a small sun disc that read as a plain
// backdrop. This module gives the island a real sunset: a big low sun with a
// glow halo and lens-flare dots, a four-stop gradient dome, warm directional
// light with soft shadows, drifting clouds, and a cool eastern fill so the
// city never goes muddy.
//
// WIRING (coordinator, main.js — this module does NOT touch main.js itself):
//   import { buildSky, buildLights, updateSky } from './sky.js';
//   boot(): replace the inline buildSky(G.scene) / buildLights(G.scene) calls
//   with buildSky(G); buildLights(G);
//   stepPlay(): add updateSky(G, dt);   (optional — static sky still reads
//   correctly without it; update only drifts clouds and pulses the glow)
//   frame() title orbit: unchanged — the dome/sun are scene objects.
// G.sky holds { sun, glow, clouds[], flareDots[], sunLight } for updateSky.
import * as THREE from 'three';
import { PALETTE } from './config.js';

// Low western sun, slightly north — ahead-left of the chase shot (player at
// (-280, 60) heading north) and dead ahead of the title orbit's beach view.
export const SUN_POSITION = new THREE.Vector3(-800, 95, -320);
export const SUN_DIRECTION = SUN_POSITION.clone().normalize();

// Procedural radial-gradient texture (canvas, no network): glow halos, clouds.
function radialTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft cloud puff: several overlapping blobs on one canvas.
function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  const blob = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255, 214, 170, ${a})`);
    g.addColorStop(1, 'rgba(255, 214, 170, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
  };
  blob(70, 78, 52, 0.85);
  blob(128, 62, 62, 0.9);
  blob(186, 80, 50, 0.8);
  blob(110, 88, 46, 0.7);
  blob(160, 90, 44, 0.65);
  const tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildSky(G) {
  const scene = G.scene;

  // ---- gradient dome: deep violet zenith -> magenta -> orange -> gold horizon
  const geo = new THREE.SphereGeometry(900, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x2a2a5e) },
      upper: { value: new THREE.Color(0x8a3a6e) },
      mid: { value: new THREE.Color(PALETTE.skyMid) },
      low: { value: new THREE.Color(PALETTE.skyLow) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 upper; uniform vec3 mid; uniform vec3 low;
      void main(){
        float h = normalize(vP).y;
        vec3 c = h > 0.45 ? mix(upper, top, smoothstep(0.45, 0.95, h))
          : h > 0.12 ? mix(mid, upper, smoothstep(0.12, 0.45, h))
          : mix(low, mid, smoothstep(-0.05, 0.12, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(geo, mat);
  scene.add(dome);

  // ---- the sun itself: bright core + warm disc, big enough to read at a glance
  const sunCore = new THREE.Mesh(
    new THREE.CircleGeometry(34, 40),
    new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false }),
  );
  sunCore.position.copy(SUN_POSITION);
  sunCore.lookAt(0, 40, 0);
  scene.add(sunCore);
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(58, 40),
    new THREE.MeshBasicMaterial({ color: PALETTE.sun, fog: false, transparent: true, opacity: 0.9 }),
  );
  sunDisc.position.copy(SUN_POSITION);
  sunDisc.lookAt(0, 40, 0);
  scene.add(sunDisc);

  // ---- glow halo: huge additive radial sprite around the sun
  const glowTex = radialTexture(256, [
    [0, 'rgba(255, 214, 140, 0.95)'],
    [0.25, 'rgba(255, 170, 90, 0.55)'],
    [0.6, 'rgba(255, 120, 60, 0.18)'],
    [1, 'rgba(255, 120, 60, 0)'],
  ]);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffc27a, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  glow.position.copy(SUN_POSITION);
  glow.scale.set(560, 560, 1);
  scene.add(glow);

  // ---- horizontal anamorphic flare streak through the sun
  const streak = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffd27a, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  streak.position.copy(SUN_POSITION);
  streak.scale.set(900, 90, 1);
  scene.add(streak);

  // ---- lens-flare dots, repositioned every frame between sun and camera
  const flareDots = [];
  const flareCols = [0xffd27a, 0xff9a6a, 0x7ec8e8];
  const flareSizes = [46, 30, 18];
  for (let i = 0; i < 3; i++) {
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: flareCols[i], transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    dot.scale.set(flareSizes[i], flareSizes[i], 1);
    dot.userData.flareT = [0.28, 0.48, 0.66][i];
    scene.add(dot);
    flareDots.push(dot);
  }

  // ---- clouds: warm-lit puffs drifting slowly across the sunset
  const clouds = [];
  const cTex = cloudTexture();
  const cloudSpots = [
    { x: -420, y: 190, z: -520, s: 260 }, { x: -120, y: 240, z: -620, s: 320 },
    { x: 240, y: 210, z: -560, s: 240 }, { x: -560, y: 150, z: 120, s: 280 },
    { x: 420, y: 260, z: -280, s: 300 }, { x: -60, y: 170, z: 560, s: 220 },
    { x: 560, y: 190, z: 240, s: 260 }, { x: -260, y: 280, z: 420, s: 240 },
  ];
  for (const spot of cloudSpots) {
    const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cTex, transparent: true, opacity: 0.85, depthWrite: false, fog: false,
    }));
    cloud.position.set(spot.x, spot.y, spot.z);
    cloud.scale.set(spot.s, spot.s * 0.42, 1);
    cloud.userData.drift = 1.5 + G.rng() * 1.5;
    scene.add(cloud);
    clouds.push(cloud);
  }

  scene.fog = new THREE.Fog(PALETTE.fog, 220, 900);

  G.sky = { sun: sunDisc, sunCore, glow, streak, clouds, flareDots, sunLight: null };
  return G.sky;
}

export function buildLights(G) {
  const scene = G.scene;
  // Warm sky bounce + purple-ish ground bounce: golden hour, not noon.
  const hemi = new THREE.HemisphereLight(0xffc890, 0x4a3a5a, 0.9);
  scene.add(hemi);
  // The low sun: warm, strong, casts the long soft shadows.
  const sun = new THREE.DirectionalLight(0xffb36b, 2.4);
  sun.position.set(-260, 150, -130);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -360; sun.shadow.camera.right = 360;
  sun.shadow.camera.top = 360; sun.shadow.camera.bottom = -360;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);
  // Cool fill from the east so shadow sides of buildings stay readable.
  const fill = new THREE.DirectionalLight(0x5a6ab8, 0.4);
  fill.position.set(300, 120, 200);
  scene.add(fill);
  if (G.sky) G.sky.sunLight = sun;
  return { hemi, sun, fill };
}

// Per-frame sky life: cloud drift, glow breathing, flare dots tracking the
// sun->camera line. Cheap, and safe to call every frame from stepPlay.
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
export function updateSky(G, dt) {
  if (!G.sky) return;
  const sky = G.sky;
  for (const cloud of sky.clouds) {
    cloud.position.x += cloud.userData.drift * dt;
    if (cloud.position.x > 700) cloud.position.x = -700;
  }
  const t = G.time || 0;
  sky.glow.material.opacity = 0.85 + Math.sin(t * 0.9) * 0.06;
  sky.streak.material.opacity = 0.32 + Math.sin(t * 0.7 + 1.3) * 0.05;
  // Flare dots sit on the line from the sun toward the camera; they only
  // read when the camera looks sunward, which is exactly the chase framing.
  if (G.camera) {
    for (const dot of sky.flareDots) {
      const k = dot.userData.flareT;
      _v.copy(SUN_POSITION).lerp(G.camera.position, k);
      dot.position.copy(_v);
      // Fade the dots out when the sun is behind the camera.
      _v2.copy(dot.position).sub(G.camera.position).normalize();
      const facing = SUN_DIRECTION.dot(_v2);
      dot.material.opacity = facing > 0 ? 0.5 * facing : 0;
    }
  }
}
