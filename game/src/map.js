// Isla Dorada — full city map screen (rebuild, #map-canvas 640x640): sea,
// island, district washes + labels, roads, landmark markers, player arrow
// and the mission marker. Also refreshes the job checklist and run stats
// from live G. drawMap reads live values every call (no caching) — shots.js
// calls it directly after staging stats. Rebuild: brighter island fill so
// the map reads at a glance, a compass rose, and stats that also show the
// wanted level and cash alongside the measured run numbers.
import { DISTRICTS, MISSIONS, WORLD, KEYS, UPGRADES } from './config.js';
import { Input } from './input.js';
import { buyProperty, pips, SKILL_DEFS } from './progression.js';

let canvas = null;
let ctx = null;
let checklistEl = null;
let currentJobEl = null;
let statsEl = null;
let legendEl = null;
let progEl = null;
let garageEl = null;
let currentRoads = null;

// SIDEJOB_LEGEND lives in sidejobs.js, which another agent is creating in
// parallel — it may not exist yet. A static import would break the whole
// module (and the boot) while the file is missing, so it is loaded
// dynamically and the legend renders its entries as soon as they arrive.
let sideJobLegend = null;
let sideJobLoading = false;
function ensureSideJobLegend() {
  if (sideJobLegend || sideJobLoading) return;
  sideJobLoading = true;
  import('./sidejobs.js').then((m) => {
    sideJobLegend = Array.isArray(m.SIDEJOB_LEGEND) ? m.SIDEJOB_LEGEND : null;
  }).catch(() => {
    sideJobLegend = null; // not landed yet — legend renders without it
  }).finally(() => {
    sideJobLoading = false;
  });
}

const SIZE = 640;
const SCALE = SIZE / WORLD.size; // px per metre

function toPx(v) {
  return (v + WORLD.size / 2) * SCALE;
}

function posOf(o) {
  if (!o) return null;
  if (o.position && typeof o.position.x === 'number') return { x: o.position.x, z: o.position.z };
  if (o.pos && typeof o.pos.x === 'number') return { x: o.pos.x, z: o.pos.z };
  if (typeof o.x === 'number' && typeof o.z === 'number') return { x: o.x, z: o.z };
  return null;
}

function drawRoads(c) {
  c.strokeStyle = '#565d6e';
  c.lineCap = 'round';
  const roadW = Math.max(3, WORLD.roadWidth * SCALE);
  c.lineWidth = roadW;
  let drew = false;
  const rs = currentRoads;
  if (Array.isArray(rs) && rs.length) {
    for (const r of rs) {
      c.beginPath();
      if (typeof r.x1 === 'number' && typeof r.z1 === 'number'
          && typeof r.x2 === 'number' && typeof r.z2 === 'number') {
        c.moveTo(toPx(r.x1), toPx(r.z1));
        c.lineTo(toPx(r.x2), toPx(r.z2));
      } else if (typeof r.x === 'number' && typeof r.z === 'number'
          && typeof r.angle === 'number' && typeof r.len === 'number') {
        const dx = Math.sin(r.angle) * r.len / 2;
        const dz = Math.cos(r.angle) * r.len / 2;
        c.moveTo(toPx(r.x - dx), toPx(r.z - dz));
        c.lineTo(toPx(r.x + dx), toPx(r.z + dz));
      } else if (Array.isArray(r.points) && r.points.length > 1) {
        r.points.forEach((pt, i) => {
          const q = posOf(pt);
          if (!q) return;
          if (i === 0) c.moveTo(toPx(q.x), toPx(q.z));
          else c.lineTo(toPx(q.x), toPx(q.z));
        });
      } else if (typeof r.x === 'number' && typeof r.z === 'number') {
        c.arc(toPx(r.x), toPx(r.z), roadW / 2, 0, Math.PI * 2);
      } else {
        continue;
      }
      c.stroke();
      drew = true;
    }
  }
  if (!drew) {
    // Fallback: the regular city grid from WORLD constants.
    c.lineWidth = roadW;
    for (let v = -WORLD.size / 2; v <= WORLD.size / 2; v += WORLD.roadGap) {
      c.beginPath(); c.moveTo(toPx(v), 0); c.lineTo(toPx(v), SIZE); c.stroke();
      c.beginPath(); c.moveTo(0, toPx(v)); c.lineTo(SIZE, toPx(v)); c.stroke();
    }
  }
}

