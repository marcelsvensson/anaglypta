import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from collage import DEFAULT_CENTER, free_cells  # noqa: E402


class CollageCellsTest(unittest.TestCase):
    def test_default_layout_fills_every_cell_around_the_centre(self):
        cells = free_cells(13, 9, DEFAULT_CENTER, [])
        self.assertEqual(len(cells), 13 * 9 - 5 * 5)
        self.assertEqual(cells[:2], [(12, 8), (11, 8)])
        self.assertEqual(cells[-1], (0, 0))

    def test_centre_and_skipped_cells_stay_free(self):
        cells = set(free_cells(13, 9, DEFAULT_CENTER, [[12, 8]]))
        self.assertNotIn((12, 8), cells)
        for c in range(4, 9):
            for r in range(2, 7):
                self.assertNotIn((c, r), cells)

    def test_default_centre_sits_in_the_middle(self):
        size = DEFAULT_CENTER["size"]
        self.assertEqual(DEFAULT_CENTER["col"], (13 - size) // 2)
        self.assertEqual(DEFAULT_CENTER["row"], (9 - size) // 2)

    def test_a_centre_of_size_0_leaves_every_cell_free(self):
        self.assertEqual(len(free_cells(13, 9, {**DEFAULT_CENTER, "size": 0}, [])), 13 * 9)


if __name__ == "__main__":
    unittest.main()
