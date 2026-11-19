// Isla Dorada — ambient traffic cars and pedestrians (REBUILD v2).
// Cars drive the road grid on a lane offset, turning at intersections; peds
// walk the sidewalks and the beach. Both are kept near the player and
// despawned when far away. v2 is much denser: 26 cars and 40 peds instead of
// 10/14; v3 raises it to 40 cars and 80 peds, with brighter car colours and
// a dedicated beach-walker population so the Beachfront never reads empty.
// Same exports and entity shapes as v1: initTraffic, updateTraffic,
// spawnTrafficCar, spawnPed. G.traffic = { cars, peds }.
import * as THREE from 'three';
import { VEHICLES } from './config.js';
import { clamp, pick, range } from './random.js';
import { makeCarMesh } from './driving.js';

const TARGET_CARS = 40;
const TARGET_PEDS = 80;
const TARGET_BEACH_PEDS = 16; // subset of TARGET_PEDS, on the sand/boardwalk
const DESPAWN_CAR = 300;
const DESPAWN_PED = 240;
const LANE = 2.2;   // right-hand lane offset from the road centreline
const WALK = 8.5;   // sidewalk offset from the road centreline
const BEACH_X = -292; // boardwalk/sand line the beach walkers stroll along

// Bright traffic colours: the street should read colourful at a glance.
// Taxis keep their yellow; everything else may be repainted.
const TRAFFIC_COLORS = [
  0xc23a3a, 0x3f7fd9, 0x7ec850, 0xf2c230, 0xe88ab0, 0x2a9a8a,
  0xff8a5a, 0x9a6ad9, 0xe8e0d0, 0x4fb3d9, 0xd96a4a, 0x5ac8a8,
];

// ---- pedestrian meshes (shared geometry, wide colour palette) ----
const pedGeo = {
  leg: new THREE.BoxGeometry(0.2, 0.7, 0.22),
  torso: new THREE.BoxGeometry(0.55, 0.6, 0.3),
  arm: new THREE.BoxGeometry(0.14, 0.6, 0.16),
  head: new THREE.BoxGeometry(0.28, 0.3, 0.28),
};
pedGeo.leg.translate(0, -0.35, 0);
pedGeo.arm.translate(0, -0.3, 0);
const pedShirts = [
  0xc23a3a, 0x3f7fd9, 0xe8e0d0, 0x7ec850, 0xf2c230, 0x9a6ad9, 0xe88a4c,
  0xff8a5a, 0x2a9a8a, 0x4fb3d9, 0xffffff, 0x1a1a22, 0xd96a4a, 0x5ac8a8,
].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
const pedSkins = [0xd9a077, 0xb98a5e, 0x8a5f3d, 0xe8b88a].map(
  (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }),
);
const pedPants = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.95 });
const pedShorts = new THREE.MeshStandardMaterial({ color: 0x3f7fd9, roughness: 0.95 });

function makePedMesh(G, beach) {
  const g = new THREE.Group();
  const shirt = pick(G.rng, pedShirts);
  const skin = pick(G.rng, pedSkins);
  // Beach walkers wear shorts and brighter shirts; street peds wear pants.
  const legs = beach && G.rng() < 0.7 ? pedShorts : pedPants;
  const legL = new THREE.Mesh(pedGeo.leg, legs);
  legL.position.set(-0.13, 0.7, 0);
  const legR = new THREE.Mesh(pedGeo.leg, legs);
  legR.position.set(0.13, 0.7, 0);
  const torso = new THREE.Mesh(pedGeo.torso, shirt);
  torso.position.y = 1.02;
  const armL = new THREE.Mesh(pedGeo.arm, shirt);
  armL.position.set(-0.35, 1.28, 0);
  const armR = new THREE.Mesh(pedGeo.arm, shirt);
  armR.position.set(0.35, 1.28, 0);
  const head = new THREE.Mesh(pedGeo.head, skin);
  head.position.y = 1.52;
  // A few beach walkers get a sun hat (bright disc on the head).
  if (beach && G.rng() < 0.35) {
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.36, 0.08, 10),
      new THREE.MeshStandardMaterial({ color: pick(G.rng, [0xf2c230, 0xe8e0d0, 0xc23a3a]), roughness: 0.9 }),
    );
    hat.position.y = 1.7;
    g.add(hat);
  }
  for (const part of [legL, legR, torso, armL, armR, head]) {
    part.castShadow = true;
    g.add(part);
  }
  g.userData = { legL, legR, armL, armR };
  return g;
}

