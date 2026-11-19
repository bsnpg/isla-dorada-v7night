// Isla Dorada — side jobs (REBUILD v2): real, playable paid side activities.
// Taxi fares, courier deliveries and a Causeway street race. Every payout is
// real money added to G.player.money — no fake text, no paper cash.
// The wiring agent calls initSideJobs(G) in boot and updateSideJobs(G, dt) in
// stepPlay; update is safe to call every frame and cheap (a few hypot calls).
// Starting a story mission cancels an active side job — see cancelSideJob,
// hooked from missions.js startMission. Side jobs never touch wanted level,
// police, or the 8-mission arc.
import * as THREE from 'three';
import { KEYS } from './config.js';

// Map legend entries (same label/color/shape style as map.js POIS).
export const SIDEJOB_LEGEND = [
  { label: 'TAXI STAND', color: '#f2c230', shape: 'square' },
  { label: 'DELIVERY PICKUP', color: '#4fd9ff', shape: 'diamond' },
  { label: 'STREET RACE', color: '#ff5ad9', shape: 'circle' },
];

// Start points. Chosen clear of parked cars (player.js consumes E on foot
// within 5 m of any car to steal it), so E always reaches the side job:
// - taxi stand: Casino Row plaza (-96,-176); nearest parked car ~26 m away.
// - delivery pickup: warehouse yard (128,248); Faro Pickup at (116,236) is 17 m away.
// - race start: Causeway bridge deck (220,0); clear of the gate pylons.
const JOBS = [
  {
    id: 'taxi', name: 'TAXI FARE', color: 0xf2c230, css: '#f2c230', shape: 'square',
    x: -96, z: -176, startLabel: 'TAXI STAND',
    desc: 'Pick up a fare at Casino Row and drive them across the city.',
    payoutLabel: '$300–$1,200',
  },
  {
    id: 'delivery', name: 'DELIVERY RUN', color: 0x4fd9ff, css: '#4fd9ff', shape: 'diamond',
    x: 128, z: 248, startLabel: 'DELIVERY PICKUP',
    desc: 'Collect a package at the warehouse, deliver it before the timer runs out.',
    payoutLabel: '$400–$800',
  },
  {
    id: 'race', name: 'STREET RACE', color: 0xff5ad9, css: '#ff5ad9', shape: 'circle',
    x: 220, z: 0, startLabel: 'RACE START',
    desc: '5 checkpoints around the Causeway loop. Beat the par time: $1,000.',
    payoutLabel: '$1,000',
  },
];

// Taxi destinations: named places across the island (plaza points from city.js).
const TAXI_DESTS = [
  { label: 'MARINA', x: -120, z: 240 },
  { label: 'HARBOR', x: 160, z: 280 },
  { label: 'FERRIS WHEEL', x: -290, z: -40 },
  { label: 'GAS STATION', x: 120, z: -120 },
  { label: 'RESTAURANT', x: -120, z: 120 },
  { label: 'IDPD STATION', x: 40, z: -200 },
  { label: 'GARAGE', x: 40, z: 120 },
  { label: 'BEACHFRONT', x: -300, z: 0 },
  { label: 'IMPOUND', x: -120, z: 40 },
];

// Delivery drop-offs: real doors in the city (casino, shops, garage, marina).
const DELIVERY_DESTS = [
  { label: 'CASINO DORADA', x: -96, z: -176 },
  { label: 'RESTAURANT', x: -120, z: 120 },
  { label: 'GAS STATION', x: 120, z: -120 },
  { label: 'GARAGE', x: 40, z: 120 },
  { label: 'MARINA', x: -96, z: 264 },
];

// Street-race loop around the Causeway: 5 checkpoints, finish at the start line.
const RACE_START = { x: 220, z: 0 };
const RACE_CHECKPOINTS = [
  { label: 'CAUSEWAY EAST', x: 300, z: 0 },
  { label: 'CAUSEWAY SOUTH', x: 280, z: 80 },
  { label: 'HARBOR TURN', x: 200, z: 80 },
  { label: 'CAUSEWAY NORTH', x: 200, z: -80 },
  { label: 'CAUSEWAY WEST', x: 280, z: -80 },
];
const RACE_PAR = 75;      // seconds to run the whole loop
const RACE_PAYOUT = 1000;
const START_RADIUS = 9;   // press E within this of a start point
const ARRIVE_RADIUS = 14; // taxi / delivery arrival radius
const RACE_RADIUS = 12;   // checkpoint radius

