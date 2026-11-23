// The lamp court: three ring steps up to a terrace, an arcade round it with a lantern in every bay,
// four lantern posts in the court and a great brazier on the far axis. All of it is dark until the
// golem wakes; then the lamps come on in a wave that starts beside it and ends at the brazier.
// The kit is modelled in Blender (blender/make_court_kit.py) and instanced here.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  Fn, Loop, vec2, vec3, vec4, float, int, uniform, uniformArray, attribute, positionWorld, normalWorld, texture, dot, max,
  smoothstep, mix, sin, uv, pow, abs, clamp, length,
} from 'three/tsl';
import { fireRamp } from './sim.js';

import { COURT, TERRACE, lampLayout } from './stage.js';

export { COURT };
const WARM = new THREE.Color(1.0, 0.5, 0.16);

// ---- the lamps as data: where each one hangs, when it lights, how strong it is
export function createLamps({ centre, golem, time }) {
  // where each lamp hangs and when it catches comes from stage.js, which the sound reads too
  const plan = lampLayout([centre.x, 0, centre.z], [golem.x, 0, golem.z]);
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const list = plan.list.map((l) => ({ ...l, pos: V(l.pos) }));
  const bays = plan.bays.map((b) => ({ p: V(b.p), deg: b.deg }));
  const posts = plan.posts.map((b) => ({ p: V(b.p), deg: b.deg }));
  const brazier = V(plan.brazier);

  const U = { lit: uniform(-1), gain: uniform(1) };          // seconds since the first lamp caught
  const litOf = (delay) => smoothstep(0.0, 0.35, U.lit.sub(delay));
  const flickerOf = (seed) => float(0.9).add(sin(time.mul(11.0).add(seed.mul(37.0))).mul(sin(time.mul(4.3).add(seed.mul(11.0)))).mul(0.1));

  // only lamps near the stage light the stone the camera sees; the rest just glow
  const near = list.filter((l) => Math.hypot(l.pos.x - 0.3, l.pos.z + 1.5) < 17.5);
  const aPos = uniformArray(near.map((l) => new THREE.Vector4(l.pos.x, l.pos.y, l.pos.z, l.delay)));
  const aPow = uniformArray(near.map((l) => l.power));
  const N = near.length;
  // warm light arriving at a point with a normal, from every lamp that is lit (radiance for a white surface)
  const light = Fn(([p, n]) => {
    const sum = float(0).toVar();
    Loop({ start: int(0), end: int(N), type: 'int', condition: '<' }, ({ i }) => {
      const l = aPos.element(i);
      const d = l.xyz.sub(p);
      const d2 = dot(d, d).add(0.35);
      const ndl = max(dot(n, d).div(d2.sqrt()), 0.0).mul(0.85).add(0.15);
      // a lantern has an iron floor and roof: nothing straight below or above it is lit (its own post, the crown of its arch)
      const plate = smoothstep(0.12, 0.6, length(d.xz).div(abs(d.y).add(0.25)));
      sum.addAssign(litOf(l.w).mul(aPow.element(i)).mul(ndl).mul(plate).div(d2));
    });
    return vec3(WARM.r, WARM.g, WARM.b).mul(sum).mul(U.gain).mul(6.0);
  });
  return { list, bays, posts, brazier, brazierDelay: list[list.length - 1].delay, U, litOf, flickerOf, light, count: N };
}

