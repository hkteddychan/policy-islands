#!/usr/bin/env python3
"""Assemble src/head.html + src/*.js into a single self-contained index.html + syntax gate."""
import re, subprocess, json, sys
from pathlib import Path

BASE = Path('/opt/data/policy-islands')
SRC = BASE / 'src'
ORDER = ['00-imports.js', '01-data.js', '02-scene.js', '03-terrain.js',
         '04-buildings.js', '05-walkers.js', '06-select.js', '07-ui.js', '08-boot.js']

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
