// Isla Dorada — title screen (rebuild): NEW GAME, CONTINUE (save slot 1),
// HOW TO PLAY panel. The rebuild brief: the title must read BRIGHT — the sun
// and skyline behind the menu must stay visible, never a dark murk — and the
// character cards carry DRAWN PORTRAITS (same art as the dialogue box),
// not bare initials. The HOW TO PLAY controls panel is shown by default;
// the button still toggles it. All visual work is done here in JS (injected
// style + portrait SVGs) so index.html stays untouched — except the 6
// character cards themselves, which live in index.html.
//
// SIX characters (v2 backup build): the original three — Wowo, Officer
// Braga, Mara — plus three new original faces: RICO SALAS the fixer,
// LUNA VELAS the getaway driver, and KIKO TAN the hacker. The new three
// are drawn here in title.js (hud.js is owned by another agent and must
// not be touched); the original three keep reusing hud.js portraitSVG so
// the dialogue-box art and the title cards stay identical.
import { hasSave, loadGame, saveSummary } from './save.js';
import { portraitSVG } from './hud.js';
import { MISSIONS } from './config.js';

let btnContinue = null;
let btnNew = null;
let btnHowto = null;
let howtoEl = null;

const TITLE_CHARS = [
  { face: 0, who: 'WOWO', portrait: 'WOWO' },
  { face: 1, who: 'OFFICER BRAGA', portrait: 'BRAGA' },
  { face: 2, who: 'MARA', portrait: 'MARA' },
  { face: 3, who: 'RICO SALAS', portrait: 'RICO', local: true },
  { face: 4, who: 'LUNA VELAS', portrait: 'LUNA', local: true },
  { face: 5, who: 'KIKO TAN', portrait: 'KIKO', local: true },
];

// ---------------------------------------------------------------- new portraits
// Flat, drawn SVG portraits for the three new characters, in the same
// 64x64 construction as hud.js (background disc, shoulders, face, hair,
// eyes, mouth, one signature accessory each). Original characters, drawn
// here — no commercial likenesses.
const NEW_PORTRAITS = {
  RICO: {
    bg: '#2a1a08', skin: '#c98a5a', hair: '#1a1210', jacket: '#3a5a2a',
    accent: '#f2c230', accessory: 'flatcap',
  },
  LUNA: {
    bg: '#0a2a3a', skin: '#e8b88a', hair: '#5a1a1a', jacket: '#8a3a1a',
    accent: '#ff9a3c', accessory: 'goggles',
  },
  KIKO: {
    bg: '#12261a', skin: '#d9a077', hair: '#101010', jacket: '#2a4a3a',
    accent: '#7ee8a8', accessory: 'headphones',
  },
};

function newPortraitSVG(key) {
  const p = NEW_PORTRAITS[key] || NEW_PORTRAITS.RICO;
  let top = '';
  let extra = '';
  if (p.accessory === 'flatcap') {
    // Flat cap + thick moustache: the fixer who has seen every deal twice.
    top = `<path d="M13 27 Q13 11 32 11 Q51 11 51 27 L51 29 L13 29Z" fill="#2a2a22"/>`
      + `<rect x="12" y="26" width="40" height="4" rx="2" fill="#171712"/>`
      + `<path d="M25 46 Q32 42 39 46 Q37 50 32 50 Q27 50 25 46Z" fill="#1a1210"/>`;
    extra = `<rect x="24" y="52" width="16" height="3" rx="1.5" fill="${p.accent}"/>`; // gold chain
  } else if (p.accessory === 'goggles') {
    // Bandana + driving goggles pushed up on the forehead: the wheelman.
    top = `<path d="M14 30 Q16 12 32 12 Q48 12 50 30 Q48 20 32 19 Q16 20 14 30Z" fill="${p.hair}"/>`
      + `<rect x="13" y="23" width="38" height="6" rx="3" fill="#c23a3a"/>`
      + `<circle cx="24" cy="26" r="5" fill="none" stroke="${p.accent}" stroke-width="2.4"/>`
      + `<circle cx="40" cy="26" r="5" fill="none" stroke="${p.accent}" stroke-width="2.4"/>`
      + `<rect x="29" y="25" width="6" height="2.4" fill="${p.accent}"/>`;
    extra = '';
  } else {
    // Headphones + square glasses: the hacker, always listening.
    top = `<path d="M14 32 Q12 11 32 11 Q52 11 50 32 Q49 22 32 21 Q15 22 14 32Z" fill="${p.hair}"/>`
      + `<path d="M13 26 Q13 12 32 12 Q51 12 51 26" fill="none" stroke="#101418" stroke-width="4" stroke-linecap="round"/>`
      + `<rect x="10" y="24" width="7" height="12" rx="3" fill="#101418"/>`
      + `<rect x="47" y="24" width="7" height="12" rx="3" fill="#101418"/>`;
    extra = `<rect x="17" y="31" width="11" height="8" rx="2" fill="none" stroke="${p.accent}" stroke-width="1.8"/>`
      + `<rect x="36" y="31" width="11" height="8" rx="2" fill="none" stroke="${p.accent}" stroke-width="1.8"/>`
      + `<rect x="28" y="34" width="8" height="1.8" fill="${p.accent}"/>`;
  }
  return `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">`
    + `<circle cx="32" cy="32" r="32" fill="${p.bg}"/>`
    + `<path d="M8 64 Q10 50 24 48 L40 48 Q54 50 56 64Z" fill="${p.jacket}"/>`
    + `<path d="M28 46 L32 52 L36 46 L36 44 L28 44Z" fill="${p.skin}"/>`
    + `<ellipse cx="32" cy="35" rx="13.5" ry="15" fill="${p.skin}"/>`
    + top
    + `<ellipse cx="24" cy="34" rx="3.2" ry="3.8" fill="#fff"/><ellipse cx="40" cy="34" rx="3.2" ry="3.8" fill="#fff"/>`
    + `<circle cx="24" cy="34.6" r="1.7" fill="#1a1210"/><circle cx="40" cy="34.6" r="1.7" fill="#1a1210"/>`
    + `<path d="M21 29 Q24 27.5 27 29" stroke="${p.hair}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
    + `<path d="M37 29 Q40 27.5 43 29" stroke="${p.hair}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
    + `<path d="M27 47 Q32 50 37 47" stroke="#7a3a2a" stroke-width="2" fill="none" stroke-linecap="round"/>`
    + extra
    + `</svg>`;
}

