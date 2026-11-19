// Isla Dorada — HUD (rebuild): mission panel, wanted stars, money, clock,
// police list, district label, vitals, weapon rack, drive panel with a
// SPEEDOMETER GAUGE + nitro lamp, dialogue with a DRAWN CHARACTER PORTRAIT,
// score popups (DRIFT / NEAR MISS / damage), prompt, toast, damage vignette.
// DOM lookups are cached at init; renderHUD only touches the DOM when a value
// actually changed. New HUD furniture (gauge canvas, popup layer, portrait art)
// is created here in JS so index.html stays untouched.
import { MISSIONS, WEAPONS, RADIO, districtAt } from './config.js';
import { Input } from './input.js';

const el = {};
let last = {};
let dialogueTimer = null;
let toastTimer = null;
let weaponSlots = [];
let gaugeCtx = null;
let popups = []; // { el, born, key }
let seenScoreKeys = new Set();
let shownScorePopups = new WeakSet(); // gameplay score-popup objects already rendered

// ---------------------------------------------------------------- portraits
// Flat, drawn SVG portraits — no initials, no network images. Each is a
// 64x64 viewBox: background disc, shoulders, face, hair, eyes, mouth and one
// signature accessory per character. Readable at 46 px (dialogue) and 64 px
// (title cards). Exported so title.js reuses the exact same art.
const PORTRAITS = {
  WOWO: {
    bg: '#7a4a1a', skin: '#c98a5a', hair: '#1a1210', jacket: '#8a6d1f',
    accessory: 'headband', accent: '#f2c230',
  },
  BRAGA: {
    bg: '#1d2f55', skin: '#d9a077', hair: '#2a2a2a', jacket: '#274b8a',
    accessory: 'cap', accent: '#6aa8ff',
  },
  MARA: {
    bg: '#5a1f3a', skin: '#e8b88a', hair: '#3a1a10', jacket: '#a03a5a',
    accessory: 'hair', accent: '#ff7a9a',
  },
  JUNO: {
    bg: '#3a1a5a', skin: '#eec39a', hair: '#f2c230', jacket: '#c23a8a',
    accessory: 'bob', accent: '#ff9ad9',
  },
};

function portraitKey(speaker) {
  const s = String(speaker || '').toUpperCase().replace(/^OFFICER\s+/, '').trim();
  if (PORTRAITS[s]) return s;
  if (s.includes('BRAGA')) return 'BRAGA';
  if (s.includes('MARA')) return 'MARA';
  if (s.includes('JUNO')) return 'JUNO';
  return 'WOWO';
}

export function portraitSVG(speaker) {
  const p = PORTRAITS[portraitKey(speaker)];
  const acc = p.accessory;
  // Hair / headgear shapes differ per character; the face stays the same
  // construction so every portrait reads as the same art style.
  let top = '';
  if (acc === 'headband') {
    top = `<path d="M14 30 Q16 12 32 12 Q48 12 50 30 Q48 20 32 19 Q16 20 14 30Z" fill="${p.hair}"/>`
      + `<rect x="13" y="24" width="38" height="5" rx="2.5" fill="${p.accent}"/>`;
  } else if (acc === 'cap') {
    top = `<path d="M13 28 Q13 10 32 10 Q51 10 51 28 L51 30 L13 30Z" fill="#1a2f5a"/>`
      + `<rect x="11" y="27" width="42" height="4" rx="2" fill="#0f1c38"/>`
      + `<circle cx="32" cy="19" r="3.4" fill="${p.accent}"/>`
      + `<rect x="14" y="30" width="36" height="3.4" rx="1.7" fill="#0f1c38"/>`;
  } else if (acc === 'hair') {
    top = `<path d="M12 34 Q10 10 32 10 Q54 10 52 34 L50 44 Q50 26 32 25 Q14 26 14 44Z" fill="${p.hair}"/>`
      + `<circle cx="15" cy="46" r="2.2" fill="${p.accent}"/>`;
  } else { // bob
    top = `<path d="M12 36 Q9 10 32 10 Q55 10 52 36 L50 46 L44 46 Q48 26 32 25 Q16 26 20 46 L14 46Z" fill="${p.hair}"/>`;
  }
  const shades = acc === 'cap'
    ? `<rect x="19" y="31" width="11" height="6" rx="3" fill="#101418"/><rect x="34" y="31" width="11" height="6" rx="3" fill="#101418"/><rect x="29" y="32" width="6" height="2.4" fill="#101418"/>`
    : `<ellipse cx="24" cy="34" rx="3.2" ry="3.8" fill="#fff"/><ellipse cx="40" cy="34" rx="3.2" ry="3.8" fill="#fff"/>`
      + `<circle cx="24" cy="34.6" r="1.7" fill="#1a1210"/><circle cx="40" cy="34.6" r="1.7" fill="#1a1210"/>`;
  const mouth = acc === 'cap'
    ? `<path d="M26 48 L38 48" stroke="#7a3a2a" stroke-width="2" stroke-linecap="round"/>`
    : `<path d="M27 47 Q32 50 37 47" stroke="#7a3a2a" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">`
    + `<circle cx="32" cy="32" r="32" fill="${p.bg}"/>`
    + `<path d="M8 64 Q10 50 24 48 L40 48 Q54 50 56 64Z" fill="${p.jacket}"/>`
    + `<path d="M28 46 L32 52 L36 46 L36 44 L28 44Z" fill="${p.skin}"/>`
    + `<ellipse cx="32" cy="35" rx="13.5" ry="15" fill="${p.skin}"/>`
    + top + shades
    + `<path d="M21 29 Q24 27.5 27 29" stroke="${p.hair}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
    + `<path d="M37 29 Q40 27.5 43 29" stroke="${p.hair}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
    + mouth
    + `</svg>`;
}

