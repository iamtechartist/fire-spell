// Sparks and embers: short streaks whose whole path is a formula of their age, so they need no
// simulation and can be drawn for any moment. One draw call for the lot.
import * as THREE from 'three/webgpu';
import { attribute, vec3, vec4, float, uniform, exp, max, mix, smoothstep, cameraPosition, uv, normalize, cross, fract, sin } from 'three/tsl';

export function createSparks({ count = 420, time }) {
  const geo = new THREE.PlaneGeometry(1, 1);          // x: along the streak (0 = tail, 1 = head), y: across
  const seedA = new Float32Array(count * 4), seedB = new Float32Array(count * 4);
  let s = 99991;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < count; i++) {
    // direction over the upper hemisphere, leaning outward
    const a = r() * Math.PI * 2, up = 0.08 + Math.pow(r(), 0.7) * 0.9, h = Math.sqrt(1 - up * up);
    seedA.set([h * Math.cos(a), up, h * Math.sin(a), 4 + Math.pow(r(), 2.2) * 22], i * 4);   // dir, speed
    seedB.set([r(), 0.5 + r() * 1.3, r(), r()], i * 4);                                       // delay, life, size, hue
  }
  geo.setAttribute('aA', new THREE.InstancedBufferAttribute(seedA, 4));
  geo.setAttribute('aB', new THREE.InstancedBufferAttribute(seedB, 4));

  const U = { start: uniform(-100), origin: uniform(new THREE.Vector3(0, 1, 0)), power: uniform(1), spread: uniform(0.12) };
  const A = attribute('aA', 'vec4'), B = attribute('aB', 'vec4');
  const age = time.sub(U.start).sub(B.x.mul(U.spread));
  const k = float(1.9);                               // air drag
  const posAt = (t) => {
    const tt = max(t, 0);
    const fly = float(1).sub(exp(k.mul(tt).negate())).div(k);
    const p = U.origin.add(A.xyz.mul(A.w).mul(fly)).add(vec3(0, -2.6, 0).mul(tt).mul(tt));
    // a little wander
    return p.add(vec3(sin(tt.mul(7).add(B.w.mul(40))), 0, sin(tt.mul(6).add(B.z.mul(40)))).mul(0.05).mul(tt));
  };
  const head = posAt(age), tail = posAt(age.sub(0.022));
  const along = head.sub(tail);
  const side = normalize(cross(along, head.sub(cameraPosition)));
  const c = uv();
  const wide = mix(float(0.008), float(0.02), B.z);
  const life = age.div(B.y);
  const alive = smoothstep(0.0, 0.02, age).mul(float(1).sub(smoothstep(0.75, 1.0, life))).mul(head.y.greaterThan(0.02).select(float(1), float(0)));

  const mat = new THREE.NodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.AdditiveBlending;
  mat.side = THREE.DoubleSide;
  mat.positionNode = mix(tail, head, c.x).add(side.mul(c.y.sub(0.5)).mul(wide));
  const hot = float(1).sub(life).max(0);
  const col = mix(vec3(1.0, 0.16, 0.02), vec3(1.0, 0.72, 0.32), hot.mul(hot));
  const soft = float(1).sub(c.y.sub(0.5).abs().mul(2)).max(0).mul(c.x.mul(0.8).add(0.2));
  mat.fragmentNode = vec4(col.mul(mix(float(1.0), float(5), hot)).mul(U.power), soft.mul(alive));

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return { mesh, U };
}
