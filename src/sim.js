// Live 3D fire and smoke: a real fluid simulation on the GPU (WebGPU compute, three r187 TSL).
// Semi-Lagrangian advection, buoyancy, curl-noise turbulence, Jacobi pressure projection.
// The structure follows three.js's own webgpu_volume_fire example (MIT); the emitters, the
// expansion source, soot from cooling, the floor boundary and the light grid are this project's.
import * as THREE from 'three/webgpu';
import {
  vec3, vec4, uvec3, float, Fn, uniform, texture3D, textureStore, storageTexture, instanceIndex,
  smoothstep, mix, min, max, floor, If, exp, length, clamp,
} from 'three/tsl';
import { snoiseVec3 } from 'three/addons/tsl/math/curlNoise.js';

export const CELL = 0.085;                      // metres per voxel (cubic)
export const GX = 96, GY = 112, GZ = 96;
export const SIZE = new THREE.Vector3(GX * CELL, GY * CELL, GZ * CELL);
const CELLS = GX * GY * GZ;
const TX = 1 / GX, TY = 1 / GY, TZ = 1 / GZ;
const GRID = vec3(GX, GY, GZ);

// light grid: quarter resolution
export const LX = GX / 4, LY = GY / 4, LZ = GZ / 4;
const LCELLS = LX * LY * LZ;
const LGRID = vec3(LX, LY, LZ);

const NOISE_N = 64;

function storage3D(name, x, y, z, repeat = false) {
  const t = new THREE.Storage3DTexture(x, y, z);
  t.name = name;
  t.format = THREE.RGBAFormat;
  t.type = THREE.HalfFloatType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  return t;
}

const coordOf = (id, gx, gy) => uvec3(id.mod(gx), id.div(gx).mod(gy), id.div(gx * gy));

// What an opaque flame at heat h (0..~1.6) looks like: colour and brightness, linear light, HDR.
export const fireRamp = Fn(([h]) => {
  const c = vec3(0).toVar();
  c.assign(mix(c, vec3(0.30, 0.02, 0.0), smoothstep(0.2, 0.38, h)));
  c.assign(mix(c, vec3(1.1, 0.14, 0.006), smoothstep(0.36, 0.54, h)));
  c.assign(mix(c, vec3(2.6, 0.62, 0.035), smoothstep(0.50, 0.78, h)));
  c.assign(mix(c, vec3(6.5, 2.7, 0.33), smoothstep(0.76, 1.05, h)));
  c.assign(mix(c, vec3(15.0, 9.5, 3.2), smoothstep(1.02, 1.45, h)));
  return c;
});

