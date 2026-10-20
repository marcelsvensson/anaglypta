"""The project the python scripts get from Node (--project-json), and items.json. Resolving projects is tested in
test/project.test.js: only Node does it."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from common import load_project, read_data, read_items, write_data  # noqa: E402


class LoadProjectTest(unittest.TestCase):
    def test_takes_the_project_node_resolved(self):
        resolved = {"source": "local", "name": "cats", "id": "local/cats", "dir": "/root/projects/local/cats", "collage": {"layout": "auto"}}
        project = load_project(json.dumps(resolved))
        self.assertEqual(project["dir"], Path("/root/projects/local/cats"))
        self.assertEqual({**project, "dir": str(project["dir"])}, resolved)

    def test_without_it_explains_how_to_run_it(self):
        with self.assertRaises(SystemExit) as exited:
            load_project(None)
        self.assertIn("npm run collage", str(exited.exception))


class ItemsTest(unittest.TestCase):
    def test_read_items_keeps_the_order_and_the_first_of_each_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = {"source": "local", "name": "cats", "dir": Path(tmp)}
            self.assertEqual(read_data(project), {"source": "local", "project": "cats", "state": {}, "items": []})
            write_data(project, {"items": [{"id": "b"}, {"id": "a", "n": 1}, {"id": "a", "n": 2}, {"title": "no id"}]})
            self.assertEqual(read_items(project), [{"id": "b"}, {"id": "a", "n": 1}])


if __name__ == "__main__":
    unittest.main()
