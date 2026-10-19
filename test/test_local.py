"""The local source on a temp folder of generated images (no network, nothing outside the temp dir)."""
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(SCRIPTS / "sources"))

from PIL import Image  # noqa: E402

import local  # noqa: E402
from common import read_data  # noqa: E402

DAY = 24 * 60 * 60


class LocalSourceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.folder = root / "photos"
        (self.folder / "sub").mkdir(parents=True)
        (self.folder / ".hidden").mkdir()
        self.project = {"source": "local", "name": "cats", "id": "local/cats", "dir": root / "projects" / "local" / "cats",
                        "path": str(self.folder), "maxItems": 200, "imageSize": 16}

        # taken in 2020 (EXIF), but the newest file on disk - the file's date decides
        exif = Image.Exif()
        exif.get_ifd(local.EXIF_IFD)[local.DATE_TAKEN] = "2020:05:01 10:00:00"
        Image.new("RGB", (40, 20), "red").save(self.folder / "taken.jpg", exif=exif)
        self.image("old.png", (20, 40), days_ago=30)
        self.image("middle.webp", (30, 30), days_ago=10)
        self.image("sub/deeper.jpg", (8, 8), days_ago=50)
        self.image(".secret.jpg", (8, 8))
        self.image(".hidden/inside.jpg", (8, 8))
        (self.folder / "broken.jpg").write_bytes(b"not an image")
        (self.folder / "notes.txt").write_text("hello")

    def tearDown(self):
        self.tmp.cleanup()

    def image(self, name, size, days_ago=0):
        path = self.folder / name
        Image.new("RGB", size, "blue").save(path)
        when = path.stat().st_mtime - days_ago * DAY
        os.utime(path, (when, when))
        return path

    def fetch(self, limit=None):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as stderr:
            counts = local.fetch(self.project, limit)
        return counts, stderr.getvalue()

    def titles(self):
        return [item["title"] for item in read_data(self.project)["items"]]

    def test_scan_skips_subfolders_and_hidden_files_and_counts_the_rest(self):
        images, others = local.scan(self.folder)
        self.assertEqual(sorted(path.name for path in images), ["broken.jpg", "middle.webp", "old.png", "taken.jpg"])
        self.assertEqual(others, 1)

    def test_adds_the_newest_last_with_square_copies(self):
        (added, dropped, skipped), stderr = self.fetch()
        self.assertEqual((added, dropped, skipped), (3, 0, 1))
        self.assertIn("broken.jpg", stderr)
        self.assertEqual(self.titles(), ["old", "middle", "taken"])
        items = read_data(self.project)["items"]
        self.assertEqual(items[2]["addedAt"], "2020-05-01T10:00:00")
        self.assertEqual(items[0]["subtitle"], "photos")
        for item in items:
            with Image.open(self.project["dir"] / "images" / f"{item['id']}.jpg") as image:
                self.assertEqual(image.size, (16, 16))

    def test_an_unreadable_file_is_only_reported_once(self):
        _, stderr = self.fetch()
        self.assertIn("broken.jpg", stderr)
        (_, _, skipped), stderr = self.fetch()
        self.assertEqual((skipped, stderr), (0, ""))
        # fixed (a new id): tried again
        Image.new("RGB", (9, 9)).save(self.folder / "broken.jpg")
        (added, _, _), _ = self.fetch()
        self.assertEqual(added, 1)
        self.assertEqual(read_data(self.project)["state"]["unreadable"], [])

    def test_limit_adds_one_at_a_time_newest_first(self):
        self.fetch(limit=1)
        self.assertEqual(self.titles(), ["taken"])
        self.fetch(limit=1)
        self.assertEqual(self.titles(), ["taken", "middle"])

    def test_max_items_keeps_the_newest(self):
        self.project["maxItems"] = 2
        self.fetch()
        self.assertEqual(self.titles(), ["middle", "taken"])

    def test_new_files_push_the_oldest_out(self):
        self.project["maxItems"] = 2
        self.fetch()
        pushed = read_data(self.project)["items"][0]
        self.image("new.jpg", (8, 8))
        (added, dropped, _), _ = self.fetch()
        self.assertEqual((added, dropped), (1, 1))
        self.assertEqual(self.titles(), ["taken", "new"])
        self.assertFalse((self.project["dir"] / "images" / f"{pushed['id']}.jpg").exists())

    def test_only_the_files_it_adds_are_opened(self):
        self.project["maxItems"] = 1
        with mock.patch.object(local.Image, "open", wraps=local.Image.open) as opened:
            self.fetch()
        # broken.jpg is the newest file, it fails and frees its place for taken.jpg (opened for its date and its copy)
        self.assertEqual([Path(call.args[0]).name for call in opened.call_args_list if call.args], ["broken.jpg", "taken.jpg", "taken.jpg"])

    def test_gone_files_are_dropped_with_their_copy(self):
        self.fetch()
        gone = next(item for item in read_data(self.project)["items"] if item["title"] == "old")
        (self.folder / "old.png").unlink()
        (added, dropped, _), _ = self.fetch()
        self.assertEqual((added, dropped), (0, 1))
        self.assertEqual(self.titles(), ["middle", "taken"])
        self.assertFalse((self.project["dir"] / "images" / f"{gone['id']}.jpg").exists())

    def test_an_edited_file_comes_back_as_new(self):
        self.fetch()
        self.image("old.png", (50, 10), days_ago=1)
        self.fetch()
        self.assertEqual(self.titles(), ["middle", "taken", "old"])

    def test_a_missing_folder_exits(self):
        self.project["path"] = str(self.folder / "nope")
        with self.assertRaises(SystemExit):
            self.fetch()


if __name__ == "__main__":
    unittest.main()
