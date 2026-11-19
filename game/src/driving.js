// Isla Dorada — cars and arcade driving, with crash physics.
// Car forward is +z at heading 0; mesh.rotation.y = heading everywhere.
// Meshes use rotation order YXZ so a flip (rotation.z = PI, wheels up)
// composes cleanly with the heading. This module also owns the shared crash
// FX (sparks/fire points + smoke sprites) used by police.js and combat.js,
// and the arcade score state (drift chains, near misses) exposed on
// G.driving.score for the HUD.
import * as THREE from 'three';
import { CHAOS, KEYS, SCORE, VEHICLES } from './config.js';
import { Input } from './input.js';
import { clamp } from './random.js';

const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 12);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.9 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.15, metalness: 0.8 });
const lightFrontMat = new THREE.MeshStandardMaterial({ color: 0xfff8dd, emissive: 0xfff2b0, emissiveIntensity: 2.5 });
const lightRearMat = new THREE.MeshStandardMaterial({ color: 0x3a0a0a, emissive: 0xff2a2a, emissiveIntensity: 1.8 });
const signMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, emissive: 0xc89000, emissiveIntensity: 0.8 });

const FX_MAX = 320;
const SMOKE_POOL = 24;

// ---------------------------------------------------------------- crash FX
let smokeTex = null;
function getSmokeTexture() {
  if (smokeTex) return smokeTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  smokeTex = new THREE.CanvasTexture(c);
  return smokeTex;
}

function initFX(G) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FX_MAX * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(FX_MAX * 3), 3));
  const mat = new THREE.PointsMaterial({
    size: 0.55, vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  G.scene.add(points);
  const tex = getSmokeTexture();
  const smoke = [];
  for (let i = 0; i < SMOKE_POOL; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0x555560, transparent: true, opacity: 0, depthWrite: false,
    }));
    s.scale.setScalar(1);
    s.visible = false;
    G.scene.add(s);
    smoke.push({ sprite: s, life: 0, max: 1 });
  }
  G.driving.fx = {
    points, geo, smoke,
    vel: new Float32Array(FX_MAX * 3),
    life: new Float32Array(FX_MAX),
    maxLife: new Float32Array(FX_MAX),
    base: new Float32Array(FX_MAX * 3),
    grav: new Float32Array(FX_MAX),
    next: 0, smokeIdx: 0,
  };
  // Park every particle far below the island so the pool starts invisible.
  const pos = geo.attributes.position.array;
  for (let i = 0; i < FX_MAX; i++) pos[i * 3 + 1] = -100;
}

function spawnParticle(G, x, y, z, vx, vy, vz, life, r, g, b, grav) {
  const fx = G.driving.fx;
  if (!fx) return;
  const i = fx.next;
  fx.next = (fx.next + 1) % FX_MAX;
  const p = fx.geo.attributes.position.array;
  const c = fx.geo.attributes.color.array;
  p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
  fx.vel[i * 3] = vx; fx.vel[i * 3 + 1] = vy; fx.vel[i * 3 + 2] = vz;
  fx.life[i] = life; fx.maxLife[i] = life;
  fx.base[i * 3] = r; fx.base[i * 3 + 1] = g; fx.base[i * 3 + 2] = b;
  fx.grav[i] = grav;
  c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
  fx.geo.attributes.position.needsUpdate = true;
  fx.geo.attributes.color.needsUpdate = true;
}

// Orange impact sparks. `n` particles burst out from (x, y, z).
export function spawnSparks(G, x, y, z, n = 12) {
  if (!G.driving || !G.driving.fx) return;
  for (let k = 0; k < n; k++) {
    const a = G.rng() * Math.PI * 2;
    const sp = 4 + G.rng() * 9;
    spawnParticle(G, x, y, z,
      Math.sin(a) * sp, 2 + G.rng() * 6, Math.cos(a) * sp,
      0.25 + G.rng() * 0.45, 1, 0.55 + G.rng() * 0.35, 0.1, -9);
  }
}

// Rising fire tongues at (x, y, z) — called every frame by a burning car.
export function spawnFire(G, x, y, z, n = 5) {
  if (!G.driving || !G.driving.fx) return;
  for (let k = 0; k < n; k++) {
    spawnParticle(G,
      x + (G.rng() - 0.5) * 1.6, y + G.rng() * 0.5, z + (G.rng() - 0.5) * 2.6,
      (G.rng() - 0.5) * 1.2, 3 + G.rng() * 4, (G.rng() - 0.5) * 1.2,
      0.35 + G.rng() * 0.5, 1, 0.25 + G.rng() * 0.35, 0.05, 2.5);
  }
}

