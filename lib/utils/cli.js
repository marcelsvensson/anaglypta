// what an entry point (scripts/*.js) does to get its project: -s/-p from the command line -> the project (or -p mix's pick)
const { ROOT } = require("./files");
const { MIX, readSettings, readProjects, resolveProject } = require("./projects");
const { pickMixProject } = require("./mix");

// reads settings.json and projects.json, flags = { source, project }. mix: true lets -p mix pick a random project
// (never one of skipSources)
const getProject = (flags, root = ROOT, { mix = false, skipSources = [] } = {}) => {
    const settings = readSettings(root);
    const projects = readProjects(root);
    if (mix && flags.project === MIX) {
        return pickMixProject(settings, projects, flags.source, root, { skipSources });
    }
    return resolveProject(settings, projects, flags, root);
};

// -s/--source <name>, -p/--project <name> (also --project=<name>) -> { source, project, rest } (rest = the other args)
const parseProjectArgs = (argv) => {
    const flags = { "-s": "source", "--source": "source", "-p": "project", "--project": "project" };
    const parsed = { source: undefined, project: undefined, rest: [] };
    for (let i = 0; i < argv.length; i++) {
        const [flag, inline] = argv[i].startsWith("--") ? argv[i].split(/=(.*)/s) : [argv[i]];
        const key = flags[flag];
        if (!key) {
            parsed.rest.push(argv[i]);
            continue;
        }
        const value = inline ?? argv[++i];
        if (!value || value.startsWith("-")) {
            throw new Error(`${flag} needs a name, like ${flag} ${key === "source" ? "spotify" : "album"}`);
        }
        parsed[key] = value;
    }
    return parsed;
};

// the flags that pick this project, for passing on to the next script
const projectArgs = (project) => ["--source", project.source, "--project", project.name];

module.exports = { getProject, parseProjectArgs, projectArgs };