// ---------------------------------------------------------------- weapon art
// Flat, drawn SVG weapon silhouettes — original geometric art, no images.
// Each is a 64x28 viewBox gun profile in gold; readable at ~60 px wide.
// Used by the GTA-style top-right weapon panel (current weapon + ammo).
function weaponSVG(name) {
  const n = String(name || '').toUpperCase();
  const gold = '#f2c230';
  let body = '';
  if (n.includes('PISTOL')) {
    body = `<rect x="10" y="9" width="34" height="6" rx="1" fill="${gold}"/>`
      + `<rect x="30" y="14" width="9" height="12" rx="1" fill="${gold}"/>`
      + `<rect x="42" y="10" width="4" height="4" fill="${gold}"/>`;
  } else if (n.includes('SMG')) {
    body = `<rect x="6" y="10" width="48" height="6" rx="1" fill="${gold}"/>`
      + `<rect x="26" y="15" width="8" height="11" rx="1" fill="${gold}"/>`
      + `<rect x="6" y="12" width="8" height="5" fill="${gold}"/>`
      + `<rect x="52" y="11" width="6" height="4" fill="${gold}"/>`;
  } else if (n.includes('SHOTGUN')) {
    body = `<rect x="4" y="10" width="56" height="4" rx="1" fill="${gold}"/>`
      + `<rect x="30" y="14" width="14" height="4" fill="${gold}"/>`
      + `<rect x="4" y="13" width="12" height="7" rx="1" fill="${gold}"/>`
      + `<rect x="14" y="14" width="8" height="4" fill="${gold}"/>`;
  } else { // Rifle
    body = `<rect x="4" y="10" width="56" height="4" rx="1" fill="${gold}"/>`
      + `<rect x="30" y="5" width="14" height="5" rx="1" fill="${gold}"/>`
      + `<rect x="26" y="14" width="8" height="11" rx="1" fill="${gold}"/>`
      + `<rect x="4" y="12" width="10" height="7" rx="1" fill="${gold}"/>`;
  }
  return `<svg viewBox="0 0 64 28" width="64" height="28" aria-hidden="true">${body}</svg>`;
}

// ---------------------------------------------------------------- formatting
function $(id) {
  return document.getElementById(id);
}

function fmtMoney(n) {
  return '$' + Math.floor(n || 0).toLocaleString('en-US');
}

function fmtClock(playSeconds) {
  // In-game clock starts DAY 1 18:36 and advances with play time.
  const totalMin = 18 * 60 + 36 + Math.floor((playSeconds || 0) / 60);
  const day = 1 + Math.floor(totalMin / 1440);
  const mins = ((totalMin % 1440) + 1440) % 1440;
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return `DAY ${day}  ${hh}:${mm}`;
}

