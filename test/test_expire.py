"""expire_cache: the cache limit of sources like tmdb, with fixed dates (no network)."""
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from common import expire_cache, image_path, read_data, report_expired, write_data  # noqa: E402

NOW = datetime(2026, 10, 20, 12, 0)


class ExpireCacheTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.project = {"source": "tmdb", "name": "s", "id": "tmdb/s", "dir": Path(self.tmp.name) / "s", "maxCacheDays": 180}

    def tearDown(self):
        self.tmp.cleanup()

    def item(self, item_id, fetched_days_ago, image_days_ago=None):
        item = {"id": item_id, "fetchedAt": (NOW - timedelta(days=fetched_days_ago)).date().isoformat()}
        if image_days_ago is not None:
            path = image_path(self.project, item)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"x")
            when = (NOW - timedelta(days=image_days_ago)).timestamp()
            os.utime(path, (when, when))
        return item

    def test_removes_what_is_past_the_limit_and_counts_what_is_close(self):
        items = [self.item("fresh", 10, 149), self.item("soon", 10, 151), self.item("old-image", 10, 181),
                 self.item("old-item", 181, 10), self.item("no-image", 10)]
        write_data(self.project, {"items": items})
        counts = expire_cache(self.project, NOW)
        self.assertEqual(counts, {"items": 1, "images": 1, "soon": 1})
        self.assertEqual([item["id"] for item in read_data(self.project)["items"]], ["fresh", "soon", "old-image", "no-image"])
        self.assertTrue(image_path(self.project, items[0]).exists())
        self.assertFalse(image_path(self.project, items[2]).exists(), "re-downloaded when needed")
        self.assertFalse(image_path(self.project, items[3]).exists(), "goes with its item")

    def test_old_items_without_fetched_at_use_added_at(self):
        write_data(self.project, {"items": [{"id": "a", "addedAt": "2026-01-01"}, {"id": "b", "addedAt": "not a date"}]})
        self.assertEqual(expire_cache(self.project, NOW)["items"], 1)
        self.assertEqual([item["id"] for item in read_data(self.project)["items"]], ["b"])

    def test_sources_without_a_limit_are_never_touched(self):
        del self.project["maxCacheDays"]
        write_data(self.project, {"items": [self.item("old", 999, 999)]})
        self.assertEqual(expire_cache(self.project, NOW), {"items": 0, "images": 0, "soon": 0})
        self.assertEqual(len(read_data(self.project)["items"]), 1)

    def test_report_explains_what_happened(self):
        with redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()) as err:
            report_expired(self.project, {"items": 2, "images": 1, "soon": 3})
            report_expired(self.project, {"items": 0, "images": 0, "soon": 0})
        self.assertIn("2 item(s) of tmdb/s were last fetched over 180 days ago", err.getvalue())
        self.assertIn("npm run full -- -p tmdb/s", err.getvalue())
        self.assertIn("3 image(s) of tmdb/s expire within 30 days", out.getvalue())


if __name__ == "__main__":
    unittest.main()
