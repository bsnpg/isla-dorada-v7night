// Isla Dorada — game configuration and data. (REBUILD v2)
// All names, places, vehicles, missions and radio stations are original.
export const GAME = {
  title: 'Isla Dorada: 8 Jobs to Clear His Name',
  shortTitle: 'ISLA DORADA',
  version: '2.0.0',
  saveKey: 'isla-dorada-save-v1',
};

export const WORLD = {
  size: 640,            // island is 640 x 640 metres, centred on (0,0)
  roadGap: 80,          // city grid spacing
  roadWidth: 12,
  beachX: -300,         // beach strip along the west edge
  seaLevel: -0.5,
  seedDefault: 1,
};

// Named districts. districtAt(x, z) returns the district name for the minimap.
export const DISTRICTS = [
  { name: 'Beachfront',  minX: -320, maxX: -200, minZ: -320, maxZ: 320,  color: '#e8b64c' },
  { name: 'Casino Row',  minX: -200, maxX: -40,  minZ: -320, maxZ: -80,  color: '#f0d060' },
  { name: 'Old Town',    minX: -200, maxX: -40,  minZ: -80,  maxZ: 160,  color: '#c98a4b' },
  { name: 'Marina',      minX: -200, maxX: -40,  minZ: 160,  maxZ: 320,  color: '#4fb3d9' },
  { name: 'Palm Heights',minX: -40,  maxX: 200,  minZ: -320, maxZ: 0,    color: '#7ec850' },
  { name: 'Harbor',      minX: -40,  maxX: 200,  minZ: 0,    maxZ: 320,  color: '#5a8fd9' },
  { name: 'Causeway',    minX: 200,  maxX: 320,  minZ: -80,  maxZ: 80,   color: '#d9a05a' },
];

export function districtAt(x, z) {
  for (const d of DISTRICTS) {
    if (x >= d.minX && x < d.maxX && z >= d.minZ && z < d.maxZ) return d;
  }
  return DISTRICTS[0];
}

// The 8 staged story jobs of the "Bersihkan Nama" (Clear His Name) arc.
// Wowo, ex-Sergeant, dishonorably discharged, must clear his name.
export const MISSIONS = [
  {
    id: 1, name: 'Pendaratan', code: 'JOB 1/8',
    briefing: 'WOWO: Fresh off the boat. One driving job for the casino and I am out. Easy money.',
    objective: 'Drive the casino boss to Casino Dorada',
    next: 'JOB 2 — Cari Saksi', wanted: 0,
  },
  {
    id: 2, name: 'Cari Saksi', code: 'JOB 2/8',
    briefing: 'WOWO: The witness saw who framed me. Pick her up before the IDPD tail finds her.',
    objective: 'Pick up the witness, lose the police tail',
    next: 'JOB 3 — Curi Bukti', wanted: 1,
  },
  {
    id: 3, name: 'Curi Bukti', code: 'JOB 3/8',
    briefing: 'WOWO: The evidence is in the impound lot. Walk in, take it, walk out. Quietly.',
    objective: 'Steal the evidence from the police impound',
    next: 'JOB 4 — Kejar-kejaran Causeway', wanted: 2,
  },
  {
    id: 4, name: 'Kejar-kejaran Causeway', code: 'JOB 4/8',
    briefing: 'WOWO: Evidence in hand. Now I have to outrun the whole island to deliver it.',
    objective: 'Deliver the evidence across the Causeway — outrun the IDPD',
    next: 'JOB 5 — Gudang Senjata', wanted: 4,
  },
  {
    id: 5, name: 'Gudang Senjata', code: 'JOB 5/8',
    briefing: 'WOWO: I need firepower before the endgame. The warehouse crew will not hand it over.',
    objective: 'Clear the warehouse, take the weapons cache',
    next: 'JOB 6 — Konfrontasi', wanted: 2,
  },
  {
    id: 6, name: 'Konfrontasi', code: 'JOB 6/8',
    briefing: 'WOWO: The officer who framed me is finally in front of me. This ends tonight.',
    objective: 'Confront Officer Braga at the Marina',
    next: 'JOB 7 — Bukti Terakhir', wanted: 3,
  },
  {
    id: 7, name: 'Bukti Terakhir', code: 'JOB 7/8',
    briefing: 'WOWO: One recording left, inside the police station. In and out. No mistakes.',
    objective: 'Steal the recording from the IDPD station',
    next: 'JOB 8 — Bebas', wanted: 4,
  },
  {
    id: 8, name: 'Bebas', code: 'JOB 8/8',
    briefing: 'WOWO: Everything I need is in this car. Five stars, one road out. Let us go home.',
    objective: 'Escape Isla Dorada — wanted level 5, reach the Causeway',
    next: 'FREEDOM', wanted: 5,
  },
];

// Original vehicles (no commercial names).
export const VEHICLES = [
  { name: 'Aurea GT',     topSpeed: 62, accel: 26, grip: 2.6, color: 0xd8a020, kind: 'sport' },
  { name: 'Solano S',     topSpeed: 55, accel: 22, grip: 2.4, color: 0x3f7fd9, kind: 'sedan' },
  { name: 'Palma Cruiser',topSpeed: 48, accel: 18, grip: 2.2, color: 0xe8e0d0, kind: 'sedan' },
  { name: 'Faro Pickup',  topSpeed: 50, accel: 20, grip: 2.0, color: 0x7a4a2a, kind: 'pickup' },
  { name: 'Cayo Coupe',   topSpeed: 58, accel: 24, grip: 2.5, color: 0xc23a3a, kind: 'sport' },
  { name: 'Marina Taxi',  topSpeed: 46, accel: 17, grip: 2.1, color: 0xf2c230, kind: 'taxi' },
];