function injectTitleStyle() {
  if (document.getElementById('title-rebuild-style')) return;
  const st = document.createElement('style');
  st.id = 'title-rebuild-style';
  st.textContent = `
/* Bright title: a light warm wash so the sunset, sun disc and skyline read
   through instead of a dark murk. The 3D orbit camera keeps moving behind it. */
#title-screen { background: linear-gradient(180deg, rgba(255,170,60,0.10), rgba(20,16,40,0.28) 55%, rgba(10,8,20,0.55)); }
#title-screen::before { content: ''; position: absolute; left: 12%; top: 9%; width: 150px; height: 150px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,214,122,0.95) 0%, rgba(255,170,60,0.55) 45%, rgba(255,140,40,0) 70%);
  pointer-events: none; }
#title-screen h1 { text-shadow: 0 2px 0 #7a4a00, 0 4px 24px rgba(242,194,48,.65), 0 0 60px rgba(255,180,60,.5); }
#title-screen .tagline { color: #fff3d0; text-shadow: 0 1px 4px rgba(0,0,0,.7); }
#title-screen .char .face { overflow: hidden; background: #2a1c10; }
#title-screen .char .face svg { width: 100%; height: 100%; display: block; }
/* Six character cards: one row on wide screens, wrapping on narrow ones. */
#title-screen .chars { flex-wrap: wrap; justify-content: center; max-width: 1120px; }
#title-screen .char { width: 160px; }
#title-screen #howto { border-color: rgba(242,194,48,.55); box-shadow: 0 4px 24px rgba(0,0,0,.45); }
#title-screen #howto b { color: #f2c230; }
#title-screen .controls { color: #ffe9b0; text-shadow: 0 1px 4px rgba(0,0,0,.8); }`;
  document.head.appendChild(st);
}

function paintTitlePortraits() {
  const faces = document.querySelectorAll('#title-screen .char .face');
  faces.forEach((faceEl, i) => {
    const def = TITLE_CHARS[i];
    if (!def) return;
    faceEl.innerHTML = def.local ? newPortraitSVG(def.portrait) : portraitSVG(def.portrait);
    faceEl.setAttribute('role', 'img');
    faceEl.setAttribute('aria-label', def.who);
  });
}

function showHowtoByDefault() {
  // The HOW TO PLAY panel lists the real controls and must be visible on the
  // title screen (and in the staged title screenshot), not hidden behind a
  // toggle nobody presses. The button still toggles it for players who want
  // it gone.
  if (howtoEl) howtoEl.classList.remove('hidden');
}

export function initTitle(G) {
  injectTitleStyle();
  btnContinue = document.getElementById('btn-continue');
  btnNew = document.getElementById('btn-new');
  btnHowto = document.getElementById('btn-howto');
  howtoEl = document.getElementById('howto');

  paintTitlePortraits();
  showHowtoByDefault();

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      if (G.player) {
        G.player.money = 1250;
        G.player.health = 100;
        G.player.armour = 0;
        G.player.mode = 'foot';
      }
      if (G.stats) {
        G.stats.carsStolen = 0;
        G.stats.escapes = 0;
        G.stats.playSeconds = 0;
        G.stats.missionsDone = 0;
        G.stats.shotsFired = 0;
      }
      if (G.garage) G.garage.owned = {};
      if (G.setWanted) G.setWanted(0);
      if (G.startMission) G.startMission(0);
      if (G.setMode) G.setMode('play');
    });
  }

  if (btnContinue) {
    btnContinue.addEventListener('click', () => {
      loadGame(G);
    });
  }

  if (btnHowto && howtoEl) {
    btnHowto.addEventListener('click', () => {
      howtoEl.classList.toggle('hidden');
    });
  }
}

export function showTitle(G) {
  if (!btnContinue) btnContinue = document.getElementById('btn-continue');
  // Portraits + bright panel are re-applied on every return to title so a
  // stale DOM (or a staged title shot) always shows the rebuilt face.
  paintTitlePortraits();
  showHowtoByDefault();
  if (!btnContinue) return;
  if (hasSave()) {
    btnContinue.disabled = false;
    const summary = saveSummary();
    const pct = summary ? summary.percent : 0;
    const jobs = summary ? summary.missionsDone : 0;
    const cash = summary ? Math.floor(summary.money || 0).toLocaleString('en-US') : '0';
    btnContinue.textContent = `CONTINUE — JOB ${jobs}/${MISSIONS.length} · $${cash} · ${pct}%`;
  } else {
    btnContinue.disabled = true;
    btnContinue.textContent = 'CONTINUE — NO SAVE YET';
  }
  void G;
}

export function hideTitle(G) {
  // No structural work: main.js setMode hides the title screen.
  void G;
}