// ---- road following (shared by cars and street peds) ----
// Entity: { axis:'ns'|'ew', line, s, dir, heading, speed, turnCooldown }.
// NS road: line = x, s = z, dir +1 -> heading 0 (south). EW: line = z, s = x,
// dir +1 -> heading PI/2 (east).
function advanceOnRoad(G, e, dt, turnProb) {
  e.turnCooldown = Math.max(0, e.turnCooldown - dt);
  const prevS = e.s;
  e.s += e.dir * e.speed * dt;
  if (e.turnCooldown <= 0) {
    for (const c of G.city.roadLines) {
      if ((prevS - c) * (e.s - c) <= 0 && Math.abs(e.s - c) < 2) {
        if (G.rng() < turnProb) {
          const left = G.rng() < 0.5;
          const nh = e.heading + (left ? Math.PI / 2 : -Math.PI / 2);
          const ns = Math.abs(Math.cos(nh)) >= Math.abs(Math.sin(nh));
          const oldLine = e.line;
          e.axis = ns ? 'ns' : 'ew';
          e.line = c;
          e.s = oldLine;
          e.dir = ns ? (Math.cos(nh) > 0 ? 1 : -1) : (Math.sin(nh) > 0 ? 1 : -1);
        }
        e.turnCooldown = 1.5;
        break;
      }
    }
  }
  if (e.s > 285 || e.s < -285) {
    e.dir *= -1;
    e.s = clamp(e.s, -285, 285);
    e.turnCooldown = 1;
  }
}

function placeCarOnRoad(car) {
  if (car.axis === 'ns') {
    car.heading = car.dir > 0 ? 0 : Math.PI;
    car.mesh.position.set(car.line - car.dir * LANE + (car.kickX || 0), 0, car.s + (car.kickZ || 0));
  } else {
    car.heading = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    car.mesh.position.set(car.s + (car.kickX || 0), 0, car.line + car.dir * LANE + (car.kickZ || 0));
  }
  car.mesh.rotation.y = car.heading;
}

function placePedOnRoad(ped) {
  if (ped.axis === 'beach') {
    // Beach walkers stroll the boardwalk/sand line; heading follows the walk.
    ped.heading = ped.dir > 0 ? 0 : Math.PI;
    ped.mesh.position.set(ped.line, ped.bobY || 0, ped.s);
    ped.mesh.rotation.y = ped.heading;
    return;
  }
  const off = ped.side * WALK;
  if (ped.axis === 'ns') {
    ped.heading = ped.dir > 0 ? 0 : Math.PI;
    ped.mesh.position.set(ped.line + off, ped.bobY || 0, ped.s);
  } else {
    ped.heading = ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    ped.mesh.position.set(ped.s, ped.bobY || 0, ped.line + off);
  }
  ped.mesh.rotation.y = ped.heading;
}

// Keep a fresh spawn from landing on top of another traffic car.
function clearOfCars(G, x, z, minD) {
  for (const c of G.traffic.cars) {
    const dx = c.mesh.position.x - x, dz = c.mesh.position.z - z;
    if (dx * dx + dz * dz < minD * minD) return false;
  }
  return true;
}

