// Isla Dorada — on-foot combat: weapon rack, shooting, enemy AI.
// Fires only on foot in play mode. Ray is the camera centre; hits are sphere
// tests against enemies (radius 1.2 m). Every shot reads as a fight: a muzzle
// flash at the gun, a bright tracer to the hit point, impact sparks, and a
// floating damage number ("-45") over the enemy. Enemies that die fall and
// STAY DOWN (G.combat.downed) instead of vanishing. Enemy fire is visible too
// — tracers and flashes coming back at Wowo.
// Staging hooks at the bottom (stageChaosScene etc.) let shots.js build the
// chaotic combat cover: flipped police car + burning car + firing enemies +
// a ramming unit, all in one call.
import * as THREE from 'three';
import { KEYS, WEAPONS } from './config.js';
import { Input } from './input.js';
import { clamp, lerp } from './random.js';
import { explodeCar, flipCar, makeCar, setCarOnFire, spawnFire, spawnSmoke, spawnSparks } from './driving.js';
import { flipPoliceCar, setWanted, spawnFlippedPoliceCar, spawnPoliceCar, spawnRammingPolice } from './police.js';
import { initDrops, spawnEnemyDrop, updateDrops } from './drops.js';

const TRACER_POOL = 16;
const TRACER_LIFE = 0.09;
const FLASH_POOL = 4;
const FLASH_LIFE = 0.06;
const DMG_POOL = 10;
const DMG_LIFE = 0.9;

let tracerGeo = null;
let flashTex = null;

function getFlashTexture() {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,220,1)');
  g.addColorStop(0.35, 'rgba(255,200,80,0.9)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  // Star spikes so the flash reads at a glance, not as a soft blob.
  ctx.strokeStyle = 'rgba(255,240,180,0.95)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(32, 2); ctx.lineTo(32, 62);
  ctx.moveTo(2, 32); ctx.lineTo(62, 32);
  ctx.moveTo(11, 11); ctx.lineTo(53, 53);
  ctx.moveTo(53, 11); ctx.lineTo(11, 53);
  ctx.stroke();
  flashTex = new THREE.CanvasTexture(c);
  return flashTex;
}

function makeHumanoid(kind) {
  const isHeavy = kind === 'heavy';
  const s = isHeavy ? 1.25 : 1.0;
  const bodyColor = isHeavy ? 0x5a5f66 : 0x8a2a2a; // bulky grey / dark red
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc98a5a, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.9 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62 * s, 0.75 * s, 0.34 * s), bodyMat);
  torso.position.y = 1.15 * s;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34 * s, 0.34 * s, 0.34 * s), skinMat);
  head.position.y = 1.72 * s;
  head.castShadow = true;
  group.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22 * s, 0.7 * s, 0.24 * s), darkMat);
  legL.position.set(-0.17 * s, 0.35 * s, 0);
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.22 * s, 0.7 * s, 0.24 * s), darkMat);
  legR.position.set(0.17 * s, 0.35 * s, 0);
  group.add(legR);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.18 * s, 0.55 * s, 0.18 * s), bodyMat);
  armR.position.set(0.4 * s, 1.2 * s, 0.18 * s);
  armR.rotation.x = -Math.PI / 2.4; // raised, holding a gun
  group.add(armR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.55), darkMat);
  gun.position.set(0.4 * s, 1.32 * s, 0.45 * s);
  group.add(gun);
  return group;
}

