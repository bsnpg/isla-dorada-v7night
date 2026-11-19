// Isla Dorada — procedural WebAudio (rebuild): radio step sequencer, engine
// hum, siren loop and one-shot SFX. Everything is synthesized (no audio
// files, no network). The AudioContext is created lazily on the first user
// gesture; every public function guards the ctx === null case (before the
// first gesture). Rebuild adds skid / near-miss / mission / busted SFX, a
// mute toggle (M is taken by the map, so mute lives on the 0 key via
// toggleMute), and a radioLabel() helper for the HUD.
import { RADIO, KEYS } from './config.js';
import { Input } from './input.js';

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// Per-station 16-step patterns. Bass hits on the beats (steps 0/4/8/12),
// hats on the off-beats, a quiet square arp on every other 16th.
const ARP_SEQ = [0, 3, 7, 10, 12, 10, 7, 3];
const BASS_CHORD = [0, 0, 7, 5]; // root offsets per bar quarter

function ensureAudio(G) {
  const a = G.audio;
  if (!a || a.ctx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    a.ctx = new AC();
    a.master = a.ctx.createGain();
    a.master.gain.value = a.muted ? 0 : 0.5;
    a.master.connect(a.ctx.destination);
    // Shared noise buffer for hats / snare / bursts.
    const len = a.ctx.sampleRate * 1;
    a.noiseBuf = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
    const data = a.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    // Engine: sawtooth hum, silent until in a car.
    a.engineOsc = a.ctx.createOscillator();
    a.engineOsc.type = 'sawtooth';
    a.engineOsc.frequency.value = 40;
    a.engineGain = a.ctx.createGain();
    a.engineGain.gain.value = 0;
    const engineFilter = a.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 500;
    a.engineOsc.connect(engineFilter);
    engineFilter.connect(a.engineGain);
    a.engineGain.connect(a.master);
    a.engineOsc.start();
    a.step = 0;
    a.nextNoteTime = a.ctx.currentTime + 0.05;
  } catch (err) {
    a.ctx = null;
  }
}

