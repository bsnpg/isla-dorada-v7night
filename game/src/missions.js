// Isla Dorada — the 8 staged story jobs ("Bersihkan Nama" arc).
// Data-driven stages: reach a point, clear a combat stage, or lose a tail.
// The objective beacon is a glowing gold cylinder + point light at the target.
// Job 4 is the timed Causeway chase (150 s); Job 8 runs at wanted 5.
// Rewards scale per job and the game auto-saves on every completion.
import * as THREE from 'three';
import { MISSIONS } from './config.js';
import { spawnBurningCar, spawnEnemy } from './combat.js';
import { cancelSideJob } from './sidejobs.js';

// Landmark coordinates (match city.js landmarks).
const CASINO = { x: -120, z: -200 };
const MARINA = { x: -120, z: 240 };
const OLD_TOWN = { x: -120, z: 40 };
const IMPOUND = { x: -120, z: 40 };
const WAREHOUSE = { x: 120, z: 240 };
const GARAGE = { x: 40, z: 120 };
const STATION = { x: 40, z: -200 };
const CAUSEWAY = { x: 260, z: 0 };
const HARBOR = { x: 120, z: 240 };
const FAR_EAST = { x: 310, z: 0 };

// Each mission: 3 stages. reach = stand inside r of (x,z); combat = clear all
// spawned enemies; escape = wanted must fall to 0.
const STAGES = [
  // Job 1 — Pendaratan: drive the boss there and back.
  [
    { type: 'reach', x: CASINO.x, z: CASINO.z, r: 15 },
    { type: 'reach', x: MARINA.x, z: MARINA.z, r: 15 },
    { type: 'reach', x: CASINO.x, z: CASINO.z, r: 15 },
  ],
  // Job 2 — Cari Saksi: pick up the witness, lose the tail, deliver her.
  [
    { type: 'reach', x: MARINA.x, z: MARINA.z, r: 12 },
    { type: 'escape', x: OLD_TOWN.x, z: OLD_TOWN.z, r: 15 },
    { type: 'reach', x: OLD_TOWN.x, z: OLD_TOWN.z, r: 15 },
  ],
  // Job 3 — Curi Bukti: impound, fight, deliver to the casino.
  [
    { type: 'reach', x: IMPOUND.x, z: IMPOUND.z, r: 12 },
    { type: 'combat', x: IMPOUND.x, z: IMPOUND.z, r: 12, enemies: ['gunman', 'gunman'] },
    { type: 'reach', x: CASINO.x, z: CASINO.z, r: 15 },
  ],
  // Job 4 — Causeway chase: timed run, 150 s.
  [
    { type: 'reach', x: CAUSEWAY.x, z: CAUSEWAY.z, r: 20 },
    { type: 'reach', x: HARBOR.x, z: HARBOR.z, r: 15 },
    { type: 'reach', x: CASINO.x, z: CASINO.z, r: 15 },
  ],
  // Job 5 — Gudang Senjata: warehouse, clear the crew, reach the garage.
  // A burning car is already waiting in the warehouse yard when the fight starts.
  [
    { type: 'reach', x: WAREHOUSE.x, z: WAREHOUSE.z, r: 15 },
    { type: 'combat', x: WAREHOUSE.x, z: WAREHOUSE.z, r: 15, enemies: ['gunman', 'gunman', 'gunman'], burningCar: true },
    { type: 'reach', x: GARAGE.x, z: GARAGE.z, r: 12 },
  ],
  // Job 6 — Konfrontasi: marina, fight Braga's men, reach the station.
  [
    { type: 'reach', x: MARINA.x, z: MARINA.z, r: 15 },
    { type: 'combat', x: MARINA.x, z: MARINA.z, r: 15, enemies: ['gunman', 'gunman', 'heavy'] },
    { type: 'reach', x: STATION.x, z: STATION.z, r: 15 },
  ],
  // Job 7 — Bukti Terakhir: station, fight, deliver to Old Town.
  [
    { type: 'reach', x: STATION.x, z: STATION.z, r: 12 },
    { type: 'combat', x: STATION.x, z: STATION.z, r: 12, enemies: ['gunman', 'gunman', 'gunman'] },
    { type: 'reach', x: OLD_TOWN.x, z: OLD_TOWN.z, r: 15 },
  ],
  // Job 8 — Bebas: causeway at wanted 5, then far east — freedom.
  [
    { type: 'reach', x: CAUSEWAY.x, z: CAUSEWAY.z, r: 20 },
    { type: 'reach', x: FAR_EAST.x, z: FAR_EAST.z, r: 15 },
    { type: 'reach', x: FAR_EAST.x, z: FAR_EAST.z, r: 15 },
  ],
];

