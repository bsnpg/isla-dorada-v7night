// Screenshot staging behind ?shot=chase|title|combat|map (with &seed=N).
// Each scene is placed deterministically from the real game state — the same
// seed always gives the same frame — and the simulation stays frozen
// afterwards, so the screenshot is exactly the staged frame.
//
// REBUILD BRIEF — CHAOS, READABLE IN ONE GLANCE. The v1 shots were clean
// but quiet: a roadblock, a couple of units, no contact, no fire, no sun in
// frame. These stages fix that, self-contained (only v1 exports + THREE;
// no gameplay-builder staging hooks existed when this was written, so
// nothing here depends on them):
//   chase  — the cover: WESTBOUND into the sunset on the north coastal road,
//            sun + flare dead ahead, neon billboards, a police car RAMMING
//            the getaway car (contact), a FLIPPED police car, a
//            roadblock, a BURNING traffic car, the heli overhead, traffic +
//            peds, DRIFT x3 + NEAR MISS +$250 popups, portrait dialogue.
//   title  — bright title over a westward sunset view of Casino Row.
//   combat — a real firefight: muzzle flashes, tracers, damage numbers, a
//            DOWNED enemy close in, a burning pickup, enemies at 8-16 m.
//   map    — full city map + checklist + measured stats.
import { renderHUD, showDialogue, pushScorePopup } from './hud.js';
import { renderMinimap } from './minimap.js';
import { setWanted, spawnPoliceCar, spawnHeli } from './police.js';
import { spawnTrafficCar, spawnPed } from './traffic.js';
import { spawnEnemy, spawnDownedEnemy, explodeAt, setJetpack, spawnDamageNumber } from './combat.js';
import { dropCash, dropWeapon } from './drops.js';
import { xpNextFor, nextUnlockFor, recomputeEffects } from './progression.js';
import { startMission } from './missions.js';
import { makeCar, spawnSmoke } from './driving.js';
import { drawMap } from './map.js';
import { saveGame } from './save.js';

// ---------------------------------------------------------------- helpers
// Place the camera in a chase-cam position behind `pos`, facing `heading`.
// lookX/lookZ shift the look target sideways so the sun / skyline can be
// pulled into frame without moving the player. `lat` shifts the camera
// sideways (positive = player's right) so a centred subject can be pushed
// off the HUD's centre column.
function placeChaseCamera(G, pos, heading, dist, height, lookX, lookZ, fov, lat) {
  const backX = -Math.sin(heading), backZ = -Math.cos(heading);
  const rightX = -Math.cos(heading), rightZ = Math.sin(heading);
  const l = lat || 0;
  G.camera.position.set(
    pos.x + backX * dist + rightX * l,
    pos.y + height,
    pos.z + backZ * dist + rightZ * l,
  );
  G.camera.lookAt(
    pos.x + Math.sin(heading) * 20 + (lookX || 0),
    pos.y + 2.2,
    pos.z + Math.cos(heading) * 20 + (lookZ || 0),
  );
  G.camera.fov = fov || 62;
  G.camera.updateProjectionMatrix();
}

// Ahead / right offsets from a position + heading (heading 0 = +z south).
function offsetFrom(x, z, heading, fwd, right) {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const rx = -Math.cos(heading), rz = Math.sin(heading);
  return { x: x + fx * fwd + rx * right, z: z + fz * fwd + rz * right };
}

// Sun glow sprite near the real sun disc (main.js sky: sun at -820, 120, -260).
function addSunFlare(G, x, y, z, scale) {
  const THREE = G.three;
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(128, 128, 4, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,240,190,0.95)');
  g.addColorStop(0.25, 'rgba(255,200,90,0.55)');
  g.addColorStop(0.6, 'rgba(255,140,40,0.18)');
  g.addColorStop(1, 'rgba(255,120,30,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z);
  sprite.scale.set(scale, scale, 1);
  G.scene.add(sprite);
  return sprite;
}

// Searchlight beam: a translucent additive cone from the heli belly straight
// down to the road, plus a bright pool disc where it lands. Staging only —
// the heli already carries a real SpotLight; this is the visible beam the
// camera can read in 2 seconds. The cone is open-ended and additive, so it
// glows against dark asphalt and washes out against bright sky, like a real
// searchlight.
function addSearchlightBeam(G, x, z, height) {
  const THREE = G.three;
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xfff3b0, transparent: true, opacity: 0.28, // V5r2: was 0.20 — the cone must read against the building
    blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, fog: false,
  });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(3.5, height, 20, 1, true), coneMat);
  cone.position.set(x, height / 2, z);
  G.scene.add(cone);
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xffe9a0, transparent: true, opacity: 0.5, // V5r2: was 0.38
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(3.4, 24), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, 0.12, z);
  G.scene.add(pool);
  return { cone, pool };
}

// Neon billboard: canvas-texture plane on posts, unlit so it glows at sunset.
// Faces `faceHeading` (the direction its front points).
function addBillboard(G, x, z, faceHeading, text, color, sub) {
  const THREE = G.three;
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 160;
  const c = cv.getContext('2d');
  c.fillStyle = '#120a1e';
  c.fillRect(0, 0, 512, 160);
  c.strokeStyle = color;
  c.lineWidth = 6;
  c.strokeRect(8, 8, 496, 144);
  c.fillStyle = color;
  c.font = '800 52px system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.shadowColor = color;
  c.shadowBlur = 22;
  c.fillText(text, 256, sub ? 62 : 80);
  if (sub) {
    c.font = '700 30px system-ui, sans-serif';
    c.fillText(sub, 256, 122);
  }
  const tex = new THREE.CanvasTexture(cv);
  const group = new THREE.Group();
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 4.7),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  board.position.y = 9.5;
  group.add(board);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.7 });
  for (const px of [-5.5, 5.5]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.2, 0.5), postMat);
    post.position.set(px, 3.6, 0);
    group.add(post);
  }
  group.position.set(x, 0, z);
  group.rotation.y = faceHeading;
  G.scene.add(group);
  return group;
}

// V6 park props (staging only): a palm-lined north-shoulder park for the
// right edge of the rotated chase shot — Karimbu-beach style. The palm
// mirrors city.js (6 m trunk, 6 fronds, Euler(0, yaw, -0.55, YXZ)).
function addPalm(G, x, z, s) {
  const THREE = G.three;
  const sc = s || 1;
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16 * sc, 0.28 * sc, 6 * sc, 6),
    new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 1 }),
  );
  trunk.position.y = 3 * sc;
  group.add(trunk);
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x3a7a2a, roughness: 0.9, side: THREE.DoubleSide });
  for (let f = 0; f < 6; f++) {
    const yaw = (f / 6) * Math.PI * 2;
    const frond = new THREE.Mesh(new THREE.PlaneGeometry(2.6 * sc, 0.9 * sc), frondMat);
    frond.quaternion.setFromEuler(new THREE.Euler(0, yaw, -0.55, 'YXZ'));
    const off = new THREE.Vector3(1.3 * sc, 0, 0).applyQuaternion(frond.quaternion);
    frond.position.set(off.x, 6.2 * sc + off.y, off.z);
    group.add(frond);
  }
  group.position.set(x, 0, z);
  G.scene.add(group);
  return group;
}

// Park bench: wooden seat + backrest on iron legs, faces +z (the road)
// at ry ≈ 0.
function addBench(G, x, z, ry) {
  const THREE = G.three;
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6, metalness: 0.5 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.55), wood);
  seat.position.y = 0.45;
  group.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.1), wood);
  back.position.set(0, 0.85, -0.25);
  back.rotation.x = -0.15;
  group.add(back);
  for (const sx of [-0.7, 0.7]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.5), iron);
    leg.position.set(sx, 0.22, 0);
    group.add(leg);
  }
  group.position.set(x, 0, z);
  group.rotation.y = ry || 0;
  G.scene.add(group);
  return group;
}

// Low hedge / planter box: a solid green mass that reads at the frame
// edge where thin poles vanish behind the HUD.
function addHedge(G, x, z, len) {
  const THREE = G.three;
  const hedge = new THREE.Mesh(
    new THREE.BoxGeometry(len, 1.4, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x4a9a3a, roughness: 0.9, emissive: 0x1a3a1a, emissiveIntensity: 0.5 }),
  );
  hedge.position.set(x, 0.7, z);
  G.scene.add(hedge);
  return hedge;
}

// Cars are built with metalness 0.6 and the scene has no environment map,
// so sunlit metal reads fine but the SHADOW side of a body panel renders
// near-black (the gold GT looked like a black box from the chase camera).
// Fix per staged car (makeCar / traffic meshes own their materials — never
// call this on police cars, whose materials are shared): drop metalness,
// lift the diffuse response with a little self-coloured emissive.
function brightenCar(G, carObj) {
  if (!carObj || !carObj.mesh) return;
  carObj.mesh.traverse((o) => {
    const m = o.material;
    if (!m || !m.color || typeof m.metalness !== 'number') return;
    if (m.metalness < 0.3) return;
    const c = m.color;
    const lum = 0.3 * c.r + 0.5 * c.g + 0.2 * c.b;
    if (lum < 0.2 && m.metalness > 0.5) {
      // Cabin glass: metalness 0.8 with no env map renders pitch black.
      // Turn it into light blue-grey glass instead.
      m.metalness = 0.1;
      m.roughness = 0.2;
      m.color.setHex(0x5a7a9a);
      m.emissive.setHex(0x16283a);
      m.emissiveIntensity = 1;
      return;
    }
    if (lum < 0.12) return; // wheels, dark trim stay dark
    m.metalness = 0.15;
    m.roughness = 0.45;
    m.emissive = c.clone().multiplyScalar(0.55);
    m.emissiveIntensity = 1;
  });
  void G;
}