function tone(a, freq, dur, type, vol, when, slideTo) {
  if (!a.ctx) return;
  const t = when || a.ctx.currentTime;
  const osc = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(a.master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(a, dur, vol, filterFreq, when) {
  if (!a.ctx || !a.noiseBuf) return;
  const t = when || a.ctx.currentTime;
  const src = a.ctx.createBufferSource();
  src.buffer = a.noiseBuf;
  src.loop = true;
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = src;
  if (filterFreq) {
    const f = a.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    src.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(a.master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function scheduleStep(a, step, t) {
  const station = RADIO[a.radioIndex] || RADIO[0];
  const root = station.root;
  const s = step % 16;
  // Bass on the beats.
  if (s % 4 === 0) {
    tone(a, midiToFreq(root - 12 + BASS_CHORD[s / 4]), 0.22, 'triangle', 0.16, t);
  }
  // Hat on the off-beats.
  if (s % 4 === 2) noise(a, 0.03, 0.05, 6000, t);
  // Snare-ish noise on 2 and 4.
  if (s === 4 || s === 12) noise(a, 0.09, 0.07, 1800, t);
  // Quiet square arp, pattern offset per station so stations differ.
  if (s % 2 === 0) {
    const deg = ARP_SEQ[((s / 2) + a.radioIndex * 2) % ARP_SEQ.length];
    tone(a, midiToFreq(root + 12 + deg), 0.12, 'square', 0.035, t);
  }
}

function startSiren(a) {
  if (!a.ctx || a.sirenOsc) return;
  const osc = a.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 825;
  const lfo = a.ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 1.25; // alternates 700 / 950 Hz every 0.4s
  const lfoGain = a.ctx.createGain();
  lfoGain.gain.value = 125;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  const g = a.ctx.createGain();
  g.gain.value = 0.035;
  osc.connect(g);
  g.connect(a.master);
  osc.start();
  lfo.start();
  a.sirenOsc = osc;
  a.sirenLFO = lfo;
  a.sirenGain = g;
}

function stopSiren(a) {
  if (!a.sirenOsc) return;
  try { a.sirenOsc.stop(); } catch (e) { /* already stopped */ }
  try { a.sirenLFO.stop(); } catch (e) { /* already stopped */ }
  if (a.sirenGain) a.sirenGain.disconnect();
  a.sirenOsc = null;
  a.sirenLFO = null;
  a.sirenGain = null;
}

export function initAudio(G) {
  G.audio = {
    ctx: null,
    radioIndex: 0,
    master: null,
    engineOsc: null,
    engineGain: null,
    noiseBuf: null,
    sirenOsc: null,
    sirenLFO: null,
    sirenGain: null,
    step: 0,
    nextNoteTime: 0,
    muted: false,
  };
  const gesture = () => {
    ensureAudio(G);
    if (G.audio.ctx && G.audio.ctx.state === 'suspended') G.audio.ctx.resume();
  };
  window.addEventListener('pointerdown', gesture);
  window.addEventListener('keydown', gesture);
}

export function setRadio(G, i) {
  const a = G.audio;
  if (!a) return;
  const n = RADIO.length;
  a.radioIndex = ((i % n) + n) % n;
  a.step = 0;
  if (a.ctx) a.nextNoteTime = a.ctx.currentTime + 0.05;
}

export function radioLabel(G) {
  const a = G.audio;
  const ri = (a && typeof a.radioIndex === 'number') ? a.radioIndex : 0;
  const station = RADIO[ri] || RADIO[0];
  return `${station.name} — ${station.genre}`;
}

export function toggleMute(G) {
  const a = G.audio;
  if (!a) return false;
  a.muted = !a.muted;
  if (a.ctx && a.master) {
    a.master.gain.setTargetAtTime(a.muted ? 0 : 0.5, a.ctx.currentTime, 0.02);
  }
  return a.muted;
}

export function updateAudio(G) {
  const a = G.audio;
  if (!a) return;
  // R cycles the radio station.
  if (Input.pressed(KEYS.radioNext)) {
    setRadio(G, (a.radioIndex || 0) + 1);
  }
  if (!a.ctx) return;
  if (a.ctx.state === 'suspended') return;

  // Engine hum follows driving speed.
  const inCar = G.player && G.player.mode === 'car' && G.driving && G.driving.car;
  const speed = inCar ? Math.abs(G.driving.speed || 0) : 0;
  if (a.engineOsc && a.engineGain) {
    a.engineOsc.frequency.setTargetAtTime(40 + speed * 2.2, a.ctx.currentTime, 0.05);
    a.engineGain.gain.setTargetAtTime(inCar ? 0.05 : 0, a.ctx.currentTime, 0.08);
  }

  // Siren loops while wanted, stops when clean.
  const wanted = (G.police && G.police.wanted) || 0;
  if (wanted > 0) startSiren(a);
  else stopSiren(a);

  // Radio step sequencer: schedule 16th notes slightly ahead.
  const station = RADIO[a.radioIndex] || RADIO[0];
  const stepDur = 60 / station.bpm / 4;
  while (a.nextNoteTime < a.ctx.currentTime + 0.15) {
    scheduleStep(a, a.step, a.nextNoteTime);
    a.nextNoteTime += stepDur;
    a.step = (a.step + 1) % 16;
  }
}

export function playSFX(G, name) {
  const a = G.audio;
  if (!a || !a.ctx || a.ctx.state === 'suspended') return;
  switch (name) {
    case 'shoot':
      noise(a, 0.08, 0.25, 3000);
      tone(a, 180, 0.06, 'square', 0.12);
      break;
    case 'hit':
      tone(a, 220, 0.07, 'square', 0.15);
      break;
    case 'siren':
      startSiren(a);
      break;
    case 'cash':
      tone(a, 880, 0.09, 'sine', 0.18);
      tone(a, 1320, 0.14, 'sine', 0.18, a.ctx.currentTime + 0.09);
      break;
    case 'complete':
    case 'mission':
      [523, 659, 784, 1046].forEach((f, i) => {
        tone(a, f, 0.16, 'sine', 0.16, a.ctx.currentTime + i * 0.09);
      });
      break;
    case 'crash':
      noise(a, 0.25, 0.3, 400);
      tone(a, 60, 0.3, 'sine', 0.3, a.ctx.currentTime, 40);
      break;
    case 'skid':
      // Tyre squeal: high band-passed noise sliding down.
      noise(a, 0.35, 0.14, 2600);
      tone(a, 900, 0.3, 'sawtooth', 0.05, a.ctx.currentTime, 420);
      break;
    case 'nearMiss':
      // Bright two-note chime for a near miss / drift bonus.
      tone(a, 1174, 0.08, 'sine', 0.16);
      tone(a, 1568, 0.16, 'sine', 0.16, a.ctx.currentTime + 0.07);
      break;
    case 'pickup':
      tone(a, 660, 0.07, 'square', 0.12);
      tone(a, 990, 0.12, 'square', 0.12, a.ctx.currentTime + 0.06);
      break;
    case 'busted':
      // Descending two-tone: the IDPD got you.
      tone(a, 392, 0.25, 'sawtooth', 0.14, a.ctx.currentTime, 311);
      tone(a, 311, 0.4, 'sawtooth', 0.14, a.ctx.currentTime + 0.25, 233);
      break;
    default:
      break;
  }
}