function drawDiamond(c, x, y, r, color) {
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x, y - r);
  c.lineTo(x + r, y);
  c.lineTo(x, y + r);
  c.lineTo(x - r, y);
  c.closePath();
  c.fill();
}

// Places on the map: [landmark key, label, marker shape, marker colour].
// Every entry is a real location in the city (city.js LANDMARK_SPOTS) —
// the legend is built from this same table, so it can never point at a
// place that does not exist. Shapes: dot = gold circle, star = casino,
// square = gas station, diamond = restaurant.
// Exported: the minimap draws the same table, so it can never drift.
export const POIS = [
  ['casino', 'CASINO DORADA', 'star', '#f2c230'],
  ['station', 'IDPD STATION', 'dot', '#f2c230'],
  ['marina', 'MARINA', 'dot', '#f2c230'],
  ['warehouse', 'WAREHOUSE', 'dot', '#f2c230'],
  ['garage', 'GARAGE', 'dot', '#f2c230'],
  ['impound', 'IMPOUND', 'dot', '#f2c230'],
  ['causeway', 'CAUSEWAY', 'dot', '#f2c230'],
  ['harbor', 'HARBOR', 'dot', '#f2c230'],
  ['ferrisWheel', 'FERRIS WHEEL', 'dot', '#f2c230'],
  // V5 F12: the Beachfront column was a tall empty gold strip — the
  // BOARDWALK and BEACH are real city landmarks (city.js LANDMARK_SPOTS)
  // that had no map markers. Both sit on the west strip; different shapes
  // (dot vs star) so the two adjacent markers still read as two places.
  ['boardwalk', 'BOARDWALK', 'dot', '#f2c230'],
  ['beach', 'BEACH', 'star', '#f2c230'],
  ['gas', 'GAS STATION', 'square', '#ff8a3a'],
  ['restaurant', 'RESTAURANT', 'diamond', '#ff6ab0'],
];

// Where each of the 8 story jobs lives (stage 1 of missions.js — the job's
// home location). Several jobs share a place, so the badges are drawn as a
// row above the spot. States come from live G: done = green, current =
// gold, next = cream. Exported: the minimap draws the same badges.
export const JOB_SPOTS = {
  casino: [1],
  marina: [2, 6],
  impound: [3],
  causeway: [4, 8],
  warehouse: [5],
  station: [7],
};

export const JOB_DONE = '#58b368';
export const JOB_CURRENT = '#f2c230';
export const JOB_NEXT = '#f5efe0';

function refreshChecklist(G) {
  if (!checklistEl) return;
  const idx = (G.missions && typeof G.missions.index === 'number') ? G.missions.index : 0;
  const done = (G.stats && typeof G.stats.missionsDone === 'number') ? G.stats.missionsDone : 0;
  checklistEl.innerHTML = MISSIONS.map((m, i) => {
    const cls = (i < idx || i < done) ? 'done' : (i === idx ? 'current' : '');
    const mark = (i < idx || i < done) ? '✓ ' : (i === idx ? '▶ ' : '· ');
    // Payout: the same formula missions.js pays on completion
    // (2000 + 500 * (index + 1)) — read from the formula, never hardcoded.
    const pay = (2000 + 500 * (i + 1)).toLocaleString('en-US');
    return `<li class="${cls}">${mark}JOB ${i + 1} — ${m.name} <span class="pay">$${pay}</span></li>`;
  }).join('');
}

