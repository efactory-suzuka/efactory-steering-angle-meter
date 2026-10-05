"""Resize the provided gauge logo only; no redrawing or lettering. Requires Pillow."""
from pathlib import Path
import hashlib
import json
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'public' / 'efactory-e-icon.png'
logo = Image.open(source).convert('RGBA')
assert logo.size == (1180, 1180)
output = root / 'public' / 'icons'
output.mkdir(exist_ok=True)
records = []
for name, size, maskable in [
    ('efactory-e-192.png', 192, False),
    ('efactory-e-512.png', 512, False),
    ('apple-touch-icon.png', 180, False),
    ('favicon-32.png', 32, False),
    ('efactory-e-maskable-512.png', 512, True),
]:
    # Black matches the original e emblem's interior and avoids platform alpha fill.
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 255))
    logo_size = round(size * 0.9) if maskable else size
    resized = logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    inset = (size - logo_size) // 2
    canvas.alpha_composite(resized, (inset, inset))
    target = output / name
    canvas.convert('RGB').save(target, optimize=True)
    records.append({'file': name, 'size': size, 'maskable': maskable,
                    'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
(output / 'provenance.json').write_text(json.dumps({
    'source': 'efactory-e-icon.png',
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'resampling': 'LANCZOS', 'background': '#000000',
    'maskableSourceScale': 0.9, 'icons': records,
}, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'sourceSize': logo.size, 'icons': records}))
