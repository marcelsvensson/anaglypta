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

from common import add_project_args, canvas_size, cell_xy, ensure_image, load_project, load_tile, parse_aspect, read_items, warn
from layout import grid_table, resolve



def free_cells(col, row, center, skip):
    """Cells to fill, in fill order: bottom to top, right to left, without the centre and skipped cells."""
    skipped = {tuple(cell) for cell in skip}

    def in_center(c, r):
        return (center["col"] <= c < center["col"] + center["size"]
                and center["row"] <= r < center["row"] + center["size"])

    return [(c, r) for r in reversed(range(row)) for c in reversed(range(col))
            if not in_center(c, r) and (c, r) not in skipped]


def grid_cells(grid, skip=(), fill=False):
    """The cells to fill for a grid from layout.resolve, in fill order. fill: no centrepiece, the centre cells too."""
    center = {**grid["center"], "size": 0} if fill else grid["center"]
    return free_cells(grid["col"], grid["row"], center, skip)


def cell_size(grid):
    return grid["width"] * grid["scale"], grid["height"] * grid["scale"]


def tile_xy(grid, cell):
    """Top left pixel of a grid cell."""
    return cell_xy(*cell, *cell_size(grid), grid["gap"])


def tile_image(grid, path):
    """The image at path as a grid tile: cropped to fit, never stretched."""
    return load_tile(path, grid["width"], grid["height"], grid["scale"])


def centre_xy(grid):
    return tile_xy(grid, (grid["center"]["col"], grid["center"]["row"]))


def centre_image(grid, path):
    """The image at path as the centrepiece: size x size cells and the gaps between them, cropped to fit."""
    (cell_width, cell_height), size, gap = cell_size(grid), grid["center"]["size"], grid["gap"]
    with Image.open(path) as image:
        return ImageOps.fit(image.convert("RGB"), (size * cell_width + (size - 1) * gap, size * cell_height + (size - 1) * gap),
                            Image.Resampling.LANCZOS)


def draw(grid, tiles, centre=None):
    """The collage for a grid from layout.resolve: tiles = [((col, row), image path)], centre = the centrepiece's image
    path (None leaves the middle empty). Everything is cropped to fit, never stretched."""
    canvas = Image.new("RGB", canvas_size(grid["col"], grid["row"], *cell_size(grid), grid["gap"]), "black")
    for cell, path in tiles:
        canvas.paste(tile_image(grid, path), tile_xy(grid, cell))
    if centre:
        canvas.paste(centre_image(grid, centre), centre_xy(grid))
    return canvas


def pick(items, cells, centre="cover", randomize=True):
    """Which item goes where: {"centre": item or None, "tiles": [(cell, item)]}. centre: "cover" (a random item), "latest"
    (the newest) or "fill" (none, the centre cells are in cells). An item in the middle doesn't get a grid cell as well.
    randomize: a random pick from all items, else the newest ones (oldest in the first cell)."""
    centre_item = None if centre == "fill" else items[-1] if centre == "latest" else random.choice(items)
    pool = [item for item in items if item is not centre_item]
    chosen = random.sample(pool, min(len(pool), len(cells))) if randomize else pool[-len(cells):]
    return {"centre": centre_item, "tiles": list(zip(cells, chosen))}


def render(project, grid, picked):
    """The collage of a pick: (image, how many tiles were drawn). Images that can't be made are left out (warned)."""
    tiles = [(cell, path) for cell, path in ((cell, ensure_image(project, item)) for cell, item in picked["tiles"]) if path]
    centre = ensure_image(project, picked["centre"]) if picked["centre"] else None
    if picked["centre"] and not centre:
        warn("No image for the centrepiece - leaving the centre empty")
    return draw(grid, tiles, centre), len(tiles)


def load_grid(project, layout=None):
    """(items, grid) of the project, exits with the reason when there's nothing to draw. layout: --layout."""
    try:
        aspect = parse_aspect(project.get("aspect"))
        items = read_items(project)
        if not items:
            sys.exit(f"Nothing fetched for {project['id']} yet - run `npm run full -- -p {project['id']}` first")
        return items, resolve(project["collage"], aspect, len(items), layout)
    except ValueError as error:
        sys.exit(f"❌ {project['id']}: {error}")


def centre_mode(args):
    return "fill" if args.fill else "latest" if args.latest else "cover"


def add_centre_args(parser):
    centrepiece_choice = parser.add_mutually_exclusive_group()
    centrepiece_choice.add_argument("-c", "--cover", action="store_true", help="a random image as centrepiece (the default)")
    centrepiece_choice.add_argument("-f", "--fill", action="store_true", help="no centrepiece: fill the centre with images like the rest")
    centrepiece_choice.add_argument("-l", "--latest", action="store_true", help="the newest image as centrepiece (the one daily-new just fetched)")
    parser.add_argument("--layout", help="draw with this layout instead of the project's, like 11x5/3 (columns x rows / centrepiece) or auto")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_project_args(parser)
    parser.add_argument("-r", "--randomize", action="store_true", help="pick and place images randomly (from all of them)")
    add_centre_args(parser)
    parser.add_argument("--grid", action="store_true", help="only print the layouts that fit the project's aspect and items")
    args = parser.parse_args()

    project = load_project(args.project_json)
    collage = project["collage"]
    if args.grid:
        try:
            aspect = parse_aspect(project.get("aspect"))
        except ValueError as error:
            sys.exit(f"❌ {project['id']}: {error}")
        print(grid_table(aspect, len(read_items(project)), collage.get("canvasWidth", 1412), collage.get("gap", 8)))
        return

    items, grid = load_grid(project, args.layout)
    cells = grid_cells(grid, collage.get("skip", []), args.fill)
    picked = pick(items, cells, centre_mode(args), args.randomize)
    canvas, drawn = render(project, grid, picked)

    output = project["dir"] / "collage.jpg"
    canvas.save(output, quality=95)
    centre = "" if args.fill else " + centrepiece"
    print(f"Saved {project['folder']}/collage.jpg ({drawn}/{len(picked['tiles'])} images{centre}, {len(cells)} cells, layout {grid['layout']})")


if __name__ == "__main__":
    main()
