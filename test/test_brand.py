"""The Anaglypta card (scripts/brand.py): assets/anaglypta.mp4, uploaded once in Meet (setup pads it first)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import av  # noqa: E402

import brand  # noqa: E402


class CardTest(unittest.TestCase):
    def test_black_with_the_name_in_green_inside_the_middle(self):
        card = brand.card()
        self.assertEqual(card.size, (1920, 1080))
        green = [x for x in range(card.width) if card.getpixel((x, 540)) == brand.GREEN]
        self.assertTrue(green, "the name crosses the middle row")
        margin = card.width * (1 - brand.TEXT_WIDTH) / 2
        self.assertGreaterEqual(min(green), margin - 1)
        self.assertLessEqual(max(green), card.width - margin + 1)
        self.assertEqual(card.getpixel((0, 0)), (0, 0, 0))


class AssetTest(unittest.TestCase):
    """The committed card: run `node scripts/python.js scripts/brand.py` when this fails after changing it."""

    def test_the_card_is_a_small_one_frame_video(self):
        self.assertLess(brand.CARD.stat().st_size, 100_000, "setup pads it, the repo keeps it small")
        with av.open(str(brand.CARD)) as container:
            frames = list(container.decode(video=0))
        self.assertEqual(len(frames), 1)
        self.assertEqual((frames[0].width, frames[0].height), (1920, 1080))


if __name__ == "__main__":
    unittest.main()
