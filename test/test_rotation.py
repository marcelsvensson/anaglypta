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


def replay(tiles, centre, changes):
    """Applies the changes step by step, checking each one starts from what's on screen and nothing is shown twice.
    Returns (tiles, centre, most tile changes in one step)."""
    tiles, most = dict(tiles), 0
    for step_changes in changes:
        most = max(most, sum(1 for kind, *_ in step_changes if kind == "tile"))
        for kind, cell, old, new in step_changes:
            if kind == "tile":
                assert tiles[cell] == old, (cell, tiles[cell], old)
                tiles[cell] = new
            else:
                assert centre == old, (centre, old)
                centre = new
        shown = list(tiles.values()) + ([centre] if centre else [])
        assert len(shown) == len(set(shown)), "something on screen twice"
    return tiles, centre, most


class RotateTest(unittest.TestCase):
    def test_the_centrepiece_always_ends_where_it_started(self):
        tiles, changes = run([f"i{n}" for n in range(60)], 40)
        end_tiles, centre, _most = replay(tiles, "c", changes)
        self.assertEqual(centre, "c")
        self.assertNotEqual(end_tiles, tiles, "without rewind the tiles stay changed")

    def test_a_centrepiece_is_not_repeated_while_there_are_others(self):
        # like 13x5/5 with 61 posters: 41 on screen, 20 to spare
        for rewind in (False, True):
            for seed in range(20):
                with self.subTest(rewind=rewind, seed=seed):
                    _tiles, changes = run([f"i{n}" for n in range(38)], 60, seed=seed, rewind=rewind)
                    centres = ["c"] + [new for step_changes in changes for kind, _cell, _old, new in step_changes if kind == "centre"]
                    during = centres[:-1]  # the original coming back at the end is fine
                    self.assertEqual(len(during), len(set(during)), centres)

    def test_rewind_ends_on_the_first_collage(self):
        for spare in (1, 2, 5, 40):
            for steps in (6, 30, 60, 120):
                for seed in range(8):
                    with self.subTest(spare=spare, steps=steps, seed=seed):
                        tiles, changes = run([f"i{n}" for n in range(18 + spare)], steps, seed=seed, rewind=True)
                        end_tiles, centre, most = replay(tiles, "c", changes)
                        self.assertEqual((end_tiles, centre), (tiles, "c"))
                        self.assertLessEqual(most, 9)

    def test_rewind_puts_tiles_back_in_the_order_they_first_changed(self):
        tiles, changes = run([f"i{n}" for n in range(200)], 60, rewind=True)
        first, back_at = [], {}  # the step each tile went back to its original for good
        for step, step_changes in enumerate(changes):
            for kind, cell, _old, new in step_changes:
                if kind == "tile" and cell not in first:
                    first.append(cell)
                if kind == "tile":
                    back_at[cell] = step if new == tiles[cell] else None
        steps = [back_at[cell] for cell in first]
        self.assertNotIn(None, steps, "all of them")
        self.assertEqual(steps, sorted(steps), "a tile that changed earlier goes back no later (several go back in one step)")

    def test_rewind_takes_the_end_of_the_video(self):
        tiles, changes = run([f"i{n}" for n in range(200)], 60, rewind=True)
        singles = [len([c for c in step_changes if c[0] == "tile"]) for step_changes in changes]
        self.assertTrue(all(count == 1 for count in singles[:50]), "about 9 minutes of normal changes first")

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
