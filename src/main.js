import * as THREE from 'three/webgpu';
import { pass, vec4, vec2, uniform, vec3, float, smoothstep, min, mix, sin, uv, texture, cross, normalize, cameraPosition, pow, renderOutput } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { createSim, fireRamp } from './sim.js';
import { createVolume } from './volume.js';
import { makeNoise3D } from './noise3d.js';
import { createFloor, nightSky, noiseTexture } from './floor.js';
import { createRune } from './rune.js';
import { createRibbons } from './ribbons.js';
import { createSparks } from './sparks.js';
import { createCast } from './cast.js';
import { createLamps, createCourt } from './court.js';
import { B, PLACE, LIFT, LAND, liftAt } from './stage.js';
import { createArcs } from './arcs.js';
import { loader } from './ta-loader.js';
import { createAudio } from './audio.js';

const q = new URLSearchParams(location.search);
const manual = q.has('manual');
const $ = (id) => document.getElementById(id);

if (!navigator.gpu) {
  $('nogpu').hidden = false;
  throw new Error('WebGPU is not available in this browser');
}

const canvas = $('stage');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
await renderer.init();
loader.progress(0.12);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
const fxScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 300);
const CAM = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
const CAM_WIDE = { pos: new THREE.Vector3(...PLACE.camera), look: new THREE.Vector3(...PLACE.look) };
const CAM_TALL = { pos: new THREE.Vector3(0.6, 13.0, 10.5), look: new THREE.Vector3(0.35, 1.4, -0.3) };   // tall windows look down more, so stone fills the frame

const uTime = uniform(0);                       // seconds on the piece's own clock
const noise2 = noiseTexture();

// where things stand: the mage on her casting stone, the golem across the court
const SEAL = new THREE.Vector3(...PLACE.seal);
const GOLEM = new THREE.Vector3(...PLACE.golem);
const FACE = Math.atan2(GOLEM.x - SEAL.x, GOLEM.z - SEAL.z);          // the way the mage looks
const AHEAD = new THREE.Vector3(Math.sin(FACE), 0, Math.cos(FACE));
const CHEST = GOLEM.clone().addScaledVector(AHEAD, -0.75).setY(1.98);  // just in front of the furnace door

// ---- picture passes first, so the fire can read the scene's depth and hide behind the characters
const pipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);

// ---- fire and smoke: a live fluid simulation, drawn by ray marching
const sim = createSim(renderer, new THREE.Vector3(SEAL.x, 0, SEAL.z));
await sim.init();
loader.progress(0.3);
const volume = createVolume(sim, makeNoise3D(64), { viewZ: scenePass.getViewZNode() });
fxScene.add(volume.mesh);
let simAt = 'seal';

// ---- the courtyard floor with the seal in it, the moon, the firelight
const MOON = volume.U.moonDir.value;
const rune = createRune({ noiseTex: noise2, centre: new THREE.Vector2(SEAL.x, SEAL.z) });
const GLOW_ON = 0.22;
const GLOW = uniform(GLOW_ON);
const fireGlow = (wp) => {
  // light on the stone straight from the gas above it, through the sim's own light grid
  const p = vec3(wp.x, 0.25, wp.y);
  const uvw = p.sub(sim.uOrigin).div(sim.uSize).add(vec3(0.5, 0, 0.5));
  const edge = min(uvw.xz, vec3(1).sub(uvw).xz);
  return sim.lit.sample(uvw).level(0).rgb.mul(smoothstep(0.0, 0.12, min(edge.x, edge.y))).mul(GLOW);
};
const lamps = createLamps({ centre: SEAL, golem: GOLEM, time: uTime });
const floor = createFloor({
  fireGlow, decal: rune.decal, noiseTex: noise2, centre: new THREE.Vector2(SEAL.x, SEAL.z),
  lamps: (wp) => lamps.light(vec3(wp.x, 0, wp.y), vec3(0, 1, 0)),
});
scene.add(floor.mesh);
const court = await createCourt({ centre: SEAL, lamps, floorMat: floor.mat, noiseTex: noise2, time: uTime });
loader.progress(0.5);
scene.add(court.group);

scene.environment = nightSky(MOON);
scene.environmentIntensity = 1.1;
scene.background = new THREE.Color(0x03050a);
scene.fog = new THREE.Fog(0x03050a, 20, 80);

const moon = new THREE.DirectionalLight(0x9db8ff, 1.05);
moon.position.copy(MOON).multiplyScalar(30).add(new THREE.Vector3(0.4, 0, -0.3));
moon.target.position.set(0.4, 0, -0.3);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -13, right: 13, top: 12, bottom: -12, near: 5, far: 70 });
moon.shadow.bias = -0.0006;
moon.shadow.normalBias = 0.03;
const hemi = new THREE.HemisphereLight(0x22345c, 0x05060a, 0.17);
scene.add(moon, moon.target, hemi);

// two fixed lights carry the glow onto the scene; the beats set their place, colour and power
const fireLight = new THREE.PointLight(0xff8a3c, 0, 0, 2);
const runeLight = new THREE.PointLight(0xffb060, 0, 0, 2);
// the firelight throws the characters' and the posts' shadows across the court
fireLight.castShadow = true;
fireLight.shadow.mapSize.set(1024, 1024);
fireLight.shadow.camera.near = 0.12;
fireLight.shadow.camera.far = 40;
fireLight.shadow.bias = -0.003;
fireLight.shadow.normalBias = 0.05;
// a soft warm fill that comes up with the lamps, so the characters share their light
const courtLight = new THREE.PointLight(0xffc890, 0, 0, 2);
courtLight.position.set(0.3, 6.5, 1.5);
// the brazier is the key light of the lit court: when it catches, it throws everyone's shadow down the court toward us
const keyLight = new THREE.SpotLight(0xff9a48, 0, 0, 0.8, 0.6, 2);
keyLight.position.set(lamps.brazier.x, 4.2, lamps.brazier.z);
keyLight.target.position.set(0.3, 0.8, -0.3);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1.5;
keyLight.shadow.camera.far = 45;
keyLight.shadow.bias = -0.0008;
keyLight.shadow.normalBias = 0.04;
// the lit furnace glows on the golem and the stone before it; it throws no shadows, or its own fists would wave them across the court
const furnaceLight = new THREE.PointLight(0xff7a2a, 0, 0, 2);
furnaceLight.position.set(CHEST.x - AHEAD.x * 0.4, CHEST.y, CHEST.z - AHEAD.z * 0.4);
scene.add(fireLight, runeLight, courtLight, furnaceLight, keyLight, keyLight.target);

