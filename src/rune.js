// Our own sigil, drawn in code: a seven-pointed forge seal. It is painted once to a canvas and turned
// into a distance field plus a "when is this stroke drawn" map, so the floor shader can write it
// stroke by stroke, heat it from pale blue to gold, let it run molten, and leave it charred.
import * as THREE from 'three/webgpu';
import { vec2, vec3, float, texture, uniform, smoothstep, mix, exp, length, max, min, clamp } from 'three/tsl';

const TAU = Math.PI * 2;
const RANGE = 44;                    // distance field reach, in texture pixels

const GLYPHS = [
  [[[0, 0], [0, 1.6]], [[0, 1.2], [0.55, 1.6]], [[0, 0.65], [0.55, 1.05]]],
  [[[-0.42, 0], [0.42, 1.6]], [[0.42, 0], [-0.42, 1.6]]],
  [[[0, 0], [0, 1.6], [0.6, 1.2], [0, 0.8]]],
  [[[0, 0], [0.5, 0.8], [0, 1.6], [-0.5, 0.8], [0, 0]]],
  [[[-0.32, 1.6], [0.32, 1.1], [-0.32, 0.55], [0.32, 0]]],
  [[[0, 0], [0, 1.6]], [[-0.45, 1.08], [0, 1.6], [0.45, 1.08]]],
  [[[-0.38, 0], [-0.38, 1.6], [0.38, 0], [0.38, 1.6]]],
  [[[0, 0], [0, 1.0]], [[-0.4, 0.45], [0.4, 0.45]], [[-0.26, 1.6], [0, 1.0], [0.26, 1.6]]],
];

