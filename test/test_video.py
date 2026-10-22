"""video.py: frames padded to 1920x1080, encoded with PyAV, in a temp folder from solid colour images (no network)."""
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import av  # noqa: E402
from PIL import Image, ImageChops  # noqa: E402

import collage  # noqa: E402
import common  # noqa: E402
import video  # noqa: E402

COLOURS = [(220, 0, 0), (0, 220, 0), (0, 0, 220)]


def assertColour(test, actual, expected):
    test.assertTrue(all(abs(a - e) < 40 for a, e in zip(actual, expected)), f"{actual} != {expected}")


class FitFrameTest(unittest.TestCase):
    def test_a_wide_collage_gets_bars_above_and_below(self):
        frame = video.fit_frame(Image.new("RGB", (1900, 950), "white"))
        self.assertEqual(frame.size, (1920, 1080))
        self.assertEqual(frame.getpixel((960, 2)), (0, 0, 0))
        self.assertEqual(frame.getpixel((960, 540)), (255, 255, 255))
        self.assertEqual(frame.getpixel((1, 540)), (255, 255, 255), "as wide as the frame")

    def test_a_squarish_collage_gets_bars_left_and_right_and_is_enlarged(self):
        frame = video.fit_frame(Image.new("RGB", (700, 600), "white"))
        self.assertEqual(frame.getpixel((10, 540)), (0, 0, 0))
        self.assertEqual(frame.getpixel((960, 1)), (255, 255, 255), "as tall as the frame")


class WriteVideoTest(unittest.TestCase):
    def test_each_image_shows_for_its_seconds(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "out.mp4"
            video.write_video(path, [(Image.new("RGB", video.SIZE, colour), 1) for colour in COLOURS])
            self.assertFalse(path.with_suffix(".part.mp4").exists())
            with av.open(str(path)) as container:
                stream = container.streams.video[0]
                self.assertEqual((stream.codec_context.name, stream.width, stream.height), ("h264", 1920, 1080))
                self.assertAlmostEqual(container.duration / av.time_base, 3, delta=0.5)
                frames = [(float(frame.pts * frame.time_base), frame.key_frame, frame.to_image()) for frame in container.decode(video=0)]
            self.assertEqual([time for time, key, _ in frames if key], [0.0, 1.0, 2.0], "a key frame where each image starts")
            middle = next(image for time, _, image in frames if time == 1.5)
            assertColour(self, middle.getpixel((960, 540)), COLOURS[1])


class VideoMainTest(unittest.TestCase):
    def project_with_items(self, folder, count=12):
        project = {"source": "local", "name": "a", "id": "local/a", "folder": "projects/local/a", "dir": folder, "imageSize": 8,
                   "collage": {"layout": "4x3/1", "canvasWidth": 50, "gap": 2}}
        (folder / "images").mkdir(parents=True)
        items = []
        for i in range(count):
            items.append({"id": f"i{i}", "source": "https://example.invalid/never-downloaded"})
            Image.new("RGB", (8, 8), COLOURS[i % 3]).save(folder / "images" / f"i{i}.jpg")
        common.write_data(project, {"items": items})
        return project

    def test_main_writes_a_living_collage(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = self.project_with_items(Path(tmp) / "a", count=20)
            argv = ["video", "--minutes", "0.1", "--every", "2", "--fade", "0.5"]  # 3 changes in 6 s
            with mock.patch.object(video, "load_project", lambda _json: project), mock.patch.object(sys, "argv", argv), \
                    redirect_stdout(io.StringIO()) as out:
                video.main()
            self.assertIn("(living, 0:06, a change every 2 s, layout 4x3/1", out.getvalue())
            with av.open(str(project["dir"] / "collage.mp4")) as container:
                self.assertAlmostEqual(container.duration / av.time_base, 6, delta=0.3)
                frames = [frame.to_image() for frame in container.decode(video=0)]
            self.assertEqual(len(frames), 60, "10 fps")
            # a hold is still: the frames of the first 1.5 s are the same (give or take compression), then it fades
            def difference(a, b):
                return max(channel[1] for channel in ImageChops.difference(a, b).getextrema())

            self.assertLess(difference(frames[0], frames[14]), 30)
            self.assertGreater(difference(frames[0], frames[59]), 100)

    def test_main_writes_the_project_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "projects" / "local" / "a"
            project = {"source": "local", "name": "a", "id": "local/a", "folder": "projects/local/a", "dir": folder, "imageSize": 8,
                       "collage": {"layout": "4x3/1", "canvasWidth": 50, "gap": 2}}
            (folder / "images").mkdir(parents=True)
            items = []
            for i in range(12):
                items.append({"id": f"i{i}", "source": "https://example.invalid/never-downloaded"})
                Image.new("RGB", (8, 8), COLOURS[i % 3]).save(folder / "images" / f"i{i}.jpg")
            common.write_data(project, {"items": items})

            argv = ["video", "--slideshow", "--segments", "2", "--seconds", "1"]
            with mock.patch.object(video, "load_project", lambda _json: project), mock.patch.object(sys, "argv", argv), \
                    redirect_stdout(io.StringIO()) as out:
                video.main()
            self.assertIn("Saved projects/local/a/collage.mp4 (2 x 1 s = 0:02, layout 4x3/1", out.getvalue())
            with av.open(str(folder / "collage.mp4")) as container:
                self.assertAlmostEqual(container.duration / av.time_base, 2, delta=0.5)

    def test_still_makes_a_one_frame_video_of_the_collage(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            project = {"source": "local", "name": "a", "id": "local/a", "folder": "projects/local/a", "dir": folder, "collage": {}}
            Image.new("RGB", (1412, 980), COLOURS[2]).save(folder / "collage.jpg")
            with mock.patch.object(video, "load_project", lambda _json: project), mock.patch.object(sys, "argv", ["video", "--still"]):
                video.main()
            with av.open(str(folder / "collage_still.mp4")) as container:
                frames = list(container.decode(video=0))
            self.assertEqual(len(frames), 1)
            assertColour(self, frames[0].to_image().getpixel((960, 540)), COLOURS[2])

    def test_still_needs_a_collage(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = {"id": "local/a", "folder": "projects/local/a", "dir": Path(tmp), "collage": {}}
            with mock.patch.object(video, "load_project", lambda _json: project), mock.patch.object(sys, "argv", ["video", "--still"]), \
                    self.assertRaises(SystemExit) as exited:
                video.main()
            self.assertIn("npm run collage", str(exited.exception))

    def test_segments_must_be_positive(self):
        with mock.patch.object(sys, "argv", ["video", "--segments", "0"]), self.assertRaises(SystemExit):
            video.main()


class PickTest(unittest.TestCase):
    ITEMS = [{"id": str(i)} for i in range(10)]

    def test_no_item_twice_and_the_centre_is_not_a_tile(self):
        for _ in range(20):
            picked = collage.pick(self.ITEMS, [(c, 0) for c in range(6)])
            ids = [item["id"] for _, item in picked["tiles"]]
            self.assertEqual(len(ids), len(set(ids)))
            self.assertNotIn(picked["centre"]["id"], ids)

    def test_latest_and_fill(self):
        self.assertEqual(collage.pick(self.ITEMS, [], "latest")["centre"]["id"], "9")
        picked = collage.pick(self.ITEMS, [(c, 0) for c in range(4)], "fill", randomize=False)
        self.assertIsNone(picked["centre"])
        self.assertEqual([item["id"] for _, item in picked["tiles"]], ["6", "7", "8", "9"])


if __name__ == "__main__":
    unittest.main()