// Fire + smoke + light at a world position (used for burning cars).
// Flames are tall and bright (they must read at 30+ m); smoke is small,
// translucent grey puffs, never black balloons.
function addFire(G, x, z, scale) {
  const THREE = G.three;
  const s = scale || 1;
  const group = new THREE.Group();
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
  const flameMat2 = new THREE.MeshBasicMaterial({ color: 0xffd23a });
  const smokeMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a52, roughness: 1, transparent: true, opacity: 0.35,
  });
  for (const [fx, fz, h, r] of [[0, 0, 3.4, 1.0], [0.7, 0.4, 2.5, 0.7], [-0.6, -0.3, 2.8, 0.75]]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * s, h * s, 8), flameMat);
    cone.position.set(fx * s, (1.0 + h / 2) * s, fz * s);
    group.add(cone);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(r * 0.55 * s, h * 0.62 * s, 8), flameMat2);
    inner.position.set(fx * s, (0.9 + h * 0.31) * s, fz * s);
    group.add(inner);
  }
  for (const [sx, sy, sz, sr] of [[0, 5.0, 0, 0.8], [0.5, 6.2, 0.3, 1.0], [-0.4, 7.4, -0.2, 1.2]]) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(sr * s, 8, 6), smokeMat);
    puff.position.set(sx * s, sy * s, sz * s);
    group.add(puff);
  }
  const light = new THREE.PointLight(0xff6a00, 120, 40, 1.6);
  light.position.set(0, 2.2 * s, 0);
  group.add(light);
  group.position.set(x, 0, z);
  G.scene.add(group);
  return group;
}

// Char a car mesh (traffic / makeCar meshes own their materials) and set it
// alight. Returns the flame group.
function igniteCar(G, carObj, scale) {
  if (!carObj || !carObj.mesh) return null;
  carObj.mesh.traverse((o) => {
    if (o.material && o.material.color && o.material.emissive === undefined) {
      o.material.color.multiplyScalar(0.35);
    } else if (o.material && o.material.color) {
      o.material.color.multiplyScalar(0.45);
    }
  });
  carObj.mesh.rotation.z = 0.1;
  const p = carObj.mesh.position;
  return addFire(G, p.x, p.z, scale || 1);
}

// Flip a freshly spawned police car onto its roof (wheels up, light bar up).
// `air` lifts it into a mid-flip tumble in the air: { y, pitch, roll }.
function flipPoliceCar(G, x, z, heading, air) {
  const unit = spawnPoliceCar(G, x, z, heading);
  unit.mesh.position.y = air ? air.y : 1.05;
  unit.mesh.rotation.set(air ? (air.pitch || 0) : 0, heading, air ? air.roll : Math.PI * 0.92);
  unit.status = 'FLIPPED';
  addFire(G, x + 1.5, z + 1, air ? 0.7 : 0.45); // bigger smoke/fire when airborne
  return unit;
}

// V4 staging (recording #16): pose a spawned ped as a RUNNING / fleeing
// figure. The shot sim is frozen (main.js never starts the game loop), so
// the pose persists exactly — updateTraffic never runs to overwrite it.
// `heading` is the run direction (0=south/+z, PI/2=east/+x, -PI/2=west/-x,
// PI=north/-z). `panic` throws both arms up instead of pumping them.
// `sprint` is the wider, harder-leaning stride for the CLOSEST figures —
// the standard pose is subtle at 30 px, and the foreground runners have
// to read as sprinting in 2 seconds, not strolling.
function poseRunPed(ped, heading, panic, sprint) {
  if (!ped || !ped.mesh) return ped;
  const u = ped.mesh.userData;
  if (panic) {
    if (u.armL) u.armL.rotation.x = -2.6;
    if (u.armR) u.armR.rotation.x = -2.6;
    if (u.legL) u.legL.rotation.x = 0.6;
    if (u.legR) u.legR.rotation.x = -0.6;
  } else if (sprint) {
    if (u.legL) u.legL.rotation.x = 1.05;
    if (u.legR) u.legR.rotation.x = -1.05;
    if (u.armL) u.armL.rotation.x = -0.9;
    if (u.armR) u.armR.rotation.x = 0.9;
  } else {
    if (u.legL) u.legL.rotation.x = 0.85;
    if (u.legR) u.legR.rotation.x = -0.85;
    if (u.armL) u.armL.rotation.x = -0.75;
    if (u.armR) u.armR.rotation.x = 0.75;
  }
  ped.mesh.rotation.x = sprint ? 0.16 : 0.10; // forward lean
  ped.mesh.rotation.y = heading;
  ped.mesh.position.y = sprint ? 0.14 : 0.10; // airborne mid-stride
  return ped;
}

// V4 staging (recording #16), round 5 — DAY/NIGHT AS CLOCK-DRIVEN PRESETS.
// A full live day/night cycle in game code would need edits to sky.js /
// main.js, which are PRE-cut files (the dossier has 37 bytes of headroom),
// so the day/night system lives here as staging presets driven by the
// shot's clock: each stageShot sets G.stats.playSeconds to the matching
// time AND applies the matching sky preset, so clock and lighting are
// always consistent. This is NOT a live advancing cycle in the game code.
// Modes: morning 06:00-11:59 (soft golden), afternoon 12:00-16:59 (bright
// blue), evening 17:00-19:59 (orange sunset = the locked cover formula),
// night 20:00-05:59 (dark + moon + street lights).
function restageSky(G, mode) {
  const THREE = G.three;
  const sky = G.sky || {};
  let dome = null, hemi = null, fill = null;
  G.scene.traverse((o) => {
    if (o.material && o.material.isShaderMaterial && o.material.uniforms
      && o.material.uniforms.top && o.material.uniforms.low) dome = o;
    if (o.isHemisphereLight) hemi = o;
    if (o.isDirectionalLight && o !== sky.sunLight) fill = o;
  });
  const setDome = (top, upper, mid, low) => {
    if (!dome) return;
    const u = dome.material.uniforms;
    u.top.value.set(top); u.upper.value.set(upper);
    u.mid.value.set(mid); u.low.value.set(low);
  };
  const setHemi = (s, g, i) => { if (hemi) { hemi.color.setHex(s); hemi.groundColor.setHex(g); hemi.intensity = i; } };
  const setFill = (c, i) => { if (fill) { fill.color.setHex(c); fill.intensity = i; } };
  const setSunLight = (x, y, z, c, i) => {
    const s = sky.sunLight;
    if (s) { s.position.set(x, y, z); s.color.setHex(c); s.intensity = i; }
  };
  const setFog = (c) => { if (G.scene.fog) G.scene.fog.color.setHex(c); };
  const setClouds = (op) => {
    if (sky.clouds) for (const cl of sky.clouds) if (cl.material) cl.material.opacity = op;
  };
  const hideSunParts = () => {
    for (const p of [sky.sun, sky.sunCore, sky.glow, sky.streak]) if (p) p.visible = false;
    if (sky.flareDots) for (const d of sky.flareDots) d.visible = false;
  };
  const placeSun = (x, y, z, coreHex, discHex, glowHex, glowScale) => {
    if (sky.sun) { sky.sun.visible = true; sky.sun.position.set(x, y, z); sky.sun.lookAt(0, 40, 0); sky.sun.material.color.setHex(discHex); }
    if (sky.sunCore) { sky.sunCore.visible = true; sky.sunCore.position.set(x, y, z); sky.sunCore.lookAt(0, 40, 0); sky.sunCore.material.color.setHex(coreHex); }
    if (sky.glow) { sky.glow.visible = true; sky.glow.position.set(x, y, z); sky.glow.material.color.setHex(glowHex); sky.glow.scale.set(glowScale, glowScale, 1); }
    if (sky.streak) sky.streak.visible = false;
    if (sky.flareDots) for (const d of sky.flareDots) d.visible = false;
  };
  const moon = () => {
    let m = G.scene.getObjectByName('v4-moon');
    if (!m) {
      m = new THREE.Mesh(new THREE.CircleGeometry(26, 24),
        new THREE.MeshBasicMaterial({ color: 0xf0f0e8, fog: false }));
      m.name = 'v4-moon';
      G.scene.add(m);
    }
    m.visible = true;
    m.position.set(180, 180, -80); // high north, in the combat frame's sky
    m.lookAt(0, 40, 0);
    return m;
  };
  if (mode === 'morning') {
    setDome(0x6a8ac8, 0xa8c8e8, 0xe8d8a8, 0xf8e8c8);
    placeSun(-600, 200, -350, 0xfff2c8, 0xffe8a0, 0xffe8b0, 420);
    setFog(0xd8c8a8); setHemi(0xffe8c8, 0x6a7a6a, 1.0);
    setSunLight(-200, 300, -100, 0xffe0a8, 2.2); setFill(0x8aa8d8, 0.45); setClouds(0.9);
  } else if (mode === 'afternoon') {
    setDome(0x2a6ac8, 0x6ab8e8, 0xa8d8f0, 0xe8f0f8);
    // V5 F6: sun disc moved off the subtitle line — V4 sun (-450,300,-400)
    // projected to (671,115), dead behind "8 JOBS TO CLEAR HIS NAME".
    // New sun (-600,300,0) projects to ~(270,80): clear of title/subtitle/
    // quote, just above the WOWO card; glow shrunk 380 -> 260 so its soft
    // halo only grazes the card top.
    placeSun(-600, 330, 0, 0xfffbe8, 0xfff2b0, 0xfff8d8, 100); // V5r3: glow was 180 — its halo still washed the WOWO card; sun y 300->330 lifts the disc clear of the card top
    // V5r2: shrink the disc itself (0.65x) — at full size it read as a big
    // pale moon over the WOWO card instead of a sun.
    if (sky.sun) sky.sun.scale.setScalar(0.65);
    if (sky.sunCore) sky.sunCore.scale.setScalar(0.65);
    setFog(0xbcd8e8); setHemi(0xcfe8ff, 0x8a9a8a, 1.3); // V5 F7: was 1.15
    setSunLight(200, 400, 150, 0xfff2d8, 2.8); setFill(0x9ab8e8, 0.7); setClouds(0.9); // V5 F7: fill was 0.5
  } else if (mode === 'night') {
    setDome(0x0a0a20, 0x1a1a3a, 0x2a1a4a, 0x3a1a3a);
    hideSunParts(); moon();
    setFog(0x0a0a18); setHemi(0x2a2a4a, 0x1a1a2a, 0.35);
    setSunLight(200, 400, 150, 0x8a8ab8, 0.5); setFill(0x3a4a7a, 0.25); setClouds(0.25);
  } else if (mode === 'lowpoly') {
    // V7 — clean bright low-poly morning: light warm-blue zenith, warm
    // cream horizon, high warm sun, strong warm bounce so no face of the
    // city goes muddy. Same sky rig as the other presets (dome uniforms,
    // sun disc/glow, fog, hemi, sun light, fill) — only the values change,
    // so the locked cover composition (sun in frame, skyline, sea) survives
    // while the mood flips from dusk drama to warm and neat.
    setDome(0x6fb3e8, 0xa8d8f0, 0xffe8b8, 0xffd28a);
    placeSun(-700, 280, -320, 0xfffbe8, 0xffe8a0, 0xffe8b0, 380);
    setFog(0xffe0b8); setHemi(0xfff2d8, 0x9a8a6a, 1.6);
    setSunLight(-200, 380, -100, 0xfff2d8, 3.0); setFill(0x9ab8e8, 0.6); setClouds(0.9);
  } else { // 'evening' — the locked sunset formula: restore buildSky defaults
    setDome(0x2a2a5e, 0x8a3a6e, 0xe8763a, 0xffb347);
    placeSun(-800, 95, -320, 0xfff6d8, 0xffd27a, 0xffc27a, 560);
    if (sky.streak) { sky.streak.visible = true; sky.streak.position.set(-800, 95, -320); }
    setFog(0xe08a4a); setHemi(0xffc890, 0x4a3a5a, 0.9);
    setSunLight(-260, 150, -130, 0xffb36b, 2.4); setFill(0x5a6ab8, 0.4); setClouds(0.85);
  }
}

