// Draws the simulated fire and smoke: one ray march through the sim box per pixel.
// Fire glows by temperature. Smoke is lit by the fire near it (light grid) and by the moon, and it
// blocks what is behind it. Output is premultiplied (rgb, coverage) for compositing over the scene.
import * as THREE from 'three/webgpu';
import {
  Fn, vec3, vec4, float, uniform, texture3D, cameraPosition, positionWorld, normalize, min, max, exp,
  Loop, Break, If, smoothstep, clamp, mix, interleavedGradientNoise, screenCoordinate, dot, fwidth, fract,
} from 'three/tsl';
import { fireRamp, SIZE } from './sim.js';

export const STEPS = 150;
const FINE = 0.055, BIG = 0.26;     // metres per stride inside the gas / through empty air
const RULE = 0.085 * 4;              // the breakdown's cut is ruled every fourth cell of the simulation

export function createVolume(sim, noiseTex, { viewZ = null } = {}) {
  const U = {
    sigma: uniform(7.0),                                   // smoke extinction per metre at smoke = 1
    fire: uniform(1.0), 
    fireSigma: uniform(16.0),                              // flame opacity per metre                                   // flame brightness
    albedo: uniform(new THREE.Color(0.16, 0.15, 0.14)),
    moonDir: uniform(new THREE.Vector3(-0.5, 0.62, 0.38).normalize()),
    moonCol: uniform(new THREE.Color(0.1, 0.15, 0.27)),
    ambient: uniform(new THREE.Color(0.02, 0.03, 0.055)),
    litGain: uniform(1.0),
    warp: uniform(0.55),                                   // metres, how far the big lobes bulge
    cut: uniform(0.22),                                    // smoke level where the visible surface sits
    soft: uniform(0.05),                                   // how soft that surface is
    puff: uniform(1.25),                                   // how far the puffs push the surface in and out
    crust: uniform(1.0),                                   // dark crust on cooling gas, 0 = none
    crustAt: uniform(0.58),                                // heat at which half the surface has crusted
    crustSoot: uniform(0.9),
    crease: uniform(0.55),                                 // how much cooler the creases are than the puff centres
    detailFreq: uniform(0.36),
    thin: uniform(3.2), thinLo: uniform(0.15), thinHi: uniform(0.8), thinGlow: uniform(0.03),   // stride multiplier in thin dark smoke, and where thin ends
    debug: uniform(0),                                     // the simulation's raw fields: 1 smoke, 2 heat, 3 speed, 4 fuel
    rawGain: uniform(1),                                   // how strongly a raw field shows
    camDir: uniform(new THREE.Vector3(0, 0, -1)),          // which way the camera looks, for depth
    mirror: uniform(0),                                    // 1 = march the view mirrored in the floor
  };
  const noise = texture3D(noiseTex);
  const half = vec3(SIZE.x / 2, 0, SIZE.z / 2);

  const uvwOf = (p) => p.sub(sim.uOrigin).div(sim.uSize).add(vec3(0.5, 0, 0.5));

  // Smoke and heat at a point. The sim grid is soft (7 cm cells), so the crisp, lobed surface is made
  // here: a puff pattern is added to the soft field and the result is cut at a threshold. The pattern is
  // looked up at each parcel's rest position, so the lobes travel, stretch and fold with the gas.
  const sampleAt = (p0, widen = float(1)) => {
    const uvw0 = uvwOf(p0);
    const rp = sim.rest.sample(uvw0).level(0).xyz.mul(U.detailFreq);
    const n = noise.sample(rp).level(0);
    const n2 = noise.sample(rp.mul(3.1).add(vec3(0.37, 0.11, 0.73))).level(0);
    // big lobes: read the soft sim field through a lumpy lens, so its surface bulges and folds
    const p = p0.add(n.rgb.sub(vec3(0.33, 0.5, 0.36)).mul(U.warp));
    const uvw = uvwOf(p);
    const s = sim.dye.sample(uvw).level(0);
    const age = s.b;
    const billow = n.r.mul(0.7).add(n2.r.mul(0.3));                    // 0..1, high in the middle of a puff
    const old = smoothstep(1.6, 4.5, age);                             // young gas is crisp, old smoke soft and thin
    const cut = mix(U.cut, float(0.06), old);
    const soft = mix(U.soft, float(0.1), old).mul(widen);              // a longer stride reads a softer edge, or it grains
    const matter = s.r.mul(2.0).add(s.g.mul(0.35)).min(1.3);           // soot, or gas hot enough to glow
    const shaped = matter.add(billow.sub(0.5).mul(U.puff));
    const body = smoothstep(cut.sub(soft), cut.add(soft), shaped);
    const dens0 = max(s.r, cut).mul(body).mul(n2.g.mul(0.5).add(0.75));
    // heat: hot puff centres, cooler creases; licks that climb at the thin edges
    const fp = p.mul(U.detailFreq.mul(2.1)).add(vec3(0, sim.uTime.mul(-1.3), sim.uTime.mul(0.27)));
    const lick = smoothstep(0.3, 0.7, noise.sample(fp).level(0).g);
    const hot = smoothstep(0.1, 0.72, billow.mul(0.85).add(lick.mul(0.15)));
    // as the gas cools, a dark sooty crust spreads over it in patches, with glowing cracks left between
    const crust = smoothstep(-0.12, 0.12, n.g.sub(0.5).add(U.crustAt.sub(s.g).mul(0.9))).mul(U.crust);
    const crack = max(n.a, n2.a.mul(0.7));
    const cr = U.crease.mul(smoothstep(0.03, 0.28, age));          // brand-new gas is evenly white-hot
    const temp = max(s.g.mul(float(1).sub(cr).add(hot.mul(cr).mul(2.0))), 0)
      .mul(mix(float(1), crack.mul(0.85).add(0.15), crust)).mul(body.max(0.35));
    const edge = min(uvw, vec3(1).sub(uvw));
    const fade = smoothstep(0.0, 0.05, min(edge.x, min(float(1).sub(uvw.y), edge.z)));
    const dens = dens0.add(crust.mul(body).mul(U.crustSoot));
    return { uvw, dens: dens.mul(fade), temp: temp.mul(fade) };
  };

  const mat = new THREE.NodeMaterial();
  mat.side = THREE.BackSide;
  mat.transparent = true;
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.blending = THREE.NoBlending;

  mat.fragmentNode = Fn(() => {
    const flip = vec3(1, float(1).sub(U.mirror.mul(2)), 1);
    const ro = cameraPosition.mul(flip);
    const rd = normalize(positionWorld.sub(cameraPosition)).mul(flip).toVar();
    rd.assign(rd.add(vec3(1e-5, 1e-5, 1e-5)));
    const bmin = sim.uOrigin.sub(half);
    const bmax = sim.uOrigin.add(vec3(SIZE.x / 2, SIZE.y, SIZE.z / 2));
    const inv = vec3(1).div(rd);
    const ta = bmin.sub(ro).mul(inv), tb = bmax.sub(ro).mul(inv);
    const tsm = min(ta, tb), tbg = max(ta, tb);
    const tN = max(max(tsm.x, tsm.y), max(tsm.z, 0.0));
    // stop at whatever solid thing the scene has along this ray, so fire can pass behind a character
    const rd0 = normalize(positionWorld.sub(cameraPosition));
    const tScene = viewZ ? viewZ.negate().div(dot(rd0, U.camDir).max(0.05)) : float(1e6);
    const tF = min(min(tbg.x, min(tbg.y, tbg.z)), tScene);
    const span = max(tF.sub(tN), 0.0);
    const ds = span.div(STEPS);
    const jitter = interleavedGradientNoise(screenCoordinate.xy);

    const col = vec3(0).toVar();
    const trans = float(1).toVar();
    const t = tN.add(jitter.mul(BIG)).toVar();
    const cosMoon = dot(rd, U.moonDir);
    const phase = float(0.75).add(cosMoon.mul(cosMoon).mul(0.25)).add(smoothstep(0.6, 1.0, cosMoon).mul(0.9));

    // Long strides through empty air (the coarse grid says where anything is), short ones inside the gas.
    If(U.debug.lessThan(0.5), () => {
    Loop(STEPS, () => {
      const p = ro.add(rd.mul(t));
      const cell = sim.coarse.sample(uvwOf(p)).level(0);     // rgb: firelight made in this cell, a: how much gas
      const occ = cell.a;
      const fine = occ.greaterThan(0.004);
      // dark, thin smoke is soft and takes a longer stride; anything that glows, or is dense, keeps the short one
      const thick = max(smoothstep(U.thinLo, U.thinHi, occ), smoothstep(0.0, U.thinGlow, cell.r));
      const widen = mix(U.thin, float(1), thick);
      const st = fine.select(float(FINE).mul(widen), float(BIG));

      If(fine, () => {
        const { uvw, dens, temp } = sampleAt(p, widen);
        If(dens.add(temp).greaterThan(0.002), () => {
          // moon through the smoke above: two taps toward the moon
          const s1 = sim.dye.sample(uvwOf(p.add(U.moonDir.mul(0.18)))).level(0).r;
          const s2 = sim.dye.sample(uvwOf(p.add(U.moonDir.mul(0.55)))).level(0).r;
          const moonT = exp(s1.mul(0.28).add(s2.mul(0.5)).mul(U.sigma).negate());
          const fireLit = sim.lit.sample(uvw).level(0).rgb.mul(U.litGain);
          const light = fireLit.add(U.moonCol.mul(moonT).mul(phase)).add(U.ambient);

          // flame is its own fog: an opaque flame shows exactly fireRamp(heat); thin flame shows less
          // hot soot is the flame itself (it glows); only cold soot is smoke
          const hotness = smoothstep(0.38, 0.72, temp);
          const sigS = dens.mul(U.sigma).mul(float(1).sub(hotness.mul(0.92)));
          const sigF = hotness.mul(U.fireSigma);
          const sig = sigS.add(sigF);
          const src = fireRamp(temp).mul(U.fire).mul(sigF).add(U.albedo.mul(light).mul(sigS));
          const od = sig.mul(st);
          const stepT = exp(od.negate());
          const w = od.greaterThan(1e-3).select(float(1).sub(stepT).div(od.max(1e-3)), float(1));
          col.addAssign(src.mul(trans).mul(st).mul(w));
          trans.mulAssign(stepT);
        });
      });

      t.addAssign(st);
      If(trans.lessThan(0.012).or(t.greaterThan(tF)), () => { Break(); });
    });
    });

    // The simulation cut open, for the breakdown: a pane standing upright through the middle of the box,
    // facing us, painted with one of the fields the solver works on (1 smoke, 2 heat, 3 speed, 4 fuel) and
    // ruled every fourth cell.
    const raw = vec4(0).toVar();
    If(U.debug.greaterThan(0.5), () => {
      const n = normalize(vec3(U.camDir.x, 0, U.camDir.z));
      const tp = dot(sim.uOrigin.sub(ro), n).div(dot(rd, n));
      const p = ro.add(rd.mul(tp));
      const uvw = uvwOf(p);
      const edge = min(uvw, vec3(1).sub(uvw));
      const m = min(edge.x, min(edge.y, edge.z));
      const inside = smoothstep(0.0, 0.004, m).mul(tp.greaterThan(0).select(float(1), float(0))).mul(tp.lessThan(tScene).select(float(1), float(0)));
      const s = sim.dye.sample(uvw).level(0);
      const sp = texture3D(sim.velTex, uvw, 0).xyz.length();
      const v = U.debug.lessThan(1.5).select(s.r, U.debug.lessThan(2.5).select(s.g, U.debug.lessThan(3.5).select(sp, s.a)));
      const k = clamp(v.mul(U.rawGain), 0, 1);
      const hot = mix(mix(vec3(0.32, 0.0, 0.04), vec3(1.0, 0.27, 0.02), smoothstep(0.0, 0.5, k)), vec3(1.0, 0.95, 0.7), smoothstep(0.5, 1.0, k));
      const tint = U.debug.lessThan(1.5).select(vec3(0.82, 0.86, 0.94), U.debug.lessThan(2.5).select(hot, U.debug.lessThan(3.5).select(mix(vec3(0.08, 0.3, 1.0), vec3(0.6, 1.0, 0.95), k), vec3(0.5, 1.0, 0.3))));
      // the ruling: along the pane and up it, one line every fourth cell, a pixel or so wide at any distance
      const along = dot(p.sub(sim.uOrigin), vec3(n.z.negate(), 0, n.x)).div(RULE), up = p.y.div(RULE);
      const ruled = (g) => float(1).sub(smoothstep(fwidth(g).mul(0.6), fwidth(g).mul(1.6), fract(g.add(0.5)).sub(0.5).abs()));
      const line = max(ruled(along), ruled(up)).mul(0.13).add(float(1).sub(smoothstep(0.004, 0.012, m)).mul(0.4));   // and the box's own edge
      const shade = smoothstep(0.02, 0.25, k);
      raw.assign(vec4(tint.mul(k).add(vec3(0.55, 0.68, 0.9).mul(line).mul(float(1).sub(shade.mul(0.7)))), float(0.14).add(shade.mul(0.8)).add(line.mul(0.3)).min(0.96)).mul(inside));
    });
    return U.debug.greaterThan(0.5).select(raw, vec4(col, float(1).sub(trans)));
  })();

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(SIZE.x, SIZE.y, SIZE.z), mat);
  mesh.frustumCulled = false;
  const place = () => mesh.position.set(sim.uOrigin.value.x, sim.uOrigin.value.y + SIZE.y / 2, sim.uOrigin.value.z);
  place();
  return { mesh, mat, U, place };
}