export function initCombat(G) {
  initDrops(G); // enemy drops: cash + weapon pickups from downed enemies
  G.combat = {
    weaponIndex: 0,
    // Real mag/reserve split per weapon. `ammo` stays as a live total
    // (mag + reserve) so legacy readers (drops.js collect, shots.js staging)
    // keep working: adding to `ammo` tops up the reserve, taking from it
    // drains reserve first, then the mag.
    weapons: WEAPONS.map((w) => {
      const o = {
        ...w,
        mag: w.magSize,
        magSize: w.magSize,
        reserve: w.reserve,
      };
      Object.defineProperty(o, 'ammo', {
        enumerable: true,
        get() { return o.mag + o.reserve; },
        set(v) {
          let d = v - (o.mag + o.reserve);
          if (d > 0) o.reserve += d;
          else if (d < 0) {
            const fromReserve = Math.min(o.reserve, -d);
            o.reserve -= fromReserve;
            d += fromReserve;
            if (d < 0) o.mag = Math.max(0, o.mag + d);
          }
        },
      });
      return o;
    }),
    enemies: [],
    downed: [], // bodies that fell and stay down (visible, not active targets)
    shake: 0, // screen-shake magnitude (camera agent wires this in); set by explosions
    _fireTimer: 0,
    _tracers: [],
    _tracerIdx: 0,
    _flashes: [],
    _flashIdx: 0,
    _flashLight: null,
    _dmgNums: [],
    _dmgIdx: 0,
    _rockets: [], // live bazooka rockets { mesh, vel, life, trailTimer }
    _explosions: [], // fireball + shockwave-ring visuals { group|mesh, life, max, kind, radius }
    _debris: [], // flying explosion debris { mesh, vx, vy, vz, life, spin }
    _scorch: [], // ground scorch marks { mesh, life, max }
    _lingering: [], // smoke columns still rising after an explosion { x, y, z, life, timer }
  };
  // One shared flash light: parked at the latest muzzle, decays fast.
  const light = new THREE.PointLight(0xffc860, 0, 18, 1.8);
  G.scene.add(light);
  G.combat._flashLight = light;
  const tex = getFlashTexture();
  for (let i = 0; i < FLASH_POOL; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    sprite.visible = false;
    G.scene.add(sprite);
    G.combat._flashes.push({ sprite, life: 0 });
  }
  for (let i = 0; i < DMG_POOL; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 80;
    const tex2 = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex2, transparent: true, opacity: 0, depthWrite: false,
    }));
    sprite.scale.set(2.2, 1.1, 1);
    sprite.visible = false;
    G.scene.add(sprite);
    G.combat._dmgNums.push({ sprite, canvas, tex: tex2, life: 0 });
  }
}

export function spawnEnemy(G, x, z, kind) {
  const k = kind === 'heavy' ? 'heavy' : 'gunman';
  const mesh = makeHumanoid(k);
  mesh.position.set(x, 0, z);
  G.scene.add(mesh);
  const enemy = {
    mesh,
    kind: k,
    hp: k === 'heavy' ? 160 : 60,
    maxHp: k === 'heavy' ? 160 : 60,
    pos: mesh.position,
    shootTimer: 0.6 + G.rng() * 0.8,
    strafeTimer: 1 + G.rng(),
    strafeDir: G.rng() < 0.5 ? -1 : 1,
    state: 'alive',
    flashTimer: 0,
    fallTimer: 0,
  };
  G.combat.enemies.push(enemy);
  return enemy;
}

// An enemy that opens fire immediately — used by the chaos staging.
export function spawnFiringEnemy(G, x, z, kind) {
  const e = spawnEnemy(G, x, z, kind);
  e.shootTimer = 0.1;
  return e;
}

// A body that is already down: lying flat, staying in the scene as a
// downed enemy. Not an active target, not counted by mission combat stages.
export function spawnDownedEnemy(G, x, z, kind) {
  const k = kind === 'heavy' ? 'heavy' : 'gunman';
  const mesh = makeHumanoid(k);
  mesh.position.set(x, 0.15, z);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.y = G.rng() * Math.PI * 2;
  G.scene.add(mesh);
  const enemy = {
    mesh, kind: k, hp: 0, maxHp: k === 'heavy' ? 160 : 60,
    pos: mesh.position, shootTimer: 0, strafeTimer: 0, strafeDir: 1,
    state: 'downed', flashTimer: 0, fallTimer: 1,
  };
  G.combat.downed.push(enemy);
  return enemy;
}

// Remove all downed bodies from the scene (stage change / mission start).
export function clearDowned(G) {
  if (!G.combat) return;
  for (const e of G.combat.downed) G.scene.remove(e.mesh);
  G.combat.downed.length = 0;
}

function getTracer(G) {
  const c = G.combat;
  if (!tracerGeo) tracerGeo = new THREE.BufferGeometry();
  let t = c._tracers[c._tracerIdx];
  c._tracerIdx = (c._tracerIdx + 1) % TRACER_POOL;
  if (!t) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 });
    t = { line: new THREE.Line(geo, mat), life: 0 };
    G.scene.add(t.line);
    c._tracers.push(t);
  }
  return t;
}

function fireTracer(G, from, to, color) {
  const t = getTracer(G);
  if (color !== undefined) t.line.material.color.setHex(color);
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.material.opacity = 0.95;
  t.life = TRACER_LIFE;
}

// Bright star-burst at the muzzle + a hot point light that dies in 60 ms.
function flashMuzzle(G, at, scale) {
  const c = G.combat;
  const f = c._flashes[c._flashIdx];
  c._flashIdx = (c._flashIdx + 1) % FLASH_POOL;
  f.sprite.position.copy(at);
  f.sprite.scale.setScalar((scale || 1) * (0.9 + G.rng() * 0.4));
  f.sprite.material.opacity = 1;
  f.sprite.material.rotation = G.rng() * Math.PI;
  f.sprite.visible = true;
  f.life = FLASH_LIFE;
  if (c._flashLight) {
    c._flashLight.position.copy(at);
    c._flashLight.intensity = 60;
  }
}

