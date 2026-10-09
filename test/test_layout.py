import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from bitmapper import position  # noqa: E402
from bitmapper_collage import DEFAULT_CENTER, free_cells  # noqa: E402


class BitmapPositionTest(unittest.TestCase):
    """Oldest album bottom right, filling right to left, bottom to top (day.html's favicon math relies on this)."""

    def test_positions_on_a_10x10_grid(self):
        self.assertEqual(position(0, 10, 10), (9, 9))
        self.assertEqual(position(1, 10, 10), (8, 9))
        self.assertEqual(position(9, 10, 10), (0, 9))
        self.assertEqual(position(10, 10, 10), (9, 8))
        self.assertEqual(position(99, 10, 10), (0, 0))

    def test_every_cell_used_once(self):
        cells = {position(i, 10, 10) for i in range(100)}
        self.assertEqual(len(cells), 100)


class CollageCellsTest(unittest.TestCase):
    def test_default_layout_has_100_cells(self):
        cells = free_cells(13, 9, DEFAULT_CENTER, [[12, 8]])
        self.assertEqual(len(cells), 100)
        self.assertEqual(cells[:2], [(11, 8), (10, 8)])
        self.assertEqual(cells[-1], (0, 0))

    def test_centre_and_skipped_cells_stay_free(self):
        cells = set(free_cells(13, 9, DEFAULT_CENTER, [[12, 8]]))
        self.assertNotIn((12, 8), cells)
        for c in range(4, 8):
            for r in range(3, 7):
                self.assertNotIn((c, r), cells)


if __name__ == "__main__":
    unittest.main()
