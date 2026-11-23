// Render the piece's sound track under node, write it out and measure it (I cannot listen, so numbers
// and a picture of the sound stand in for ears).
//   node tools/sound.mjs <out.wav> [--cues] [--pic]
// Prints: time to render, peak, loudness per half second, how bursty the low band is (a bed or drone
// shows as a floor that never drops), and how much sits above 6 kHz (hiss).
import { renderTrack, SR } from '../src/sound.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const out = args[0];
const t0 = performance.now();
const { L, R, cues, seconds } = renderTrack();
const ms = performance.now() - t0;
const n = L.length;

if (out) {
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4); }
  fs.writeFileSync(out, buf);
}

const db = (x) => (20 * Math.log10(Math.max(x, 1e-7))).toFixed(1);
const mono = new Float32Array(n);
let pk = 0, bad = 0;
for (let i = 0; i < n; i++) { mono[i] = (L[i] + R[i]) / 2; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) bad++; }
const rmsOf = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
// one-pole pairs are enough to split low / high for these checks
const onePole = (x, fc, high) => { const k = 1 - Math.exp(-2 * Math.PI * fc / SR), y = new Float32Array(x.length); let a = 0, b = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - a) * k; b += (a - b) * k; y[i] = high ? x[i] - b : b; } return y; };
const low = onePole(mono, 200, false), high = onePole(onePole(mono, 6000, true), 6000, true);
const win = Math.round(0.05 * SR);
const frames = (x) => { const o = []; for (let i = 0; i + win <= n; i += win) o.push(rmsOf(x, i, i + win)); return o; };
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
const fl = frames(low), fh = frames(high), fa = frames(mono);

console.log(`rendered ${seconds} s in ${ms.toFixed(0)} ms · peak ${db(pk)} dBFS · whole-track level ${db(rmsOf(mono, 0, n))} dBFS · bad samples ${bad}`);
console.log(`low band (under 200 Hz), 50 ms frames: quiet tenth ${db(pct(fl, 0.1))} dB, loud tenth ${db(pct(fl, 0.9))} dB, ratio ${(pct(fl, 0.1) / pct(fl, 0.9)).toFixed(3)} (a bed shows as a ratio near 1; want well under 0.2)`);
console.log(`above 6 kHz: quiet tenth ${db(pct(fh, 0.1))} dB, median ${db(pct(fh, 0.5))} dB, loud tenth ${db(pct(fh, 0.9))} dB · full band median ${db(pct(fa, 0.5))} dB`);
console.log(`share of 50 ms frames quieter than -60 dB: ${(fa.filter((v) => v < 0.001).length / fa.length * 100).toFixed(0)} %`);
const half = Math.round(0.5 * SR);
let line = 'level per half second (dBFS): ';
for (let i = 0; i + half <= n; i += half) line += `${(i / SR).toFixed(1)}:${db(rmsOf(mono, i, i + half))} `;
console.log(line);
let lr = 'left minus right per second (dB):  ';
for (let i = 0; i + SR <= n; i += SR) lr += `${(i / SR).toFixed(0)}:${(20 * Math.log10((rmsOf(L, i, i + SR) + 1e-7) / (rmsOf(R, i, i + SR) + 1e-7))).toFixed(1)} `;
console.log(lr);
if (args.includes('--cues')) for (const [t, name] of cues) console.log(`  ${t.toFixed(2).padStart(6)}  ${name}`);
if (args.includes('--pic') && out) {
  const ff = process.env.FFMPEG || `${process.env.HOME}/.local/bin/ffmpeg`;
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', out, '-lavfi', 'showspectrumpic=s=1700x620:legend=1:scale=log:fscale=log:start=30:stop=16000:color=magma:drange=85', out.replace(/\.wav$/, '-spectrum.png')]);
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', out, '-lavfi', 'showwavespic=s=1700x300:split_channels=1:colors=#ffb45a|#6fa8ff', out.replace(/\.wav$/, '-wave.png')]);
  console.log('pictures written next to the wav');
}
