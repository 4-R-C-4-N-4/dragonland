#!/usr/bin/env python3
"""Contact sheets for independent visual review: raw source (downscaled) above the processed
game sheet (nearest-neighbour x4 on the battlefield green), one PNG per species.
Usage: python3 tools/art/contact.py [id ...]  -> art/.cache/review/<id>.png"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
picks = {}
for line in (ROOT / 'art/picks.yaml').read_text().splitlines():
    if ':' in line and not line.startswith('#'):
        k, v = line.split(':', 1)
        picks[k.strip()] = v.strip()
out_dir = ROOT / 'art/.cache/review'
out_dir.mkdir(parents=True, exist_ok=True)
ids = sys.argv[1:] or [k for k in picks if '.' not in k]
for uid in ids:
    sheet = ROOT / f'assets/sprites/{uid}.png'
    meta = ROOT / f'assets/sprites/{uid}.json'
    raw = ROOT / f'art/raw/{uid}/{picks.get(uid, "")}'
    if not sheet.exists() or not raw.is_file():
        print('skip', uid); continue
    body = Image.open(sheet).convert('RGBA')
    tags = [t['name'] for t in json.loads(meta.read_text())['meta']['frameTags']]
    big = body.resize((body.width * 4, body.height * 4), Image.Resampling.NEAREST)
    src = Image.open(raw).convert('RGB'); src.thumbnail((900, 700))
    W = max(big.width, src.width) + 120; H = src.height + big.height + 50
    canvas = Image.new('RGB', (W, H), (42, 70, 42))
    d = ImageDraw.Draw(canvas)
    d.text((6, 4), f'{uid}: raw {picks[uid]} (top) / processed x4 (bottom); rows {", ".join(tags)}', fill='white')
    canvas.paste(src, (110, 20))
    canvas.paste(big, (110, src.height + 40), big)
    rh = big.height / len(tags)
    for i, t in enumerate(tags):
        d.text((6, src.height + 40 + i * rh + rh / 2), t, fill='white')
    canvas.save(out_dir / f'{uid}.png')
    print('wrote', out_dir / f'{uid}.png')