const ribbons = await createRibbons({ count: 4, noiseTex: noise2, time: uTime });
ribbons.group.position.copy(SEAL);
scene.add(ribbons.group);
const sparks = createSparks({ count: 420, time: uTime });
const embers = createSparks({ count: 160, time: uTime });
scene.add(sparks.mesh, embers.mesh);
// energy crackling between the mage's feet and the seal while it holds her up, and the cold light it throws
const arcs = createArcs();
const liftLight = new THREE.PointLight(0x86aaff, 0, 0, 2);
scene.add(arcs.group, liftLight);

// ---- the two characters
loader.progress(0.6);
const cast = await createCast();
loader.progress(0.92);
cast.mage.holder.position.copy(SEAL);
cast.mage.holder.rotation.y = FACE;
cast.golem.holder.position.copy(GOLEM);
cast.golem.holder.rotation.y = FACE + Math.PI;
scene.add(cast.mage.holder, cast.golem.holder);
let inspecting = false;

// ---- the bolt: a tongue of fire stretched between two points
const bolt = (() => {
  const U = { tail: uniform(new THREE.Vector3()), head: uniform(new THREE.Vector3(1, 0, 0)), wide: uniform(0.7), power: uniform(0) };
  const mat = new THREE.NodeMaterial();
  mat.transparent = true; mat.depthWrite = false; mat.side = THREE.DoubleSide; mat.blending = THREE.AdditiveBlending;
  const c = uv();
  const on = mix(U.tail, U.head, c.x);
  const side = normalize(cross(U.head.sub(U.tail), on.sub(cameraPosition)));
  const shape = pow(sin(c.x.mul(Math.PI * 0.5)).max(0), 0.6).mul(float(1).sub(pow(c.x, 6.0).mul(0.6)));   // thin tail, fat head
  mat.positionNode = on.add(side.mul(c.y.sub(0.5)).mul(U.wide).mul(shape));
  const n = texture(noise2, vec2(c.x.mul(1.6).sub(uTime.mul(5.5)), c.y.mul(0.8))).g.mul(0.6)
    .add(texture(noise2, vec2(c.x.mul(4.5).sub(uTime.mul(9.0)), c.y.mul(2.0).add(0.3))).b.mul(0.4));
  const across = pow(sin(c.y.mul(Math.PI)).max(0), 0.7);
  const heat = n.mul(1.3).add(0.15).mul(across).mul(float(0.25).add(pow(c.x, 1.4).mul(0.9)));
  const a = smoothstep(0.2, 0.36, heat);
  mat.fragmentNode = vec4(fireRamp(heat.mul(2.1).mul(a).min(1.5)).mul(U.power), a);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 24, 1), mat);
  mesh.frustumCulled = false; mesh.renderOrder = 7; mesh.visible = false;
  scene.add(mesh);
  return { mesh, U };
})();

// ---- picture: the scene, the fire at three-quarter size over it, bloom
const volPass = pass(fxScene, camera);
volPass.setResolutionScale(Number(q.get('vr')) || 0.75);
const volSoft = q.has('noblur') ? volPass : gaussianBlur(volPass, 0.22, 1);
const comp = vec4(scenePass.rgb.mul(volSoft.a.oneMinus()).add(volSoft.rgb), 1);
const glow = bloom(comp, 0.24, 0.6, 1.1);
// tone map first, then smooth the stair-steps on thin bright lines
pipeline.outputColorTransform = false;
pipeline.outputNode = fxaa(renderOutput(q.has('nobloom') ? comp : comp.add(glow)));

// ---- the beats (seconds)
// the blast: lumpy balls of fuel lit together; the gas they make swells from r0 to r1 in `swell` seconds
const K = { window: 0.05, rad: 1.0, rough: 0.7, fuel: 1.0, temp: 1.2, dens: 0.1, r0: 0.6, r1: 2.4, swell: 0.2, dust: 0.14, light: 560, fill: 55, key: 1100 };
const RUN = { sub: 1, speed: 1, playing: true };
let T = 0;

// ---- the breakdown: any one layer of the spell can be shown alone. The clock, the simulation and the
// characters run on underneath whatever is shown, so switching is instant.
// seal: the decal in the floor · ribbons: the crescent blades · fire: the simulated fire · glow: its light
// on the stone · bolt · sparks · stage: court, lamps and the two characters · sealLight, fireLight: the
// lights the spell carries. from/to: the part of the clock a layer is alive in (it loops there when alone).
const LAYERS = [
  { id: 'all', name: 'All together', chip: 'All', from: 0, to: B.end,
    how: 'Six layers on one clock. Pick one to see it alone, or drag the time bar.',
    show: { seal: 1, ribbons: 1, fire: 1, glow: 1, bolt: 1, sparks: 1, stage: 1, sealLight: 1, fireLight: 1 } },
  { id: 'seal', name: 'The seal', chip: 'Seal', from: B.slam - 0.3, to: B.hit + 1.7,
    how: 'One painted picture of the seal. The writing, the heat and the scorch are sums in the floor\u2019s shader, driven by the clock. The arcs that hold her up are jagged strips thrown afresh every few frames.',
    show: { seal: 1, sealLight: 1 } },
  { id: 'crescents', name: 'Flame crescents', chip: 'Crescents', from: B.spin0 - 0.15, to: B.release + 0.14,
    how: 'Four curved blades modelled in Blender. In the full spell, real fire from the simulation trails behind three of them.',
    show: { ribbons: 1 } },
  { id: 'fire', name: 'The fire', chip: 'Fire', from: B.spin0 - 0.05, to: B.hit + 1.7,
    how: 'A fluid simulation on the graphics card: about a million cells, stepped sixty times a second. Nothing is pre-rendered. The other views cut it open down the middle to show what it is working out.',
    show: { fire: 1, glow: 1, fireLight: 1 },
    raws: [['Flame', 0, 1], ['Heat', 2, 0.8], ['Smoke', 1, 1.5], ['Speed', 3, 0.09], ['Fuel', 4, 2.2]] },
  { id: 'bolt', name: 'Bolt and sparks', chip: 'Bolt', from: B.release - 0.25, to: B.hit + 1.7,
    how: 'The bolt is one stretched card of flame. The 580 sparks and embers each fly a simple arc worked out from the clock.',
    show: { bolt: 1, sparks: 1, fireLight: 1 } },
  { id: 'light', name: 'Light and shadow', chip: 'Light', from: B.spin0 + 0.6, to: B.end,
    how: 'The spell itself is hidden here. What is left is the light it throws: lights ride the seal, the bolt and the blast, and their shadows are worked out live.',
    show: { stage: 1, glow: 1, sealLight: 1, fireLight: 1 } },
];
const layerOf = (id) => LAYERS.find((l) => l.id === id);
const VIEW = { layer: 'all', raw: 0, rawGain: 1, fade: 1, live: true };   // live: the simulation is at the clock's own time
let exposure = 1;

