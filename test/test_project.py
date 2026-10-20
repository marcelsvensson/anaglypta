"""resolve_project runs the same cases as test/project.test.js, so the python and node resolvers agree."""
import json
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from common import (deep_merge, load_project, mix_candidates, pick_mix, pick_mix_project, read_data, read_items,  # noqa: E402
                    resolve_project, write_data)

FIXTURE = json.loads((Path(__file__).resolve().parent / "fixtures" / "project-cases.json").read_text(encoding="utf-8"))


class ResolveProjectTest(unittest.TestCase):
    def test_shared_cases(self):
        settings, projects = FIXTURE["settings"], FIXTURE["projects"]
        for case in FIXTURE["cases"]:
            flags = case["flags"]
            with self.subTest(flags=flags):
                if "error" in case:
                    with self.assertRaises(ValueError) as raised:
                        resolve_project(settings, projects, flags.get("source"), flags.get("project"), "/root")
                    self.assertIn(case["error"], str(raised.exception))
                    continue
                project = resolve_project(settings, projects, flags.get("source"), flags.get("project"), "/root")
                for key, value in case["expected"].items():
                    self.assertEqual(project[key], value, key)
                self.assertEqual(project["dir"], Path("/root") / project["folder"])

    def test_mix_candidates(self):
        for case in FIXTURE["mixCases"]:
            with self.subTest(source=case["source"]):
                self.assertEqual(mix_candidates(FIXTURE["settings"], FIXTURE["projects"], case["source"]), case["expected"])

    def test_pick_mix(self):
        self.assertEqual(pick_mix(["a", "b", "c"], {}, lambda: 0), ("a", {"used": ["a"], "last": "a"}))
        self.assertEqual(pick_mix(["a", "b", "c"], {"used": ["a"], "last": "a"}, lambda: 0.99), ("c", {"used": ["a", "c"], "last": "c"}))
        self.assertEqual(pick_mix(["a", "b", "c"], {"used": ["a", "c"], "last": "c"}, lambda: 0)[0], "b")
        # a new round, without c (the last one)
        self.assertEqual(pick_mix(["a", "b", "c"], {"used": ["a", "b", "c"], "last": "c"}, lambda: 0.99), ("b", {"used": ["b"], "last": "b"}))
        # gone projects drop out of the round, a new one joins it
        self.assertEqual(pick_mix(["b", "d"], {"used": ["a", "b"], "last": "b"}, lambda: 0)[0], "d")
        self.assertEqual(pick_mix(["a"], {"used": ["a"], "last": "a"}, lambda: 0)[0], "a")
        self.assertIsNone(pick_mix([], {}))
        # the old { last } state still works
        self.assertEqual(pick_mix(["a", "b"], {"last": "a"}, lambda: 0)[0], "a")

    def test_pick_mix_shows_every_candidate_once_per_round(self):
        candidates, state, picks = ["a", "b", "c", "d"], {}, []
        for _ in range(12):
            chosen, state = pick_mix(candidates, state)
            picks.append(chosen)
        for start in range(0, 12, 4):
            self.assertEqual(sorted(picks[start:start + 4]), candidates)
        self.assertTrue(all(a != b for a, b in zip(picks, picks[1:])))

    def test_pick_mix_project(self):
        settings, projects = FIXTURE["settings"], FIXTURE["projects"]
        with tempfile.TemporaryDirectory() as tmp, mock.patch("builtins.print"):
            for project_id in ["local/cats", "local/dogs", "spotify/album"]:
                project = resolve_project(settings, projects, project=project_id, root=tmp)
                project["dir"].mkdir(parents=True)
                write_data(project, {"items": [{"id": "a"}]})
            picked = [pick_mix_project(settings, projects, root=tmp, rand=lambda: 0)["id"] for _ in range(4)]
            # tmdb/series has no items, spotify/cats opts out, every one once per round
            self.assertEqual(picked, ["local/cats", "local/dogs", "spotify/album", "local/cats"])
            self.assertEqual(json.loads((Path(tmp) / "projects" / ".mix.json").read_text()), {"used": ["local/cats"], "last": "local/cats"})
            self.assertEqual(pick_mix_project(settings, projects, "spotify", tmp)["id"], "spotify/album")
            with self.assertRaisesRegex(ValueError, "No tmdb projects in the mix"):
                pick_mix_project(settings, projects, "tmdb", tmp)
            with self.assertRaisesRegex(ValueError, "Unknown source"):
                pick_mix_project(settings, projects, "instagram", tmp)

    def test_load_project_only_takes_mix_when_asked_to(self):
        with mock.patch("common.read_json", return_value={}), mock.patch("common.pick_mix_project", return_value={"id": "x"}) as pick:
            with self.assertRaises(SystemExit) as exited:
                load_project(project="mix")
            self.assertIn("only works with", str(exited.exception))
            self.assertEqual(load_project(project="mix", mix=True), {"id": "x"})
            pick.assert_called_once()

    def test_settings_default_without_a_projects_default(self):
        projects = {key: value for key, value in FIXTURE["projects"].items() if key != "default"}
        self.assertEqual(resolve_project(FIXTURE["settings"], projects)["id"], "spotify/album")

    def test_expands_home_in_a_local_path(self):
        project = resolve_project(FIXTURE["settings"], {"local": {"pics": {"path": "~/Pictures"}}}, project="pics")
        self.assertEqual(project["path"], str(Path.home() / "Pictures"))

    def test_deep_merge(self):
        self.assertEqual(deep_merge({"a": {"b": 1, "c": [1]}}, None, {"a": {"c": [], "d": 2}}), {"a": {"b": 1, "c": [], "d": 2}})


class ItemsTest(unittest.TestCase):
    def test_read_items_keeps_the_order_and_the_first_of_each_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = {"source": "local", "name": "cats", "dir": Path(tmp)}
            self.assertEqual(read_data(project), {"source": "local", "project": "cats", "state": {}, "items": []})
            write_data(project, {"items": [{"id": "b"}, {"id": "a", "n": 1}, {"id": "a", "n": 2}, {"title": "no id"}]})
            self.assertEqual(read_items(project), [{"id": "b"}, {"id": "a", "n": 1}])


if __name__ == "__main__":
    unittest.main()
