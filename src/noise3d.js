// A small tiling 3D noise texture made once on the CPU, for the fine detail the 7 cm sim grid cannot hold.
// R: billowy (inverted cell noise, 3 octaves)   G: soft gradient noise fbm   B: fine cells   A: thin crack lines
import * as THREE from 'three/webgpu';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function cells(N, C, seed) {
  // distance to the nearest feature point on a wrapping C x C x C lattice, 0..1
  const r = rng(seed);
  const pts = new Float32Array(C * C * C * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = r();
  const out = new Float32Array(N * N * N);
  const s = C / N;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = (x + 0.5) * s, py = (y + 0.5) * s, pz = (z + 0.5) * s;
    const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
    let best = 9;
    for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j, gz = cz + k;
      const w = ((((gz % C) + C) % C) * C + (((gy % C) + C) % C)) * C + (((gx % C) + C) % C);
      const dx = gx + pts[w * 3] - px, dy = gy + pts[w * 3 + 1] - py, dz = gz + pts[w * 3 + 2] - pz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) best = d;
    }
    out[(z * N + y) * N + x] = Math.min(1, Math.sqrt(best));
  }
  return out;
}

function gradient(N, Pd, seed) {
  // wrapping gradient noise with period Pd, about -1..1
  const r = rng(seed);
  const g = new Float32Array(Pd * Pd * Pd * 3);
  for (let i = 0; i < Pd * Pd * Pd; i++) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2, q = Math.sqrt(1 - u * u);
    g[i * 3] = q * Math.cos(a); g[i * 3 + 1] = q * Math.sin(a); g[i * 3 + 2] = u;
  }
  const out = new Float32Array(N * N * N);
  const s = Pd / N, f = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (ix, iy, iz, x, y, z) => {
    const w = (((iz % Pd) * Pd) + (iy % Pd)) * Pd + (ix % Pd);
    return g[w * 3] * x + g[w * 3 + 1] * y + g[w * 3 + 2] * z;
  };
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = (x + 0.5) * s, py = (y + 0.5) * s, pz = (z + 0.5) * s;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    const fx = px - ix, fy = py - iy, fz = pz - iz, u = f(fx), v = f(fy), w = f(fz);
    const l = (a, b, t) => a + (b - a) * t;
    out[(z * N + y) * N + x] = l(
      l(l(dot(ix, iy, iz, fx, fy, fz), dot(ix + 1, iy, iz, fx - 1, fy, fz), u),
        l(dot(ix, iy + 1, iz, fx, fy - 1, fz), dot(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz), u), v),
      l(l(dot(ix, iy, iz + 1, fx, fy, fz - 1), dot(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1), u),
        l(dot(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1), dot(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1), u), v), w);
  }
  return out;
}

export function makeNoise3D(N = 64) {
  const c4 = cells(N, 4, 11), c8 = cells(N, 8, 23), c16 = cells(N, 16, 37);
  const g4 = gradient(N, 4, 5), g8 = gradient(N, 8, 6), g16 = gradient(N, 16, 7);
  const data = new Uint8Array(N * N * N * 4);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let i = 0; i < N * N * N; i++) {
    const billow = (1 - c4[i]) * 0.56 + (1 - c8[i]) * 0.29 + (1 - c16[i]) * 0.15;      // puffs
    const soft = 0.5 + 0.5 * (g4[i] * 0.55 + g8[i] * 0.3 + g16[i] * 0.15) * 1.7;
    const fine = (1 - c16[i]) * 0.6 + (1 - c8[i]) * 0.4;
    const ridge = 1 - Math.abs(g8[i] * 0.65 + g16[i] * 0.35) * 11;                      // thin bright lines, black between
    data[i * 4] = c((billow - 0.28) / 0.6);
    data[i * 4 + 1] = c(soft);
    data[i * 4 + 2] = c((fine - 0.25) / 0.65);
    data[i * 4 + 3] = c(ridge);
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}
