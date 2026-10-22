"""rotation.py: the living collage's changes, seeded (no images)."""
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from rotation import neighbours, rotate  # noqa: E402

CELLS = [(c, r) for r in range(3) for c in range(6)]


def run(items, steps, seed=1, centre="c", **options):
    tiles = dict(zip(CELLS, items))
    on_screen = list(tiles.values()) + ([centre] if centre else [])
    return tiles, list(rotate(tiles, centre, on_screen + [i for i in items if i not in on_screen], steps, random.Random(seed), **options))


class RotateTest(unittest.TestCase):
    def test_one_tile_per_step_and_the_centre_every_sixth(self):
        _tiles, changes = run([f"i{n}" for n in range(60)], 18)
        for step, step_changes in enumerate(changes, 1):
            kinds = [kind for kind, *_ in step_changes]
            self.assertEqual(kinds, ["tile", "centre"] if step % 6 == 0 else ["tile"], step)

    def test_nothing_is_on_screen_twice(self):
        tiles, changes = run([f"i{n}" for n in range(30)], 200)
        tiles, centre = dict(tiles), "c"
        for step_changes in changes:
            for kind, cell, old, new in step_changes:
                if kind == "tile":
                    self.assertEqual(tiles[cell], old)
                    tiles[cell] = new
                else:
                    self.assertEqual(centre, old)
                    centre = new
            shown = list(tiles.values()) + [centre]
            self.assertEqual(len(shown), len(set(shown)))

    def test_an_item_cools_down_before_coming_back_when_the_pool_allows(self):
        _tiles, changes = run([f"i{n}" for n in range(80)], 100, cooldown=20)
        left = {}
        for step, step_changes in enumerate(changes, 1):
            for _kind, _cell, old, new in step_changes:
                if new in left:
                    self.assertGreaterEqual(step - left[new], 20, new)
                left[old] = step

    def test_with_few_spare_items_the_longest_waiting_comes_back(self):
        _tiles, changes = run([f"i{n}" for n in range(19)], 30, cooldown=50)  # 18 tiles + centre on screen, 1 spare
        self.assertTrue(all(step_changes for step_changes in changes), "never stuck")

    def test_changes_spread_over_the_grid(self):
        _tiles, changes = run([f"i{n}" for n in range(60)], 50, spread=2)
        cells = [cell for step_changes in changes for kind, cell, *_ in step_changes if kind == "tile"]
        for previous, cell in zip(cells, cells[1:]):
            self.assertNotIn(cell, neighbours(previous))

    def test_no_centrepiece_no_centre_changes_and_seeded(self):
        _tiles, changes = run([f"i{n}" for n in range(40)], 12, centre=None)
        self.assertTrue(all(kind == "tile" for step_changes in changes for kind, *_ in step_changes))
        self.assertEqual(run([f"i{n}" for n in range(40)], 12)[1], run([f"i{n}" for n in range(40)], 12)[1])


if __name__ == "__main__":
    unittest.main()
