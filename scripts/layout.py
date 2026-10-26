"""Grid layouts: how many tiles of an aspect ratio fit around a centrepiece. Pure, used by collage.py (and its --grid).

A layout is "COLSxROWS/CENTRE": 13x9/5 = 13 columns, 9 rows and a 5x5 centrepiece in the middle (today's default), or
"auto": the largest grid the project's items can fill, with the biggest centrepiece that grid has. The centrepiece is a
square block of cells, so it has the tiles' ratio too, and it sits exactly in the middle: cols - centre and rows - centre
are even. It can be as tall as the grid (13x5/5: no row above or below it). Tiles get their size from
canvasWidth (1412 = 13 tiles of 100 + gaps of 8), so the collage stays about as wide whatever the layout.
"""
import re

LAYOUT = re.compile(r"^\s*(\d+)\s*x\s*(\d+)\s*(?:/\s*(\d+))?\s*$")
# canvas width / height a background can have, from a squarish screen to a wide one
MIN_SHAPE, MAX_SHAPE = 1.2, 1.9
# what auto prefers: a widescreen shape (backgrounds and Meet are 16:9), closest to IDEAL_SHAPE when it has to choose
WIDE_SHAPE = 1.6
IDEAL_SHAPE = 16 / 9
# the biggest centrepiece auto picks covers at most this share of the grid's cells (13x5/5 is 38%), bigger ones only by hand
MAX_CENTRE_SHARE = 0.4
# below this (short side, in pixels) a tile is too small to make out
MIN_TILE = 90
DEFAULT_LAYOUT = "13x9/5"
DEFAULT_CANVAS_WIDTH = 1412
DEFAULT_GAP = 8


def parse_layout(text):
    """'13x9/5' -> (13, 9, 5), '6x4' -> (6, 4, 0) (no centrepiece). ValueError when it doesn't fit."""
    match = LAYOUT.match(str(text))
    if not match:
        raise ValueError(f'layout "{text}" should look like 13x9/5 (columns x rows / centrepiece size), or auto')
    col, row, size = int(match[1]), int(match[2]), int(match[3] or 0)
    if col < 1 or row < 1 or size > min(col, row):
        raise ValueError(f'layout "{text}": the centrepiece ({size}) has to fit in {col}x{row}')
    return col, row, size


def tile_size(col, aspect, canvas_width=DEFAULT_CANVAS_WIDTH, gap=DEFAULT_GAP):
    """(width, height) of a tile when col of them (and their gaps) fill canvas_width."""
    aspect_width, aspect_height = aspect
    width = (canvas_width - gap * (col + 1)) // col
    return width, round(width * aspect_height / aspect_width)


def centre_size(row):
    """The smallest centrepiece for a number of rows: about half the height, rows - centre even, at least 1 row above and
    below. Bigger ones, up to the full height, are layouts too."""
    size = row - 2
    while size > 0 and size / row > 0.67:
        size -= 2
    return max(size, 0)


def describe(col, row, size, aspect, canvas_width=DEFAULT_CANVAS_WIDTH, gap=DEFAULT_GAP):
    width, height = tile_size(col, aspect, canvas_width, gap)
    canvas = (col * width + (col + 1) * gap, row * height + (row + 1) * gap)
    cells = col * row - size * size
    return {
        "layout": f"{col}x{row}/{size}", "col": col, "row": row, "size": size,
        "tile": (width, height), "canvas": canvas, "shape": canvas[0] / canvas[1],
        # the centrepiece is an item too, it gets no cell of its own
        "cells": cells, "needed": cells + (1 if size else 0),
    }


def layouts(aspect, canvas_width=DEFAULT_CANVAS_WIDTH, gap=DEFAULT_GAP, max_rows=12, max_cols=40):
    """The even layouts with a centrepiece for this ratio, fewest items first: per number of rows every centre size from
    centre_size(row) up to the full height, with at least one column on each side."""
    found = []
    for row in range(3, max_rows + 1):
        smallest = centre_size(row)
        if not smallest:
            continue
        for size in range(smallest, row + 1, 2):
            for col in range(size + 2, max_cols + 1, 2):
                layout = describe(col, row, size, aspect, canvas_width, gap)
                if min(layout["tile"]) < MIN_TILE:
                    break
                if MIN_SHAPE <= layout["shape"] <= MAX_SHAPE:
                    found.append(layout)
    return sorted(found, key=lambda layout: (layout["needed"], abs(layout["shape"] - IDEAL_SHAPE)))


