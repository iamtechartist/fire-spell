// Drive the built page in real time with real clicks and a real mouse drag (sound muted) and report what
// happened: the breakdown strip, picking layers, the time bar, the sound's lock to the clock, frame times.
//   node tools/drive.mjs [width height dpr] [--tour] [--shots dir]
import { launch } from '../../toolkit/capture/browser.mjs';
import { serveDir } from '../../toolkit/capture/route-serve.mjs';
import path from 'node:path';
import fs from 'node:fs';

const nums = process.argv.slice(2).filter((a) => /^[\d.]+$/.test(a)).map(Number);
const [w, h, dpr] = [nums[0] || 1280, nums[1] || 720, nums[2] || 1];
const tour = process.argv.includes('--tour');
const si = process.argv.indexOf('--shots'), shots = si > 0 ? path.resolve(process.argv[si + 1]) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist');
const { browser, page, logs } = await launch({ width: w, height: h, dpr, args: ['--mute-audio'] });
await serveDir(page, dist, 'http://localhost:5999');
await page.goto('http://localhost:5999/index.html?skip');           // ?skip: the loader enters at once, muted
await page.waitForFunction('window.__fx && window.__fx.ready', null, { timeout: 30000 });
const st = () => page.evaluate('__fx.state');
const settle = () => page.waitForFunction('!__fx.state.seeking && __fx.state.cut === 0', null, { timeout: 8000 });
const log = (k, v) => console.log(k.padEnd(28), JSON.stringify(v));
const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
const setBar = (t) => page.evaluate(`(() => { const s = document.getElementById('scrub'); s.value = '${t}'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const B = await page.evaluate('__fx.B');

// sound: on by a real click, then one whole loop against the clock
await page.click('#sound');
await page.waitForFunction('window.__fx.audio.on', null, { timeout: 15000 });
const snd = await page.evaluate(`(async () => {
  __fx.restart();
  const rec = []; const t0 = performance.now();
  await new Promise(r => { (function f(){ const p = __fx.audio.probe(); rec.push([__fx.T, p.at, p.level, p.starts]); (performance.now() - t0 < ${(B.end + 1.2) * 1000}) ? requestAnimationFrame(f) : r(); })(); });
  const first = rec.findIndex(x => x[0] > 0.3), loop = rec.findIndex((x, i) => i > 10 && x[0] < rec[i - 1][0]);
  const one = rec.slice(first, loop > 0 ? loop : rec.length), drift = one.map(x => x[1] - x[0]);
  const loud = one.reduce((a, x) => x[2] > a[2] ? x : a, [0, 0, 0]);
  return { driftMs: [Math.round(Math.min(...drift) * 1000), Math.round(Math.max(...drift) * 1000)], restartsInOneLoop: one.at(-1)[3] - one[0][3], loudestAtClock: +loud[0].toFixed(2), blastAt: __fx.B.hit };
})()`);
log('sound against the clock', snd);
await page.click('#sound');

// the strip
await page.click('#layers'); await page.waitForTimeout(700);
const box = await page.locator('#panel').boundingBox();
log('strip', { w: Math.round(box.width), h: Math.round(box.height), window: [w, h], chips: await page.locator('#stack [data-layer]').count() });
await shot('1-strip');
await page.click('#stack [data-layer="seal"]'); await settle(); await page.waitForTimeout(900);
log('seal picked', await st()); await shot('2-seal');
await page.click('#play');
await setBar(5.9); await settle(); log('bar to 5.9, paused', await st()); await shot('3-seal-arcs');
await setBar(2.6); await settle(); log('bar back to 2.6', await st());
await page.click('#stack [data-layer="fire"]'); await settle();
await setBar(B.hit + 0.35); await settle(); log('fire just after the blast', await st()); await shot('4-fire');
await page.click('#stack .raws button:nth-child(2)'); await page.waitForTimeout(300); log('heat cut', await st()); await shot('5-heat');
await page.click('#stack .raws button:nth-child(4)'); await page.waitForTimeout(300); await setBar(B.hit + 0.1); await settle(); await shot('6-speed');
// a real drag on the bar, backward across the blast
const tb = await page.locator('#track').boundingBox();
const xOf = (t) => tb.x + tb.width * (t / (B.end - 0.02));
await page.mouse.move(xOf(B.hit + 1.0), tb.y + tb.height / 2); await page.mouse.down();
for (let t = B.hit + 1.0; t >= B.hit + 0.2; t -= 0.05) { await page.mouse.move(xOf(t), tb.y + tb.height / 2); await page.waitForTimeout(16); }
const moving = await st(); await page.waitForTimeout(500); const held = await st(); await page.mouse.up(); await settle();
log('drag back: moving / held / released', [moving.live, held.T, (await st()).T]);
await page.click('#about'); await page.waitForTimeout(200); await shot('7-about'); await page.click('#about');
await page.click('#stack [data-layer="light"]'); await settle(); await page.click('#play'); await page.waitForTimeout(1200); log('light, playing', await st()); await shot('8-light');
await page.click('#layers'); await settle(); await page.waitForTimeout(700); log('strip closed', await st());
if (tour) {
  await page.click('#layers'); await page.click('#tour');
  const seen = []; let last = null; const t0 = Date.now();
  while (Date.now() - t0 < 47000) { const s = await st(), key = `${s.tour}:${s.layer}:${s.raw}`; if (key !== last) { seen.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s.layer}${s.raw ? '/' + s.raw : ''}`); last = key; } await page.waitForTimeout(100); }
  log('play-through', seen);
  await page.click('#tour');
}
log('frame times, ms', await page.evaluate(`(async () => { __fx.restart(); const d = []; let l = performance.now(); await new Promise(r => { let n = 0; (function f(){ const now = performance.now(); d.push(now - l); l = now; (++n < 840) ? requestAnimationFrame(f) : r(); })(); }); d.sort((a,b)=>a-b); return { median: +d[420].toFixed(1), p95: +d[798].toFixed(1), worst: +d[839].toFixed(0) }; })()`));
const errs = logs.filter((l) => /error|warn/i.test(l));
console.log(errs.length ? [...new Set(errs)].slice(0, 8).join('\n').slice(0, 2000) : 'no console errors or warnings');
await browser.close();