export const POLICE = {
  dept: 'IDPD',
  deptFull: 'Isla Dorada Police Department',
  carName: 'IDPD Interceptor',
  heliName: 'IDPD Hawk',
  // Named response units shown in the HUD police list.
  unitNames: ['UNIT 12', 'UNIT 07', 'UNIT 23', 'UNIT 31', 'HAWK-1', 'UNIT 18'],
  statuses: ['PURSUIT', 'RAMMING', 'ROADBLOCK', 'BOXING IN', 'SEARCHLIGHT', 'EN ROUTE', 'WRECKED'],
  ramDamage: 8,      // health lost when a unit rams the player
  ramForce: 14,      // lateral shove (m/s) applied to the player car on a ram
  ramFlipSpeed: 20,  // relative speed above which a ram can flip the player car
  unitTopSpeed: 34,  // base pursuit top speed; +4 per wanted star
  bustSeconds: 3,    // slow + a unit within 3 m for this long = BUSTED
  decayClearSeconds: 20, // all units > 120 m for this long starts wanted decay
};

// Weapon rack slots 1-5. `flash` scales the muzzle-flash sprite; `tracer` is
// the tracer-line colour for that weapon. Ammo is a real mag/reserve split:
// `magSize` rounds in the magazine, `reserve` rounds carried spare, and
// `ammo` (mag + reserve) is kept only for legacy readers.
export const WEAPONS = [
  { name: 'Pistol',  damage: 34, rate: 0.32, ammo: 60,  magSize: 12, reserve: 48,  range: 60,  flash: 0.9, tracer: 0xffe08a },
  { name: 'SMG',     damage: 18, rate: 0.09, ammo: 192, magSize: 32, reserve: 160, range: 45,  flash: 0.7, tracer: 0xffd76a },
  { name: 'Shotgun', damage: 70, rate: 0.9,  ammo: 30,  magSize: 6,  reserve: 24,  range: 25,  flash: 1.5, tracer: 0xffb347 },
  { name: 'Rifle',   damage: 55, rate: 0.14, ammo: 120, magSize: 30, reserve: 90,  range: 90,  flash: 1.1, tracer: 0xfff2b0 },
  { name: 'Bazooka', damage: 220, rate: 1.2, ammo: 13,  magSize: 1,  reserve: 12,  range: 120, flash: 2.0, tracer: 0xff7733 },
];

// Arcade score popups: drift chains and near misses pay cash and are exposed
// on G.driving.score so the HUD can render them.
export const SCORE = {
  driftBase: 50,        // $ per drift chain step
  driftChainTime: 1.5,  // seconds of drifting per +1 chain (max 5)
  driftMinTime: 0.6,    // drift must last this long to pay out
  nearMiss: 250,        // $ per near miss
  nearMissCooldown: 2.5,
  nearMissMinSpeed: 20, // player must be going this fast (m/s)
  nearMissRange: 4.5,   // lateral gap that still counts as a near miss
};

// Crash / flip tuning (speeds in m/s).
export const CHAOS = {
  flipSpeed: 18,        // hard wall hit above this + handbrake can flip a car
  flipHardSpeed: 22,    // any impact above this flips the car outright
  flipChance: 0.5,      // coin flip on a borderline flip-speed impact
  burnDrain: 4,         // health per second lost by a burning car
  wreckSmokeTime: 30,   // seconds a wreck keeps smoking
};

// Procedural radio stations (WebAudio, no audio files).
export const RADIO = [
  { name: 'RADIO SOL 92.5', genre: 'Sunset Pop',   bpm: 104, root: 57 },
  { name: 'DORADA FM 101.3', genre: 'Island Beats', bpm: 122, root: 53 },
  { name: 'PALMA 77.7',     genre: 'Night Drive',  bpm: 90,  root: 50 },
];

// Garage upgrades (prices in $).
export const UPGRADES = [
  { id: 'engine',  name: 'Turbo Engine',   desc: '+25% top speed',        price: 2500, max: 3 },
  { id: 'armor',   name: 'Armored Plating',desc: '+50 max health (car)',  price: 1800, max: 3 },
  { id: 'brakes',  name: 'Sport Brakes',   desc: '+30% braking, +grip',   price: 1200, max: 2 },
  { id: 'nitro',   name: 'Nitro Boost',    desc: 'SHIFT — short burst',   price: 3000, max: 1 },
  { id: 'paint',   name: 'Gold Paint Job', desc: 'Isla Dorada gold',      price: 900,  max: 1 },
];

// Sunset palette for the whole game.
export const PALETTE = {
  skyTop: 0x2a3a6e, skyMid: 0xe8763a, skyLow: 0xffb347,
  sun: 0xffd27a, fog: 0xe08a4a,
  road: 0x2e3138, roadLine: 0xf2d060,
  sand: 0xe8c98a, sea: 0x2a7a9e, grass: 0x4a7a3a,
  buildingGlass: 0x7ec8e8,
};

// Keyboard mapping.
export const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  interact: 'KeyE',
  handbrake: 'Space',
  nitro: 'ShiftLeft',
  map: 'KeyM',
  garage: 'KeyG',
  radioNext: 'KeyR',
  pause: 'Escape',
  weapon1: 'Digit1', weapon2: 'Digit2', weapon3: 'Digit3', weapon4: 'Digit4', weapon5: 'Digit5',
};
