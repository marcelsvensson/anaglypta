"""cache.py on a temp project: local files and already cached images, no network."""
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from PIL import Image  # noqa: E402

import cache  # noqa: E402
from common import image_path, write_data  # noqa: E402


class CacheTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.project = {"source": "local", "name": "cats", "id": "local/cats", "folder": "projects/local/cats",
                        "dir": self.root / "projects" / "local" / "cats", "imageSize": 8}

    def tearDown(self):
        self.tmp.cleanup()

    def photo(self, name):
        path = self.root / name
        Image.new("RGB", (20, 10), "red").save(path)
        return str(path)

    def test_makes_only_the_missing_images_and_counts_failures(self):
        items = [{"id": "a", "source": self.photo("a.png")}, {"id": "b", "source": str(self.root / "gone.png")},
                 {"id": "c", "source": self.photo("c.png")}]
        write_data(self.project, {"items": items})
        with redirect_stderr(io.StringIO()):
            self.assertEqual(cache.cache(self.project), (2, 1, 0))
            self.assertEqual(cache.cache(self.project), (0, 1, 0), "only the failed one is tried again")
        with Image.open(image_path(self.project, items[0])) as image:
            self.assertEqual(image.size, (8, 8))

    def test_gives_up_when_nothing_works(self):
        items = [{"id": str(i), "source": f"https://example.invalid/{i}.jpg"} for i in range(10)]
        write_data(self.project, {"items": items})
        with mock.patch.object(cache, "ensure_image", return_value=None) as ensure, redirect_stderr(io.StringIO()):
            self.assertEqual(cache.cache(self.project), (0, 3, 7))
        self.assertEqual(ensure.call_count, 3)


if __name__ == "__main__":
    unittest.main()