function addTrafficCar(G, defName, axis, line, s, dir, speed) {
  const def = VEHICLES.find((v) => v.name === defName) || pick(G.rng, VEHICLES);
  // Repaint most cars in a bright colour; taxis stay yellow.
  const colorOverride = def.kind === 'taxi' || G.rng() < 0.35
    ? undefined
    : pick(G.rng, TRAFFIC_COLORS);
  const mesh = makeCarMesh(G, def, colorOverride);
  G.scene.add(mesh);
  const car = {
    mesh, def, name: def.name,
    axis, line, s, dir, speed,
    heading: 0, turnCooldown: 0, kickX: 0, kickZ: 0,
    pos: mesh.position, stolen: false,
  };
  placeCarOnRoad(car);
  G.traffic.cars.push(car);
  return car;
}

function spawnNearPoint(G, px, pz, radius) {
  const axis = G.rng() < 0.5 ? 'ns' : 'ew';
  const lines = G.city.roadLines.filter((l) => Math.abs(l - (axis === 'ns' ? px : pz)) < radius);
  const line = lines.length ? pick(G.rng, lines) : pick(G.rng, G.city.roadLines);
  const along = axis === 'ns' ? pz : px;
  let s = clamp(along + range(G.rng, -radius, radius), -280, 280);
  // Do not spawn on top of the player or another car.
  if (Math.abs(s - along) < 30 && Math.abs(line - (axis === 'ns' ? px : pz)) < 12) return null;
  for (let tries = 0; tries < 3; tries++) {
    const x = axis === 'ns' ? line : s;
    const z = axis === 'ns' ? s : line;
    if (clearOfCars(G, x, z, 12)) break;
    s = clamp(s + 25, -280, 280);
  }
  return addTrafficCar(G, pick(G.rng, VEHICLES).name, axis, line, s,
    G.rng() < 0.5 ? 1 : -1, range(G.rng, 7, 16));
}

function addPed(G, axis, line, s, dir, beach = false) {
  const mesh = makePedMesh(G, beach);
  G.scene.add(mesh);
  const ped = {
    mesh, axis, line, s, dir,
    speed: beach ? range(G.rng, 0.8, 1.4) : range(G.rng, 1.0, 1.8),
    heading: 0, turnCooldown: 0,
    side: G.rng() < 0.5 ? -1 : 1,
    phase: G.rng() * Math.PI * 2,
    bobY: 0,
    beach,
    pos: mesh.position,
  };
  placePedOnRoad(ped);
  G.traffic.peds.push(ped);
  return ped;
}

function spawnPedNearPoint(G, px, pz, radius) {
  const axis = G.rng() < 0.5 ? 'ns' : 'ew';
  const lines = G.city.roadLines.filter((l) => Math.abs(l - (axis === 'ns' ? px : pz)) < radius);
  const line = lines.length ? pick(G.rng, lines) : pick(G.rng, G.city.roadLines);
  const along = axis === 'ns' ? pz : px;
  const s = clamp(along + range(G.rng, -radius, radius), -280, 280);
  return addPed(G, axis, line, s, G.rng() < 0.5 ? 1 : -1);
}

function spawnBeachPedNearPoint(G, pz, radius) {
  const s = clamp(pz + range(G.rng, -radius, radius), -280, 280);
  const line = BEACH_X + range(G.rng, -4, 10);
  return addPed(G, 'beach', line, s, G.rng() < 0.5 ? 1 : -1, true);
}

function beachPedCount(G) {
  let n = 0;
  for (const p of G.traffic.peds) if (p.beach) n++;
  return n;
}

export function initTraffic(G) {
  G.traffic = { cars: [], peds: [] };
  // Player starts at the Marina (-120, 240); seed the first cars/peds around it.
  for (let i = 0; i < TARGET_CARS; i++) spawnNearPoint(G, -120, 240, 170);
  for (let i = 0; i < TARGET_PEDS - TARGET_BEACH_PEDS; i++) spawnPedNearPoint(G, -120, 240, 120);
  for (let i = 0; i < TARGET_BEACH_PEDS; i++) spawnBeachPedNearPoint(G, 240, 160);
}

