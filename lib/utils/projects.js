// the config: settings.json (committed defaults) + the gitignored projects.json (your projects, see projects.example.json)
// -> a project. Every project is one source plus a name, with its own folder projects/<source>/<name>/ (items.json, images/,
// collage.jpg). The only place that resolves projects; the python scripts get the resolved project from scripts/python.js
// (runPython, as --project-json). Node built-ins only (setup runs before `npm ci`)
const path = require("node:path");

const { SOURCES } = require("../sources");
const { ROOT, readJson, writeJson } = require("./files");

const NAME = /^[a-z0-9][a-z0-9-]*$/;

// -p mix: a random project (allowMix isn't false) instead of a named one, a reserved name
const MIX = "mix";

const MIX_COMMANDS = "collage, video, random-meet, daily-new and meet";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// objects merge key by key (collage too), anything else (numbers, lists like skip) is replaced
const deepMerge = (...layers) => layers.reduce((merged, layer) => {
    for (const [key, value] of Object.entries(layer ?? {})) {
        merged[key] = isPlainObject(value) && isPlainObject(merged[key]) ? deepMerge(merged[key], value) : value;
    }
    return merged;
}, {});

const readSettings = (root = ROOT) => readJson(path.join(root, "settings.json"), {});

const readProjects = (root = ROOT) => readJson(path.join(root, "projects.json"), {});

const writeProjects = (projects, root = ROOT) => writeJson(path.join(root, "projects.json"), projects);

const sourceNames = (settings) => Object.keys(settings.sources ?? {});

// [{ source, name }] of every project in projects.json, for the sources settings.json knows
const listProjects = (settings, projects) => sourceNames(settings)
    .flatMap((source) => Object.keys(projects[source] ?? {}).map((name) => ({ source, name })));

// "spotify/album" -> { source: "spotify", project: "album" }, "album" -> { project: "album" }
const splitId = (id) => {
    const [first, second] = String(id ?? "").split("/");
    return second === undefined ? { project: first || undefined } : { source: first, project: second };
};

// pure: settings.json + projects.json + the --source/--project flags (both optional) -> the project
const resolveProject = (settings, projects, { source, project } = {}, root = ROOT) => {
    const sources = sourceNames(settings);
    const all = listProjects(settings, projects);
    const add = "add one with `npm run setup`";

    if (project === MIX) {
        throw new Error(`-p ${MIX} only works with ${MIX_COMMANDS}`);
    }

    if (project?.includes("/")) {
        const split = splitId(project);
        if (source && source !== split.source) {
            throw new Error(`--source ${source} doesn't match --project ${project}`);
        }
        ({ source, project } = split);
    }
    if (source && !sources.includes(source)) {
        throw new Error(`Unknown source "${source}" - the sources are: ${sources.join(", ")}`);
    }

    if (!project) {
        const fallback = splitId(projects.default || settings.default);
        if (!source || source === fallback.source) {
            ({ source, project } = fallback);
        } else {
            project = Object.keys(projects[source] ?? {})[0];
            if (!project) {
                throw new Error(`No ${source} projects in projects.json - ${add}`);
            }
        }
    } else if (!source) {
        const matches = all.filter(({ name }) => name === project);
        if (matches.length > 1) {
            throw new Error(`"${project}" is a project in ${matches.map((match) => match.source).join(" and ")} - pick one with --source`);
        }
        source = matches[0]?.source;
    }

    const entry = projects[source]?.[project];
    if (!entry) {
        const known = all.map(({ source: s, name }) => `${s}/${name}`).join(", ") || "none yet";
        throw new Error(`Unknown project "${source ? `${source}/` : ""}${project}" - the projects in projects.json are: ${known} (${add})`);
    }
    if (!NAME.test(project)) {
        throw new Error(`Project name "${project}" can only have lowercase letters, digits and - (it's a folder name)`);
    }

    const merged = deepMerge(settings.defaults, settings.sources[source], entry);
    const folder = `projects/${source}/${project}`;
    const resolved = { ...merged, source, name: project, id: `${source}/${project}`, folder, dir: path.join(root, folder) };
    // the source adds its own fields (playlistId, listId, path, ...)
    Object.assign(resolved, SOURCES[source]?.resolve?.(merged));
    return resolved;
};

module.exports = { NAME, MIX, deepMerge, readSettings, readProjects, writeProjects, sourceNames, listProjects, splitId, resolveProject };