const QUIPS_START = {
  taxi: 'WOWO: Penumpang naik — antar cepat, argo jalan terus.',
  delivery: 'WOWO: Paket di tangan. Jangan sampai telat.',
  race: 'WOWO: Lima checkpoint, satu putaran Causeway. Gas!',
};
const QUIPS_DONE = {
  taxi: 'WOWO: Sampai tujuan. Argo dibayar lunas.',
  delivery: 'WOWO: Paket sampai. Pelanggan senang, dompet senang.',
  race: 'WOWO: Putaran tercepat di Causeway. Mereka tidak akan lupa nama ini.',
};

function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Floating text label: canvas texture on a sprite, no network, no fonts.
function makeLabelSprite(line1, line2, colorCss) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = line2 ? 128 : 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(12,10,18,0.82)';
  const r = 18;
  ctx.beginPath();
  ctx.roundRect(4, 4, c.width - 8, c.height - 8, r);
  ctx.fill();
  ctx.strokeStyle = colorCss;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = colorCss;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.fillText(line1, c.width / 2, line2 ? 40 : c.height / 2);
  if (line2) {
    ctx.fillStyle = '#f5efe0';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText(line2, c.width / 2, 92);
  }
  const tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  sprite.scale.set(11, line2 ? 2.75 : 2.1, 1);
  return sprite;
}

function makeBeam(color, radius, height, opacity) {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 12, 1, true), mat,
  );
  mesh.position.y = height / 2;
  return mesh;
}

function makeRing(color, radius) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.3, 8, 28),
    new THREE.MeshBasicMaterial({ color }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.35;
  return ring;
}

export function initSideJobs(G) {
  if (G.sideJobs && G.sideJobs._ready) return;
  const list = JOBS.map((j) => ({
    id: j.id, name: j.name, desc: j.desc,
    x: j.x, z: j.z, color: j.css, shape: j.shape, payout: j.payoutLabel,
  }));
  G.sideJobs = {
    active: null,
    list,
    _ready: true,
    _markers: [],
    _beacon: null,
    _beaconLabel: null,
    _line: null,
    _lineGeo: null,
    _lastDestKey: null,
    _ePressed: false,
  };
  const sj = G.sideJobs;

  // Start-point markers: ground ring + light beam + floating "PRESS E" label.
  for (const j of JOBS) {
    const group = new THREE.Group();
    const beam = makeBeam(j.color, 1.1, 14, 0.28);
    const ring = makeRing(j.color, 3);
    const label = makeLabelSprite(j.startLabel, 'PRESS E', j.css);
    label.position.y = 5.2;
    group.add(beam);
    group.add(ring);
    group.add(label);
    group.position.set(j.x, 0, j.z);
    G.scene.add(group);
    sj._markers.push({ group, beam, label, phase: G.rng() * Math.PI * 2 });
  }

  // Active-target beacon (reused for every job): beam + ring + point light +
  // destination label. Hidden until a job starts.
  const beacon = new THREE.Group();
  const bBeam = makeBeam(0xf2c230, 0.9, 26, 0.4);
  const bRing = makeRing(0xf2c230, 2.4);
  const bLight = new THREE.PointLight(0xf2c230, 50, 36, 1.5);
  bLight.position.y = 4;
  beacon.add(bBeam);
  beacon.add(bRing);
  beacon.add(bLight);
  beacon.visible = false;
  G.scene.add(beacon);
  sj._beacon = beacon;
  sj._beaconBeam = bBeam;
  sj._beaconRing = bRing;
  sj._beaconLight = bLight;

  // GPS guide line: player -> target, updated every frame while a job is active.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xf2c230, transparent: true, opacity: 0.55,
  }));
  line.visible = false;
  line.frustumCulled = false;
  G.scene.add(line);
  sj._line = line;
  sj._lineGeo = geo;

  // Own E listener: player.js consumes Input.pressed(KeyE) on foot even when
  // no car is near (it steals), and updateSideJobs runs after updatePlayer in
  // stepPlay — so a shared pressed() check would never see E on foot. This
  // listener records the press independently; updateSideJobs consumes it.
  if (typeof window !== 'undefined' && !sj._keyListener) {
    sj._keyListener = (e) => {
      if (e.repeat || e.code !== KEYS.interact) return;
      if (G.mode !== 'play') return;
      sj._ePressed = true;
    };
    window.addEventListener('keydown', sj._keyListener);
  }
}