export function createSim(renderer, origin = new THREE.Vector3()) {
  const uSize = uniform(SIZE.clone());
  const uOrigin = uniform(origin.clone());       // world position of the box's bottom centre
  const uDt = uniform(1 / 120);
  const uTime = uniform(0);

  const P = {
    buoyancy: uniform(18.0),     // m/s2 per unit temperature
    weight: uniform(0.35),       // m/s2 per unit smoke
    turb: uniform(10.0),         // thermal curl-noise force
    turbFade: uniform(2.5),      // /s, how fast that force dies as the gas ages
    turbFreq: uniform(5.0),
    turbAmbient: uniform(0.6),
    damping: uniform(0.35),      // /s
    cooling: uniform(0.95),      // /s linear
    coolRad: uniform(0.8),       // /s at T = 1, scales with T^3 (radiative)
    dissipation: uniform(0.5),   // /s smoke
    soot: uniform(0.24),         // smoke made per unit of temperature lost
    burn: uniform(11.0),         // /s, how fast fuel burns once it is hot
    heat: uniform(1.0),          // temperature per unit of fuel burned
    sootBurn: uniform(0.2),      // smoke per unit of fuel burned
    expand: uniform(0.25),       // gas expansion while burning (grid units)
    restLock: uniform(5.0),      // burning gas re-anchors its detail pattern
    restRelax: uniform(1.1),     // /s, the pattern slowly renews so it never stretches into streaks
  };

  // the blast: gas inside a ball of radius `r` spreads so the ball's rim moves out at `v` m/s
  const blast = { pos: uniform(new THREE.Vector3(0, 1, 0)), r: uniform(0.5), v: uniform(0) };

  // emitters: analytic spheres that add heat, smoke, an outward push and expansion
  const emitters = [];
  for (let i = 0; i < 3; i++) {
    emitters.push({
      pos: uniform(new THREE.Vector3(0, 1, 0)),   // world
      rad: uniform(0.5),
      temp: uniform(0),      // temperature per second
      fuel: uniform(0),      // fuel per second
      dens: uniform(0),      // smoke per second
      push: uniform(0),      // radial acceleration m/s2
      up: uniform(0),        // upward acceleration m/s2
      expand: uniform(0),    // divergence source (per step, grid units)
      rough: uniform(0.7),   // how much noise breaks the sphere up
    });
  }

  const velA = storage3D('velA', GX, GY, GZ), velB = storage3D('velB', GX, GY, GZ);
  const dyeA = storage3D('dyeA', GX, GY, GZ), dyeB = storage3D('dyeB', GX, GY, GZ);
  const divT = storage3D('div', GX, GY, GZ);
  const prA = storage3D('prA', GX, GY, GZ), prB = storage3D('prB', GX, GY, GZ);
  const curlT = storage3D('curl', NOISE_N, NOISE_N, NOISE_N, true);
  const restA = storage3D('restA', GX, GY, GZ), restB = storage3D('restB', GX, GY, GZ);
  const cDiv = storage3D('cDiv', LX, LY, LZ);
  const cPrA = storage3D('cPrA', LX, LY, LZ), cPrB = storage3D('cPrB', LX, LY, LZ);
  const litSrc = storage3D('litSrc', LX, LY, LZ);
  const litA = storage3D('litA', LX, LY, LZ), litB = storage3D('litB', LX, LY, LZ);

  const dye = texture3D(dyeA);                       // read side (ping-pong by .value)
  const dyeW = storageTexture(dyeB).toWriteOnly();   // write side
  const rest = texture3D(restA);
  const restW = storageTexture(restB).toWriteOnly();
  const lit = texture3D(litA);
  const litW = storageTexture(litB).toWriteOnly();
  const curl = texture3D(curlT);

  const uvwOf = (coord, grid) => vec3(coord).add(0.5).div(grid);
  const worldOf = (uvw) => uvw.sub(vec3(0.5, 0, 0.5)).mul(uSize).add(uOrigin);

  // 0) curl noise, once
  const curlPass = Fn(() => {
    const coord = coordOf(instanceIndex, NOISE_N, NOISE_N);
    const p = uvwOf(coord, vec3(NOISE_N)).mul(3.0);
    const e = float(0.02);
    const dx = vec3(e, 0, 0), dy = vec3(0, e, 0), dz = vec3(0, 0, e);
    const x0 = snoiseVec3(p.sub(dx)), x1 = snoiseVec3(p.add(dx));
    const y0 = snoiseVec3(p.sub(dy)), y1 = snoiseVec3(p.add(dy));
    const z0 = snoiseVec3(p.sub(dz)), z1 = snoiseVec3(p.add(dz));
    const c = vec3(
      y1.z.sub(y0.z).sub(z1.y).add(z0.y),
      z1.x.sub(z0.x).sub(x1.z).add(x0.z),
      x1.y.sub(x0.y).sub(y1.x).add(y0.x),
    ).div(e.mul(2.0)).mul(0.25);
    textureStore(curlT, coord, vec4(c, 0)).toWriteOnly();
  })().compute(NOISE_N ** 3).setName('curl');

  // shape of an emitter at a world position: 1 inside, 0 outside, broken up by noise
  const emitShape = (e, wp, uvw) => {
    const d = wp.sub(e.pos);
    const r = length(d).div(e.rad);
    const n = curl.sample(uvw.mul(2.3).add(vec3(0.13, uTime.mul(0.9), 0.31))).level(0).x;
    const edge = float(1).add(n.mul(e.rough));
    return { f: float(1).sub(smoothstep(0.35, 1.0, r.div(edge.max(0.3)))), d, r };
  };

  // 1) advect velocity, add forces
  const advectVel = Fn(() => {
    const coord = coordOf(instanceIndex, GX, GY);
    const uvw = uvwOf(coord, GRID);
    const wp = worldOf(uvw);

    const vel = texture3D(velA, uvw, 0).xyz;
    const prev = uvw.sub(vel.div(uSize).mul(uDt));
    const v = texture3D(velA, prev, 0).xyz.toVar();

    const s = dye.sample(uvw).level(0);
    const dens = s.r, temp = s.g, age = s.b;

    v.addAssign(vec3(0, temp.mul(P.buoyancy).sub(dens.mul(P.weight)).mul(uDt), 0));

    const tp = uvw.mul(uSize).mul(P.turbFreq.div(NOISE_N * 0.33)).add(vec3(0, age.mul(-0.22), age.mul(0.05)));
    const thermal = curl.sample(tp).level(0).xyz.mul(P.turb).mul(temp).mul(exp(age.mul(P.turbFade).negate()));
    const ap = uvw.mul(uSize).mul(0.035).add(vec3(0, uTime.mul(0.02), uTime.mul(0.007)));
    const ambient = curl.sample(ap).level(0).xyz.mul(P.turb).mul(P.turbAmbient).mul(dens.min(1.5));
    v.addAssign(thermal.add(ambient).mul(uDt));

    v.mulAssign(max(float(1).sub(P.damping.mul(uDt)), 0));

    for (const e of emitters) {
      const { f, d, r } = emitShape(e, wp, uvw);
      const dir = d.div(length(d).max(1e-4));
      v.addAssign(dir.mul(e.push).mul(f).mul(r.min(1.0)).mul(uDt));
      v.addAssign(vec3(0, e.up.mul(f).mul(uDt), 0));
    }

    {
      const d = wp.sub(blast.pos);
      const dist = length(d).max(1e-4);
      const dir = d.div(dist);
      const q = dist.div(blast.r);
      const want = blast.v.mul(q.lessThan(1).select(q, float(1).div(q.mul(q))));
      v.addAssign(dir.mul(max(want.sub(v.dot(dir)), 0)).mul(blast.v.greaterThan(0).select(float(1), float(0))));
    }

    // sides and top are open (gas leaves freely); the floor is solid (free slip)
    v.assign(vec3(v.x, uvw.y.lessThan(2 * TY).select(max(v.y, 0), v.y), v.z));

    textureStore(velB, coord, vec4(v, 0)).toWriteOnly();
  })().compute(CELLS).setName('advectVel');

  // 2) divergence, minus the expansion sources
  const divergence = Fn(() => {
    const coord = coordOf(instanceIndex, GX, GY);
    const uvw = uvwOf(coord, GRID);
    const wp = worldOf(uvw);
    const r = texture3D(velB, uvw.add(vec3(TX, 0, 0)), 0).x, l = texture3D(velB, uvw.sub(vec3(TX, 0, 0)), 0).x;
    const u = texture3D(velB, uvw.add(vec3(0, TY, 0)), 0).y, d = texture3D(velB, uvw.sub(vec3(0, TY, 0)), 0).y;
    const f = texture3D(velB, uvw.add(vec3(0, 0, TZ)), 0).z, b = texture3D(velB, uvw.sub(vec3(0, 0, TZ)), 0).z;
    const div = r.sub(l).add(u.sub(d)).add(f.sub(b)).mul(0.5).toVar();
    for (const e of emitters) div.subAssign(emitShape(e, wp, uvw).f.mul(e.expand));
    const bq = length(wp.sub(blast.pos)).div(blast.r);
    div.subAssign(float(1).sub(smoothstep(0.92, 1.08, bq)).mul(blast.v).div(blast.r).mul(3 * CELL));
    const c = dye.sample(uvw).level(0);
    div.subAssign(c.a.mul(smoothstep(0.15, 0.4, c.g)).mul(P.expand));
    textureStore(divT, coord, vec4(div, 0, 0, 0)).toWriteOnly();
  })().compute(CELLS).setName('divergence');

  // 3) pressure. A coarse solve (quarter grid, many cheap sweeps) finds the big motion: the blast
  //    pushing out, the fireball rising. It seeds the fine grid, which then only has to add detail.
  const CTX = 1 / LX, CTY = 1 / LY, CTZ = 1 / LZ;
  const coarseDiv = Fn(() => {
    const coord = coordOf(instanceIndex, LX, LY);
    const uvw = uvwOf(coord, LGRID);
    const acc = float(0).toVar();
    for (const ox of [-1, 1]) for (const oy of [-1, 1]) for (const oz of [-1, 1]) {
      acc.addAssign(texture3D(divT, uvw.add(vec3(ox * TX, oy * TY, oz * TZ)), 0).x);
    }
    textureStore(cDiv, coord, vec4(acc.mul(0.125 * 16), 0, 0, 0)).toWriteOnly();
  })().compute(LCELLS).setName('coarseDiv');

  const coarseJacobi = (rd, wr, name) => Fn(() => {
    const coord = coordOf(instanceIndex, LX, LY);
    const uvw = uvwOf(coord, LGRID);
    const sum = texture3D(rd, uvw.add(vec3(CTX, 0, 0)), 0).x
      .add(texture3D(rd, uvw.sub(vec3(CTX, 0, 0)), 0).x)
      .add(texture3D(rd, uvw.add(vec3(0, CTY, 0)), 0).x)
      .add(texture3D(rd, uvw.sub(vec3(0, CTY, 0)), 0).x)
      .add(texture3D(rd, uvw.add(vec3(0, 0, CTZ)), 0).x)
      .add(texture3D(rd, uvw.sub(vec3(0, 0, CTZ)), 0).x);
    // open sides and top: pressure falls to zero at the edge of the box
    const edge = min(uvw.xz, vec3(1).sub(uvw).xz);
    const open = smoothstep(0.0, 0.09, min(min(edge.x, edge.y), float(1).sub(uvw.y)));
    const p = sum.sub(texture3D(cDiv, uvw, 0).x).div(6).mul(open);
    textureStore(wr, coord, vec4(p, 0, 0, 0)).toWriteOnly();
  })().compute(LCELLS).setName(name);
  const cJacAB = coarseJacobi(cPrA, cPrB, 'cJacAB'), cJacBA = coarseJacobi(cPrB, cPrA, 'cJacBA');

  const prolong = Fn(() => {
    const coord = coordOf(instanceIndex, GX, GY);
    const uvw = uvwOf(coord, GRID);
    textureStore(prA, coord, vec4(texture3D(cPrA, uvw, 0).x, 0, 0, 0)).toWriteOnly();
  })().compute(CELLS).setName('prolong');

  const jacobi = (rd, wr, name) => Fn(() => {
    const coord = coordOf(instanceIndex, GX, GY);
    const uvw = uvwOf(coord, GRID);
    const sum = texture3D(rd, uvw.add(vec3(TX, 0, 0)), 0).x
      .add(texture3D(rd, uvw.sub(vec3(TX, 0, 0)), 0).x)
      .add(texture3D(rd, uvw.add(vec3(0, TY, 0)), 0).x)
      .add(texture3D(rd, uvw.sub(vec3(0, TY, 0)), 0).x)
      .add(texture3D(rd, uvw.add(vec3(0, 0, TZ)), 0).x)
      .add(texture3D(rd, uvw.sub(vec3(0, 0, TZ)), 0).x);
    const edge = min(uvw.xz, vec3(1).sub(uvw).xz);
    const open = smoothstep(0.0, 0.03, min(min(edge.x, edge.y), float(1).sub(uvw.y)));
    const p = sum.sub(texture3D(divT, uvw, 0).x).div(6).mul(open);
    textureStore(wr, coord, vec4(p, 0, 0, 0)).toWriteOnly();
  })().compute(CELLS).setName(name);
  const jacAB = jacobi(prA, prB, 'jacobiAB'), jacBA = jacobi(prB, prA, 'jacobiBA');

  // 4) project
  const project = Fn(() => {
    const coord = coordOf(instanceIndex, GX, GY);
    const uvw = uvwOf(coord, GRID);
    const g = vec3(
      texture3D(prA, uvw.add(vec3(TX, 0, 0)), 0).x.sub(texture3D(prA, uvw.sub(vec3(TX, 0, 0)), 0).x),
      texture3D(prA, uvw.add(vec3(0, TY, 0)), 0).x.sub(texture3D(prA, uvw.sub(vec3(0, TY, 0)), 0).x),
      texture3D(prA, uvw.add(vec3(0, 0, TZ)), 0).x.sub(texture3D(prA, uvw.sub(vec3(0, 0, TZ)), 0).x),
    ).mul(0.5);
    const v0 = texture3D(velB, uvw, 0).xyz.sub(g);
    const v = vec3(v0.x, uvw.y.lessThan(TY).select(max(v0.y, 0), v0.y), v0.z);
    textureStore(velA, coord, vec4(v, 0)).toWriteOnly();
  })().compute(CELLS).setName('project');

  // 5) advect smoke, heat, age and fuel; burn; cool; make soot; add the emitters.
  //    Also carries each parcel's "rest position", so fine detail drawn later moves with the gas.
  const advectDye = Fn(() => {
    const coord = coordOf(instanceIndex, GX, GY);
    const uvw = uvwOf(coord, GRID);
    const wp = worldOf(uvw);
    const vel = texture3D(velA, uvw, 0).xyz;
    const prev = uvw.sub(vel.div(uSize).mul(uDt));
    const s = dye.sample(prev).level(0);

    const fuel0 = s.a.max(0);
    const burn = fuel0.mul(float(1).sub(exp(P.burn.mul(uDt).negate()))).mul(smoothstep(0.15, 0.4, s.g));
    const fuel = fuel0.sub(burn).toVar();

    const t0 = s.g.max(0).add(burn.mul(P.heat));
    const cool = P.cooling.add(P.coolRad.mul(t0).mul(t0).mul(t0)).mul(uDt);
    const temp = t0.mul(max(float(1).sub(cool), 0)).toVar();
    const dens = s.r.mul(max(float(1).sub(P.dissipation.mul(uDt)), 0))
      .add(t0.sub(temp).mul(P.soot)).add(burn.mul(P.sootBurn)).toVar();

    const near = floor(prev.mul(GRID)).add(0.5).div(GRID);
    const age = dye.sample(near).level(0).b.add(uDt).toVar();
    const lock = clamp(burn.mul(P.restLock).add(P.restRelax.mul(uDt)), 0, 1).toVar();

    for (const e of emitters) {
      const { f } = emitShape(e, wp, uvw);
      const add = e.dens.add(e.fuel).add(e.temp).mul(f).mul(uDt);
      temp.addAssign(e.temp.mul(f).mul(uDt));
      fuel.addAssign(e.fuel.mul(f).mul(uDt));
      dens.addAssign(e.dens.mul(f).mul(uDt));
      age.assign(mix(age, float(0), clamp(add.mul(4.0), 0, 1)));
      lock.assign(max(lock, clamp(add.mul(8.0), 0, 1)));
    }

    // gas the blast is throwing outward re-anchors too, or its pattern would be dragged into streaks
    const bq = length(wp.sub(blast.pos)).div(blast.r);
    lock.assign(max(lock, float(1).sub(smoothstep(1.0, 2.4, bq)).mul(blast.v.greaterThan(0).select(float(1), float(0)))));

    temp.assign(temp.clamp(0, 1.7));
    dens.assign(dens.clamp(0, 6));
    fuel.assign(fuel.clamp(0, 1.5));
    If(dens.add(temp).add(fuel).lessThan(0.004), () => { age.assign(0); });

    textureStore(dyeW, coord, vec4(dens, temp, age, fuel)).toWriteOnly();

    const r0 = rest.sample(prev).level(0).xyz;
    textureStore(restW, coord, vec4(mix(r0, wp.sub(uOrigin), lock), 1)).toWriteOnly();
  })().compute(CELLS).setName('advectDye');

  // light grid: how much firelight reaches each coarse cell, blocked by smoke
  const uLitGain = uniform(1.0);
  const uLitSpread = uniform(0.965);
  const uLitBlock = uniform(0.55);
  const litSource = Fn(() => {
    const coord = coordOf(instanceIndex, LX, LY);
    const uvw = uvwOf(coord, LGRID);
    const acc = vec4(0).toVar();
    for (const ox of [-1, 1]) for (const oy of [-1, 1]) for (const oz of [-1, 1]) {
      const s = dye.sample(uvw.add(vec3(ox * TX, oy * TY, oz * TZ))).level(0);
      acc.addAssign(vec4(fireRamp(s.g).mul(smoothstep(0.3, 0.6, s.g)), s.r.add(s.g.mul(0.3))));
    }
    textureStore(litSrc, coord, acc.mul(0.125)).toWriteOnly();
  })().compute(LCELLS).setName('litSource');

  const LTX = 1 / LX, LTY = 1 / LY, LTZ = 1 / LZ;
  const litSpread = Fn(() => {
    const coord = coordOf(instanceIndex, LX, LY);
    const uvw = uvwOf(coord, LGRID);
    const src = texture3D(litSrc, uvw, 0);
    const sum = lit.sample(uvw.add(vec3(LTX, 0, 0))).level(0).rgb
      .add(lit.sample(uvw.sub(vec3(LTX, 0, 0))).level(0).rgb)
      .add(lit.sample(uvw.add(vec3(0, LTY, 0))).level(0).rgb)
      .add(lit.sample(uvw.sub(vec3(0, LTY, 0))).level(0).rgb)
      .add(lit.sample(uvw.add(vec3(0, 0, LTZ))).level(0).rgb)
      .add(lit.sample(uvw.sub(vec3(0, 0, LTZ))).level(0).rgb);
    const through = exp(src.a.mul(uLitBlock).negate());
    const l = src.rgb.mul(uLitGain).add(sum.div(6).mul(uLitSpread).mul(through));
    textureStore(litW, coord, vec4(l, src.a)).toWriteOnly();
  })().compute(LCELLS).setName('litSpread');

  const clearOf = (tex, n, gx, gy) => Fn(() => {
    textureStore(tex, coordOf(instanceIndex, gx, gy), vec4(0)).toWriteOnly();
  })().compute(n);
  const clears = [velA, velB, dyeA, dyeB, divT, prA, prB, restA, restB].map((t) => clearOf(t, CELLS, GX, GY))
    .concat([litSrc, litA, litB, cDiv, cPrA, cPrB].map((t) => clearOf(t, LCELLS, LX, LY)));

  let time = 0;
  const sim = {
    P, emitters, blast, uOrigin, uSize, uTime, uLitGain, uLitSpread, uLitBlock,
    dye, lit, rest, velTex: velA, curl, coarse: texture3D(litSrc),
    coarseIters: 32,
    pressureIters: 4,
    lightIters: 6,
    get time() { return time; },

    async init() {
      await renderer.computeAsync(curlPass);
      this.reset();
    },

    reset() {
      time = 0;
      uTime.value = 0;
      dye.value = dyeA; dyeW.value = dyeB;
      lit.value = litA; litW.value = litB;
      rest.value = restA; restW.value = restB;
      for (const c of clears) renderer.compute(c);
    },

    step(dt) {
      uDt.value = dt;
      time += dt;
      uTime.value = time;
      renderer.compute(advectVel);
      renderer.compute(divergence);
      renderer.compute(coarseDiv);
      for (let i = 0; i < this.coarseIters; i++) renderer.compute(i % 2 === 0 ? cJacAB : cJacBA);
      renderer.compute(prolong);
      for (let i = 0; i < this.pressureIters; i++) renderer.compute(i % 2 === 0 ? jacAB : jacBA);
      renderer.compute(project);
      renderer.compute(advectDye);
      const t = dye.value; dye.value = dyeW.value; dyeW.value = t;
      const r = rest.value; rest.value = restW.value; restW.value = r;
    },

    // once per drawn frame
    light() {
      renderer.compute(litSource);
      for (let i = 0; i < this.lightIters; i++) {
        renderer.compute(litSpread);
        const t = lit.value; lit.value = litW.value; litW.value = t;
      }
    },
  };
  return sim;
}