cast.mage.track = [
  { clip: 'Idle', at: -10, loop: true },
  { clip: 'Charged_Ground_Slam', at: B.slam - 1.55, fade: 0.25 },                 // her fist meets the stone at B.slam
  { clip: 'Combat_Stance', at: B.slam + 1.5, fade: 0.4, loop: true },
  { clip: 'Charged_Spell_Cast', at: B.spin0 - 0.1, from: 0.25, fade: 0.3 },       // she crouches as the crescents light
  { clip: 'Float', at: LIFT.t0 - 0.05, fade: 0.5, loop: true },                   // the seal lifts her: arms wide, legs loose
  { clip: 'mage_soell_cast_3', at: B.release - 0.55, from: 0.6, fade: 0.3 },      // both hands thrust forward at B.release, in the air
  { clip: 'Float', at: B.release + 0.45, from: 1.0, fade: 0.45, loop: true },     // she drifts down
  { clip: 'Combat_Stance', at: LAND - 0.12, fade: 0.3, loop: true },              // her knees take the landing
  { clip: 'Idle', at: LAND + 0.9, fade: 0.6, loop: true },
];
cast.golem.track = [
  { clip: 'Idle', at: -10, loop: true, speed: 0.3 },                              // asleep on its feet
  // Struck, it rocks back (in code, below), then the furnace catches: it doubles forward and roars, and stands up
  // square to her. (The hit and chest-pound clips left its arms held straight out behind it.)
  { clip: 'Zombie_Scream', at: B.hit + 0.55, fade: 0.45 },
  { clip: 'Idle', at: B.hit + 3.1, from: 1.0, speed: 0.25, fade: 0.7, loop: true },
];

const sat = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => { const t = sat(x); return t * t * (3 - 2 * t); };
const off = (e) => { e.fuel.value = 0; e.temp.value = 0; e.dens.value = 0; e.push.value = 0; e.up.value = 0; e.expand.value = 0; };
const shake = new THREE.Vector3();
const hands = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), head = new THREE.Vector3();

const feet = [new THREE.Vector3(), new THREE.Vector3()];
function posed(t) {
  cast.pose(cast.mage, t);
  cast.pose(cast.golem, t);
  cast.mage.holder.position.y = liftAt(t);                 // the seal holds her off the stone
  // the golem sleeps with its head down until the fire wakes it
  const sleep = 1 - ease((t - B.hit) / 0.5);
  const gb = cast.golem.bones;
  if (gb.Head) gb.Head.rotateX(0.5 * sleep);
  if (gb.Spine2) gb.Spine2.rotateX(0.16 * sleep);
  // the blast rocks it back on its heels, and it rocks forward again
  const a = t - B.hit;
  if (a > 0 && a < 2.5) {
    const k = Math.min(1, a / 0.07) * Math.exp(-a * 2.6) * Math.cos(a * 5.0);
    if (gb.Spine) gb.Spine.rotateX(-0.24 * k);
    if (gb.Spine1) gb.Spine1.rotateX(-0.13 * k);
  }
  cast.mage.holder.updateMatrixWorld(true);
  cast.golem.holder.updateMatrixWorld(true);
  cast.mage.bones.LeftHand.getWorldPosition(v1);
  cast.mage.bones.RightHand.getWorldPosition(v2);
  hands.addVectors(v1, v2).multiplyScalar(0.5);
  const mb = cast.mage.bones;
  (mb.LeftToeBase || mb.LeftFoot).getWorldPosition(feet[0]);
  (mb.RightToeBase || mb.RightFoot).getWorldPosition(feet[1]);
  gb.Head.getWorldPosition(head);
}

