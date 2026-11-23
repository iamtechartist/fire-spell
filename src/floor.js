// The courtyard floor: dark slate flagstones laid in rings, damp, with puddles and water in the joints.
// Everything is computed from the world position, so the paving has no seams and no geometry cost.
import * as THREE from 'three/webgpu';
import {
  vec2, vec3, float, positionWorld, texture, length, atan, floor, fract, min, max, mix, smoothstep,
  sin, cos, dot, round, normalize, cameraViewMatrix, vec4, clamp, mod,
} from 'three/tsl';

const TAU = Math.PI * 2;

// small wrapping 2D noise for puddles and blotches (R: broad, G: medium, B: fine)
export function noiseTexture(N = 256) {
  let s = 1234567;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const layer = (P) => {
    const g = new Float32Array(P * P);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    const out = new Float32Array(N * N);
    const f = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = x / N * P, py = y / N * P, ix = Math.floor(px), iy = Math.floor(py), u = f(px - ix), v = f(py - iy);
      const a = g[(iy % P) * P + (ix % P)], b = g[(iy % P) * P + ((ix + 1) % P)];
      const c = g[((iy + 1) % P) * P + (ix % P)], d = g[((iy + 1) % P) * P + ((ix + 1) % P)];
      out[y * N + x] = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    return out;
  };
  const fbm = (P0) => { const a = layer(P0), b = layer(P0 * 2), c = layer(P0 * 4), d = layer(P0 * 8); return a.map((v, i) => v * 0.52 + b[i] * 0.26 + c[i] * 0.14 + d[i] * 0.08); };
  const A = fbm(4), B = fbm(8), C = fbm(32);
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { data[i * 4] = A[i] * 255; data[i * 4 + 1] = B[i] * 255; data[i * 4 + 2] = C[i] * 255; data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function createFloor({ fireGlow = null, decal = null, lamps = null, noiseTex = null, centre = new THREE.Vector2() } = {}) {
  const loader = new THREE.TextureLoader();
  const load = (url, srgb) => {
    const t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const tD = load('./tex/stone_diff.jpg', true);
  const tN = noiseTex || noiseTexture();

  const world = positionWorld.xz;
  const wp = world.sub(vec2(centre.x, centre.y));          // the rings are laid round the casting stone
  const r = length(wp);

  // ---- ring paving
  const RW = 1.18;                                            // ring width, metres
  const k = floor(r.div(RW));                                 // ring number, 0 = the round centre stone
  const n = max(round(k.add(0.5).mul(TAU * RW / 1.5)), 1.0);  // slabs in this ring
  const turn = atan(wp.y, wp.x).div(TAU).add(0.5);
  const a = turn.add(fract(sin(k.mul(12.9898)).mul(43758.5453))).mul(n);
  const j = mod(floor(a), n);
  const u = fract(a), v = fract(r.div(RW));
  const width = r.mul(TAU).div(n);
  const hub = k.lessThan(0.5);                                // the round centre stone
  const du = hub.select(float(9), min(u, float(1).sub(u)).mul(width));
  const dv = hub.select(float(1).sub(v).mul(RW), min(v, float(1).sub(v)).mul(RW));
  const edge = min(du, dv);                                   // metres to the nearest joint
  // far away a 2 cm joint is thinner than a pixel: widen it to a pixel and fade it, or it sparkles
  const px = max(length(wp.dFdx()), length(wp.dFdy()));
  const near = clamp(float(0.03).div(px.max(1e-5)), 0, 1);
  const joint = float(1).sub(smoothstep(0.009, px.mul(1.5).add(0.024), edge)).mul(near);
  const h1 = fract(sin(dot(vec2(k, j), vec2(127.1, 311.7))).mul(43758.5453));
  const h2 = fract(h1.mul(57.31).add(0.37));

  // ---- stone face: each slab is a different piece of rock
  const rot = h1.mul(TAU);
  const lp = vec2(u.mul(width), v.mul(RW));
  const sUV = vec2(lp.x.mul(cos(rot)).sub(lp.y.mul(sin(rot))), lp.x.mul(sin(rot)).add(lp.y.mul(cos(rot)))).mul(0.4).add(vec2(h1.mul(13.7), h2.mul(7.3)));
  const rock = texture(tD, sUV).rgb;
  const lum = dot(rock, vec3(0.3, 0.5, 0.2));
  const veins = smoothstep(0.02, 0.2, lum);
  const blot = texture(tN, wp.mul(0.085)).rgb;

  // ---- water: puddles in the low spots, water standing in the joints
  const pud = texture(tN, wp.mul(0.19).add(vec2(0.31, 0.77))).rgb;
  const puddle = smoothstep(0.585, 0.63, pud.g.mul(0.75).add(pud.r.mul(0.25)).add(blot.r.sub(0.5).mul(0.25))).mul(near.mul(0.6).add(0.4));
  const wet = max(puddle, joint.mul(0.7));

  const slate = mix(vec3(0.07, 0.075, 0.084), vec3(0.23, 0.235, 0.245), veins.mul(0.85).add(blot.b.mul(0.15)))
    .mul(h2.mul(0.3).add(0.84))
    .mul(mix(vec3(1), vec3(0.93, 0.98, 1.06), h1));
  const dry = slate.mul(mix(float(1), float(0.4), joint));
  let color = dry.mul(mix(float(1), float(0.88), wet));
  let rough = mix(float(0.36).add(lum.mul(1.4)).add(blot.b.mul(0.22)).min(0.8), mix(float(0.16), float(0.04), puddle), wet);

  // ---- relief: bevelled slab edges and the grain of the rock, flat where water stands.
  // The bevel's slope is worked out exactly from which joint is nearest, not from screen derivatives:
  // those break a thin bevel into dashes as soon as a low light rakes across the court.
  const BW = max(float(0.045), px.mul(4.0));                    // never thinner than four pixels
  const tB = clamp(edge.div(BW), 0, 1);
  const slope = tB.mul(float(1).sub(tB)).mul(6 * 0.012).div(BW); // d(height)/d(distance to the joint) of a smooth 12 mm bevel
  const rHat = wp.div(r.max(1e-4)), tHat = vec2(rHat.y.negate(), rHat.x);   // out from the centre; the way the angle grows
  const gradV = hub.select(rHat.negate(), rHat.mul(v.lessThan(0.5).select(float(1), float(-1))));
  const gradU = tHat.mul(u.lessThan(0.5).select(float(1), float(-1)));
  const gradE = dv.lessThan(du).select(gradV, gradU);
  // the grain of the rock, fading out toward the joint so two slabs meet level
  const grain = lum.mul(0.012).mul(smoothstep(0.0, 0.12, edge));
  const ax = wp.dFdx(), bx = wp.dFdy();
  const hx = grain.dFdx(), hy = grain.dFdy();
  const det = ax.x.mul(bx.y).sub(ax.y.mul(bx.x));
  const safe = det.abs().max(1e-9).mul(det.sign().add(det.equal(0).select(float(1), float(0))));
  const gx = clamp(hx.mul(bx.y).sub(hy.mul(ax.y)).div(safe), -1.2, 1.2);
  const gz = clamp(hy.mul(ax.x).sub(hx.mul(bx.x)).div(safe), -1.2, 1.2);
  const tilt = vec2(gx, gz).add(gradE.mul(slope)).mul(float(1).sub(puddle)).mul(near);   // water lies level
  const nW = normalize(vec3(tilt.x.negate(), 1, tilt.y.negate()));

  const mat = new THREE.MeshStandardNodeMaterial();
  let emissive = vec3(0);
  if (decal) {
    const d = decal({ wp: world, wet, joint });
    color = color.mul(d.tint);
    rough = mix(rough, d.rough, d.cover);
    emissive = emissive.add(d.glow);
  }
  if (fireGlow) emissive = emissive.add(fireGlow(world).mul(color));
  if (lamps) emissive = emissive.add(lamps(world).mul(color).mul(1 / Math.PI));
  mat.colorNode = color;
  mat.roughnessNode = rough;
  mat.metalnessNode = float(0);
  mat.normalNode = normalize(cameraViewMatrix.mul(vec4(nW, 0)).xyz);       // world normal to view space
  mat.emissiveNode = emissive;

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return { mesh, mat };
}

// A night sky to reflect in the wet stone: deep blue overhead, a pale band at the horizon, a soft moon.
export function nightSky(moonDir) {
  const W = 256, H = 128;
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = (y + 0.5) / H, uu = (x + 0.5) / W;
    const lat = (v - 0.5) * Math.PI, ph = (uu - 0.5) * TAU;    // three.js equirect: u = atan2(z, x), v = asin(y)
    const dir = [Math.cos(lat) * Math.cos(ph), Math.sin(lat), Math.cos(lat) * Math.sin(ph)];
    const up = Math.max(0, dir[1]);
    const hz = Math.exp(-up * 5.0);
    let c = [0.012 + 0.03 * hz, 0.02 + 0.045 * hz, 0.045 + 0.075 * hz];
    if (dir[1] < 0) c = [0.004, 0.005, 0.008];
    const m = dir[0] * moonDir.x + dir[1] * moonDir.y + dir[2] * moonDir.z;
    const halo = Math.pow(Math.max(0, m), 60) * 1.6 + Math.pow(Math.max(0, m), 900) * 60;
    c = [c[0] + halo * 0.62, c[1] + halo * 0.78, c[2] + halo * 1.0];
    const i = (y * W + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 1;
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
