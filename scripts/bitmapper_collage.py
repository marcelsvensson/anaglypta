"""Builds <project>/collage.jpg: album covers in a grid around a centrepiece.

The centrepiece is the pixel bitmap (run bitmapper.py first), with --cover (used by full) a random album cover,
or with --latest (used by daily) the newest album's cover. An album in the middle doesn't get a grid cell as well.
With --fill there's no centrepiece: the centre cells are filled with albums like the rest.
Without --randomize the latest albums are used, oldest bottom right, filling right to left, bottom to top.
"""
import argparse
import random
import sys

from PIL import Image

from common import ROOT, canvas_size, cell_xy, ensure_cover, load_cover, load_settings, read_albums, warn

DEFAULT_CENTER = {"col": 4, "row": 2, "size": 5}


def free_cells(col, row, center, skip):
    """Cells to fill, in fill order: bottom to top, right to left, without the centre and skipped cells."""
    skipped = {tuple(cell) for cell in skip}

    def in_center(c, r):
        return (center["col"] <= c < center["col"] + center["size"]
                and center["row"] <= r < center["row"] + center["size"])

    return [(c, r) for r in reversed(range(row)) for c in reversed(range(col))
            if not in_center(c, r) and (c, r) not in skipped]


def load_centerpiece(project, centre_album, albums, size):
    """The centre album's cover, else the bitmap, else a random cover (resized to size), None if there's nothing."""
    bitmap = ROOT / project / "bitmap.jpg"
    if centre_album:
        path = ensure_cover(project, centre_album)
        if path:
            with Image.open(path) as image:
                return image.convert("RGB").resize(size)
        warn("No cover for the centrepiece - using the bitmap instead")
    if bitmap.exists():
        with Image.open(bitmap) as image:
            return image.convert("RGB").resize(size)
    if centre_album:
        return None
    warn(f"No {project}/bitmap.jpg yet (run bitmapper.py) - using a random cover instead")
    path = ensure_cover(project, random.choice(albums))
    if not path:
        return None
    with Image.open(path) as image:
        return image.convert("RGB").resize(size)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-p", "--provider", default="spotify", help="the providing system, matches a key in settings.json")
    parser.add_argument("-r", "--randomize", action="store_true", help="pick and place albums randomly (from all albums)")
    centrepiece_choice = parser.add_mutually_exclusive_group()
    centrepiece_choice.add_argument("-c", "--cover", action="store_true", help="use a random album cover as centrepiece instead of the bitmap")
    centrepiece_choice.add_argument("-f", "--fill", action="store_true", help="no centrepiece: fill the centre with albums like the rest")
    centrepiece_choice.add_argument("-l", "--latest", action="store_true", help="use the newest album's cover as centrepiece (the one daily just fetched)")
    args = parser.parse_args()

    settings = load_settings(args.provider)
    project = settings["project"]
    collage = settings["collage"]
    col, row, width, height, scale, gap = (collage[key] for key in ("col", "row", "width", "height", "scale", "gap"))
    cell_width, cell_height = width * scale, height * scale
    center = {**DEFAULT_CENTER, **collage.get("center", {})}
    if args.fill:
        # no centrepiece: the centre cells get albums like the rest
        center = {**center, "size": 0}
    cells = free_cells(col, row, center, collage.get("skip", []))

    albums = read_albums(project)
    if not albums:
        sys.exit(f"No albums found in {project}/ - run `npm run fetch` first")

    # an album in the middle doesn't get a grid cell as well
    centre_album = albums[-1] if args.latest else random.choice(albums) if args.cover else None
    pool = [album for album in albums if album is not centre_album]

    if args.randomize:
        chosen = random.sample(pool, min(len(pool), len(cells)))
    else:
        chosen = pool[-len(cells):]

    canvas = Image.new("RGB", canvas_size(col, row, cell_width, cell_height, gap), "black")
    drawn = 0
    for (c, r), album in zip(cells, chosen):
        path = ensure_cover(project, album)
        if path is None:
            continue
        canvas.paste(load_cover(path, width, height, scale), cell_xy(c, r, cell_width, cell_height, gap))
        drawn += 1

    if not args.fill:
        size = center["size"]
        center_size = (size * cell_width + (size - 1) * gap, size * cell_height + (size - 1) * gap)
        centerpiece = load_centerpiece(project, centre_album, albums, center_size)
        if centerpiece:
            canvas.paste(centerpiece, cell_xy(center["col"], center["row"], cell_width, cell_height, gap))

    output = ROOT / project / "collage.jpg"
    canvas.save(output, quality=95)
    print(f"Saved {output.relative_to(ROOT)} ({drawn}/{len(chosen)} covers, {len(cells)} cells)")


if __name__ == "__main__":
    main()