function beats(t) {
  uTime.value = t;
  if (!inspecting) posed(t);
  const c = t - B.release;                               // seconds since the bolt left her hands
  const a = t - B.hit;                                   // seconds since it reached the golem
  const R = rune.U;
  const out = 1 - ease((t - (B.end - 0.7)) / 0.55);      // everything goes out under the dip to dark at the loop join

  // --- the seal: written from where her fist lands, heated, molten, then cooling to a scorch
  R.time.value = t;
  R.draw.value = sat((t - B.slam) / (B.draw1 - B.slam)) * 1.06;
  R.heat.value = ease((t - B.heat0) / (B.heat1 - B.heat0));
  R.molten.value = ease((t - B.spin0 - 0.3) / 1.4) * (1 - ease(c / 0.9));
  R.cool.value = ease((c - 0.4) / 3.6);
  R.scorch.value = Math.max(R.heat.value * 0.5, ease((t - B.spin0) / 1.6)) * out;
  R.power.value = (1 + 1.6 * Math.exp(-Math.max(0, t - B.slam) * 6) * (t > B.slam ? 1 : 0) + 1.0 * Math.exp(-Math.max(0, c) * 5) * (c > 0 ? Math.min(1, c / 0.05) : 0)) * out;

  const chalk = sat((t - B.slam) / 0.8) * (1 - R.heat.value);
  const lit = (1.4 * chalk + (c < 0 ? 9 * R.heat.value * (1 - R.molten.value) + 26 * R.molten.value : 26 * Math.exp(-c * 2.6) * (1 - R.cool.value) + 5 * (1 - R.cool.value))) * out;
  runeLight.intensity = lit * (0.93 + 0.07 * Math.sin(t * 23) * Math.sin(t * 7.3));
  runeLight.color.setRGB(0.36 + 0.64 * R.heat.value, 0.6 - 0.2 * R.heat.value, 1.0 - 0.93 * R.heat.value);
  runeLight.position.set(SEAL.x + 0.5, 0.55 + 0.7 * (1 - R.heat.value), SEAL.z + 0.7);

  // the blast is sooty; the small flames before and after it burn clean, and old smoke thins out
  const sooty = a > -0.05 && a < 1.2;
  sim.P.soot.value = sooty ? 0.24 : 0.03;
  sim.P.sootBurn.value = sooty ? 0.2 : 0.02;
  sim.P.dissipation.value = 0.5 + 0.9 * ease((a - 1.4) / 1.5);

  // --- flame crescents: light at the rim, race round her, then wind in and up to her hands
  const E = sim.emitters;
  off(E[0]); off(E[1]); off(E[2]);
  ribbons.list.forEach((rb, i) => {
    const tau = t - (B.spin0 + i * 0.14);
    const on = tau > 0 && c < 0.08;
    rb.mesh.visible = on;
    if (!on) return;
    const wind = ease((tau - 0.75) / 0.95);
    const sp = t - B.spin0;                               // one shared turn, so the four stay a quarter apart
    const ang = i * Math.PI * 0.5 + 0.4 + 2.2 * sp + 2.0 * sp * sp;
    const rad = 1.92 - 1.3 * wind, y = 0.03 + (1.12 + liftAt(t)) * wind;       // they wind in and up to her hands, wherever she is
    rb.mesh.rotation.set(0, ang, 0);
    rb.mesh.scale.set(rad, 1 + 0.7 * wind, rad);
    rb.mesh.position.set(0, y, 0);
    rb.U.life.value = sat(tau / 0.3);
    rb.U.fade.value = sat((c + 0.12) / 0.16);
    rb.U.power.value = 1 + 0.9 * wind;
    // three of the four crescents drag real fire through the sim behind their heads
    if (i < 3 && c < -0.55) {                               // they stop feeding it in time for her to be seen as she strikes
      const e = E[(i + 1) % 3], ha = ang + 1.95;
      e.pos.value.set(SEAL.x + Math.cos(ha) * rad * 1.04, y + 0.24, SEAL.z - Math.sin(ha) * rad * 1.04);
      e.rad.value = 0.36; e.rough.value = 0.7;
      e.fuel.value = 8 * sat(tau / 0.3); e.temp.value = 7; e.dens.value = 0.02;
    }
  });

  // --- the bolt crosses the court
  const fly = sat(c / (B.hit - B.release));
  bolt.mesh.visible = c > -0.02 && a < 0.1;
  if (bolt.mesh.visible) {
    v1.copy(hands).addScaledVector(AHEAD, 0.25);
    bolt.U.head.value.lerpVectors(v1, CHEST, fly);
    bolt.U.tail.value.lerpVectors(v1, CHEST, Math.max(0, fly - 0.42));
    bolt.U.wide.value = 0.85;
    bolt.U.power.value = 1.5 * (1 - sat(a / 0.1));
  }

  // --- the blast at the golem: it lights the furnace, it does not break anything
  const fuelBall = (e, a0, dx, dy, dz, rad) => {
    if (!(a0 >= 0 && a0 < K.window)) return;
    e.pos.value.set(CHEST.x + dx, CHEST.y + dy, CHEST.z + dz); e.rad.value = rad; e.rough.value = K.rough;
    e.fuel.value = K.fuel / K.window; e.temp.value = K.temp / K.window; e.dens.value = K.dens / K.window;
  };
  fuelBall(E[0], a, 0, -0.5, 0, K.rad);
  fuelBall(E[2], a - 0.035, 0.45, 0.2, -0.35, K.rad * 0.7);
  const u = a / K.swell, swelling = u >= 0 && u < 1;
  sim.blast.pos.value.set(CHEST.x, CHEST.y - 0.5, CHEST.z);
  sim.blast.r.value = swelling ? K.r1 - (K.r1 - K.r0) * (1 - u) * (1 - u) : 1;
  sim.blast.v.value = swelling ? 2 * (K.r1 - K.r0) * (1 - u) / K.swell : 0;
  if (a >= 0 && a < 0.1) {
    const e = E[1];
    e.pos.value.set(CHEST.x, -0.55, CHEST.z); e.rad.value = 1.9; e.rough.value = 0.9; e.dens.value = K.dust / 0.1;
  } else if (a >= 1.0) {
    // awake: flame and smoke puff from its two chimneys for as long as it stays lit
    const k = ease((a - 1.0) / 0.6) * out, puff = 0.65 + 0.35 * Math.sin(t * 7.0);
    [[E[1], 0.42], [E[2], -0.42]].forEach(([e, sx], n) => {
      e.pos.value.set(head.x + AHEAD.z * sx + AHEAD.x * 0.32, head.y + 0.42, head.z - AHEAD.x * sx + AHEAD.z * 0.32);
      e.rad.value = 0.2; e.rough.value = 0.5;
      e.fuel.value = 3.2 * k * (n ? puff : 1.3 - puff); e.temp.value = 4.5 * k; e.dens.value = 0.03 * k;
    });
  }
  const lit2 = ease((a - 0.15) / 0.5) * out;
  cast.G.furnace.value = lit2;
  cast.G.eyes.value = ease((a - 0.7) / 0.5) * out;
  cast.G.flicker.value = 0.85 + 0.15 * Math.sin(t * 17) * Math.sin(t * 5.3);

  // firelight: gathers at her hands, rides the bolt, flashes at the golem, then lives in the furnace
  const charge = c < 0 ? ease((t - B.spin0) / 1.7) : 0;
  const flash = a < 0 ? 0 : Math.min(1, a / 0.06) * (0.25 * Math.exp(-a * 9) + 0.75 * Math.exp(-a * 2.6)) * (1 - sat((a - 1.3) / 0.9));
  if (c < 0) {
    // from the first frame she carries a little ember-light in her hands; it swells as the fire gathers
    const ember = 3.2 + 1.6 * ease((t - (B.slam - 1.3)) / 1.0) * (1 - ease((t - B.slam) / 0.6));
    fireLight.position.copy(hands).addScaledVector(AHEAD, 0.25).setY(Math.max(0.45, hands.y + 0.1));
    fireLight.intensity = (ember + 24 * charge) * (0.9 + 0.1 * Math.sin(t * 19) * Math.sin(t * 6.1));
    fireLight.color.setRGB(1, 0.42, 0.1);
  } else if (a < 0) {
    fireLight.position.copy(bolt.U.head.value);
    fireLight.intensity = 90;
    fireLight.color.setRGB(1, 0.46, 0.12);
  } else {
    // the flash sits out in front of the fireball, so the golem's shadow goes back across the steps, not under its own fists
    fireLight.position.set(CHEST.x - AHEAD.x, CHEST.y + 0.45 + Math.min(a, 1.2) * 1.3, CHEST.z - AHEAD.z);
    fireLight.intensity = K.light * flash;
    fireLight.color.setRGB(1, 0.3 + 0.16 * Math.exp(-a * 3), 0.035 + 0.1 * Math.exp(-a * 5));
  }

  furnaceLight.intensity = 46 * lit2 * cast.G.flicker.value;
  // a shadow map is only redrawn while its light is doing something: six views of both characters are not free
  fireLight.shadow.autoUpdate = fireLight.intensity > 2.5;

  // the court lights up all through the spell (stage.js says when each lamp catches); the brazier catches from the blast
  lamps.U.lit.value = t > B.wave ? t - B.wave : -1;
  courtLight.intensity = K.fill * ease((t - B.wave - 0.6) / 4.2) * out;   // the fill comes up with the lamps, all through the spell
  const caught = ease((t - B.wave - lamps.brazierDelay) / 0.7);
  keyLight.intensity = K.key * caught * (0.93 + 0.07 * Math.sin(t * 13) * Math.sin(t * 4.7)) * out;
  keyLight.shadow.autoUpdate = keyLight.intensity > 1;

  // sparks at the blast, embers lifting off the hot seal
  sparks.U.start.value = B.hit;
  sparks.U.origin.value.copy(CHEST);
  embers.U.start.value = B.spin0 + 0.4;
  embers.U.spread.value = 2.6;
  embers.U.origin.value.set(SEAL.x, 0.15, SEAL.z);
  embers.U.power.value = c < 0.2 ? 0.5 : 0;

  // energy crackles between her feet and the seal from the moment she leaves the stone until the bolt is gone,
  // strongest just before she strikes
  const crackle = ease((t - LIFT.t0 - 0.05) / 0.3) * (1 - ease((c - 0.02) / 0.3)) * (0.7 + 0.3 * ease((c + 0.6) / 0.5));
  const arcLight = arcs.update(t, crackle, feet, SEAL, CAM.pos);
  liftLight.position.copy(arcLight.pos);
  liftLight.intensity = 5.5 * arcLight.power;

  // the camera takes the blast: a short kick, never a strobe
  const kick = a > 0 ? Math.exp(-a * 6.5) * Math.min(1, a / 0.04) : 0;
  shake.set(Math.sin(t * 71) * 0.11, Math.sin(t * 93 + 1) * 0.09, Math.sin(t * 57 + 2) * 0.05).multiplyScalar(kick);
  // the loop joins on a short dip to dark, so the golem can go back to sleep unseen
  const dip = ease(t / 0.5) * (1 - ease((t - (B.end - 0.5)) / 0.45));
  exposure = (1 + 0.35 * (a > 0 ? Math.exp(-a * 7) * Math.min(1, a / 0.07) : 0)) * dip;

  // --- the breakdown may be showing one layer alone
  const S = layerOf(VIEW.layer).show;
  if (!S.seal) { R.draw.value = 0; R.scorch.value = 0; R.power.value = 0; }
  if (!S.sealLight) { runeLight.intensity = 0; liftLight.intensity = 0; }
  arcs.group.visible = !!S.seal;
  if (!S.fireLight) fireLight.intensity = 0;
  ribbons.group.visible = !!S.ribbons;
  volume.mesh.visible = !!S.fire && VIEW.live;             // a fire from another moment is never shown
  volume.U.debug.value = S.fire ? VIEW.raw : 0;
  volume.U.rawGain.value = VIEW.rawGain;
  GLOW.value = S.glow && VIEW.live ? GLOW_ON : 0;
  if (!S.bolt) bolt.mesh.visible = false;
  sparks.mesh.visible = embers.mesh.visible = !!S.sparks;
  court.group.visible = cast.mage.holder.visible = cast.golem.holder.visible = !!S.stage;
  lamps.U.gain.value = S.stage ? 1 : 0;
  if (!S.stage) { keyLight.intensity = 0; courtLight.intensity = 0; furnaceLight.intensity = 0; }
}