function paint(N) {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const cA = mk(), cB = mk();
  const A = cA.getContext('2d'), B = cB.getContext('2d', { willReadFrequently: true });
  const C = N / 2, U = N / 2 * 0.9;                      // centre and unit radius, pixels
  for (const g of [A, B]) { g.fillStyle = '#000'; g.fillRect(0, 0, N, N); g.lineCap = 'round'; g.lineJoin = 'round'; }
  const PAD = RANGE * 2;                                 // strokes are widened by the field's reach on each side
  const grey = (t) => { const v = Math.round(Math.max(0, Math.min(1, t)) * 255); return `rgb(${v},${v},${v})`; };
  const items = [];

  // each item: path(ctx), stroke width in units (0 = fill), and how its draw time runs across it
  const add = (path, w, time) => items.push({ path, w, time });
  const sweep = (t0, t1, a0, dir = 1) => (g) => {
    const gr = g.createConicGradient(a0, C, C);
    for (let i = 0; i <= 16; i++) gr.addColorStop(i / 16, grey(dir > 0 ? t0 + (t1 - t0) * i / 16 : t1 - (t1 - t0) * i / 16));
    return gr;
  };
  const along = (x0, y0, x1, y1, t0, t1) => (g) => {
    const gr = g.createLinearGradient(C + x0 * U, C + y0 * U, C + x1 * U, C + y1 * U);
    gr.addColorStop(0, grey(t0)); gr.addColorStop(1, grey(t1));
    return gr;
  };
  const at = (t) => () => grey(t);
  const circle = (r) => (g) => { g.beginPath(); g.arc(C, C, r * U, 0, TAU); };
  const poly = (pts, close) => (g) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(C + x * U, C + y * U) : g.moveTo(C + x * U, C + y * U))); if (close) g.closePath(); };
  const P = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  const TOP = -Math.PI / 2;

  // 1. outer wall: a heavy ring, a fine ring inside it, ticks and a band of marks between
  add(circle(0.965), 0.03, sweep(0.0, 0.3, TOP));
  add(circle(0.80), 0.011, sweep(0.08, 0.36, TOP, -1));
  for (let i = 0; i < 56; i++) {
    const a = TOP + i / 56 * TAU, long = i % 4 === 0;
    add(poly([P(0.935, a), P(long ? 0.895 : 0.915, a)]), long ? 0.012 : 0.009, at(0.05 + 0.3 * i / 56));
  }
  for (let i = 0; i < 21; i++) {
    const a = TOP + (i + 0.5) / 21 * TAU, gl = GLYPHS[(i * 5 + 3) % GLYPHS.length], h = 0.048;
    const ex = [-Math.sin(a), Math.cos(a)], ey = [Math.cos(a), Math.sin(a)];       // glyph x runs round the ring, y points out
    for (const st of gl) {
      add(poly(st.map(([x, y]) => { const r = 0.818 + y * h; return [ey[0] * r + ex[0] * x * h, ey[1] * r + ex[1] * x * h]; })), 0.0095, at(0.2 + 0.34 * i / 21));
    }
  }

  // 2. the seven-pointed star, one unbroken line that skips two points each time
  const star = Array.from({ length: 7 }, (_, i) => P(0.775, TOP + i / 7 * TAU));
  for (let i = 0; i < 7; i++) {
    const p = star[(i * 3) % 7], q = star[((i + 1) * 3) % 7];
    add(poly([p, q]), 0.02, along(p[0], p[1], q[0], q[1], 0.36 + 0.05 * i, 0.36 + 0.05 * (i + 1)));
  }
  star.forEach((p, i) => {
    add((g) => { g.beginPath(); g.arc(C + p[0] * U, C + p[1] * U, 0.052 * U, 0, TAU); }, 0.013, at(0.72 + 0.012 * i));
    add((g) => { g.beginPath(); g.arc(C + p[0] * U, C + p[1] * U, 0.02 * U, 0, TAU); }, 0, at(0.74 + 0.012 * i));
  });

  // 3. the hearth: an inner ring with seven flame tongues leaning the way the fire will turn
  add(circle(0.36), 0.016, sweep(0.62, 0.82, TOP, -1));
  for (let i = 0; i < 7; i++) {
    const a = TOP + (i + 0.5) / 7 * TAU;
    const b0 = P(0.375, a - 0.2), b1 = P(0.375, a + 0.16), tip = P(0.56, a + 0.3);
    const c0 = P(0.5, a - 0.12), c1 = P(0.47, a + 0.34);
    add((g) => {
      g.beginPath(); g.moveTo(C + b0[0] * U, C + b0[1] * U);
      g.quadraticCurveTo(C + c0[0] * U, C + c0[1] * U, C + tip[0] * U, C + tip[1] * U);
      g.quadraticCurveTo(C + c1[0] * U, C + c1[1] * U, C + b1[0] * U, C + b1[1] * U);
      g.closePath();
    }, 0, at(0.78 + 0.018 * i));
  }
  for (let i = 0; i < 28; i++) {
    const a = TOP + i / 28 * TAU;
    add((g) => { g.beginPath(); g.arc(C, C, 0.29 * U, a, a + TAU / 28 * 0.55); }, 0.0095, at(0.86 + 0.06 * i / 28));
  }

  // 4. the eye: a ring, seven short rays, a coal in the middle
  add(circle(0.2), 0.022, sweep(0.9, 0.97, TOP));
  for (let i = 0; i < 7; i++) {
    const a = TOP + i / 7 * TAU;
    add(poly([P(0.105, a), P(0.165, a + 0.22)]), 0.016, at(0.95 + 0.004 * i));
  }
  add(circle(0.058), 0, at(0.985));

  const draw = (g, it, style, pad) => {
    it.path(g);
    if (it.w > 0) { g.strokeStyle = style; g.lineWidth = it.w * U + pad; g.stroke(); }
    else { g.fillStyle = style; g.fill(); if (pad) { g.strokeStyle = style; g.lineWidth = pad; g.stroke(); } }
  };
  for (const it of items) draw(A, it, '#fff', 0);
  for (const it of items) draw(B, it, it.time(B), PAD);          // padded first, so the glow round a stroke shares its time
  for (const it of items) draw(B, it, it.time(B), 0);            // then exact, so each stroke keeps its own
  return { a: A.getImageData(0, 0, N, N).data, b: B.getImageData(0, 0, N, N).data };
}

