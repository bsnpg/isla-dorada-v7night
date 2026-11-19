// Isla Dorada — garage screen (rebuild): build the upgrade list from
// UPGRADES, buy upgrades with cash, refresh on open. driving.js reads
// G.garage.owned for the engine / brakes / nitro effects — this module only
// stores the owned levels. The rebuild adds level pips (●○○) so owned levels
// read at a glance, an affordability state on every row, and a one-line
// summary of the car the upgrades apply to.
//
// 3D GARAGE (v2 backup build): the garage is a REAL 3D screen, not just a
// DOM list. When the garage opens, a garage interior is shown in the 3D
// scene at the garage landmark plaza (40, 120): concrete floor, a hydraulic
// lift (platform + posts) with the player's actual car raised on it, tool
// cabinets, a workbench, a tyre stack, oil drums, warm hanging lamps and a
// neon "GARAGE DORADA" sign. The DOM upgrade list sits on the right side of
// the screen (see index.html #garage-screen styling — translucent on the
// left so the 3D view reads through) and keeps working exactly as before.
// main.js renders the scene every frame regardless of mode and does not
// touch the camera in garage mode, so this module drives the garage camera
// itself with a small rAF loop while mode === 'garage'. On close the car is
// put back exactly where it was and main.js takes the camera back in play.
import * as THREE from 'three';
import { UPGRADES, KEYS } from './config.js';
import { Input } from './input.js';
import { playSFX } from './audio.js';
import { makeCar } from './driving.js';

let listEl = null;
let moneyEl = null;
let summaryEl = null;

// Garage plaza (city.js LANDMARK_SPOTS.garage). The interior is built in
// world coordinates around this point; the display car is parked on the
// lift at its centre.
const GX = 40;
const GZ = 120;
const LIFT_Y = 1.28; // car mesh y while raised on the lift platform

function fmtMoney(n) {
  return '$' + Math.floor(n || 0).toLocaleString('en-US');
}

function ownedLevel(G, id) {
  return (G.garage && G.garage.owned && G.garage.owned[id]) || 0;
}

function pips(level, max) {
  let s = '';
  for (let i = 0; i < max; i++) s += i < level ? '●' : '○';
  return s;
}

function refreshGarage(G) {
  const money = G.player ? G.player.money : 0;
  if (moneyEl) moneyEl.textContent = fmtMoney(money);
  if (summaryEl) {
    const car = (G.driving && G.driving.car) ? G.driving.car : null;
    const owned = (G.garage && G.garage.owned) || {};
    const spent = UPGRADES.reduce((t, u) => t + (owned[u.id] || 0) * u.price, 0);
    const carName = car ? (car.name || (car.def && car.def.name) || 'YOUR CAR') : 'NO CAR — STEAL ONE FIRST';
    summaryEl.textContent = `${carName}  ·  UPGRADES INSTALLED: ${Object.values(owned).reduce((a, b) => a + b, 0)}  ·  SPENT: ${fmtMoney(spent)}`;
  }
  if (!listEl) return;
  listEl.innerHTML = '';
  for (const u of UPGRADES) {
    const level = ownedLevel(G, u.id);
    const maxed = level >= u.max;
    const afford = money >= u.price;
    const row = document.createElement('div');
    row.className = 'upg' + (maxed ? ' owned' : '') + (!maxed && !afford ? ' cant-afford' : '');
    const info = document.createElement('div');
    const title = document.createElement('div');
    title.innerHTML = `<b>${u.name}</b> — ${u.desc} <span class="price">${fmtMoney(u.price)}</span>`;
    const lvl = document.createElement('div');
    lvl.textContent = `LV ${level}/${u.max}  ${pips(level, u.max)}${maxed ? '  — MAXED' : (afford ? '' : '  — NEED ' + fmtMoney(u.price - money) + ' MORE')}`;
    lvl.style.cssText = 'color: var(--muted); font-size: 12px; margin-top: 2px;';
    info.appendChild(title);
    info.appendChild(lvl);
    const btn = document.createElement('button');
    btn.textContent = maxed ? 'MAXED' : 'BUY';
    btn.disabled = maxed || !afford;
    btn.addEventListener('click', () => buyUpgrade(G, u.id));
    row.appendChild(info);
    row.appendChild(btn);
    listEl.appendChild(row);
  }
}

