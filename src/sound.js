// The sound of the spell, made in code: one stereo track exactly as long as the loop. Every sound
// belongs to something on screen (a fist on stone, a crescent passing, a lamp catching); there is no
// music and no bed of noise under it. Plain arrays and maths only, so the same file runs in the page
// (a worker renders it once at load) and under node (tools/sound.mjs writes it out and measures it).
import { B, PLACE, LIFT, LAND, lampLayout } from './stage.js';

export const SR = 44100;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const rng = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

// ---- where a thing is heard from the camera: left/right, and how near
const CAM = PLACE.camera;
const FWD = (() => { const v = PLACE.look.map((c, i) => c - CAM[i]), l = Math.hypot(...v); return v.map((c) => c / l); })();
const RIGHT = (() => { const v = [-FWD[2], 0, FWD[0]], l = Math.hypot(...v); return v.map((c) => c / l); })();
function hear(p) {
  const v = [p[0] - CAM[0], p[1] - CAM[1], p[2] - CAM[2]];
  const d = Math.hypot(...v), xs = v[0] * RIGHT[0] + v[2] * RIGHT[2], zs = v[0] * FWD[0] + v[1] * FWD[1] + v[2] * FWD[2];
  return { pan: clamp(xs / (Math.max(zs, 1) * 0.56) * 0.75, -0.85, 0.85), near: clamp(12 / d, 0.35, 1.4) };
}