// One grey smoke puff that rises, grows and fades.
export function spawnSmoke(G, x, y, z, scale = 1) {
  const fx = G.driving && G.driving.fx;
  if (!fx) return;
  const s = fx.smoke[fx.smokeIdx];
  fx.smokeIdx = (fx.smokeIdx + 1) % SMOKE_POOL;
  s.sprite.position.set(x, y, z);
  s.sprite.scale.setScalar(scale);
  s.sprite.material.opacity = 0.5;
  s.sprite.visible = true;
  s.life = 1.4;
  s.max = 1.4;
  s.grow = scale;
}

function updateFX(G, dt) {
  const fx = G.driving.fx;
  if (!fx) return;
  const p = fx.geo.attributes.position.array;
  const c = fx.geo.attributes.color.array;
  let dirty = false;
  for (let i = 0; i < FX_MAX; i++) {
    if (fx.life[i] <= 0) continue;
    dirty = true;
    fx.life[i] -= dt;
    if (fx.life[i] <= 0) {
      p[i * 3 + 1] = -100;
      c[i * 3] = 0; c[i * 3 + 1] = 0; c[i * 3 + 2] = 0;
      continue;
    }
    fx.vel[i * 3 + 1] += fx.grav[i] * dt;
    p[i * 3] += fx.vel[i * 3] * dt;
    p[i * 3 + 1] += fx.vel[i * 3 + 1] * dt;
    p[i * 3 + 2] += fx.vel[i * 3 + 2] * dt;
    const f = fx.life[i] / fx.maxLife[i];
    c[i * 3] = fx.base[i * 3] * f;
    c[i * 3 + 1] = fx.base[i * 3 + 1] * f;
    c[i * 3 + 2] = fx.base[i * 3 + 2] * f;
  }
  if (dirty) {
    fx.geo.attributes.position.needsUpdate = true;
    fx.geo.attributes.color.needsUpdate = true;
  }
  for (const s of fx.smoke) {
    if (s.life <= 0) continue;
    s.life -= dt;
    if (s.life <= 0) { s.sprite.visible = false; s.sprite.material.opacity = 0; continue; }
    const f = s.life / s.max;
    s.sprite.position.y += dt * 2.2;
    s.sprite.scale.setScalar(s.grow * (1 + (1 - f) * 2.2));
    s.sprite.material.opacity = 0.5 * f;
  }
}

// ---------------------------------------------------------------- cars
export function makeCarMesh(G, def, colorOverride) {
  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorOverride ?? def.color, roughness: 0.35, metalness: 0.6,
  });
  const group = new THREE.Group();
  group.rotation.order = 'YXZ'; // heading (Y) then flip roll (Z)
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.4), bodyMat);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);

  if (def.kind === 'pickup') {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.3), glassMat);
    cabin.position.set(0, 1.1, -0.9);
    cabin.castShadow = true;
    group.add(cabin);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 1.7), bodyMat);
    bed.position.set(0, 0.95, 1.15);
    group.add(bed);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.2), glassMat);
    cabin.position.set(0, 1.1, -0.2);
    cabin.castShadow = true;
    group.add(cabin);
  }
  if (def.kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.9), signMat);
    sign.position.set(0, 1.45, -0.2);
    group.add(sign);
  }

  for (const [wx, wz] of [[-0.85, 1.45], [0.85, 1.45], [-0.85, -1.45], [0.85, -1.45]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.34, wz);
    wheel.castShadow = true;
    group.add(wheel);
  }
  for (const lx of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.06), lightFrontMat);
    head.position.set(lx, 0.62, 2.21);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.06), lightRearMat);
    tail.position.set(lx, 0.62, -2.21);
    group.add(tail);
  }
  return group;
}

export function makeCar(G, defName, x, z, heading) {
  const def = VEHICLES.find((v) => v.name === defName) || VEHICLES[0];
  const mesh = makeCarMesh(G, def);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  G.scene.add(mesh);
  return {
    mesh,
    def,
    heading,
    speed: 0,
    health: 100,
    pos: mesh.position,
    name: def.name,
    stolen: false,
    nitroTimer: 0,
    nitroCooldown: 0,
    crashCooldown: 0,
    flipped: false,
    burning: false,
    wrecked: false,
    exploded: false,
    fireTimer: 0,
    smokeTimer: 0,
    wreckSmoke: 0,
  };
}

