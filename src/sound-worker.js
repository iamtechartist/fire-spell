// Renders the sound track off the main thread, so the picture never waits for it.
import { renderTrack } from './sound.js';

const t = renderTrack();
postMessage({ sr: t.sr, L: t.L, R: t.R }, [t.L.buffer, t.R.buffer]);
