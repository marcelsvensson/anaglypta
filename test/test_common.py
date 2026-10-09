import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from common import TMP, album_sort_key, canvas_size, cell_xy, cover_path, parse_frontmatter  # noqa: E402


class AlbumSortKeyTest(unittest.TestCase):
    def test_same_day_files_keep_their_order(self):
        files = ["2025-08-11-10.md", "2025-08-11-1.md", "2025-08-12.md", "2025-08-11-0.md", "2025-08-11.md", "2025-08-11-2.md"]
        self.assertEqual(
            sorted(files, key=album_sort_key),
            ["2025-08-11.md", "2025-08-11-0.md", "2025-08-11-1.md", "2025-08-11-2.md", "2025-08-11-10.md", "2025-08-12.md"],
        )


class ParseFrontmatterTest(unittest.TestCase):
    def test_new_quoted_format(self):
        text = '---\n    artist: "Guns N\' Roses: Live"\n    album: "Say \\"Hi\\""\n    id: "abc"\n    images: https://i.scdn.co/image/x\n    tags:\n    - "metal"\n---'
        data = parse_frontmatter(text)
        self.assertEqual(data["artist"], "Guns N' Roses: Live")
        self.assertEqual(data["album"], 'Say "Hi"')
        self.assertEqual(data["id"], "abc")
        self.assertEqual(data["images"], "https://i.scdn.co/image/x")
        self.assertNotIn("- \"metal\"", data)

    def test_old_unquoted_format(self):
        text = "---\n    artist: Blood Incantation\n    release: \"2024-10-04\"\n    images: https://i.scdn.co/image/y\n    tags: \n    - death metal\n---"
        data = parse_frontmatter(text)
        self.assertEqual(data["artist"], "Blood Incantation")
        self.assertEqual(data["release"], "2024-10-04")
        self.assertEqual(data["images"], "https://i.scdn.co/image/y")

    def test_no_frontmatter(self):
        self.assertEqual(parse_frontmatter("just text"), {})
        self.assertEqual(parse_frontmatter(""), {})


class CoverPathTest(unittest.TestCase):
    def test_one_cover_per_album(self):
        song = {"albumId": "A1", "id": "t1", "file": "2026-01-01.md"}
        other_song = {"albumId": "A1", "id": "t2", "file": "2026-01-02.md"}
        self.assertEqual(cover_path("album", song), TMP / "covers" / "A1.jpeg")
        self.assertEqual(cover_path("album", song), cover_path("album", other_song))

    def test_old_files_without_album_id_use_the_track_id(self):
        self.assertEqual(cover_path("album", {"id": "t1", "file": "x.md"}), TMP / "covers" / "t1.jpeg")


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
