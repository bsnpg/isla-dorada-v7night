// Isla Dorada — city construction (REBUILD v2): ground, sea, roads, a DENSE
// island city, beach life, ferris wheel, boardwalk, neon billboards, marina.
// All placement is seeded through G.rng, so the same seed builds the same island.
// Landmark plaza coordinates are UNCHANGED from v1 (missions.js, driving.js
// parked cars and map.js labels all depend on them).
import * as THREE from 'three';
import { PALETTE } from './config.js';
import { pick, range } from './random.js';

export const ROAD_LINES = [-280, -200, -120, -40, 40, 120, 200, 280];

// Landmark plazas — the exact v1 coordinates. Buildings sit offset (+24,+24)
// into the block beside their plaza point, so the road grid stays clear.
export const LANDMARK_SPOTS = {
  casino: { x: -120, z: -200 },
  impound: { x: -120, z: 40 },
  warehouse: { x: 120, z: 240 },
  station: { x: 40, z: -200 },
  marina: { x: -120, z: 240 },
  garage: { x: 40, z: 120 },
  causeway: { x: 260, z: 0 },
  // New v2 landmarks (no v1 dependency; map.js ignores unknown keys).
  ferrisWheel: { x: -290, z: -40 },
  boardwalk: { x: -292, z: 0 },
  harbor: { x: 160, z: 280 },
  beach: { x: -300, z: 0 },
  // Map rework: real POIs the map points to — a fuel stop and a restaurant,
  // so the map legend has somewhere to go (both are real 3D locations below).
  gas: { x: 120, z: -120 },
  restaurant: { x: -120, z: 120 },
};

// Pure data export for other builders: no G needed.
export function getLandmarks() {
  return {
    casino: { ...LANDMARK_SPOTS.casino },
    impound: { ...LANDMARK_SPOTS.impound },
    warehouse: { ...LANDMARK_SPOTS.warehouse },
    station: { ...LANDMARK_SPOTS.station },
    marina: { ...LANDMARK_SPOTS.marina },
    garage: { ...LANDMARK_SPOTS.garage },
    causeway: { ...LANDMARK_SPOTS.causeway },
    ferrisWheel: { ...LANDMARK_SPOTS.ferrisWheel },
    boardwalk: { ...LANDMARK_SPOTS.boardwalk },
    harbor: { ...LANDMARK_SPOTS.harbor },
    beach: { ...LANDMARK_SPOTS.beach },
    gas: { ...LANDMARK_SPOTS.gas },
    restaurant: { ...LANDMARK_SPOTS.restaurant },
  };
}

// Rich, sun-baked palette — pastel beach tones, casino gold, neon accents.
// Deliberately NOT brown boxes: every building gets a vivid colour.
const BUILDING_COLORS = [
  0xe8b04c, 0xd96a4a, 0x4fb3d9, 0x7ec850, 0xe88ab0, 0xf2e6c9,
  0x9a6ad9, 0x5a8fd9, 0xe8a34c, 0x3a7a6a, 0xc23a5a, 0x8ab8d9,
  0xf2c230, 0x6a4a8a, 0xd9d9d9, 0x4a6a8a, 0xe07a3a, 0x2a9a8a,
  0xff8a5a, 0x5ac8a8, 0xd94a8a, 0xa8c84a,
];
const WINDOW_COLORS = [0xffc86a, 0xff9a4a, 0xffe9a8, 0x7ec8e8, 0xffd76a, 0x2a3540, 0xffc86a, 0xff9a4a];
const AWNING_COLORS = [0xc23a3a, 0x3f7fd9, 0x7ec850, 0xf2c230, 0xe88ab0, 0x2a9a8a, 0xff8a5a];
const UMBRELLA_COLORS = [0xc23a3a, 0xf2c230, 0x3f7fd9, 0x7ec850, 0xe88ab0, 0xff8a5a, 0xffffff, 0x2a9a8a];

// Landmark buildings: same plaza, same offset, same footprint logic as v1,
// but taller casino tower, brighter colours and real text signs (see below).
const LANDMARK_BUILDINGS = [
  { key: 'casino', w: 28, d: 22, h: 62, color: 0x8a6d2f, goldTop: true, sign: 'CASINO DORADA', signColor: '#ffd76a', signBg: '#2a0a3a' },
  { key: 'impound', w: 24, d: 16, h: 10, color: 0x5a6a7a, sign: 'IMPOUND', signColor: '#9fb3c8', signBg: '#101820' },
  { key: 'warehouse', w: 26, d: 16, h: 14, color: 0x7a5a3a, sign: 'WAREHOUSE', signColor: '#e8a34c', signBg: '#201408' },
  { key: 'station', w: 26, d: 18, h: 18, color: 0x3a5a8a, sign: 'IDPD STATION', signColor: '#6aa8ff', signBg: '#0a1428' },
  { key: 'marina', w: 22, d: 14, h: 10, color: 0x4a7a8a, sign: 'MARINA', signColor: '#7ec8e8', signBg: '#082028' },
  { key: 'garage', w: 24, d: 16, h: 12, color: 0x8a3a3a, sign: 'GARAGE', signColor: '#ff8a6a', signBg: '#280a0a' },
  // Map rework: fuel stop + restaurant — real buildings with real signs, so the
  // map legend points at places that exist in the 3D city, not just icons.
  { key: 'gas', w: 20, d: 14, h: 8, color: 0x8a5a2a, sign: 'GAS STATION', signColor: '#ffb347', signBg: '#201408' },
  { key: 'restaurant', w: 22, d: 14, h: 10, color: 0x8a3a5a, sign: 'RESTAURANT', signColor: '#ff8ab0', signBg: '#280a1a' },
];