function setBeacon(G, x, z, colorHex, css, label) {
  const sj = G.sideJobs;
  if (!sj || !sj._beacon) return;
  sj._beacon.position.set(x, 0, z);
  sj._beaconBeam.material.color.setHex(colorHex);
  sj._beaconRing.material.color.setHex(colorHex);
  sj._beaconLight.color.setHex(colorHex);
  sj._line.material.color.setHex(colorHex);
  if (sj._beaconLabel) {
    sj._beacon.remove(sj._beaconLabel);
    sj._beaconLabel = null;
  }
  if (label) {
    const sprite = makeLabelSprite(label, '', css);
    sprite.position.y = 6;
    sj._beacon.add(sprite);
    sj._beaconLabel = sprite;
  }
  sj._beacon.visible = true;
  sj._line.visible = true;
}

function hideBeacon(G) {
  const sj = G.sideJobs;
  if (!sj) return;
  if (sj._beacon) sj._beacon.visible = false;
  if (sj._line) sj._line.visible = false;
}

function pickDest(G, dests) {
  const sj = G.sideJobs;
  const pool = dests.filter((d) => `${d.label}|${d.x}|${d.z}` !== sj._lastDestKey);
  const list = pool.length ? pool : dests;
  const d = list[Math.floor(G.rng() * list.length)];
  sj._lastDestKey = `${d.label}|${d.x}|${d.z}`;
  return d;
}

function startJob(G, job) {
  const sj = G.sideJobs;
  if (job.id === 'taxi') {
    const dest = pickDest(G, TAXI_DESTS);
    const d = Math.round(dist2(job.x, job.z, dest.x, dest.z));
    const payout = Math.min(1200, 300 + 2 * d);
    const timer = Math.min(150, Math.max(60, 45 + d * 0.12));
    sj.active = {
      id: 'taxi', name: 'TAXI FARE',
      objective: `Take the fare to ${dest.label} — ${d} m`,
      payout, timer, distance: d,
      target: { x: dest.x, z: dest.z, label: dest.label },
    };
    setBeacon(G, dest.x, dest.z, job.color, job.css, dest.label);
  } else if (job.id === 'delivery') {
    const dest = pickDest(G, DELIVERY_DESTS);
    const d = Math.round(dist2(job.x, job.z, dest.x, dest.z));
    const payout = Math.min(800, Math.max(400, 400 + d));
    const timer = Math.min(150, Math.max(60, 45 + d * 0.12));
    sj.active = {
      id: 'delivery', name: 'DELIVERY RUN',
      objective: `Deliver the package to ${dest.label} — ${d} m`,
      payout, timer, distance: d,
      target: { x: dest.x, z: dest.z, label: dest.label },
    };
    setBeacon(G, dest.x, dest.z, job.color, job.css, dest.label);
  } else { // race
    sj.active = {
      id: 'race', name: 'STREET RACE',
      objective: 'Race checkpoint 1/5 — Causeway loop',
      payout: RACE_PAYOUT, timer: RACE_PAR, distance: 0,
      target: { x: RACE_CHECKPOINTS[0].x, z: RACE_CHECKPOINTS[0].z, label: RACE_CHECKPOINTS[0].label },
      checkpoint: 1, checkpoints: RACE_CHECKPOINTS.length, phase: 'checkpoints',
    };
    setBeacon(G, RACE_CHECKPOINTS[0].x, RACE_CHECKPOINTS[0].z, job.color, job.css, RACE_CHECKPOINTS[0].label);
  }
  G.flashToast(`${job.name} STARTED — $${sj.active.payout}`);
  G.showDialogue('WOWO', QUIPS_START[job.id] || 'WOWO: Job started.', 4000);
}

function clearActive(G) {
  const sj = G.sideJobs;
  if (!sj) return;
  sj.active = null;
  hideBeacon(G);
}