def auto_layout(aspect, items, canvas_width=DEFAULT_CANVAS_WIDTH, gap=DEFAULT_GAP):
    """Of the layouts items can fill: the largest grid, with the biggest centrepiece it has up to MAX_CENTRE_SHARE of the
    cells (a bigger centre needs fewer items), closest to 16:9 when two are as large. Widescreen ones (WIDE_SHAPE and up)
    first, unless their grid is much smaller. When items fill none, the smallest layout."""
    candidates = layouts(aspect, canvas_width, gap)
    if not candidates:  # a ratio too narrow or too wide for any background: the default grid, with that ratio's tiles
        return describe(*parse_layout(DEFAULT_LAYOUT), aspect, canvas_width, gap)
    fitting = [layout for layout in candidates
               if layout["needed"] <= items and layout["size"] ** 2 <= MAX_CENTRE_SHARE * layout["col"] * layout["row"]]
    if not fitting:
        return candidates[0]
    def best(options):
        return max(options, key=lambda layout: (layout["col"] * layout["row"], layout["size"], -abs(layout["shape"] - IDEAL_SHAPE)))

    def area(layout):
        return layout["col"] * layout["row"]

    largest = best(fitting)
    wide = [layout for layout in fitting if layout["shape"] >= WIDE_SHAPE]
    # widescreen unless that grid is much smaller (a small project would get a tiny one)
    return best(wide) if wide and area(best(wide)) >= 0.7 * area(largest) else largest


def resolve(collage, aspect, items, override=None):
    """The grid to draw: { col, row, width, height, gap, scale, center: { col, row, size }, layout }, from the project's
    collage settings (layout, canvasWidth, gap, scale). override is --layout."""
    gap = collage.get("gap", DEFAULT_GAP)
    canvas_width = collage.get("canvasWidth", DEFAULT_CANVAS_WIDTH)
    layout = override or collage.get("layout", DEFAULT_LAYOUT)
    if layout == "auto":
        picked = auto_layout(aspect, items, canvas_width, gap)
        col, row, size = picked["col"], picked["row"], picked["size"]
    else:
        col, row, size = parse_layout(layout)
    width, height = tile_size(col, aspect, canvas_width, gap)
    return {
        "col": col, "row": row, "width": width, "height": height, "gap": gap, "scale": collage.get("scale", 1),
        "center": {"col": (col - size) // 2, "row": (row - size) // 2, "size": size},
        "layout": f"{col}x{row}/{size}",
    }


def grid_table(aspect, items, canvas_width=DEFAULT_CANVAS_WIDTH, gap=DEFAULT_GAP, limit=16):
    """The text --grid prints: the layouts around the project's item count, the ones it can fill marked, auto's pick too."""
    candidates = layouts(aspect, canvas_width, gap)
    picked = auto_layout(aspect, items, canvas_width, gap)
    fitting = [layout for layout in candidates if layout["needed"] <= items]
    # the ones it fills plus the next few bigger ones, and auto's pick even when it needs fewer items
    shown = fitting[-(limit - 4):] + [layout for layout in candidates if layout["needed"] > items][:4]
    if picked in candidates and picked not in shown:
        shown = sorted(shown + [picked], key=candidates.index)
    lines = [f"Layouts for {aspect[0]}:{aspect[1]} tiles, {items} items (--layout <layout> to try one):", "",
             f"  {'layout':<9} {'items':>5}  {'tile':>9}  {'canvas':>9}  shape  centre",]
    for layout in shown:
        mark = "✓" if layout["needed"] <= items else " "
        centre = f"{layout['size']}/{layout['row']} rows"
        lines.append(f"{mark} {layout['layout']:<9} {layout['needed']:>5}  {layout['tile'][0]:>4}x{layout['tile'][1]:<4}"
                     f"  {layout['canvas'][0]:>4}x{layout['canvas'][1]:<4}  {layout['shape']:.2f}   {centre}"
                     f"{'  <- auto' if layout == picked else ''}")
    lines += ["", f"auto picks {picked['layout']} - save one with \"collage\": {{ \"layout\": \"{picked['layout']}\" }} in projects.json"]
    return "\n".join(lines)
