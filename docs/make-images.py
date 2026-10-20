"""Draws the example collages in docs/images/ for the README, from made-up colour tiles (no project, no network).

    node scripts/python.js docs/make-images.py

Uses the real layout and drawing code (layout.resolve, collage.grid_cells/draw), so run it again when those change.
"""
import colorsys
import random
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from PIL import Image  # noqa: E402

from collage import draw, grid_cells  # noqa: E402
from layout import resolve  # noqa: E402

OUT = ROOT / "docs" / "images"
WIDTH = 640  # the README shows them at about this size

# name: (layout, aspect, items, fill, base hue): each one gets its own palette, a third of the colour wheel
EXAMPLES = {
    "default": ("13x9/5", (1, 1), 93, False, 0.55),
    "small": ("auto", (1, 1), 30, False, 0.95),
    "posters": ("auto", (2, 3), 50, False, 0.08),
    "fill": ("13x9/5", (1, 1), 117, True, 0.35),
}
SPREAD = 0.3


def rgb(hue, saturation, value):
    return tuple(round(channel * 255) for channel in colorsys.hsv_to_rgb(hue % 1, saturation, value))


def tile(path, size, hue, rng):
    """A diagonal gradient between two neighbouring hues, like a cover seen from afar."""
    width, height = size
    start = rgb(hue, rng.uniform(0.35, 0.65), rng.uniform(0.7, 0.95))
    end = rgb(hue + rng.uniform(0.03, 0.1), rng.uniform(0.5, 0.8), rng.uniform(0.25, 0.5))
    image = Image.new("RGB", size)
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            t = (x / width + y / height) / 2
            pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(start, end))
    image.save(path)


def example(name, layout, aspect, items, fill, base, folder, rng):
    grid = resolve({"layout": layout}, aspect, items)
    cells = grid_cells(grid, fill=fill)
    # the tiles in the cache are imageSize on the long side, a small one is enough here (they're scaled to the cell)
    size = (64, 64) if aspect[0] == aspect[1] else (64 * aspect[0] // aspect[1], 64)
    hues = [base + rng.uniform(-SPREAD, SPREAD) / 2 for _ in cells]
    tiles = []
    for i, (cell, hue) in enumerate(zip(cells, hues)):
        path = folder / f"{name}-{i}.png"
        tile(path, size, hue, rng)
        tiles.append((cell, path))
    centre = None
    if not fill:
        centre = folder / f"{name}-centre.png"
        tile(centre, (size[0] * 4, size[1] * 4), base + 0.5, rng)  # the opposite colour, so it stands out
    canvas = draw(grid, tiles[:items], centre)
    small = canvas.resize((WIDTH, round(canvas.height * WIDTH / canvas.width)), Image.Resampling.LANCZOS)
    small.save(OUT / f"{name}.jpg", quality=85, optimize=True)
    print(f"docs/images/{name}.jpg: {grid['layout']}, {len(tiles[:items])} tiles{'' if fill else ' + centrepiece'}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(7)  # the same images every run
    with tempfile.TemporaryDirectory() as tmp:
        for name, (layout, aspect, items, fill, base) in EXAMPLES.items():
            example(name, layout, aspect, items, fill, base, Path(tmp), rng)


if __name__ == "__main__":
    main()
