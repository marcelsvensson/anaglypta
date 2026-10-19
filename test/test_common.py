import io
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import tempfile  # noqa: E402

from PIL import Image  # noqa: E402

from common import canvas_size, cell_xy, ensure_image, image_path, square  # noqa: E402

RED, BLUE = (255, 0, 0), (0, 0, 255)


def close(actual, expected):
    return all(abs(a - e) < 40 for a, e in zip(actual, expected))


def halves(width, height):
    """Left half red, right half blue."""
    image = Image.new("RGB", (width, height), BLUE)
    image.paste(Image.new("RGB", (width // 2, height), RED), (0, 0))
    return image


class SquareTest(unittest.TestCase):
    def test_crops_the_centre_and_never_stretches(self):
        result = square(halves(40, 10), 8)
        self.assertEqual(result.size, (8, 8))
        # the middle 10x10 of a 40x10 image is still half red, half blue
        self.assertTrue(close(result.getpixel((1, 4)), RED))
        self.assertTrue(close(result.getpixel((6, 4)), BLUE))

    def test_turns_the_photo_upright_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rotated.jpg"
            exif = Image.Exif()
            exif[0x0112] = 6  # orientation: rotate 90 clockwise to show it
            halves(40, 20).save(path, exif=exif)
            with Image.open(path) as image:
                result = square(image, 8)
        # upright, the red left half is on top
        self.assertTrue(close(result.getpixel((6, 1)), RED))
        self.assertTrue(close(result.getpixel((1, 6)), BLUE))

    def test_any_mode_becomes_rgb(self):
        self.assertEqual(square(Image.new("RGBA", (5, 9)), 4).mode, "RGB")
        self.assertEqual(square(Image.new("P", (9, 5)), 4).mode, "RGB")


class EnsureImageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.project = {"source": "local", "name": "cats", "dir": self.root / "projects" / "local" / "cats", "imageSize": 16}

    def tearDown(self):
        self.tmp.cleanup()

    def test_makes_a_square_copy_of_a_local_file_once(self):
        source = self.root / "photo.png"
        halves(30, 60).save(source)
        item = {"id": "abc", "source": str(source)}
        path = ensure_image(self.project, item)
        self.assertEqual(path, image_path(self.project, item))
        self.assertEqual(path, self.project["dir"] / "images" / "abc.jpg")
        with Image.open(path) as image:
            self.assertEqual(image.size, (16, 16))
        source.unlink()
        self.assertEqual(ensure_image(self.project, item), path, "the cached copy is used")

    def test_unreadable_and_missing_sources_give_none(self):
        broken = self.root / "broken.jpg"
        broken.write_bytes(b"not an image")
        with mock.patch("sys.stderr", io.StringIO()) as stderr:
            self.assertIsNone(ensure_image(self.project, {"id": "a", "title": "Broken", "source": str(broken)}))
            self.assertIsNone(ensure_image(self.project, {"id": "b", "source": str(self.root / "gone.jpg")}))
            self.assertIsNone(ensure_image(self.project, {"id": "c"}))
        self.assertIn("Broken", stderr.getvalue())
        self.assertFalse((self.project["dir"] / "images").exists() and any((self.project["dir"] / "images").iterdir()))


class GridMathTest(unittest.TestCase):
    def test_canvas_size_default_settings(self):
        self.assertEqual(canvas_size(10, 10, 9 * 6, 9 * 6, 2), (562, 562))
        self.assertEqual(canvas_size(13, 9, 100, 100, 8), (1412, 980))

    def test_cell_xy(self):
        self.assertEqual(cell_xy(0, 0, 54, 54, 2), (2, 2))
        self.assertEqual(cell_xy(9, 9, 54, 54, 2), (506, 506))
        self.assertEqual(cell_xy(4, 3, 100, 100, 8), (440, 332))


if __name__ == "__main__":
    unittest.main()
