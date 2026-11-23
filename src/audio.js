// Plays the rendered sound track locked to the piece's own clock. The track is one buffer as long as
// the loop; every frame the page says where its clock is, and the buffer is restarted from there
// whenever the two disagree (pause, play again, quarter speed, a loop join, a hidden tab coming back).
export function createAudio() {
  let ctx = null, master = null, tap = null, buffer = null, data = null;
  let src = null, gain = null, startedAt = 0, startedOff = 0, rate = 1, on = false, starts = 0;

  const ready = new Promise((resolve) => {
    const here = () => import('./sound.js').then((m) => { const t = m.renderTrack(); data = { sr: t.sr, L: t.L, R: t.R }; resolve(); });
    try {
      const w = new Worker(new URL('./sound-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { data = e.data; w.terminate(); resolve(); };
      w.onerror = () => { w.terminate(); here(); };
    } catch { here(); }
  });

  const stop = () => {
    if (!src) return;
    const s = src, g = gain;
    src = null;
    try { g.gain.setTargetAtTime(0, ctx.currentTime, 0.008); s.stop(ctx.currentTime + 0.06); } catch { /* already stopped */ }
  };
  const start = (T, speed) => {
    stop();
    if (T >= buffer.duration - 0.03) return;
    src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = speed;                      // quarter speed plays the sound slowed too, two octaves down
    gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.012);
    src.connect(gain).connect(master);
    src.start(ctx.currentTime, Math.max(0, T));         // from now on the context's own clock (a film recorder runs that clock itself)
    startedAt = ctx.currentTime; startedOff = Math.max(0, T); rate = speed; starts++;
  };

  return {
    get on() { return on; },
    // must be called from a click: browsers keep sound off until the user asks for it
    async enable() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = 0.9;
        tap = ctx.createAnalyser(); tap.fftSize = 1024;
        master.connect(tap); master.connect(ctx.destination);
      }
      await ctx.resume();
      await ready;
      if (!buffer) { buffer = ctx.createBuffer(2, data.L.length, data.sr); buffer.copyToChannel(data.L, 0); buffer.copyToChannel(data.R, 1); }
      on = true;
    },
    disable() { on = false; stop(); },
    hush: stop,
    // every frame: where the piece's clock is, whether it runs, how fast
    sync(T, playing, speed) {
      if (!on || !buffer) return;
      if (!playing) { stop(); return; }
      const at = startedOff + (ctx.currentTime - startedAt) * rate;
      if (!src || speed !== rate || Math.abs(at - T) > 0.09) start(T, speed);
    },
    // for checks: is it running, where is it, how loud is what goes out right now
    probe() {
      if (!ctx) return { on, state: 'none' };
      const x = new Float32Array(tap.fftSize);
      tap.getFloatTimeDomainData(x);
      let s = 0;
      for (const v of x) s += v * v;
      return { on, state: ctx.state, playing: !!src, at: +(startedOff + (ctx.currentTime - startedAt) * rate).toFixed(3), starts, level: Math.sqrt(s / x.length), seconds: buffer ? buffer.duration : 0 };
    },
  };
}