// V7 — low-poly restyle pass (staging only). The game itself is unchanged:
// this traverses the STAGED scene once, after every staged mesh exists, and
// (a) switches every standard material to flat shading so the boxy city,
// cars and figures read as crisp low-poly facets, (b) caps metalness — with
// no environment map, metal renders near-black — and lifts matte roughness
// so surfaces read as clean matte toy plastic, never muddy. Glass and water
// (already glossy, roughness < 0.3) are left alone, and colours/emissives
// are never touched — the bright warm palette comes from the lowpoly sky
// preset, not from repainting. Shared materials mutate in place on purpose:
// one material colours every mesh that uses it, so the whole city changes
// in one pass. The shot sim is frozen, so nothing here leaks into live play.
function applyLowPoly(G) {
  const seen = new Set();
  G.scene.traverse((o) => {
    const m = o.material;
    if (!m || seen.has(m)) return;
    seen.add(m);
    if (!m.isMeshStandardMaterial) return;
    m.flatShading = true;
    m.metalness = Math.min(m.metalness, 0.15);
    if (m.roughness >= 0.3) m.roughness = Math.max(m.roughness, 0.85);
    m.needsUpdate = true;
  });
}

// Digital clock panel (staging DOM, shots.js only). The HUD already has
// #game-clock (fmtClock: DAY 1 18:36 from playSeconds); this restyles it
// into a prominent digital panel — big mono time, an English period label
// (MORNING / AFTERNOON / EVENING / NIGHT) and a sun/moon icon riding a
// small arc track: morning = low left (rising), noon = high centre-top,
// evening = low right (setting), night = moon. Pure CSS shapes, no assets.
// Called AFTER renderHUD (which overwrites the clock text). The taller
// panel pushes #weapon-panel down, so #prog-panel (absolute, top 182px)
// is pushed down by the same amount to avoid overlap.
function buildClockPanel(G, timeStr, hours, day, mode) {
  const night = hours < 6 || hours >= 20;
  const label = night ? 'NIGHT'
    : hours < 12 ? 'MORNING' : hours < 17 ? 'AFTERNOON' : 'EVENING';
  // Arc position: day fraction f = (hours-6)/12 (06:00 left -> 18:00 right);
  // night fraction m = hours since 20:00 / 10. Top is a parabola peaking
  // at mid-arc; left is clamped so the 34 px icon stays on the 64 px track.
  const f = night ? ((hours - 20 + 24) % 24) / 10 : Math.min(1, Math.max(0, (hours - 6) / 12));
  const left = (14 + f * 72).toFixed(1);
  const top = (2 + (1 - 4 * f * (1 - f)) * 14).toFixed(1);
  const icon = night
    ? `<div style="position:absolute;left:${left}%;top:${top}px;transform:translate(-50%,-50%);width:32px;height:32px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#f4f4ff,#c8c8e8 70%,#9a9ac8);box-shadow:0 0 14px 4px rgba(200,200,255,0.45)"><div style="position:absolute;left:18px;top:6px;width:8px;height:8px;border-radius:50%;background:rgba(120,120,160,0.55)"></div></div>`
    : `<div style="position:absolute;left:${left}%;top:${top}px;transform:translate(-50%,-50%);width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff6d8,#ffb347 55%,#ff7a2a);box-shadow:0 0 16px 5px rgba(255,180,80,0.55)"></div>`;
  const html = `<div style="display:flex;align-items:center;gap:12px;background:rgba(10,14,22,0.88);border:1px solid #f2c230;border-radius:8px;padding:8px 12px;text-align:left">`
    + `<div><div style="font:800 30px ui-monospace,Menlo,monospace;color:#f5efe0;letter-spacing:1px;line-height:1">${timeStr}</div>`
    + `<div style="font:700 12px system-ui,sans-serif;color:#f2c230;letter-spacing:2px;margin-top:5px">${label} · DAY ${day}</div></div>`
    + `<div style="position:relative;width:64px;height:48px;flex:none"><div style="position:absolute;left:2px;right:2px;bottom:2px;height:22px;border:1px dashed rgba(245,239,224,0.35);border-bottom:none;border-radius:30px 30px 0 0"></div>${icon}</div></div>`;
  if (mode === 'title') {
    // The title screen has no HUD clock — the panel rides as a fixed chip
    // top-right over the title screen (same panel, same styling).
    let chip = document.getElementById('v4-clock-chip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'v4-clock-chip';
      chip.style.cssText = 'position:fixed;top:12px;right:12px;z-index:50;';
      document.body.appendChild(chip);
    }
    chip.innerHTML = html;
    return;
  }
  const el = document.getElementById('game-clock');
  if (!el) return;
  el.innerHTML = html;
  el.style.marginTop = '4px';
  // Push #prog-panel (absolute, top 182px) below the taller clock +
  // weapon panel so nothing overlaps.
  const wp = document.getElementById('weapon-panel');
  const pp = document.getElementById('prog-panel');
  if (wp && pp) pp.style.top = `${wp.getBoundingClientRect().bottom + 12}px`;
  void G;
}

// HAWK-1 must read, not silhouette: the heli body is light grey (0xe8e8e8)
// but backlit against the sunset it renders as a dark shape, and the rotor
// (0x111111) is invisible. Clone + recolour per mesh (MAT is shared across
// units — never mutate it in place) and add a warm rim light on the camera
// side so the body reads light blue-white with a visible rotor.
function brightenHeli(G, heli) {
  const THREE = G.three;
  if (!heli || !heli.mesh) return;
  heli.mesh.traverse((o) => {
    const m = o.material;
    if (!m || !m.color) return;
    const hex = m.color.getHex();
    o.material = m.clone();
    if (hex === 0xe8e8e8) { // body + tail
      o.material.color.setHex(0xd8ecff);
      o.material.emissive.setHex(0x8fb8e8);
      o.material.emissiveIntensity = 0.6;
    } else if (hex === 0x111111) { // main + tail rotor
      o.material.color.setHex(0x4a5568);
      o.material.emissive.setHex(0x2a3448);
      o.material.emissiveIntensity = 0.8;
    } else if (hex === 0x22262e) { // fin + skids
      o.material.color.setHex(0x3a4a5a);
      o.material.emissive.setHex(0x1a2a3a);
      o.material.emissiveIntensity = 0.5;
    } else if (hex === 0x1a2a3a) { // nose glass
      o.material.color.setHex(0x3a6a8a);
      o.material.emissive.setHex(0x1a3a5a);
      o.material.emissiveIntensity = 0.6;
    }
  });
  // Warm rim light on the camera (east) side of the heli, below it — lifts
  // the shadow-side body out of the sunset backlight.
  const rim = new THREE.PointLight(0xffe8c0, 90, 26, 1.6);
  const p = heli.mesh.position;
  rim.position.set(p.x + 8, p.y - 4, p.z + 3);
  G.scene.add(rim);
}

// Wowo bigger / more contrast: the brown jacket (0x6a4a2a) reads near-black
// in shadow, and the jetpack tanks vanish against the sky. Clone each
// distinct material once (the jacket is shared torso+arms) and lift it with
// self-coloured emissive so the figure reads as a PERSON, not a silhouette.
function brightenWowo(G) {
  if (!G.player || !G.player.mesh) return;
  const seen = new Map();
  G.player.mesh.traverse((o) => {
    const m = o.material;
    if (!m || !m.color) return;
    if (!seen.has(m)) {
      const c = m.clone();
      const hex = m.color.getHex();
      if (hex === 0x6a4a2a) { c.emissive.setHex(0x6a4a2a); c.emissiveIntensity = 0.3; } // jacket (V7-night: 0.7 glowed cream-white at night, hid the brown)
      else if (hex === 0xd9a077) { c.emissive.setHex(0xd9a077); c.emissiveIntensity = 0.35; } // skin
      else if (hex === 0x8a8f96) { c.color.setHex(0xaab0b8); c.emissive.setHex(0x4a5568); c.emissiveIntensity = 0.6; } // tanks
      else if (hex === 0xd86a20) { c.emissive.setHex(0xd86a20); c.emissiveIntensity = 0.8; } // bands
      seen.set(m, c);
    }
    o.material = seen.get(m);
  });
}

// Night street lights: warm point lights above the sidewalks so the road,
// the fleeing peds and the police cars read at night (no visible fixtures —
// the warm pools on the asphalt sell the street lighting).
function addStreetLights(G, spots) {
  const THREE = G.three;
  for (const [x, z] of spots) {
    const l = new THREE.PointLight(0xffb36b, 80, 28, 1.8);
    l.position.set(x, 6, z);
    G.scene.add(l);
  }
}