// Floating damage number ("-45") that rises and fades over 0.9 s.
export function spawnDamageNumber(G, x, y, z, text, color) {
  const c = G.combat;
  if (!c || !c._dmgNums.length) return;
  const d = c._dmgNums[c._dmgIdx];
  c._dmgIdx = (c._dmgIdx + 1) % DMG_POOL;
  const ctx = d.canvas.getContext('2d');
  ctx.clearRect(0, 0, 160, 80);
  ctx.font = 'bold 44px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, 80, 42);
  ctx.fillStyle = color || '#ffd94a';
  ctx.fillText(text, 80, 42);
  d.tex.needsUpdate = true;
  d.sprite.position.set(x, y, z);
  d.sprite.material.opacity = 1;
  d.sprite.visible = true;
  d.life = DMG_LIFE;
}

function damagePlayer(G, amount) {
  const p = G.player;
  if (!p) return;
  let left = amount;
  if (p.armour > 0) {
    const absorbed = Math.min(p.armour, left);
    p.armour -= absorbed;
    left -= absorbed;
  }
  if (left > 0) p.health = Math.max(0, p.health - left);
  if (left > 0) spawnDamageNumber(G, p.pos.x, 2.4, p.pos.z, `-${left}`, '#ff5a4a');
}

function tryFire(G) {
  const c = G.combat;
  const w = c.weapons[c.weaponIndex];
  if (!w || w.mag <= 0) return; // empty mag: R reloads from reserve, never auto-fires
  w.mag -= 1;
  G.stats.shotsFired += 1;

  // Gun position: just in front of the player at chest height.
  const p = G.player.pos;
  const h = G.player.heading;
  const from = new THREE.Vector3(
    p.x + Math.sin(h) * 0.6, 1.4, p.z + Math.cos(h) * 0.6,
  );

  // Bazooka: no hitscan — launch a real rocket down the camera ray.
  if (w.name === 'Bazooka') {
    flashMuzzle(G, from, w.flash || 2);
    fireRocket(G, from);
    return;
  }
  // Ray through the screen centre.
  const dir = new THREE.Vector3();
  G.camera.getWorldDirection(dir);
  const origin = G.camera.position;

  // Sphere test (radius 1.2 m) against every live enemy; take the nearest.
  let best = null;
  let bestT = Infinity;
  const toCentre = new THREE.Vector3();
  for (const e of c.enemies) {
    if (e.state !== 'alive') continue;
    const cx = e.pos.x, cy = e.pos.y + 1.2, cz = e.pos.z;
    toCentre.set(cx - origin.x, cy - origin.y, cz - origin.z);
    const t = toCentre.dot(dir);
    if (t < 0 || t > w.range) continue;
    const px = origin.x + dir.x * t - cx;
    const py = origin.y + dir.y * t - cy;
    const pz = origin.z + dir.z * t - cz;
    if (px * px + py * py + pz * pz < 1.2 * 1.2 && t < bestT) {
      best = e;
      bestT = t;
    }
  }
  const hitPoint = best
    ? new THREE.Vector3(origin.x + dir.x * bestT, origin.y + dir.y * bestT, origin.z + dir.z * bestT)
    : new THREE.Vector3(origin.x + dir.x * w.range, origin.y + dir.y * w.range, origin.z + dir.z * w.range);
  flashMuzzle(G, from, w.flash || 1);
  fireTracer(G, from, hitPoint, w.tracer);

  if (best) {
    best.hp -= w.damage;
    best.flashTimer = 0.12; // emissive flash + scale pulse, handled in update
    spawnDamageNumber(G, best.pos.x, best.pos.y + 2.3, best.pos.z, `-${w.damage}`, '#ffd94a');
    spawnSparks(G, hitPoint.x, hitPoint.y, hitPoint.z, 6);
    if (best.hp <= 0) {
      best.state = 'falling';
      best.fallTimer = 0;
      // No instant payout: the kill pays through the drop he leaves when
      // his body hits the ground (spawnEnemyDrop, in updateEnemy below).
    }
  } else {
    // Miss: the round still hits something — sparks where the tracer ends.
    spawnSparks(G, hitPoint.x, Math.max(0.3, hitPoint.y), hitPoint.z, 4);
  }
}

