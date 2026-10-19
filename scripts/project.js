// sources -> projects: every project is one source (spotify, local, ...) plus a name, with its own folder
// projects/<source>/<name>/ (items.json, images/, collage.jpg). settings.json has the committed defaults, the gitignored
// projects.json your projects (see projects.example.json). scripts/common.py resolve_project() is the python twin of
// resolveProject(), test/fixtures/project-cases.json keeps the two in step.
// uses node built-ins only (setup.js runs before `npm ci`)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const NAME = /^[a-z0-9][a-z0-9-]*$/;

const expandHome = (file) => (file === "~" || file.startsWith("~/") ? path.join(os.homedir(), file.slice(1)) : file);

// "https://open.spotify.com/playlist/<id>?si=..", "spotify:playlist:<id>" or "<id>" -> "<id>", anything else -> null
const parsePlaylistId = (input) => {
    const text = String(input ?? "").trim();
    const match = text.match(/playlist[/:]([A-Za-z0-9]{22})(?![A-Za-z0-9])/) || text.match(/^([A-Za-z0-9]{22})$/);
    return match ? match[1] : null;
};

// "https://www.themoviedb.org/list/8512345-my-series?..." or "8512345" -> "8512345", anything else -> null
const parseListId = (input) => {
    const text = String(input ?? "").trim();
    const match = text.match(/list\/(\d+)/) || text.match(/^(\d+)$/);
    return match ? match[1] : null;
};

// "Chill Vibes 🌊" -> "chill-vibes", "Blåbär & Ö" -> "blabar-o", a project name that works as a folder name
const toKebab = (text) => String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// objects merge key by key (collage.center too), anything else (numbers, lists like skip) is replaced
const deepMerge = (...layers) => layers.reduce((merged, layer) => {
    for (const [key, value] of Object.entries(layer ?? {})) {
        merged[key] = isPlainObject(value) && isPlainObject(merged[key]) ? deepMerge(merged[key], value) : value;
    }
    return merged;
}, {});

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");

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
    if (source === "spotify") {
        resolved.playlistId = parsePlaylistId(merged.playlist);
    }
    if (source === "tmdb") {
        resolved.listId = parseListId(merged.list);
    }
    if (source === "local" && merged.path) {
        resolved.path = expandHome(merged.path);
    }
    return resolved;
};

// reads settings.json and projects.json, flags = { source, project }
const getProject = (flags, root = ROOT) => resolveProject(readSettings(root), readProjects(root), flags, root);

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

// items.json: { source, project, state: {...}, items: [{ id, title, subtitle, addedAt, source }] }, oldest item first
const itemsPath = (dir) => path.join(dir, "items.json");

const readData = (project) => {
    const data = readJson(itemsPath(project.dir), {});
    return { ...data, source: project.source, project: project.name, state: { ...data.state }, items: data.items ?? [] };
};

const writeData = (project, data) => {
    fs.mkdirSync(project.dir, { recursive: true });
    writeJson(itemsPath(project.dir), data);
};

module.exports = {
    ROOT,
    NAME,
    expandHome,
    parsePlaylistId,
    parseListId,
    toKebab,
    deepMerge,
    readSettings,
    readProjects,
    writeProjects,
    sourceNames,
    listProjects,
    resolveProject,
    getProject,
    parseProjectArgs,
    projectArgs,
    readData,
    writeData,
};