// V5: crates + barrels — simple bright boxes/cylinders so a staged
// foreground reads as a lived-in street, not empty grass.
function addCrates(G, spots) {
  const THREE = G.three;
  const crateCols = [0xd86a20, 0x4f8ff7, 0x7ec850];
  spots.forEach(([x, z], i) => {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.85, 0.85), // V5r2: was 1.1 — the crates loomed as giant abstract blocks
      new THREE.MeshStandardMaterial({ color: crateCols[i % 3], roughness: 0.8 }),
    );
    crate.position.set(x, 0.43, z);
    crate.rotation.y = i * 0.7;
    G.scene.add(crate);
  });
  // Two barrels beside the crates.
  for (const [x, z] of [
    [spots[0][0] + 1.6, spots[0][1] + 0.8],
    [spots[1][0] - 1.5, spots[1][1] + 1.0],
  ]) {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 1.0, 12), // V5r2: was r 0.55 / h 1.3
      new THREE.MeshStandardMaterial({ color: 0x2a6a8a, roughness: 0.6, metalness: 0.3 }),
    );
    barrel.position.set(x, 0.5, z);
    G.scene.add(barrel);
  }
}

// Muzzle flash sphere + light at `from`, and a bright tracer line to `to`.
function fireBurst(G, from, to) {
  const THREE = G.three;
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe08a }),
  );
  flash.position.copy(from);
  G.scene.add(flash);
  const light = new THREE.PointLight(0xffc860, 50, 16, 1.8);
  light.position.copy(from);
  G.scene.add(light);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    from.x, from.y, from.z, to.x, to.y, to.z,
  ]), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a }));
  G.scene.add(line);
  return { flash, light, line };
}

// ---------------------------------------------------------------- chase (cover)
function stageChase(G) {
  G.setMode('play');
  // WESTBOUND on the north coastal road (z = -280), driving INTO the sunset:
  // the sun disc sits almost dead ahead, sea ahead-left, Casino Row skyline
  // on the left. Player heading -PI/2 -> forward (-1, 0) = west.
  const PX = -140, PZ = -280, H = -Math.PI / 2;
  const car = makeCar(G, 'Aurea GT', PX, PZ, H);
  brightenCar(G, car); // gold must read gold from the shadow side too
  // V5r6 — PRIORITY #1 (C1): DRIVING moment, not on-foot. Staging CAN do
  // it: enterCar has no proximity/mode gate (driving.js:353) — it only
  // needs a non-flipped, non-wrecked car. car.speed = 31 -> HUD
  // 112 KM/H (31 x 3.6 = 111.6 -> 112), vehicle name "Aurea GT",
  // radio badge on, chase cam behind the GT (player.pos = car pos).
  // Price, stated plainly: enterCar hides the player mesh and the
  // "E — STEAL CAR" prompt only renders on foot, so the v4 car-steal
  // moment is REPLACED by the driving moment — the parent explicitly
  // prioritised C1 (0 km/h vs Karimbu 111 / GHK 113) over it. The GT is
  // the driven car now, so it is NOT pushed to parked.
  car.speed = 31;
  G.enterCar(car);
  G.player.money = 38420;
  G.player.health = 100;
  G.player.armour = 50;
  // V7: clock drives the sky preset — MORNING 09:48, the low-poly look
  // (bright, warm, clean). Composition is V6's, only the light changes.
  G.stats.playSeconds = 0;
  restageSky(G, 'lowpoly');
  // V3-6: nitro owned so the gauge reads NITRO READY, not NOT INSTALLED.
  if (!G.garage) G.garage = { owned: {} };
  if (!G.garage.owned) G.garage.owned = {};
  G.garage.owned.nitro = 1;

  // Sun flare right where the chase is heading (V7: rides the low-poly
  // sun's higher position).
  addSunFlare(G, -700, 280, -320, 300);
  // Neon billboards lining the road — pink casino sign (south side, facing
  // north toward the road) and a cyan island sign (north side, facing south).
  addBillboard(G, -184, -270, Math.PI, 'CASINO DORADA', '#ff5ad9', '★ OPEN ALL NIGHT ★');
  addBillboard(G, -168, -290.5, 0, 'ISLA DORADA', '#4fd9ff', '★ GOLDEN ISLAND ★');

  // IDPD with CONTACT: one unit ramming the player's FRONT quarter — angled
  // in from the north side, nose at the GT's front corner, far enough from
  // the chase camera to read as a car instead of a wall — one FLIPPED on its
  // roof ahead-left, one roadblock head-on ahead, heli overhead.
  setWanted(G, 4);
  const ram = spawnPoliceCar(G, PX - 6, PZ - 2, H + 2.8);
  ram.status = 'RAMMING';
  // V3-1: the flipped unit is the CENTRE of the cover — caught mid-flip in
  // the air directly ahead of the GT (not a background wreck).
  const flipped = flipPoliceCar(G, PX - 8, PZ + 1.5, H + 0.5, { y: 2.2, pitch: 0.35, roll: Math.PI * 0.65 });
  // V3 density: a SECOND flipped unit mid-tumble ahead-right, also airborne
  // and burning — the street reads as a pile-up, not a single stunt.
  const flipped2 = flipPoliceCar(G, PX - 26, PZ - 3.5, H + 0.4, { y: 1.8, pitch: 0.5, roll: Math.PI * 0.7 });
  const block = spawnPoliceCar(G, PX - 52, PZ - 1.5, -H);
  block.status = 'ROADBLOCK';
  // V6 (user 19 Nov ~19:56-19:57) — the V5 heli sat ON the green
  // building's face and read as flying INTO it, side-on. Now: over the
  // road in OPEN SKY, clear of every building edge, FRONT-FACING (nose
  // toward the camera, not side-on). spawnHeli's nose is local +z, so
  // rotation.y ≈ 1.69 points the nose east at the camera (probe B30H2:
  // nose/tail screen points collapse to ~3 px apart = foreshortened).
  // 1.6x scale + closer (38 m from the GT) so it reads as a helicopter,
  // not a dark speck. Beam + pool move with it (over the road now).
  const heli = spawnHeli(G, PX - 38, PZ, 11);
  addSearchlightBeam(G, PX - 38, PZ, 11);
  brightenHeli(G, heli); // V4: light blue-white body + visible rotor, never a silhouette
  heli.mesh.scale.setScalar(1.6);
  heli.mesh.rotation.y = 1.69; // front-facing: nose toward the camera
  G.police.units = [
    { name: 'UNIT 23', dist: 5, status: 'RAMMING', mesh: ram.mesh },
    { name: 'UNIT 12', dist: 8, status: 'FLIPPED', mesh: flipped.mesh },
    { name: 'UNIT 41', dist: 26, status: 'FLIPPED', mesh: flipped2.mesh },
    { name: 'UNIT 07', dist: 52, status: 'ROADBLOCK', mesh: block.mesh },
    { name: 'HAWK-1', dist: 38, status: 'SEARCHLIGHT', mesh: heli.mesh },
    { name: 'UNIT 31', dist: 210, status: 'PURSUIT', mesh: null },
  ];

  // Enemy drops on the asphalt (recording #10): the flipped unit threw its
  // officer out — he is down on the north shoulder, his cash stack and his
  // SMG lying beside him, glowing green and gold. Kept on the road's north
  // edge, right of the popup stack and clear of the flipped car, so the loot
  // reads at a glance. The cover moment (the airborne flipped car over the
  // GT) is untouched.
  spawnDownedEnemy(G, PX - 10, PZ - 8.2, 'gunman');
  dropCash(G, PX - 8, PZ - 7.6, 250);
  dropWeapon(G, PX - 12.5, PZ - 7.8, 1); // SMG +30
  pushScorePopup(G, '+30', 'cash', 'SMG AMMO PICKED UP');

  // A BURNING traffic car ahead on the right shoulder, plus live traffic
  // ahead (one oncoming) and pedestrians on both sidewalks.
  const burning = spawnTrafficCar(G, PX - 38, PZ, H, 'Palma Cruiser');
  igniteCar(G, burning, 1.15);
  const t1 = spawnTrafficCar(G, PX - 66, PZ, H, 'Solano S');
  const t2 = spawnTrafficCar(G, PX - 95, PZ, -H, 'Marina Taxi'); // oncoming, headlights at us
  const t3 = spawnTrafficCar(G, PX - 78, PZ, H, 'Cayo Coupe');
  brightenCar(G, t1);
  brightenCar(G, t2);
  brightenCar(G, t3);
  // V3-4: one oncoming car + one ped close to the camera so the street reads alive.
  const t4 = spawnTrafficCar(G, PX - 16, PZ - 6, -H, 'Solano S');
  brightenCar(G, t4);
  // V3 density: fuller street — another westbound car past the roadblock,
  // another oncoming car far ahead, and a car crossing the x=-200 junction
  // so the cross street reads alive too.
  const t5 = spawnTrafficCar(G, PX - 108, PZ, H, 'Palma Cruiser');
  const t6 = spawnTrafficCar(G, PX - 120, PZ, -H, 'Solano S');
  const t7 = spawnTrafficCar(G, -200, -240, 0, 'Cayo Coupe');
  brightenCar(G, t5);
  brightenCar(G, t6);
  brightenCar(G, t7);
  spawnPed(G, PX - 14, PZ + 8);
  spawnPed(G, PX - 22, PZ - 8);
  spawnPed(G, PX - 44, PZ + 8);
  spawnPed(G, PX - 58, PZ - 8);
  spawnPed(G, PX - 10, PZ + 8);
  // V3 density: more peds on both sidewalks down the whole visible street.
  spawnPed(G, PX - 30, PZ + 8);
  spawnPed(G, PX - 36, PZ - 8);
  spawnPed(G, PX - 50, PZ + 8);
  spawnPed(G, PX - 70, PZ - 8);
  spawnPed(G, PX - 88, PZ + 8);
  spawnPed(G, PX - 6, PZ - 8);
  spawnPed(G, PX - 2, PZ - 7.5);
  spawnPed(G, PX - 18, PZ + 7.5);
  spawnPed(G, PX - 40, PZ - 7.5);

  // V4 staging (recording #16), round 2: every runner is PINNED to an
  // explicit spot. Round 1 relied on spawnPed's random sidewalk side and
  // the probe (window.__G) showed why that fails here: the camera sits
  // ON the north sidewalk line (z=-288), so every north-sidewalk figure
  // at any x projects to the same screen x (~765) — the runners piled
  // into one unreadable column. The south sidewalk and the road spread
  // across the frame instead, so the crowd lives there; the panicker
  // moves to the south sidewalk too (big, facing the flipped unit,
  // arms up) for the same reason — the north-sidewalk column buries it.
  // Spawn x values sit >=2 m from every walker x so no two figures
  // share a spot; the crossing pair is pinned onto the asphalt (clear
  // of the GT at PX-1 and the flipped units at PX-8/PX-26).
  const W = -Math.PI / 2; // fleeing west, away from the pile-up
  const E = Math.PI / 2; // east, toward the camera
  const panic = poseRunPed(spawnPed(G, PX - 12, PZ + 8), Math.PI, true);
  panic.mesh.position.set(PX - 12, 0.10, PZ + 8.5); // south sidewalk, arms up at the flipped unit
  const sr1 = poseRunPed(spawnPed(G, PX - 18, PZ + 8), W, false, true);
  sr1.mesh.position.set(PX - 18, 0.10, PZ + 8.5); // sprint — closest runner
  const sr2 = poseRunPed(spawnPed(G, PX - 26, PZ + 8), E, false, true);
  sr2.mesh.position.set(PX - 26, 0.10, PZ + 8.5); // sprint — toward the camera
  const sr3 = poseRunPed(spawnPed(G, PX - 34, PZ + 8), W);
  sr3.mesh.position.set(PX - 34, 0.10, PZ + 8.5);
  const sr4 = poseRunPed(spawnPed(G, PX - 42, PZ + 8), W);
  sr4.mesh.position.set(PX - 42, 0.10, PZ + 8.5);
  const sr5 = poseRunPed(spawnPed(G, PX - 50, PZ + 8), W);
  sr5.mesh.position.set(PX - 50, 0.10, PZ + 8.5);
  const sr6 = poseRunPed(spawnPed(G, PX - 60, PZ + 8), W);
  sr6.mesh.position.set(PX - 60, 0.10, PZ + 8.5);
  const sr7 = poseRunPed(spawnPed(G, PX - 68, PZ + 8), E);
  sr7.mesh.position.set(PX - 68, 0.10, PZ + 8.5);
  const sr8 = poseRunPed(spawnPed(G, PX - 74, PZ + 8), W);
  sr8.mesh.position.set(PX - 74, 0.10, PZ + 8.5); // far west depth
  const cross1 = poseRunPed(spawnPed(G, PX - 30, PZ - 8), Math.PI);
  cross1.mesh.position.set(PX - 30, 0.10, PZ); // mid-crossing, northbound
  const cross2 = poseRunPed(spawnPed(G, PX - 42, PZ - 8), Math.PI);
  cross2.mesh.position.set(PX - 42, 0.10, PZ); // mid-crossing, northbound
  // V4 round 4 (top-5 bar): two MORE crossing peds, CLOSER to the camera
  // than the first pair — side profile, sprint pose, right in front of
  // the flipped unit, so the fleeing reads in the first glance, not at
  // 30 px down the street. Clear of the GT (PX-1), the ram unit (PX-6)
  // and the flipped unit (PX-8, 6 m east of cross3).
  const cross3 = poseRunPed(spawnPed(G, PX - 14, PZ - 8), Math.PI, false, true);
  cross3.mesh.position.set(PX - 14, 0.10, PZ); // mid-crossing, northbound, sprint
  const cross4 = poseRunPed(spawnPed(G, PX - 20, PZ - 8), Math.PI, false, true);
  cross4.mesh.position.set(PX - 20, 0.10, PZ); // mid-crossing, northbound, sprint
  const nr1 = poseRunPed(spawnPed(G, PX - 62, PZ - 8), W);
  nr1.mesh.position.set(PX - 62, 0.10, PZ - 8.5); // north sidewalk, far depth

  // V5 F1: fill the dead bottom-right (north-shoulder grass + minimap
  // zone). Probe: (-142,1,-291) -> (943,496) — a car there reads
  // right-of-centre above the minimap instead of empty grass. Two fleeing
  // peds on the north sidewalk give the corner life without touching the
  // beam pool.
  const t8 = spawnTrafficCar(G, PX - 10, PZ - 11, H, 'Cayo Coupe'); // V5r3: was (PX-2, PZ-11) — moved west to make room for the foreground grass car below
  brightenCar(G, t8);
  const nrf1 = poseRunPed(spawnPed(G, PX - 16, PZ - 9), W);
  nrf1.mesh.position.set(PX - 16, 0.10, PZ - 9); // north sidewalk, fleeing west
  const nrf2 = poseRunPed(spawnPed(G, PX - 24, PZ - 9), W);
  nrf2.mesh.position.set(PX - 24, 0.10, PZ - 9); // north sidewalk, fleeing west

  // V6 PARK (user 19 Nov ~19:56): fill the right edge (north shoulder,
  // which the ~30° camera rotation swings to the frame's right) with a
  // palm-lined park — palms, hedges, benches — Karimbu-beach style.
  // CHAOS IS KEPT (user 19 Nov ~19:58): no runner is removed anywhere;
  // the park ADDS five more fleeing peds. Round 1 (palms z -293..-296,
  // scale 1.0) probed almost invisible — trunks thin at the frame edge,
  // fronds + lamp heads hidden behind the HUD panel (sx 1040-1270,
  // sy 230-370). Round 2 (1.5x, z -291..-292) still read weak: fronds
  // split by the panel, hedges too dark/small. Round 3: palms 2.0x
  // (12 m — fronds land in the visible band between the clock panel and
  // the IDOLS panel, sy ~130-190), hedges 7 m x 1.4 m in bright lit
  // green below the panel, lamps dropped (heads would sit behind the
  // panel). Clear of the t8 grass car (-150,-291).
  addPalm(G, -156, -291, 2.0);
  addPalm(G, -166, -292, 2.0);
  addPalm(G, -176, -291, 2.0);
  addPalm(G, -186, -292, 2.0);
  addPalm(G, -196, -293, 2.0);
  addHedge(G, -163, -292, 7);
  addHedge(G, -178, -292, 7);
  addHedge(G, -193, -293, 7);
  addBench(G, -168, -291.5, 0.1);
  addBench(G, -188, -292.5, -0.1);
  const pk1 = poseRunPed(spawnPed(G, -162, -291), W, false, true);
  pk1.mesh.position.set(-162, 0.10, -291.5); // park runner, sprint west
  const pk2 = poseRunPed(spawnPed(G, -172, -291.5), W, false, true);
  pk2.mesh.position.set(-172, 0.10, -291.5); // park runner, sprint west
  const pk3 = poseRunPed(spawnPed(G, -186, -292), W);
  pk3.mesh.position.set(-186, 0.10, -292.5); // park runner, fleeing west
  const pk4 = poseRunPed(spawnPed(G, -196, -292), W, false, true);
  pk4.mesh.position.set(-196, 0.10, -292.5); // park runner, sprint west
  const pk5 = poseRunPed(spawnPed(G, -158, -290.5), W, false, true);
  pk5.mesh.position.set(-158, 0.10, -290.5); // park runner, sprint west, road edge

  // V3 density: a second downed officer on the south shoulder with his own
  // loot — the flipped units threw two men out, not one.
  spawnDownedEnemy(G, PX - 18, PZ + 7.6, 'heavy');
  dropCash(G, PX - 16, PZ + 7.0, 350);
  dropWeapon(G, PX - 20.5, PZ + 7.2, 3); // Rifle +30

  // Mission 4, stage 2, timer 2:06 — the long Causeway chase.
  startMission(G, 3);
  G.missions.stage = 2;
  G.missions.stageCount = 3;
  G.missions.timer = 126;
  G.missions.objective = 'Deliver the evidence across the Causeway — outrun the IDPD';
  G.combat.weaponIndex = 1; // SMG in the rack
  G.audio.radioIndex = 0;
  showDialogue(G, 'WOWO', 'They will never take me alive. Not on my island.', 60000);
  // V5r6: no brightenWowo — the player mesh is hidden in the car.
  // The warm key light stays: it now keys the driven GT + road from the
  // camera side so the gold GT reads gold, not a black box.
  const THREE = G.three;
  const wowoLight = new THREE.PointLight(0xffc27a, 120, 14, 1.6); // V5r2: was 70
  wowoLight.position.set(PX + 4, 3, PZ - 5);
  G.scene.add(wowoLight);
  // Chase cam behind the DRIVEN GT (player.pos = car pos after enterCar):
  // GT big in the foreground, flipped units, roadblock, heli and sunset
  // ahead. V4: dist 8.5 (was 10.5). V5: dist 7.5 — GT bigger still.
  placeChaseCamera(G, G.player.pos, H, 7.5, 4.2, 0, -2, 62, 4.5);
  // V6 (user 19 Nov ~19:56): rotate the view ~30° toward the Casino
  // Dorada building (south/left) so the chase angles at the building
  // instead of straight down the road. A full 45° was probed first
  // (probe A45): it pushes the sun off-frame, crowds the flipped cars
  // + roadblock onto the right edge, and swings the north-shoulder park
  // out of frame — 30° keeps the sun, the whole pile-up AND the park
  // in frame while the building fills the centre-left. Look target
  // (PX-23, PZ+13): 35 m along the new view dir from the camera.
  G.camera.lookAt(PX - 23, 0.8, PZ + 13);
  G.camera.updateProjectionMatrix();
  applyLowPoly(G); // V7: flat-shaded low-poly restyle, after all staging
  renderHUD(G);
  renderMinimap(G);
  buildClockPanel(G, '09:48', 9.8, 1, 'hud'); // MORNING, sun high
}