// ---------------------------------------------------------------- bazooka
function makeRocketMesh() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.4, metalness: 0.7 });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xd86a20, roughness: 0.5, metalness: 0.3 });
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffa030, transparent: true, opacity: 0.95, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.85, 10), bodyMat);
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 10), tipMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.57;
  group.add(nose);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.18), bodyMat);
    const a = (i / 4) * Math.PI * 2;
    fin.position.set(Math.sin(a) * 0.1, Math.cos(a) * 0.1, -0.42);
    fin.rotation.z = a;
    group.add(fin);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 8), flameMat);
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = -0.68;
  group.add(flame);
  return group;
}

// Launch a rocket from `from` along the camera ray. It flies, leaves a
// smoke trail, and detonates via explodeAt on ground / enemy / car impact.
function fireRocket(G, from) {
  const c = G.combat;
  const w = c.weapons[c.weaponIndex];
  const dir = new THREE.Vector3();
  G.camera.getWorldDirection(dir);
  if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
  dir.normalize();
  const mesh = makeRocketMesh();
  mesh.position.copy(from);
  mesh.lookAt(from.x + dir.x, from.y + dir.y, from.z + dir.z);
  G.scene.add(mesh);
  spawnSmoke(G, from.x, from.y, from.z, 0.9);
  c._rockets.push({
    mesh,
    vel: dir.clone().multiplyScalar(48),
    life: (w ? w.range : 120) / 48 + 0.5,
    trailTimer: 0,
  });
}

function updateRockets(G, dt) {
  const c = G.combat;
  for (const r of [...c._rockets]) {
    r.life -= dt;
    r.mesh.position.addScaledVector(r.vel, dt);
    r.trailTimer -= dt;
    if (r.trailTimer <= 0) {
      r.trailTimer = 0.03;
      const p = r.mesh.position;
      spawnSmoke(G, p.x, p.y, p.z, 0.55);
    }
    const p = r.mesh.position;
    let hit = p.y <= 0.25 || r.life <= 0;
    if (!hit) {
      for (const e of c.enemies) {
        if (e.state !== 'alive') continue;
        if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < 1.8 && Math.abs((e.pos.y + 1.2) - p.y) < 2.2) { hit = true; break; }
      }
    }
    if (!hit) {
      const carLists = [];
      if (G.driving && G.driving.parked) carLists.push(G.driving.parked);
      if (G.traffic && G.traffic.cars) carLists.push(G.traffic.cars);
      if (G.driving && G.driving.car) carLists.push([G.driving.car]);
      for (const list of carLists) {
        for (const car of list) {
          if (!car || !car.mesh) continue;
          const cp = car.mesh.position;
          if (Math.hypot(cp.x - p.x, cp.z - p.z) < 2.4 && p.y < 2.5) { hit = true; break; }
        }
        if (hit) break;
      }
    }
    if (!hit && G.police) {
      for (const u of G.police.units) {
        if (u.kind !== 'car' || !u.pos || u.flipped) continue;
        if (Math.hypot(u.pos.x - p.x, u.pos.z - p.z) < 2.4 && p.y < 2.5) { hit = true; break; }
      }
    }
    if (hit) {
      G.scene.remove(r.mesh);
      c._rockets.splice(c._rockets.indexOf(r), 1);
      explodeAt(G, p.x, Math.max(0.4, p.y), p.z, 12);
    }
  }
}