// ---------------------------------------------------------------- 3D interior
// Procedural neon sign texture (canvas, no network) — same approach as
// city.js makeTextSign, local so this module stays self-contained.
function makeNeonSignTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#160a24';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = '#ff4ad9';
  ctx.lineWidth = 8;
  ctx.strokeRect(12, 12, 1000, 232);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff4ad9';
  ctx.shadowBlur = 28;
  ctx.fillStyle = '#ff8ad9';
  ctx.font = 'bold 88px system-ui, sans-serif';
  ctx.fillText('GARAGE DORADA', 512, 102);
  ctx.shadowColor = '#f2c230';
  ctx.shadowBlur = 16;
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 46px system-ui, sans-serif';
  ctx.fillText('★ GOLDEN PALMS • LIFT 1 ★', 512, 196);
  const tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0.1, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1 }),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Build the interior group once, hidden until the garage opens. All pieces
// are positioned in world coordinates around (GX, GZ); the camera looks in
// through the open front (high z, camera side) at the car on the lift.
function buildGarage3D(G) {
  const group = new THREE.Group();
  group.visible = false;

  // Concrete floor slab (slightly above the grass so it reads as a pad).
  const floor = box(26, 0.2, 20, 0x3a3a40, { rough: 0.95 });
  floor.position.set(GX, 0.1, GZ);
  group.add(floor);
  // Gold guide lines painted on the floor, marking the lift bay.
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6, emissive: 0x6a4a00, emissiveIntensity: 0.5 });
  for (const lx of [-3.4, 3.4]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 16), lineMat);
    line.position.set(GX + lx, 0.22, GZ);
    group.add(line);
  }

  // Back wall + two side walls (open front toward the camera). Interior
  // faces are warm cream; exterior is the same mesh, unseen from the front.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.9 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(26, 5.5, 0.4), wallMat);
  back.position.set(GX, 2.75, GZ - 10);
  back.castShadow = true;
  back.receiveShadow = true;
  group.add(back);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.5, 20), wallMat);
    wall.position.set(GX + side * 13, 2.75, GZ);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }
  // Roof beams across the top (open roof — the sunset still lights the bay).
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.9 });
  for (const bz of [-6, 0, 6]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 0.6), beamMat);
    beam.position.set(GX, 5.6, GZ + bz);
    group.add(beam);
  }

  // ---- hydraulic lift: platform + 4 posts + centre cylinder ----
  const liftMat = new THREE.MeshStandardMaterial({ color: 0x2a6a9a, roughness: 0.5, metalness: 0.5 });
  const platform = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.24, 5.2), liftMat);
  platform.position.set(GX, 1.16, GZ);
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);
  // Yellow safety edge strips on the platform.
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, emissive: 0x6a4a00, emissiveIntensity: 0.6 });
  for (const ex of [-1.3, 1.3]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 5.2), edgeMat);
    edge.position.set(GX + ex, 1.3, GZ);
    group.add(edge);
  }
  for (const [px, pz] of [[-1.5, -2.4], [1.5, -2.4], [-1.5, 2.4], [1.5, 2.4]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.16, 0.3), liftMat);
    post.position.set(GX + px, 0.58, GZ + pz);
    post.castShadow = true;
    group.add(post);
  }
  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.45, 1.05, 12),
    new THREE.MeshStandardMaterial({ color: 0x8a8a92, roughness: 0.35, metalness: 0.8 }),
  );
  cylinder.position.set(GX, 0.55, GZ);
  group.add(cylinder);

  // ---- neon GARAGE DORADA sign on the back wall ----
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 3.25),
    new THREE.MeshBasicMaterial({ map: makeNeonSignTexture() }),
  );
  sign.position.set(GX, 4.1, GZ - 9.75);
  group.add(sign);
  // Pink neon under-glow strip below the sign.
  const glowStrip = new THREE.Mesh(
    new THREE.BoxGeometry(13, 0.12, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x2a0a2a, emissive: 0xff4ad9, emissiveIntensity: 2.2 }),
  );
  glowStrip.position.set(GX, 2.35, GZ - 9.7);
  group.add(glowStrip);

  // ---- tool cabinets (red, drawer fronts) along the back wall, left ----
  const cabMat = new THREE.MeshStandardMaterial({ color: 0xa02a2a, roughness: 0.5, metalness: 0.4 });
  const drawerMat = new THREE.MeshStandardMaterial({ color: 0x6a1a1a, roughness: 0.6, metalness: 0.3 });
  for (let i = 0; i < 2; i++) {
    const cx = GX - 9.5 + i * 3.4;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.0, 1.0), cabMat);
    cab.position.set(cx, 1.0, GZ - 9.2);
    cab.castShadow = true;
    group.add(cab);
    for (let d = 0; d < 3; d++) {
      const drawer = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.45, 0.06), drawerMat);
      drawer.position.set(cx, 0.45 + d * 0.6, GZ - 8.68);
      group.add(drawer);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.07, 0.05),
        new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.3, metalness: 0.8 }));
      handle.position.set(cx, 0.45 + d * 0.6, GZ - 8.63);
      group.add(handle);
    }
  }

  // ---- workbench (left side wall, visible left of the DOM panel) with
  // tools on top. Runs along the wall so it stays in the camera's frame.
  const benchTop = box(1.4, 0.18, 5.2, 0x6a4a2a, { rough: 0.9 });
  benchTop.position.set(GX - 11.6, 1.05, GZ - 3);
  group.add(benchTop);
  for (const [bx, bz] of [[-0.5, -2.3], [0.5, -2.3], [-0.5, 2.3], [0.5, 2.3]]) {
    const leg = box(0.14, 1.0, 0.14, 0x3a3a3a, { metal: 0.6 });
    leg.position.set(GX - 11.6 + bx, 0.5, GZ - 3 + bz);
    group.add(leg);
  }
  // Tools on the bench: a wrench (thin box), a parts crate, a small lamp.
  const wrench = box(0.9, 0.08, 0.18, 0xc8c8d0, { metal: 0.8, rough: 0.3 });
  wrench.position.set(GX - 11.6, 1.2, GZ - 3.4);
  wrench.rotation.y = 0.5;
  group.add(wrench);
  const crate = box(0.9, 0.6, 0.9, 0x8a6a2a, { rough: 0.95 });
  crate.position.set(GX - 11.6, 1.45, GZ - 2.2);
  group.add(crate);
  const benchLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x332a18, emissive: 0xffe0a0, emissiveIntensity: 3 }),
  );
  benchLamp.position.set(GX - 11.6, 1.5, GZ - 4);
  group.add(benchLamp);

  // ---- tyre stack (left side wall) ----
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.95 });
  for (let i = 0; i < 4; i++) {
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.24, 10, 20), tyreMat);
    tyre.rotation.x = Math.PI / 2;
    tyre.position.set(GX - 11.6, 0.35 + i * 0.5, GZ + 4);
    tyre.castShadow = true;
    group.add(tyre);
  }
  // Spare wheel leaning on the tyre stack.
  const spare = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.24, 10, 20), tyreMat);
  spare.position.set(GX - 10.6, 0.8, GZ + 4);
  spare.rotation.y = 0.4;
  group.add(spare);

  // ---- oil drums (right of the lift) + a fuel can ----
  const drumColors = [0x2a6a3a, 0x8a2a2a, 0x2a4a8a];
  drumColors.forEach((col, i) => {
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 1.3, 14),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.4 }),
    );
    drum.position.set(GX + 6.5 + (i % 2) * 1.3, 0.65, GZ + 6.5 + Math.floor(i / 2) * 1.3);
    drum.castShadow = true;
    group.add(drum);
  });
  const can = box(0.5, 0.6, 0.35, 0xc23a3a, { rough: 0.6, metal: 0.3 });
  can.position.set(GX - 6.5, 0.5, GZ + 6.8);
  group.add(can);

  // ---- warm lights: two hanging work lamps over the lift + a pink neon
  // wash from the sign. The sunset directional light still reaches the bay
  // through the open front and roof, so the scene stays golden, not dark.
  const warm = 0xffb347;
  for (const lx of [-4, 4]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 }));
    cord.position.set(GX + lx, 4.9, GZ);
    group.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.5, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a6a3a, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }));
    shade.position.set(GX + lx, 4.3, GZ);
    group.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x332a18, emissive: 0xffe0a0, emissiveIntensity: 4 }));
    bulb.position.set(GX + lx, 4.05, GZ);
    group.add(bulb);
    const light = new THREE.PointLight(warm, 55, 26, 1.6);
    light.position.set(GX + lx, 3.8, GZ);
    group.add(light);
  }
  const neonLight = new THREE.PointLight(0xff4ad9, 22, 20, 1.8);
  neonLight.position.set(GX, 3.6, GZ - 8);
  group.add(neonLight);
  // Warm fill from the camera side: the sunset comes from the west, so the
  // side of the car facing the camera would otherwise sit in shadow.
  const fillLight = new THREE.PointLight(0xffc27a, 42, 26, 1.6);
  fillLight.position.set(GX + 6, 3.5, GZ + 9);
  group.add(fillLight);

  G.scene.add(group);
  return group;
}

