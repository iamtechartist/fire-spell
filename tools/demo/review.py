# Look at a finished film properly before it goes out: every sixth of a second of the whole frame as
# sheets, and close crops of chosen spans at the film's full frame rate (flicker and shiver only show there).
#   python3 tools/demo/review.py film.mp4 outdir [name:t0:t1:x:y:w:h ...]
# Sheets: outdir/all-N.jpg (6 frames a second, 8 across) and outdir/<name>.jpg (every frame, 12 across).
import os, subprocess, sys

FF = os.path.expanduser('~/.local/bin/ffmpeg')
film, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
dur = float(subprocess.run([FF, '-hide_banner', '-i', film], capture_output=True, text=True).stderr.split('Duration: ')[1].split(',')[0].split(':')[-1]) \
    + 60 * float(subprocess.run([FF, '-hide_banner', '-i', film], capture_output=True, text=True).stderr.split('Duration: ')[1].split(',')[0].split(':')[1])
run = lambda args: subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y'] + args, check=True)
# the whole frame, six a second, 48 to a sheet
n, per = int(dur * 6), 48
for s in range(0, n, per):
    t0 = s / 6
    run(['-ss', f'{t0:.3f}', '-t', f'{per / 6:.3f}', '-i', film, '-vf', 'fps=6,scale=480:-1,tile=8x6', '-frames:v', '1', '-q:v', '3', f'{out}/all-{s // per + 1}.jpg'])
# close crops, every frame
for spec in sys.argv[3:]:
    name, t0, t1, x, y, w, h = spec.split(':')
    t0, t1 = float(t0), float(t1)
    frames = round((t1 - t0) * 60)
    rows = -(-frames // 12)
    tw = 190
    run(['-ss', f'{t0:.3f}', '-t', f'{t1 - t0:.3f}', '-i', film, '-vf', f'crop={w}:{h}:{x}:{y},scale={tw}:-1,tile=12x{rows}', '-frames:v', '1', '-q:v', '3', f'{out}/{name}.jpg'])
print(f'{dur:.2f} s film; sheets in {out}')