// ---------------------------------------------------------------- explosion
// The big one: fireball (orange/yellow spheres + upward cones), a tall smoke
// column that lingers ~8 s, an expanding shockwave ring, flying debris,
// screen shake, and a scorch mark on the ground for ~30 s. Everything is a
// real mesh/particle in the scene at t = 0, so a frozen screenshot frame
// already reads as an explosion — not just a flash.
function spawnExplosionVisuals(G, x, y, z, radius) {
  const c = G.combat;
  // Fireball: layered spheres + flame cones, expanding and fading over 0.9 s.
  const group = new THREE.Group();
  group.position.set(x, Math.max(1, y), z);
  const ballMats = [];
  const ball = (color, r, bx, by, bz, emissive) => {
    const m = new THREE.MeshStandardMaterial({
      color, emissive: emissive || color, emissiveIntensity: 2.2,
      transparent: true, opacity: 1, roughness: 0.6,
    });
    ballMats.push(m);
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m);
    s.position.set(bx, by, bz);
    group.add(s);
    return s;
  };
  ball(0xff5a00, 2.4, 0, 0, 0);
  ball(0xffa030, 1.8, 0.5, 0.6, 0.3);
  ball(0xffe08a, 1.1, -0.3, 0.9, -0.2);
  for (const [cx, cz, h] of [[0.9, 0.4, 2.6], [-0.8, -0.5, 2.1], [0.1, 0.9, 1.7]]) {
    const m = new THREE.MeshStandardMaterial({
      color: 0xff7a10, emissive: 0xff7a10, emissiveIntensity: 2,
      transparent: true, opacity: 1, roughness: 0.6,
    });
    ballMats.push(m);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, h, 10), m);
    cone.position.set(cx, h / 2, cz);
    group.add(cone);
  }
  G.scene.add(group);
  c._explosions.push({ group, mats: ballMats, life: 0.9, max: 0.9, kind: 'fireball' });
  // Shockwave ring: flat on the ground, grows to the blast radius.
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffc060, transparent: true, opacity: 0.85, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.18, z);
  G.scene.add(ring);
  c._explosions.push({ mesh: ring, mat: ringMat, life: 0.7, max: 0.7, kind: 'ring', radius });
  // Flying debris: small dark boxes thrown up and out, spinning, with gravity.
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 });
  for (let i = 0; i < 12; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), debrisMat);
    d.position.set(x, Math.max(1, y), z);
    G.scene.add(d);
    const a = G.rng() * Math.PI * 2;
    const sp = 5 + G.rng() * 9;
    c._debris.push({
      mesh: d, vx: Math.sin(a) * sp, vy: 6 + G.rng() * 9, vz: Math.cos(a) * sp,
      life: 1.4, spin: (G.rng() - 0.5) * 12,
    });
  }
  // Scorch mark: dark circle on the ground, persists ~30 s.
  const scorchMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.68, depthWrite: false });
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(3.2, 28), scorchMat);
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.set(x, 0.03, z);
  G.scene.add(scorch);
  c._scorch.push({ mesh: scorch, mat: scorchMat, life: 30, max: 30 });
  // Lingering smoke column: puffs keep rising/fading for ~8 s.
  c._lingering.push({ x, y: Math.max(1, y), z, life: 8, timer: 0 });
  // Particles + light + shake.
  spawnFire(G, x, 1, z, 30);
  spawnSparks(G, x, 1, z, 50);
  spawnSmoke(G, x, 2, z, 2.4);
  spawnSmoke(G, x, 3.5, z, 2.0);
  spawnSmoke(G, x, 1.2, z, 1.6);
  if (c._flashLight) {
    c._flashLight.position.set(x, y + 2, z);
    c._flashLight.intensity = 250;
  }
  c.shake = 1.4;
}

function updateExplosionFX(G, dt) {
  const c = G.combat;
  for (const ex of [...c._explosions]) {
    ex.life -= dt;
    const f = Math.max(0, ex.life / ex.max);
    if (ex.kind === 'fireball') {
      const grow = 1 + (1 - f) * 2.2;
      ex.group.scale.setScalar(grow);
      ex.group.position.y += dt * 1.5;
      for (const m of ex.mats) m.opacity = f;
    } else if (ex.kind === 'ring') {
      const s = 1 + (1 - f) * ex.radius;
      ex.mesh.scale.setScalar(s);
      ex.mat.opacity = 0.85 * f;
    }
    if (ex.life <= 0) {
      G.scene.remove(ex.group || ex.mesh);
      c._explosions.splice(c._explosions.indexOf(ex), 1);
    }
  }
  for (const d of [...c._debris]) {
    d.life -= dt;
    d.vy -= 18 * dt;
    d.mesh.position.x += d.vx * dt;
    d.mesh.position.y += d.vy * dt;
    d.mesh.position.z += d.vz * dt;
    d.mesh.rotation.x += d.spin * dt;
    d.mesh.rotation.y += d.spin * 0.7 * dt;
    if (d.life <= 0 || d.mesh.position.y < 0.05) {
      G.scene.remove(d.mesh);
      c._debris.splice(c._debris.indexOf(d), 1);
    }
  }
  for (const s of [...c._scorch]) {
    s.life -= dt;
    if (s.life < 5) s.mat.opacity = 0.68 * (s.life / 5);
    if (s.life <= 0) {
      G.scene.remove(s.mesh);
      c._scorch.splice(c._scorch.indexOf(s), 1);
    }
  }
  for (const l of [...c._lingering]) {
    l.life -= dt;
    l.timer -= dt;
    if (l.timer <= 0 && l.life > 0) {
      l.timer = 0.3;
      const rise = (8 - l.life) * 0.9;
      spawnSmoke(G, l.x + (G.rng() - 0.5) * 1.6, l.y + rise, l.z + (G.rng() - 0.5) * 1.6, 1.6);
    }
    if (l.life <= 0) c._lingering.splice(c._lingering.indexOf(l), 1);
  }
}