// CURRENT JOB panel (HTML, in #map-side): the job in progress, from live G —
// name + stage objective + stage + GPS distance + payout. Same data the HUD
// mission panel and the minimap already show; the map now shows it too, the
// way Halcyon's map shows its CURRENT JOB panel.
function refreshCurrentJob(G) {
  if (!currentJobEl) return;
  const m = G.missions;
  const idx = (m && typeof m.index === 'number') ? m.index : 0;
  if (idx >= MISSIONS.length) {
    currentJobEl.innerHTML =
      `<h3>CURRENT JOB</h3>` +
      `<div class="cj-name">ALL JOBS DONE</div>` +
      `<div class="cj-obj">Isla Dorada is yours, Wowo.</div>` +
      `<div class="cj-meta">8 / 8 COMPLETE</div>`;
    return;
  }
  const def = MISSIONS[idx];
  const stage = (m && typeof m.stage === 'number') ? m.stage : 1;
  const stageCount = (m && typeof m.stageCount === 'number') ? m.stageCount : 3;
  const objective = (m && m.objective) || def.objective || '';
  const pay = (2000 + 500 * (idx + 1)).toLocaleString('en-US');
  // GPS distance to the mission marker — the same formula the minimap uses.
  let gps = '';
  const marker = (m && m.marker) ? posOf(m.marker) : null;
  const player = (G.player && G.player.pos) ? { x: G.player.pos.x, z: G.player.pos.z } : null;
  if (marker && player) {
    const d = Math.round(Math.hypot(marker.x - player.x, marker.z - player.z));
    gps = ` · GPS ${d} m`;
  }
  currentJobEl.innerHTML =
    `<h3>CURRENT JOB</h3>` +
    `<div class="cj-name">JOB ${idx + 1} — ${def.name}</div>` +
    `<div class="cj-obj">${objective}</div>` +
    `<div class="cj-meta">STAGE ${stage}/${stageCount}${gps} · PAYOUT $${pay}</div>`;
}

function refreshStats(G) {
  if (!statsEl) return;
  const s = G.stats || {};
  const totalSec = Math.floor(s.playSeconds || 0);
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  const pct = Math.round(((s.missionsDone || 0) / MISSIONS.length) * 100);
  const wanted = (G.police && typeof G.police.wanted === 'number') ? G.police.wanted : 0;
  const money = G.player ? Math.floor(G.player.money || 0).toLocaleString('en-US') : '0';
  const hours = totalSec >= 3600 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
  // V3-3: garage upgrade prices, read from the real UPGRADES table (never
  // hardcoded) — the map now also shows the garage economy.
  const picks = UPGRADES.filter((u) => ['engine', 'armor', 'nitro', 'paint'].includes(u.id));
  const parts = picks.map((u) => `${u.id.toUpperCase()} $${u.price.toLocaleString('en-US')}`);
  const garage = parts.slice(0, 2).join(' · ') + '<br>' + parts.slice(2).join(' · ');
  statsEl.innerHTML =
    `Cars stolen <b>${s.carsStolen || 0}</b><br>` +
    `IDPD escapes <b>${s.escapes || 0}</b><br>` +
    `Jobs done <b>${s.missionsDone || 0} / ${MISSIONS.length}</b><br>` +
    `Play time <b>${hours}</b><br>` +
    `Cash <b>$${money}</b> &nbsp;·&nbsp; Wanted <b>${'★'.repeat(wanted)}${'☆'.repeat(5 - wanted)}</b><br>` +
    `SAVE SLOT 1 — <b>${pct}% COMPLETE</b><br>` +
    `GARAGE <b>${garage}</b>`;
}

function fmtMoney(n) {
  return '$' + Math.floor(n || 0).toLocaleString('en-US');
}

// PROGRESSION section (map side panel): collectibles, REP, skills pips,
// properties with BUY buttons. Every number is read from live G.progression.
function refreshProgression(G) {
  if (!progEl) return;
  const pr = G.progression;
  if (!pr) {
    progEl.innerHTML = '<h3>PROGRESSION</h3><div>Loading…</div>';
    return;
  }
  const c = pr.collectibles || {};
  const found = c.found || 0;
  const total = c.total || 20;
  const rep = pr.rep || { level: 1, xp: 0, xpNext: 500, nextUnlock: '' };
  const repPct = Math.max(0, Math.min(100, Math.round(((rep.xp || 0) / (rep.xpNext || 500)) * 100)));
  const idolPct = Math.max(0, Math.min(100, Math.round((found / total) * 100)));
  const money = G.player ? G.player.money : 0;
  const income = pr.properties.reduce((t, p) => t + (p.owned ? p.income : 0), 0);
  const skills = SKILL_DEFS.map((d) => {
    const lvl = (pr.skills && pr.skills[d.key]) || 0;
    return `<div class="mp-skill"><span>${d.label} ${pips(lvl)}</span><span class="fx">${d.effect(lvl)}</span></div>`;
  }).join('');
  const props = pr.properties.map((p) => {
    const afford = money >= p.price;
    const btn = p.owned
      ? '<b>OWNED ✓</b>'
      : `<button data-buy="${p.id}" ${afford ? '' : 'disabled'}>${afford ? `BUY ${fmtMoney(p.price)}` : `NEED ${fmtMoney(p.price - money)}`}</button>`;
    return `<div class="prop-row"><span><b>${p.name}</b><br>${fmtMoney(p.income)}/min</span>${btn}</div>`;
  }).join('');
  progEl.innerHTML =
    '<h3>COLLECTIBLES — DORADA IDOLS</h3>' +
    `<div class="mp-row"><span>Found</span><b>${found} / ${total}</b></div>` +
    `<div class="mp-bar"><i style="width:${idolPct}%"></i></div>` +
    '<h3>REP</h3>' +
    `<div class="mp-row"><span>Level</span><b>LV ${rep.level || 1}</b></div>` +
    `<div class="mp-bar"><i style="width:${repPct}%"></i></div>` +
    `<div class="mp-row"><span>XP</span><b>${Math.floor(rep.xp || 0)} / ${rep.xpNext || 500}</b></div>` +
    `<div class="mp-next">NEXT: ${rep.nextUnlock || ''}</div>` +
    '<h3>SKILLS</h3>' + skills +
    '<h3>PROPERTIES</h3>' + props +
    `<div class="mp-row"><span>Property income</span><b>${fmtMoney(income)}/min</b></div>`;
}

