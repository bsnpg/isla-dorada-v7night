// Isla Dorada — enemy drops: cash + weapon pickups from downed enemies.
// GTA-style loot on the ground: when an enemy goes down (combat.js calls
// spawnEnemyDrop at the falling -> downed transition), he drops a stack of
// green cash and, about half the time (always for heavies), his weapon with
// ammo. Walk or drive over a drop to collect it: cash adds to Wowo's money,
// a weapon adds ammo to that rack slot, and a score popup confirms the
// pickup ("+$250 CASH PICKED UP" / "+30 SMG AMMO PICKED UP"). Drops bob and
// glow on the asphalt with a floating label, so they read at a glance in a
// screenshot as well as in live play. Amounts are pocket change next to the
// mission payouts (missions.js pays $2,500-$6,000 per job), never a shortcut
// past the story economy. At most 12 drops live at once; the oldest vanishes.
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { pushScorePopup } from './hud.js';

const MAX_DROPS = 12;
const COLLECT_RADIUS = 2.2;
// Ammo a dropped weapon carries (about half a fresh rack slot).
const DROP_AMMO = [24, 30, 12, 30]; // Pistol, SMG, Shotgun, Rifle

function makeLabelSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.font = '800 42px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.strokeText(text, 160, 42);
  ctx.fillStyle = color;
  ctx.fillText(text, 160, 42);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  sprite.scale.set(3.2, 0.8, 1);
  return sprite;
}

// A stack of green bills on a glowing green disc, label floating above it.
function makeCashMesh(amount) {
  const group = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({ color: 0x2fae4e, roughness: 0.6 });
  const band = new THREE.MeshStandardMaterial({ color: 0xd8f2c0, roughness: 0.6 });
  for (let i = 0; i < 3; i++) {
    const bill = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.13, 0.55), green);
    bill.position.set((i - 1) * 0.12, 0.1 + i * 0.14, (i % 2 ? 0.08 : -0.08));
    bill.rotation.y = (i - 1) * 0.22;
    group.add(bill);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.57), band);
    strap.position.copy(bill.position);
    strap.rotation.y = bill.rotation.y;
    group.add(strap);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.05, 24),
    new THREE.MeshBasicMaterial({ color: 0x2fae4e, transparent: true, opacity: 0.28 }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.02;
  group.add(disc);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.0, 0.06, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0x5ae07a }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);
  const label = makeLabelSprite(`$${amount}`, '#8fe388');
  label.position.y = 1.5;
  group.add(label);
  return group;
}

// A dropped gun lying on the asphalt on a glowing gold disc, label above it.
function makeWeaponMesh(weaponIndex, ammo) {
  const w = WEAPONS[weaponIndex] || WEAPONS[0];
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.5, metalness: 0.4 });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xf2c230, roughness: 0.4, metalness: 0.3,
    emissive: 0xf2c230, emissiveIntensity: 0.35,
  });
  const long = w.name === 'Shotgun' || w.name === 'Rifle';
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, long ? 1.15 : 0.7), dark);
  body.position.y = 0.14;
  group.add(body);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.12), dark);
  grip.position.set(0, 0.1, long ? -0.35 : -0.2);
  grip.rotation.x = 0.35;
  group.add(grip);
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.3), gold);
  accent.position.set(0, 0.21, long ? 0.25 : 0.12);
  group.add(accent);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.0, 24),
    new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.25 }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.02;
  group.add(disc);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.06, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xf2c230 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);
  const label = makeLabelSprite(`${w.name.toUpperCase()} +${ammo}`, '#f2c230');
  label.position.y = 1.5;
  group.add(label);
  return group;
}

export function initDrops(G) {
  G.drops = { list: [] };
}

// Spawn a cash drop at (x, z). Returns the drop record.
export function dropCash(G, x, z, amount) {
  if (!G.drops) initDrops(G);
  const group = makeCashMesh(amount);
  group.position.set(x, 0, z);
  G.scene.add(group);
  const drop = {
    kind: 'cash', amount, x, z, group,
    phase: G.rng ? G.rng() * Math.PI * 2 : 0,
  };
  pushDrop(G, drop);
  return drop;
}