// Detonate at (x, y, z) with blast `radius` (default 12 m). Kills and throws
// enemies (they fall and drop loot via the normal downed path), wrecks/flips
// police units, flips or blows up cars in range, and shakes the camera.
// Exported so the screenshot stager can trigger it directly.
export function explodeAt(G, x, y, z, radius) {
  if (!G.combat) return;
  const r = radius || 12;
  spawnExplosionVisuals(G, x, y, z, r);
  // Enemies: thrown up + away, killed outright inside the radius. The
  // falling -> downed transition in updateEnemy drops their loot (cash +
  // weapon) through spawnEnemyDrop, exactly like a gun kill.
  for (const e of [...G.combat.enemies]) {
    const dx = e.pos.x - x, dz = e.pos.z - z;
    const d = Math.hypot(dx, dz);
    if (d > r) continue;
    const falloff = 1 - d / r;
    const nx = dx / (d || 1), nz = dz / (d || 1);
    const throwDist = 3 + falloff * 7; // up to 10 m at the centre — visibly thrown
    e.pos.x += nx * throwDist;
    e.pos.z += nz * throwDist;
    e.mesh.rotation.y = Math.atan2(nx, nz);
    const dmg = Math.round(220 * (0.5 + falloff * 0.5));
    e.hp -= dmg;
    spawnDamageNumber(G, e.pos.x, e.pos.y + 2.3, e.pos.z, `-${dmg}`, '#ff8a3a');
    if (e.hp <= 0 && e.state === 'alive') {
      e.state = 'falling';
      e.fallTimer = 0;
    } else if (e.state === 'alive') {
      e.flashTimer = 0.12;
    }
  }
  // Police units: wrecked outright (flipPoliceCar handles the flip + smoke).
  if (G.police) {
    for (const u of [...G.police.units]) {
      if (u.kind !== 'car' || !u.pos || u.flipped) continue;
      if (Math.hypot(u.pos.x - x, u.pos.z - z) <= r) {
        u.health = 0;
        flipPoliceCar(G, u);
      }
    }
  }
  // Cars: close ones blow up, further ones flip and catch fire.
  const hitCar = (car) => {
    if (!car || !car.mesh || car.wrecked) return;
    const p = car.mesh.position;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > r) return;
    if (d <= r * 0.55) explodeCar(G, car);
    else {
      flipCar(G, car);
      setCarOnFire(G, car);
    }
  };
  if (G.driving) {
    for (const car of G.driving.parked || []) hitCar(car);
    if (G.driving.car) hitCar(G.driving.car);
  }
  if (G.traffic) for (const car of G.traffic.cars || []) hitCar(car);
  // Wowo, if caught close in: shoved away and hurt (never insta-killed).
  if (G.player && G.player.mode === 'foot') {
    const dx = G.player.pos.x - x, dz = G.player.pos.z - z;
    const d = Math.hypot(dx, dz);
    if (d < r * 0.6) {
      damagePlayer(G, Math.round(28 * (1 - d / r)));
      const nx = dx / (d || 1), nz = dz / (d || 1);
      G.player.pos.x += nx * 2.5;
      G.player.pos.z += nz * 2.5;
    }
  }
  // Blast loot: kills above go through the falling -> downed transition in
  // updateEnemy, which calls spawnEnemyDrop (cash + weapon) — same as a gun kill.
}

// Pose Wowo mid-flight for the screenshot stager: jetpack on, flame lit,
// lifted off the ground. In live play updatePlayer takes over from here
// (hold Space to keep thrusting); in a frozen shot the pose holds as set.
export function setJetpack(G, on) {
  if (!G.jetpack) G.jetpack = { fuel: 100, maxFuel: 100, active: false, owned: true, vy: 0, _smokeTimer: 0 };
  G.jetpack.owned = true;
  G.jetpack.active = !!on;
  const flame = G.player && G.player.mesh ? G.player.mesh.userData.jetpackFlame : null;
  if (on) {
    G.jetpack.fuel = Math.max(G.jetpack.fuel, 50);
    G.jetpack.vy = 6;
    if (G.player) G.player.pos.y = Math.max(G.player.pos.y, 2.5);
    if (flame) { flame.visible = true; flame.scale.setScalar(1.2); flame.material.opacity = 0.95; }
    if (G.player && G.driving) spawnSmoke(G, G.player.pos.x, G.player.pos.y + 0.7, G.player.pos.z, 0.8);
  } else {
    G.jetpack.vy = 0;
    if (flame) flame.visible = false;
  }
}