// ---- a filter whose pitch can move (state-variable; set() every few samples, run() every sample)
class Filter {
  constructor(fc = 1000, q = 0.707) { this.a = 0; this.b = 0; this.lp = 0; this.bp = 0; this.hp = 0; this.set(fc, q); }
  set(fc, q) {
    const g = Math.tan(Math.PI * clamp(fc, 12, SR * 0.45) / SR);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  run(x) {
    const v3 = x - this.b, v1 = this.a1 * this.a + this.a2 * v3, v2 = this.b + this.a2 * this.a + this.a3 * v3;
    this.a = 2 * v1 - this.a; this.b = 2 * v2 - this.b;
    this.bp = v1; this.lp = v2; this.hp = x - this.k * v1 - v2;
  }
}

const peak = (x) => { let m = 1e-9; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };
const norm = (x, to = 1) => { const g = to / peak(x); for (let i = 0; i < x.length; i++) x[i] *= g; return x; };
// layers: [samples, gain, seconds late]
function stack(...layers) {
  let n = 0;
  for (const [x, , late = 0] of layers) n = Math.max(n, x.length + Math.round(late * SR));
  const o = new Float32Array(n);
  for (const [x, g = 1, late = 0] of layers) { const k = Math.round(late * SR); for (let i = 0; i < x.length; i++) o[i + k] += x[i] * g; }
  return o;
}

// ---- the few kinds of sound everything here is built from
// a low knock whose pitch drops: fists, feet, the punch of the blast
function thud({ f0, f1, sweep = 0.04, decay = 0.2, len = decay * 6, drive = 0, attack = 0.002 }) {
  const n = Math.ceil(len * SR), x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / sweep)) / SR;
    let v = Math.sin(ph) * Math.exp(-t / decay) * Math.min(1, t / attack);
    if (drive) v = Math.tanh(v * drive) / Math.tanh(drive);
    x[i] = v;
  }
  return x;
}
// a band of noise. f: Hz, or a function of 0..1 through the sound. shape(u): loudness through the sound;
// without it, a quick attack and a fading tail.
function noise(len, rnd, { type = 'bp', f = 1000, q = 1, attack = 0.003, decay = 0.05, shape = null, top = 0 }) {
  const n = Math.ceil(len * SR), x = new Float32Array(n), flt = new Filter(), cap = top ? new Filter(top, 0.7) : null;
  const moving = typeof f === 'function';
  if (!moving) flt.set(f, q);
  for (let i = 0; i < n; i++) {
    if (moving && (i & 15) === 0) flt.set(f(i / n), q);
    flt.run(rnd() * 2 - 1);
    const t = i / SR;
    let v = flt[type];
    if (cap) { cap.run(v); v = cap.lp; }                            // top: nothing above this, so a long rush carries no hiss
    x[i] = v * (shape ? shape(i / n) : Math.min(1, t / attack) * Math.exp(-t / decay));
  }
  return norm(x);
}
const bell = (u, sharp = 1) => Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), 2 * sharp);
// one snap of a burning log, a spark, a grain of grit
function pop(rnd, f, dur, q) {
  const n = Math.ceil(dur * 6 * SR), x = new Float32Array(n), flt = new Filter(f, q), k = dur * SR;
  for (let i = 0; i < n; i++) { flt.run((rnd() * 2 - 1) * Math.exp(-i / k)); x[i] = flt.bp; }
  return norm(x);
}
// the low flap of a big flame: slow, gusty, never steady
function flame(len, rnd, { lp = 220, flutter = 9, drive = 2.4, top = 700, gusty = 1, base = 0.5, level = null }) {
  const n = Math.ceil(len * SR), x = new Float32Array(n);
  const body = new Filter(lp, 0.6), flut = new Filter(flutter, 0.6), gust = new Filter(1.3, 0.6), cap = new Filter(top, 0.7);
  const fk = Math.sqrt(SR / (2 * flutter)) * 1.1, gk = Math.sqrt(SR / 2.6) * 1.1, bk = Math.sqrt(SR / (2 * lp)) * 1.5;
  for (let i = 0; i < n; i++) {
    body.run(rnd() * 2 - 1); flut.run(rnd() * 2 - 1); gust.run(rnd() * 2 - 1);
    const e = clamp(base + (0.8 * flut.lp * fk + 0.5 * gust.lp * gk) * gusty, 0, 2.2);
    cap.run(Math.tanh(body.lp * bk * e * e * drive));
    x[i] = cap.lp * (level ? level(i / n) : 1);
  }
  return norm(x);
}
// a snap of electricity: bright noise chopped into a hard buzz, gone in a few hundredths of a second
function zap(len, rnd, { f = 3000, buzz = 110 }) {
  const n = Math.ceil(len * SR), x = new Float32Array(n), band = new Filter(f, 1.3), ph = rnd() * Math.PI;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    band.run(rnd() * 2 - 1);
    const chop = Math.pow(Math.abs(Math.sin(Math.PI * buzz * t + ph)), 6);
    x[i] = band.bp * (0.2 + 0.8 * chop) * Math.min(1, t / 0.0008) * Math.exp(-t / (len * 0.4));
  }
  return norm(x);
}
// struck metal or glass: a few partials that do not line up, each dying at its own rate. partials: [Hz, loudness, seconds]
function struck(len, partials, attack = 0.003) {
  const n = Math.ceil(len * SR), x = new Float32Array(n);
  for (const [f, g, d] of partials) for (let i = 0; i < n; i++) { const t = i / SR; x[i] += Math.sin(TAU * f * t) * g * Math.exp(-t / d) * Math.min(1, t / attack); }
  return norm(x);
}

// ---- the mixer: left, right, and what is sent to the court's stone to come back as echo
function mixer(seconds) {
  const n = Math.ceil(seconds * SR);
  const L = new Float32Array(n), R = new Float32Array(n), W = new Float32Array(n);
  const cues = [];
  // pan: -1 left .. 1 right; a number, or a function of 0..1 through the sound for something that moves
  const put = (t, x, { gain = 1, pan = 0, send = 0.15, name = null } = {}) => {
    if (name) cues.push([+t.toFixed(2), name]);
    const i0 = Math.round(t * SR), fixed = typeof pan === 'number';
    let gl = 0, gr = 0;
    if (fixed) { const a = (clamp(pan, -1, 1) + 1) * Math.PI / 4; gl = Math.cos(a) * gain; gr = Math.sin(a) * gain; }
    for (let i = 0; i < x.length; i++) {
      const j = i0 + i;
      if (j < 0 || j >= n) continue;
      if (!fixed && (i & 31) === 0) { const a = (clamp(pan(i / x.length), -1, 1) + 1) * Math.PI / 4; gl = Math.cos(a) * gain; gr = Math.sin(a) * gain; }
      L[j] += x[i] * gl; R[j] += x[i] * gr; W[j] += x[i] * gain * send;
    }
  };
  // many small snaps between t0 and t1; rate(t) per second (never above `most`)
  const crackle = (name, t0, t1, rnd, { rate, most, gain = 0.1, fLo = 1500, fHi = 6000, pan = 0, spread = 0.2, send = 0.08, snap = 0.012 }) => {
    let t = t0, count = 0;
    for (;;) {
      t += -Math.log(1 - rnd()) / most;
      if (t >= t1) break;
      if (rnd() > rate(t) / most) continue;
      const a = Math.pow(rnd(), 2.6);                            // most are small, a few snap
      const x = pop(rnd, fLo * Math.pow(fHi / fLo, rnd()), 0.0015 + snap * rnd() * (0.3 + a), 1.5 + 4 * rnd());
      put(t, x, { gain: gain * (0.15 + 0.85 * a), pan: pan + (rnd() * 2 - 1) * spread, send });
      count++;
    }
    cues.push([+t0.toFixed(2), `${name} (${count} snaps to ${t1.toFixed(1)} s)`]);
  };
  return { n, L, R, W, cues, put, crackle };
}

