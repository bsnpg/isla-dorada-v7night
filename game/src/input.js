// Keyboard + mouse input state. Classic WASD driving, mouse aim on foot.
// Single shared instance: main.js calls Input.init(canvas) once at boot, and
// every gameplay module reads from it. One-shot keys are consumed with
// pressed() so a keypress fires exactly once even across fixed-step updates.
export const Input = {
  keys: new Set(),
  mouseDX: 0,
  mouseDY: 0,
  mouseDown: false,
  mouseClicked: false,
  pointerLocked: false,
  wheelDelta: 0,

  init(canvas) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouseDown = true; this.mouseClicked = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    window.addEventListener('wheel', (e) => { this.wheelDelta += e.deltaY; }, { passive: true });
    document.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
  },

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  },

  pressed(code) {
    if (this.keys.has(code)) { this.keys.delete(code); return true; }
    return false;
  },

  // True (and consumed) if any of the given codes was pressed this frame.
  pressedAny(...codes) {
    for (const c of codes) if (this.pressed(c)) return true;
    return false;
  },

  // Drop keys from the held set (used when a key both closes an overlay and would
  // otherwise be seen again by the main loop on the next frame — e.g. M closing
  // the map would instantly reopen it).
  clear(...codes) {
    for (const c of codes) this.keys.delete(c);
  },

  clearAll() {
    this.keys.clear();
    this.mouseDown = false;
    this.mouseClicked = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
  },

  // Consume the per-frame mouse deltas.
  consumeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  },

  consumeClick() {
    const c = this.mouseClicked;
    this.mouseClicked = false;
    return c;
  },

  // Consume accumulated wheel scroll (positive = scrolled down). Used for
  // weapon cycling on foot when the pointer is locked.
  consumeWheel() {
    const d = this.wheelDelta;
    this.wheelDelta = 0;
    return d;
  },

  lockPointer(canvas) {
    if (canvas && canvas.requestPointerLock) canvas.requestPointerLock();
  },

  unlockPointer() {
    if (document.pointerLockElement) document.exitPointerLock();
  },
};