function updateEnemy(G, e, dt) {
  const p = G.player.pos;
  const dx = p.x - e.pos.x;
  const dz = p.z - e.pos.z;
  const dist = Math.hypot(dx, dz);

  if (e.flashTimer > 0) {
    e.flashTimer -= dt;
    const pulse = 1 + 0.18 * Math.max(0, e.flashTimer / 0.12);
    e.mesh.scale.setScalar(pulse);
  } else if (e.state === 'alive') {
    e.mesh.scale.setScalar(1.0); // geometry already carries the heavy's 1.25x bulk
  }

  // Falling: rotate flat over ~0.35 s, then the body stays down.
  if (e.state === 'falling') {
    e.fallTimer += dt;
    const f = Math.min(1, e.fallTimer / 0.35);
    e.mesh.rotation.x = -Math.PI / 2 * f;
    e.mesh.position.y = 0.15 * f;
    if (e.fallTimer >= 0.9) {
      e.state = 'downed';
      spawnEnemyDrop(G, e); // the body lands — his cash (+ weapon) drops with him
      G.combat.downed.push(e);
      const i = G.combat.enemies.indexOf(e);
      if (i >= 0) G.combat.enemies.splice(i, 1);
    }
    return;
  }
  if (e.state !== 'alive') return;

  // Face the player, close to shooting range (stop at 12 m), strafe sideways
  // while firing so the fight moves instead of standing still.
  e.mesh.rotation.y = Math.atan2(dx, dz);
  const speed = e.kind === 'heavy' ? 2.5 : 4;
  if (dist > 12) {
    const step = Math.min(speed * dt, dist - 12);
    e.pos.x += (dx / dist) * step;
    e.pos.z += (dz / dist) * step;
  } else {
    e.strafeTimer -= dt;
    if (e.strafeTimer <= 0) {
      e.strafeTimer = 1 + G.rng() * 1.5;
      e.strafeDir = G.rng() < 0.5 ? -1 : 1;
    }
    const sx = -Math.cos(e.mesh.rotation.y) * e.strafeDir;
    const sz = Math.sin(e.mesh.rotation.y) * e.strafeDir;
    e.pos.x += sx * 2 * dt;
    e.pos.z += sz * 2 * dt;
  }

  // Shoot when in range: visible tracer + muzzle flash from the enemy gun.
  // A miss still sparks the ground next to Wowo so the shot reads.
  e.shootTimer -= dt;
  if (e.shootTimer <= 0) {
    const gun = new THREE.Vector3(e.pos.x, e.pos.y + 1.35, e.pos.z);
    flashMuzzle(G, gun, 0.8);
    const spread = e.kind === 'heavy' ? 1.6 : 2.2;
    const hitChance = clamp(0.75 - dist / 60, 0.25, 0.75);
    if (G.rng() < hitChance && dist <= (e.kind === 'heavy' ? 15 : 40)) {
      const dmg = e.kind === 'heavy'
        ? Math.round(lerp(22, 15, clamp(dist / 15, 0, 1)) + G.rng() * 2 - 1)
        : Math.round(lerp(10, 6, clamp(dist / 40, 0, 1)) + G.rng() * 2 - 1);
      fireTracer(G, gun, new THREE.Vector3(p.x, 1.2, p.z), 0xffb347);
      damagePlayer(G, dmg);
      spawnSparks(G, p.x, 1.2, p.z, 5);
    } else {
      const miss = new THREE.Vector3(
        p.x + (G.rng() - 0.5) * spread * 2, 0.4, p.z + (G.rng() - 0.5) * spread * 2,
      );
      fireTracer(G, gun, miss, 0xffb347);
      spawnSparks(G, miss.x, 0.4, miss.z, 4);
    }
    e.shootTimer = e.kind === 'heavy' ? 1.6 : 1.2;
  }
}