// ---------------------------------------------------------------- title
function stageTitle(G) {
  // V3-2: stage a REAL save first so Continue shows genuine progress
  // (JOB 5/8 · $48,250 · 63%) instead of "NO SAVE YET".
  G.stats.carsStolen = 38;
  G.stats.escapes = 13;
  // V4: DAY 2 13:00 — AFTERNOON (clock drives the day preset). The
  // CONTINUE line shows JOB 5/8 · $48,250 · 63% (saveSummary: missionsDone,
  // money, percent — playSeconds is never displayed on the title screen),
  // so the longer play time does not touch the progress proof.
  G.stats.playSeconds = 66240;
  G.stats.missionsDone = 5;
  G.player.money = 48250;
  G.player.health = 100;
  G.player.armour = 50;
  startMission(G, 5); // Job 6 Konfrontasi — 5 jobs done
  saveGame(G); // writes the real save; showTitle reads it via saveSummary()
  G.setMode('title');
  restageSky(G, 'lowpoly'); // V7: bright warm low-poly morning, not blue afternoon
  // Westward view: Casino Row towers + beach under the day sky, sun in frame.
  // showTitle (via setMode) paints the portraits and reveals HOW TO PLAY.
  // (No sunset flare here — the afternoon sun comes from restageSky.)
  // V4: AFTERNOON life — staged traffic cars on the streets below the
  // panorama so the day city reads alive, not empty.
  const tc1 = spawnTrafficCar(G, -150, -200, Math.PI / 2, 'Solano S');
  const tc2 = spawnTrafficCar(G, -100, -200, -Math.PI / 2, 'Palma Cruiser');
  const tc3 = spawnTrafficCar(G, -120, -100, 0, 'Cayo Coupe');
  const tc4 = spawnTrafficCar(G, -180, -120, Math.PI / 2, 'Marina Taxi');
  for (const tc of [tc1, tc2, tc3, tc4]) brightenCar(G, tc);
  G.camera.position.set(90, 72, 210);
  G.camera.lookAt(-260, 28, -150);
  G.camera.fov = 58;
  G.camera.updateProjectionMatrix();
  // V5r5 F5 (ROOT CAUSE FOUND): the "flare blob" on the WOWO card was
  // NEVER a cloud or the sun — it is a DOM radial-gradient ::before on
  // #title-screen (title.js, PRE-CUT: 150 px at left 12% / top 9% =
  // screen (154-304, 65-215), dead on the WOWO card). That is why hiding
  // clouds never moved it. Staging override from shots.js (allowed file):
  // hide that pseudo-element; the 3D sun disc now carries the top-left
  // light instead. (title.js itself is untouched.)
  let f5style = document.getElementById('v5-title-glow-off');
  if (!f5style) {
    f5style = document.createElement('style');
    f5style.id = 'v5-title-glow-off';
    f5style.textContent = '#title-screen::before{display:none !important}';
    document.head.appendChild(f5style);
  }
  // V5 F5 (clouds): hide any cloud whose projected centre falls within
  // 220 px of the sun disc, so no cloud crosses the disc. NOTE: Vector3.project needs the camera's matrixWorld
  // current — updateMatrixWorld() first (without it the loop projected
  // with the BOOT camera and hid the wrong clouds). V7: the sun position
  // is projected live instead of hard-coded, so the hide works for the
  // low-poly sun too.
  const THREE = G.three;
  const projV = new THREE.Vector3();
  G.camera.updateMatrixWorld();
  const sunProj = new THREE.Vector3();
  sunProj.copy(G.sky.sun.position).project(G.camera);
  const sunSx = (sunProj.x + 1) / 2 * 1280, sunSy = (1 - sunProj.y) / 2 * 720;
  for (const cl of (G.sky.clouds || [])) {
    projV.copy(cl.position).project(G.camera);
    const sx = (projV.x + 1) / 2 * 1280, sy = (1 - projV.y) / 2 * 720;
    if (Math.hypot(sx - sunSx, sy - sunSy) < 220) cl.visible = false;
  }
  // V5 F7: lift the dark lower city — warm lights over the foreground
  // streets (probe: (-60,20,80)->(585,471), (20,20,20)->(923,483)).
  for (const [lx, lz] of [[-160, -10], [-90, 40], [-20, 90], [-120, 100]]) {
    const l = new THREE.PointLight(0xffe0b0, 150, 70, 1.6);
    l.position.set(lx, 30, lz);
    G.scene.add(l);
  }
  G.renderer.render(G.scene, G.camera);
  buildClockPanel(G, '10:24', 10.4, 2, 'title'); // MORNING, sun high centre-top
  applyLowPoly(G); // V7: flat-shaded low-poly restyle (title re-renders below in the shot harness)
}