const STAGE_OBJECTIVES = [
  ['Drive the casino boss to Casino Dorada', 'Pick up the boss at the Marina', 'Drive the boss back to Casino Dorada'],
  ['Pick up the witness at the Marina', 'Lose the IDPD tail — get wanted to zero', 'Deliver the witness to Old Town'],
  ['Reach the police impound', 'Take the evidence — clear the guards', 'Deliver the evidence to Casino Dorada'],
  ['Reach the Causeway — outrun the IDPD', 'Cut through the Harbor', 'Deliver the evidence to Casino Dorada'],
  ['Reach the warehouse', 'Clear the warehouse crew', 'Take the cache to the garage'],
  ['Reach the Marina — face Officer Braga', 'Deal with Braga\u2019s men', 'Get the confession to the IDPD station'],
  ['Reach the IDPD station', 'Take the recording — clear the guards', 'Deliver the recording to Old Town'],
  ['Reach the Causeway — five stars, one road out', 'Push east — do not stop', 'Freedom — cross the line'],
];

// One-line toast shown when each stage starts, so the player always knows
// what changed without opening the map.
const STAGE_BRIEFINGS = [
  ['Boss is waiting at the Marina', 'Boss aboard — Casino Dorada, fast', 'Drop him at the casino'],
  ['The witness is at the Marina', 'IDPD tail on you — break line of sight', 'She is safe — take her to Old Town'],
  ['Impound lot, Old Town', 'Guards between you and the evidence', 'Evidence in hand — casino, now'],
  ['Causeway east — full speed', 'Harbor cut-through, keep moving', 'Final stretch to the casino'],
  ['Warehouse, Harbor district', 'The crew will not hand it over', 'Cache secured — garage, go'],
  ['Braga is at the Marina', 'His men first, then him', 'Confession in pocket — IDPD station'],
  ['IDPD station, Palm Heights', 'Guards on the recording room', 'Recording secured — Old Town'],
  ['Five stars. One road out.', 'Do not stop for anything', 'FREEDOM — cross the line'],
];

const QUIPS = [
  'WOWO: One down. Seven to go. The island is already talking.',
  'WOWO: She is safe. Whoever framed me just lost their witness.',
  'WOWO: Evidence secured. The impound will not miss it until morning.',
  'WOWO: They chased me across the whole island and still lost.',
  'WOWO: Now I am armed. Let them come.',
  'WOWO: Braga blinked first. His confession is in my pocket.',
  'WOWO: The last recording. My name is almost clean.',
  'WOWO: Free. Finally free.',
];

let beaconMat = null;
let beaconGeo = null;

function makeBeacon(G, x, z) {
  removeBeacon(G);
  if (!beaconMat) {
    beaconMat = new THREE.MeshBasicMaterial({ color: 0xffc93a, transparent: true, opacity: 0.55 });
    beaconGeo = new THREE.CylinderGeometry(1.2, 1.2, 30, 16, 1, true);
  }
  const group = new THREE.Group();
  const beam = new THREE.Mesh(beaconGeo, beaconMat);
  beam.position.y = 15;
  group.add(beam);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.25, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffc93a }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.3;
  group.add(ring);
  const light = new THREE.PointLight(0xffc93a, 60, 40, 1.5);
  light.position.y = 4;
  group.add(light);
  group.position.set(x, 0, z);
  G.scene.add(group);
  G.missions._beacon = group;
  G.missions.marker = { x, z };
}

function removeBeacon(G) {
  if (G.missions && G.missions._beacon) {
    G.scene.remove(G.missions._beacon);
    G.missions._beacon = null;
  }
  if (G.missions) G.missions.marker = null;
}

function stageDef(i, stage) {
  const list = STAGES[i];
  return list ? list[Math.min(stage, list.length) - 1] : null;
}