function fmtTimer(seconds) {
  const s = Math.max(0, Math.ceil(seconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function setText(node, key, value) {
  if (last[key] !== value) {
    last[key] = value;
    node.textContent = value;
  }
}

function carPosOf(car) {
  if (!car) return null;
  if (car.mesh && car.mesh.position) return car.mesh.position;
  if (car.pos) return car.pos;
  if (typeof car.x === 'number' && typeof car.z === 'number') return car;
  return null;
}

// ---------------------------------------------------------------- score popups
function injectHudStyle() {
  if (document.getElementById('hud-rebuild-style')) return;
  const st = document.createElement('style');
  st.id = 'hud-rebuild-style';
  st.textContent = `
#score-popups { position: absolute; left: 50%; top: 34%; transform: translateX(-50%); text-align: center; pointer-events: none; z-index: 6; }
.score-pop { font: 800 30px system-ui, sans-serif; letter-spacing: 1px; color: #f2c230; text-shadow: 0 2px 0 #000, 0 0 18px rgba(242,194,48,.7); animation: poprise 1.5s ease-out forwards; margin: 2px 0; }
.score-pop small { display: block; font-size: 15px; letter-spacing: 2px; color: #f5efe0; }
.score-pop.nearmiss { color: #8fe388; text-shadow: 0 2px 0 #000, 0 0 18px rgba(126,200,80,.8); }
.score-pop.damage { color: #ff6a5a; text-shadow: 0 2px 0 #000, 0 0 18px rgba(229,72,77,.8); }
.score-pop.cash { color: #8fe388; }
.score-pop.held { animation: none; opacity: 1; transform: none; }
/* Dialogue sits higher so it never covers the speedometer dial. */
#dialogue { bottom: 150px; }
@keyframes poprise { 0% { transform: scale(.6); opacity: 0; } 12% { transform: scale(1.15); opacity: 1; } 25% { transform: scale(1); } 70% { opacity: 1; } 100% { transform: translateY(-34px) scale(1); opacity: 0; } }
#speed-gauge { display: block; margin: 0 auto 2px; }
#nitro-lamp { font: 800 12px ui-monospace, Menlo, monospace; letter-spacing: 2px; color: rgba(245,239,224,.25); margin-top: 2px; }
#nitro-lamp.on { color: #ff9a3c; text-shadow: 0 0 10px rgba(255,154,60,.9); }
#dialogue-portrait svg { display: block; border-radius: 50%; }
.char .face svg { display: block; border-radius: 50%; }
/* GTA-style radio badge (in-car notification, top-left under the mission
   panel) + top-right weapon panel (current weapon + ammo, GTA layout). */
#radio { display: none; }
#radio-badge { position: absolute; left: 12px; top: 178px; background: var(--panel); border: 1px solid rgba(242,194,48,.55); border-radius: 6px; padding: 7px 12px; min-width: 230px; }
#radio-badge .rb-name { font: 800 15px var(--font-ui); color: var(--gold); letter-spacing: 1px; }
#radio-badge .rb-sub { font: 600 11px var(--font-read); color: var(--muted); margin-top: 2px; }
#radio-badge .rb-hint { font: 600 9px var(--font-read); color: rgba(245,239,224,.45); letter-spacing: 1px; margin-top: 3px; }
#weapon-panel { display: flex; gap: 8px; align-items: center; justify-content: flex-end; background: var(--panel); border: 1px solid rgba(242,194,48,.55); border-radius: 6px; padding: 6px 10px; margin-top: 8px; }
#weapon-panel .wp-name { font: 800 14px var(--font-ui); color: var(--gold); letter-spacing: 1px; text-align: right; }
#weapon-panel .wp-ammo { font: 800 20px var(--font-read); color: var(--ink); text-align: right; line-height: 1.1; }
#weapon-panel .wp-ammo small { font-size: 10px; color: var(--muted); }
#weapon-panel .wp-hint { font: 600 9px var(--font-read); color: rgba(245,239,224,.45); letter-spacing: 1px; text-align: right; margin-top: 2px; }
#weapon-panel .wp-sil svg { display: block; }
.wslot.active { border-color: var(--gold); border-width: 2px; color: var(--gold); background: rgba(242,194,48,.16); }
.wslot.active .ammo { color: var(--gold); font-weight: 700; }
/* Progression strip (progression.js): idols, REP bar, skills, jetpack, side job.
   Lives under the radio badge so the dense HUD layout is untouched. */
#prog-panel { position: absolute; left: auto; right: 12px; top: 182px; width: 236px; background: var(--panel); border: 1px solid rgba(242,194,48,.55); border-radius: 6px; padding: 7px 10px; font: 600 11px var(--font-read); color: var(--ink); line-height: 1.55; z-index: 5; }
#prog-panel .pp-row { display: flex; justify-content: space-between; gap: 6px; }
#prog-panel .pp-gold { color: var(--gold); font-weight: 800; }
#prog-panel .pp-bar { height: 5px; background: rgba(245,239,224,.18); border-radius: 3px; overflow: hidden; margin: 2px 0 3px; }
#prog-panel .pp-bar i { display: block; height: 100%; background: #f2c230; }
#prog-panel .pp-next { color: var(--muted); font-size: 10px; }
#prog-panel .pp-skills { font-size: 10px; color: var(--muted); letter-spacing: .5px; margin-top: 2px; }
#prog-panel .pp-jet { color: #7ec8e8; margin-top: 2px; }
#prog-panel .pp-side { color: #8fe388; margin-top: 2px; }`;
  document.head.appendChild(st);
}

// Push a big on-screen score popup: "DRIFT x3", "NEAR MISS +$250", "-34", ...
export function pushScorePopup(G, text, kind, sub) {
  const layer = el.popups;
  if (!layer) return;
  const div = document.createElement('div');
  div.className = 'score-pop' + (kind ? ` ${kind}` : '');
  div.textContent = text;
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    div.appendChild(s);
  }
  layer.appendChild(div);
  // In a staged shot the simulation is frozen and the screenshot lands ~1s
  // after staging: the popup must sit still and stay visible (the rise/fade
  // animation would finish and leave opacity 0 before the shutter).
  if (G && G.shotMode) div.classList.add('held');
  const rec = { el: div, born: performance.now(), key: `${text}|${performance.now()}` };
  popups.push(rec);
  // In a staged shot the simulation is frozen and the screenshot lands ~1s
  // after staging, so popups must outlive the shot; in live play they fade.
  const life = (G && G.shotMode) ? 60000 : 1550;
  setTimeout(() => {
    if (div.parentNode) div.parentNode.removeChild(div);
    popups = popups.filter((p) => p !== rec);
  }, life);
  void G;
}

// Read drift / near-miss state the gameplay layer exposes on G (if any) and
// turn fresh events into popups. Every source is optional — a build without
// drift state simply shows no drift popups.
function pollScoreEvents(G) {
  const d = G.driving || {};
  // Gameplay form (the authoritative source): G.driving.score.popups =
  // [{ text, ttl, max }] — pushed by driving.js on drift payout / near miss.
  // Render each popup object once, tracked by identity (driving.js prunes
  // the array when ttl expires, so the WeakSet entries are collected).
  const score = d.score;
  if (score && Array.isArray(score.popups)) {
    for (const p of score.popups) {
      if (!p || typeof p.text !== 'string') continue;
      if (shownScorePopups.has(p)) continue;
      shownScorePopups.add(p);
      const kind = p.text.startsWith('DRIFT') ? 'drift' : p.text.startsWith('NEAR MISS') ? 'nearmiss' : '';
      pushScorePopup(G, p.text, kind, '');
    }
  }
  // Array form: G.scorePopups = [{ id, text, kind, sub }]
  if (Array.isArray(G.scorePopups)) {
    for (const ev of G.scorePopups) {
      if (!ev || typeof ev.text !== 'string') continue;
      const key = ev.id != null ? String(ev.id) : `${ev.text}|${ev.at || ''}`;
      if (!seenScoreKeys.has(key)) {
        seenScoreKeys.add(key);
        pushScorePopup(G, ev.text, ev.kind || '', ev.sub || '');
      }
    }
    if (seenScoreKeys.size > 60) {
      const keep = Array.from(seenScoreKeys).slice(-40);
      seenScoreKeys = new Set(keep);
    }
  }
  // Drift chain form: G.driving.drift = { chain, active, total }
  const drift = d.drift;
  if (drift && typeof drift.chain === 'number') {
    const key = `drift|${drift.chain}`;
    if (drift.active && drift.chain >= 2 && last.driftKey !== key) {
      last.driftKey = key;
      pushScorePopup(G, `DRIFT x${drift.chain}`, 'drift', drift.total ? `+$${drift.total}` : '');
    }
    if (!drift.active) last.driftKey = '';
  }
  // Near-miss form: G.driving.nearMiss = { amount, at } (at = monotonic stamp)
  const nm = d.nearMiss;
  if (nm && typeof nm.amount === 'number' && nm.at != null && last.nearMissAt !== nm.at) {
    last.nearMissAt = nm.at;
    pushScorePopup(G, 'NEAR MISS', 'nearmiss', `+$${nm.amount}`);
  }
}

// ---------------------------------------------------------------- speedometer
function drawGauge(kmh, nitroOn, nitroOwned) {
  if (!gaugeCtx) return;
  const c = gaugeCtx;
  const W = 150, H = 78;
  const cx = W / 2, cy = 68, R = 54;
  c.clearRect(0, 0, W, H);
  const a0 = Math.PI * 1.0, a1 = Math.PI * 2.0; // 180-degree sweep, left -> right
  // Dial arc.
  c.lineWidth = 9;
  c.strokeStyle = 'rgba(245,239,224,0.22)';
  c.beginPath();
  c.arc(cx, cy, R, a0, a1);
  c.stroke();
  // Redline arc (180+ km/h).
  const redStart = a0 + (180 / 240) * Math.PI;
  c.strokeStyle = '#e5484d';
  c.beginPath();
  c.arc(cx, cy, R, redStart, a1);
  c.stroke();
  // Ticks every 20 km/h, labels every 60.
  const vMax = 240;
  c.fillStyle = 'rgba(245,239,224,0.75)';
  c.font = '700 9px ui-monospace, Menlo, monospace';
  c.textAlign = 'center';
  for (let v = 0; v <= vMax; v += 20) {
    const a = a0 + (v / vMax) * Math.PI;
    const x1 = cx + Math.cos(a) * (R - 8), y1 = cy + Math.sin(a) * (R - 8);
    const x2 = cx + Math.cos(a) * (R - 14), y2 = cy + Math.sin(a) * (R - 14);
    c.strokeStyle = v >= 180 ? '#e5484d' : 'rgba(245,239,224,0.7)';
    c.lineWidth = v % 60 === 0 ? 2.5 : 1.2;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
    if (v % 60 === 0) {
      c.fillText(String(v), cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22) + 3);
    }
  }
  // Needle.
  const na = a0 + (Math.min(vMax, Math.max(0, kmh)) / vMax) * Math.PI;
  c.strokeStyle = '#f2c230';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(cx, cy);
  c.lineTo(cx + Math.cos(na) * (R - 16), cy + Math.sin(na) * (R - 16));
  c.stroke();
  c.fillStyle = '#f2c230';
  c.beginPath();
  c.arc(cx, cy, 5, 0, Math.PI * 2);
  c.fill();
  // Nitro lamp is a DOM element below the gauge; the dial shows a small
  // flame tick when nitro is lit.
  if (nitroOn) {
    c.fillStyle = '#ff9a3c';
    c.font = '800 11px system-ui, sans-serif';
    c.fillText('NITRO', cx, cy - R + 12);
  }
  void nitroOwned;
}

// ---------------------------------------------------------------- init
export function initHUD(G) {
  injectHudStyle();
  el.missionCode = $('mission-code');
  el.missionName = $('mission-name');
  el.missionStage = $('mission-stage');
  el.missionObjective = $('mission-objective');
  el.missionTimer = $('mission-timer');
  el.missionNext = $('mission-next');
  el.wanted = $('wanted');
  el.stars = Array.from(el.wanted ? el.wanted.querySelectorAll('span') : []);
  el.money = $('money');
  el.clock = $('game-clock');
  el.policeList = $('police-list');
  el.policeUnits = $('police-units');
  el.district = $('district');
  el.healthFill = $('health-fill');
  el.healthNum = $('health-num');
  el.armourFill = $('armour-fill');
  el.armourNum = $('armour-num');
  el.weaponRack = $('weapon-rack');
  el.speed = $('speed');
  el.vehicleName = $('vehicle-name');
  el.radio = $('radio');
  el.dialogue = $('dialogue');
  el.portrait = $('dialogue-portrait');
  el.speaker = $('dialogue-speaker');
  el.dialogueText = $('dialogue-text');
  el.crosshair = $('crosshair');
  el.prompt = $('prompt');
  el.toast = $('toast');
  el.damage = $('damage');

  // Score-popup layer, centred above the dialogue box.
  const hud = $('hud');
  if (hud && !$('score-popups')) {
    const layer = document.createElement('div');
    layer.id = 'score-popups';
    hud.appendChild(layer);
  }
  el.popups = $('score-popups');

  // Speedometer gauge canvas + nitro lamp, inserted above the digital readout.
  const drivePanel = $('drive-panel');
  if (drivePanel && !$('speed-gauge')) {
    const gauge = document.createElement('canvas');
    gauge.id = 'speed-gauge';
    gauge.width = 150;
    gauge.height = 78;
    drivePanel.insertBefore(gauge, el.speed);
    const lamp = document.createElement('div');
    lamp.id = 'nitro-lamp';
    lamp.textContent = '◆ NITRO';
    drivePanel.insertBefore(lamp, el.speed);
  }
  const gaugeEl = $('speed-gauge');
  gaugeCtx = gaugeEl ? gaugeEl.getContext('2d') : null;
  el.nitroLamp = $('nitro-lamp');

  // GTA-style top-right weapon panel (current weapon + ammo), under money/clock.
  const topRight = $('top-right');
  if (topRight && !$('weapon-panel')) {
    const wp = document.createElement('div');
    wp.id = 'weapon-panel';
    wp.innerHTML = '<div class="wp-sil"></div><div><div class="wp-name"></div><div class="wp-ammo"></div><div class="wp-hint">R — RELOAD</div></div>';
    topRight.appendChild(wp);
  }
  el.weaponPanel = $('weapon-panel');
  el.wpSil = el.weaponPanel ? el.weaponPanel.querySelector('.wp-sil') : null;
  el.wpName = el.weaponPanel ? el.weaponPanel.querySelector('.wp-name') : null;
  el.wpAmmo = el.weaponPanel ? el.weaponPanel.querySelector('.wp-ammo') : null;

  // GTA-style radio badge (in-car notification, top-left under the mission
  // panel): station name + genre/BPM + switch hint. Replaces the small
  // drive-panel radio line (hidden by CSS above).
  if (hud && !$('radio-badge')) {
    const rb = document.createElement('div');
    rb.id = 'radio-badge';
    rb.innerHTML = '<div class="rb-name"></div><div class="rb-sub"></div><div class="rb-hint">R — CHANGE STATION</div>';
    hud.appendChild(rb);
  }
  el.radioBadge = $('radio-badge');
  el.rbName = el.radioBadge ? el.radioBadge.querySelector('.rb-name') : null;
  el.rbSub = el.radioBadge ? el.radioBadge.querySelector('.rb-sub') : null;

  // Progression strip (progression.js): idols, REP bar + NEXT, skills pips,
  // jetpack fuel (only if G.jetpack exists), active side-job line.
  if (hud && !$('prog-panel')) {
    const pp = document.createElement('div');
    pp.id = 'prog-panel';
    pp.innerHTML = '<div class="pp-row"><span>DORADA IDOLS</span><span class="pp-gold" id="pp-idols">0/20</span></div>'
      + '<div class="pp-row"><span>REP <span class="pp-gold" id="pp-rep-lv">LV 1</span></span><span id="pp-rep-xp">0/500 XP</span></div>'
      + '<div class="pp-bar"><i id="pp-rep-bar" style="width:0%"></i></div>'
      + '<div class="pp-next" id="pp-rep-next"></div>'
      + '<div class="pp-skills" id="pp-skills"></div>'
      + '<div class="pp-jet hidden" id="pp-jet"></div>'
      + '<div class="pp-side hidden" id="pp-side"></div>';
    hud.appendChild(pp);
  }
  el.ppIdols = $('pp-idols');
  el.ppRepLv = $('pp-rep-lv');
  el.ppRepXp = $('pp-rep-xp');
  el.ppRepBar = $('pp-rep-bar');
  el.ppRepNext = $('pp-rep-next');
  el.ppSkills = $('pp-skills');
  el.ppJet = $('pp-jet');
  el.ppSide = $('pp-side');

  // Build the 4 weapon-rack slots once from WEAPONS.
  weaponSlots = [];
  if (el.weaponRack) {
    el.weaponRack.innerHTML = '';
    WEAPONS.forEach((w, i) => {
      const slot = document.createElement('div');
      slot.className = 'wslot' + (i === 0 ? ' active' : '');
      slot.innerHTML = `${w.name}<span class="ammo">${w.ammo}</span>`;
      el.weaponRack.appendChild(slot);
      weaponSlots.push(slot);
    });
  }
  last = {};
  popups = [];
  seenScoreKeys = new Set();
  void G;
}

export function renderHUD(G) {
  if (!el.money || !G.player) return;
  const p = G.player;
  const m = G.missions || {};
  const idx = typeof m.index === 'number' ? m.index : 0;
  const def = MISSIONS[idx] || MISSIONS[0];

  // --- mission panel ---
  setText(el.missionCode, 'code', def.code || `JOB ${idx + 1}/8`);
  setText(el.missionName, 'name', m.title || def.name || '');
  setText(el.missionStage, 'stage', `STAGE ${m.stage || 1}/${m.stageCount || 3}`);
  setText(el.missionObjective, 'objective', m.objective || def.objective || '');
  const timer = m.timer || 0;
  if (el.missionTimer) {
    const show = timer > 0;
    if (last.timerVisible !== show) {
      last.timerVisible = show;
      el.missionTimer.classList.toggle('hidden', !show);
    }
    if (show) setText(el.missionTimer, 'timer', fmtTimer(timer));
  }
  const nextDef = MISSIONS[idx + 1];
  setText(el.missionNext, 'next', nextDef ? `NEXT: ${nextDef.code} — ${nextDef.name}` : 'NEXT: FREEDOM');

  // --- wanted stars ---
  const wanted = (G.police && typeof G.police.wanted === 'number' ? G.police.wanted : 0);
  if (last.wanted !== wanted) {
    last.wanted = wanted;
    el.stars.forEach((span, i) => span.classList.toggle('off', i >= wanted));
  }

  // --- money + clock ---
  setText(el.money, 'money', fmtMoney(p.money));
  setText(el.clock, 'clock', fmtClock(G.stats ? G.stats.playSeconds : 0));

  // --- police list (only while wanted) ---
  if (el.policeList) {
    const show = wanted > 0;
    if (last.policeVisible !== show) {
      last.policeVisible = show;
      el.policeList.classList.toggle('hidden', !show);
    }
    if (show && el.policeUnits) {
      const units = (G.police && Array.isArray(G.police.units)) ? G.police.units : [];
      const sig = units.map((u) => `${u.name}|${Math.round(u.dist || 0)}|${u.status || ''}`).join(';');
      if (last.policeSig !== sig) {
        last.policeSig = sig;
        el.policeUnits.innerHTML = units.map((u) =>
          `<div class="police-row"><span>${u.name || 'UNIT'}</span>` +
          `<span>${Math.round(u.dist || 0)}m</span>` +
          `<span class="st">${u.status || ''}</span></div>`).join('');
      }
    }
  }

  // --- district ---
  if (el.district && p.pos) {
    setText(el.district, 'district', districtAt(p.pos.x, p.pos.z).name);
  }

  // --- vitals (health bar scales to maxHealth: REP level-ups and Stamina
  // pips raise the cap above 100 via progression.js) ---
  const maxHealth = Math.max(1, p.maxHealth || 100);
  const health = Math.max(0, Math.min(maxHealth, Math.round(p.health || 0)));
  const healthPct = Math.max(0, Math.min(100, Math.round((health / maxHealth) * 100)));
  const armour = Math.max(0, Math.min(100, Math.round(p.armour || 0)));
  if (last.health !== healthPct || last.healthNum !== health) {
    last.health = healthPct;
    last.healthNum = health;
    if (el.healthFill) el.healthFill.style.width = `${healthPct}%`;
    if (el.healthNum) el.healthNum.textContent = String(health);
  }
  if (last.armour !== armour) {
    last.armour = armour;
    if (el.armourFill) el.armourFill.style.width = `${armour}%`;
    if (el.armourNum) el.armourNum.textContent = String(armour);
  }

  // --- weapon rack (mag/reserve when the combat build tracks them,
  // otherwise the total ammo combat.js actually stores) ---
  const wi = (G.combat && typeof G.combat.weaponIndex === 'number') ? G.combat.weaponIndex : 0;
  weaponSlots.forEach((slot, i) => {
    const cw = (G.combat && G.combat.weapons && G.combat.weapons[i]) || null;
    const ammo = cw ? cw.ammo : WEAPONS[i].ammo;
    const disp = (cw && typeof cw.mag === 'number')
      ? `${cw.mag}/${typeof cw.reserve === 'number' ? cw.reserve : 0}` : String(ammo);
    const key = `wslot${i}`;
    const sig = `${i === wi ? 'a' : ''}|${disp}`;
    if (last[key] !== sig) {
      last[key] = sig;
      slot.classList.toggle('active', i === wi);
      const ammoEl = slot.querySelector('.ammo');
      if (ammoEl) ammoEl.textContent = disp;
    }
  });

  // --- GTA-style top-right weapon panel: current weapon + ammo ---
  if (el.weaponPanel) {
    const w = (G.combat && G.combat.weapons && G.combat.weapons[wi])
      ? G.combat.weapons[wi] : WEAPONS[wi];
    const wammo = (G.combat && G.combat.weapons && G.combat.weapons[wi])
      ? G.combat.weapons[wi].ammo : WEAPONS[wi].ammo;
    // Mag/reserve "32/160" when present; combat.js currently stores only
    // total `ammo`, so that is what shows until a mag/reserve build lands.
    const wdisp = (w && typeof w.mag === 'number')
      ? `${w.mag}/${typeof w.reserve === 'number' ? w.reserve : 0}` : String(wammo);
    const wlabel = (w && typeof w.mag === 'number') ? 'MAG' : 'AMMO';
    const wsig = `${wi}|${wdisp}`;
    if (last.wpSig !== wsig) {
      last.wpSig = wsig;
      if (el.wpSil) el.wpSil.innerHTML = weaponSVG(w.name);
      if (el.wpName) el.wpName.textContent = String(w.name || '').toUpperCase();
      if (el.wpAmmo) el.wpAmmo.innerHTML = `${wdisp} <small>${wlabel}</small>`;
    }
  }

  // --- drive panel: gauge + digital speed + nitro lamp ---
  const inCar = p.mode === 'car' && G.driving && G.driving.car;
  const speedMs = inCar ? Math.abs(G.driving.speed || 0) : Math.abs(p.speed || 0);
  const kmh = Math.round(speedMs * 3.6);
  const carObj = inCar ? G.driving.car : null;
  const nitroOwned = (G.garage && G.garage.owned && G.garage.owned.nitro) > 0;
  const nitroOn = !!(carObj && carObj.nitroTimer > 0);
  if (last.kmh !== kmh || last.nitroOn !== nitroOn) {
    last.kmh = kmh;
    last.nitroOn = nitroOn;
    if (el.speed) el.speed.innerHTML = `${kmh} <small>KM/H</small>`;
    drawGauge(kmh, nitroOn, nitroOwned);
    if (el.nitroLamp) {
      el.nitroLamp.classList.toggle('on', nitroOn);
      el.nitroLamp.textContent = nitroOn ? '◆ NITRO BURNING' : (nitroOwned ? '◆ NITRO READY' : '◆ NITRO — NOT INSTALLED');
    }
  }
  const vname = carObj ? (carObj.name || (carObj.def && carObj.def.name) || carObj.model || 'CAR') : 'ON FOOT';
  setText(el.vehicleName, 'vname', vname);
  const ri = (G.audio && typeof G.audio.radioIndex === 'number') ? G.audio.radioIndex : 0;
  const station = RADIO[ri] || RADIO[0];
  // Radio badge (in-car only, GTA-style notification): station + genre/BPM.
  if (el.radioBadge) {
    const showRadio = inCar;
    if (last.radioVisible !== showRadio) {
      last.radioVisible = showRadio;
      el.radioBadge.classList.toggle('hidden', !showRadio);
    }
    if (showRadio) {
      const rsig = `${ri}`;
      if (last.radioSig !== rsig) {
        last.radioSig = rsig;
        if (el.rbName) el.rbName.textContent = `♪ ${station.name}`;
        if (el.rbSub) el.rbSub.textContent = `${station.genre} · ${station.bpm} BPM`;
      }
    }
  }

  // --- progression strip: idols, REP bar + NEXT, skills pips, jetpack
  // fuel (only when G.jetpack exists), active side-job objective ---
  if (el.ppIdols && G.progression) {
    const pr = G.progression;
    const c = pr.collectibles || {};
    setText(el.ppIdols, 'ppIdols', `${c.found || 0}/${c.total || 20}`);
    const rep = pr.rep || { level: 1, xp: 0, xpNext: 500, nextUnlock: '' };
    setText(el.ppRepLv, 'ppRepLv', `LV ${rep.level || 1}`);
    setText(el.ppRepXp, 'ppRepXp', `${Math.floor(rep.xp || 0)}/${rep.xpNext || 500} XP`);
    const repPct = Math.max(0, Math.min(100, Math.round(((rep.xp || 0) / (rep.xpNext || 500)) * 100)));
    if (last.ppRepBar !== repPct) {
      last.ppRepBar = repPct;
      if (el.ppRepBar) el.ppRepBar.style.width = `${repPct}%`;
    }
    setText(el.ppRepNext, 'ppRepNext', `NEXT: ${rep.nextUnlock || ''}`);
    const sk = pr.skills || {};
    const pip = (n) => '●'.repeat(Math.max(0, Math.min(5, n || 0))) + '○'.repeat(5 - Math.max(0, Math.min(5, n || 0)));
    setText(el.ppSkills, 'ppSkills',
      `DRV ${pip(sk.driving)} AIM ${pip(sk.aim)} INF ${pip(sk.influence)} STA ${pip(sk.stamina)} STL ${pip(sk.stealth)} STR ${pip(sk.street)}`);
  }
  if (el.ppJet) {
    const jp = G.jetpack;
    const showJet = !!(jp && typeof jp.fuel === 'number' && typeof jp.maxFuel === 'number' && jp.maxFuel > 0);
    if (last.ppJetVisible !== showJet) {
      last.ppJetVisible = showJet;
      el.ppJet.classList.toggle('hidden', !showJet);
    }
    if (showJet) {
      const pct = Math.max(0, Math.min(100, Math.round((jp.fuel / jp.maxFuel) * 100)));
      const blocks = Math.round(pct / 20);
      setText(el.ppJet, 'ppJet', `JETPACK ${'█'.repeat(blocks)}${'░'.repeat(5 - blocks)} ${pct}%`);
    }
  }
  if (el.ppSide) {
    const sj = G.sideJobs && G.sideJobs.active;
    const showSide = !!(sj && sj.name);
    if (last.ppSideVisible !== showSide) {
      last.ppSideVisible = showSide;
      el.ppSide.classList.toggle('hidden', !showSide);
    }
    if (showSide) {
      const timer = (typeof sj.timer === 'number' && sj.timer > 0) ? ` · ${fmtTimer(sj.timer)}` : '';
      const payout = (typeof sj.payout === 'number') ? ` ($${sj.payout.toLocaleString('en-US')})` : '';
      setText(el.ppSide, 'ppSide', `SIDE JOB: ${sj.name} — ${sj.objective || ''}${payout}${timer}`);
    }
  }

  // --- score popups from gameplay state (drift / near-miss / queued events) ---
  pollScoreEvents(G);

  // --- crosshair: on foot, in play mode only ---
  if (el.crosshair) {
    const show = G.mode === 'play' && p.mode === 'foot';
    if (last.crosshair !== show) {
      last.crosshair = show;
      el.crosshair.classList.toggle('hidden', !show);
    }
  }

  // --- prompt: 'E — STEAL CAR' within 5 m of a car; otherwise, on foot with the
  // pointer unlocked, a hint to click and aim (suppressed in staged shots) ---
  if (el.prompt) {
    let mode = 'none';
    if (p.mode === 'foot' && p.pos) {
      const cars = [];
      if (G.driving && Array.isArray(G.driving.parked)) cars.push(...G.driving.parked);
      if (G.traffic && Array.isArray(G.traffic.cars)) cars.push(...G.traffic.cars);
      for (const carItem of cars) {
        const cp = carPosOf(carItem);
        if (!cp) continue;
        const dx = cp.x - p.pos.x;
        const dz = cp.z - p.pos.z;
        if (dx * dx + dz * dz <= 25) { mode = 'steal'; break; }
      }
      if (mode === 'none' && !Input.pointerLocked && !G.shotMode) mode = 'aim';
      // Ownable property nearby: E is consumed by player.js (car steal),
      // so buying happens from the map (M) — the prompt says so.
      if ((mode === 'aim' || mode === 'none') && G.progression && Array.isArray(G.progression.properties) && p.pos) {
        for (const prop of G.progression.properties) {
          if (prop.owned) continue;
          const dx = prop.x - p.pos.x;
          const dz = prop.z - p.pos.z;
          if (dx * dx + dz * dz <= 36) { mode = 'property'; last.propId = prop.id; break; }
        }
      }
    }
    if (last.prompt !== mode) {
      last.prompt = mode;
      el.prompt.classList.toggle('hidden', mode === 'none');
      let text = '';
      if (mode === 'steal') text = 'E — STEAL CAR';
      else if (mode === 'aim') text = 'CLICK TO AIM WITH MOUSE';
      else if (mode === 'property') {
        const prop = G.progression.properties.find((x) => x.id === last.propId);
        text = prop ? `PROPERTY NEARBY — OPEN MAP (M) TO BUY ${prop.name.toUpperCase()} $${prop.price.toLocaleString('en-US')}` : '';
      }
      el.prompt.textContent = text;
    }
  }

  // --- damage vignette ---
  if (el.damage) {
    const opacity = health < 40 ? ((40 - health) / 40) * 0.9 : 0;
    const rounded = Math.round(opacity * 100) / 100;
    if (last.damage !== rounded) {
      last.damage = rounded;
      el.damage.style.opacity = String(rounded);
    }
  }
}

export function showDialogue(G, speaker, text, ms) {
  if (!el.dialogue) return;
  if (dialogueTimer) { clearTimeout(dialogueTimer); dialogueTimer = null; }
  if (el.speaker) el.speaker.textContent = speaker || '';
  if (el.dialogueText) el.dialogueText.textContent = text || '';
  if (el.portrait) el.portrait.innerHTML = portraitSVG(speaker);
  el.dialogue.classList.remove('hidden');
  dialogueTimer = setTimeout(() => {
    if (el.dialogue) el.dialogue.classList.add('hidden');
    dialogueTimer = null;
  }, typeof ms === 'number' ? ms : 4000);
  void G;
}

export function flashToast(G, text) {
  if (!el.toast) return;
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  el.toast.textContent = text || '';
  el.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => {
    if (el.toast) el.toast.classList.add('hidden');
    toastTimer = null;
  }, 2500);
  void G;
}
