import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from collage import DEFAULT_CENTER, free_cells  # noqa: E402
from layout import auto_layout, grid_table, layouts, parse_layout, resolve, tile_size  # noqa: E402


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


class LayoutsTest(unittest.TestCase):
    def needed(self, aspect):
        return {layout["layout"]: layout["needed"] for layout in layouts(aspect)}

    def test_poster_breakpoints(self):
        found = self.needed((2, 3))
        self.assertEqual({key: found[key] for key in ("7x3/1", "8x4/2", "10x4/2", "9x5/3", "11x5/3", "13x5/3", "12x6/4")},
                         {"7x3/1": 21, "8x4/2": 29, "10x4/2": 37, "9x5/3": 37, "11x5/3": 47, "13x5/3": 57, "12x6/4": 57})

    def test_todays_square_layout_is_one_of_them(self):
        self.assertEqual(self.needed((1, 1))["13x9/5"], 93)
        self.assertEqual(tile_size(13, (1, 1)), (100, 100))

    def test_every_layout_is_centred_wide_enough_and_readable(self):
        for aspect in ((1, 1), (2, 3), (3, 2), (16, 9)):
            for layout in layouts(aspect):
                self.assertEqual((layout["col"] - layout["size"]) % 2, 0)
                self.assertEqual((layout["row"] - layout["size"]) % 2, 0)
                self.assertTrue(1.2 <= layout["shape"] <= 1.9)
                self.assertGreaterEqual(min(layout["tile"]), 90)

    def test_auto_picks_the_largest_layout_the_items_fill(self):
        self.assertEqual(auto_layout((2, 3), 47)["layout"], "11x5/3")
        self.assertEqual(auto_layout((2, 3), 40)["layout"], "10x4/2", "37 posters, closer to 16:10 than 9x5/3")
        self.assertEqual(auto_layout((2, 3), 5)["layout"], "7x3/1", "too few: the smallest one")

    def test_parse_layout(self):
        self.assertEqual(parse_layout("13x9/5"), (13, 9, 5))
        self.assertEqual(parse_layout(" 6 x 4 "), (6, 4, 0))
        for bad in ("13x9x5", "auto", "3x3/5", "0x4"):
            with self.assertRaises(ValueError):
                parse_layout(bad)

    def test_resolve_centres_the_centrepiece_and_derives_the_tiles(self):
        grid = resolve({"layout": "11x5/3"}, (2, 3), 47)
        self.assertEqual((grid["col"], grid["row"], grid["width"], grid["height"]), (11, 5, 119, 178))
        self.assertEqual(grid["center"], {"col": 4, "row": 1, "size": 3})
        self.assertEqual(resolve({"layout": "auto"}, (2, 3), 47)["layout"], "11x5/3")

    def test_older_settings_still_win_unless_a_layout_is_asked_for(self):
        old = {"col": 4, "row": 3, "width": 10, "height": 10, "center": {"col": 1, "row": 1, "size": 1}}
        grid = resolve(old, (1, 1), 3)
        self.assertEqual((grid["col"], grid["row"], grid["width"], grid["center"]), (4, 3, 10, {"col": 1, "row": 1, "size": 1}))
        self.assertEqual(resolve(old, (2, 3), 47, "10x4/2")["layout"], "10x4/2")

    def test_grid_table_marks_what_fits(self):
        table = grid_table((2, 3), 47)
        self.assertIn("✓ 11x5/3", table)
        self.assertIn("  13x5/3", table)
        self.assertIn("auto picks 11x5/3", table)


if __name__ == "__main__":
    unittest.main()