// Spawn a weapon drop at (x, z): the gun + `ammo` rounds for that rack slot.
export function dropWeapon(G, x, z, weaponIndex, ammo) {
  if (!G.drops) initDrops(G);
  const idx = Math.max(0, Math.min(WEAPONS.length - 1, weaponIndex || 0));
  const rounds = typeof ammo === 'number' ? ammo : DROP_AMMO[idx];
  const group = makeWeaponMesh(idx, rounds);
  group.position.set(x, 0, z);
  group.rotation.y = G.rng ? G.rng() * Math.PI : 0;
  G.scene.add(group);
  const drop = {
    kind: 'weapon', weaponIndex: idx, ammo: rounds, x, z, group,
    phase: G.rng ? G.rng() * Math.PI * 2 : 0,
  };
  pushDrop(G, drop);
  return drop;
}

function pushDrop(G, drop) {
  G.drops.list.push(drop);
  while (G.drops.list.length > MAX_DROPS) {
    const old = G.drops.list.shift();
    G.scene.remove(old.group);
  }
}

// What a downed enemy leaves behind: always a cash stack ($120-$249 for a
// gunman, $250-$349 for a heavy), plus his weapon — always for a heavy,
// half the time for a gunman (gunmen carry a pistol or an SMG, heavies a
// shotgun or a rifle). Called once per kill, at the falling -> downed
// transition in combat.js, so the loot lands with the body.
export function spawnEnemyDrop(G, enemy) {
  if (!G.drops) initDrops(G);
  const heavy = enemy.kind === 'heavy';
  const cash = heavy
    ? 250 + Math.floor((G.rng ? G.rng() : 0.5) * 100)
    : 120 + Math.floor((G.rng ? G.rng() : 0.5) * 130);
  const ex = enemy.pos ? enemy.pos.x : enemy.x;
  const ez = enemy.pos ? enemy.pos.z : enemy.z;
  dropCash(G, ex + 0.7, ez + 0.4, cash);
  const roll = G.rng ? G.rng() : 0.5;
  if (heavy || roll < 0.5) {
    const idx = heavy
      ? (roll < 0.5 ? 2 : 3)
      : (roll < 0.25 ? 0 : 1);
    dropWeapon(G, ex - 0.8, ez - 0.3, idx);
  }
}

// Collect one drop: cash pays out, a weapon refills its rack slot, and a
// score popup confirms the pickup in the HUD.
export function collectDrop(G, drop) {
  const list = G.drops ? G.drops.list : [];
  const i = list.indexOf(drop);
  if (i >= 0) list.splice(i, 1);
  G.scene.remove(drop.group);
  if (drop.kind === 'cash') {
    G.player.money += drop.amount;
    pushScorePopup(G, `+$${drop.amount}`, 'cash', 'CASH PICKED UP');
  } else {
    const w = G.combat.weapons[drop.weaponIndex];
    if (w) w.ammo += drop.ammo;
    const name = (WEAPONS[drop.weaponIndex] || WEAPONS[0]).name.toUpperCase();
    pushScorePopup(G, `+${drop.ammo}`, 'cash', `${name} AMMO PICKED UP`);
  }
}

// Bob the drops and collect any the player walks or drives over (2.2 m).
export function updateDrops(G, dt) {
  if (!G.drops || !G.player || !G.player.pos) return;
  for (const drop of [...G.drops.list]) {
    drop.group.position.y = 0.12 + Math.sin(G.time * 2 + drop.phase) * 0.08;
    const dx = drop.x - G.player.pos.x;
    const dz = drop.z - G.player.pos.z;
    if (dx * dx + dz * dz < COLLECT_RADIUS * COLLECT_RADIUS) {
      collectDrop(G, drop);
    }
  }
  void dt;
}