// Pick the car to show on the lift: the player's current car if any, else
// the nearest parked car, else a temporary gold Aurea GT kept for display.
function pickDisplayCar(G, view) {
  if (G.driving && G.driving.car && G.driving.car.mesh) return G.driving.car;
  const parked = (G.driving && G.driving.parked) || [];
  const px = G.player && G.player.pos ? G.player.pos.x : GX;
  const pz = G.player && G.player.pos ? G.player.pos.z : GZ;
  let best = null;
  let bestD = Infinity;
  for (const c of parked) {
    if (!c.mesh) continue;
    const dx = c.mesh.position.x - px;
    const dz = c.mesh.position.z - pz;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best) return best;
  if (!view.tempCar) {
    view.tempCar = makeCar(G, 'Aurea GT', GX, GZ, 0);
    view.tempCar.mesh.visible = false;
  }
  return view.tempCar;
}

function enterGarage3D(G) {
  if (!G.garage) G.garage = { owned: {} };
  if (!G.garage.view) G.garage.view = { group: null, active: false, displayCar: null, saved: null, tempCar: null };
  const view = G.garage.view;
  if (view.active) return;
  if (!G.scene || !G.camera) return;
  if (!view.group) view.group = buildGarage3D(G);
  const car = pickDisplayCar(G, view);
  if (!car || !car.mesh) return;
  // Save the car's exact pose so close restores it 1:1 (position, heading,
  // flip state, height) — the garage never keeps a moved car.
  view.saved = {
    car,
    x: car.mesh.position.x, y: car.mesh.position.y, z: car.mesh.position.z,
    rotY: car.mesh.rotation.y, rotZ: car.mesh.rotation.z,
    playerMeshVisible: G.player && G.player.mesh ? G.player.mesh.visible : true,
  };
  car.mesh.position.set(GX, LIFT_Y, GZ);
  car.mesh.rotation.y = -0.45; // three-quarter view toward the camera
  car.mesh.rotation.z = 0; // a flipped car reads wrong on the lift; restored on close
  car.mesh.visible = true;
  if (G.player && G.player.mesh) G.player.mesh.visible = false;
  view.displayCar = car;
  view.group.visible = true;
  view.active = true;
  G.garage.displayCar = car;
}