export function spawnTrafficCar(G, x, z, heading, defName) {
  // Snap onto the nearest road in the heading's direction.
  const ew = Math.abs(Math.sin(heading)) > Math.abs(Math.cos(heading));
  let line, s, dir;
  if (ew) {
    line = G.city.roadLines.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
    s = clamp(x, -280, 280);
    dir = Math.sin(heading) > 0 ? 1 : -1;
    return addTrafficCar(G, defName, 'ew', line, s, dir, range(G.rng, 7, 16));
  }
  line = G.city.roadLines.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
  s = clamp(z, -280, 280);
  dir = Math.cos(heading) > 0 ? 1 : -1;
  return addTrafficCar(G, defName, 'ns', line, s, dir, range(G.rng, 7, 16));
}

export function spawnPed(G, x, z) {
  // Near the beach, spawn a beach walker instead of a street ped.
  if (x < -270) return addPed(G, 'beach', clamp(x, -312, -284), clamp(z, -280, 280), G.rng() < 0.5 ? 1 : -1, true);
  const near = G.city.nearestRoad(x, z);
  const ew = near.heading === Math.PI / 2;
  const axis = ew ? 'ew' : 'ns';
  const line = ew ? near.z : near.x;
  const s = ew ? near.x : near.z;
  return addPed(G, axis, line, clamp(s, -280, 280), G.rng() < 0.5 ? 1 : -1);
}

export function updateTraffic(G, dt) {
  if (!G.traffic || !G.city) return;
  const p = G.player ? G.player.pos : null;

  for (let i = G.traffic.cars.length - 1; i >= 0; i--) {
    const car = G.traffic.cars[i];
    advanceOnRoad(G, car, dt, 0.5);
    car.kickX *= Math.max(0, 1 - 3 * dt);
    car.kickZ *= Math.max(0, 1 - 3 * dt);
    placeCarOnRoad(car);
    if (p && (Math.abs(car.mesh.position.x - p.x) > DESPAWN_CAR || Math.abs(car.mesh.position.z - p.z) > DESPAWN_CAR)) {
      G.scene.remove(car.mesh);
      G.traffic.cars.splice(i, 1);
    }
  }
  if (p) {
    let guard = 0;
    while (G.traffic.cars.length < TARGET_CARS && guard++ < 6) {
      spawnNearPoint(G, p.x, p.z, 160);
    }
  }

  for (let i = G.traffic.peds.length - 1; i >= 0; i--) {
    const ped = G.traffic.peds[i];
    if (ped.axis === 'beach') {
      // Beach walkers stroll the sand line and turn around at the ends.
      ped.s += ped.dir * ped.speed * dt;
      if (ped.s > 285 || ped.s < -285) {
        ped.dir *= -1;
        ped.s = clamp(ped.s, -285, 285);
      }
    } else {
      advanceOnRoad(G, ped, dt, 0.15);
    }
    ped.bobY = Math.abs(Math.sin(G.time * 7 + ped.phase)) * 0.06;
    placePedOnRoad(ped);
    const u = ped.mesh.userData;
    const swing = Math.sin(G.time * 7 + ped.phase) * 0.5;
    u.legL.rotation.x = swing;
    u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.7;
    u.armR.rotation.x = swing * 0.7;
    if (p && (Math.abs(ped.mesh.position.x - p.x) > DESPAWN_PED || Math.abs(ped.mesh.position.z - p.z) > DESPAWN_PED)) {
      G.scene.remove(ped.mesh);
      G.traffic.peds.splice(i, 1);
    }
  }
  if (p) {
    let guard = 0;
    while (G.traffic.peds.length < TARGET_PEDS && guard++ < 6) {
      // Keep the beach populated while the player is anywhere near it.
      if (p.x < -120 && beachPedCount(G) < TARGET_BEACH_PEDS) {
        spawnBeachPedNearPoint(G, p.z, 120);
      } else {
        spawnPedNearPoint(G, p.x, p.z, 120);
      }
    }
  }
}