// GARAGE section (map side panel): the car the upgrades apply to + every
// upgrade row with its real price and owned pips from UPGRADES / G.garage.
// Garage data is owned by garage.js — this only reads G.garage.owned.
function refreshGarageSection(G) {
  if (!garageEl) return;
  const car = (G.driving && G.driving.car) ? G.driving.car : null;
  const carName = car ? (car.name || (car.def && car.def.name) || 'YOUR CAR') : 'NO CAR — STEAL ONE FIRST';
  const owned = (G.garage && G.garage.owned) || {};
  const rows = UPGRADES.map((u) => {
    const lvl = owned[u.id] || 0;
    return `<div class="upg-row"><span><b>${u.name}</b> — ${u.desc}</span><span><b>${fmtMoney(u.price)}</b> ${pips(lvl, u.max)}</span></div>`;
  }).join('');
  garageEl.innerHTML =
    '<h3>GARAGE</h3>' +
    `<div class="mp-row"><span>Car</span><b>${carName}</b></div>` + rows;
}

export function initMap(G) {
  canvas = document.getElementById('map-canvas');
  ctx = canvas ? canvas.getContext('2d') : null;
  checklistEl = document.getElementById('map-checklist');
  currentJobEl = document.getElementById('map-current-job');
  statsEl = document.getElementById('map-stats');
  legendEl = document.getElementById('map-legend');
  // Progression + garage side-panel sections (created once here, refreshed
  // by drawMap; the map side is scrollable, so they sit below the legend).
  const side = document.getElementById('map-side');
  if (side && !document.getElementById('map-progression')) {
    const st = document.createElement('style');
    st.id = 'map-prog-style';
    st.textContent = `
#map-progression, #map-garage { margin-top: 10px; background: var(--panel); border: 1px solid rgba(242,194,48,.5); border-radius: 6px; padding: 8px 10px; font: 600 12px var(--font-read); color: var(--muted); line-height: 1.6; }
#map-progression h3, #map-garage h3 { margin: 6px 0 4px; color: var(--gold); letter-spacing: 1px; font-size: 12px; }
#map-progression h3:first-child, #map-garage h3:first-child { margin-top: 0; }
#map-progression b, #map-garage b { color: var(--ink); }
#map-progression .mp-row, #map-garage .mp-row { display: flex; justify-content: space-between; gap: 8px; }
#map-progression .mp-bar { height: 6px; background: rgba(245,239,224,.18); border-radius: 3px; overflow: hidden; margin: 2px 0 4px; }
#map-progression .mp-bar i { display: block; height: 100%; background: #f2c230; }
#map-progression .mp-next { color: var(--muted); font-size: 11px; margin-bottom: 2px; }
#map-progression .mp-skill { display: flex; justify-content: space-between; gap: 8px; }
#map-progression .mp-skill .fx { color: var(--gold); }
#map-progression .prop-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 2px 0; }
#map-progression .prop-row button { font: 800 11px var(--font-ui); padding: 3px 10px; cursor: pointer; }
#map-progression .prop-row button:disabled { opacity: .45; cursor: default; }
#map-garage .upg-row { display: flex; justify-content: space-between; gap: 8px; }`;
    document.head.appendChild(st);
    progEl = document.createElement('div');
    progEl.id = 'map-progression';
    garageEl = document.createElement('div');
    garageEl.id = 'map-garage';
    const menu = side.querySelector('.menu');
    if (menu) {
      side.insertBefore(progEl, menu);
      side.insertBefore(garageEl, menu);
    } else {
      side.appendChild(progEl);
      side.appendChild(garageEl);
    }
    // One delegated listener: refreshProgression rebuilds the rows (and the
    // BUY buttons) on every drawMap, so per-button listeners would not survive.
    progEl.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-buy]') : null;
      if (!btn) return;
      if (buyProperty(G, btn.getAttribute('data-buy'))) refreshProgression(G);
    });
  } else {
    progEl = document.getElementById('map-progression');
    garageEl = document.getElementById('map-garage');
  }
  ensureSideJobLegend();
  const btn = document.getElementById('btn-close-map');
  if (btn) btn.addEventListener('click', () => closeMap(G));
  window.addEventListener('keydown', (e) => {
    if (G.mode === 'map' && (e.code === KEYS.map || e.code === 'Escape')) closeMap(G);
  });
  // main.js opens the map via setMode('map') directly (M key), so refresh
  // whenever the screen becomes visible, not only via openMap.
  const screen = document.getElementById('map-screen');
  if (screen && typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => {
      if (!screen.classList.contains('hidden')) drawMap(G);
    }).observe(screen, { attributes: true, attributeFilter: ['class'] });
  }
}