// Flip a car wheels-up. It cannot drive until unflipped; it smokes.
export function flipCar(G, car) {
  if (!car || car.flipped) return car;
  car.flipped = true;
  car.speed = 0;
  car.mesh.rotation.z = Math.PI;
  car.mesh.position.y = 0.9;
  car.smokeTimer = 0;
  spawnSparks(G, car.mesh.position.x, 1, car.mesh.position.z, 16);
  spawnSmoke(G, car.mesh.position.x, 1.5, car.mesh.position.z, 1.4);
  return car;
}

export function unflipCar(G, car) {
  if (!car || !car.flipped) return car;
  car.flipped = false;
  car.mesh.rotation.z = 0;
  car.mesh.position.y = 0;
  return car;
}

// Set a car on fire: flames + smoke every frame, health drains, and at zero
// health it blows out in one big spark burst and becomes a wreck.
export function setCarOnFire(G, car) {
  if (!car || car.burning || car.wrecked) return car;
  car.burning = true;
  car.fireTimer = 0;
  spawnFire(G, car.mesh.position.x, 0.8, car.mesh.position.z, 10);
  spawnSmoke(G, car.mesh.position.x, 1.5, car.mesh.position.z, 1.6);
  return car;
}

export function explodeCar(G, car) {
  if (!car || car.exploded) return car;
  car.exploded = true;
  car.burning = false;
  car.wrecked = true;
  car.health = 0;
  car.speed = 0;
  const p = car.mesh.position;
  spawnSparks(G, p.x, 1, p.z, 40);
  spawnSmoke(G, p.x, 1.5, p.z, 2.4);
  spawnSmoke(G, p.x, 2.5, p.z, 2.0);
  car.wreckSmoke = CHAOS.wreckSmokeTime;
  return car;
}

// Staging helper: a car already flipped wheels-up, smoking, at (x, z).
export function spawnFlippedCar(G, defName, x, z, heading) {
  const car = makeCar(G, defName, x, z, heading || 0);
  flipCar(G, car);
  if (!G.driving.parked.includes(car)) G.driving.parked.push(car);
  return car;
}

// A ram impulse on a car: shove it sideways, kill some speed, spark, and
// flip it if the hit was fast enough. Returns true if the car flipped.
export function ramCar(G, car, nx, nz, force, relSpeed) {
  if (!car || car.flipped) return false;
  const p = car.mesh.position;
  p.x += nx * force * 0.12;
  p.z += nz * force * 0.12;
  car.speed *= 0.7;
  car.heading += (G.rng() - 0.5) * 0.15;
  spawnSparks(G, p.x - nx * 1.2, 0.9, p.z - nz * 1.2, 10);
  if (relSpeed >= CHAOS.flipHardSpeed || (relSpeed >= CHAOS.flipSpeed && G.rng() < CHAOS.flipChance)) {
    flipCar(G, car);
    return true;
  }
  return false;
}

export function initDriving(G) {
  G.driving = {
    car: null, speed: 0, parked: [], fx: null,
    score: {
      total: 0,
      drift: { active: false, chain: 0, time: 0 },
      nearMissCooldown: 0,
      popups: [], // { text, ttl, max } — HUD renders these as score popups
    },
    _driftTime: 0,
    _driftChain: 0,
  };
  initFX(G);
  // Parked cars around the city, including the gold Aurea GT by the Marina start.
  const spots = [
    ['Aurea GT', -124, 232, Math.PI],
    ['Solano S', 36, 116, 0],
    ['Palma Cruiser', -116, -193, Math.PI / 2],
    ['Faro Pickup', 116, 236, 0],
    ['Cayo Coupe', 44, -196, Math.PI / 2],
    ['Marina Taxi', -116, 44, 0],
  ];
  for (const [name, x, z, h] of spots) {
    G.driving.parked.push(makeCar(G, name, x, z, h));
  }
}

function pushPopup(G, text) {
  const popups = G.driving.score.popups;
  popups.push({ text, ttl: 1.6, max: 1.6 });
  if (popups.length > 6) popups.shift();
}

