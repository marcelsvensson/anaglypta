"""Builds <project>/collage.jpg: album covers in a grid around a centrepiece.

The centrepiece is the pixel bitmap (run bitmapper.py first) or, with --cover, a random album cover.
Without --randomize the latest albums are used, oldest bottom right, filling right to left, bottom to top.
"""
import argparse
import random
import sys

from PIL import Image

from common import ROOT, canvas_size, cell_xy, ensure_cover, load_cover, load_settings, read_albums, warn

DEFAULT_CENTER = {"col": 4, "row": 3, "size": 4}


def free_cells(col, row, center, skip):
    """Cells to fill, in fill order: bottom to top, right to left, without the centre and skipped cells."""
    skipped = {tuple(cell) for cell in skip}

    def in_center(c, r):
        return (center["col"] <= c < center["col"] + center["size"]
                and center["row"] <= r < center["row"] + center["size"])

    return [(c, r) for r in reversed(range(row)) for c in reversed(range(col))
            if not in_center(c, r) and (c, r) not in skipped]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-p", "--provider", default="spotify", help="the providing system, matches a key in settings.json")
    parser.add_argument("-r", "--randomize", action="store_true", help="pick and place albums randomly (from all albums)")
    parser.add_argument("-c", "--cover", action="store_true", help="use a random album cover as centrepiece instead of the bitmap")
    args = parser.parse_args()

    settings = load_settings(args.provider)
    project = settings["project"]
    collage = settings["collage"]
    col, row, width, height, scale, gap = (collage[key] for key in ("col", "row", "width", "height", "scale", "gap"))
    cell_width, cell_height = width * scale, height * scale
    center = {**DEFAULT_CENTER, **collage.get("center", {})}
    cells = free_cells(col, row, center, collage.get("skip", []))

    albums = read_albums(project)
    if not albums:
        sys.exit(f"No albums found in {project}/ - run `npm run fetch` first")

    if args.randomize:
        chosen = random.sample(albums, min(len(albums), len(cells)))
    else:
        chosen = albums[-len(cells):]

    canvas = Image.new("RGB", canvas_size(col, row, cell_width, cell_height, gap), "black")
    drawn = 0
    for (c, r), album in zip(cells, chosen):
        path = ensure_cover(project, album)
        if path is None:
            continue
        canvas.paste(load_cover(path, width, height, scale), cell_xy(c, r, cell_width, cell_height, gap))
        drawn += 1

    size = center["size"]
    center_size = (size * cell_width + (size - 1) * gap, size * cell_height + (size - 1) * gap)
    centerpiece = None
    bitmap = ROOT / project / "bitmap.jpg"
    if not args.cover:
        if bitmap.exists():
            with Image.open(bitmap) as image:
                centerpiece = image.convert("RGB").resize(center_size)
        else:
            warn(f"No {project}/bitmap.jpg yet (run bitmapper.py) - using a random cover instead")
    if centerpiece is None:
        path = ensure_cover(project, random.choice(albums))
        if path:
            with Image.open(path) as image:
                centerpiece = image.convert("RGB").resize(center_size)
    if centerpiece:
        canvas.paste(centerpiece, cell_xy(center["col"], center["row"], cell_width, cell_height, gap))

    output = ROOT / project / "collage.jpg"
    canvas.save(output, quality=95)
    print(f"Saved {output.relative_to(ROOT)} ({drawn}/{len(chosen)} covers, {len(cells)} cells)")


if __name__ == "__main__":
    main()