// Legend panel (HTML, in #map-side): every marker on the map, explained.
// Built from the same POIS table the canvas draws, plus the live job states,
// so the legend can never drift from the map. Icons are CSS shapes, not emoji.
function refreshLegend(G) {
  if (!legendEl) return;
  const idx = (G.missions && typeof G.missions.index === 'number') ? G.missions.index : 0;
  const done = (G.stats && typeof G.stats.missionsDone === 'number') ? G.stats.missionsDone : 0;
  const cur = idx + 1;
  const doneJobs = [];
  const nextJobs = [];
  for (let i = 1; i <= MISSIONS.length; i++) {
    if (i < cur || i <= done) doneJobs.push(i);
    else if (i > cur) nextJobs.push(i);
  }
  // Compact ranges ("1–5", "7–8", "1–2, 4") so the legend never wraps.
  const rangeList = (list) => {
    if (!list.length) return '—';
    const out = [];
    let start = list[0], prev = list[0];
    for (let i = 1; i <= list.length; i++) {
      if (list[i] === prev + 1) { prev = list[i]; continue; }
      out.push(start === prev ? String(start) : `${start}–${prev}`);
      start = list[i]; prev = list[i];
    }
    return out.join(', ');
  };
  const swatch = (shape, color) => {
    const base = 'display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-1px;';
    if (shape === 'square') return `<span style="${base}background:${color};border:1px solid #1a2030;"></span>`;
    if (shape === 'diamond') return `<span style="${base}background:${color};border:1px solid #1a2030;transform:rotate(45deg);"></span>`;
    if (shape === 'star') return `<span style="${base}background:${color};border:1px solid #1a2030;transform:rotate(45deg);border-radius:2px;"></span>`;
    return `<span style="${base}background:${color};border:1px solid #1a2030;border-radius:50%;"></span>`;
  };
  const rows = [];
  rows.push(`<div>${swatch('diamond', JOB_CURRENT)}<b>JOB ${cur}</b> — CURRENT</div>`);
  rows.push(`<div>${swatch('dot', JOB_DONE)}JOB ${rangeList(doneJobs)} — DONE</div>`);
  rows.push(`<div>${swatch('dot', JOB_NEXT)}JOB ${rangeList(nextJobs)} — NEXT</div>`);
  for (const [key, label, shape, color] of POIS) rows.push(`<div>${swatch(shape, color)}${label}</div>`);
  rows.push(`<div><span style="display:inline-block;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:12px solid ${JOB_CURRENT};margin-right:6px;vertical-align:-1px;"></span><b>YOU</b> — PLAYER</div>`);
  // Progression markers drawn on the map canvas (see drawMap): gold diamonds
  // are uncollected Dorada Idols, squares are ownable properties.
  const pr = G.progression;
  const idolsLeft = pr ? (pr.collectibles.total - pr.collectibles.found) : 20;
  rows.push(`<div>${swatch('diamond', '#f2c230')}DORADA IDOL — ${idolsLeft} LEFT</div>`);
  rows.push(`<div>${swatch('square', '#58b368')}PROPERTY — OWNED / FOR SALE</div>`);
  // Side-job legend entries, from sidejobs.js (loaded dynamically — the
  // file may not exist yet; entries appear once it lands).
  ensureSideJobLegend();
  if (Array.isArray(sideJobLegend)) {
    for (const entry of sideJobLegend) {
      if (typeof entry === 'string') {
        rows.push(`<div>${swatch('dot', '#8fe388')}${entry}</div>`);
      } else if (entry && typeof entry === 'object') {
        const label = entry.label || entry.text || entry.name || '';
        if (!label) continue;
        const color = entry.color || '#8fe388';
        const shape = entry.shape || 'dot';
        rows.push(`<div>${swatch(shape, color)}${label}</div>`);
      }
    }
  }
  legendEl.innerHTML = `<h3>LEGEND</h3><div class="legend-grid">${rows.join('')}</div>`;
}