export function enterCar(G, car) {
  if (!car || car.flipped || car.wrecked) return;
  const pi = G.driving.parked.indexOf(car);
  if (pi >= 0) G.driving.parked.splice(pi, 1);
  if (G.traffic && G.traffic.cars) {
    const ti = G.traffic.cars.indexOf(car);
    if (ti >= 0) G.traffic.cars.splice(ti, 1);
  }
  car.stolen = true;
  G.player.mode = 'car';
  G.player.heading = car.heading;
  G.player.mesh.visible = false;
  G.player.pos.copy(car.mesh.position);
  G.player.vehicle = car;
  G.driving.car = car;
  G.driving.speed = car.speed || 0;
}

export function exitCar(G) {
  const car = G.driving.car;
  if (!car) return;
  const h = car.heading;
  // Step out on the right side of the car.
  const rx = -Math.cos(h), rz = Math.sin(h);
  G.player.pos.set(car.mesh.position.x + rx * 2.5, 0, car.mesh.position.z + rz * 2.5);
  G.player.heading = h;
  G.player.mode = 'foot';
  G.player.mesh.visible = true;
  G.player.mesh.rotation.y = h;
  G.player.vehicle = null;
  car.speed = 0;
  G.driving.car = null;
  G.driving.speed = 0;
  G.driving._driftTime = 0;
  G.driving._driftChain = 0;
  G.driving.score.drift.active = false;
  if (!G.driving.parked.includes(car)) G.driving.parked.push(car);
}

// Burn / smoke upkeep for cars that are not being driven (parked wrecks,
// staged chaos cars). Runs every frame regardless of player mode.
function updateParkedCars(G, dt) {
  for (const car of G.driving.parked) {
    if (car.burning) {
      const p = car.mesh.position;
      spawnFire(G, p.x, 0.8, p.z, 4);
      car.fireTimer += dt;
      if (car.fireTimer > 0.25) {
        car.fireTimer = 0;
        spawnSmoke(G, p.x, 2, p.z, 1.6);
      }
      car.health -= CHAOS.burnDrain * dt;
      if (car.health <= 0) explodeCar(G, car);
    } else if (car.wrecked && car.wreckSmoke > 0) {
      car.wreckSmoke -= dt;
      car.smokeTimer += dt;
      if (car.smokeTimer > 0.5) {
        car.smokeTimer = 0;
        spawnSmoke(G, car.mesh.position.x, 1.5, car.mesh.position.z, 1.3);
      }
    } else if (car.flipped) {
      car.smokeTimer += dt;
      if (car.smokeTimer > 0.45) {
        car.smokeTimer = 0;
        spawnSmoke(G, car.mesh.position.x, 1.6, car.mesh.position.z, 1.2);
      }
    }
  }
}

