import io
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import tempfile  # noqa: E402

from PIL import Image  # noqa: E402

from common import Progress, canvas_size, cell_xy, crop, ensure_image, image_dimensions, image_path, image_ready, parse_aspect  # noqa: E402

RED, BLUE = (255, 0, 0), (0, 0, 255)


def close(actual, expected):
    return all(abs(a - e) < 40 for a, e in zip(actual, expected))


def halves(width, height):
    """Left half red, right half blue."""
    image = Image.new("RGB", (width, height), BLUE)
    image.paste(Image.new("RGB", (width // 2, height), RED), (0, 0))
    return image


def square(image, size):
    return crop(image, (size, size))


class CropTest(unittest.TestCase):
    def test_parse_aspect(self):
        self.assertEqual(parse_aspect("2:3"), (2, 3))
        self.assertEqual(parse_aspect(" 16x9 "), (16, 9))
        self.assertEqual(parse_aspect(None), (1, 1))
        for bad in ("square", "0:1", "2:"):
            with self.assertRaises(ValueError):
                parse_aspect(bad)

    def test_image_dimensions_put_image_size_on_the_long_side(self):
        self.assertEqual(image_dimensions({"imageSize": 640}), (640, 640))
        self.assertEqual(image_dimensions({"aspect": "2:3", "imageSize": 960}), (640, 960))
        self.assertEqual(image_dimensions({"aspect": "16:9", "imageSize": 640}), (640, 360))

    def test_a_portrait_crop_keeps_the_middle(self):
        # a wide image cropped to 2:3 keeps its middle: the red/blue edge stays in the centre column
        result = crop(halves(60, 30), (8, 12))
        self.assertEqual(result.size, (8, 12))
        self.assertTrue(close(result.getpixel((1, 6)), RED))
        self.assertTrue(close(result.getpixel((6, 6)), BLUE))

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


class FakeTerminal(io.StringIO):
    def isatty(self):
        return True


class ProgressTest(unittest.TestCase):
    def test_a_terminal_gets_one_line_that_updates_itself(self):
        stream = FakeTerminal()
        progress = Progress(3, stream=stream)
        for _ in range(3):
            progress.step()
        progress.done()
        self.assertEqual(stream.getvalue().count("\n"), 1)
        self.assertIn("\r2 / 3 images handled", stream.getvalue())
        self.assertTrue(stream.getvalue().endswith("3 / 3 images handled\x1b[K\n"))

    def test_a_log_only_gets_the_final_count(self):
        stream = io.StringIO()
        progress = Progress(2, "images checked", stream=stream)
        progress.step()
        progress.step()
        progress.done()
        self.assertEqual(stream.getvalue(), "2 / 2 images checked\n")

    def test_nothing_to_do_prints_nothing(self):
        stream = FakeTerminal()
        Progress(0, stream=stream).done()
        self.assertEqual(stream.getvalue(), "")


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

    def test_a_copy_of_another_shape_is_made_again(self):
        source = self.root / "photo.png"
        halves(30, 60).save(source)
        item = {"id": "abc", "source": str(source)}
        ensure_image(self.project, item)
        self.project["aspect"] = "2:3"
        self.assertFalse(image_ready(self.project, item))
        with Image.open(ensure_image(self.project, item)) as image:
            self.assertEqual(image.size, (11, 16))

    def test_the_old_copy_stands_in_when_the_source_is_gone(self):
        source = self.root / "photo.png"
        halves(30, 60).save(source)
        item = {"id": "abc", "source": str(source)}
        path = ensure_image(self.project, item)
        source.unlink()
        self.project["aspect"] = "2:3"
        with mock.patch("sys.stderr", io.StringIO()):
            self.assertEqual(ensure_image(self.project, item), path)

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
