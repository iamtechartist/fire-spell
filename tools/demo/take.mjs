// The demo film: one continuous take of the built page with its own sound, driven by a visible cursor.
// The whole spell plays first, the court lighting up as it goes, from the fist on the stone to the golem's
// roar; then the cursor opens the breakdown and picks Seal, Crescents, Fire, the heat cut and Light in turn,
// and closes it for the last two seconds and the spell's own fade.
//   npx vite build && node tools/demo/take.mjs        -> demo/takes/demo.{mp4,wav,json} and demo/cut.json
//   node ../toolkit/capture/assemble.mjs demo/cut.json -> demo/fire-spell-demo.mp4
// Frames are 1920x1080 (a 1600x900 window at 1.2), 60 a second, on the page's own clock (no dropped frames).
import { captureSegment } from '../../../toolkit/capture/capture.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DIST = path.join(ROOT, 'dist'), OUT = path.join(ROOT, 'demo/takes/demo');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname), file = path.join(DIST, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(5996, '127.0.0.1');

const FPS = 60, START = 1.9, PREROLL = 0.3, SECONDS = 21.5;   // the clock reaches about START - 0.25 on the first recorded frame: just before her fist lands
// what the cursor does, in order. `at`: the clock time of the click while `layer` (and `raw`) is showing.
const STEPS = (B) => [
  { layer: 'all', at: B.hit + 2.75, sel: '#layers' },                            // the spell is done and the court is lit: open the breakdown
  { layer: 'all', at: B.hit + 3.2, sel: '#stack [data-layer="seal"]' },          // the seal alone: past its own part of the clock, so it starts over at once
  { layer: 'seal', at: 4.0, sel: '#stack [data-layer="crescents"]' },
  { layer: 'crescents', at: B.release - 0.2, sel: '#stack [data-layer="fire"]' },          // the fire alone, in time for the blast
  { layer: 'fire', raw: 0, at: B.hit + 0.62, sel: '#stack .raws button[data-raw="2"]' },   // cut it open: heat, as the fireball rolls up
  { layer: 'fire', raw: 2, at: B.hit + 1.25, sel: '#stack [data-layer="light"]' },
  { layer: 'light', at: B.hit + 2.6, sel: '#layers' },                           // close it: everything together to the end
];
const ease = (u) => u * u * u * (10 - 15 * u + 6 * u * u);

const CURSOR = `(() => {
  const ARROW = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 2.5v18.2l4.6-4.3 3.1 7.1 3.1-1.4-3.1-6.9h6.4z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const POINT = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M10.4 14.2V4.6c0-1.6 2.7-1.6 2.7 0v7.6-.9c0-1.5 2.7-1.5 2.7 0v1.1-.6c0-1.5 2.7-1.5 2.7 0v1 .2c0-1.4 2.6-1.4 2.6.1v5.3c0 3.5-2.4 5.9-5.6 5.9h-1.2c-2.3 0-3.6-.9-4.8-2.6l-3.3-4.8c-.8-1.2.6-2.6 1.8-1.6z" fill="#fff" stroke="#111" stroke-width="1.25" stroke-linejoin="round"/></svg>';
  let cur = null, shapeNow = '';
  window.__cursor = (x, y) => {
    if (!cur) {
      cur = document.createElement('div');
      Object.assign(cur.style, { position: 'fixed', left: '0', top: '0', zIndex: '99999', pointerEvents: 'none', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.55))', transformOrigin: '0 0' });
      document.documentElement.appendChild(cur);
    }
    const inside = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
    const el = inside ? document.elementFromPoint(x, y) : null, cs = el ? getComputedStyle(el).cursor : 'auto';
    const shape = !inside ? 'none' : cs === 'pointer' || cs === 'ew-resize' ? 'pointer' : 'arrow';
    if (shape !== shapeNow) { shapeNow = shape; cur.innerHTML = shape === 'arrow' ? ARROW : shape === 'pointer' ? POINT : ''; }
    const off = shape === 'arrow' ? [-4, -2.5] : [-11.7, -3.4];
    cur.style.display = shape === 'none' ? 'none' : 'block';
    cur.style.transform = 'translate(' + (x + off[0] * 1.3).toFixed(2) + 'px,' + (y + off[1] * 1.3).toFixed(2) + 'px) scale(1.3)';
  };
})(); 0`;