function exitGarage3D(G) {
  const view = G.garage && G.garage.view;
  if (!view || !view.active) return;
  const s = view.saved;
  if (s && s.car && s.car.mesh) {
    s.car.mesh.position.set(s.x, s.y, s.z);
    s.car.mesh.rotation.y = s.rotY;
    s.car.mesh.rotation.z = s.rotZ;
    if (s.car === view.tempCar) s.car.mesh.visible = false;
  }
  if (G.player && G.player.mesh) G.player.mesh.visible = s ? s.playerMeshVisible : true;
  if (view.group) view.group.visible = false;
  view.active = false;
  view.displayCar = null;
  view.saved = null;
  if (G.garage) G.garage.displayCar = null;
}

// Garage camera: while mode === 'garage', hold a low three-quarter shot of
// the car on the lift. The look target is offset to the camera's right so
// the car sits left of centre — the DOM upgrade panel covers the right side
// of the screen (see index.html #garage-screen). A slow sway keeps the shot
// alive without ever losing the car. main.js does not move the camera in
// garage mode, and in play mode it re-takes the camera every frame, so
// nothing needs restoring on close.
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function driveGarageCamera(G) {
  const view = G.garage && G.garage.view;
  if (!view || !view.active || !view.group || !view.group.visible) return;
  const car = view.displayCar;
  if (!car || !car.mesh) return;
  const t = performance.now() / 1000;
  const sway = Math.sin(t * 0.22) * 0.7;
  _camPos.set(GX + 8.5 + sway, 4.2, GZ + 12.0);
  _look.copy(car.mesh.position);
  _look.y += 2.0;
  _fwd.copy(_look).sub(_camPos).normalize();
  _right.crossVectors(_fwd, _up).normalize();
  _look.addScaledVector(_right, 4.2); // shift the car + sign left of frame centre
  _look.y += 0.2;
  G.camera.position.copy(_camPos);
  G.camera.lookAt(_look);
  if (G.camera.fov !== 55) {
    G.camera.fov = 55;
    G.camera.updateProjectionMatrix();
  }
}