// the sim box sits round the seal while the fire gathers, then round the golem for the blast
function placeSim(where) {
  if (simAt === where) return;
  simAt = where;
  const o = where === 'seal' ? SEAL : CHEST;
  sim.reset();
  sim.uOrigin.value.set(o.x, 0, o.z);
  volume.place();
}
const simAwake = (t) => t > B.spin0 - 0.1;

function advance(frames = 1, speed = 1) {
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < RUN.sub; i++) {
      const dt = speed / (60 * RUN.sub);
      beats(T);
      placeSim(T < B.release ? 'seal' : 'golem');
      if (simAwake(T)) sim.step(dt);
      T += dt;
    }
  }
  if (simAwake(T)) sim.light();
}

function restart() { simAt = ''; placeSim('seal'); T = 0; beats(0); }

// Moving about on the clock. Everything but the fire is a plain function of the time. The fire is a
// simulation: it cannot run backward or skip, so it is rebuilt from the nearest moment it starts clean
// (before it wakes; where the box moves to the golem; or, late on, a second back, when only the chimney
// flames are left in it).
const WAKE = B.spin0 - 0.1;
const checkpoint = (t) => (t <= WAKE ? t : t < B.release ? WAKE : t > B.hit + 3.3 ? Math.max(B.release, t - 1.2) : B.release);
function rewind(t) {
  const c = checkpoint(t);
  if (t < T - 1e-4 || c > T + 1e-4) { simAt = ''; T = c; placeSim(T < B.release ? 'seal' : 'golem'); }
}
// all the way there in one go (a hitch of up to half a second: only ever done behind a dip to black)
function jump(t) {
  rewind(t);
  const n = Math.round((t - T) * 60);
  if (n > 0) advance(n, 1);
  VIEW.live = true;
  beats(T);
}
// a short dip to black with something done in the dark: changing layer, going round a layer's loop
const CUT = { phase: 0, t0: 0, fn: null };
function cut(fn) { CUT.fn = fn; CUT.phase = 1; CUT.t0 = performance.now(); }
function cutStep(now) {
  if (CUT.phase === 1) {
    VIEW.fade = Math.max(0, 1 - (now - CUT.t0) / 150);
    if (VIEW.fade === 0) { CUT.fn(); CUT.phase = 2; CUT.t0 = performance.now(); acc = 0; }
  } else if (CUT.phase === 2) {
    VIEW.fade = Math.min(1, (performance.now() - CUT.t0) / 260);
    if (VIEW.fade === 1) CUT.phase = 0;
  }
}

