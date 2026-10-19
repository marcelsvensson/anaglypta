"""Smoke test: renders a collage in a temp folder, with solid colour covers in the cache (no network)."""
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from PIL import Image  # noqa: E402

import collage  # noqa: E402
import common  # noqa: E402

COLOURS = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]
COLLAGE = {"col": 4, "row": 3, "width": 10, "height": 10, "scale": 1, "gap": 2,
           "center": {"col": 1, "row": 1, "size": 1}, "skip": []}


class RenderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.dir = root / "projects" / "spotify" / "album"
        self.project = {"source": "spotify", "name": "album", "id": "spotify/album", "dir": self.dir, "collage": COLLAGE}
        self.items = []
        for i, colour in enumerate(COLOURS):
            self.add_item(f"album{i}", colour)
        # the first album again, added later - must not get a tile of its own
        self.items.append({"id": "album0", "source": "https://example.invalid/never-downloaded"})
        common.write_data(self.project, {"items": self.items})

        self.patches = [
            mock.patch.object(collage, "ROOT", root),
            mock.patch.object(collage, "load_project", self.load_project),
            mock.patch.object(sys, "argv", ["test"]),
        ]
        for patch in self.patches:
            patch.start()
        self.root = root

    def load_project(self, source, project):
        return self.project

    def add_item(self, item_id, colour):
        """An item with its image already in the cache, so nothing is downloaded."""
        self.items.append({"id": item_id, "source": "https://example.invalid/never-downloaded"})
        (self.dir / "images").mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (8, 8), colour).save(self.dir / "images" / f"{item_id}.jpg")

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        self.tmp.cleanup()

    def colour_at(self, image, x, y):
        return image.getpixel((x, y))

    def assertColour(self, actual, expected):
        self.assertTrue(all(abs(a - e) < 30 for a, e in zip(actual, expected)), f"{actual} != {expected}")

    def test_collage_fills_the_cells_in_order(self):
        with mock.patch.object(collage.random, "choice", lambda albums: albums[0]), redirect_stdout(io.StringIO()):
            collage.main()
        image = Image.open(self.dir / "collage.jpg").convert("RGB")
        self.assertEqual(image.size, common.canvas_size(4, 3, 10, 10, 2))
        cells = collage.free_cells(4, 3, COLLAGE["center"], [])
        # album0 is in the middle, so album1 and album2 fill the first cells, the duplicate of album0 gets none
        for (c, r), colour in zip(cells, COLOURS[1:]):
            x, y = common.cell_xy(c, r, 10, 10, 2)
            self.assertColour(self.colour_at(image, x + 5, y + 5), colour)
        x, y = common.cell_xy(*cells[2], 10, 10, 2)
        self.assertColour(self.colour_at(image, x + 5, y + 5), (0, 0, 0))

    def test_collage_also_saves_a_thumbnail(self):
        with redirect_stdout(io.StringIO()):
            collage.main()
        with Image.open(self.dir / "collage_thumbnail.jpg") as thumbnail:
            self.assertEqual(thumbnail.size, (97, 68))
            self.assertEqual(tuple(round(d) for d in thumbnail.info["dpi"]), (72, 72))

    def collage_with(self, *flags):
        """Runs the collage with flags, returns (centre colour, colours of the filled grid cells)."""
        with mock.patch.object(sys, "argv", ["test", *flags]), redirect_stdout(io.StringIO()):
            collage.main()
        image = Image.open(self.dir / "collage.jpg").convert("RGB")
        x, y = common.cell_xy(1, 1, 10, 10, 2)
        centre = self.colour_at(image, x + 5, y + 5)
        cells = []
        for c, r in collage.free_cells(4, 3, COLLAGE["center"], []):
            x, y = common.cell_xy(c, r, 10, 10, 2)
            colour = self.colour_at(image, x + 5, y + 5)
            if max(colour) > 30:
                cells.append(colour)
        return centre, cells

    def assertNotInCells(self, colour, cells):
        self.assertFalse(any(all(abs(a - e) < 30 for a, e in zip(cell, colour)) for cell in cells), f"{colour} is also in the grid")

    def test_collage_latest_puts_the_newest_album_in_the_middle_only(self):
        centre, cells = self.collage_with("--latest")
        self.assertColour(centre, COLOURS[2])
        self.assertEqual(len(cells), 2)
        self.assertNotInCells(COLOURS[2], cells)

    def test_collage_cover_album_isnt_in_the_grid_too(self):
        with mock.patch.object(collage.random, "choice", lambda albums: albums[0]):
            centre, cells = self.collage_with("--cover")
        self.assertColour(centre, COLOURS[0])
        self.assertEqual(len(cells), 2)
        self.assertNotInCells(COLOURS[0], cells)

    def test_collage_fill_fills_the_centre_with_albums(self):
        # the 4x3 grid has 12 cells with the centre (1, 1) included, 3 albums fill the bottom row from the right
        centre, cells = self.collage_with("--fill")
        self.assertColour(centre, (0, 0, 0))
        image = Image.open(self.dir / "collage.jpg").convert("RGB")
        for (c, r), colour in zip([(3, 2), (2, 2), (1, 2)], COLOURS):
            x, y = common.cell_xy(c, r, 10, 10, 2)
            self.assertColour(self.colour_at(image, x + 5, y + 5), colour)

    def test_collage_fill_fills_every_cell_when_there_are_enough_albums(self):
        for i in range(3, 12):
            self.add_item(f"album{i}", (200, 200, 0))
        common.write_data(self.project, {"items": self.items})
        centre, cells = self.collage_with("--fill")
        self.assertColour(centre, (200, 200, 0))
        self.assertEqual(len(cells), 11)

    def test_collage_centrepiece_spans_several_cells(self):
        # a 5x5 grid with a 3x3 centre, like the real 5x5 one: the cover must cover all 9 cells and the gaps between them
        self.project["collage"] = {**COLLAGE, "col": 5, "row": 5, "center": {"col": 1, "row": 1, "size": 3}}
        with mock.patch.object(sys, "argv", ["test", "--latest"]), redirect_stdout(io.StringIO()):
            collage.main()
        image = Image.open(self.dir / "collage.jpg").convert("RGB")
        x, y = common.cell_xy(1, 1, 10, 10, 2)
        span = 3 * 10 + 2 * 2
        for dx, dy in [(1, 1), (span // 2, span // 2), (11, 5), (span - 2, span - 2)]:  # corners, middle and a gap
            self.assertColour(self.colour_at(image, x + dx, y + dy), COLOURS[2])
        # the cell right of the centre is outside it
        x, y = common.cell_xy(4, 1, 10, 10, 2)
        self.assertColour(self.colour_at(image, x + 5, y + 5), (0, 0, 0))

    def test_collage_latest_and_cover_cant_be_combined(self):
        with mock.patch.object(sys, "argv", ["test", "--latest", "--cover"]), \
                mock.patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
            collage.main()

    def test_no_items_exits(self):
        common.write_data(self.project, {"items": []})
        with self.assertRaises(SystemExit):
            collage.main()


if __name__ == "__main__":
    unittest.main()