function startGarageCameraLoop(G) {
  if (G.garage && G.garage.view && G.garage.view._loopStarted) return;
  if (G.garage && G.garage.view) G.garage.view._loopStarted = true;
  const tick = () => {
    requestAnimationFrame(tick);
    if (G.mode === 'garage') driveGarageCamera(G);
  };
  requestAnimationFrame(tick);
}

export function initGarage(G) {
  if (!G.garage) G.garage = { owned: {} };
  if (!G.garage.owned) G.garage.owned = {};
  if (!G.garage.view) G.garage.view = { group: null, active: false, displayCar: null, saved: null, tempCar: null };
  listEl = document.getElementById('garage-list');
  moneyEl = document.getElementById('garage-money');
  // Summary line under the money display (created here, index.html untouched).
  const screen = document.getElementById('garage-screen');
  if (screen && moneyEl && !$('garage-summary')) {
    summaryEl = document.createElement('div');
    summaryEl.id = 'garage-summary';
    summaryEl.style.cssText = 'color: var(--muted); font: 600 12px ui-monospace, Menlo, monospace; margin: 2px 0 10px; text-align: right;';
    moneyEl.after(summaryEl);
  } else {
    summaryEl = document.getElementById('garage-summary');
  }
  const btn = document.getElementById('btn-close-garage');
  if (btn) btn.addEventListener('click', () => closeGarage(G));
  window.addEventListener('keydown', (e) => {
    if (G.mode === 'garage' && (e.code === KEYS.garage || e.code === 'Escape')) closeGarage(G);
  });
  // main.js opens the garage via setMode('garage') directly (G key near the
  // garage), so refresh whenever the screen becomes visible, not only via
  // openGarage — and drive the 3D lift scene on the same transition.
  if (screen && typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => {
      if (!screen.classList.contains('hidden')) {
        refreshGarage(G);
        enterGarage3D(G);
      } else {
        exitGarage3D(G);
      }
    }).observe(screen, { attributes: true, attributeFilter: ['class'] });
  }
  startGarageCameraLoop(G);
  refreshGarage(G);
}

export function openGarage(G) {
  refreshGarage(G);
  enterGarage3D(G);
  if (G.setMode) G.setMode('garage');
}

export function closeGarage(G) {
  // Clear the closing keys from Input: without this, the main loop's next frame
  // would see the still-held G/Escape and reopen the garage / pause the game.
  Input.clear(KEYS.garage, KEYS.pause);
  exitGarage3D(G);
  if (G.setMode) G.setMode('play');
}

export function buyUpgrade(G, id) {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return;
  if (!G.garage) G.garage = { owned: {} };
  if (!G.garage.owned) G.garage.owned = {};
  const level = G.garage.owned[id] || 0;
  if (level >= u.max) return;
  if (!G.player || G.player.money < u.price) return;
  G.player.money -= u.price;
  G.garage.owned[id] = level + 1;
  playSFX(G, 'cash');
  refreshGarage(G);
}

function $(id) {
  return document.getElementById(id);
}
