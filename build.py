#!/usr/bin/env python3
"""Assemble src/head.html + src/*.js into a single self-contained index.html + syntax gate."""
import re, subprocess, json, sys, os, tempfile
from pathlib import Path

BASE = Path('/opt/data/policy-islands')
SRC = BASE / 'src'
ORDER = ['00-imports.js', '01-data.js', '02-scene.js', '03-terrain.js',
         '04-buildings.js', '05-walkers.js', '06-select.js', '07-ui.js', '08-boot.js', '09-net.js']

js = '\n'.join((SRC / f).read_text(encoding='utf-8') for f in ORDER)
head = (SRC / 'head.html').read_text(encoding='utf-8')
out = head + '<script type="module">\n' + js + '\n</script>\n</body>\n</html>\n'
(BASE / 'index.html').write_text(out, encoding='utf-8')

# ---- syntax gate (P35/P47: classify blocks by content, not position) ----
assert out.count('<script') == out.count('</script>'), 'unbalanced script tags'
inline = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', out, re.DOTALL)
assert inline, 'no inline script blocks'
checked = 0
for i, blk in enumerate(inline):
    s = blk.lstrip()
    if s.startswith('{') and '"imports"' in blk[:300]:
        json.loads(blk)
        print(f'  block {i}: importmap JSON OK')
        continue
    Path('/tmp/_chk.mjs').write_text(blk, encoding='utf-8')
    r = subprocess.run(['node', '--check', '/tmp/_chk.mjs'], capture_output=True, text=True)
    if r.returncode != 0:
        print(f'  block {i}: SYNTAX ERROR\n{r.stderr[:4000]}')
        sys.exit(1)
    print(f'  block {i}: node --check OK ({len(blk)} chars)')
    checked += 1
assert checked, 'no JS block was actually checked'
print(f'ASSEMBLED {len(out)} bytes | {checked} JS blocks OK')

# ---- Worker static assets (dist/ is the Worker assets.directory) ----
DIST = BASE / 'dist'
DIST.mkdir(exist_ok=True)
(DIST / 'index.html').write_text(out, encoding='utf-8')
print(f'DIST {len(out)} bytes -> dist/index.html')

# seed.sql 由 migrations/0002_seed.sql 複製 → WorldRoom 透過 ASSETS binding 讀取
SEED_SRC = BASE / 'migrations' / '0002_seed.sql'
if SEED_SRC.exists():
    seed_sql = SEED_SRC.read_text(encoding='utf-8')
    (DIST / 'seed.sql').write_text(seed_sql, encoding='utf-8')
    print(f'DIST seed.sql {len(seed_sql)} bytes -> dist/seed.sql')
else:
    print('  seed: MISSING migrations/0002_seed.sql (run: node scripts/gen-seed.mjs)')

# ---- Worker entry syntax gate ----
WORKER = SRC / 'worker' / 'index.js'
if not WORKER.exists():
    print(f'  worker: MISSING {WORKER}')
    sys.exit(1)
fd, tmp_name = tempfile.mkstemp(suffix='.mjs')
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as fh:
        fh.write(WORKER.read_text(encoding='utf-8'))
    r = subprocess.run(['node', '--check', tmp_name], capture_output=True, text=True)
    if r.returncode != 0:
        print(f'  worker: SYNTAX ERROR\n{r.stderr[:4000]}')
        sys.exit(1)
finally:
    os.unlink(tmp_name)
print('WORKER node --check OK')

# ---- WorldRoom (Durable Object) syntax gate ----
ROOM = SRC / 'worker' / 'world-room.js'
if ROOM.exists():
    fd, tmp_name = tempfile.mkstemp(suffix='.mjs')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            fh.write(ROOM.read_text(encoding='utf-8'))
        r = subprocess.run(['node', '--check', tmp_name], capture_output=True, text=True)
        if r.returncode != 0:
            print(f'  world-room: SYNTAX ERROR\n{r.stderr[:4000]}')
            sys.exit(1)
    finally:
        os.unlink(tmp_name)
    print('WORLD-ROOM node --check OK')
