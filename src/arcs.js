// Energy crackling between the mage's feet and the seal while it holds her in the air: jagged arcs
// that live for a few frames each and are thrown again somewhere else, with forks, and a hot spot
// where each one meets the stone. An arc is a strip that always faces the camera, with a white-hot
// core and a soft blue-violet halo drawn across its width (a line of even width would read as wire).
// Everything is worked out from the clock, so any moment can be drawn on its own.
import * as THREE from 'three/webgpu';
import { vec3, vec4, float, attribute, exp, uv, smoothstep, length } from 'three/tsl';

const MAIN = 7, PTS = 22, FORKS = 9, FPTS = 8;
const hash = (a, b = 0, c = 0) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const rng = (seed) => { let s = (seed * 4294967296) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

export function createArcs() {
  // ---- strips
  const strips = MAIN * PTS + FORKS * FPTS, verts = strips * 2;
  const pos = new Float32Array(verts * 3), side = new Float32Array(verts), pow = new Float32Array(verts);
  const index = [];
  const quad = (first, n) => { for (let i = 0; i < n - 1; i++) { const a = (first + i) * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } };
  for (let i = 0; i < MAIN; i++) quad(i * PTS, PTS);
  for (let i = 0; i < FORKS; i++) quad(MAIN * PTS + i * FPTS, FPTS);
  for (let i = 0; i < verts; i++) side[i] = i % 2 ? 1 : -1;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setAttribute('aPow', new THREE.BufferAttribute(pow, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(index);
  const mat = new THREE.NodeMaterial();
  mat.transparent = true; mat.depthWrite = false; mat.side = THREE.DoubleSide; mat.blending = THREE.AdditiveBlending;
  {
    const across = attribute('aSide', 'float'), p = attribute('aPow', 'float');
    const core = exp(across.mul(across).div(0.02).negate()), halo = exp(across.mul(across).div(0.2).negate());
    mat.fragmentNode = vec4(vec3(0.82, 0.9, 1.0).mul(core).mul(15.0).add(vec3(0.22, 0.36, 1.0).mul(halo).mul(2.6)).mul(p), 1);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 6;

  // ---- hot spots on the stone where the arcs land
  const spots = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), null, MAIN);
  const spotPow = new Float32Array(MAIN);
  spots.geometry.setAttribute('aSpot', new THREE.InstancedBufferAttribute(spotPow, 1).setUsage(THREE.DynamicDrawUsage));
  const sm = new THREE.NodeMaterial();
  sm.transparent = true; sm.depthWrite = false; sm.blending = THREE.AdditiveBlending;
  {
    const r = length(uv().sub(0.5)).mul(2);
    const glow = exp(r.mul(r).div(0.05).negate()).mul(7.0).add(exp(r.mul(r).div(0.35).negate()).mul(0.8)).mul(float(1).sub(smoothstep(0.8, 1.0, r)));
    sm.fragmentNode = vec4(vec3(0.5, 0.68, 1.0).mul(glow).mul(attribute('aSpot', 'float')), 1);
  }
  spots.material = sm; spots.frustumCulled = false; spots.renderOrder = 5;

  const group = new THREE.Group();
  group.add(mesh, spots);

  // ---- throwing an arc: a jagged path from a to b
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), ax = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3();
  const P = new THREE.Vector3(), Q = new THREE.Vector3(), tan = new THREE.Vector3(), sd = new THREE.Vector3(), toCam = new THREE.Vector3();
  const path = new Float32Array(PTS * 3), off = new Float32Array(PTS * 2), m4 = new THREE.Matrix4();
  // midpoint displacement: big kinks first, then smaller ones between them
  const kink = (n, r, amp) => {
    off.fill(0, 0, n * 2);
    const go = (i0, i1, a) => {
      if (i1 - i0 < 2) return;
      const m = (i0 + i1) >> 1, f = (m - i0) / (i1 - i0);
      for (let k = 0; k < 2; k++) off[m * 2 + k] = off[i0 * 2 + k] * (1 - f) + off[i1 * 2 + k] * f + (r() * 2 - 1) * a;
      go(i0, m, a * 0.58); go(m, i1, a * 0.58);
    };
    go(0, n - 1, amp);
  };
  const build = (n, from, to, r, amp, wobble, w0) => {
    ax.subVectors(to, from);
    const len = ax.length();
    ax.multiplyScalar(1 / len);
    u.set(ax.z, 0, -ax.x); if (u.lengthSq() < 1e-4) u.set(1, 0, 0); u.normalize();
    v.crossVectors(ax, u);
    kink(n, r, amp * len);
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1), ends = Math.sin(Math.PI * s);                  // pinned at both ends
      const ox = off[i * 2] + (w0() * 2 - 1) * wobble * ends, oy = off[i * 2 + 1] + (w0() * 2 - 1) * wobble * ends;
      path[i * 3] = from.x + ax.x * len * s + u.x * ox + v.x * oy;
      path[i * 3 + 1] = Math.max(0.02, from.y + ax.y * len * s + u.y * ox + v.y * oy);
      path[i * 3 + 2] = from.z + ax.z * len * s + u.z * ox + v.z * oy;
    }
  };
  const write = (first, n, cam, width, power) => {
    for (let i = 0; i < n; i++) {
      P.fromArray(path, i * 3);
      Q.fromArray(path, Math.min(n - 1, i + 1) * 3); tan.fromArray(path, Math.max(0, i - 1) * 3); tan.subVectors(Q, tan);
      toCam.subVectors(cam, P);
      sd.crossVectors(tan, toCam).normalize();
      const s = i / (n - 1), e = 2 * s - 1, w = width * (0.75 + 0.9 * e * e * e * e);   // a little fatter where it meets foot and stone
      const k = (first + i) * 2;
      pos[k * 3] = P.x - sd.x * w; pos[k * 3 + 1] = P.y - sd.y * w; pos[k * 3 + 2] = P.z - sd.z * w;
      pos[k * 3 + 3] = P.x + sd.x * w; pos[k * 3 + 4] = P.y + sd.y * w; pos[k * 3 + 5] = P.z + sd.z * w;
      pow[k] = pow[k + 1] = power;
    }
  };

  // amount 0..1: how strongly it crackles. feet: [left, right] world positions. centre: the seal. Returns
  // the summed strength and where its light should sit, for the lamp that goes with it.
  const light = { power: 0, pos: new THREE.Vector3() };
  function update(t, amount, feet, centre, cam) {
    light.power = 0; light.pos.set(0, 0, 0);
    let fork = 0, wsum = 0;
    const frame = Math.floor(t * 60);
    for (let i = 0; i < MAIN; i++) {
      const life = 0.07 + 0.09 * hash(i, 11), phase = hash(i, 5) * life;
      const epoch = Math.floor((t + phase) / life), age = ((t + phase) / life) % 1;
      const r = rng(hash(i, epoch, 3)), wob = rng(hash(i, frame, 7));
      const gate = r() < 0.35 + 0.65 * amount ? 1 : 0;                     // fewer of them strike when it is weak
      const I = amount * gate * (age < 0.15 ? age / 0.15 : Math.pow(1 - age, 1.1)) * (0.65 + 0.35 * wob());
      const foot = feet[(i + epoch) % 2];
      A.set(foot.x + (r() - 0.5) * 0.1, Math.max(0.05, foot.y - 0.04), foot.z + (r() - 0.5) * 0.1);
      const ang = r() * Math.PI * 2, rad = 0.3 + 1.4 * Math.sqrt(r());
      Bv.set(centre.x + Math.cos(ang) * rad, 0.02, centre.z + Math.sin(ang) * rad);
      build(PTS, A, Bv, r, 0.16, 0.018, wob);
      write(i * PTS, PTS, cam, 0.085 * (0.7 + 0.3 * I), I);
      // where it lands
      m4.makeScale(0.5 + 0.25 * I, 1, 0.5 + 0.25 * I).setPosition(Bv.x, 0.035, Bv.z);
      spots.setMatrixAt(i, m4); spotPow[i] = I;
      light.pos.x += Bv.x * I; light.pos.z += Bv.z * I; wsum += I; light.power += I;
      // a fork or two off its middle
      for (let f = 0; f < 2 && fork < FORKS; f++) {
        if (r() > 0.62) { write(MAIN * PTS + fork * FPTS, FPTS, cam, 0, 0); fork++; continue; }
        const at = 4 + Math.floor(r() * (PTS - 9));
        A.fromArray(path, at * 3);
        const keep = Float32Array.from(path);
        const fl = 0.2 + 0.35 * r(), fa = r() * Math.PI * 2;
        Q.set(A.x + Math.cos(fa) * fl, Math.max(0.03, A.y - fl * (0.4 + 0.9 * r())), A.z + Math.sin(fa) * fl);
        build(FPTS, A, Q, r, 0.2, 0.012, wob);
        write(MAIN * PTS + fork * FPTS, FPTS, cam, 0.05, I * 0.55);
        path.set(keep);
        fork++;
      }
    }
    for (; fork < FORKS; fork++) write(MAIN * PTS + fork * FPTS, FPTS, cam, 0, 0);
    geo.attributes.position.needsUpdate = true; geo.attributes.aPow.needsUpdate = true;
    spots.instanceMatrix.needsUpdate = true; spots.geometry.attributes.aSpot.needsUpdate = true;
    if (wsum > 1e-4) light.pos.set(light.pos.x / wsum, 0.3, light.pos.z / wsum); else light.pos.set(centre.x, 0.3, centre.z);
    return light;
  }
  return { group, update };
}