// ---------------------------------------------------------------- combat
// V3 MONEY SHOT — jetpack + bazooka, one frame, three systems at once:
// Wowo ON the jetpack mid-air firing the bazooka; a REAL explosion frozen
// mid-blast (explodeAt: fireball + smoke column + shockwave ring + debris +
// scorch); a CAR thrown through the air by the blast; a BODY frozen mid-air
// at the peak of the blast; drops scattered below. Order matters because
// the shot is frozen: explodeAt runs FIRST (before any enemy/car is placed
// in its radius, so nothing gets teleported or flipped by it afterwards),
// then every staged object is posed directly on its mesh.
function stageCombat(G) {
  G.setMode('play');
  const w = G.city.landmarks.warehouse;
  const PX = w.x - 18, PZ = w.z + 24;
  const H = Math.atan2(w.x - PX, w.z - PZ); // facing the warehouse
  G.player.mode = 'foot';
  G.player.pos.set(PX, 0, PZ);
  G.player.heading = H;
  G.player.health = 82;
  G.player.armour = 40;
  G.player.money = 12500;
  // V7-night: clock drives the sky preset — NIGHT 22:36. Dark sky, moon;
  // Wowo high-contrast vs black (V6's night fix) in V7's low-poly style.
  G.stats.playSeconds = 14400;
  restageSky(G, 'night');
  setWanted(G, 2);
  G.police.units = [
    { name: 'UNIT 07', dist: 120, status: 'PURSUIT', mesh: null },
    { name: 'UNIT 18', dist: 240, status: 'EN ROUTE', mesh: null },
  ];
  startMission(G, 4);
  G.missions.stage = 1;
  G.missions.stageCount = 3;
  G.missions.timer = 0;
  // Bazooka is weapon slot 5 (index 4): 1 in the mag, 12 in reserve.
  G.combat.weaponIndex = 4;
  G.combat.weapons[4].mag = 1;
  G.combat.weapons[4].reserve = 12;
  // The staged save owns nitro — the speedometer must never read
  // "NITRO — NOT INSTALLED" in this shot (same as the chase staging).
  if (!G.garage) G.garage = { owned: {} };
  if (!G.garage.owned) G.garage.owned = {};
  G.garage.owned.nitro = 1;

  const THREE = G.three;
  // Wowo ON the jetpack, mid-air: setJetpack lights the flame and lifts
  // him to 2.5 m; raise him further so he reads clearly above the blast
  // (and above the dialogue box, which covers the bottom-centre of frame),
  // and grow the jetpack flame so the thrust reads at a glance.
  setJetpack(G, true);
  // V5 F8: Wowo LOWER + BIGGER + PERSON-first. V4 had him at y 5.0 with a
  // 2.0x flame — probe: head sy 18 (top edge, behind the JOB panel),
  // chest (319,104), flame dominating. Now y 3.4 (head ~sy 190, clear of
  // the top panels), mesh 1.25x, flame back to the 1.2x default (effective
  // 1.5x through the mesh scale — still smaller than V4's 2.0x).
  G.player.pos.y = 3.4;
  const jpFlame = G.player.mesh && G.player.mesh.userData
    ? G.player.mesh.userData.jetpackFlame : null;
  if (jpFlame) jpFlame.scale.setScalar(1.0); // V5r4: was 1.2
  G.player.mesh.scale.setScalar(1.2); // V5 F8: Wowo bigger (was 1.25 — 1.25 + close camera cropped his tanks at the top edge)
  // V5r3 F8: 3/4 profile — straight down his back, the jetpack tanks hid
  // the person entirely. Turned toward the camera so his right side (arm,
  // hip, leg) reads beside the tanks instead of behind them.
  // V5r4: full profile (H - 0.9) — at 0.45 the tanks still covered the
  // torso; facing east, the camera (south) sees head/torso/arm/legs in a
  // row with the jetpack behind him. Flame 1.0x (was 1.2x) so the thrust
  // reads smaller than the person.
  G.player.mesh.rotation.y = H - 0.9;
  brightenWowo(G); // V4: jacket + tanks lift so the figure reads as a PERSON with a jetpack
  // Jetpack smoke trail below Wowo — the rising puffs are what sells
  // "he flew up here" at a glance (kept >8 m from the blast point so the
  // smoke-dimming below never touches them).
  spawnSmoke(G, PX, 2.8, PZ, 1.2);
  spawnSmoke(G, PX, 2.0, PZ, 1.0);
  spawnSmoke(G, PX, 1.2, PZ, 0.9);
  // Warm key light on Wowo from the CAMERA side (behind-above him): he
  // faces away from the western sun, so his front reads near-black without
  // it — the light lifts his jacket, skin and the jetpack tanks out of the
  // dark sunset sky. Placed toward the camera so his BACK (tanks + flame,
  // what the camera sees) is lit, not just his front.
  const wowoLight = new THREE.PointLight(0xffc27a, 130, 16, 1.6); // V7-night: was 200 — blew the brown jacket out to cream
  wowoLight.position.set(PX - Math.sin(H) * 3, 5.5, PZ - Math.cos(H) * 3);
  G.scene.add(wowoLight);

  // --- the blast itself, 14 m ahead of Wowo, dead centre of the frame ---
  const bp = offsetFrom(PX, PZ, H, 14, 0);
  explodeAt(G, bp.x, 1.5, bp.z, 14);
  // The stock fireball is ~5 m across — scale it up slightly so the blast
  // reads IMPACTFUL, not a small orange flash, and add two tall basic-
  // material flame columns (MeshBasic orange reads vivid at sunset; the
  // standard-material fireball alone blows out to cream under the sun, so
  // its emissive is cooled to 1.0 to keep it orange instead of white-hot).
  // explodeAt also throws white smoke sprites over the blast — dim the ones
  // at the blast point, or their white wash turns the fireball cream.
  for (const ex of G.combat._explosions) {
    if (ex.kind === 'fireball' && ex.group) {
      ex.group.scale.setScalar(1.0); // V5 F11: was 1.15 — smaller blast mass
      for (const m of ex.mats || []) m.emissiveIntensity = 1.0;
    }
  }
  if (G.driving && G.driving.fx && Array.isArray(G.driving.fx.smoke)) {
    for (const s of G.driving.fx.smoke) {
      if (!s.sprite || !s.sprite.visible) continue;
      const p = s.sprite.position;
      if (Math.hypot(p.x - bp.x, p.z - bp.z) < 8 && s.sprite.material) {
        s.sprite.material.opacity = 0.12;
      }
    }
  }
  addFire(G, bp.x, bp.z, 1.9); // V5 F11: was 2.6 — shrink the flame mass
  addFire(G, bp.x - 2, bp.z + 1.5, 1.3); // V5 F11: was 1.8
  spawnDamageNumber(G, bp.x, 5.5, bp.z, '-220', '#ff8a3a');

  // --- a CAR thrown through the air by the blast (posed directly) ---
  // Heading-relative placement (offsetFrom): 11 m screen-RIGHT of the blast
  // core so it clears the fireball instead of hiding inside/behind it (the
  // old raw x/z offset landed it at the fireball's right edge, unreadable).
  // A yellow Marina Taxi, so the flying car reads at a glance instead of
  // vanishing into the dark buildings like a dark coupe did. Raised to 5.5 m
  // so it is clearly ABOVE the ground, tumbling, nose-down, mid-air.
  const taxiP = offsetFrom(bp.x, bp.z, H, 2, 11);
  const thrown = makeCar(G, 'Marina Taxi', taxiP.x, taxiP.z, H + 0.9);
  brightenCar(G, thrown);
  thrown.mesh.position.y = 5.5;
  thrown.mesh.rotation.set(0.5, H + 0.9, 1.1); // tumbling, nose-down, mid-air
  addFire(G, taxiP.x, taxiP.z, 0.9);

  // --- a BODY frozen mid-air at the peak of the blast ---
  // A heavy (1.25x bulk, bigger silhouette), 9 m screen-LEFT of the blast
  // core and 4 m back toward the camera (so he reads BIG, not a speck),
  // raised to 7.0 m so he silhouettes against the SKY, not the orange
  // fireball. Bright IDPD-blue uniform (cloned material, so no other
  // heavy is recolored) so the tumbling figure reads at a glance.
  const flyP = offsetFrom(bp.x, bp.z, H, -4, -9);
  const flyer = spawnEnemy(G, flyP.x, flyP.z, 'heavy');
  flyer.mesh.position.y = 7.0;
  flyer.mesh.rotation.set(-0.5, 1.2, 0.4); // thrown, tumbling — more upright so he reads
  flyer.mesh.traverse((o) => {
    const m = o.material;
    if (m && m.color && m.color.getHex() === 0x5a5f66) {
      o.material = m.clone();
      o.material.color.setHex(0x4f8ff7);
      o.material.emissive.setHex(0x1a3a6a);
      o.material.emissiveIntensity = 1;
    }
  });

  // Enemies CLOSE (8-19 m, inside the frame): two gunmen firing, one heavy
  // centre behind the blast, one DOWNED gunman flat on the ground near the
  // camera.
  const e1p = offsetFrom(PX, PZ, H, 9, 9); // V4: was (11, 7.5) — e1 stood
  // dead on the camera ray to the SMG drop, so the "SMG +30" label read
  // "SM +3" behind his head (pre-existing v3 overlap). 2.5 m south puts
  // him clear of the label while he stays a close gunman firing at Wowo.
  const e2p = offsetFrom(PX, PZ, H, 12, -8);
  const e3p = offsetFrom(PX, PZ, H, 19, 1.5);
  const downP = offsetFrom(PX, PZ, H, 8, -2.5);
  const e1 = spawnEnemy(G, e1p.x, e1p.z, 'gunman');
  const e2 = spawnEnemy(G, e2p.x, e2p.z, 'gunman');
  const e3 = spawnEnemy(G, e3p.x, e3p.z, 'heavy');
  const down = spawnEnemy(G, downP.x, downP.z, 'gunman');
  down.state = 'dying';
  down.fallTimer = 0.9;
  down.mesh.rotation.x = -Math.PI / 2; // flat on his back
  down.mesh.position.y = 0.25;

  // Enemy drops (recording #10): the downed gunman already dropped his loot
  // — a green cash stack beside his body and his pistol on the asphalt with
  // a floating "PISTOL +24" label, both glowing so they read in the frame.
  dropCash(G, downP.x + 1.4, downP.z + 1.2, 250);
  dropWeapon(G, downP.x - 1.2, downP.z + 1.8, 0); // Pistol +24
  // (No +$250 popup here — the centre stack stays two lines so it never
  // covers the blast; the cash stack itself carries the $250 label.)

  // Blast loot scattered BELOW the explosion: cash + weapons with labels,
  // spread WIDE with heading-relative offsets so the labels never stack on
  // each other (the old tight cluster overlapped "RIFLE +30" and "$250").
  const d1 = offsetFrom(bp.x, bp.z, H, 4, 6);
  dropCash(G, d1.x, d1.z, 350);
  const d2 = offsetFrom(bp.x, bp.z, H, 5, -6);
  dropWeapon(G, d2.x, d2.z, 3); // Rifle +30
  const d3 = offsetFrom(bp.x, bp.z, H, -2, -8);
  dropCash(G, d3.x, d3.z, 250);
  const d4 = offsetFrom(bp.x, bp.z, H, -1, 8);
  dropWeapon(G, d4.x, d4.z, 1); // SMG +30

  // A burning pickup on the right flank, flames + smoke in frame.
  const burnP = offsetFrom(PX, PZ, H, 14, 9);
  const pickup = makeCar(G, 'Faro Pickup', burnP.x, burnP.z, H + 0.5);
  brightenCar(G, pickup);
  igniteCar(G, pickup, 1.1);

  // Live fire, frozen mid-burst: muzzle flashes + tracers from both gunmen
  // toward the player, and the BAZOOKA shot itself — a bright tracer from
  // Wowo's gun to the heart of the blast, plus a rocket frozen mid-flight
  // halfway there.
  const pPos = new THREE.Vector3(PX, 3.4, PZ); // V5 F8: Wowo now at y 3.4
  for (const e of [e1, e2]) {
    const from = new THREE.Vector3(e.pos.x, 1.35, e.pos.z);
    const to = new THREE.Vector3(pPos.x + (G.rng() - 0.5) * 1.2, 4.4, pPos.z + (G.rng() - 0.5) * 1.2); // V5 F8: was 5.0
    fireBurst(G, from, to);
  }
  const gunFrom = new THREE.Vector3(
    pPos.x + Math.sin(H) * 0.6, 4.6, pPos.z + Math.cos(H) * 0.6, // V5 F8: was 6.0
  );
  const blastTop = new THREE.Vector3(bp.x, 2.5, bp.z);
  fireBurst(G, gunFrom, blastTop);
  // Rocket mid-flight: dark tube + orange nose + flame cone, halfway down
  // the gun-to-blast line, nose-first toward the explosion.
  const rocket = new THREE.Group();
  const rBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.85, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.4, metalness: 0.7 }),
  );
  rBody.rotation.x = Math.PI / 2;
  rocket.add(rBody);
  const rNose = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.3, 10),
    new THREE.MeshStandardMaterial({ color: 0xd86a20, roughness: 0.5 }),
  );
  rNose.rotation.x = Math.PI / 2;
  rNose.position.z = 0.57;
  rocket.add(rNose);
  const rFlame = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.6, 8),
    new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  rFlame.rotation.x = -Math.PI / 2;
  rFlame.position.z = -0.7;
  rocket.add(rFlame);
  const mid = gunFrom.clone().lerp(blastTop, 0.45);
  rocket.position.copy(mid);
  rocket.lookAt(blastTop.x, blastTop.y, blastTop.z);
  rocket.scale.setScalar(1.5); // read at 20+ m, not a speck
  G.scene.add(rocket);

  // V4 staging (recording #16), round 2: every runner is PINNED to an
  // explicit spot. Round 1 relied on spawnPed's random sidewalk side and
  // the probe (window.__G) showed the failures: the 4 north runners
  // all landed west and paired up at identical screen spots behind the
  // fireball, and the second crossing ped stood exactly on the view ray
  // to the SMG drop, covering its "+30" label. The north runners move
  // to the east sidewalk (spread 4 m, clear of the flames), the south
  // runners are pinned to their round-1 spots (which read well), the
  // second crossing ped moves south of the label ray, and the southbound
  // car moves from z=266 (off-frame right, sx 1282) to z=262 (in frame).
  const N = Math.PI; // fleeing north, away from the blast
  const S = 0; // fleeing south, toward the camera
  const nr1 = poseRunPed(spawnPed(G, 124, 244), N);
  nr1.mesh.position.set(128.5, 0.10, 242); // east sidewalk, clear of the flames
  const nr2 = poseRunPed(spawnPed(G, 124, 247), N);
  nr2.mesh.position.set(128.5, 0.10, 246);
  const nr3 = poseRunPed(spawnPed(G, 124, 250), N);
  nr3.mesh.position.set(128.5, 0.10, 250);
  const sr1 = poseRunPed(spawnPed(G, 113, 259), S);
  sr1.mesh.position.set(111.5, 0.10, 259); // west sidewalk, toward the camera
  const sr2 = poseRunPed(spawnPed(G, 115, 260), S);
  sr2.mesh.position.set(111.5, 0.10, 260);
  const sr3 = poseRunPed(spawnPed(G, 127, 258), S);
  sr3.mesh.position.set(128.5, 0.10, 258); // east sidewalk, toward the camera
  const ccross1 = poseRunPed(spawnPed(G, 120, 251), Math.PI / 2);
  ccross1.mesh.position.set(120, 0.10, 251); // crossing east, clear of the blast
  const ccross2 = poseRunPed(spawnPed(G, 122, 260), Math.PI / 2);
  ccross2.mesh.position.set(122, 0.10, 260); // crossing east, south of the SMG label ray
  const field1 = poseRunPed(spawnPed(G, 106, 261), -0.5, false, true);
  field1.mesh.position.set(106, 0.10, 261); // foreground field, fleeing southwest, sprint
  const field2 = poseRunPed(spawnPed(G, 109, 259), -0.5, false, true);
  field2.mesh.position.set(109, 0.10, 259); // foreground field, fleeing southwest, sprint
  // V4 round 4 (top-5 bar): two MORE field runners on the WEST side of the
  // green foreground, big and close to the camera — the left foreground
  // was empty grass. Clear of the downed gunman (104.8, 256.1), the
  // PISTOL drop label and the blast; both sprint, southwest, away from it.
  const field3 = poseRunPed(spawnPed(G, 97, 254), -0.5, false, true);
  field3.mesh.position.set(97, 0.10, 254); // west field, fleeing southwest, sprint
  const field4 = poseRunPed(spawnPed(G, 95, 258), -0.5, false, true);
  field4.mesh.position.set(95, 0.10, 258); // west field, fleeing southwest, sprint
  const cSouth = spawnTrafficCar(G, 120, 262, 0, 'Palma Cruiser'); // southbound
  const cNorth = spawnTrafficCar(G, 120, 246, Math.PI, 'Solano S'); // northbound
  brightenCar(G, cSouth);
  brightenCar(G, cNorth);

  // V4: IDPD VISIBLE in frame — two responding units on the roads (the
  // panel alone showed 2 units, zero in frame). Screen positions probed
  // before placing: (120,242) -> sx 710 sy 417, (100,240) -> sx 322 sy 428
  // — both in frame, clear of the drops labels and the blast. Light bars
  // set bright directly (the flashing update loop never runs in the frozen
  // shot; userData.lightRed/lightBlue are meshes with per-car cloned
  // materials, so the emissive lift touches only these two cars).
  // V5 F10: IDPD BIGGER + CLOSER in the mid-ground — both units moved ~6 m
  // toward the blast/camera and scaled 1.25x, so the police read as cars
  // with light bars, not distant dots (V4: (120,242)/(100,240) -> (714,410)
  // and (314,419), small). Light bars already at 2.2 emissive.
  const pc1 = spawnPoliceCar(G, 118, 250, 0); // x=120 road, facing the blast
  pc1.status = 'RESPONDING'; pc1.dist = 21;
  const pc2 = spawnPoliceCar(G, 100, 240, Math.PI / 2); // z=240 cross street, facing east
  pc2.status = 'EN ROUTE'; pc2.dist = 24;
  for (const pc of [pc1, pc2]) {
    pc.mesh.scale.setScalar(1.25);
    const u = pc.mesh.userData;
    if (u.lightRed) u.lightRed.material.emissiveIntensity = 2.2;
    if (u.lightBlue) u.lightBlue.material.emissiveIntensity = 2.2;
  }
  // One IDPD officer on foot, running in from the lead unit (shirt
  // recolored IDPD-blue; the shirt material is shared torso+arms, so the
  // clone covers the whole uniform top).
  const officer = poseRunPed(spawnPed(G, 117, 242), 0);
  officer.mesh.position.set(117, 0.10, 242);
  const shirtMat = officer.mesh.userData.armL.material;
  const blueShirt = shirtMat.clone();
  blueShirt.color.setHex(0x2a4a8a);
  blueShirt.emissive.setHex(0x0a1a3a);
  blueShirt.emissiveIntensity = 1;
  officer.mesh.traverse((o) => { if (o.material === shirtMat) o.material = blueShirt; });
  // V5 F9: fill the empty lower half (foreground field). Probe: (110,264)
  // -> (933,613) right-bottom, (102,259) -> ~(300,590) left-bottom — both
  // clear of the dialogue box (sx 360-920, sy 505-570) and the speedometer.
  // A parked IDPD unit with its light bar on (right), crates + barrels
  // (left), a $ pickup (right, clear of the minimap), two fleeing peds.
  const fgUnit = spawnPoliceCar(G, 109, 264, Math.PI * 0.75); // V5r2: was (110.5,264.5) — nose slid under the minimap
  fgUnit.status = 'PARKED'; fgUnit.dist = 8;
  const fgu = fgUnit.mesh.userData;
  if (fgu.lightRed) fgu.lightRed.material.emissiveIntensity = 2.2;
  if (fgu.lightBlue) fgu.lightBlue.material.emissiveIntensity = 2.2;
  dropCash(G, 111, 265, 250);
  addCrates(G, [[97.5, 257], [99, 258.5], [98, 256], [100.5, 257.5]]); // V5r2: moved west, clear of the downed gunman + PISTOL drop
  const fgPed1 = poseRunPed(spawnPed(G, 101.5, 260), -0.5, false, true);
  fgPed1.mesh.position.set(101.5, 0.10, 260); // V5r2: was (99,260) — half out of the left frame edge
  const fgPed2 = poseRunPed(spawnPed(G, 109, 265), -0.5, false, true);
  fgPed2.mesh.position.set(109, 0.10, 265); // foreground field, fleeing southwest, sprint

  // Night street lights along the x=120 road so the night scene reads
  // (fire/tracers/muzzle + police light bars already help; the warm pools
  // on the asphalt sell the street lighting).
  addStreetLights(G, [[111.5, 248], [128.5, 256], [111.5, 264]]);
  // Lit windows come free at night: the building windows are an
  // InstancedMesh with MeshBasicMaterial (unlit, warm glass), so they stay
  // bright while the Standard-material bodies go dark — verify in the render.
  applyLowPoly(G); // V7: flat-shaded low-poly restyle, after all staging

  showDialogue(G, 'WOWO', 'Three of them. The cache is behind that wall. Move.', 60000);
  pushScorePopup(G, '-220', 'damage', 'BAZOOKA HIT');
  pushScorePopup(G, '-34', 'damage', 'GUNMAN DOWN');
  const banner = document.createElement('div');
  banner.id = 'mission-passed-banner';
  banner.style.cssText = 'position:absolute;left:59%;top:5%;transform:translateX(-50%);text-align:center;'
    + 'background:rgba(10,14,22,0.88);border:2px solid #f2c230;border-radius:8px;'
    + 'padding:10px 28px;z-index:7;pointer-events:none;'
    + 'font-family:system-ui,sans-serif;color:#f5efe0;';
  banner.innerHTML = '<div style="font:800 26px system-ui,sans-serif;color:#f2c230;letter-spacing:3px;">★ MISSION PASSED ★</div>'
    + '<div style="font:700 15px system-ui,sans-serif;margin-top:4px;">JOB 5 — GUDANG SENJATA</div>'
    + '<div style="font:800 16px ui-monospace,Menlo,monospace;color:#8fe388;margin-top:4px;">+$4,500 &nbsp;·&nbsp; +500 REP</div>'
    + '<div style="font:700 13px system-ui,sans-serif;color:#7ec8e8;margin-top:3px;">UNLOCKED: JOB 6 — KONFRONTASI</div>';
  const hudEl = document.getElementById('hud');
  if (hudEl) hudEl.appendChild(banner);
  // Camera: closer (dist 4.5, was 5.5) and a touch higher than the old low angle
  // (y ~3.5, still below Wowo's 5.0 so he silhouettes against the sky,
  // not the ground) — a full top-down angle foreshortens him and hides
  // him behind the fireball. Aim AT the blast, y 4.0, so the drops on
  // the ground read below it. Wowo stays large, left of the banner.
  // V5 F8: lat 2 (was 4) — Wowo more central.
  // V5r2: dist 6.0 (was 4.5), height 0.0 (was -1.5) — at 4.5 m the lowered
  // + enlarged Wowo subtended ~32 deg and his tanks cropped at the top
  // edge; pulled back and level with him (cam y = 3.4) he fits whole.
  placeChaseCamera(G, G.player.pos, H, 6.0, 0.0, 0, 0, 64, 2);
  G.camera.lookAt(bp.x, 4.0, bp.z);
  G.camera.updateProjectionMatrix();
  const popLayer = document.getElementById('score-popups');
  if (popLayer) popLayer.style.top = '20%';
  renderHUD(G);
  renderMinimap(G);
  buildClockPanel(G, '22:36', 22.6, 1, 'hud'); // NIGHT, moon icon
}