// Exclusion zones for regular buildings: landmark plazas + buildings, the
// parked cars spawned by driving.js, the combat-shot staging area by the
// warehouse, the ferris wheel, billboards and the harbor container yard.
const EXCLUSIONS = [
  { x: -120, z: -200, r: 22 }, { x: -120, z: 40, r: 22 }, { x: 120, z: 240, r: 22 },
  { x: 40, z: -200, r: 22 }, { x: -120, z: 240, r: 22 }, { x: 40, z: 120, r: 22 },
  { x: -96, z: -176, r: 30 }, { x: -96, z: 64, r: 30 }, { x: 144, z: 264, r: 30 },
  { x: 64, z: -176, r: 30 }, { x: -96, z: 264, r: 30 }, { x: 64, z: 144, r: 30 },
  { x: -124, z: 232, r: 12 }, { x: 36, z: 116, r: 12 }, { x: -116, z: -193, r: 12 },
  { x: 116, z: 236, r: 12 }, { x: 44, z: -196, r: 12 }, { x: -116, z: 44, r: 12 },
  { x: 115, z: 250, r: 26 },
  { x: -290, z: -40, r: 30 },   // ferris wheel + boardwalk stalls
  { x: -206, z: -120, r: 10 },  // neon billboard, Casino Row
  { x: 195, z: -60, r: 10 },    // neon billboard, causeway approach
  { x: 165, z: 262, r: 34 },    // harbor container yard
  { x: 120, z: -120, r: 22 },   // gas station plaza
  { x: 144, z: -96, r: 30 },    // gas station building
  { x: -120, z: 120, r: 22 },   // restaurant plaza
  { x: -96, z: 144, r: 30 },    // restaurant building
];

function excluded(x, z) {
  for (const e of EXCLUSIONS) {
    const dx = x - e.x, dz = z - e.z;
    if (dx * dx + dz * dz < e.r * e.r) return true;
  }
  return false;
}

// District tint for height/colour: mirrors config.js DISTRICTS.
function districtOf(x, z) {
  if (x >= -200 && x < -40 && z >= -320 && z < -80) return 'casino';
  if (x >= -40 && x < 200 && z >= -320 && z < 0) return 'palm';
  if (x >= -200 && x < -40 && z >= -80 && z < 160) return 'oldtown';
  if (x >= -200 && x < -40 && z >= 160) return 'marina';
  if (x >= -40 && x < 200 && z >= 0) return 'harbor';
  return 'beach';
}

// Procedural text sign: canvas texture, no network, no font files.
function makeTextSign(text, sub, fg, bg, w = 20, h = 5) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 996, 228);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = fg;
  ctx.shadowBlur = 26;
  ctx.font = 'bold 92px system-ui, sans-serif';
  ctx.fillText(text, 512, sub ? 104 : 128);
  if (sub) {
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.shadowBlur = 14;
    ctx.fillText(sub, 512, 196);
  }
  const tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
  return mesh;
}

