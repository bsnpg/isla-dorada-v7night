// Isla Dorada — save / load via localStorage (key GAME.saveKey).
// All localStorage access is wrapped in try/catch (private windows).
// saveSummary() reads the stored save without loading it, so the title
// screen can show the completion percentage on the CONTINUE button.
import { GAME, MISSIONS } from './config.js';
import { serializeProgression, applyProgressionSave } from './progression.js';

function readRaw() {
  try {
    const raw = window.localStorage.getItem(GAME.saveKey);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return (data && typeof data === 'object') ? data : null;
  } catch (err) {
    return null;
  }
}

export function saveGame(G) {
  try {
    const data = {
      missionIndex: (G.missions && typeof G.missions.index === 'number') ? G.missions.index : 0,
      money: G.player ? G.player.money : 0,
      upgrades: (G.garage && G.garage.owned) ? { ...G.garage.owned } : {},
      stats: G.stats ? { ...G.stats } : {},
      playerPos: (G.player && G.player.pos)
        ? { x: G.player.pos.x, z: G.player.pos.z } : { x: 0, z: 0 },
      health: G.player ? G.player.health : 100,
      armour: G.player ? G.player.armour : 0,
      maxHealth: G.player ? (G.player.maxHealth || 100) : 100,
      progression: serializeProgression(G),
      savedAt: Date.now(),
    };
    window.localStorage.setItem(GAME.saveKey, JSON.stringify(data));
    return true;
  } catch (err) {
    return false;
  }
}

export function loadGame(G) {
  const data = readRaw();
  if (!data) return false;

  if (typeof data.money === 'number' && G.player) G.player.money = data.money;
  if (typeof data.health === 'number' && G.player) G.player.health = data.health;
  if (typeof data.armour === 'number' && G.player) G.player.armour = data.armour;

  // Progression: old saves have no `progression` block — the fresh defaults
  // from initProgression stay untouched (backward-compatible).
  if (data.progression && G.progression) {
    applyProgressionSave(G, data.progression);
  }
  if (typeof data.maxHealth === 'number' && G.player) {
    G.player.maxHealth = Math.max(100, data.maxHealth);
  }
  // Clamp health to the cap even for old saves (no progression block):
  // a stored health above the fresh 100 cap must not survive the load.
  if (G.player && typeof G.player.maxHealth === 'number'
      && G.player.health > G.player.maxHealth) {
    G.player.health = G.player.maxHealth;
  }

  if (data.upgrades && typeof data.upgrades === 'object') {
    if (!G.garage) G.garage = { owned: {} };
    if (!G.garage.owned) G.garage.owned = {};
    for (const key of Object.keys(G.garage.owned)) delete G.garage.owned[key];
    Object.assign(G.garage.owned, data.upgrades);
  }

  if (data.stats && typeof data.stats === 'object' && G.stats) {
    Object.assign(G.stats, data.stats);
  }

  if (data.playerPos && G.player && G.player.pos && typeof G.player.pos.set === 'function') {
    G.player.pos.set(data.playerPos.x || 0, 0, data.playerPos.z || 0);
  }

  const missionIndex = (typeof data.missionIndex === 'number'
    && data.missionIndex >= 0 && data.missionIndex < MISSIONS.length)
    ? data.missionIndex : 0;
  if (G.startMission) G.startMission(missionIndex);
  if (G.setMode) G.setMode('play');
  return true;
}

export function hasSave() {
  return readRaw() !== null;
}

// Completion summary of the stored save (no load, no side effects).
export function saveSummary() {
  const data = readRaw();
  if (!data) return null;
  const done = (data.stats && typeof data.stats.missionsDone === 'number')
    ? data.stats.missionsDone : 0;
  return {
    missionIndex: (typeof data.missionIndex === 'number') ? data.missionIndex : 0,
    money: (typeof data.money === 'number') ? data.money : 0,
    missionsDone: done,
    percent: Math.round((done / MISSIONS.length) * 100),
    playSeconds: (data.stats && typeof data.stats.playSeconds === 'number')
      ? data.stats.playSeconds : 0,
    carsStolen: (data.stats && typeof data.stats.carsStolen === 'number')
      ? data.stats.carsStolen : 0,
    idolsFound: (data.progression && data.progression.collected && Array.isArray(data.progression.collected))
      ? data.progression.collected.filter(Boolean).length : 0,
    repLevel: (data.progression && data.progression.rep && typeof data.progression.rep.level === 'number')
      ? data.progression.rep.level : 1,
  };
}

export function clearSave() {
  try {
    window.localStorage.removeItem(GAME.saveKey);
    return true;
  } catch (err) {
    return false;
  }
}