// the stone ring answers: a few slaps back off the arcade, then a short tail. Stone eats the top.
function court(m, wet = 1) {
  const { n, L, R, W } = m;
  const dull = new Filter(2600, 0.6), w = new Float32Array(n);
  for (let i = 0; i < n; i++) { dull.run(W[i]); w[i] = dull.lp; }
  const taps = [[0.043, 0.40, -0.6], [0.069, 0.34, 0.55], [0.097, 0.28, -0.3], [0.131, 0.23, 0.7], [0.173, 0.18, -0.75], [0.229, 0.13, 0.4], [0.293, 0.09, -0.1]];
  for (const [d, g, pan] of taps) {
    const k = Math.round(d * SR), a = (pan + 1) * Math.PI / 4, gl = Math.cos(a) * g * wet, gr = Math.sin(a) * g * wet;
    for (let i = 0; i + k < n; i++) { L[i + k] += w[i] * gl; R[i + k] += w[i] * gr; }
  }
  // tail: four combs (about 0.7 s to die away), smeared by two all-pass stages; a little different on each side
  const tail = new Float32Array(n);
  for (const d of [0.0297, 0.0371, 0.0411, 0.0437]) {
    const k = Math.round(d * SR), fb = Math.pow(10, -3 * d / 0.7), buf = new Float32Array(k);
    let p = 0, damp = 0;
    for (let i = 0; i < n; i++) { const y = buf[p]; damp += (y - damp) * 0.45; buf[p] = w[i] + damp * fb; p = (p + 1) % k; tail[i] += y; }
  }
  const smear = (x, d, g) => { const k = Math.round(d * SR), buf = new Float32Array(k); let p = 0; for (let i = 0; i < x.length; i++) { const b = buf[p], y = b - g * x[i]; buf[p] = x[i] + g * y; p = (p + 1) % k; x[i] = y; } return x; };
  smear(smear(tail, 0.005, 0.7), 0.0017, 0.7);
  const right = smear(Float32Array.from(tail), 0.0031, 0.6);
  const tg = 0.045 * wet, late = Math.round(0.05 * SR);
  for (let i = 0; i + late < n; i++) { L[i + late] += tail[i] * tg; R[i + late] += right[i] * tg; }
}