export function updateDriving(G, dt) {
  if (!G.driving) return;
  updateFX(G, dt);
  updateParkedCars(G, dt);
  const score = G.driving.score;
  score.nearMissCooldown = Math.max(0, score.nearMissCooldown - dt);
  for (let i = score.popups.length - 1; i >= 0; i--) {
    score.popups[i].ttl -= dt;
    if (score.popups[i].ttl <= 0) score.popups.splice(i, 1);
  }

  const car = G.driving.car;
  if (!car || G.player.mode !== 'car') return;
  const def = car.def;
  const owned = (G.garage && G.garage.owned) || {};
  const topSpeed = def.topSpeed * (1 + 0.25 * (owned.engine || 0));
  const brakeMul = 1 + 0.15 * (owned.brakes || 0);
  car.nitroCooldown = Math.max(0, car.nitroCooldown - dt);
  car.nitroTimer = Math.max(0, car.nitroTimer - dt);
  car.crashCooldown = Math.max(0, car.crashCooldown - dt);

  // Flipped or wrecked: no drive at all. E climbs out.
  if (car.flipped || car.wrecked) {
    car.speed = 0;
    car.smokeTimer += dt;
    if (car.smokeTimer > 0.45) {
      car.smokeTimer = 0;
      spawnSmoke(G, car.mesh.position.x, 1.6, car.mesh.position.z, 1.3);
    }
    if (Input.pressed(KEYS.interact)) exitCar(G);
    G.driving.speed = 0;
    return;
  }

  // Burning while driven: flames, drain, and a blow-out at zero health.
  if (car.burning) {
    const p = car.mesh.position;
    spawnFire(G, p.x, 0.8, p.z, 4);
    car.fireTimer += dt;
    if (car.fireTimer > 0.25) {
      car.fireTimer = 0;
      spawnSmoke(G, p.x, 2, p.z, 1.6);
    }
    car.health -= CHAOS.burnDrain * dt;
    if (car.health <= 0) {
      explodeCar(G, car);
      G.driving.speed = 0;
      if (Input.pressed(KEYS.interact)) exitCar(G);
      return;
    }
  }

  const fwd = Input.down(...KEYS.forward);
  const back = Input.down(...KEYS.back);
  const handbrake = Input.down(KEYS.handbrake);
  const steer = (Input.down(...KEYS.right) ? 1 : 0) - (Input.down(...KEYS.left) ? 1 : 0);

  let accel = 0;
  if (fwd) accel += def.accel;
  if (back) {
    if (car.speed > 0.5) accel -= def.accel * 1.4 * brakeMul; // braking
    else accel -= def.accel * 0.6; // reverse
  }
  if (car.nitroTimer > 0) accel += def.accel * 1.6;
  if (Input.down(KEYS.nitro) && (owned.nitro || 0) > 0 && car.nitroCooldown <= 0 && car.speed > 1) {
    car.nitroTimer = 1.5;
    car.nitroCooldown = 4.5;
  }
  car.speed += accel * dt;
  car.speed -= car.speed * 0.35 * dt; // drag
  if (!fwd && !back) car.speed -= car.speed * 0.6 * dt; // coast-down
  if (handbrake) car.speed -= car.speed * 2.5 * dt;
  const maxFwd = car.nitroTimer > 0 ? topSpeed * 1.45 : topSpeed;
  car.speed = clamp(car.speed, -12, maxFwd);
  if (Math.abs(car.speed) < 0.05 && !fwd && !back) car.speed = 0;

  // Steering scales with speed; stronger with the handbrake, reversed in reverse.
  const spdF = clamp(Math.abs(car.speed) / 12, 0, 1);
  const steerRate = 2.3 * (handbrake ? 1.6 : 1) * (1 + 0.1 * (owned.brakes || 0));
  car.heading += steer * steerRate * spdF * dt * Math.sign(car.speed || 1);

  car.mesh.position.x += Math.sin(car.heading) * car.speed * dt;
  car.mesh.position.z += Math.cos(car.heading) * car.speed * dt;

  // ---- drift: handbrake + steer + speed. Chain grows every 1.5 s, max x5.
  const drifting = handbrake && steer !== 0 && Math.abs(car.speed) > 12;
  if (drifting) {
    G.driving._driftTime += dt;
    G.driving._driftChain = Math.min(5, 1 + Math.floor(G.driving._driftTime / SCORE.driftChainTime));
    score.drift.active = true;
    score.drift.chain = G.driving._driftChain;
    score.drift.time = G.driving._driftTime;
  } else if (G.driving._driftTime > 0) {
    if (G.driving._driftTime >= SCORE.driftMinTime) {
      const chain = G.driving._driftChain;
      const points = SCORE.driftBase * chain * (1 + Math.floor(G.driving._driftTime));
      G.player.money += points;
      score.total += points;
      pushPopup(G, `DRIFT x${chain} +$${points}`);
    }
    G.driving._driftTime = 0;
    G.driving._driftChain = 0;
    score.drift.active = false;
    score.drift.chain = 0;
    score.drift.time = 0;
  }

  // ---- near miss: fast pass within a car-width of traffic / police, no touch.
  if (Math.abs(car.speed) > SCORE.nearMissMinSpeed && score.nearMissCooldown <= 0) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const checkList = (list) => {
      for (const other of list || []) {
        if (!other.mesh || other === car) continue;
        const dx = other.mesh.position.x - car.mesh.position.x;
        const dz = other.mesh.position.z - car.mesh.position.z;
        const along = dx * fx + dz * fz;
        const lat = Math.abs(dx * fz - dz * fx);
        if (Math.abs(along) < 4.5 && lat > 2.2 && lat < SCORE.nearMissRange) {
          G.player.money += SCORE.nearMiss;
          score.total += SCORE.nearMiss;
          score.nearMissCooldown = SCORE.nearMissCooldown;
          pushPopup(G, `NEAR MISS +$${SCORE.nearMiss}`);
          return true;
        }
      }
      return false;
    };
    if (!checkList(G.traffic ? G.traffic.cars : null) && G.police) {
      checkList(G.police.units.filter((u) => u.kind === 'car'));
    }
  }

  // ---- building / palm colliders: push-out, sparks, smoke, damage, flip.
  if (G.city) {
    for (const c of G.city.colliders) {
      const dx = car.mesh.position.x - c.x;
      const dz = car.mesh.position.z - c.z;
      const r = c.r + 1.3;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const impact = Math.abs(car.speed);
        car.mesh.position.x = c.x + (dx / d) * r;
        car.mesh.position.z = c.z + (dz / d) * r;
        if (impact > 4 && car.crashCooldown <= 0) {
          car.health -= 5;
          car.crashCooldown = 0.5;
          spawnSparks(G, car.mesh.position.x, 0.9, car.mesh.position.z, impact > 12 ? 16 : 8);
          if (impact > 12) spawnSmoke(G, car.mesh.position.x, 1.2, car.mesh.position.z, 1.1);
          if (impact >= CHAOS.flipHardSpeed
            || (impact >= CHAOS.flipSpeed && (handbrake || G.rng() < CHAOS.flipChance))) {
            flipCar(G, car);
            G.driving.speed = 0;
            G.player.speed = 0;
            return;
          }
        }
        car.speed *= 0.5;
      }
    }
  }

  // ---- traffic cars: push-apart, sparks on hard hits, both slow down.
  if (G.traffic) {
    for (const t of G.traffic.cars) {
      const dx = car.mesh.position.x - t.mesh.position.x;
      const dz = car.mesh.position.z - t.mesh.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 3.4 * 3.4 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (3.4 - d) / 2;
        const nx = dx / d, nz = dz / d;
        car.mesh.position.x += nx * push;
        car.mesh.position.z += nz * push;
        t.kickX = (t.kickX || 0) - nx * push;
        t.kickZ = (t.kickZ || 0) - nz * push;
        if (Math.abs(car.speed) > 5 && car.crashCooldown <= 0) {
          car.health -= 3;
          car.crashCooldown = 0.4;
          spawnSparks(G, car.mesh.position.x, 0.9, car.mesh.position.z, 10);
          if (Math.abs(car.speed) > 18) {
            spawnSmoke(G, car.mesh.position.x, 1.2, car.mesh.position.z, 1.1);
            if (G.rng() < 0.35) flipCar(G, car);
          }
        }
        car.speed *= 0.7;
        t.speed *= 0.6;
      }
    }
  }

  // ---- police cars: same contact as traffic, but they are heavier — a fast
  // hit damages the unit (police.js wrecks/flips it at zero health).
  if (G.police) {
    for (const u of G.police.units) {
      if (u.kind !== 'car' || !u.mesh || u.flipped) continue;
      const dx = car.mesh.position.x - u.pos.x;
      const dz = car.mesh.position.z - u.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 3.6 * 3.6 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (3.6 - d) / 2;
        const nx = dx / d, nz = dz / d;
        const rel = Math.abs(car.speed) + Math.abs(u.speed || 0);
        car.mesh.position.x += nx * push;
        car.mesh.position.z += nz * push;
        u.pos.x -= nx * push;
        u.pos.z -= nz * push;
        if (rel > 8 && car.crashCooldown <= 0) {
          car.crashCooldown = 0.4;
          car.health -= 4;
          u.health = (u.health ?? 100) - Math.round(rel);
          spawnSparks(G, car.mesh.position.x, 0.9, car.mesh.position.z, 14);
          if (rel > 24) {
            spawnSmoke(G, u.pos.x, 1.2, u.pos.z, 1.2);
            if (G.rng() < 0.5) flipCar(G, car);
          }
        }
        car.speed *= 0.65;
        u.speed = (u.speed || 0) * 0.5;
      }
    }
  }

  car.mesh.position.x = clamp(car.mesh.position.x, -318, 318);
  car.mesh.position.z = clamp(car.mesh.position.z, -318, 318);
  car.mesh.rotation.y = car.heading;

  // Wrecked: no drive, E steps out.
  if (car.health <= 0) {
    car.health = 0;
    car.wrecked = true;
    car.speed = 0;
    car.wreckSmoke = CHAOS.wreckSmokeTime;
    spawnSmoke(G, car.mesh.position.x, 1.5, car.mesh.position.z, 1.6);
    if (Input.pressed(KEYS.interact)) exitCar(G);
  }

  G.player.pos.copy(car.mesh.position);
  G.player.heading = car.heading;
  G.player.speed = car.speed;
  G.driving.speed = car.speed;
}