export async function createCourt({ centre, lamps, floorMat, noiseTex, time }) {
  const group = new THREE.Group();
  const tri = (p, n, s) => {
    // noise looked up on three planes and blended by the way the surface faces
    const w = abs(n).div(abs(n).x.add(abs(n).y).add(abs(n).z));
    return texture(noiseTex, p.zy.mul(s)).rgb.mul(w.x).add(texture(noiseTex, p.xz.mul(s)).rgb.mul(w.y)).add(texture(noiseTex, p.xy.mul(s)).rgb.mul(w.z));
  };
  // pale limestone: blotched, streaked by rain on its upright faces, grimy where it meets the ground
  const stone = (baseY = 0, tint = 1) => {
    const m = new THREE.MeshStandardNodeMaterial();
    const n1 = tri(positionWorld, normalWorld, 0.33), n2 = tri(positionWorld, normalWorld, 1.7);
    const streak = texture(noiseTex, vec2(positionWorld.x.add(positionWorld.z).mul(0.9), positionWorld.y.mul(0.07))).g;
    const upright = float(1).sub(abs(normalWorld.y));
    const grime = float(1).sub(smoothstep(0.0, 0.5, positionWorld.y.sub(baseY))).mul(0.45);
    const col = mix(vec3(0.2, 0.19, 0.175), vec3(0.43, 0.405, 0.36), n1.r.mul(0.6).add(n2.b.mul(0.4)))
      .mul(float(1).sub(smoothstep(0.45, 0.75, streak).mul(upright).mul(0.3)))
      .mul(float(1).sub(grime)).mul(tint);
    m.colorNode = col;
    m.roughnessNode = float(0.72).add(n2.g.mul(0.2));
    m.metalnessNode = float(0);
    m.emissiveNode = col.mul(lamps.light(positionWorld, normalWorld)).mul(1 / Math.PI);
    return m;
  };

  // ---- ring steps and the terrace: treads carry on the court's paving, risers are plain stone
  const riser = stone(0, 0.62);
  COURT.steps.forEach((r, i) => {
    const y = COURT.rise * (i + 1);
    const outer = i < 2 ? COURT.steps[i + 1] : 46;
    const tread = new THREE.Mesh(new THREE.RingGeometry(r, outer, 160, 1), floorMat);
    tread.rotation.x = -Math.PI / 2; tread.position.set(centre.x, y, centre.z); tread.receiveShadow = true;
    const face = new THREE.Mesh(new THREE.CylinderGeometry(r, r, COURT.rise, 160, 1, true), riser);
    face.position.set(centre.x, y - COURT.rise / 2, centre.z); face.receiveShadow = true;
    face.material.side = THREE.BackSide;                       // we stand inside the ring and look at the riser
    group.add(tread, face);
  });

  // ---- the kit
  const gltf = await new GLTFLoader().loadAsync('./models/court.glb');
  const part = {};
  gltf.scene.traverse((o) => { if (o.isMesh) part[o.name] = o.geometry; });

  const iron = new THREE.MeshStandardNodeMaterial({ color: 0x0c0c0e, roughness: 0.48, metalness: 0.7 });
  const glass = (power) => {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0 });
    const lit = lamps.litOf(attribute('aDelay', 'float')).mul(lamps.flickerOf(attribute('aDelay', 'float')));
    m.colorNode = vec3(0.05, 0.035, 0.02);
    m.emissiveNode = vec3(1.0, 0.56, 0.17).mul(lit).mul(power);
    return m;
  };

  const place = (name, mat, mats, { delays = null, cast = true } = {}) => {
    const mesh = new THREE.InstancedMesh(part[name].clone(), mat, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (delays) mesh.geometry.setAttribute('aDelay', new THREE.InstancedBufferAttribute(new Float32Array(delays), 1));
    mesh.castShadow = cast; mesh.receiveShadow = true; mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };
  const up = new THREE.Vector3(0, 1, 0);
  const facing = (p, y) => {                                    // kit +z looks at the court's centre
    const o = new THREE.Vector3(p.x - centre.x, 0, p.z - centre.z).normalize();
    return new THREE.Matrix4().makeBasis(new THREE.Vector3(-o.z, 0, o.x), up, o.clone().negate()).setPosition(p.x, y, p.z);
  };
  const byKind = (k) => lamps.list.filter((l) => l.kind === k);

  const bayM = lamps.bays.map((b) => facing(b.p, TERRACE));
  place('Bay_Stone', stone(TERRACE), bayM, { cast: false });
  place('Lantern_Iron', iron, bayM, { cast: false });
  place('Lantern_Glass', glass(5), bayM, { delays: byKind('bay').map((l) => l.delay), cast: false });

  const postM = lamps.posts.map((q) => facing(q.p, 0));
  place('Post_Stone', stone(0), postM);
  place('Post_Iron', iron, postM);
  place('Post_Glass', glass(5.5), postM, { delays: byKind('post').map((l) => l.delay) });

  // ---- the brazier, with a flame that catches last
  const bz = [new THREE.Matrix4().setPosition(lamps.brazier)];
  const bDelay = byKind('brazier')[0].delay;
  const bLit = lamps.litOf(float(bDelay));
  place('Brazier_Stone', stone(TERRACE), bz);
  const bronze = new THREE.MeshStandardNodeMaterial({ color: 0x5a3414, roughness: 0.42, metalness: 0.9 });
  bronze.emissiveNode = vec3(1.0, 0.35, 0.06).mul(bLit).mul(smoothstep(1.9, 2.35, positionWorld.y.sub(TERRACE).add(0.6))).mul(0.5);
  place('Brazier_Bronze', bronze, bz);
  const coal = new THREE.MeshStandardNodeMaterial({ color: 0x050403, roughness: 0.9 });
  {
    // a bed of embers: bright seams between dark lumps, not an even glowing plate
    const lump = tri(positionWorld, normalWorld, 0.7).b.mul(0.65).add(tri(positionWorld, normalWorld, 2.3).r.mul(0.35));
    const hot = smoothstep(0.38, 0.68, lump);
    coal.emissiveNode = mix(vec3(0.45, 0.04, 0.0), vec3(1.0, 0.42, 0.07), hot).mul(hot.mul(hot).mul(3.2).add(0.5)).mul(bLit);
  }
  place('Brazier_Coal', coal, bz, { cast: false });

  const flameMat = new THREE.NodeMaterial();
  flameMat.transparent = true; flameMat.depthWrite = false; flameMat.side = THREE.DoubleSide; flameMat.blending = THREE.AdditiveBlending;
  {
    const c = uv(), seed = attribute('aSeed', 'float');
    const y = c.y, x = c.x.sub(0.5).mul(2);
    const sway = texture(noiseTex, vec2(c.x.mul(0.8).add(seed), y.mul(0.55).sub(time.mul(0.9)))).g;
    const lick = texture(noiseTex, vec2(c.x.mul(2.2).sub(seed), y.mul(1.5).sub(time.mul(2.1)).add(seed))).g;
    const fine = texture(noiseTex, vec2(c.x.mul(5.0).add(seed.mul(3.0)), y.mul(3.4).sub(time.mul(3.6)))).b;
    const xs = x.add(sway.sub(0.5).mul(y).mul(1.1));                                           // the flame leans more toward its tip
    const width = pow(float(1).sub(y), 0.6).mul(0.8).add(0.02);
    // How high the flame reaches differs across it and from moment to moment, and it always dies away below
    // the top of its card: a flame that runs into the card's edge ends in a flat cut.
    const reach = texture(noiseTex, vec2(c.x.mul(1.3).add(seed.mul(2.0)), time.mul(0.55).add(seed))).r.mul(0.36).add(0.52);
    const over = clamp(y.sub(reach).div(0.14), 0, 4);
    // 1 on the axis, 0 at the edge; the noise eats further in toward the top, which tears the tip into tongues
    const body = float(1).sub(abs(xs).div(width)).add(lick.sub(0.55).mul(y.mul(2.2).add(0.25))).add(fine.sub(0.5).mul(0.35)).sub(over);
    const inCard = float(1).sub(smoothstep(0.86, 0.98, y)).mul(float(1).sub(smoothstep(0.84, 0.98, abs(x))));   // never a hard edge at the card's own sides or top
    const a = smoothstep(0.0, 0.3, body).mul(smoothstep(0.0, 0.05, y)).mul(inCard).mul(bLit);
    const heat = clamp(body, 0, 1).mul(float(1).sub(y.mul(0.5))).mul(0.5).add(0.56);           // hottest low on the axis, orange out to the edge
    flameMat.fragmentNode = vec4(fireRamp(heat).mul(0.42), a);
  }
  const fg = new THREE.PlaneGeometry(2.0, 2.2, 1, 1).translate(0, 1.1, 0);
  const flame = new THREE.InstancedMesh(fg, flameMat, 3);
  flame.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array([0.13, 0.47, 0.81]), 1));
  for (let i = 0; i < 3; i++) flame.setMatrixAt(i, new THREE.Matrix4().makeRotationY(i * Math.PI / 3).setPosition(lamps.brazier.x, TERRACE + 1.72, lamps.brazier.z));
  flame.frustumCulled = false; flame.renderOrder = 4;
  group.add(flame);

  return { group };
}
