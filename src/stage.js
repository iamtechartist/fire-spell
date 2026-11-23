// The piece's fixed facts with no three.js in them: the clock's beats, where things stand, where every
// lamp hangs and when it catches. The picture (main.js, court.js) and the sound (sound.js, and
// tools/sound.mjs under node) both read them from here, so they cannot drift apart.

// seconds on the piece's own clock
// wave: when the first lamp of the court catches. The court lights up all through the spell, not after it.
export const B = { slam: 1.7, draw1: 3.6, heat0: 3.5, heat1: 4.3, spin0: 4.2, release: 6.5, hit: 6.72, wave: 2.4, end: 11.6 };

// The seal lifts the mage before she strikes: off the stone at t0, `h` metres up after `rise` seconds, hovering,
// then down again from `down` over `fall` seconds. liftAt(t) is how far her feet are off the floor.
export const LIFT = { t0: B.spin0 + 0.45, rise: 1.0, h: 1.4, down: B.release + 0.55, fall: 0.85 };
export const LAND = LIFT.down + LIFT.fall;
export function liftAt(t) {
  if (t <= LIFT.t0 || t >= LAND) return 0;
  const u = Math.min(1, (t - LIFT.t0) / LIFT.rise), up = 1 - Math.pow(1 - u, 2.4);          // lifted fast, slowing into the hover
  const bob = 0.05 * Math.sin((t - LIFT.t0) * 4.6) * Math.min(1, Math.max(0, (t - LIFT.t0 - 0.6) / 0.5));
  const kick = t > B.release ? 0.08 * Math.exp(-(t - B.release) * 5) : 0;                   // the bolt pushes back on her
  const d = Math.min(1, Math.max(0, (t - LIFT.down) / LIFT.fall)), down = d * d * (1.6 - 0.6 * d);   // she comes down faster and faster, and lands firmly
  return (LIFT.h * up + bob + kick) * (1 - down);
}

// metres; x right, y up, z toward the viewer
export const PLACE = {
  seal: [-2.7, 0, 0.9],            // the mage's casting stone
  golem: [3.3, 0, -1.3],
  camera: [0.7, 6.4, 11.2],
  look: [0.35, 1.75, -0.3],
};

export const COURT = { steps: [8.26, 9.44, 10.62], rise: 0.18, arcade: 14.12, bays: 37, bayWidth: 2.395 };
export const TERRACE = COURT.rise * 3;
export const BRAZIER_DEG = 76.2;

// Every lamp: a lantern in each bay of the arcade, four posts in the court, the brazier on the far axis.
// `delay` is seconds after B.wave. The court lights up as the spell goes: the posts one by one from the mage's
// side as the seal is written, the arcade lanterns in a sweep round the ring from behind her (both ways, meeting
// at the golem as she strikes), and the brazier from the blast itself.
export function lampLayout(centre = PLACE.seal, golem = PLACE.golem) {
  const ring = (r, deg) => [centre[0] + r * Math.cos(deg * Math.PI / 180), 0, centre[2] - r * Math.sin(deg * Math.PI / 180)];
  const list = [], bays = [], posts = [];
  for (let i = 0; i < COURT.bays; i++) {
    const deg = BRAZIER_DEG + i * 360 / COURT.bays;
    const p = ring(COURT.arcade, deg);
    bays.push({ p, deg });
    list.push({ kind: 'bay', pos: [p[0], TERRACE + 2.53, p[2]], power: 1 });
  }
  for (const [r, deg] of [[7.3, 48], [7.3, 104], [7.4, 150], [7.3, -8]]) {
    const p = ring(r, deg);
    posts.push({ p, deg });
    list.push({ kind: 'post', pos: [p[0], 2.78, p[2]], power: 1.25 });
  }
  const b = ring(12.25, BRAZIER_DEG);
  const brazier = [b[0], TERRACE, b[2]];
  list.push({ kind: 'brazier', pos: [b[0], TERRACE + 2.3, b[2]], power: 7 });
  const toGolem = Math.atan2(-(golem[2] - centre[2]), golem[0] - centre[0]) * 180 / Math.PI;      // the golem's bearing from the seal
  const away = (deg) => { const d = Math.abs(((deg - (toGolem + 180)) % 360 + 540) % 360 - 180); return d; };   // degrees round the ring from the point behind her
  const postAt = [B.spin0 + 1.0, B.heat0, B.slam + 0.9, B.release - 0.4];                        // the posts, in the order they are listed above
  bays.forEach((b, i) => { list[i].delay = B.draw1 + away(b.deg) / 60 - B.wave; });
  posts.forEach((q, i) => { list[COURT.bays + i].delay = postAt[i] - B.wave; });
  list[list.length - 1].delay = B.hit + 0.25 - B.wave;
  return { list, bays, posts, brazier };
}
