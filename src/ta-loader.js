// Techartist loader control (toolkit/brand). The markup and CSS are inlined in index.html (loader-head.html in <head>,
// loader-body.html first in <body>), so this only drives it: progress(0..1), message(text), done().
const el = () => document.getElementById('ta-loader');
export const loader = {
  progress(p) { const e = el(); if (!e) return; const v = Math.max(0, Math.min(1, p)); e.classList.remove('ta-wait'); e.style.setProperty('--ta-p', v.toFixed(3)); const n = e.querySelector('.ta-pct'); if (n) n.textContent = Math.round(v * 100) + '%'; },
  message(text) { const m = document.getElementById('loadMsg'); if (m) m.textContent = text; },
  // fade out; the loader takes no clicks while fading (a fading loader that keeps pointer-events swallows the first click)
  done() { const e = el(); if (!e) return; e.style.setProperty('--ta-p', '1'); e.classList.add('ta-done'); setTimeout(() => e.remove(), 1200); },
  // Enter gate (demos with sound): show Enter + "Enter without sound"; the click is the gesture that unlocks audio.
  // onEnter(withSound) runs inside the click, then the loader fades. ?skip in the URL enters at once, muted (tests);
  // ?skip&sound enters with sound (offline audio captures, where no gesture is needed).
  ready(onEnter) {
    const e = el(); if (!e) { onEnter(false); return; }
    const go = (withSound) => { removeEventListener('keydown', key); try { onEnter(withSound); } finally { loader.done(); } };
    const key = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(true); } };
    if (/[?&]skip\b/.test(location.search) || !e.querySelector('.ta-enter')) { go(/[?&]sound\b/.test(location.search)); return; }
    e.style.setProperty('--ta-p', '1'); e.classList.remove('ta-wait'); e.classList.add('ta-ready');
    e.querySelector('.ta-enter').addEventListener('click', () => go(true), { once: true });
    e.querySelector('.ta-quiet').addEventListener('click', () => go(false), { once: true });
    addEventListener('keydown', key);
    e.querySelector('.ta-enter').focus({ preventScroll: true });
  },
};