function drawMarkerShape(c, x, y, shape, color) {
  c.save();
  c.fillStyle = color;
  c.strokeStyle = '#1a2030';
  c.lineWidth = 2;
  if (shape === 'square') {
    c.fillRect(x - 6, y - 6, 12, 12);
    c.strokeRect(x - 6, y - 6, 12, 12);
  } else if (shape === 'diamond') {
    c.beginPath();
    c.moveTo(x, y - 8);
    c.lineTo(x + 8, y);
    c.lineTo(x, y + 8);
    c.lineTo(x - 8, y);
    c.closePath();
    c.fill();
    c.stroke();
  } else if (shape === 'star') {
    c.beginPath();
    c.moveTo(x, y - 9);
    c.lineTo(x + 3, y - 3);
    c.lineTo(x + 9, y);
    c.lineTo(x + 3, y + 3);
    c.lineTo(x, y + 9);
    c.lineTo(x - 3, y + 3);
    c.lineTo(x - 9, y);
    c.lineTo(x - 3, y - 3);
    c.closePath();
    c.fill();
    c.stroke();
  } else {
    c.beginPath();
    c.arc(x, y, 6, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
  c.restore();
}

function drawRoute(c, G) {
  const marker = (G.missions && G.missions.marker) ? posOf(G.missions.marker) : null;
  const player = (G.player && G.player.pos) ? { x: G.player.pos.x, z: G.player.pos.z } : null;
  if (!marker || !player) return;
  if (Math.hypot(marker.x - player.x, marker.z - player.z) < 25) return;
  const lines = (G.city && G.city.roadLines) || [-280, -200, -120, -40, 40, 120, 200, 280];
  const nearest = (v) => lines.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  const hz = nearest(player.z);
  const vx = nearest(marker.x);
  const pts = [
    [player.x, player.z],
    [player.x, hz],
    [vx, hz],
    [vx, marker.z],
    [marker.x, marker.z],
  ];
  const path = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [px, pz] = pts[i];
    const [lx, lz] = path[path.length - 1];
    if (Math.hypot(px - lx, pz - lz) > 1) path.push([px, pz]);
  }
  if (path.length < 2) return;
  c.save();
  c.strokeStyle = '#f2c230';
  c.lineWidth = 3;
  c.setLineDash([8, 6]);
  c.globalAlpha = 0.9;
  c.beginPath();
  path.forEach(([x, z], i) => {
    const px = toPx(x), py = toPx(z);
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  });
  c.stroke();
  c.restore();
}

export function drawMap(G) {
  if (!ctx || !canvas) return;
  const c = ctx;
  currentRoads = (G.city && G.city.roads) || null;

  // Island background (brighter than the minimap so the full map reads).
  c.clearRect(0, 0, SIZE, SIZE);
  c.fillStyle = '#232c42';
  c.fillRect(0, 0, SIZE, SIZE);

  // Sea (west strip) + beach.
  c.fillStyle = '#1d5a78';
  c.fillRect(0, 0, toPx(WORLD.beachX), SIZE);
  c.fillStyle = '#c9a86a';
  c.fillRect(toPx(WORLD.beachX), 0, toPx(WORLD.beachX + 20) - toPx(WORLD.beachX), SIZE);

  // District washes + labels. V4: the washes were 0.14 alpha over a dark
  // island, so the map read as one uniform dark grid — the district colours
  // (gold/yellow/tan/blue/green/blue/tan in config.js) never showed. Now a
  // vivid per-district palette at 0.32 alpha + a coloured border per zone,
  // so the districts read as green/pink/blue zones at a glance. (map.js is
  // post-cut in the dossier, so this costs no dossier bytes.)
  const DISTRICT_WASH = ['#e8b64c', '#e85a9a', '#c98a4b', '#4fb3d9', '#7ec850', '#8a5ad9', '#d95a3a'];
  DISTRICTS.forEach((d, i) => {
    c.globalAlpha = 0.32;
    c.fillStyle = DISTRICT_WASH[i % DISTRICT_WASH.length];
    c.fillRect(toPx(d.minX), toPx(d.minZ), (d.maxX - d.minX) * SCALE, (d.maxZ - d.minZ) * SCALE);
    c.globalAlpha = 0.55;
    c.strokeStyle = DISTRICT_WASH[i % DISTRICT_WASH.length];
    c.lineWidth = 2;
    c.strokeRect(toPx(d.minX), toPx(d.minZ), (d.maxX - d.minX) * SCALE, (d.maxZ - d.minZ) * SCALE);
  });
  c.globalAlpha = 1;

  drawRoads(c);

  // Buildings: small boxes inside each block so the map reads as a city, not
  // empty boxes. Blocks are the 80 m grid cells; roads are 12 m wide, so the
  // boxes sit 10 m inside each block, clear of the road strokes. The west
  // column is sea / beach, so it stays empty. Layout varies by a hash of the
  // cell indices, so it is identical every time the map opens.
  c.fillStyle = '#4d5c7d';
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const bx = toPx(-320 + i * 80 + 10);
    const bz = toPx(-320 + j * 80 + 10);
    if (bx < toPx(-280)) continue;
    const v = (i * 7 + j * 13) % 3;
    c.fillRect(bx, bz, 22, 16);
    c.fillRect(bx + 30, bz + 4, 18, 20);
    if (v) c.fillRect(bx + 6, bz + 30, 20, 18);
    if (v === 2) c.fillRect(bx + 34, bz + 32, 16, 14);
  }

  // District names: small and faint, tucked into each district's top-left corner
  // (district centres coincide with landmark dots, so centre labels collide).
  // Drawn after the roads so road strokes never cross the text.
  c.font = '700 12px system-ui, sans-serif';
  c.textAlign = 'left';
  c.fillStyle = 'rgba(245,239,224,0.85)';
  for (const d of DISTRICTS) {
    c.fillText(d.name.toUpperCase(), toPx(d.minX) + 8, toPx(d.minZ) + 16);
  }

  // Route to the current job: a dashed gold line on the road grid, from the
  // player to the mission marker (Manhattan route via the nearest roads).
  // Only when the job is far enough to show a route; also a real GPS in play.
  drawRoute(c, G);

  // POI markers: one shape per place type (see POIS), label on a dark pill
  // so it stays readable; labels that would run past the right edge
  // (Causeway) are right-aligned instead.
  // V5 F13: per-POI label nudge (px down, canvas space). CAUSEWAY's pill
  // sat on its job badges (4/8, drawn 22 px above the spot) — drop the
  // pill below the marker instead. BEACH's pill goes below too, so it
  // never collides with the BOARDWALK pill on the same row.
  const LABEL_DY = { causeway: 26, beach: 26 };
  const landmarks = (G.city && G.city.landmarks) || {};
  c.font = '700 12px system-ui, sans-serif';
  for (const [key, label, shape, color] of POIS) {
    const q = posOf(landmarks[key]);
    if (!q) continue;
    const x = toPx(q.x);
    const y = toPx(q.z);
    drawMarkerShape(c, x, y, shape, color);
    const w = c.measureText(label).width;
    const pad = 4;
    const right = x + 10 + w + pad * 2 > SIZE - 4;
    const tx = right ? x - 10 - w - pad * 2 : x + 10;
    const dy = LABEL_DY[key] || 0;
    c.fillStyle = 'rgba(10,14,22,0.72)';
    c.fillRect(tx, y - 10 + dy, w + pad * 2, 18);
    c.fillStyle = '#f5efe0';
    c.textAlign = 'left';
    c.fillText(label, tx + pad, y + 4 + dy);
  }

  // Quest badges: numbered circles for all 8 jobs, grouped by place
  // (JOB_SPOTS mirrors missions.js stage 1). Done = green, current = gold
  // with a white ring, next = cream. Shared places get a row above the spot.
  const idx = (G.missions && typeof G.missions.index === 'number') ? G.missions.index : 0;
  const done = (G.stats && typeof G.stats.missionsDone === 'number') ? G.stats.missionsDone : 0;
  c.font = '800 11px system-ui, sans-serif';
  c.textAlign = 'center';
  for (const [key, jobs] of Object.entries(JOB_SPOTS)) {
    const q = posOf(landmarks[key]);
    if (!q) continue;
    const x = toPx(q.x);
    const y = toPx(q.z);
    jobs.forEach((job, k) => {
      const bx = x + (k - (jobs.length - 1) / 2) * 20;
      const by = y - 22;
      const isDone = (job - 1 < idx) || (job - 1 < done);
      const isCurrent = (job - 1 === idx);
      c.fillStyle = isDone ? JOB_DONE : (isCurrent ? JOB_CURRENT : JOB_NEXT);
      c.beginPath();
      c.arc(bx, by, 9, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = isCurrent ? '#ffffff' : '#1a2030';
      c.lineWidth = isCurrent ? 2.5 : 1.5;
      c.stroke();
      c.fillStyle = '#1a2030';
      c.fillText(String(job), bx, by + 4);
    });
  }

  // Mission marker: gold diamond.
  const marker = (G.missions && G.missions.marker) ? posOf(G.missions.marker) : null;
  if (marker) drawDiamond(c, toPx(marker.x), toPx(marker.z), 9, '#f2c230');

  // Progression markers: uncollected Dorada Idols (small gold diamonds) and
  // properties (squares — green owned, gold outline for sale).
  if (G.progression) {
    for (const idol of G.progression.idols || []) {
      if (idol.collected) continue;
      drawDiamond(c, toPx(idol.x), toPx(idol.z), 5, '#f2c230');
    }
    for (const prop of G.progression.properties || []) {
      const x = toPx(prop.x), y = toPx(prop.z);
      c.save();
      if (prop.owned) {
        c.fillStyle = '#58b368';
        c.fillRect(x - 6, y - 6, 12, 12);
      } else {
        c.strokeStyle = '#f2c230';
        c.lineWidth = 2;
        c.strokeRect(x - 6, y - 6, 12, 12);
      }
      c.restore();
    }
  }

  // Player arrow.
  if (G.player && G.player.pos) {
    const px = toPx(G.player.pos.x);
    const py = toPx(G.player.pos.z);
    c.save();
    c.translate(px, py);
    c.rotate(Math.PI - (G.player.heading || 0));
    c.fillStyle = '#f2c230';
    c.strokeStyle = '#1a2030';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -12);
    c.lineTo(9, 9);
    c.lineTo(0, 4);
    c.lineTo(-9, 9);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  // Compass rose, top-right corner.
  c.fillStyle = '#f2c230';
  c.font = '800 14px system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText('N', SIZE - 22, 24);
  c.strokeStyle = '#f2c230';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(SIZE - 22, 30);
  c.lineTo(SIZE - 22, 44);
  c.stroke();
  c.beginPath();
  c.moveTo(SIZE - 22, 28);
  c.lineTo(SIZE - 27, 38);
  c.lineTo(SIZE - 17, 38);
  c.closePath();
  c.fill();

  currentRoads = null;
  refreshChecklist(G);
  refreshCurrentJob(G);
  refreshStats(G);
  refreshProgression(G);
  refreshGarageSection(G);
  refreshLegend(G);
}

export function openMap(G) {
  drawMap(G);
  if (G.setMode) G.setMode('map');
}

export function closeMap(G) {
  // Clear the closing keys from Input: without this, the main loop's next frame
  // would see the still-held M/Escape and reopen the map / pause the game.
  Input.clear(KEYS.map, KEYS.pause);
  if (G.setMode) G.setMode('play');
}
