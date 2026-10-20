# Draws the OpenSet logo (open amber ring around a play triangle) at the PWA sizes.
# Same geometry as docs/brand/logo.svg (512 grid): ring r=150, stroke 44, gap -70..-20 deg.
import math, os, sys
from PIL import Image, ImageDraw

INK, AMBER, TEXT = (13, 13, 17), (255, 176, 58), (232, 230, 223)
out = sys.argv[1]  # usage: python3 docs/brand/make_icons.py public
k = 4  # supersample
s = 512 * k
img = Image.new("RGB", (s, s), INK)
d = ImageDraw.Draw(img)
c, r, w = 256 * k, 150 * k, 44 * k
d.arc([c - r - w / 2, c - r - w / 2, c + r + w / 2, c + r + w / 2], start=-20, end=290, fill=AMBER, width=w)
for a in (-20, -70):  # round caps
    x, y = c + r * math.cos(math.radians(a)), c + r * math.sin(math.radians(a))
    d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=AMBER)
tri = [(222 * k, 190 * k), (222 * k, 322 * k), (334 * k, 256 * k)]
d.polygon(tri, fill=TEXT)
d.line(tri + [tri[0]], fill=TEXT, width=12 * k, joint="curve")
for p in tri:  # rounded corners like stroke-linejoin=round
    d.ellipse([p[0] - 6 * k, p[1] - 6 * k, p[0] + 6 * k, p[1] + 6 * k], fill=TEXT)
for size in (512, 192, 180):
    img.resize((size, size), Image.LANCZOS).save(f"{out}/icon-{size}.png", optimize=True)
# program icons next to this script: Windows .exe and macOS .app
here = os.path.dirname(os.path.abspath(__file__))
big = img.resize((1024, 1024), Image.LANCZOS)
big.save(f"{here}/openset.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
big.save(f"{here}/openset.icns")
