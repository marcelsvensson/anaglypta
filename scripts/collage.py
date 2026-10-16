"""Builds <project>/collage.jpg: album covers in a grid around a centrepiece.

The centrepiece is a random album's cover (also with --cover), or with --latest (used by daily-new) the newest album's
cover. An album in the middle doesn't get a grid cell as well.
With --fill there's no centrepiece: the centre cells are filled with albums like the rest.
Without --randomize the latest albums are used, oldest bottom right, filling right to left, bottom to top.
"""
import argparse
import random
import sys

from PIL import Image, ImageOps

from common import ROOT, canvas_size, cell_xy, ensure_cover, load_cover, load_settings, read_albums, warn

DEFAULT_CENTER = {"col": 4, "row": 2, "size": 5}
# a small copy of the collage, saved next to it as collage_thumbnail.jpg (72 dpi), scaled to cover and cropped in the centre, never stretched
THUMBNAIL_SIZE = (97, 68)


def free_cells(col, row, center, skip):
    """Cells to fill, in fill order: bottom to top, right to left, without the centre and skipped cells."""
    skipped = {tuple(cell) for cell in skip}

    def in_center(c, r):
        return (center["col"] <= c < center["col"] + center["size"]
                and center["row"] <= r < center["row"] + center["size"])

    return [(c, r) for r in reversed(range(row)) for c in reversed(range(col))
            if not in_center(c, r) and (c, r) not in skipped]


def load_centerpiece(project, centre_album, size):
    """The centre album's cover resized to size, None (an empty centre) when it can't be downloaded."""
    path = ensure_cover(project, centre_album)
    if not path:
        warn("No cover for the centrepiece - leaving the centre empty")
        return None
    with Image.open(path) as image:
        return image.convert("RGB").resize(size)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-p", "--provider", default="spotify", help="the providing system, matches a key in settings.json")
    parser.add_argument("-r", "--randomize", action="store_true", help="pick and place albums randomly (from all albums)")
    centrepiece_choice = parser.add_mutually_exclusive_group()
    centrepiece_choice.add_argument("-c", "--cover", action="store_true", help="a random album cover as centrepiece (the default)")
    centrepiece_choice.add_argument("-f", "--fill", action="store_true", help="no centrepiece: fill the centre with albums like the rest")
    centrepiece_choice.add_argument("-l", "--latest", action="store_true", help="the newest album's cover as centrepiece (the one daily-new just fetched)")
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
        sys.exit(f"No albums found in {project}/ - run `npm run full` first")

    # an album in the middle doesn't get a grid cell as well
    centre_album = None if args.fill else albums[-1] if args.latest else random.choice(albums)
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
        centerpiece = load_centerpiece(project, centre_album, center_size)
        if centerpiece:
            canvas.paste(centerpiece, cell_xy(center["col"], center["row"], cell_width, cell_height, gap))

    output = ROOT / project / "collage.jpg"
    canvas.save(output, quality=95)
    print(f"Saved {output.relative_to(ROOT)} ({drawn}/{len(chosen)} covers, {len(cells)} cells)")

    thumbnail = ROOT / project / "collage_thumbnail.jpg"
    ImageOps.fit(canvas, THUMBNAIL_SIZE, Image.Resampling.LANCZOS).save(thumbnail, quality=95, dpi=(72, 72))
    print(f"Saved {thumbnail.relative_to(ROOT)} ({THUMBNAIL_SIZE[0]}x{THUMBNAIL_SIZE[1]})")


if __name__ == "__main__":
    main()
