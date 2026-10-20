"""Builds projects/<source>/<name>/collage.jpg: the project's images in a grid around a centrepiece.

The centrepiece is a random image (also with --cover), or with --latest (used by daily-new) the newest one.
An image in the middle doesn't get a grid cell as well.
With --fill there's no centrepiece: the centre cells are filled with images like the rest.
Without --randomize the latest images are used, oldest bottom right, filling right to left, bottom to top.
"""
import argparse
import random
import sys

from PIL import Image, ImageOps

from common import (ROOT, add_project_args, canvas_size, cell_xy, ensure_image, expire_cache, load_project, load_tile, parse_aspect,
                    read_items, report_expired, warn)
from layout import grid_table, resolve

# the default layout's centre (13x9/5), kept for tests and older settings
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


def load_centerpiece(project, centre_item, size):
    """The centre item's image cropped to size, None (an empty centre) when it can't be read."""
    path = ensure_image(project, centre_item)
    if not path:
        warn("No image for the centrepiece - leaving the centre empty")
        return None
    with Image.open(path) as image:
        return ImageOps.fit(image.convert("RGB"), size, Image.Resampling.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_project_args(parser)
    parser.add_argument("-r", "--randomize", action="store_true", help="pick and place images randomly (from all of them)")
    centrepiece_choice = parser.add_mutually_exclusive_group()
    centrepiece_choice.add_argument("-c", "--cover", action="store_true", help="a random image as centrepiece (the default)")
    centrepiece_choice.add_argument("-f", "--fill", action="store_true", help="no centrepiece: fill the centre with images like the rest")
    centrepiece_choice.add_argument("-l", "--latest", action="store_true", help="the newest image as centrepiece (the one daily-new just fetched)")
    parser.add_argument("--layout", help="draw with this layout instead of the project's, like 11x5/3 (columns x rows / centrepiece) or auto")
    parser.add_argument("--grid", action="store_true", help="only print the layouts that fit the project's aspect and items")
    args = parser.parse_args()

    project = load_project(args.source, args.project, mix=True)
    try:
        aspect = parse_aspect(project.get("aspect"))
    except ValueError as error:
        sys.exit(f"❌ {project['id']}: {error}")

    report_expired(project, expire_cache(project))
    items = read_items(project)
    collage = project["collage"]
    if args.grid:
        print(grid_table(aspect, len(items), collage.get("canvasWidth", 1412), collage.get("gap", 8)))
        return
    if not items:
        sys.exit(f"Nothing fetched for {project['id']} yet - run `npm run full -- -p {project['id']}` first")

    try:
        grid = resolve(collage, aspect, len(items), args.layout)
    except ValueError as error:
        sys.exit(f"❌ {error}")
    col, row, width, height, scale, gap = (grid[key] for key in ("col", "row", "width", "height", "scale", "gap"))
    cell_width, cell_height = width * scale, height * scale
    center = grid["center"]
    if args.fill:
        # no centrepiece: the centre cells get images like the rest
        center = {**center, "size": 0}
    cells = free_cells(col, row, center, collage.get("skip", []))

    # an item in the middle doesn't get a grid cell as well
    centre_item = None if args.fill else items[-1] if args.latest else random.choice(items)
    pool = [item for item in items if item is not centre_item]

    if args.randomize:
        chosen = random.sample(pool, min(len(pool), len(cells)))
    else:
        chosen = pool[-len(cells):]

    canvas = Image.new("RGB", canvas_size(col, row, cell_width, cell_height, gap), "black")
    drawn = 0
    for (c, r), item in zip(cells, chosen):
        path = ensure_image(project, item)
        if path is None:
            continue
        canvas.paste(load_tile(path, width, height, scale), cell_xy(c, r, cell_width, cell_height, gap))
        drawn += 1

    if not args.fill:
        size = center["size"]
        center_size = (size * cell_width + (size - 1) * gap, size * cell_height + (size - 1) * gap)
        centerpiece = load_centerpiece(project, centre_item, center_size)
        if centerpiece:
            canvas.paste(centerpiece, cell_xy(center["col"], center["row"], cell_width, cell_height, gap))

    output = project["dir"] / "collage.jpg"
    canvas.save(output, quality=95)
    centre = "" if args.fill else " + centrepiece"
    print(f"Saved {output.relative_to(ROOT)} ({drawn}/{len(chosen)} images{centre}, {len(cells)} cells, layout {grid['layout']})")

    thumbnail = project["dir"] / "collage_thumbnail.jpg"
    ImageOps.fit(canvas, THUMBNAIL_SIZE, Image.Resampling.LANCZOS).save(thumbnail, quality=95, dpi=(72, 72))
    print(f"Saved {thumbnail.relative_to(ROOT)} ({THUMBNAIL_SIZE[0]}x{THUMBNAIL_SIZE[1]})")


if __name__ == "__main__":
    main()
