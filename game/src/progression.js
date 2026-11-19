// Isla Dorada — progression systems (rebuild v2): Dorada Idols
// (collectibles), REP level, six skills, and ownable properties.
// One module, one job: everything that grows as Wowo plays, and every
// number it shows comes from live G state — nothing is faked.
//
// Effects are REAL and small, applied here (not in the modules that own
// the underlying systems, which this file must not edit):
//  - Driving  +4% top speed/pip: applied post-drive as a nudge toward the
//    boosted top speed once the car is already at its base cap.
//  - Aim     -5% spread/pip -> no player spread value exists in combat.js
//    (hits are exact raycasts), so +5% weapon damage/pip instead, applied
//    by rescaling G.combat.weapons[i].damage from the WEAPONS base table.
//  - Influence +5% mission payout/pip: bonus cash on top of the base
//    mission reward when a completion is detected.
//  - Stamina +10 max health/pip: folded into G.player.maxHealth.
//  - Stealth -10% police detection range/pip: police.js decays wanted
//    only when every unit is >120 m away; this module runs its own decay
//    clock in the band (120*(1-10%*pips), 120] where police.js never counts.
//  - Street  +5% cash pickups/pip: bonus on idol cash, drift and near-miss
//    cash (the cash events this module can see).
import * as THREE from 'three';
import { WEAPONS, KEYS } from './config.js';
import { mulberry32, clamp } from './random.js';
import { Input } from './input.js';
import { pushScorePopup } from './hud.js';
import { playSFX } from './audio.js';

// ---------------------------------------------------------------- data
export const IDOL_TOTAL = 20;
export const COLLECT_RADIUS = 2.5;
export const IDOL_CASH = 250;

// Fixed seeded positions: plaza/road spots near landmarks + districts.
// Anchors sit clear of landmark-building colliders (buildings sit +24,+24
// from their plaza point), jittered ±5 m by a fixed-seed rng so the set is
// identical on every seed.
const IDOL_ANCHORS = [
  { x: -120, z: -200 }, // Casino Dorada plaza (Casino Row)
  { x: -120, z: -160 }, // Casino Row road
  { x: 40, z: -200 },   // IDPD station plaza (Palm Heights)
  { x: 40, z: -160 },   // Palm Heights road
  { x: -120, z: 270 },  // Marina plaza south (clear of the spawn at -120,240)
  { x: -120, z: 200 },  // Marina road
  { x: 104, z: 256 },   // Warehouse yard (Harbor)
  { x: 160, z: 264 },   // Harbor containers
  { x: 24, z: 120 },    // Garage road (Old Town)
  { x: -120, z: 40 },   // Impound plaza (Old Town)
  { x: -120, z: 80 },   // Old Town road
  { x: -120, z: 120 },  // Restaurant plaza
  { x: 104, z: -104 },  // Gas station forecourt
  { x: 204, z: 16 },    // Causeway gate
  { x: 280, z: 0 },     // Causeway east
  { x: -276, z: -40 },  // Ferris wheel (Beachfront)
  { x: -292, z: 80 },   // Boardwalk
  { x: -300, z: -120 }, // Beach
  { x: 120, z: -200 },  // Palm Heights road
  { x: 80, z: 280 },    // Harbor north road
];

export const PROPERTIES = [
  { id: 'boathouse', name: 'Marina Boathouse', price: 15000, income: 120, x: -132, z: 252 },
  { id: 'apartment', name: 'Casino Row Apartment', price: 25000, income: 200, x: -132, z: -188 },
  { id: 'shophouse', name: 'Old Town Shophouse', price: 8000, income: 80, x: -132, z: 52 },
];

