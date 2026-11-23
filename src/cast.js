// The two characters (Meshy models, slimmed with toolkit/gltf/slim-character.mjs): the fire mage and the
// cold furnace golem. Every pose is a pure function of the piece's clock: a list of clip segments with
// crossfades, so any moment can be drawn on its own.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { positionGeometry, vec3, float, uniform, smoothstep, length, texture, dot, max, mix } from 'three/tsl';

// where things are on the golem, in body heights (x right, y up from the feet, z depth); found by looking, see tools
const GOLEM_MARKS = { fx: 0, fy: 0.642, fz: 0.2, fr: 0.07, ex: 0.031, ey: 0.923, ez: 0.12, er: 0.02 };

function prepare(gltf, height) {
  const root = gltf.scene;
  let skin = null;
  root.traverse((o) => {
    if (o.isSkinnedMesh) { skin = o; o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; } else if (o.isMesh) o.visible = false;
  });
  skin.geometry.computeBoundingBox();
  const bb = skin.geometry.boundingBox;
  const h = bb.max.y - bb.min.y;
  const holder = new THREE.Group();
  holder.add(root);
  root.scale.setScalar(height / h);
  root.position.y = -bb.min.y * height / h;
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of gltf.animations) {
    const a = mixer.clipAction(clip);
    a.play(); a.setEffectiveWeight(0); a.setEffectiveTimeScale(0);
    actions[clip.name] = { action: a, duration: clip.duration };
  }
  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[o.name.replace('mixamorig:', '').replace('mixamorig', '')] = o; });
  return { holder, root, skin, mixer, actions, bones, bb, unit: h, scale: height / h, track: [] };
}

const ease = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

// track: [{ clip, at, fade, speed = 1, from = 0, loop = false, hold = true }], in order of `at`.
// At time t the latest segment that has started is in charge; it fades in over `fade` from the one before.
function pose(ch, t) {
  for (const k in ch.actions) ch.actions[k].action.setEffectiveWeight(0);
  let cur = 0;
  for (let i = 0; i < ch.track.length; i++) if (t >= ch.track[i].at) cur = i;
  const set = (seg, w) => {
    if (!seg || w <= 0) return;
    const a = ch.actions[seg.clip];
    let ct = (seg.from || 0) + (t - seg.at) * (seg.speed ?? 1);
    ct = seg.loop ? ((ct % a.duration) + a.duration) % a.duration : Math.min(Math.max(ct, 0), a.duration - 1e-3);
    a.action.time = ct;
    a.action.setEffectiveWeight(a.action.getEffectiveWeight() + w);
  };
  const seg = ch.track[cur];
  const w = seg.fade > 0 ? ease((t - seg.at) / seg.fade) : 1;
  set(seg, w);
  set(ch.track[cur - 1], 1 - w);
  ch.mixer.update(0);
}

export async function createCast({ maps = {} } = {}) {
  const loader = new GLTFLoader();
  const [mg, gg] = await Promise.all([loader.loadAsync('./models/mage.glb'), loader.loadAsync('./models/golem.glb')]);
  const mage = prepare(mg, 1.72);
  const golem = prepare(gg, 3.1);

  // the golem's furnace and eyes: dark and cold until the fire reaches them
  const G = { furnace: uniform(0), eyes: uniform(0), flicker: uniform(1) };
  for (const k in GOLEM_MARKS) G[k] = uniform(GOLEM_MARKS[k]);
  {
    const old = golem.skin.material;
    const m = new THREE.MeshStandardNodeMaterial();
    m.map = old.map; m.normalMap = old.normalMap; m.roughnessMap = old.roughnessMap; m.metalnessMap = old.metalnessMap;
    m.metalness = old.metalness; m.roughness = old.roughness;
    if (old.normalScale) m.normalScale = old.normalScale;
    const bb = golem.bb, H = bb.max.y - bb.min.y;
    const p = positionGeometry.sub(vec3(0, bb.min.y, 0)).div(H);            // model space, in body heights, feet at 0
    // the round opening in the chest: what lies inside the door ring and behind the bars
    const dF = length(p.xy.sub(vec3(G.fx, G.fy, 0).xy)).add(smoothstep(0.0, 0.02, G.fz.sub(p.z).sub(0.12)));   // only the front of the body
    const inside = float(1).sub(smoothstep(G.fr.mul(0.8), G.fr, dF));
    const lum = dot(texture(old.map).rgb, vec3(0.3, 0.5, 0.2));
    const hollow = float(1).sub(smoothstep(0.02, 0.09, lum));               // the dark behind the bars, not the bars
    const fire = mix(vec3(1.0, 0.2, 0.02), vec3(1.0, 0.62, 0.18), hollow).mul(inside).mul(hollow.mul(0.85).add(0.15)).mul(G.furnace).mul(G.flicker).mul(5.0);
    // eyes: two round lamps on the head
    const eL = length(p.sub(vec3(G.ex, G.ey, G.ez))), eR = length(p.sub(vec3(G.ex.negate(), G.ey, G.ez)));
    const eye = float(1).sub(smoothstep(G.er.mul(0.6), G.er, max(float(0), max(eL, eR).min(eL).min(eR))));
    const lamp = vec3(1.0, 0.7, 0.3).mul(eye).mul(G.eyes).mul(5.0);
    m.emissiveNode = fire.add(lamp);
    golem.skin.material = m;
    golem.furnaceLocal = (out = new THREE.Vector3()) => out.set(G.fx.value * H, G.fy.value * H + bb.min.y, G.fz.value * H);
  }
  return { mage, golem, G, pose };
}