// exact Euclidean distance transform (Felzenszwalb), squared distances
function edt(f, N) {
  const d = new Float32Array(N), v = new Int32Array(N), z = new Float32Array(N + 1), col = new Float32Array(N);
  const pass = (get, set) => {
    for (let q = 0; q < N; q++) col[q] = get(q);
    let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
    for (let q = 1; q < N; q++) {
      let s;
      do { const p = v[k]; s = ((col[q] + q * q) - (col[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
    }
    k = 0;
    for (let q = 0; q < N; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + col[p]; }
    for (let q = 0; q < N; q++) set(q, d[q]);
  };
  for (let x = 0; x < N; x++) pass((y) => f[y * N + x], (y, val) => { f[y * N + x] = val; });
  for (let y = 0; y < N; y++) pass((x) => f[y * N + x], (x, val) => { f[y * N + x] = val; });
  return f;
}

export function makeRuneTexture(N = 1024) {
  const { a, b } = paint(N);
  const inside = new Float32Array(N * N), outside = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) { const on = a[i * 4] > 127; inside[i] = on ? 1e12 : 0; outside[i] = on ? 0 : 1e12; }
  edt(inside, N); edt(outside, N);
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const d = Math.sqrt(inside[i]) - Math.sqrt(outside[i]);          // + inside a stroke, - outside, pixels
    const edge = (a[i * 4] / 255 - 0.5);                              // sub-pixel correction from the painted coverage
    data[i * 4] = Math.max(0, Math.min(255, Math.round((0.5 + (d + (d > 0 ? -0.5 : 0.5) + edge) / (2 * RANGE)) * 255)));
    data[i * 4 + 1] = b[i * 4];
    data[i * 4 + 2] = a[i * 4];
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function createRune({ centre = new THREE.Vector2(0, 0), radius = 1.95, noiseTex }) {
  const N = 1024;
  const tex = makeRuneTexture(N);
  const U = {
    draw: uniform(0),        // 0..1.05, how much of the seal has been written
    heat: uniform(0),        // 0..1, pale blue chalk-light to gold, spreading from the eye
    molten: uniform(0),      // 0..1, the strokes run with liquid fire
    cool: uniform(0),        // 0..1, glow breaks into embers and dies
    scorch: uniform(0),      // 0..1, the stone under the strokes is burned black
    power: uniform(1),
    time: uniform(0),
    centre: uniform(centre),
    radius: uniform(radius),
  };
  const unit = (N / 2 * 0.9);                     // texture pixels per rune unit
  const reach = RANGE / unit;                     // distance field reach, rune units

  const decal = ({ wp }) => {
    const q = wp.sub(U.centre).div(U.radius);
    const rn = length(q);
    const uv = q.mul(0.45).add(0.5);
    const s = texture(tex, uv);
    const d = s.r.sub(0.5).mul(2 * reach);        // + inside a stroke, rune units
    const inside = rn.lessThan(1.08).select(float(1), float(0));
    const shown = smoothstep(0.0, 0.03, U.draw.sub(s.g)).mul(inside);
    const bloomed = smoothstep(0.02, 0.14, U.draw.sub(s.g)).mul(inside);   // the glow round a stroke comes up after the stroke
    const aa = max(length(d.dFdx()), length(d.dFdy())).mul(0.9).max(0.0015);
    const line = smoothstep(aa.negate(), aa, d).mul(shown);
    // glows that fall to exactly zero where the distance field runs out
    const falloff = (w) => max(exp(min(d, 0).div(w)).sub(Math.exp(-reach / w)), 0).div(1 - Math.exp(-reach / w));
    const halo = falloff(0.03).mul(bloomed);
    const wide = falloff(0.09).mul(bloomed);
    // the nib: a hot point where the seal is being written right now
    const lag = U.draw.sub(s.g);
    const nib = exp(lag.mul(lag).div(0.00025).negate()).mul(falloff(0.02)).mul(inside)
      .mul(smoothstep(0.004, 0.03, U.draw)).mul(U.draw.lessThan(1.02).select(float(1), float(0)));

    const flow = texture(noiseTex, q.mul(1.3).add(vec2(U.time.mul(0.05), U.time.mul(-0.035)))).g;
    const fine = texture(noiseTex, q.mul(4.1).add(vec2(U.time.mul(-0.11), U.time.mul(0.07)))).b;
    const lava = flow.mul(0.6).add(fine.mul(0.4));

    const hot = smoothstep(rn.sub(0.32), rn, U.heat.mul(1.36));          // heat spreads from the eye outward
    const chalk = vec3(0.3, 0.58, 1.0).mul(line.mul(1.1).add(halo.mul(0.3)).add(wide.mul(0.05)));
    const gold = mix(vec3(1.0, 0.36, 0.05), vec3(1.0, 0.74, 0.3), lava).mul(line.mul(float(0.6).add(lava.mul(0.9))).add(halo.mul(0.24)).add(wide.mul(0.045)));
    const melt = mix(vec3(1.0, 0.3, 0.03), vec3(1.0, 0.86, 0.55), smoothstep(0.35, 0.75, lava))
      .mul(line.mul(float(0.5).add(lava.mul(0.85))).add(halo.mul(0.18)).add(wide.mul(0.03)));
    // embers: as it cools the glow shrinks to islands along the strokes, then to nothing
    const island = smoothstep(U.cool.mul(1.05).sub(0.12), U.cool.mul(1.05).add(0.06), lava.mul(0.75).add(fine.mul(0.25)));
    const ember = mix(vec3(1.0, 0.2, 0.02), vec3(0.6, 0.05, 0.0), U.cool).mul(line.mul(1.6).add(halo.mul(0.3))).mul(island);

    let glow = mix(chalk, gold, hot);
    glow = mix(glow, melt, U.molten);
    glow = mix(glow, ember, smoothstep(0.0, 0.25, U.cool));
    glow = glow.add(vec3(0.8, 0.9, 1.0).mul(nib).mul(1.3)).mul(U.power);

    const burnt = smoothstep(-0.03, 0.006, d).mul(shown).mul(U.scorch);
    return {
      glow,
      tint: mix(vec3(1), vec3(0.16, 0.14, 0.13), burnt),
      cover: burnt.max(line.mul(U.molten)),
      rough: mix(float(0.92), float(0.25), U.molten.mul(float(1).sub(U.cool))),
    };
  };
  return { U, decal, tex };
}