export const SKILL_DEFS = [
  { key: 'driving', label: 'Driving', effect: (p) => `+${4 * p}% top speed` },
  { key: 'aim', label: 'Aim', effect: (p) => `+${5 * p}% damage` },
  { key: 'influence', label: 'Influence', effect: (p) => `+${5 * p}% payout` },
  { key: 'stamina', label: 'Stamina', effect: (p) => `+${10 * p} max HP` },
  { key: 'stealth', label: 'Stealth', effect: (p) => `-${10 * p}% detection` },
  { key: 'street', label: 'Street Sense', effect: (p) => `+${5 * p}% cash` },
];

// REP: XP needed to go from level L to L+1. 500, 1200, 2200, 3500, ...
// (150L^2 + 250L + 100). Level-up cash: $500 * new level (LV 2 = $1,000).
export function xpNextFor(level) {
  return 150 * level * level + 250 * level + 100;
}
export function levelRewardFor(level) {
  return 500 * level;
}
export function nextUnlockFor(level) {
  return `LV ${level + 1} — +$${levelRewardFor(level + 1).toLocaleString('en-US')} & +10 MAX HEALTH`;
}

export function pips(level, max = 5) {
  let s = '';
  for (let i = 0; i < max; i++) s += i < level ? '●' : '○';
  return s;
}

function freshSkills() {
  return { driving: 0, aim: 0, influence: 0, stamina: 0, stealth: 0, street: 0 };
}

// Score-popup objects already processed (driving.js prunes the array, so
// WeakSet entries are collected with them).
let seenPopups = new WeakSet();

// ---------------------------------------------------------------- meshes
let idolGeo = null;
let idolMat = null;
let idolBaseMat = null;
let idolDiscMat = null;

function makeIdolMesh() {
  if (!idolGeo) {
    idolGeo = new THREE.OctahedronGeometry(0.45);
    idolMat = new THREE.MeshStandardMaterial({
      color: 0xf2c230, metalness: 0.85, roughness: 0.25,
      emissive: 0x8a6d00, emissiveIntensity: 0.8,
    });
    idolBaseMat = new THREE.MeshStandardMaterial({ color: 0x6a4a1a, roughness: 0.9 });
    idolDiscMat = new THREE.MeshBasicMaterial({
      color: 0xf2c230, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
    });
  }
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.55), idolBaseMat);
  base.position.y = 0.08;
  group.add(base);
  const gem = new THREE.Mesh(idolGeo, idolMat);
  gem.position.y = 0.85;
  gem.castShadow = true;
  group.add(gem);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), idolMat);
  top.position.y = 1.35;
  group.add(top);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), idolDiscMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;
  group.add(disc);
  return group;
}

// ---------------------------------------------------------------- state
export function initProgression(G) {
  if (G.progression) return G.progression;
  const rng = mulberry32(20261118); // fixed seed: same 20 spots every run
  const idols = IDOL_ANCHORS.map((a) => {
    const x = clamp(a.x + (rng() - 0.5) * 10, -312, 312);
    const z = clamp(a.z + (rng() - 0.5) * 10, -312, 312);
    const mesh = makeIdolMesh();
    mesh.position.set(x, 0, z);
    if (G.scene) G.scene.add(mesh);
    return { x, z, collected: false, mesh, phase: rng() * Math.PI * 2 };
  });
  G.progression = {
    collectibles: { found: 0, total: IDOL_TOTAL },
    rep: { level: 1, xp: 0, xpNext: xpNextFor(1), nextUnlock: nextUnlockFor(1) },
    skills: freshSkills(),
    properties: PROPERTIES.map((p) => ({ ...p, owned: false })),
    effects: {},
    idols,
    _skillXp: freshSkills(),
    _incomeBank: 0,
    _incomeTimer: 0,
    _incomePaid: 0,
    _lastMissionsDone: (G.stats && G.stats.missionsDone) || 0,
    _lastDowned: (G.combat && G.combat.downed) ? G.combat.downed.length : 0,
    _enemyHp: null,
    _stealthTimer: 0,
  };
  if (G.player && typeof G.player.maxHealth !== 'number') G.player.maxHealth = 100;
  recomputeEffects(G);
  return G.progression;
}