let steps = null, k = 0, phase = 'wait', move = null, pos = [1420, 915], pressAt = -1, endFrame = null, endClock = 0;
const log = [];
const meta = await captureSegment({
  url: 'http://127.0.0.1:5996/index.html?film',
  out: OUT, width: 1600, height: 900, dpr: 1.2, fps: FPS, seed: 5,
  audioSeconds: 60, liveAudio: true, preroll: PREROLL, seconds: SECONDS,
  ready: async (page) => {
    await page.waitForFunction('window.__fx && window.__fx.ready', null, { timeout: 60000 });
    await page.waitForTimeout(800);
    await page.click('#sound');
    await page.waitForFunction('window.__fx.audio.on', null, { timeout: 30000 });
    await page.mouse.move(1420, 899);
    steps = STEPS(await page.evaluate('__fx.B'));
    endClock = (await page.evaluate('__fx.B.end')) - 0.06;
  },
  setup: async (page) => {
    await page.evaluate(CURSOR);
    await page.evaluate(`__fx.jump(${START - PREROLL}); __cursor(${pos[0]}, ${pos[1]}); 0`);
  },
  onFrame: async (page, i) => {
    // where the cursor is this frame
    if (move) {
      const u = Math.min(1, (i - move.f0) / move.n), e = ease(u);
      const dx = move.to[0] - move.from[0], dy = move.to[1] - move.from[1], len = Math.hypot(dx, dy) || 1, b = Math.sin(Math.PI * e) * move.bow;
      pos = [move.from[0] + dx * e - (dy / len) * b, move.from[1] + dy * e + (dx / len) * b];
      await page.mouse.move(Math.min(1599, Math.max(0, pos[0])), Math.min(899, Math.max(0, pos[1])));
      if (u >= 1) move = null;
    }
    const s = await page.evaluate(([x, y]) => { __cursor(x, y); return __fx.state; }, pos);
    const st = steps[k];
    if (st) {
      const showing = s.layer === st.layer && (st.raw === undefined || s.raw === st.raw) && s.cut === 0;
      if (phase === 'wait' && showing && s.T >= st.at - 0.55) {
        const r = await page.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, st.sel);
        const dist = Math.hypot(r[0] - pos[0], r[1] - pos[1]);
        move = { f0: i, n: Math.round(FPS * Math.min(0.5, 0.2 + dist / 1400)), from: pos, to: [r[0] + 2, r[1] + 3], bow: dist > 200 ? 14 : 3 };
        phase = 'move';
      } else if (phase === 'move' && !move && showing && s.T >= st.at) {
        await page.mouse.down(); pressAt = i; phase = 'press';
      } else if (phase === 'press' && i - pressAt >= 5) {
        await page.mouse.up();
        log.push(`  click ${k + 1} ${st.sel} at film ${(i / FPS).toFixed(2)} s, clock ${s.T.toFixed(2)}`);
        k++; phase = 'wait';
        if (k === steps.length) move = { f0: i + 14, n: 34, from: pos, to: [pos[0] + 150, 918], bow: -10 };   // done: the cursor leaves
      }
    } else if (endFrame === null && s.layer === 'all' && s.T >= endClock) endFrame = i;
    if (i % 120 === 0) console.log(`    f${i} film ${(i / FPS).toFixed(1)} s  clock ${s.T.toFixed(2)}  ${s.layer}${s.raw ? '/' + s.raw : ''}  step ${k}/${steps.length} ${phase}`);
  },
});
server.close();
console.log(log.join('\n'));
if (endFrame === null) { console.log('THE TAKE RAN OUT BEFORE THE SPELL ENDED: raise SECONDS'); process.exit(1); }
const to = +(endFrame / FPS).toFixed(4);
fs.writeFileSync(path.join(ROOT, 'demo/cut.json'), JSON.stringify({ out: 'fire-spell-demo.mp4', fps: FPS, crf: 17, lufs: -16, limit: -2, cuts: [{ take: 'takes/demo', from: 0, to }] }, null, 1));
console.log(`take done: ${to} s to the end of the spell, ${meta.errors.length} console errors; cut list written to demo/cut.json`);
