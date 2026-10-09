"""Smoke test: renders a bitmap and a collage in a temp folder, with solid colour covers in the cache (no network)."""
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from PIL import Image  # noqa: E402

import bitmapper  # noqa: E402
import bitmapper_collage  # noqa: E402
import common  # noqa: E402

COLOURS = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]
SETTINGS = {
    "project": "album",
    "cover": {"col": 3, "row": 2, "width": 4, "height": 4, "scale": 5, "gap": 2},
    "collage": {"col": 4, "row": 3, "width": 10, "height": 10, "scale": 1, "gap": 2,
                "center": {"col": 1, "row": 1, "size": 1}, "skip": []},
}


class RenderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / "album").mkdir()
        (root / "tmp").mkdir()
        (root / "tmp" / "covers").mkdir()
        for i, colour in enumerate(COLOURS):
            self.write_album(root, f"2026-01-0{i + 1}.md", f"album{i}", f"track{i}")
            Image.new("RGB", (8, 8), colour).save(root / "tmp" / "covers" / f"album{i}.jpeg")
        # another song from the first album, added later - must not get a tile of its own
        self.write_album(root, "2026-01-04.md", "album0", "track9")

        self.patches = [
            mock.patch.object(common, "ROOT", root),
            mock.patch.object(common, "TMP", root / "tmp"),
            mock.patch.object(bitmapper, "ROOT", root),
            mock.patch.object(bitmapper_collage, "ROOT", root),
            mock.patch.object(bitmapper, "load_settings", lambda provider: SETTINGS),
            mock.patch.object(bitmapper_collage, "load_settings", lambda provider: SETTINGS),
            mock.patch.object(sys, "argv", ["test"]),
        ]
        for patch in self.patches:
            patch.start()
        self.root = root

    @staticmethod
    def write_album(root, file_name, album_id, track_id):
        album = {"albumId": album_id, "id": track_id, "images": "https://example.invalid/never-downloaded"}
        (root / "album" / file_name).write_text(
            "---\n" + "".join(f"    {key}: {json.dumps(value)}\n" for key, value in album.items()) + "---")

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        self.tmp.cleanup()

    def colour_at(self, image, x, y):
        return image.getpixel((x, y))

    def assertColour(self, actual, expected):
        self.assertTrue(all(abs(a - e) < 30 for a, e in zip(actual, expected)), f"{actual} != {expected}")

    def test_bitmap(self):
        with redirect_stdout(io.StringIO()):
            bitmapper.main()
        image = Image.open(self.root / "album" / "bitmap.jpg")
        self.assertEqual(image.size, common.canvas_size(3, 2, 20, 20, 2))
        for index, colour in enumerate(COLOURS):
            x, y = common.cell_xy(*bitmapper.position(index, 3, 2), 20, 20, 2)
            self.assertColour(self.colour_at(image, x + 10, y + 10), colour)
        # the duplicate album didn't take the 4th cell
        x, y = common.cell_xy(*bitmapper.position(3, 3, 2), 20, 20, 2)
        self.assertColour(self.colour_at(image, x + 10, y + 10), (0, 0, 0))

    def test_collage_uses_the_bitmap_as_centrepiece(self):
        with redirect_stdout(io.StringIO()):
            bitmapper.main()
            bitmapper_collage.main()
        image = Image.open(self.root / "album" / "collage.jpg")
        self.assertEqual(image.size, common.canvas_size(4, 3, 10, 10, 2))
        cells = bitmapper_collage.free_cells(4, 3, SETTINGS["collage"]["center"], [])
        for (c, r), colour in zip(cells, COLOURS):
            x, y = common.cell_xy(c, r, 10, 10, 2)
            self.assertColour(self.colour_at(image, x + 5, y + 5), colour)

    def collage_with(self, *flags):
        """Runs the collage with flags, returns (centre colour, colours of the filled grid cells)."""
        with mock.patch.object(sys, "argv", ["test", *flags]), redirect_stdout(io.StringIO()):
            bitmapper_collage.main()
        image = Image.open(self.root / "album" / "collage.jpg").convert("RGB")
        x, y = common.cell_xy(1, 1, 10, 10, 2)
        centre = self.colour_at(image, x + 5, y + 5)
        cells = []
        for c, r in bitmapper_collage.free_cells(4, 3, SETTINGS["collage"]["center"], []):
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
        with mock.patch.object(bitmapper_collage.random, "choice", lambda albums: albums[0]):
            centre, cells = self.collage_with("--cover")
        self.assertColour(centre, COLOURS[0])
        self.assertEqual(len(cells), 2)
        self.assertNotInCells(COLOURS[0], cells)

    def test_collage_latest_and_cover_cant_be_combined(self):
        with mock.patch.object(sys, "argv", ["test", "--latest", "--cover"]), \
                mock.patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
            bitmapper_collage.main()

    def test_read_albums_keeps_the_first_song_per_album(self):
        albums = common.read_albums("album")
        self.assertEqual([album["albumId"] for album in albums], ["album0", "album1", "album2"])
        self.assertEqual(albums[0]["id"], "track0")

    def test_no_albums_exits(self):
        for file in (self.root / "album").glob("*.md"):
            file.unlink()
        with self.assertRaises(SystemExit):
            bitmapper.main()


if __name__ == "__main__":
    unittest.main()