export function resetProgression(G) {
  if (!G.progression) return initProgression(G);
  const pr = G.progression;
  pr.collectibles.found = 0;
  pr.collectibles.total = IDOL_TOTAL;
  pr.rep.level = 1;
  pr.rep.xp = 0;
  pr.rep.xpNext = xpNextFor(1);
  pr.rep.nextUnlock = nextUnlockFor(1);
  pr.skills = freshSkills();
  pr._skillXp = freshSkills();
  for (const p of pr.properties) p.owned = false;
  for (const idol of pr.idols) {
    idol.collected = false;
    if (G.scene && idol.mesh && !idol.mesh.parent) G.scene.add(idol.mesh);
  }
  pr._incomeBank = 0;
  pr._incomeTimer = 0;
  pr._incomePaid = 0;
  pr._lastMissionsDone = (G.stats && G.stats.missionsDone) || 0;
  pr._lastDowned = (G.combat && G.combat.downed) ? G.combat.downed.length : 0;
  pr._enemyHp = null;
  pr._stealthTimer = 0;
  seenPopups = new WeakSet();
  if (G.player) G.player.maxHealth = 100;
  recomputeEffects(G);
  return pr;
}

// Derived multipliers + max health, from the live rep level and skill pips.
export function recomputeEffects(G) {
  const pr = G.progression;
  if (!pr) return null;
  const s = pr.skills;
  pr.effects = {
    topSpeedMul: 1 + 0.04 * (s.driving || 0),
    damageMul: 1 + 0.05 * (s.aim || 0),
    payoutMul: 1 + 0.05 * (s.influence || 0),
    cashMul: 1 + 0.05 * (s.street || 0),
    detectRange: 120 * (1 - 0.10 * (s.stealth || 0)),
    maxHealth: 100 + 10 * ((pr.rep.level || 1) - 1) + 10 * (s.stamina || 0),
  };
  if (G.player) {
    G.player.maxHealth = pr.effects.maxHealth;
    if (G.player.health > pr.effects.maxHealth) G.player.health = pr.effects.maxHealth;
  }
  return pr.effects;
}

// ---------------------------------------------------------------- rep / skills
export function addRepXp(G, amount, source) {
  const pr = G.progression;
  if (!pr || !amount) return;
  pr.rep.xp += amount;
  while (pr.rep.xp >= pr.rep.xpNext) {
    pr.rep.xp -= pr.rep.xpNext;
    pr.rep.level += 1;
    const cash = levelRewardFor(pr.rep.level);
    if (G.player) G.player.money += cash;
    pr.rep.xpNext = xpNextFor(pr.rep.level);
    pr.rep.nextUnlock = nextUnlockFor(pr.rep.level);
    recomputeEffects(G);
    // Level-up also heals +10 (the +10 max health is real, not just a cap).
    if (G.player) {
      G.player.health = Math.min(G.player.maxHealth || 100, (G.player.health || 0) + 10);
    }
    if (G.flashToast) {
      G.flashToast(`REP UP — LV ${pr.rep.level}  +$${cash.toLocaleString('en-US')} & +10 MAX HEALTH`);
    }
  }
  void source;
}

export function gainSkill(G, key, amount) {
  const pr = G.progression;
  if (!pr || !amount || !(key in pr.skills)) return;
  pr._skillXp[key] = (pr._skillXp[key] || 0) + amount;
  while (pr._skillXp[key] >= 100 && pr.skills[key] < 5) {
    pr._skillXp[key] -= 100;
    pr.skills[key] += 1;
    const def = SKILL_DEFS.find((d) => d.key === key);
    recomputeEffects(G);
    if (G.flashToast && def) {
      G.flashToast(`SKILL UP — ${def.label.toUpperCase()} ${pips(pr.skills[key])}  (${def.effect(pr.skills[key])})`);
    }
  }
}

