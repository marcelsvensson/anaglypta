// the local source: the images in a folder on this computer (local.py does the work). projects.json: local.<name>.path
const { expandHome } = require("../../utils/files");

const SCRIPT = "lib/sources/local/local.py";

module.exports = {
    name: "local",
    label: "local",
    description: "the images in a folder on this computer",
    SCRIPT,
    resolve: (entry) => (entry.path ? { path: expandHome(entry.path) } : {}),
    fetch: (project, { limit }) => {
        const { runPython } = require("../../../scripts/python");
        if (runPython(SCRIPT, project, limit === Infinity ? [] : ["--limit", String(limit)]) !== 0) {
            throw new Error(`${SCRIPT} failed`);
        }
    },
    // setup: asks for a new project -> { name, entry } (its projects.json entry), null = skipped
    addProject: (input, projects) => require("./setup").addProject(input, projects),
    // setup: a line shown before the project is removed, null = none
    removeNote: (project) => require("./setup").removeNote(project),
};
