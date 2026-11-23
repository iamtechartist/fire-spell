// Headless look at the built page on the real GPU, stepped on the app's own clock (no dev server).
//   node tools/look.mjs <outdir> --t 0.55,0.7,1,1.5 [--w 1280 --h 720] [--q "cam=wide"] [--js "code"] [--sheet 4]
// Writes one PNG per time and, with --sheet N, a contact sheet N frames wide.
// the capture toolkit sits beside the project folder (Documents/Claude/toolkit)
import { launch } from '../../toolkit/capture/browser.mjs';
import { serveDir } from '../../toolkit/capture/route-serve.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(args[0]);
const times = opt('--t', '0.6,0.8,1.2,2').split(',').map(Number);
const w = Number(opt('--w', 1280)), h = Number(opt('--h', 720)), dpr = Number(opt('--dpr', 1));
const sheet = Number(opt('--sheet', 0));
const query = opt('--q', '');
const js = opt('--js', null);
fs.mkdirSync(out, { recursive: true });

const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist');
const { browser, page, logs } = await launch({ width: w, height: h, dpr });
await serveDir(page, dist, 'http://localhost:5999');
await page.goto(`http://localhost:5999/index.html?manual${query ? '&' + query : ''}`);
try {
  await page.waitForFunction('window.__fx && window.__fx.ready', null, { timeout: 30000 });
} catch (e) {
  console.log('NOT READY\n' + logs.slice(0, 30).join('\n').slice(0, 6000));
  await browser.close();
  process.exit(1);
}
if (js) { const r = await page.evaluate(js); if (r !== undefined) console.log('js ->', JSON.stringify(r)); }
const files = [];
const t0 = Date.now();
// --poses "mage:Clip:0,0.3,0.6" [--view "x,y,z,lx,ly,lz"]: one frame per clip time, in plain light
const poses = opt('--poses', null);
if (poses) {
  const [who, clip, list] = poses.split(':');
  const view = opt('--view', null);
  for (const ct of list.split(',').map(Number)) {
    const r = await page.evaluate(`(async () => { const r = __fx.inspect('${who}', '${clip}', ${ct}${view ? ', [' + view + ']' : ''}); await __fx.settle(); return r; })()`);
    if (!files.length) console.log(r.join(' '));
    const f = path.join(out, `${clip}_${ct.toFixed(2).padStart(5, '0')}.png`);
    await page.screenshot({ path: f });
    files.push(f);
  }
}
for (const t of poses ? [] : times) {
  await page.evaluate(`(async () => { __fx.runTo(${t}); await __fx.settle(); })()`);
  const f = path.join(out, `t_${t.toFixed(2).padStart(6, '0')}.png`);
  await page.screenshot({ path: f });
  files.push(f);
}
console.log(`${times.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const errs = logs.filter((l) => /error|warn/i.test(l));
if (errs.length) console.log([...new Set(errs)].slice(0, 14).join('\n').slice(0, 5000));
await browser.close();

if (sheet) {
  const rows = Math.ceil(files.length / sheet);
  const tw = Math.round(1920 / sheet), th = Math.round(tw * h / w);
  const list = path.join(out, 'list.txt');
  fs.writeFileSync(list, files.map((f) => `file '${f}'\nduration 1`).join('\n'));
  execFileSync(process.env.FFMPEG || `${process.env.HOME}/.local/bin/ffmpeg`, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `scale=${tw}:${th},tile=${sheet}x${rows}`, '-frames:v', '1', '-update', '1', path.join(out, 'sheet.jpg')]);
  console.log('sheet', path.join(out, 'sheet.jpg'));
}