// ---------------------------------------------------------------- collectibles
function collectIdol(G, idol) {
  const pr = G.progression;
  idol.collected = true;
  if (G.scene && idol.mesh) G.scene.remove(idol.mesh);
  pr.collectibles.found += 1;
  const cash = Math.round(IDOL_CASH * (pr.effects.cashMul || 1));
  if (G.player) G.player.money += cash;
  pushScorePopup(G, `IDOL ${pr.collectibles.found}/${pr.collectibles.total} +$${cash}`, 'cash', 'DORADA IDOL');
  if (G.flashToast) G.flashToast(`DORADA IDOL ${pr.collectibles.found}/${pr.collectibles.total} — +$${cash}`);
  try { playSFX(G, 'cash'); } catch (e) { /* audio is best-effort */ }
  addRepXp(G, 100, 'idol');
  gainSkill(G, 'street', 40);
}

// ---------------------------------------------------------------- properties
export function buyProperty(G, id) {
  const pr = G.progression;
  if (!pr) return false;
  const prop = pr.properties.find((p) => p.id === id);
  if (!prop || prop.owned) return false;
  if (!G.player || G.player.money < prop.price) {
    if (G.flashToast) {
      const short = Math.max(0, prop.price - (G.player ? G.player.money : 0));
      G.flashToast(`NEED $${short.toLocaleString('en-US')} MORE — ${prop.name.toUpperCase()}`);
    }
    return false;
  }
  G.player.money -= prop.price;
  prop.owned = true;
  try { playSFX(G, 'cash'); } catch (e) { /* audio is best-effort */ }
  if (G.flashToast) {
    G.flashToast(`BOUGHT ${prop.name.toUpperCase()} — +$${prop.income}/MIN`);
  }
  return true;
}

export function propertyIncomePerMin(G) {
  const pr = G.progression;
  if (!pr) return 0;
  return pr.properties.reduce((t, p) => t + (p.owned ? p.income : 0), 0);
}

// ---------------------------------------------------------------- save
export function serializeProgression(G) {
  const pr = G.progression;
  if (!pr) return null;
  return {
    collected: pr.idols.map((i) => !!i.collected),
    rep: { level: pr.rep.level, xp: pr.rep.xp },
    skills: { ...pr.skills },
    skillXp: { ...pr._skillXp },
    properties: pr.properties.filter((p) => p.owned).map((p) => p.id),
  };
}

// Load must stay backward-compatible: a missing `progression` block (old
// saves) leaves the fresh defaults from initProgression untouched.
export function applyProgressionSave(G, saved) {
  if (!G.progression || !saved || typeof saved !== 'object') return false;
  const pr = G.progression;
  if (saved.rep && typeof saved.rep === 'object') {
    pr.rep.level = Math.max(1, Math.floor(saved.rep.level) || 1);
    pr.rep.xp = Math.max(0, saved.rep.xp || 0);
    pr.rep.xpNext = xpNextFor(pr.rep.level);
    pr.rep.nextUnlock = nextUnlockFor(pr.rep.level);
  }
  if (saved.skills && typeof saved.skills === 'object') {
    for (const key of Object.keys(pr.skills)) {
      const v = saved.skills[key];
      if (typeof v === 'number') pr.skills[key] = clamp(Math.floor(v), 0, 5);
    }
  }
  if (saved.skillXp && typeof saved.skillXp === 'object') {
    for (const key of Object.keys(pr._skillXp)) {
      const v = saved.skillXp[key];
      if (typeof v === 'number') pr._skillXp[key] = clamp(v, 0, 99);
    }
  }
  if (Array.isArray(saved.properties)) {
    for (const p of pr.properties) p.owned = saved.properties.includes(p.id);
  }
  if (Array.isArray(saved.collected)) {
    let found = 0;
    pr.idols.forEach((idol, i) => {
      idol.collected = !!saved.collected[i];
      if (idol.collected) {
        found += 1;
        if (G.scene && idol.mesh) G.scene.remove(idol.mesh);
      } else if (G.scene && idol.mesh && !idol.mesh.parent) {
        G.scene.add(idol.mesh);
      }
    });
    pr.collectibles.found = found;
  }
  pr._lastMissionsDone = (G.stats && G.stats.missionsDone) || 0;
  pr._lastDowned = (G.combat && G.combat.downed) ? G.combat.downed.length : 0;
  pr._enemyHp = null;
  recomputeEffects(G);
  return true;
}