const fwd = new THREE.Vector3();
function draw() {
  camera.position.copy(CAM.pos).add(shake);
  camera.lookAt(CAM.look);
  camera.updateMatrixWorld();
  volume.U.camDir.value.copy(camera.getWorldDirection(fwd));
  renderer.toneMappingExposure = exposure * VIEW.fade;
  pipeline.render();
}

const dirWide = new THREE.Vector3(), dirTall = new THREE.Vector3(), dirNow = new THREE.Vector3();
// what must stay inside the frame in every window shape
const KEY = {
  tip: new THREE.Vector3(lamps.brazier.x, lamps.brazier.y + 3.5, lamps.brazier.z),     // the top of the brazier's flame
  front: new THREE.Vector3(SEAL.x, 0, SEAL.z + 2.15), left: new THREE.Vector3(SEAL.x - 2.15, 0, SEAL.z),
  right: new THREE.Vector3(GOLEM.x + 1.6, 1.5, GOLEM.z),
};
const ndcV = new THREE.Vector3();
// Two framings are worked out for the window: one with the seal just clear of the controls, one with it clear
// of the breakdown strip as well. The camera glides between them when the strip opens or closes.
const FIT = [{ pos: new THREE.Vector3(), look: new THREE.Vector3(), bottom: -0.9 }, { pos: new THREE.Vector3(), look: new THREE.Vector3(), bottom: -0.79 }];
let stripK = 0, stripGoal = 0;
function solveFit(fit, tall, dStart) {
  // tilt, and only if that is not enough stand back, until the brazier's flame is inside the top of the frame,
  // the seal is above `bottom`, and the seal and the golem are inside the sides
  const look = fit.look.lerpVectors(CAM_WIDE.look, CAM_TALL.look, tall);
  const ndc = (p) => ndcV.copy(p).project(camera);
  let d = dStart, last = 0;
  for (let i = 0; i < 90; i++) {
    camera.position.copy(look).addScaledVector(dirNow, d);
    camera.lookAt(look);
    camera.updateMatrixWorld();
    const top = ndc(KEY.tip).y - 0.93, bot = fit.bottom - ndc(KEY.front).y;
    const side = Math.max(Math.abs(ndc(KEY.left).x), Math.abs(ndc(KEY.right).x)) - 0.95;
    if (top <= 0 && bot <= 0 && side <= 0) break;
    const way = top > 0 ? 1 : bot > 0 ? -1 : 0;
    if (side > 0 || (top > 0 && bot > 0) || way * last < 0) d *= 1.02;
    if (way) look.y += way * Math.min(0.4, (way > 0 ? top : bot) * d * Math.tan(camera.fov * Math.PI / 360) * 0.8 + 0.01);
    last = way;
  }
  fit.pos.copy(look).addScaledVector(dirNow, d);
  return d;
}
function placeCamera() {
  const k = ease(stripK);
  CAM.pos.lerpVectors(FIT[0].pos, FIT[1].pos, k);
  CAM.look.lerpVectors(FIT[0].look, FIT[1].look, k);
}
function resize() {
  const w = Math.max(8, canvas.clientWidth), h = Math.max(8, canvas.clientHeight);
  // the fire is marched for every pixel, so a big window gets a lower pixel ratio: about 1.9 million pixels at most
  const dpr = window.devicePixelRatio || 1;
  let ratio = Math.min(dpr, 1.5, Math.sqrt(1.9e6 / (w * h)));
  if (ratio > 0.9) ratio = Math.max(ratio, Math.min(1, dpr));       // never just under 1: that only blurs
  if (q.has('film')) ratio = dpr;                                   // a film is drawn frame by frame: pixel for pixel
  renderer.setPixelRatio(Math.max(0.75, ratio));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  if (!inspecting) {
    // wide windows use the staged shot; narrower ones look down more and stand back just far enough
    // to keep the mage, the golem and the whole fireball (5.4 m to either side) in the frame
    const tall = Math.min(1, Math.max(0, (1.5 - camera.aspect) / 0.3));
    dirWide.subVectors(CAM_WIDE.pos, CAM_WIDE.look);
    dirTall.subVectors(CAM_TALL.pos, CAM_TALL.look);
    const dWide = dirWide.length();
    camera.fov = 35 + 11 * tall;
    dirNow.lerpVectors(dirWide.normalize(), dirTall.normalize(), tall).normalize();
    const need = 5.4 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
    camera.updateProjectionMatrix();
    const d = solveFit(FIT[0], tall, Math.max(dWide, tall > 0 ? need : 0));
    solveFit(FIT[1], tall, Math.max(dWide, tall > 0 ? need : 0));
    placeCamera();
    scene.fog.near = d * 1.25 + 4;
    scene.fog.far = scene.fog.near + 60;
  }
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

// ---- controls
const ui = {
  play: $('play'), again: $('again'), slow: $('slow'), fill: $('fill'), sound: $('sound'), track: $('track'), scrub: $('scrub'), ticks: $('ticks'),
  beat: $('beat'), layers: $('layers'), panel: $('panel'), stack: $('stack'), tour: $('tour'), about: $('about'), how: $('how'),
};
// sound: off until asked for (browsers insist on a click), then locked to the clock every frame
const audio = manual ? null : createAudio();
ui.sound.addEventListener('click', async () => {
  if (!audio) return;
  if (audio.on) audio.disable(); else await audio.enable();
  ui.sound.dataset.on = audio.on ? '1' : '0';
  ui.sound.setAttribute('aria-label', audio.on ? 'Turn sound off' : 'Turn sound on');
});
document.addEventListener('visibilitychange', () => { if (document.hidden && audio) audio.hush(); });
const setPlay = (p) => { RUN.playing = p; ui.play.dataset.on = p ? '1' : '0'; ui.play.setAttribute('aria-label', p ? 'Pause' : 'Play'); };
ui.play.addEventListener('click', () => setPlay(!RUN.playing));
ui.slow.addEventListener('click', () => { RUN.speed = RUN.speed === 1 ? 0.25 : 1; ui.slow.dataset.on = RUN.speed === 1 ? '0' : '1'; });

// the time bar: drag it, or use the arrow keys on it. Marks show where each beat starts.
const BEATS = [
  [0, 'Night in the lamp court'], [B.slam - 0.35, 'Her fist starts the seal'], [B.slam + 0.05, 'The seal writes itself'],
  [B.heat0, 'The seal catches'], [B.spin0, 'Four flame crescents'], [LIFT.t0, 'The seal lifts her'], [B.release - 0.75, 'The fire is drawn in'],
  [B.release, 'The bolt'], [B.hit, 'The blast'], [B.hit + 1.0, 'The golem wakes'], [B.hit + 3.1, 'The court is lit'],
];
ui.scrub.max = String(B.end - 0.02);
for (const [t] of BEATS.slice(1)) { const m = document.createElement('i'); m.style.left = `${(t / B.end) * 100}%`; ui.ticks.append(m); }
const SEEK = { on: false, t: 0, moved: 0, dragging: false };
const seek = (t) => { stopTour(); SEEK.t = Math.min(B.end - 0.02, Math.max(0, t)); SEEK.on = true; SEEK.moved = performance.now(); };
ui.scrub.addEventListener('pointerdown', () => { SEEK.dragging = true; document.body.classList.add('scrubbing'); });
addEventListener('pointerup', () => { SEEK.dragging = false; document.body.classList.remove('scrubbing'); });
ui.scrub.addEventListener('input', () => seek(Number(ui.scrub.value)));

// the breakdown panel: one row per layer, the picked one says how it is made
let TOUR = null;                                   // which step of the play-through is showing, or null
// the play-through: the whole spell, then each layer alone over the part of the clock it lives in
const TOUR_STEPS = [
  { layer: 'all' }, { layer: 'seal' }, { layer: 'crescents' }, { layer: 'fire' },
  { layer: 'fire', raw: 2, from: B.release, to: B.hit + 2.1 }, { layer: 'fire', raw: 3, from: B.release, to: B.hit + 1.4 },
  { layer: 'bolt' }, { layer: 'light' },
];
const windowNow = () => { const L = layerOf(VIEW.layer), st = TOUR === null ? null : TOUR_STEPS[TOUR]; return { from: st?.from ?? L.from, to: Math.min(st?.to ?? L.to, B.end) }; };
function paint() {
  const L = layerOf(VIEW.layer);
  for (const chip of ui.stack.querySelectorAll('[data-layer]')) chip.setAttribute('aria-pressed', String(chip.dataset.layer === VIEW.layer));
  for (const set of ui.stack.querySelectorAll('.raws')) {
    const on = set.dataset.of === VIEW.layer;
    set.hidden = !on;
    for (const chip of set.children) chip.setAttribute('aria-pressed', String(on && Number(chip.dataset.raw) === VIEW.raw));
  }
  ui.how.textContent = `${L.name}. ${L.how}`;
  ui.tour.setAttribute('aria-pressed', String(TOUR !== null));
  ui.tour.setAttribute('aria-label', TOUR === null ? 'Play the breakdown through' : 'Stop the play-through');
}
// show a layer; if the clock is outside the part that layer lives in, go to its start behind a dip to black
function show(id, rawIndex = 0, from = null) {
  const L = layerOf(id), raw = L.raws ? L.raws[rawIndex] : null;
  const apply = () => { VIEW.layer = id; VIEW.raw = raw ? raw[1] : 0; VIEW.rawGain = raw ? raw[2] : 1; };
  const start = from ?? L.from;
  if (from !== null || T < L.from - 0.05 || T >= L.to - 0.1) cut(() => { apply(); jump(start); paint(); });
  else { apply(); beats(T); paint(); }
}
function stopTour() { if (TOUR !== null) { TOUR = null; paint(); } }
function tourStep(i) {
  TOUR = i % TOUR_STEPS.length;
  const st = TOUR_STEPS[TOUR], L = layerOf(st.layer);
  const rawIndex = st.raw ? L.raws.findIndex((r) => r[1] === st.raw) : 0;
  const id = st.layer, raw = L.raws ? L.raws[rawIndex] : null;
  cut(() => { VIEW.layer = id; VIEW.raw = raw ? raw[1] : 0; VIEW.rawGain = raw ? raw[2] : 1; jump(st.from ?? L.from); paint(); });
  paint();
}
// the breakdown is one slim strip above the controls: a chip per layer, the fire's other views beside its chip
// when it is picked, a play-through button, and a small pop-up (closed by default) that says how the layer is made
for (const L of LAYERS) {
  const chip = document.createElement('button');
  chip.dataset.layer = L.id;
  chip.setAttribute('aria-label', L.name);
  chip.innerHTML = `<i class="sw sw-${L.id}"></i><span></span>`;
  chip.lastChild.textContent = L.chip;
  chip.addEventListener('click', () => { stopTour(); show(L.id); });
  ui.stack.append(chip);
  if (L.raws) {
    const raws = document.createElement('span');
    raws.className = 'raws'; raws.dataset.of = L.id; raws.hidden = true;
    L.raws.forEach((r, i) => {
      const c = document.createElement('button');
      c.textContent = r[0]; c.dataset.raw = String(r[1]);
      c.addEventListener('click', () => { stopTour(); show(L.id, i); });
      raws.append(c);
    });
    ui.stack.append(raws);
  }
}
const openAbout = (open) => { ui.how.hidden = !open; ui.about.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('about', open); };
ui.about.addEventListener('click', () => openAbout(ui.how.hidden));
const openPanel = (open) => {
  ui.panel.hidden = !open;
  document.body.classList.toggle('breakdown', open);
  ui.layers.dataset.on = open ? '1' : '0';
  ui.layers.setAttribute('aria-expanded', String(open));
  stripGoal = open ? 1 : 0;                                  // the camera glides up a little so the seal stays clear of the strip
  if (!open) { stopTour(); openAbout(false); if (VIEW.layer !== 'all') show('all'); }
};
ui.layers.addEventListener('click', () => openPanel(ui.panel.hidden));
ui.tour.addEventListener('click', () => { if (TOUR === null) { setPlay(true); tourStep(0); } else stopTour(); });
ui.again.addEventListener('click', () => {
  stopTour();
  if (VIEW.layer === 'all') { SEEK.on = false; VIEW.live = true; restart(); } else cut(() => jump(layerOf(VIEW.layer).from));
  setPlay(true);
});
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('button, input')) return;       // those keep their own keys
  if (e.code === 'Space') { e.preventDefault(); setPlay(!RUN.playing); }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); seek((SEEK.on ? SEEK.t : T) + (e.code === 'ArrowLeft' ? -0.1 : 0.1)); }
});
paint();

