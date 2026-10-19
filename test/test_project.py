"""resolve_project runs the same cases as test/project.test.js, so the python and node resolvers agree."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from common import deep_merge, read_data, read_items, resolve_project, write_data  # noqa: E402

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