export function buildCity(G) {
  const scene = G.scene;
  const rng = G.rng;
  const colliders = [];
  const roads = [];
  for (const at of ROAD_LINES) {
    roads.push({ axis: 'ns', at, from: -320, to: 320 });
    roads.push({ axis: 'ew', at, from: -320, to: 320 });
  }
  const animated = { wheel: null, boats: [], signMats: [] };

  // ---- shared materials / geometries ----
  const grassMat = new THREE.MeshStandardMaterial({ color: PALETTE.grass, roughness: 1 });
  const sandMat = new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1 });
  const seaMat = new THREE.MeshStandardMaterial({ color: PALETTE.sea, roughness: 0.25, metalness: 0.15 });
  const roadMat = new THREE.MeshStandardMaterial({ color: PALETTE.road, roughness: 0.95 });
  const dashMat = new THREE.MeshStandardMaterial({ color: PALETTE.roadLine, roughness: 0.6 });
  const walkMat = new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 1 });
  const crossMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.8 });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd8a020, metalness: 0.85, roughness: 0.3, emissive: 0x6a4a00, emissiveIntensity: 0.6 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 1 });
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x3a7a2a, roughness: 0.9, side: THREE.DoubleSide });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6, metalness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x332a18, emissive: 0xffe0a0, emissiveIntensity: 2.2 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 1 });
  const neonPink = new THREE.MeshStandardMaterial({ color: 0x2a0a2a, emissive: 0xff4ad9, emissiveIntensity: 2.0 });
  const neonCyan = new THREE.MeshStandardMaterial({ color: 0x0a2a2a, emissive: 0x4ad9ff, emissiveIntensity: 2.0 });
  const neonGold = new THREE.MeshStandardMaterial({ color: 0x2a1a08, emissive: 0xffc86a, emissiveIntensity: 1.8 });

  // ---- ground, sand, sea ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(640, 640), grassMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const sand = new THREE.Mesh(new THREE.PlaneGeometry(40, 640), sandMat);
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-300, 0.01, 0);
  sand.receiveShadow = true;
  scene.add(sand);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(340, 640), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-470, -0.5, 0);
  scene.add(sea);

  // Sunset shimmer strip on the sea, under the low western sun.
  const glint = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 640),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.22 }),
  );
  glint.rotation.x = -Math.PI / 2;
  glint.position.set(-420, -0.45, -80);
  scene.add(glint);

  // ---- roads, centre dashes, sidewalks, crosswalks ----
  const roadGeoNS = new THREE.PlaneGeometry(12, 640);
  const roadGeoEW = new THREE.PlaneGeometry(640, 12);
  const walkGeoNS = new THREE.PlaneGeometry(3, 640);
  const walkGeoEW = new THREE.PlaneGeometry(640, 3);
  for (const at of ROAD_LINES) {
    const rNS = new THREE.Mesh(roadGeoNS, roadMat);
    rNS.rotation.x = -Math.PI / 2;
    rNS.position.set(at, 0.02, 0);
    rNS.receiveShadow = true;
    scene.add(rNS);
    const rEW = new THREE.Mesh(roadGeoEW, roadMat);
    rEW.rotation.x = -Math.PI / 2;
    rEW.position.set(0, 0.02, at);
    rEW.receiveShadow = true;
    scene.add(rEW);
    for (const side of [-7.5, 7.5]) {
      const wNS = new THREE.Mesh(walkGeoNS, walkMat);
      wNS.rotation.x = -Math.PI / 2;
      wNS.position.set(at + side, 0.015, 0);
      wNS.receiveShadow = true;
      scene.add(wNS);
      const wEW = new THREE.Mesh(walkGeoEW, walkMat);
      wEW.rotation.x = -Math.PI / 2;
      wEW.position.set(0, 0.015, at + side);
      wEW.receiveShadow = true;
      scene.add(wEW);
    }
  }

  // Gold centre dashes, one InstancedMesh for the whole grid + causeway.
  const dashTransforms = [];
  for (const at of ROAD_LINES) {
    for (let s = -312; s <= 312; s += 16) {
      dashTransforms.push({ x: at, z: s, ry: 0 });
      dashTransforms.push({ x: s, z: at, ry: Math.PI / 2 });
    }
  }
  for (let x = 208; x <= 312; x += 16) dashTransforms.push({ x, z: 0, ry: Math.PI / 2 });
  const dashMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.04, 3), dashMat, dashTransforms.length);
  {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < dashTransforms.length; i++) {
      const t = dashTransforms[i];
      dummy.position.set(t.x, 0.04, t.z);
      dummy.rotation.set(0, t.ry, 0);
      dummy.updateMatrix();
      dashMesh.setMatrixAt(i, dummy.matrix);
    }
  }
  dashMesh.instanceMatrix.needsUpdate = true;
  scene.add(dashMesh);

  // Crosswalk stripes at every intersection (two arms each, to bound the count).
  const crossTransforms = [];
  for (const ax of ROAD_LINES) {
    for (const az of ROAD_LINES) {
      for (let k = -2; k <= 2; k++) {
        crossTransforms.push({ x: ax + k * 1.6, z: az - 8.5, ry: 0 });
        crossTransforms.push({ x: ax - 8.5, z: az + k * 1.6, ry: Math.PI / 2 });
      }
    }
  }
  const crossMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.03, 2.6), crossMat, crossTransforms.length);
  {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < crossTransforms.length; i++) {
      const t = crossTransforms[i];
      dummy.position.set(t.x, 0.035, t.z);
      dummy.rotation.set(0, t.ry, 0);
      dummy.updateMatrix();
      crossMesh.setMatrixAt(i, dummy.matrix);
    }
  }
  crossMesh.instanceMatrix.needsUpdate = true;
  scene.add(crossMesh);

  // ---- causeway: water channel + bridge deck + rails + gateway pylons ----
  const cwWater = new THREE.Mesh(new THREE.PlaneGeometry(120, 160), seaMat);
  cwWater.rotation.x = -Math.PI / 2;
  cwWater.position.set(260, 0.015, 0);
  scene.add(cwWater);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(120, 0.1, 14), roadMat);
  deck.position.set(260, 0, 0);
  deck.receiveShadow = true;
  scene.add(deck);
  for (const side of [-7, 7]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(120, 0.5, 0.4), walkMat);
    rail.position.set(260, 0.3, side);
    scene.add(rail);
  }
  for (const side of [-8, 8]) {
    const pylon = new THREE.Mesh(boxGeo, neonGold);
    pylon.scale.set(1.6, 14, 1.6);
    pylon.position.set(204, 7, side);
    pylon.castShadow = true;
    scene.add(pylon);
    colliders.push({ x: 204, z: side, r: 1.6 });
  }
  const gateSign = makeTextSign('ISLA DORADA', 'CAUSEWAY • ONE ROAD OUT', '#ffd76a', '#1a0a2a', 16, 4);
  gateSign.position.set(204, 15.5, 0);
  gateSign.rotation.y = Math.PI / 2; // faces the city (west)
  scene.add(gateSign);

  // ---- buildings (instanced bodies + windows + roofs + awnings) ----
  // Collect per-building data first, then build a handful of InstancedMeshes.
  const bodies = [];   // {x,z,w,d,h,color}
  const windows = [];  // {x,y,z,ry,w,h,color}
  const roofs = [];    // {x,y,z,w,d,color}
  const awnings = [];  // {x,y,z,w,color}
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  function addBuildingData(x, z, w, d, h, color, opts) {
    bodies.push({ x, z, w, d, h, color });
    // Lit window grid on both long faces; warm sunset glass dominates.
    const rows = Math.min(8, Math.max(1, Math.floor(h / 4)));
    const cols = Math.min(6, Math.max(2, Math.floor(w / 3)));
    for (const face of [1, -1]) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rng() < 0.25) continue; // dark windows break the grid up
          windows.push({
            x: x + (c - (cols - 1) / 2) * (w * 0.8 / cols),
            y: 2.5 + r * (Math.min((h - 4) / Math.max(1, rows), 8)),
            z: z + face * (d / 2 + 0.06),
            ry: face > 0 ? 0 : Math.PI,
            w: w * 0.8 / cols * 0.62,
            h: 1.7,
            color: pick(rng, WINDOW_COLORS),
          });
        }
      }
    }
    if (h >= 20) {
      roofs.push({ x: x + range(rng, -2, 2), y: h + 0.9, z: z + range(rng, -2, 2), w: range(rng, 3, 6), d: range(rng, 3, 5), color: 0x8a8a8a });
      if (rng() < 0.5) {
        // Rooftop neon strip — the skyline glows at golden hour.
        const stripMat = pick(rng, [neonPink, neonCyan, neonGold]);
        const strip = new THREE.Mesh(boxGeo, stripMat);
        strip.scale.set(w * 0.9, 0.5, 0.4);
        strip.position.set(x, h + 0.3, z + d / 2 + 0.1);
        scene.add(strip);
        animated.signMats.push(stripMat);
      }
    }
    if (h < 24 && rng() < 0.45) {
      awnings.push({ x, y: 3.1, z: z + d / 2 + 0.25, w: w * 0.85, color: pick(rng, AWNING_COLORS) });
    }
    colliders.push({ x, z, r: Math.hypot(w, d) / 2 });
    return { x, z, w, d, h };
  }

  // Regular buildings: dense 3x3 lots per city block. Beachfront column
  // (x -280..-200) stays open so the coastal road and the chase shot stay
  // clear; the causeway blocks (x 200..280, z -80..80) stay open for the bridge.
  let buildingCount = 0;
  for (let ix = 1; ix < ROAD_LINES.length - 1; ix++) {
    for (let iz = 0; iz < ROAD_LINES.length - 1; iz++) {
      if (ix === 6 && iz >= 2 && iz <= 4) continue; // causeway blocks
      const x0 = ROAD_LINES[ix] + 10, x1 = ROAD_LINES[ix + 1] - 10;
      const z0 = ROAD_LINES[iz] + 10, z1 = ROAD_LINES[iz + 1] - 10;
      for (const fx of [0.18, 0.5, 0.82]) {
        for (const fz of [0.18, 0.5, 0.82]) {
          if (rng() > 0.92) continue; // only 8% of lots stay empty — dense city
          const x = x0 + (x1 - x0) * fx + range(rng, -3, 3);
          const z = z0 + (z1 - z0) * fz + range(rng, -3, 3);
          if (excluded(x, z)) continue;
          const dist = districtOf(x, z);
          const w = range(rng, 11, 19);
          const d = range(rng, 10, 17);
          let h;
          if (dist === 'casino' || dist === 'palm') {
            const roll = rng();
            h = roll < 0.3 ? range(rng, 34, 64) : roll < 0.7 ? range(rng, 18, 32) : range(rng, 8, 16);
          } else if (dist === 'marina') {
            h = rng() < 0.15 ? range(rng, 24, 36) : range(rng, 7, 18);
          } else {
            h = rng() < 0.12 ? range(rng, 24, 36) : range(rng, 7, 18);
          }
          // Marina / beachfront blocks read white + teal; Old Town terracotta.
          let color = pick(rng, BUILDING_COLORS);
          if (dist === 'marina' && rng() < 0.6) color = pick(rng, [0xf2e6c9, 0x4fb3d9, 0x2a9a8a, 0x8ab8d9]);
          if (dist === 'oldtown' && rng() < 0.6) color = pick(rng, [0xd96a4a, 0xe8a34c, 0xc98a4b, 0x8a6d2f]);
          addBuildingData(x, z, w, d, h, color);
          buildingCount++;
        }
      }
    }
  }

  // Landmark buildings (individual meshes: gold top + real text sign).
  for (const lb of LANDMARK_BUILDINGS) {
    const spot = LANDMARK_SPOTS[lb.key];
    const bx = spot.x + 24, bz = spot.z + 24;
    const m = new THREE.Mesh(
      boxGeo,
      new THREE.MeshStandardMaterial({ color: lb.color, roughness: 0.85 }),
    );
    m.scale.set(lb.w, lb.h, lb.d);
    m.position.set(bx, lb.h / 2, bz);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    // Window band on the landmark face.
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(lb.w * 0.75, lb.h * 0.4),
      new THREE.MeshStandardMaterial({ color: 0x2a2018, emissive: 0xffc86a, emissiveIntensity: 1.4, roughness: 0.4 }),
    );
    win.position.set(bx, lb.h * 0.42, bz + lb.d / 2 + 0.06);
    scene.add(win);
    const sign = makeTextSign(lb.sign, null, lb.signColor, lb.signBg, lb.w * 0.9, 3.2);
    sign.position.set(bx, lb.h * 0.82, bz + lb.d / 2 + 0.08);
    scene.add(sign);
    if (lb.goldTop) {
      const top = new THREE.Mesh(boxGeo, goldMat);
      top.scale.set(lb.w * 0.7, 1.6, lb.d * 0.7);
      top.position.set(bx, lb.h + 0.8, bz);
      top.castShadow = true;
      scene.add(top);
      const crown = new THREE.Mesh(boxGeo, neonPink);
      crown.scale.set(lb.w * 0.5, 1.0, lb.d * 0.5);
      crown.position.set(bx, lb.h + 2.1, bz);
      scene.add(crown);
      animated.signMats.push(neonPink);
    }
    if (lb.key === 'gas') {
      // Forecourt canopy on four legs + two pumps, west of the building
      // (toward the x=120 road) — so the fuel stop reads as a gas station.
      const canopy = new THREE.Mesh(
        boxGeo,
        new THREE.MeshStandardMaterial({ color: 0xd96a2a, roughness: 0.7 }),
      );
      canopy.scale.set(16, 0.8, 12);
      canopy.position.set(bx - 16, 5.5, bz);
      canopy.castShadow = true;
      scene.add(canopy);
      for (const [lx, lz] of [[-22, -4], [-22, 4], [-10, -4], [-10, 4]]) {
        const leg = new THREE.Mesh(boxGeo, poleMat);
        leg.scale.set(0.5, 5.5, 0.5);
        leg.position.set(bx + lx, 2.75, bz + lz);
        scene.add(leg);
      }
      for (const pz of [-3, 3]) {
        const pump = new THREE.Mesh(
          boxGeo,
          new THREE.MeshStandardMaterial({ color: 0xc23a3a, roughness: 0.6 }),
        );
        pump.scale.set(1.2, 1.7, 0.9);
        pump.position.set(bx - 16, 0.85, bz + pz);
        pump.castShadow = true;
        scene.add(pump);
      }
      colliders.push({ x: bx - 16, z: bz, r: 4 });
    }
    colliders.push({ x: bx, z: bz, r: Math.hypot(lb.w, lb.d) / 2 });
  }

  // Flush the collected instanced meshes.
  const bodyMesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), bodies.length);
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    dummy.position.set(b.x, b.h / 2, b.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.updateMatrix();
    bodyMesh.setMatrixAt(i, dummy.matrix);
    bodyMesh.setColorAt(i, tmpColor.setHex(b.color));
  }
  bodyMesh.instanceMatrix.needsUpdate = true;
  if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  scene.add(bodyMesh);

  const winMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    windows.length,
  );
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    dummy.position.set(w.x, w.y, w.z);
    dummy.rotation.set(0, w.ry, 0);
    dummy.scale.set(w.w, w.h, 1);
    dummy.updateMatrix();
    winMesh.setMatrixAt(i, dummy.matrix);
    winMesh.setColorAt(i, tmpColor.setHex(w.color));
  }
  winMesh.instanceMatrix.needsUpdate = true;
  if (winMesh.instanceColor) winMesh.instanceColor.needsUpdate = true;
  scene.add(winMesh);

  if (roofs.length) {
    const roofMesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), roofs.length);
    for (let i = 0; i < roofs.length; i++) {
      const r = roofs[i];
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(r.w, 1.8, r.d);
      dummy.updateMatrix();
      roofMesh.setMatrixAt(i, dummy.matrix);
      roofMesh.setColorAt(i, tmpColor.setHex(r.color));
    }
    roofMesh.instanceMatrix.needsUpdate = true;
    if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;
    roofMesh.castShadow = true;
    scene.add(roofMesh);
  }
  if (awnings.length) {
    const awnMesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), awnings.length);
    for (let i = 0; i < awnings.length; i++) {
      const a = awnings[i];
      dummy.position.set(a.x, a.y, a.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(a.w, 0.5, 1.2);
      dummy.updateMatrix();
      awnMesh.setMatrixAt(i, dummy.matrix);
      awnMesh.setColorAt(i, tmpColor.setHex(a.color));
    }
    awnMesh.instanceMatrix.needsUpdate = true;
    if (awnMesh.instanceColor) awnMesh.instanceColor.needsUpdate = true;
    scene.add(awnMesh);
  }

  // ---- neon billboards (real text, emissive, visible from the coastal road) ----
  function addBillboard(x, z, ry, line1, line2, fg, bg) {
    for (const legDx of [-6, 6]) {
      const leg = new THREE.Mesh(boxGeo, poleMat);
      leg.scale.set(1, 16, 1);
      leg.position.set(x + legDx * Math.cos(ry), 8, z - legDx * Math.sin(ry));
      leg.castShadow = true;
      scene.add(leg);
    }
    const panel = makeTextSign(line1, line2, fg, bg, 24, 6);
    panel.position.set(x, 20, z);
    panel.rotation.y = ry;
    scene.add(panel);
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(25.5, 7.5),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(fg), transparent: true, opacity: 0.18 }),
    );
    halo.position.set(x, 20, z);
    halo.rotation.y = ry;
    // Halo sits just in FRONT of the panel (along its normal) so it glows
    // outward instead of hiding behind the panel.
    halo.position.x += Math.sin(ry) * 0.15;
    halo.position.z += Math.cos(ry) * 0.15;
    scene.add(halo);
    colliders.push({ x, z, r: 8 });
  }
  addBillboard(-206, -120, -Math.PI / 2, 'ISLA DORADA', '★ CASINO • BEACH • GOLD ★', '#ff4ad9', '#160a24');
  addBillboard(195, -60, -Math.PI / 2, 'HARBOUR', 'FISH • FERRY • FREEDOM', '#4ad9ff', '#081826');

  // ---- boardwalk: deck, stalls, string lights, beach umbrellas ----
  const boardwalk = new THREE.Mesh(new THREE.PlaneGeometry(6, 320), deckMat);
  boardwalk.rotation.x = -Math.PI / 2;
  boardwalk.position.set(-292, 0.03, 0);
  boardwalk.receiveShadow = true;
  scene.add(boardwalk);
  // Stalls with striped awnings along the boardwalk (east edge, clear of the road).
  const stallSpots = [-180, -140, -120, -100, -70, 20, 60, 100, 120, 150, 180, 200];
  for (const sz of stallSpots) {
    if (Math.abs(sz - LANDMARK_SPOTS.ferrisWheel.z) < 28) continue;
    const stall = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: pick(rng, [0xf2e6c9, 0x4fb3d9, 0xe88ab0]), roughness: 0.9 }));
    stall.scale.set(4, 3, 3.5);
    stall.position.set(-292, 1.5, sz);
    stall.castShadow = true;
    scene.add(stall);
    const awn = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: pick(rng, AWNING_COLORS), roughness: 0.9 }));
    awn.scale.set(4.6, 0.3, 4.2);
    awn.position.set(-292, 3.2, sz);
    scene.add(awn);
    colliders.push({ x: -292, z: sz, r: 3 });
  }
  // String-light posts along the boardwalk (warm bulbs, instanced).
  const bulbSpots = [];
  for (let z = -160; z <= 160; z += 20) bulbSpots.push({ x: -289, z });
  const bulbPoleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 6), poleMat, bulbSpots.length);
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), lampMat, bulbSpots.length);
  for (let i = 0; i < bulbSpots.length; i++) {
    dummy.position.set(bulbSpots[i].x, 1.7, bulbSpots[i].z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bulbPoleMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(bulbSpots[i].x, 3.45, bulbSpots[i].z);
    dummy.updateMatrix();
    bulbMesh.setMatrixAt(i, dummy.matrix);
  }
  bulbPoleMesh.instanceMatrix.needsUpdate = true;
  bulbMesh.instanceMatrix.needsUpdate = true;
  scene.add(bulbPoleMesh);
  scene.add(bulbMesh);

  // Beach umbrellas + towels on the sand west of the boardwalk.
  const umbrellaSpots = [];
  for (let i = 0; i < 64; i++) {
    const z = range(rng, -290, 290);
    if (Math.abs(z - LANDMARK_SPOTS.ferrisWheel.z) < 30) continue;
    if (Math.abs(z - 240) < 14) continue; // marina pier
    umbrellaSpots.push({ x: range(rng, -312, -297), z });
  }
  const umbMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 1.3, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), umbrellaSpots.length);
  const umbPoleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), poleMat, umbrellaSpots.length);
  for (let i = 0; i < umbrellaSpots.length; i++) {
    const u = umbrellaSpots[i];
    dummy.position.set(u.x, 2.9, u.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    umbMesh.setMatrixAt(i, dummy.matrix);
    umbMesh.setColorAt(i, tmpColor.setHex(pick(rng, UMBRELLA_COLORS)));
    dummy.position.set(u.x, 1.2, u.z);
    dummy.updateMatrix();
    umbPoleMesh.setMatrixAt(i, dummy.matrix);
  }
  umbMesh.instanceMatrix.needsUpdate = true;
  if (umbMesh.instanceColor) umbMesh.instanceColor.needsUpdate = true;
  umbPoleMesh.instanceMatrix.needsUpdate = true;
  scene.add(umbMesh);
  scene.add(umbPoleMesh);
  // Towels: small bright planes scattered near umbrellas.
  const towelMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.6, 2.4), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide }), umbrellaSpots.length);
  for (let i = 0; i < umbrellaSpots.length; i++) {
    const u = umbrellaSpots[i];
    dummy.position.set(u.x + range(rng, -3, 3), 0.05, u.z + range(rng, -3, 3));
    dummy.rotation.set(-Math.PI / 2, 0, range(rng, 0, Math.PI));
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    towelMesh.setMatrixAt(i, dummy.matrix);
    towelMesh.setColorAt(i, tmpColor.setHex(pick(rng, UMBRELLA_COLORS)));
  }
  towelMesh.instanceMatrix.needsUpdate = true;
  if (towelMesh.instanceColor) towelMesh.instanceColor.needsUpdate = true;
  scene.add(towelMesh);

  // ---- ferris wheel (beachfront, face-on to the coastal road) ----
  const wheelGroup = new THREE.Group();
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, metalness: 0.4 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(16, 0.5, 8, 48), wheelMat);
  wheelGroup.add(rim);
  const innerRim = new THREE.Mesh(new THREE.TorusGeometry(8, 0.35, 8, 32), wheelMat);
  wheelGroup.add(innerRim);
  for (let k = 0; k < 8; k++) {
    const spoke = new THREE.Mesh(boxGeo, wheelMat);
    spoke.scale.set(0.45, 32, 0.45);
    spoke.rotation.z = (k / 8) * Math.PI;
    wheelGroup.add(spoke);
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const gondola = new THREE.Mesh(
      boxGeo,
      new THREE.MeshStandardMaterial({ color: pick(rng, UMBRELLA_COLORS), roughness: 0.6 }),
    );
    gondola.scale.set(2.4, 2.0, 2.0);
    gondola.position.set(Math.cos(a) * 16, Math.sin(a) * 16, 0);
    wheelGroup.add(gondola);
  }
  const hub = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0x201808, emissive: 0xffc86a, emissiveIntensity: 2.0 }),
  );
  wheelGroup.add(hub);
  wheelGroup.position.set(LANDMARK_SPOTS.ferrisWheel.x, 18.5, LANDMARK_SPOTS.ferrisWheel.z);
  scene.add(wheelGroup);
  animated.wheel = wheelGroup;
  // A-frame legs.
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(boxGeo, poleMat);
    leg.scale.set(1.1, 21, 1.1);
    leg.position.set(LANDMARK_SPOTS.ferrisWheel.x, 9.5, LANDMARK_SPOTS.ferrisWheel.z + side * 4.5);
    leg.rotation.x = side * 0.22;
    leg.castShadow = true;
    scene.add(leg);
  }
  const wheelBase = new THREE.Mesh(boxGeo, walkMat);
  wheelBase.scale.set(10, 0.6, 14);
  wheelBase.position.set(LANDMARK_SPOTS.ferrisWheel.x, 0.3, LANDMARK_SPOTS.ferrisWheel.z);
  scene.add(wheelBase);
  colliders.push({ x: LANDMARK_SPOTS.ferrisWheel.x, z: LANDMARK_SPOTS.ferrisWheel.z, r: 8 });
  // Ferris wheel marquee sign.
  const wheelSign = makeTextSign('FERRIS WHEEL', 'BEACHFRONT • SUNSET RIDE', '#ff8ad9', '#1a0a24', 14, 3.5);
  wheelSign.position.set(LANDMARK_SPOTS.ferrisWheel.x + 2, 4.5, LANDMARK_SPOTS.ferrisWheel.z + 8);
  scene.add(wheelSign);

  // ---- marina piers + boats (more boats, sailboats, bobbing via updateCity) ----
  function addBoat(x, z, sailColor) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(boxGeo, whiteMat);
    hull.scale.set(5, 1, 2);
    hull.position.y = 0.2;
    boat.add(hull);
    const cabin = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: pick(rng, [0x3a5a8a, 0xc23a3a, 0x2a9a8a]), roughness: 0.6 }));
    cabin.scale.set(2, 0.8, 1.4);
    cabin.position.set(-0.5, 1, 0);
    boat.add(cabin);
    if (sailColor) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 6), poleMat);
      mast.position.set(0.5, 3, 0);
      boat.add(mast);
      const sail = new THREE.Mesh(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0.5, 0.8, 0), new THREE.Vector3(0.5, 5.2, 0), new THREE.Vector3(2.6, 0.8, 0),
        ]).setIndex([0, 1, 2]).computeVertexNormals(),
        new THREE.MeshStandardMaterial({ color: sailColor, roughness: 0.8, side: THREE.DoubleSide }),
      );
      boat.add(sail);
    }
    boat.position.set(x, -0.3, z);
    boat.rotation.y = range(rng, -0.25, 0.25);
    scene.add(boat);
    animated.boats.push({ mesh: boat, phase: rng() * Math.PI * 2, baseY: -0.3 });
    return boat;
  }
  const pier = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 6), walkMat);
  pier.position.set(-300, 0.05, 240);
  scene.add(pier);
  const pier2 = new THREE.Mesh(new THREE.BoxGeometry(30, 0.2, 6), walkMat);
  pier2.position.set(-300, 0.05, -200);
  scene.add(pier2);
  for (const bz of [215, 245, 275, 190, 262]) addBoat(-312, bz, null);
  addBoat(-312, 100, null);
  addBoat(-312, -40, 0xe88ab0);
  addBoat(-330, 150, 0xf2e6c9);
  addBoat(-335, -120, 0xff8a5a);
  addBoat(-325, -260, 0x7ec8e8);
  addBoat(-338, -200, 0x4fb3d9);
  // Harbor boats, east side near the container yard.
  addBoat(240, 300, null);
  addBoat(260, 280, 0xe88ab0);

  // ---- harbor container yard + crane ----
  const containerColors = [0xc23a3a, 0x3f7fd9, 0x7ec850, 0xf2c230, 0x2a9a8a, 0xe88ab0];
  const containerMesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), 14);
  {
    let ci = 0;
    for (let i = 0; i < 14; i++) {
      const cx = 140 + (i % 5) * 13 + range(rng, -2, 2);
      const cz = 250 + Math.floor(i / 5) * 9 + range(rng, -2, 2);
      const tall = i % 5 === 0; // every fifth container reads as a 2-high stack
      dummy.position.set(cx, tall ? 2.6 : 1.3, cz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(11, tall ? 5.2 : 2.6, 2.6);
      dummy.updateMatrix();
      containerMesh.setMatrixAt(ci, dummy.matrix);
      containerMesh.setColorAt(ci, tmpColor.setHex(pick(rng, containerColors)));
      ci++;
    }
    containerMesh.count = ci;
  }
  containerMesh.instanceMatrix.needsUpdate = true;
  if (containerMesh.instanceColor) containerMesh.instanceColor.needsUpdate = true;
  containerMesh.castShadow = true;
  scene.add(containerMesh);
  for (let i = 0; i < 5; i++) {
    colliders.push({ x: 140 + i * 13, z: 255, r: 6 });
  }
  // Harbor crane: two legs, a top beam and a hanging hook line.
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 }));
    leg.scale.set(1.4, 26, 1.4);
    leg.position.set(185, 13, 275 + side * 6);
    leg.castShadow = true;
    scene.add(leg);
  }
  const craneBeam = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 }));
  craneBeam.scale.set(30, 1.4, 1.4);
  craneBeam.position.set(185, 26, 275);
  craneBeam.rotation.y = Math.PI / 2;
  scene.add(craneBeam);
  colliders.push({ x: 185, z: 275, r: 8 });

  // ---- palm trees: dense beach row + along every road (instanced) ----
  const palmSpots = [];
  for (let z = -300; z <= 300; z += 12) {
    palmSpots.push({ x: -288 + range(rng, -3, 3), z: z + range(rng, -4, 4) });
    if (rng() < 0.5) palmSpots.push({ x: -296 + range(rng, -2, 2), z: z + range(rng, -4, 4) });
  }
  for (let i = 0; i < 150; i++) {
    const line = pick(rng, ROAD_LINES);
    const s = range(rng, -280, 280);
    const side = rng() < 0.5 ? -9.5 : 9.5;
    if (rng() < 0.5) palmSpots.push({ x: line + side, z: s });
    else palmSpots.push({ x: s, z: line + side });
  }
  const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.28, 6, 6), trunkMat, palmSpots.length);
  const frondMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.6, 0.9), frondMat, palmSpots.length * 6);
  {
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const off = new THREE.Vector3();
    const pos = new THREE.Vector3();
    let fi = 0;
    for (let i = 0; i < palmSpots.length; i++) {
      const p = palmSpots[i];
      dummy.position.set(p.x, 3, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);
      for (let f = 0; f < 6; f++) {
        const yaw = (f / 6) * Math.PI * 2 + range(rng, -0.2, 0.2);
        e.set(0, yaw, -0.55, 'YXZ');
        q.setFromEuler(e);
        off.set(1.3, 0, 0).applyQuaternion(q);
        pos.set(p.x + off.x, 6.2 + off.y, p.z + off.z);
        const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
        frondMesh.setMatrixAt(fi++, m);
      }
      colliders.push({ x: p.x, z: p.z, r: 0.6 });
    }
  }
  trunkMesh.instanceMatrix.needsUpdate = true;
  frondMesh.instanceMatrix.needsUpdate = true;
  trunkMesh.castShadow = true;
  scene.add(trunkMesh);
  scene.add(frondMesh);

  // ---- street lamps along every road, both sides (instanced) ----
  const lampSpots = [];
  for (const at of ROAD_LINES) {
    for (let z = -280; z <= 280; z += 80) {
      lampSpots.push({ x: at + 8, z });
      lampSpots.push({ x: at - 8, z: z + 40 });
    }
  }
  const lampPoleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 5, 6), poleMat, lampSpots.length);
  const lampHeadMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.26, 8, 6), lampMat, lampSpots.length);
  for (let i = 0; i < lampSpots.length; i++) {
    dummy.position.set(lampSpots[i].x, 2.5, lampSpots[i].z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    lampPoleMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(lampSpots[i].x, 5.05, lampSpots[i].z);
    dummy.updateMatrix();
    lampHeadMesh.setMatrixAt(i, dummy.matrix);
  }
  lampPoleMesh.instanceMatrix.needsUpdate = true;
  lampHeadMesh.instanceMatrix.needsUpdate = true;
  scene.add(lampPoleMesh);
  scene.add(lampHeadMesh);

  // ---- casino + marina plazas (paved, gold-trimmed) ----
  for (const [px, pz, pr] of [[-96, -176, 18], [-96, 264, 14]]) {
    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(pr, 24),
      new THREE.MeshStandardMaterial({ color: 0xb89a5a, roughness: 1 }),
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(px, 0.015, pz);
    plaza.receiveShadow = true;
    scene.add(plaza);
  }

  // ---- G.city (same shape as v1, plus new landmarks + animated refs) ----
  function nearestRoad(x, z) {
    let nsLine = ROAD_LINES[0], nsD = Math.abs(x - nsLine);
    let ewLine = ROAD_LINES[0], ewD = Math.abs(z - ewLine);
    for (const l of ROAD_LINES) {
      if (Math.abs(x - l) < nsD) { nsD = Math.abs(x - l); nsLine = l; }
      if (Math.abs(z - l) < ewD) { ewD = Math.abs(z - l); ewLine = l; }
    }
    if (nsD <= ewD) return { x: nsLine, z, heading: 0 };
    return { x, z: ewLine, heading: Math.PI / 2 };
  }

  function randomRoadPos(r) {
    const line = pick(r, ROAD_LINES);
    const s = range(r, -280, 280);
    const dir = r() < 0.5 ? 1 : -1;
    if (r() < 0.5) return { x: line, z: s, heading: dir > 0 ? 0 : Math.PI };
    return { x: s, z: line, heading: dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
  }

  G.city = {
    roads,
    roadLines: ROAD_LINES,
    colliders,
    landmarks: getLandmarks(),
    getLandmarks,
    animated,
    buildingCount,
    nearGarage(pos) {
      const dx = pos.x - LANDMARK_SPOTS.garage.x;
      const dz = pos.z - LANDMARK_SPOTS.garage.z;
      return dx * dx + dz * dz < 12 * 12;
    },
    randomRoadPos,
    nearestRoad,
  };
  return G.city;
}

// Animate the living bits: ferris wheel spin, boat bob, neon pulse.
// NOT called by city.js itself — wire into the main loop (stepPlay) by the
// coordinator; harmless if never called (everything still renders static).
export function updateCity(G, dt) {
  if (!G.city || !G.city.animated) return;
  const a = G.city.animated;
  if (a.wheel) a.wheel.rotation.z += dt * 0.12;
  const t = G.time || 0;
  for (const b of a.boats) {
    b.mesh.position.y = b.baseY + Math.sin(t * 0.8 + b.phase) * 0.15;
    b.mesh.rotation.z = Math.sin(t * 0.6 + b.phase) * 0.02;
  }
  const pulse = 1.7 + Math.sin(t * 2.4) * 0.5;
  for (const m of a.signMats) m.emissiveIntensity = pulse;
}