// ---------------------------------------------------------------- map
function stageMap(G) {
  G.stats.carsStolen = 38;
  G.stats.escapes = 13;
  G.stats.playSeconds = 7420;
  G.stats.missionsDone = 5;
  G.player.money = 48250;
  // Player at the (40, 200) road junction by the garage, not on top of the
  // Marina job — so the map shows the dashed gold route to JOB 6.
  G.player.pos.set(40, 0, 200);
  G.player.heading = Math.PI;
  startMission(G, 5);
  // V3: stage real progression state so the map's new panels read at a
  // glance instead of showing fresh-save zeros — 7/20 idols, REP LV 3,
  // skills with pips, one property owned, garage upgrades installed — and
  // a real car, so the GARAGE section names one instead of "NO CAR".
  const car = makeCar(G, 'Aurea GT', 52, 212, Math.PI);
  brightenCar(G, car);
  G.driving.car = car;
  if (!G.garage) G.garage = { owned: {} };
  if (!G.garage.owned) G.garage.owned = {};
  G.garage.owned.engine = 2;
  G.garage.owned.armor = 1;
  G.garage.owned.nitro = 1;
  G.garage.owned.paint = 1;
  const pr = G.progression;
  if (pr) {
    pr.collectibles.found = 7;
    pr.idols.slice(0, 7).forEach((idol) => {
      idol.collected = true;
      if (idol.mesh) G.scene.remove(idol.mesh);
    });
    pr.rep.level = 3;
    pr.rep.xp = 850;
    pr.rep.xpNext = xpNextFor(3);
    pr.rep.nextUnlock = nextUnlockFor(3);
    pr.skills = { driving: 3, aim: 2, influence: 1, stamina: 2, stealth: 1, street: 2 };
    if (pr.properties && pr.properties[0]) pr.properties[0].owned = true;
    recomputeEffects(G);
  }
  G.setMode('map');
  drawMap(G);
  applyLowPoly(G); // V7: the 3D city behind the map reads low-poly too
  // The side-job legend entries (TAXI STAND / DELIVERY PICKUP / STREET
  // RACE) load via a dynamic import in map.js and nothing re-draws the
  // legend once it resolves — force one more drawMap after the import so
  // the entries are in the frame before the screenshot (~600 ms later).
  import('./sidejobs.js').then(() => drawMap(G)).catch(() => {});
  // V3: the side panel is ~1,450 px tall in one column — centred in a
  // 720 px frame, CURRENT JOB is cut off the top and GARAGE off the bottom.
  // Staging-only reflow (live game untouched): two columns, so every panel
  // — CURRENT JOB, checklist, stats, legend, progression, garage — fits
  // in the one screenshot frame.
  const side = document.getElementById('map-side');
  if (side) {
    side.style.width = '600px';
    side.style.columnCount = '2';
    side.style.columnGap = '14px';
    // Both columns run ~730 px tall; scale the whole panel to 0.87 so it
    // fits the 720 px frame top-to-bottom (text stays ~11 px, still legible).
    side.style.transform = 'scale(0.87)';
    side.style.transformOrigin = 'center center';
    for (const child of side.children) child.style.breakInside = 'avoid';
  }
}

// Set `G` to the named scene. Any unknown name stages the chase (the cover).
export function stageShot(name, G) {
  if (name === 'title') stageTitle(G);
  else if (name === 'combat') stageCombat(G);
  else if (name === 'map') stageMap(G);
  else stageChase(G);
}
