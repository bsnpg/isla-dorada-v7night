// Isla Dorada — Wowo on foot: movement, mouse look, walk swing, car entry.
// When the player is in a car, driving.js owns movement and this module only
// keeps the on-foot mesh hidden. Health hitting zero drops Wowo: main.js shows
// the dead screen (respawn restarts the current job).
import * as THREE from 'three';
import { KEYS } from './config.js';
import { Input } from './input.js';
import { angleLerp, clamp } from './random.js';
import { spawnSmoke } from './driving.js';

const START = { x: -120, z: 240 }; // Marina

function buildWowoMesh() {
  const jacket = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.95 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a077, roughness: 0.8 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 });
  const tags = new THREE.MeshStandardMaterial({ color: 0xc0c0c8, roughness: 0.3, metalness: 0.9 });

  const legGeo = new THREE.BoxGeometry(0.22, 0.75, 0.24);
  legGeo.translate(0, -0.375, 0);
  const armGeo = new THREE.BoxGeometry(0.16, 0.65, 0.18);
  armGeo.translate(0, -0.3, 0);

  const g = new THREE.Group();
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.14, 0.78, 0);
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.14, 0.78, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.34), jacket);
  torso.position.y = 1.13;
  const armL = new THREE.Mesh(armGeo, jacket);
  armL.position.set(-0.4, 1.42, 0);
  const armR = new THREE.Mesh(armGeo, jacket);
  armR.position.set(0.4, 1.42, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), skin);
  head.position.y = 1.66;
  const hairBox = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.32), hair);
  hairBox.position.y = 1.85;
  const dogTags = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.02), tags);
  dogTags.position.set(0, 1.25, 0.19);
  for (const part of [legL, legR, torso, armL, armR, head, hairBox, dogTags]) {
    part.castShadow = true;
    g.add(part);
  }
  // Jetpack on Wowo's back: two tanks, a nozzle, and a flame cone that only
  // shows while thrusting (player.js update / combat.js setJetpack pose it).
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.35, metalness: 0.8 });
  const tankBand = new THREE.MeshStandardMaterial({ color: 0xd86a20, roughness: 0.5, metalness: 0.4 });
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.6 });
  const jetpack = new THREE.Group();
  for (const tx of [-0.16, 0.16]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.55, 12), tankMat);
    tank.position.set(tx, 1.15, -0.26);
    tank.castShadow = true;
    jetpack.add(tank);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.08, 12), tankBand);
    band.position.set(tx, 1.32, -0.26);
    jetpack.add(band);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.12, 10), nozzleMat);
    nozzle.position.set(tx, 0.82, -0.26);
    jetpack.add(nozzle);
  }
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffa030, transparent: true, opacity: 0.9, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.85, 10), flameMat);
  flame.rotation.x = Math.PI; // point down
  flame.position.set(0, 0.42, -0.26);
  flame.visible = false;
  jetpack.add(flame);
  g.add(jetpack);
  g.userData = { legL, legR, armL, armR, jetpack, jetpackFlame: flame };
  return g;
}

function nearestCar(G, pos, maxD) {
  let best = null, bestD = maxD * maxD;
  const lists = [];
  if (G.driving && G.driving.parked) lists.push(G.driving.parked);
  if (G.traffic && G.traffic.cars) lists.push(G.traffic.cars);
  for (const list of lists) {
    for (const car of list) {
      if (car.flipped || car.burning) continue; // cannot steal a wreck
      const dx = car.mesh.position.x - pos.x;
      const dz = car.mesh.position.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestD) { bestD = d2; best = car; }
    }
  }
  return best;
}

// Shared damage path: armour absorbs first, then health. Used by combat and
// police so a hit in one place behaves the same everywhere.
export function hurtPlayer(G, amount) {
  const p = G.player;
  if (!p || p.health <= 0) return;
  let left = Math.max(0, amount);
  if (p.armour > 0) {
    const absorbed = Math.min(p.armour, left);
    p.armour -= absorbed;
    left -= absorbed;
  }
  if (left > 0) p.health = Math.max(0, p.health - left);
}

// Shove the on-foot player away from (x, z) — a car strike or a ram.
export function knockPlayer(G, x, z, force) {
  const p = G.player;
  if (!p || p.mode !== 'foot') return;
  const dx = p.pos.x - x;
  const dz = p.pos.z - z;
  const d = Math.hypot(dx, dz) || 1;
  p.pos.x += (dx / d) * force;
  p.pos.z += (dz / d) * force;
  p.heading = Math.atan2(dx, dz);
}

export function initPlayer(G) {
  const mesh = buildWowoMesh();
  mesh.position.set(START.x, 0, START.z);
  mesh.rotation.y = Math.PI; // facing north, into the city
  G.scene.add(mesh);
  G.player = {
    mode: 'foot',
    pos: mesh.position,
    heading: Math.PI,
    speed: 0,
    health: 100,
    armour: 0,
    money: 1250,
    mesh,
    vehicle: null,
    hurtCooldown: 0,
  };
  // Jetpack: real flight state. fuel drains while thrusting (Space on foot),
  // refills on the ground; vy is the vertical velocity (m/s).
  G.jetpack = { fuel: 100, maxFuel: 100, active: false, owned: true, vy: 0, _smokeTimer: 0 };
}