export function updateCombat(G, dt) {
  if (!G.combat) return;
  const c = G.combat;

  // Tracer fade.
  for (const t of c._tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / TRACER_LIFE) * 0.95;
    }
  }
  // Muzzle-flash fade + flash-light decay.
  for (const f of c._flashes) {
    if (f.life > 0) {
      f.life -= dt;
      f.sprite.material.opacity = Math.max(0, f.life / FLASH_LIFE);
      if (f.life <= 0) f.sprite.visible = false;
    }
  }
  if (c._flashLight && c._flashLight.intensity > 0) {
    c._flashLight.intensity = Math.max(0, c._flashLight.intensity - dt * 1000);
  }
  // Damage numbers rise and fade.
  for (const d of c._dmgNums) {
    if (d.life > 0) {
      d.life -= dt;
      d.sprite.position.y += dt * 1.4;
      d.sprite.material.opacity = Math.max(0, d.life / DMG_LIFE);
      if (d.life <= 0) d.sprite.visible = false;
    }
  }

  // Enemies act even while the player is in a car (they keep closing in).
  for (const e of [...c.enemies]) updateEnemy(G, e, dt);

  // Drops bob on the asphalt and are collected by walking/driving over them.
  updateDrops(G, dt);

  // Bazooka rockets in flight + explosion FX (fireball, ring, debris,
  // scorch, lingering smoke) keep updating in play mode.
  updateRockets(G, dt);
  updateExplosionFX(G, dt);
  // Screen shake decays; the camera agent reads G.combat.shake each frame.
  if (c.shake > 0) c.shake = Math.max(0, c.shake - dt * 1.6);

  if (G.mode !== 'play') return;

  // Weapon switching: keys 1-5, or mouse wheel cycles the rack.
  for (let i = 0; i < 5; i++) {
    if (Input.pressed(KEYS[`weapon${i + 1}`])) c.weaponIndex = i;
  }
  const wheel = Input.consumeWheel();
  if (wheel !== 0) {
    c.weaponIndex = (c.weaponIndex + (wheel > 0 ? 1 : 4)) % 5;
  }
  // R reloads the current weapon from its reserve into the mag. If the
  // reserve is empty, nothing loads and the weapon stays unable to fire.
  if (Input.pressed('KeyR')) {
    const w = c.weapons[c.weaponIndex];
    if (w) {
      const take = Math.min(w.magSize - w.mag, w.reserve);
      if (take > 0) {
        w.mag += take;
        w.reserve -= take;
      }
    }
  }

  // Fire only on foot.
  if (G.player.mode !== 'foot') return;
  c._fireTimer -= dt;
  if (Input.mouseDown && c._fireTimer <= 0) {
    const w = c.weapons[c.weaponIndex];
    if (w && w.mag > 0) {
      c._fireTimer = w.rate;
      tryFire(G);
    }
  }
  Input.consumeClick();
}

// ---------------------------------------------------------------- chaos staging
// A car already burning (fire + smoke every frame, health draining) — used by
// Job 5's warehouse fight and by the combat screenshot.
export function spawnBurningCar(G, x, z, heading, defName) {
  const car = makeCar(G, defName || 'Faro Pickup', x, z, heading || 0);
  setCarOnFire(G, car);
  if (!G.driving.parked.includes(car)) G.driving.parked.push(car);
  return car;
}

// One-call chaotic scene for the screenshot staging (shots.js calls this).
// Places, around (x, z): a flipped IDPD car (wheels up, smoking), a burning
// car (fire + smoke), `enemies` gunmen already firing at the player, one
// police unit in RAMMING mode bearing down on the player, and `downed`
// already-down bodies on the ground. Returns every placed object.
//   opts: { x, z, heading?, enemies=3, policeCar=true, flipped=true,
//           burning=true, downed=1, wanted=2, rammer=true }
export function stageChaosScene(G, opts) {
  const o = opts || {};
  const x = o.x || 0, z = o.z || 0;
  const heading = o.heading || 0;
  const out = { flipped: null, burning: null, enemies: [], rammer: null, downed: [] };
  if (o.flipped !== false) {
    out.flipped = spawnFlippedPoliceCar(G, x + 6, z - 4, heading + 0.6);
  }
  if (o.burning !== false) {
    out.burning = spawnBurningCar(G, x - 8, z + 6, heading + 1.2, 'Cayo Coupe');
    // Extra fire so the blaze reads in a frozen frame.
    spawnFire(G, x - 8, 1, z + 6, 12);
    spawnSmoke(G, x - 8, 2.5, z + 6, 2.0);
  }
  const n = typeof o.enemies === 'number' ? o.enemies : 3;
  const spots = [
    { x: x - 5, z: z - 8 }, { x: x + 7, z: z - 6 }, { x: x + 4, z: z + 9 },
    { x: x - 9, z: z + 2 }, { x: x + 10, z: z + 3 },
  ];
  for (let i = 0; i < n; i++) {
    const s = spots[i % spots.length];
    out.enemies.push(spawnFiringEnemy(G, s.x, s.z, i === 2 ? 'heavy' : 'gunman'));
  }
  const nd = typeof o.downed === 'number' ? o.downed : 1;
  for (let i = 0; i < nd; i++) {
    out.downed.push(spawnDownedEnemy(G, x - 3 + i * 2.5, z + 2, 'gunman'));
  }
  if (o.rammer !== false && o.policeCar !== false) {
    out.rammer = spawnRammingPolice(G, x, z - 18, heading);
  } else if (o.policeCar !== false) {
    out.rammer = spawnPoliceCar(G, x + 12, z - 10, heading + Math.PI);
  }
  setWanted(G, typeof o.wanted === 'number' ? o.wanted : 2);
  return out;
}