function completeJob(G) {
  const sj = G.sideJobs;
  const a = sj.active;
  if (!a) return;
  G.player.money += a.payout;
  if (G.stats) G.stats.sideJobsDone = (G.stats.sideJobsDone || 0) + 1;
  G.flashToast(`${a.name} COMPLETE — +$${a.payout}`);
  G.showDialogue('WOWO', QUIPS_DONE[a.id] || 'WOWO: Job done.', 5000);
  try { G.saveGame(); } catch (e) { /* save is best-effort */ }
  clearActive(G);
}

function failJob(G, why) {
  const sj = G.sideJobs;
  const a = sj.active;
  if (!a) return;
  G.flashToast(`${a.name} FAILED — ${why}`);
  clearActive(G);
}

// Cancel the active side job (e.g. a story mission just started). Exported
// for missions.js; safe to call when nothing is active.
export function cancelSideJob(G, silent) {
  const sj = G.sideJobs;
  if (!sj || !sj.active) return;
  clearActive(G);
  if (!silent) G.flashToast('SIDE JOB CANCELLED — STORY JOB STARTED');
}

function tryStartNear(G) {
  const sj = G.sideJobs;
  const p = G.player.pos;
  let best = null, bestD = START_RADIUS * START_RADIUS;
  for (const j of JOBS) {
    const dx = p.x - j.x, dz = p.z - j.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= bestD) { bestD = d2; best = j; }
  }
  if (!best) return;
  if (best.id === 'race' && G.player.mode !== 'car') {
    G.flashToast('STREET RACE NEEDS A CAR — GET IN ONE FIRST');
    return;
  }
  startJob(G, best);
}

export function updateSideJobs(G, dt) {
  const sj = G.sideJobs;
  if (!sj || !G.player || !G.player.pos) return;
  const t = G.time || 0;

  // Pulse the start markers (cheap: opacity only, no new objects).
  for (const m of sj._markers) {
    m.beam.material.opacity = 0.22 + 0.12 * Math.sin(t * 2 + m.phase);
    m.label.position.y = 5.2 + Math.sin(t * 1.5 + m.phase) * 0.25;
  }

  const a = sj.active;
  if (!a) {
    if (sj._ePressed) {
      sj._ePressed = false;
      tryStartNear(G);
    }
    return;
  }
  // An E press while a job is active is ignored (one job at a time).
  sj._ePressed = false;

  const p = G.player.pos;
  a.timer -= dt;
  a.distance = Math.round(dist2(p.x, p.z, a.target.x, a.target.z));

  // GPS line: player -> target.
  if (sj._lineGeo) {
    const pos = sj._lineGeo.attributes.position.array;
    pos[0] = p.x; pos[1] = 0.6; pos[2] = p.z;
    pos[3] = a.target.x; pos[4] = 0.6; pos[5] = a.target.z;
    sj._lineGeo.attributes.position.needsUpdate = true;
  }
  if (sj._beacon) {
    sj._beaconBeam.material.opacity = 0.32 + 0.12 * Math.sin(t * 3);
  }

  if (a.timer <= 0) {
    a.timer = 0;
    failJob(G, 'OUT OF TIME');
    return;
  }

  if (a.id === 'race') {
    if (a.distance <= RACE_RADIUS) {
      if (a.phase === 'finish') {
        // Back at the start line after all 5 checkpoints — race won.
        completeJob(G);
        return;
      }
      // Cleared checkpoint a.checkpoint (1-based).
      G.flashToast(`CHECKPOINT ${a.checkpoint}/5`);
      const job = JOBS.find((j) => j.id === 'race');
      if (a.checkpoint >= a.checkpoints) {
        // All 5 checkpoints cleared — head back to the start line.
        a.phase = 'finish';
        a.target = { x: RACE_START.x, z: RACE_START.z, label: 'FINISH' };
        a.objective = 'Final stretch — back to the start line!';
        setBeacon(G, RACE_START.x, RACE_START.z, job.color, job.css, 'FINISH');
        G.flashToast('ALL CHECKPOINTS — FINISH LINE!');
      } else {
        a.checkpoint += 1;
        const cp = RACE_CHECKPOINTS[a.checkpoint - 1];
        a.target = { x: cp.x, z: cp.z, label: cp.label };
        a.objective = `Race checkpoint ${a.checkpoint}/5 — Causeway loop`;
        setBeacon(G, cp.x, cp.z, job.color, job.css, cp.label);
      }
    }
    return;
  }

  // Taxi / delivery: arrive inside the beacon radius.
  if (a.distance <= ARRIVE_RADIUS) completeJob(G);
}