export function updatePlayer(G, dt) {
  const p = G.player;
  if (!p) return;
  p.hurtCooldown = Math.max(0, (p.hurtCooldown || 0) - dt);
  if (p.mode === 'car') {
    p.mesh.visible = false;
    if (G.jetpack) {
      G.jetpack.active = false;
      G.jetpack.vy = 0;
      const f = p.mesh.userData.jetpackFlame;
      if (f) f.visible = false;
    }
    return;
  }
  p.mesh.visible = true;

  // Mouse look (only while the pointer is locked); click the canvas to lock it.
  const { dx } = Input.consumeMouse();
  if (Input.pointerLocked && dx) p.heading += dx * 0.0028;
  if (Input.consumeClick()) Input.lockPointer(G.renderer.domElement);

  // WASD, relative to facing; Shift runs.
  // With the pointer locked, A/D strafe and the mouse turns the heading.
  // Without it, A/D turn the heading directly (keyboard-only steering) — the
  // heading never follows the strafe direction, which spun the player in a loop.
  const fwd = (Input.down(...KEYS.forward) ? 1 : 0) - (Input.down(...KEYS.back) ? 1 : 0);
  const str = (Input.down(...KEYS.right) ? 1 : 0) - (Input.down(...KEYS.left) ? 1 : 0);
  const speed = Input.down('ShiftLeft', 'ShiftRight') ? 9 : 6;
  let mx = 0, mz = 0;
  if (Input.pointerLocked) {
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    const rx = -Math.cos(p.heading), rz = Math.sin(p.heading);
    mx = fx * fwd + rx * str;
    mz = fz * fwd + rz * str;
  } else {
    p.heading += -str * 1.9 * dt; // A turns left, D turns right
    mx = Math.sin(p.heading) * fwd;
    mz = Math.cos(p.heading) * fwd;
  }
  const len = Math.hypot(mx, mz);
  if (len > 0.01) {
    mx /= len;
    mz /= len;
    p.pos.x += mx * speed * dt;
    p.pos.z += mz * speed * dt;
    p.speed = speed;
  } else {
    p.speed = 0;
  }

  // Building / palm colliders: circle push-out.
  if (G.city) {
    for (const c of G.city.colliders) {
      const dx = p.pos.x - c.x;
      const dz = p.pos.z - c.z;
      const r = c.r + 0.5;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.pos.x = c.x + (dx / d) * r;
        p.pos.z = c.z + (dz / d) * r;
      }
    }
  }
  p.pos.x = clamp(p.pos.x, -318, 318);
  p.pos.z = clamp(p.pos.z, -318, 318);
  p.mesh.rotation.y = p.heading;

  // Walk swing (legs tuck while airborne).
  const u = p.mesh.userData;
  const airborne = p.pos.y > 0.05;
  const swing = !airborne && p.speed > 0 ? Math.sin(G.time * 10) * 0.55 : 0;
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  u.armL.rotation.x = -swing * 0.8;
  u.armR.rotation.x = swing * 0.8;
  if (airborne) {
    u.legL.rotation.x = 0.35;
    u.legR.rotation.x = 0.25;
  }

  // ---- jetpack: hold Space on foot to thrust up, WASD steers (handled
  // above). Fuel drains while thrusting, refills on the ground. Gravity
  // pulls Wowo back down when the thrust stops; landing is at y = 0.
  const jp = G.jetpack;
  const flame = u.jetpackFlame;
  if (jp && jp.owned) {
    const grounded = p.pos.y <= 0.001;
    const wantThrust = Input.down('Space') && jp.fuel > 0;
    jp.active = wantThrust;
    if (wantThrust) {
      jp.vy = Math.min(jp.vy + 26 * dt, 9);
      jp.fuel = Math.max(0, jp.fuel - 26 * dt);
      if (flame) {
        flame.visible = true;
        flame.scale.set(0.85 + G.rng() * 0.4, 0.9 + G.rng() * 0.5, 0.85 + G.rng() * 0.4);
        flame.material.opacity = 0.75 + G.rng() * 0.25;
      }
      jp._smokeTimer -= dt;
      if (jp._smokeTimer <= 0) {
        jp._smokeTimer = 0.07;
        spawnSmoke(G, p.pos.x - Math.sin(p.heading) * 0.26, p.pos.y + 0.7, p.pos.z - Math.cos(p.heading) * 0.26, 0.7);
      }
    } else {
      if (flame) flame.visible = false;
      if (grounded) jp.fuel = Math.min(jp.maxFuel, jp.fuel + 32 * dt);
      if (!grounded || jp.vy !== 0) jp.vy -= 22 * dt;
    }
    jp.vy = clamp(jp.vy, -14, 9);
    p.pos.y += jp.vy * dt;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      jp.vy = 0;
    }
  }

  // Traffic strike: a fast car that clips Wowo on foot knocks him down.
  if (G.traffic && p.hurtCooldown <= 0) {
    for (const t of G.traffic.cars) {
      const dx = p.pos.x - t.mesh.position.x;
      const dz = p.pos.z - t.mesh.position.z;
      if (dx * dx + dz * dz < 1.7 * 1.7 && Math.abs(t.speed || 0) > 5) {
        knockPlayer(G, t.mesh.position.x, t.mesh.position.z, 2.5);
        hurtPlayer(G, 10);
        p.hurtCooldown = 1;
        break;
      }
    }
  }

  // E near a car: steal it (5 m radius, forgiving for a first-time player).
  if (Input.pressed(KEYS.interact)) {
    const car = nearestCar(G, p.pos, 5);
    if (car) {
      G.enterCar(car);
      G.stats.carsStolen++;
      if (G.police) G.setWanted(Math.max(G.police.wanted, 1));
    }
  }

  // Down: health zero ends the run (main.js shows the dead screen).
  if (p.health <= 0 && G.mode === 'play') {
    G.setMode('dead');
  }
}
