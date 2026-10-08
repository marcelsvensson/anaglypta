"""Paints the latest col*row album covers as pixel art into <project>/bitmap.jpg.

The oldest album sits bottom right, newer ones fill right to left, bottom to top.
When there are more albums than cells, only the latest ones are shown.
"""
import argparse
import sys

from PIL import Image

from common import ROOT, canvas_size, cell_xy, ensure_cover, load_cover, load_settings, read_albums


def position(index, col, row):
    """Grid cell (column, row) for the index-th album in the grid, 0 = oldest."""
    return col - 1 - index % col, row - 1 - index // col


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-p", "--provider", default="spotify", help="the providing system, matches a key in settings.json")
    args = parser.parse_args()

    settings = load_settings(args.provider)
    project = settings["project"]
    col, row, width, height, scale, gap = (settings["cover"][key] for key in ("col", "row", "width", "height", "scale", "gap"))
    cell_width, cell_height = width * scale, height * scale

    albums = read_albums(project)
    if not albums:
        sys.exit(f"No albums found in {project}/ - run `node scripts/generate.js` first")

    shown = albums[-(col * row):]
    if len(albums) > len(shown):
        print(f"{len(albums)} albums, the grid holds {len(shown)} - showing the latest")

    bitmap = Image.new("RGB", canvas_size(col, row, cell_width, cell_height, gap), "black")
    drawn = 0
    for index, album in enumerate(shown):
        path = ensure_cover(project, album)
        if path is None:
            continue
        bitmap.paste(load_cover(path, width, height, scale), cell_xy(*position(index, col, row), cell_width, cell_height, gap))
        drawn += 1

    output = ROOT / project / "bitmap.jpg"
    bitmap.save(output, quality=95)
    print(f"Saved {output.relative_to(ROOT)} ({drawn}/{len(shown)} covers)")


if __name__ == "__main__":
    main()
