// Keyboard + mouse + pointer lock. Edge-triggered actions (reload, grenade
// select, slot switches) are consumed by main.js once per press; held state
// (movement, fire, ADS) is read every tick.
export class Input {
  constructor() {
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.fireHeld = false;
    this.adsHeld = false;
    this.locked = false;
    this.pressed = new Set(); // edge-triggered, cleared each tick by main
    this.wheelDelta = 0;
    this.onLockChange = null;
    this.onLockLoss = null;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Tab', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.fireHeld = false; this.adsHeld = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.fireHeld = true;
      if (e.button === 2) this.adsHeld = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.adsHeld = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => { if (this.locked) this.wheelDelta += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === document.body || !!document.pointerLockElement;
      if (was && !this.locked && this.onLockLoss) this.onLockLoss();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.locked = false; });
  }
  requestLock() {
    if (this.locked) return;
    const el = document.body;
    if (!el.requestPointerLock) return;
    // requestPointerLock returns a promise in Chrome that rejects without a
    // user gesture or when re-locking too fast — a rejection is normal (the
    // player clicks to re-lock), never an unhandled error.
    try {
      const p = el.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.locked = false; });
    } catch { this.locked = false; }
  }
  releaseLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }
  consumeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return [dx, dy];
  }
  wasPressed(code) { return this.pressed.has(code); }
  endTick() {
    this.pressed.clear();
    this.wheelDelta = 0;
  }
  moveInput() {
    return {
      f: (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0),
      s: (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
      jump: this.keys.has('Space'),
      crouch: this.keys.has('ControlLeft') || this.keys.has('KeyC'),
      walk: this.keys.has('AltLeft'),
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      lean: (this.keys.has('KeyQ') ? -1 : 0) + (this.keys.has('KeyE') ? 1 : 0),
    };
  }
}
