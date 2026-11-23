// Flame crescents: fire drawn on the banked blade mesh built in Blender (blender/make_ribbon.py).
// Noise streams back from the head, the tail breaks up and the blade ripples.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { uv, vec2, vec4, float, texture, uniform, smoothstep, mix, sin, positionLocal, normalLocal, pow } from 'three/tsl';
import { fireRamp } from './sim.js';

export async function createRibbons({ count = 4, noiseTex, time }) {
  const gltf = await new GLTFLoader().loadAsync('./models/ribbon.glb');
  let geo = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !geo) geo = o.geometry; });

  const group = new THREE.Group();
  const list = [];
  for (let i = 0; i < count; i++) {
    const U = { life: uniform(0), fade: uniform(0), power: uniform(1), seed: uniform(i * 0.37 + 0.11) };
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    mat.blending = THREE.AdditiveBlending;

    const u = uv().x, v = uv().y;
    // the blade ripples, most at the tail
    const wob = texture(noiseTex, vec2(u.mul(1.6).sub(time.mul(0.9)).add(U.seed), U.seed.mul(3.1))).level(0).g.sub(0.5);
    mat.positionNode = positionLocal.add(normalLocal.mul(wob).mul(float(0.16).mul(float(1.15).sub(u))));

    const n1 = texture(noiseTex, vec2(u.mul(1.5).add(time.mul(1.25)).add(U.seed), v.mul(0.55).add(U.seed.mul(2.3)))).g;
    const n2 = texture(noiseTex, vec2(u.mul(4.2).add(time.mul(2.4)), v.mul(1.4).sub(time.mul(0.25)).add(U.seed))).b;
    const n3 = texture(noiseTex, vec2(u.mul(9.0).add(time.mul(4.1)), v.mul(3.0).add(U.seed.mul(5.0)))).b;
    const n = n1.mul(0.55).add(n2.mul(0.3)).add(n3.mul(0.15));
    const across = pow(sin(v.mul(Math.PI)).max(0), 0.6);
    const grow = smoothstep(float(1).sub(U.life.mul(1.25)), float(1.2).sub(U.life.mul(1.25)), u);   // the head arrives first
    const core = float(0.3).add(pow(u, 1.6).mul(0.7));                                              // hottest at the head
    const heat = n.mul(1.5).sub(0.02).mul(across).mul(core).mul(grow);
    const cut = mix(float(0.34), float(0.16), u).add(U.fade.mul(0.9));                                // the tail is eaten away
    const a = smoothstep(cut, cut.add(0.14), heat);
    const h = heat.mul(1.7).mul(a).min(1.4);
    mat.fragmentNode = vec4(fireRamp(h).mul(U.power).mul(0.8), a);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    list.push({ mesh, U });
  }
  return { group, list };
}
