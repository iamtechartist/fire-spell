# Fire Spell

**Live: [iamtechartist.github.io/fire-spell](https://iamtechartist.github.io/fire-spell/)** (needs a browser with WebGPU)

An 11.6 second spell in a lamp court at night, drawn live in the browser. A mage writes a seal into the
stone, the seal lifts her into the air with energy crackling under her feet, and one bolt wakes a furnace
golem across the court. The court's lamps catch one after another as she works.

The fire is a fluid simulation running on the graphics card, sixty steps a second; nothing is pre-rendered.
A Breakdown strip shows each layer alone, cuts the simulation open to show heat, smoke, speed and fuel,
and plays the whole thing through. The sound is synthesised in code and locked to the picture.

Needs WebGPU: a current Chrome, Edge or Safari. Built with three.js 0.187.0 and vite.

## Run

    npm install
    npm run dev          # http://127.0.0.1:5891
    npm run build        # static site in dist/
    sh tools/deploy.sh   # build and publish dist/ to the gh-pages branch (GitHub Pages)

Address flags: `?breakdown` opens the strip, `?tour` starts the play-through, `?skip` enters without the
loader (muted), `?film` draws pixel for pixel for a film recorder, `?manual` stops the clock for the tools.

## Where things are

- `src/stage.js` the clock's beats, the places, when each lamp catches, the lift. No three.js in it, so the
  picture and the sound read the same facts.
- `src/main.js` the scene, the beats, the lights, the camera fit, the controls, the breakdown, seeking.
- `src/sim.js`, `src/volume.js` the fire: the simulation, and the ray march that draws it (and the cut-open views).
- `src/floor.js`, `src/rune.js` the wet paving and the seal written into it.
- `src/court.js` the arcade, posts, brazier and lamp light; `blender/make_court_kit.py` builds `public/models/court.glb`.
- `src/cast.js` the mage and the golem; every pose is worked out from the clock, so any moment can be drawn on its own.
- `src/arcs.js` the energy between her feet and the seal; `src/ribbons.js`, `src/sparks.js` the crescents and sparks.
- `src/sound.js` the whole sound track, synthesised; `src/audio.js` plays it locked to the clock.
- `public/models/` the characters and the court kit as web-sized models.

## Tools

These drive the built page in headless Chrome. They use a separate capture toolkit (headless browser,
frame-stepped recorder) that is not part of this repository, so they are here for reference.

    node tools/look.mjs <outdir> --t 5,6.8,9 --sheet 3    # stills of the built page at chosen clock times
    node tools/sound.mjs out.wav --cues --pic              # render the sound track, measure it, draw its spectrum
    node tools/drive.mjs 1024 768 2 --tour                 # real clicks and drags, sound lock, frame times
    node tools/demo/take.mjs                               # record the demo film

## Credits

- Characters made with Meshy from our own concept pictures; the court kit is modelled in Blender by script.
- Floor stone texture: Poly Haven, CC0.
- The fire simulation began from the three.js `webgpu_volume_fire` example (three.js authors, MIT).

## License

MIT, see [LICENSE](LICENSE). © 2026 Techartist.
