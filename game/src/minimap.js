// Isla Dorada — minimap (rebuild): 180x180 canvas, north up, world 640m ->
// 180px. Redrawn every frame from live G state. Defensive about
// G.city.roads — any road shape (or none) is handled. Rebuild adds a north
// tick, a pulsing wanted ring while the IDPD is after the player, and
// brighter police blips so pursuit reads instantly.
// Minimap markers (recording #8): the same POI buildings + quest badges as
// the big map (map.js POIS/JOB_SPOTS, imported so they can never drift),
// the dashed gold route to the current job, and a pulsing ring on the
// current quest — buildings and direction are the priority, badges secondary.
import { DISTRICTS, WORLD } from './config.js';
import { POIS, JOB_SPOTS, JOB_DONE, JOB_CURRENT, JOB_NEXT } from './map.js';

let canvas = null;
let ctx = null;

const SIZE = 180;
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

// The roads array for this frame (set by renderMinimap before drawing).
let currentRoads = null;

function drawRoads(c) {
  c.strokeStyle = '#4a4f5c';
  c.lineCap = 'round';
  const roadW = Math.max(2.5, WORLD.roadWidth * SCALE);
  c.lineWidth = roadW;
  const rs = currentRoads;
  let drew = false;
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

function drawMiniShape(c, x, y, shape, color) {
  c.save();
  c.fillStyle = color;
  c.strokeStyle = '#1a2030';
  c.lineWidth = 1;
  if (shape === 'square') {
    c.fillRect(x - 3, y - 3, 6, 6);
    c.strokeRect(x - 3, y - 3, 6, 6);
  } else if (shape === 'diamond') {
    c.beginPath();
    c.moveTo(x, y - 4); c.lineTo(x + 4, y); c.lineTo(x, y + 4); c.lineTo(x - 4, y);
    c.closePath(); c.fill(); c.stroke();
  } else if (shape === 'star') {
    c.beginPath();
    c.moveTo(x, y - 4.5); c.lineTo(x + 1.5, y - 1.5); c.lineTo(x + 4.5, y);
    c.lineTo(x + 1.5, y + 1.5); c.lineTo(x, y + 4.5); c.lineTo(x - 1.5, y + 1.5);
    c.lineTo(x - 4.5, y); c.lineTo(x - 1.5, y - 1.5);
    c.closePath(); c.fill(); c.stroke();
  } else {
    c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill(); c.stroke();
  }
  c.restore();
}

// Route to the current job on the minimap: same Manhattan route as the big
// map (via the nearest roads), dashed gold, thinner. Skipped when the job
// is within 25 m — same rule as the big map.
function drawMiniRoute(c, G) {
  const marker = (G.missions && G.missions.marker) ? posOf(G.missions.marker) : null;
  const player = (G.player && G.player.pos) ? { x: G.player.pos.x, z: G.player.pos.z } : null;
  if (!marker || !player) return;
  if (Math.hypot(marker.x - player.x, marker.z - player.z) < 25) return;
  const lines = (G.city && G.city.roadLines) || [-280, -200, -120, -40, 40, 120, 200, 280];
  const nearest = (v) => lines.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  const hz = nearest(player.z);
  const vx = nearest(marker.x);
  const pts = [[player.x, player.z], [player.x, hz], [vx, hz], [vx, marker.z], [marker.x, marker.z]];
  c.save();
  c.strokeStyle = '#f2c230';
  c.lineWidth = 1.5;
  c.setLineDash([4, 3]);
  c.globalAlpha = 0.9;
  c.beginPath();
  pts.forEach(([x, z], i) => { if (i === 0) c.moveTo(toPx(x), toPx(z)); else c.lineTo(toPx(x), toPx(z)); });
  c.stroke();
  c.restore();
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

export function initMinimap(G) {
  canvas = document.getElementById('minimap');
  ctx = canvas ? canvas.getContext('2d') : null;
  void G;
}

export function renderMinimap(G) {
  if (!ctx || !canvas || !G.player || !G.player.pos) return;
  const c = ctx;
  currentRoads = (G.city && G.city.roads) || null;
  const wanted = (G.police && typeof G.police.wanted === 'number') ? G.police.wanted : 0;

  // Background: island.
  c.clearRect(0, 0, SIZE, SIZE);
  c.fillStyle = '#1c2233';
  c.fillRect(0, 0, SIZE, SIZE);

  // Sea (west strip) + beach.
  c.fillStyle = '#1d5a78';
  c.fillRect(0, 0, toPx(WORLD.beachX), SIZE);
  c.fillStyle = '#c9a86a';
  c.fillRect(toPx(WORLD.beachX), 0, toPx(WORLD.beachX + 20) - toPx(WORLD.beachX), SIZE);

  // Faint district colour washes.
  for (const d of DISTRICTS) {
    c.globalAlpha = 0.10;
    c.fillStyle = d.color;
    c.fillRect(toPx(d.minX), toPx(d.minZ), (d.maxX - d.minX) * SCALE, (d.maxZ - d.minZ) * SCALE);
  }
  c.globalAlpha = 1;

  drawRoads(c);

  const landmarks = (G.city && G.city.landmarks) || {};

  // Direction: dashed gold route from the player to the current job, so the
  // player can tell where to go from the minimap alone.
  drawMiniRoute(c, G);

  // Building markers: every real POI from the big map's table, same
  // shapes/colours, scaled down. Priority — never dropped for anything else.
  for (const [key, , shape, color] of POIS) {
    const q = posOf(landmarks[key]);
    if (!q) continue;
    drawMiniShape(c, toPx(q.x), toPx(q.z), shape, color);
  }

  // Quest badges: small numbered dots above each job's spot, same states as
  // the big map (done green, current gold, next cream). Secondary to the
  // buildings — kept small so they never clutter the minimap.
  const idx = (G.missions && typeof G.missions.index === 'number') ? G.missions.index : 0;
  const done = (G.stats && typeof G.stats.missionsDone === 'number') ? G.stats.missionsDone : 0;
  c.font = '800 7px system-ui, sans-serif';
  c.textAlign = 'center';
  for (const [key, jobs] of Object.entries(JOB_SPOTS)) {
    const q = posOf(landmarks[key]);
    if (!q) continue;
    const x = toPx(q.x);
    const y = toPx(q.z);
    jobs.forEach((job, k) => {
      const bx = x + (k - (jobs.length - 1) / 2) * 10;
      const by = y - 9;
      const isDone = (job - 1 < idx) || (job - 1 < done);
      const isCurrent = (job - 1 === idx);
      c.fillStyle = isDone ? JOB_DONE : (isCurrent ? JOB_CURRENT : JOB_NEXT);
      c.beginPath();
      c.arc(bx, by, 4.5, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = isCurrent ? '#ffffff' : '#1a2030';
      c.lineWidth = isCurrent ? 1.5 : 1;
      c.stroke();
      c.fillStyle = '#1a2030';
      c.fillText(String(job), bx, by + 2.5);
    });
  }

  // Mission marker: gold diamond.
  const marker = (G.missions && G.missions.marker) ? posOf(G.missions.marker) : null;
  if (marker) {
    drawDiamond(c, toPx(marker.x), toPx(marker.z), 6, '#f2c230');
    // Direction: pulsing white ring on the current quest.
    const pulse = 0.5 + 0.3 * Math.sin((G.time || 0) * 5);
    c.strokeStyle = `rgba(255,255,255,${pulse.toFixed(2)})`;
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(toPx(marker.x), toPx(marker.z), 9 + 1.5 * Math.sin((G.time || 0) * 5), 0, Math.PI * 2);
    c.stroke();
    // GPS distance readout (GTA-style): metres from the player to the
    // current job, on a dark pill beside the marker. Same 25 m rule as the
    // route — no readout when the player is basically there.
    if (G.player && G.player.pos) {
      const d = Math.round(Math.hypot(marker.x - G.player.pos.x, marker.z - G.player.pos.z));
      if (d >= 25) {
        const label = d + ' m';
        c.font = '800 8px system-ui, sans-serif';
        c.textAlign = 'left';
        const w = c.measureText(label).width;
        let lx = toPx(marker.x) + 12;
        if (lx + w + 4 > SIZE - 2) lx = toPx(marker.x) - 12 - w;
        const ly = toPx(marker.z) - 4;
        c.fillStyle = 'rgba(10,14,22,0.72)';
        c.fillRect(lx - 2, ly - 8, w + 4, 11);
        c.fillStyle = '#f2c230';
        c.fillText(label, lx, ly);
      }
    }
  }

  // Traffic dots (white).
  if (G.traffic && Array.isArray(G.traffic.cars)) {
    c.fillStyle = 'rgba(245,239,224,0.85)';
    for (const car of G.traffic.cars) {
      const q = posOf(car);
      if (!q) continue;
      c.beginPath();
      c.arc(toPx(q.x), toPx(q.z), 1.8, 0, Math.PI * 2);
      c.fill();
    }
  }

  // Police blips (red cars, blue heli) with a white rim so they read on roads.
  if (G.police && Array.isArray(G.police.units)) {
    for (const u of G.police.units) {
      const q = posOf(u.mesh) || posOf(u.pos) || posOf(u);
      if (!q) continue;
      const isHeli = u.kind === 'heli' || (u.name && /HAWK|HELI/i.test(u.name));
      c.fillStyle = isHeli ? '#4fb3d9' : '#e5484d';
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(toPx(q.x), toPx(q.z), 3, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }

  // Player arrow: gold triangle rotated by heading.
  // Heading convention: forward = (sin h, cos h) in xz; screen y grows with +z,
  // so the triangle (drawn pointing up) rotates by PI - heading.
  const px = toPx(G.player.pos.x);
  const py = toPx(G.player.pos.z);
  c.save();
  c.translate(px, py);
  c.rotate(Math.PI - (G.player.heading || 0));
  c.fillStyle = '#f2c230';
  c.strokeStyle = '#1a2030';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, -7);
  c.lineTo(5, 5);
  c.lineTo(0, 2);
  c.lineTo(-5, 5);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();

  // Wanted ring: pulsing red circle around the player while the IDPD hunts.
  if (wanted > 0) {
    const pulse = 0.45 + 0.35 * Math.sin((G.time || 0) * 5);
    c.strokeStyle = `rgba(229,72,77,${pulse.toFixed(2)})`;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(px, py, 11 + 2 * Math.sin((G.time || 0) * 5), 0, Math.PI * 2);
    c.stroke();
  }

  // North tick.
  c.fillStyle = 'rgba(245,239,224,0.9)';
  c.font = '800 9px system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText('N', SIZE / 2, 10);

  currentRoads = null;
}