let last = 0, acc = 0, beatShown = -1;
// dev timer: __fx.prof.on = true records [clock, ms from the start of a frame until the GPU has finished it]
const prof = { on: false, rec: [] };
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  const p0 = prof.on ? performance.now() : 0;
  if (stripK !== stripGoal && !inspecting) { stripK = stripGoal > stripK ? Math.min(stripGoal, stripK + dt / 0.45) : Math.max(stripGoal, stripK - dt / 0.45); placeCamera(); }
  cutStep(now);
  if (SEEK.on && CUT.phase !== 1) {
    // The handle's time shows at once for everything that is a plain function of the clock. The fire is
    // rebuilt from its last clean start, a few steps a frame, as soon as the handle rests.
    const resting = !SEEK.dragging || performance.now() - SEEK.moved > 90;
    if (resting) {
      rewind(SEEK.t);
      const n = Math.round((SEEK.t - T) * 60);
      if (n > 0) advance(Math.min(n, 8), 1);
    }
    VIEW.live = resting;
    beats(SEEK.t);
    if (resting && !SEEK.dragging && Math.round((SEEK.t - T) * 60) <= 0) { SEEK.on = false; acc = 0; }
  } else if (dt > 1e-5 && RUN.playing && CUT.phase !== 1 && canvas.clientWidth > 8) {
    acc = Math.min(acc + dt * 60, 3);
    while (acc >= 1) { advance(1, RUN.speed); acc -= 1; }
    // the end of what is showing: the whole spell loops on its own dip to dark; one layer loops behind a quick one
    if (T >= windowNow().to) {
      if (TOUR !== null) tourStep(TOUR + 1);
      else if (VIEW.layer === 'all') restart();
      else cut(() => jump(layerOf(VIEW.layer).from));
    }
  }
  const shown = SEEK.on ? SEEK.t : T, part = sat(shown / B.end);
  ui.fill.style.transform = `scaleX(${part})`;
  ui.track.style.setProperty('--p', String(part));
  if (!SEEK.dragging) ui.scrub.value = String(shown);
  let k = 0;
  for (let i = 0; i < BEATS.length; i++) if (shown >= BEATS[i][0] - 1e-3) k = i;
  if (k !== beatShown) { beatShown = k; ui.beat.lastElementChild.textContent = BEATS[k][1]; }
  ui.beat.firstElementChild.textContent = `${shown.toFixed(1)} s`;
  if (audio) audio.sync(T, RUN.playing && !SEEK.on && CUT.phase !== 1, RUN.speed);
  draw();
  if (prof.on) { const at = T; renderer.backend.device.queue.onSubmittedWorkDone().then(() => prof.rec.push([at, performance.now() - p0])); }
}