function applyStage(G) {
  const m = G.missions;
  const def = stageDef(m.index, m.stage);
  if (!def) return;
  m.objective = (STAGE_OBJECTIVES[m.index] && STAGE_OBJECTIVES[m.index][m.stage - 1])
    || MISSIONS[m.index].objective;
  const brief = STAGE_BRIEFINGS[m.index] && STAGE_BRIEFINGS[m.index][m.stage - 1];
  if (brief) G.flashToast(brief);
  makeBeacon(G, def.x, def.z);
  if (def.type === 'combat') {
    // Spawn the stage's enemies once, at the fight location.
    const spots = [
      { x: def.x - 6, z: def.z + 6 },
      { x: def.x + 8, z: def.z - 2 },
      { x: def.x + 2, z: def.z + 14 },
      { x: def.x - 10, z: def.z - 8 },
    ];
    (def.enemies || []).forEach((kind, k) => {
      const s = spots[k % spots.length];
      spawnEnemy(G, s.x, s.z, kind);
    });
    if (def.burningCar) {
      spawnBurningCar(G, def.x + 14, def.z + 10, Math.PI / 3, 'Faro Pickup');
    }
  }
}

export function initMissions(G) {
  G.missions = {
    index: 0, stage: 1, stageCount: 3, title: '', objective: '',
    timer: 0, state: 'idle', marker: null,
    _beacon: null, _pendingNext: 0,
  };
}

export function startMission(G, i) {
  const m = MISSIONS[Math.max(0, Math.min(i, MISSIONS.length - 1))];
  if (!m) return;
  if (!G.missions) initMissions(G);
  // A story job starting cancels any active side job (sidejobs.js).
  if (G.sideJobs && G.sideJobs.active) cancelSideJob(G);
  removeBeacon(G);
  G.missions.index = MISSIONS.indexOf(m);
  G.missions.stage = 1;
  G.missions.stageCount = 3;
  G.missions.title = m.name;
  G.missions.objective = m.objective;
  // Job 4 (index 3) is the timed Causeway chase: 150 s.
  G.missions.timer = G.missions.index === 3 ? 150 : 0;
  G.missions.state = 'active';
  G.missions._pendingNext = 0;
  G.showDialogue('WOWO', m.briefing, 6000);
  G.setWanted(m.wanted);
  applyStage(G);
}

function completeMission(G) {
  const m = G.missions;
  const reward = 2000 + 500 * (m.index + 1);
  removeBeacon(G);
  G.player.money += reward;
  G.stats.missionsDone += 1;
  G.flashToast(`JOB COMPLETE — $${reward}`);
  G.showDialogue('WOWO', QUIPS[m.index] || 'WOWO: Job done.', 5000);
  try { G.saveGame(); } catch (e) { /* save is best-effort */ }
  if (m.index < MISSIONS.length - 1) {
    m.state = 'done';
    m._pendingNext = 2.5; // auto-start the next job after a beat
  } else {
    m.state = 'done';
    G.flashToast('ISLA DORADA COMPLETE — WOWO IS FREE');
  }
}

export function updateMissions(G, dt) {
  if (!G.missions) return;
  const m = G.missions;

  // Pending auto-start of the next job after a completion.
  if (m.state === 'done' && m._pendingNext > 0) {
    m._pendingNext -= dt;
    if (m._pendingNext <= 0) {
      m._pendingNext = 0;
      startMission(G, m.index + 1);
    }
    return;
  }
  if (m.state !== 'active') return;

  // Job 4 timer: out of time = fail and restart the same mission.
  if (m.timer > 0) {
    m.timer -= dt;
    if (m.timer <= 0) {
      m.timer = 0;
      G.flashToast('JOB FAILED — OUT OF TIME');
      startMission(G, m.index);
      return;
    }
  }

  const def = stageDef(m.index, m.stage);
  if (!def) return;
  const p = G.player.pos;
  let done = false;
  if (def.type === 'reach') {
    done = Math.hypot(p.x - def.x, p.z - def.z) < def.r;
  } else if (def.type === 'combat') {
    done = !G.combat || G.combat.enemies.length === 0;
  } else if (def.type === 'escape') {
    done = G.police.wanted === 0;
  }
  if (!done) return;

  if (m.stage >= m.stageCount) {
    completeMission(G);
    return;
  }
  m.stage += 1;
  G.flashToast(`STAGE ${m.stage} COMPLETE`);
  applyStage(G);
}
