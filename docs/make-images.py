"""Draws the example collages in docs/images/ for the README, from made-up colour tiles (no project, no network), and
living.gif: the living collage sped up (3 tiles, the centrepiece, the 3 tiles back, the centrepiece back - a seamless loop).

    node scripts/python.js docs/make-images.py

Uses the real layout and drawing code (layout.resolve, collage.grid_cells/draw/tile_image/centre_image), so run it again
when those change.
"""
import colorsys
import random
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from PIL import Image, ImageChops  # noqa: E402

from collage import centre_image, centre_xy, draw, grid_cells, tile_image, tile_xy  # noqa: E402
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


# the living gif: which cells change (spread over the grid, none in the centre) and the timing, sped up
LIVING_CELLS = [(1, 1), (11, 4), (6, 7)]
HOLD_MS, FADE_MS, FADE_FRAMES = 1600, 400, 8  # a change every 2 s


BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def to_gif_frames(frames, strength=10):
    """GIF has 256 colours: one palette for all frames, and an ordered (position based) dither so gradients don't band. A
    pattern that's the same in every frame, unlike error diffusion, keeps the still parts still while a tile fades."""
    width, height = frames[0].size
    shifts = [round((BAYER[y % 4][x % 4] / 15 - 0.5) * strength * 2) for y in range(height) for x in range(width)]
    up, down = Image.new("L", (width, height)), Image.new("L", (width, height))
    up.putdata([max(shift, 0) for shift in shifts])
    down.putdata([max(-shift, 0) for shift in shifts])
    up, down = Image.merge("RGB", [up] * 3), Image.merge("RGB", [down] * 3)
    dithered = [ImageChops.subtract(ImageChops.add(frame, up), down) for frame in frames]

    sample = Image.new("RGB", (width, height * 3))  # the palette comes from a few frames: the start, the middle, the end
    for i, frame in enumerate([dithered[0], dithered[len(dithered) // 2], dithered[-1]]):
        sample.paste(frame, (0, i * height))
    palette = sample.quantize(256, method=Image.Quantize.MEDIANCUT)
    return [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in dithered]


def living_gif(folder, rng):
    """The default collage, then: 3 tiles fade to new images one by one, the centrepiece too, then all of them back, so
    the last state is the first and the loop is seamless."""
    grid = resolve({"layout": "13x9/5"}, (1, 1), 93)
    cells = grid_cells(grid)
    base = 0.55

    def made(name, hue, size=(64, 64)):
        path = folder / f"living-{name}.png"
        tile(path, size, hue, rng)
        return path

    tiles = [(cell, made(i, base + rng.uniform(-SPREAD, SPREAD) / 2)) for i, cell in enumerate(cells)]
    centre = made("centre", base + 0.5, (256, 256))
    # the newcomers stand out a little: warmer hues, the new centrepiece another colour again
    fresh = {cell: made(f"new-{i}", base + 0.3 + rng.uniform(-0.08, 0.08)) for i, cell in enumerate(LIVING_CELLS)}
    fresh_centre = made("new-centre", base + 0.8, (256, 256))
    old = dict(tiles)

    steps = [("tile", cell, fresh[cell]) for cell in LIVING_CELLS] + [("centre", None, fresh_centre)]
    steps += [("tile", cell, old[cell]) for cell in LIVING_CELLS] + [("centre", None, centre)]

    def small(image):
        return image.resize((WIDTH, round(image.height * WIDTH / image.width)), Image.Resampling.LANCZOS)

    canvas = draw(grid, tiles, centre)
    frames, durations = [], []
    for kind, cell, path in steps:
        frames.append(small(canvas))
        durations.append(HOLD_MS)
        following = canvas.copy()
        if kind == "tile":
            following.paste(tile_image(grid, path), tile_xy(grid, cell))
        else:
            following.paste(centre_image(grid, path), centre_xy(grid))
        for k in range(1, FADE_FRAMES + 1):
            frames.append(small(Image.blend(canvas, following, k / FADE_FRAMES)))
            durations.append(FADE_MS // FADE_FRAMES)
        canvas = following

    gif = to_gif_frames(frames)
    gif[0].save(OUT / "living.gif", save_all=True, append_images=gif[1:], duration=durations, loop=0, optimize=True)
    size = (OUT / "living.gif").stat().st_size / 1000
    print(f"docs/images/living.gif: {len(steps)} changes, {len(frames)} frames, {sum(durations) / 1000:.1f} s, {size:.0f} KB")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(7)  # the same images every run
    with tempfile.TemporaryDirectory() as tmp:
        for name, (layout, aspect, items, fill, base) in EXAMPLES.items():
            example(name, layout, aspect, items, fill, base, Path(tmp), rng)
        living_gif(Path(tmp), random.Random(11))


if __name__ == "__main__":
    main()