// ---------------------------------------------------------------- per-frame
export function updateProgression(G, dt) {
  const pr = G.progression;
  if (!pr || !G.player || !G.player.pos) return;
  const p = G.player;
  const t = G.time || 0;

  // --- idols: spin + bob, collect within 2.5 m on foot or in a car ---
  for (const idol of pr.idols) {
    if (idol.collected || !idol.mesh) continue;
    idol.mesh.rotation.y += dt * 1.5;
    idol.mesh.position.y = 0.15 + Math.sin(t * 2 + idol.phase) * 0.15;
    const dx = p.pos.x - idol.x;
    const dz = p.pos.z - idol.z;
    if (dx * dx + dz * dz < COLLECT_RADIUS * COLLECT_RADIUS) collectIdol(G, idol);
  }

  // --- mission completion: +500 REP, Influence XP, payout bonus ---
  const done = (G.stats && G.stats.missionsDone) || 0;
  if (done > pr._lastMissionsDone) {
    for (let k = pr._lastMissionsDone; k < done; k++) {
      const base = 2000 + 500 * (k + 1); // same formula missions.js pays
      const bonus = Math.round(base * ((pr.effects.payoutMul || 1) - 1));
      if (bonus > 0 && G.player) {
        G.player.money += bonus;
        if (G.flashToast) G.flashToast(`INFLUENCE BONUS +$${bonus.toLocaleString('en-US')}`);
      }
      addRepXp(G, 500, 'mission');
      gainSkill(G, 'influence', 50);
    }
    pr._lastMissionsDone = done;
  }

  // --- enemy downed: +25 REP each; hits: Aim XP ---
  if (G.combat) {
    const downed = (G.combat.downed ? G.combat.downed.length : 0);
    if (downed > pr._lastDowned) {
      for (let k = pr._lastDowned; k < downed; k++) {
        addRepXp(G, 25, 'downed');
        gainSkill(G, 'aim', 20);
      }
      pr._lastDowned = downed;
    }
    let hpSum = 0;
    for (const e of G.combat.enemies || []) hpSum += Math.max(0, e.hp || 0);
    if (pr._enemyHp !== null && hpSum < pr._enemyHp) gainSkill(G, 'aim', 8);
    pr._enemyHp = hpSum;
    // Aim pips: rescale weapon damage from the base table every frame.
    const mul = pr.effects.damageMul || 1;
    if (mul !== 1) {
      G.combat.weapons.forEach((w, i) => {
        if (WEAPONS[i]) w.damage = WEAPONS[i].damage * mul;
      });
    }
  }

  // --- drift / near-miss cash popups: +10 REP + Street XP per near miss ---
  const score = G.driving && G.driving.score;
  if (score && Array.isArray(score.popups)) {
    for (const pop of score.popups) {
      if (!pop || typeof pop.text !== 'string' || seenPopups.has(pop)) continue;
      seenPopups.add(pop);
      if (pop.text.startsWith('NEAR MISS')) {
        addRepXp(G, 10, 'nearmiss');
        gainSkill(G, 'street', 15);
        const bonus = Math.round(250 * ((pr.effects.cashMul || 1) - 1));
        if (bonus > 0 && G.player) G.player.money += bonus;
      } else if (pop.text.startsWith('DRIFT')) {
        const chain = Number((pop.text.match(/x(\d+)/) || [])[1] || 1);
        const amount = Number((pop.text.match(/\$(\d+)/) || [])[1] || 0);
        gainSkill(G, 'driving', 5 * chain);
        const bonus = Math.round(amount * ((pr.effects.cashMul || 1) - 1));
        if (bonus > 0 && G.player) G.player.money += bonus;
      }
    }
  }

  // --- Driving skill: drifting / fast driving ---
  if (p.mode === 'car' && G.driving) {
    const drift = score && score.drift;
    if (drift && drift.active) gainSkill(G, 'driving', 10 * dt);
    else if (Math.abs(G.driving.speed || 0) > 30) gainSkill(G, 'driving', 4 * dt);
    // Driving pips: nudge toward the boosted top speed once at the base cap.
    const car = G.driving.car;
    const mul = pr.effects.topSpeedMul || 1;
    if (car && mul > 1 && car.nitroTimer <= 0 && (car.speed || 0) > 1) {
      const owned = (G.garage && G.garage.owned) || {};
      const baseTop = car.def.topSpeed * (1 + 0.25 * (owned.engine || 0));
      const boostedTop = baseTop * mul;
      const fwd = Input.down(...KEYS.forward);
      if (fwd && car.speed >= baseTop * 0.98 && car.speed < boostedTop) {
        car.speed = Math.min(boostedTop, car.speed + 6 * dt);
      }
    }
  }

  // --- Stamina: time on foot sprinting (Shift = 9 m/s in player.js) ---
  if (p.mode === 'foot' && (p.speed || 0) >= 9) gainSkill(G, 'stamina', 6 * dt);

  // --- Stealth: time undetected (wanted 0) while moving; faster near police ---
  const wanted = (G.police && typeof G.police.wanted === 'number') ? G.police.wanted : 0;
  if (wanted === 0 && (p.speed || 0) > 0.5) {
    let nearUnit = false;
    if (G.police && Array.isArray(G.police.units)) {
      for (const u of G.police.units) {
        if (u.pos && Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z) < 60) {
          nearUnit = true;
          break;
        }
      }
    }
    gainSkill(G, 'stealth', (nearUnit ? 8 : 3) * dt);
  }

  // --- Stealth effect: own wanted-decay clock in the reduced-range band ---
  // police.js only decays when every unit is >120 m away; a stealth pip
  // shrinks that to 120*(1-10%*pips) — count clear time in between.
  if (wanted > 0 && G.police && Array.isArray(G.police.units)) {
    const range = pr.effects.detectRange || 120;
    let nearest = Infinity;
    for (const u of G.police.units) {
      if (!u.pos) continue;
      nearest = Math.min(nearest, Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z));
    }
    if (nearest > range && nearest <= 120) {
      pr._stealthTimer += dt;
      if (pr._stealthTimer >= 20) {
        pr._stealthTimer = 10; // next step after 10 more seconds (police cadence)
        if (G.setWanted) G.setWanted(wanted - 1);
      }
    } else {
      pr._stealthTimer = 0;
    }
  } else {
    pr._stealthTimer = 0;
  }

  // --- Property income: real $/min, paid out in whole dollars as it accrues,
  // with one summary toast per minute ---
  const income = propertyIncomePerMin(G);
  if (income > 0) {
    pr._incomeBank += (income / 60) * dt;
    const whole = Math.floor(pr._incomeBank);
    if (whole > 0) {
      pr._incomeBank -= whole;
      G.player.money += whole;
      pr._incomePaid += whole;
    }
    pr._incomeTimer += dt;
    if (pr._incomeTimer >= 60) {
      pr._incomeTimer = 0;
      if (pr._incomePaid > 0 && G.flashToast) {
        G.flashToast(`PROPERTY INCOME +$${pr._incomePaid.toLocaleString('en-US')}`);
      }
      pr._incomePaid = 0;
    }
  }
}