window.__fx = {
  prof, audio,
  THREE, cast, SEAL, GOLEM, CHEST, arcs, liftLight, LIFT, LAND, liftAt,
  ready: false, sim, volume, camera, renderer, scene, fireLight, runeLight, courtLight, keyLight, furnaceLight, moon, K, B, RUN, GLOW, CAM, rune, ribbons, sparks, floor, bolt, lamps, court,
  get T() { return T; },
  restart,
  // look at one character in one clip pose, in plain light; view is in the character's own frame
  inspect(who, clip, t, view = [0, 1.0, 4.2, 0, 0.95, 0]) {
    inspecting = true;
    const ch = cast[who];
    ch.track = [{ clip, at: 0, from: t, speed: 0 }];
    cast.pose(ch, 0);
    moon.intensity = 1.2; hemi.intensity = 2.0; scene.environmentIntensity = 2;
    exposure = 1.1; VIEW.fade = 1;                              // the clock's dip to dark at 0 s must not black out the viewer
    if (!this._key) { this._key = new THREE.DirectionalLight(0xfff4e6, 2.6); scene.add(this._key, this._key.target); }
    const o = ch.holder.position, ang = ch.holder.rotation.y, cs = Math.cos(ang), sn = Math.sin(ang);
    const rot = (x, y, z) => new THREE.Vector3(o.x + x * cs + z * sn, y, o.z - x * sn + z * cs);
    CAM.pos.copy(rot(view[0], view[1], view[2])); CAM.look.copy(rot(view[3], view[4], view[5]));
    this._key.position.copy(rot(view[0] + 1.5, view[1] + 2.5, view[2])); this._key.target.position.copy(CAM.look);
    return Object.keys(ch.actions).map((k) => k + ':' + ch.actions[k].duration.toFixed(2));
  },
  runTo(t, speed = 1) { let n = 0; while (T < t - 1e-6 && n++ < 9000) advance(1, speed); return T; },
  draw,
  async settle() { for (let i = 0; i < 2; i++) { draw(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); } },
  // for captures: pick a layer (and a raw view of the fire), or go to a time the way the time bar does
  layer(id, raw = 0) { const L = layerOf(id), r = L.raws ? L.raws.find((x) => x[1] === raw) : null; VIEW.layer = id; VIEW.raw = r ? r[1] : 0; VIEW.rawGain = r ? r[2] : 1; beats(T); return VIEW; },
  jump, seek, show, VIEW, LAYERS,
  get state() { return { T: +T.toFixed(3), layer: VIEW.layer, raw: VIEW.raw, tour: TOUR, seeking: SEEK.on, cut: CUT.phase, fade: +VIEW.fade.toFixed(2), live: VIEW.live, playing: RUN.playing }; },
};

restart();
draw();
window.__fx.ready = true;
document.body.classList.add('ready');
$('year').textContent = String(new Date().getFullYear());
// The Techartist loader ends on Enter (that click is what lets the browser play sound) or "Enter without sound".
// The spell starts from the beginning the moment the visitor enters. The tools (?manual, ?film) skip the loader.
const enter = (withSound) => {
  restart(); setPlay(true);
  if (withSound && audio && !audio.on) audio.enable().then(() => { ui.sound.dataset.on = audio.on ? '1' : '0'; ui.sound.setAttribute('aria-label', audio.on ? 'Turn sound off' : 'Turn sound on'); });
  if (q.has('breakdown') || q.has('tour')) openPanel(true);
  if (q.has('tour')) tourStep(0);
};
if (manual || q.has('film')) { $('ta-loader')?.remove(); enter(false); }
else { setPlay(false); loader.ready(enter); }
if (!manual) renderer.setAnimationLoop(frame);