// ---- the score: what sounds, when, where
export function renderTrack() {
  const m = mixer(B.end), { put, crackle } = m;
  const r = rng(20261122);
  const seal = hear([PLACE.seal[0], 0.2, PLACE.seal[2]]), hands = hear([PLACE.seal[0], 1.3, PLACE.seal[2]]);
  const golem = hear([PLACE.golem[0], 1.8, PLACE.golem[2]]);
  const c0 = B.release, a0 = B.hit;

  // -- the mage: an ember in her hand, the swing, her fist on the stone
  crackle('ember in her hand', 0.25, B.slam - 0.1, r, { rate: () => 6, most: 6, gain: 0.07, fLo: 2200, fHi: 6500, pan: hands.pan, spread: 0.05, send: 0.08, snap: 0.006 });
  put(B.slam - 0.3, noise(0.3, r, { f: (u) => 380 + 700 * u, q: 1.1, top: 3200, shape: (u) => bell(u, 1.2) }), { gain: 0.07, pan: hands.pan, send: 0.1, name: 'her arm swings down' });
  put(B.slam, stack(
    [thud({ f0: 96, f1: 44, sweep: 0.035, decay: 0.16, drive: 1.6 }), 0.9],
    [noise(0.12, r, { f: 950, q: 2.5, attack: 0.0008, decay: 0.022 }), 0.55],
    [noise(0.06, r, { f: 2600, q: 2, attack: 0.0005, decay: 0.008 }), 0.4],
  ), { gain: 0.62, pan: seal.pan, send: 0.45, name: 'fist on the stone' });
  crackle('grit jumps', B.slam + 0.02, B.slam + 0.3, r, { rate: (t) => 45 * (1 - (t - B.slam) / 0.3), most: 45, gain: 0.07, fLo: 1200, fHi: 4200, pan: seal.pan, spread: 0.12, send: 0.2, snap: 0.004 });

  // -- the seal writes itself: a dry scratch that follows the line, then one glassy ring as it closes
  {
    const t0 = B.slam + 0.03, t1 = B.draw1 - 0.02, uneven = new Filter(5, 0.6), k = Math.sqrt(SR / 10) * 1.2;
    let t = t0, count = 0;
    while (t < t1) {
      t += 0.006 + 0.012 * r();
      for (let i = 0; i < 400; i++) uneven.run(r() * 2 - 1);            // strokes come in runs, not evenly
      const stroke = clamp(0.55 + uneven.lp * k * 3.2, 0, 1);
      if (stroke < 0.15) continue;
      const g = 0.3 * stroke * (0.4 + 0.6 * r()) * ease((t - t0) / 0.15) * (1 - 0.35 * ease((t - t1 + 0.4) / 0.4));
      put(t, pop(r, 2600 + 2600 * r(), 0.002 + 0.004 * r(), 2.5), { gain: g, pan: seal.pan + (r() * 2 - 1) * 0.14, send: 0.1 });
      count++;
    }
    m.cues.push([+t0.toFixed(2), `the seal is scratched into the stone (${count} grains to ${t1.toFixed(1)} s)`]);
  }
  put(B.draw1 - 0.03, struck(1.8, [[466, 1, 0.9], [1081, 0.5, 0.55], [1980, 0.3, 0.3], [3090, 0.16, 0.18]]), { gain: 0.055, pan: seal.pan, send: 0.35, name: 'the seal closes: one ring' });
  for (const [t, g] of [[B.slam + 1.38, 0.035], [B.slam + 1.6, 0.03]]) {
    put(t, noise(0.09, r, { f: 1100, q: 1.3, attack: 0.004, decay: 0.022 }), { gain: g, pan: seal.pan, send: 0.2, name: 'her boot on the stone' });
  }

  // -- the seal catches: a soft whoof as it turns gold, then it burns and snaps under the crescents
  put(B.heat0, stack(
    [flame(0.95, r, { lp: 260, flutter: 11, level: (u) => bell(u * 0.92, 0.8) }), 1],
    [noise(0.95, r, { f: (u) => 420 + 900 * u, q: 0.9, top: 3600, shape: (u) => bell(u * 0.9, 1.4) }), 0.45],
  ), { gain: 0.17, pan: seal.pan, send: 0.2, name: 'the seal catches fire' });
  crackle('the seal burns', B.heat0 + 0.1, c0 + 0.05, r, { rate: (t) => 4 + 13 * ease((t - B.heat0) / 0.9), most: 17, gain: 0.085, fLo: 1400, fHi: 5600, pan: seal.pan, spread: 0.22, send: 0.05 });
  put(B.heat1, flame(c0 - B.heat1, r, { lp: 230, flutter: 10, gusty: 1.3, base: 0.4, level: (u) => 0.55 + 0.45 * u }), { gain: 0.085, pan: seal.pan, send: 0.04, name: 'flames on the seal' });

  // -- four flame crescents: each lights with a puff, then is heard every time it sweeps the near side,
  //    faster and higher as they wind in toward her hands
  for (let i = 0; i < 4; i++) {
    const lit = B.spin0 + i * 0.14;
    put(lit, noise(0.3, r, { f: (u) => 320 + 800 * bell(u, 0.5), q: 1.0, top: 3600, shape: (u) => bell(Math.pow(u, 0.6), 1) }), { gain: 0.13, pan: seal.pan + 0.25 * Math.cos(i * 1.7), send: 0.2, name: `crescent ${i + 1} lights` });
    // its head is nearest to us whenever the angle passes 270 degrees
    const ang = (t) => { const sp = t - B.spin0; return i * Math.PI / 2 + 0.4 + 2.2 * sp + 2.0 * sp * sp + 1.95; };
    for (let k = Math.ceil((ang(lit + 0.15) - 1.5 * Math.PI) / TAU); ; k++) {
      // solve ang(t) = 1.5 pi + 2 pi k for t
      const need = 1.5 * Math.PI + TAU * k - (i * Math.PI / 2 + 0.4 + 1.95);
      const sp = (-2.2 + Math.sqrt(2.2 * 2.2 + 8 * need)) / 4, t = B.spin0 + sp;
      if (t > c0 - 0.02) break;
      const w = 2.2 + 4 * sp, wind = ease((t - lit - 0.75) / 0.95);       // how fast it turns, how far it has wound in
      const dur = clamp(1.7 / w, 0.13, 0.5), top = 520 + 150 * w;
      put(t - dur / 2, noise(dur, r, { f: (u) => top * (0.55 + 0.45 * bell(u, 0.6)), q: 1.3, top: 4200, shape: (u) => bell(u, 1.1) }),
        { gain: 0.17 + 0.22 * wind + 0.016 * w, pan: (u) => seal.pan + (u - 0.5) * (0.7 - 0.4 * wind), send: 0.18, name: `crescent ${i + 1} sweeps past` });
    }
  }
  // -- the seal lifts her off the stone: a low swell that climbs, and energy snapping between her feet and the seal
  put(LIFT.t0 - 0.05, stack(
    [thud({ f0: 48, f1: 118, sweep: 0.4, decay: 0.55, attack: 0.16, len: 1.6 }), 0.9],
    [noise(1.0, r, { type: 'lp', f: (u) => 220 + 480 * u, q: 0.8, top: 2400, shape: (u) => bell(Math.pow(u, 0.6), 1) }), 0.55],
  ), { gain: 0.2, pan: seal.pan, send: 0.3, name: 'the seal lifts her off the stone' });
  {
    const t0 = LIFT.t0 + 0.08, t1 = c0 + 0.28;
    const strength = (t) => ease((t - LIFT.t0 - 0.05) / 0.3) * (1 - ease((t - c0 - 0.02) / 0.3)) * (0.7 + 0.3 * ease((t - c0 + 0.6) / 0.5));
    put(t0, zap(0.14, r, { f: 2400, buzz: 95 }), { gain: 0.2, pan: seal.pan, send: 0.3, name: 'the first arc snaps to her feet' });
    let t = t0 + 0.1, count = 0;
    for (;;) {
      t += -Math.log(1 - r()) / 13;
      if (t >= t1) break;
      const k = strength(t);
      if (r() > 0.25 + 0.75 * k) continue;
      const big = Math.pow(r(), 2);
      put(t, zap(0.03 + 0.08 * big, r, { f: 1800 + 3400 * r(), buzz: 80 + 70 * r() }), { gain: 0.11 * k * (0.35 + 0.65 * big), pan: seal.pan + (r() * 2 - 1) * 0.14, send: 0.14 });
      count++;
    }
    m.cues.push([+t0.toFixed(2), `energy crackles between her feet and the seal (${count} snaps to ${t1.toFixed(1)} s)`]);
  }
  for (const [t, g] of [[LAND, 0.14], [LAND + 0.07, 0.09]]) {
    put(t, stack(
      [thud({ f0: 96, f1: 52, sweep: 0.03, decay: 0.07, drive: 1.2 }), 1],
      [noise(0.1, r, { f: 1000, q: 1.2, attack: 0.002, decay: 0.025 }), 0.5],
    ), { gain: g, pan: seal.pan, send: 0.3, name: 'she lands' });
  }
  crackle('grit under her boots', LAND, LAND + 0.2, r, { rate: () => 40, most: 40, gain: 0.03, fLo: 1200, fHi: 3600, pan: seal.pan, spread: 0.06, send: 0.2, snap: 0.004 });

  // the fire is drawn in to her hands: a rush that climbs and stops dead
  put(c0 - 0.75, noise(0.75, r, { f: (u) => 240 * Math.pow(6.5, u * u), q: 1.2, top: 4200, shape: (u) => Math.pow(u, 2.2) * (1 - ease((u - 0.975) / 0.025)) }),
    { gain: 0.3, pan: hands.pan, send: 0.2, name: 'the fire is drawn in to her hands' });

  // -- the bolt leaves her hands and crosses the court
  put(c0, thud({ f0: 150, f1: 62, sweep: 0.03, decay: 0.07, drive: 1.5 }), { gain: 0.42, pan: hands.pan, send: 0.3, name: 'the bolt leaves her hands' });
  put(c0, noise(a0 - c0 + 0.05, r, { f: (u) => 650 + 2200 * u, q: 1.5, top: 5200, shape: (u) => Math.pow(bell(u * 0.93 + 0.07, 0.7), 1) * (0.5 + 0.5 * u) }),
    { gain: 0.4, pan: (u) => hands.pan + (golem.pan - hands.pan) * u, send: 0.2, name: 'the bolt crosses the court' });

  // -- the blast at the golem: crack, punch, body, the roll of the fireball going up, sparks
  put(a0, stack(
    [noise(0.05, r, { type: 'hp', f: 900, q: 0.7, attack: 0.0003, decay: 0.006 }), 0.85],
    [thud({ f0: 128, f1: 38, sweep: 0.075, decay: 0.42, drive: 2.6 }), 1.0],
    [thud({ f0: 44, f1: 30, sweep: 0.3, decay: 0.75 }), 0.5, 0.01],
    [noise(1.5, r, { type: 'lp', f: (u) => 1100 * Math.pow(0.12, u), q: 0.7, attack: 0.002, decay: 0.34 }), 0.9],
    [noise(0.7, r, { f: (u) => 760 * Math.pow(0.4, u), q: 0.8, attack: 0.001, decay: 0.13 }), 0.7],
  ), { gain: 0.95, pan: golem.pan * 0.6, send: 0.5, name: 'the blast' });
  put(a0 + 0.08, flame(1.9, r, { lp: 300, flutter: 12, top: 900, level: (u) => Math.pow(1 - u, 1.6) * ease(u / 0.06) }), { gain: 0.42, pan: golem.pan, send: 0.3, name: 'the fireball rolls up' });
  crackle('sparks from the blast', a0 + 0.02, a0 + 1.9, r, { rate: (t) => 46 * Math.exp(-(t - a0) / 0.6) + 4, most: 50, gain: 0.13, fLo: 1800, fHi: 7000, pan: golem.pan, spread: 0.45, send: 0.12, snap: 0.008 });

  // -- the golem: it rocks on its feet, its furnace catches and it roars, then it breathes through the two chimneys
  for (const [t, g] of [[a0 + 0.72, 0.3]]) {
    put(t, stack(
      [thud({ f0: 70, f1: 36, sweep: 0.04, decay: 0.13, drive: 1.4 }), 1],
      [noise(0.12, r, { type: 'lp', f: 420, q: 0.8, attack: 0.002, decay: 0.03 }), 0.5],
    ), { gain: g, pan: golem.pan, send: 0.4, name: 'the golem sets a foot down' });
    crackle('grit under its foot', t, t + 0.12, r, { rate: () => 70, most: 70, gain: g * 0.22, fLo: 900, fHi: 3000, pan: golem.pan, spread: 0.08, send: 0.2, snap: 0.004 });
  }
  for (let k = Math.ceil(((a0 + 1.0) * 7 - Math.PI / 2) / Math.PI); ; k++) {
    const t = (Math.PI / 2 + Math.PI * k) / 7;                              // each chimney puffs in turn (the flames in main.js)
    if (t > B.end - 0.8) break;
    const on = ease((t - a0 - 1.0) / 0.6);
    put(t - 0.07, noise(0.2, r, { type: 'lp', f: (u) => 620 - 300 * u, q: 0.8, shape: (u) => bell(Math.pow(u, 0.55), 1.2) }),
      { gain: 0.09 * on, pan: golem.pan + (k % 2 ? 0.08 : -0.08), send: 0.15, name: k % 2 ? 'chimney puff (right)' : 'chimney puff (left)' });
  }
  put(a0 + 1.42, stack(
    [flame(1.25, r, { lp: 300, flutter: 16, drive: 3.2, top: 1000, gusty: 0.6, base: 0.75, level: (u) => ease(u / 0.14) * Math.pow(1 - u, 0.8) }), 1],
    [noise(1.25, r, { f: (u) => 430 - 170 * u, q: 2.2, top: 1800, shape: (u) => ease(u / 0.12) * Math.pow(1 - u, 1.1) * (0.75 + 0.25 * Math.sin(u * 60)) }), 0.5],
    [thud({ f0: 70, f1: 44, sweep: 0.2, decay: 0.5, attack: 0.05 }), 0.5],
  ), { gain: 0.28, pan: golem.pan, send: 0.45, name: 'the golem roars as its furnace catches' });
  // the scorched seal ticks as it cools
  crackle('the seal ticks as it cools', a0 + 0.9, a0 + 4.4, r, { rate: (t) => 2.4 * (1 - (t - a0 - 0.9) / 3.6) + 0.5, most: 3, gain: 0.04, fLo: 3000, fHi: 6200, pan: seal.pan, spread: 0.15, send: 0.15, snap: 0.003 });

  // -- the lamps catch one after another; the brazier last, and it burns to the end
  for (const l of lampLayout().list) {
    const h = hear(l.pos), t = B.wave + l.delay;
    if (l.kind === 'brazier') {
      put(t - 0.03, stack(
        [noise(0.7, r, { type: 'lp', f: (u) => 520 - 300 * u, q: 0.7, shape: (u) => bell(Math.pow(u, 0.42), 1.1) }), 1],
        [thud({ f0: 74, f1: 48, sweep: 0.08, decay: 0.2 }), 0.5, 0.05],
      ), { gain: 0.3, pan: h.pan, send: 0.4, name: 'the brazier catches' });
      const burn = B.end - 0.25 - t;
      put(t + 0.15, flame(burn, r, { lp: 250, flutter: 5, drive: 1.3, gusty: 2.2, base: 0.3, level: (u) => ease(u / 0.12) * (1 - ease((u - 0.8) / 0.2)) }), { gain: 0.07, pan: h.pan, send: 0.04, name: 'the brazier burns' });
      crackle('the brazier snaps', t + 0.1, B.end - 0.5, r, { rate: () => 8, most: 8, gain: 0.09, fLo: 1300, fHi: 5000, pan: h.pan, spread: 0.1, send: 0.05 });
    } else {
      const post = l.kind === 'post';
      put(t, stack(
        [noise(0.11, r, { type: 'lp', f: (u) => 1500 - 1100 * u, q: 0.8, attack: 0.006, decay: 0.03 }), 1],
        [struck(0.05, [[2500 + 900 * r(), 1, 0.006]], 0.0005), 0.35],
      ), { gain: (post ? 0.36 : 0.3) * h.near, pan: h.pan, send: 0.3, name: post ? 'a lantern post catches' : null });
    }
  }
  m.cues.push([+B.draw1.toFixed(2), 'the arcade lanterns catch in a sweep round the ring, one soft puff each (37, to ' + (B.draw1 + 3).toFixed(1) + ' s)']);

  court(m);

  // -- the whole track: no rumble below hearing, in and out with the picture, peaks rounded off
  const { L, R, n } = m, hpL = new Filter(28, 0.7), hpR = new Filter(28, 0.7);
  let top = 1e-9;
  for (let i = 0; i < n; i++) {
    const t = i / SR, fade = ease(t / 0.25) * (1 - ease((t - (B.end - 0.55)) / 0.5));
    hpL.run(L[i]); hpR.run(R[i]);
    L[i] = Math.tanh(hpL.hp * fade * 1.15); R[i] = Math.tanh(hpR.hp * fade * 1.15);
    top = Math.max(top, Math.abs(L[i]), Math.abs(R[i]));
  }
  const g = 0.9 / top;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  m.cues.sort((p, q) => p[0] - q[0]);
  return { sr: SR, seconds: B.end, L, R, cues: m.cues };
}
