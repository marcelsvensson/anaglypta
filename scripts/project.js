// sources -> projects: every project is one source (spotify, local, ...) plus a name, with its own folder
// projects/<source>/<name>/ (items.json, images/, collage.jpg). settings.json has the committed defaults, the gitignored
// projects.json your projects (see projects.example.json). Only Node reads them: the python scripts get the resolved
// project from scripts/python.js (runPython, as --project-json).
// uses node built-ins only (setup.js runs before `npm ci`)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const NAME = /^[a-z0-9][a-z0-9-]*$/;
// -p mix: a random project (allowMix isn't false) instead of a named one, a reserved name
const MIX = "mix";
const MIX_COMMANDS = "collage, random-meet, daily-new and meet";

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

// objects merge key by key (collage too), anything else (numbers, lists like skip) is replaced
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

// pure: the projects -p mix picks from (all of them, or the --source ones), unless they set allowMix: false. sorted ids
const mixCandidates = (settings, projects, { source } = {}) => listProjects(settings, projects)
    .filter((entry) => !source || entry.source === source)
    .flatMap(({ source: s, name }) => {
        try {
            return [resolveProject(settings, projects, { source: s, project: name })];
        } catch {
            return []; // a broken entry (a bad name) is left out, naming it with -p still explains why
        }
    })
    .filter((project) => project.allowMix !== false)
    .map((project) => project.id)
    .sort();

// pure: cycles through the candidates in random order, each once per round. state = { used: [ids this round], last }.
// a new round never starts with the one the last round ended on (unless it's the only one). null when there's none
const pickMix = (candidates, state = {}, random = Math.random) => {
    let used = (state.used ?? []).filter((id) => candidates.includes(id));
    let pool = candidates.filter((id) => !used.includes(id));
    if (!pool.length) {
        used = [];
        pool = candidates.length > 1 ? candidates.filter((id) => id !== state.last) : candidates;
    }
    if (!pool.length) {
        return null;
    }
    const id = pool[Math.floor(random() * pool.length)];
    return { id, state: { used: [...used, id], last: id } };
};

// projects/.mix.json remembers this round's picks, so every project comes up before one comes back
const mixStatePath = (root) => path.join(root, "projects", ".mix.json");

// -p mix: the next project of the round that has items (one without would need fetching first), remembered in projects/.mix.json
const pickMixProject = (settings, projects, source, root, random = Math.random) => {
    if (source && !sourceNames(settings).includes(source)) {
        throw new Error(`Unknown source "${source}" - the sources are: ${sourceNames(settings).join(", ")}`);
    }
    const candidates = mixCandidates(settings, projects, { source });
    const ready = candidates.filter((id) => readData(resolveProject(settings, projects, { project: id }, root)).items.length);
    const empty = candidates.filter((id) => !ready.includes(id));
    if (empty.length) {
        console.log(`Mix: leaving out ${empty.join(", ")} (nothing fetched yet, run \`npm run full -- -p <project>\`)`);
    }
    const { id, state } = pickMix(ready, readJson(mixStatePath(root), {}), random) ?? {};
    if (!id) {
        throw new Error(`No ${source ? `${source} ` : ""}projects in the mix - they all have allowMix: false or nothing fetched yet`);
    }
    fs.mkdirSync(path.dirname(mixStatePath(root)), { recursive: true });
    writeJson(mixStatePath(root), state);
    console.log(`Mix: ${id}`);
    return resolveProject(settings, projects, { project: id }, root);
};

// reads settings.json and projects.json, flags = { source, project }. mix: true lets -p mix pick a random project
const getProject = (flags, root = ROOT, { mix = false } = {}) => {
    const settings = readSettings(root);
    const projects = readProjects(root);
    if (mix && flags.project === MIX) {
        return pickMixProject(settings, projects, flags.source, root);
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

// items.json: { source, project, state: {...}, items: [{ id, title, subtitle, addedAt, source }] }, oldest item first
const itemsPath = (dir) => path.join(dir, "items.json");

const readData = (project) => {
    const data = readJson(itemsPath(project.dir), {});
    return { ...data, source: project.source, project: project.name, state: { ...data.state }, items: data.items ?? [] };
};

// a source's cache limit (maxCacheDays, tmdb: 180) is renewed this long before it runs out
const REFRESH_BEFORE_DAYS = 30;

// the project's cached images older than days, oldest first: [{ id, file, days }]
const oldImages = (dir, items, days, now = Date.now()) => items
    .map((item) => ({ id: item.id, file: path.join(dir, "images", `${item.id}.jpg`) }))
    .filter(({ file }) => fs.existsSync(file))
    .map((image) => ({ ...image, days: (now - fs.statSync(image.file).mtimeMs) / 86400000 }))
    .filter((image) => image.days > days)
    .sort((a, b) => b.days - a.days);

// for the project list in setup: "", or a note when images are close to (or past) the source's cache limit
const cacheNote = (project, now = Date.now()) => {
    if (!project.maxCacheDays) {
        return "";
    }
    const old = oldImages(project.dir, readData(project).items, project.maxCacheDays - REFRESH_BEFORE_DAYS, now);
    if (!old.length) {
        return "";
    }
    const expired = old.filter((image) => image.days > project.maxCacheDays).length;
    return expired
        ? ` - ${expired} image(s) past the ${project.maxCacheDays}-day limit, run \`npm run full -- -p ${project.id}\``
        : ` - ${old.length} image(s) expire within ${REFRESH_BEFORE_DAYS} days, run \`npm run full -- -p ${project.id}\``;
};

const writeData = (project, data) => {
    fs.mkdirSync(project.dir, { recursive: true });
    writeJson(itemsPath(project.dir), data);
};

// removes what's older than the source allows (maxCacheDays): items whose data wasn't confirmed by a fetch (fetchedAt,
// else addedAt) and images downloaded (file date) that long ago. returns { items, images, soon } counts, soon = images
// that expire within REFRESH_BEFORE_DAYS. does nothing for sources without a limit
const expireCache = (project, now = Date.now()) => {
    const counts = { items: 0, images: 0, soon: 0 };
    const maxDays = project.maxCacheDays;
    if (!maxDays) {
        return counts;
    }
    const daysAgo = (ms) => (now - ms) / 86400000;
    const imageFile = (item) => path.join(project.dir, "images", `${item.id}.jpg`);
    const data = readData(project);
    const kept = data.items.filter((item) => {
        const fetched = Date.parse(item.fetchedAt || item.addedAt || "");
        if (daysAgo(fetched) > maxDays) { // NaN (no or a broken date) is never past it
            fs.rmSync(imageFile(item), { force: true });
            counts.items++;
            return false;
        }
        const image = fs.statSync(imageFile(item), { throwIfNoEntry: false });
        if (image && daysAgo(image.mtimeMs) > maxDays) {
            fs.rmSync(imageFile(item));
            counts.images++;
        } else if (image && daysAgo(image.mtimeMs) > maxDays - REFRESH_BEFORE_DAYS) {
            counts.soon++;
        }
        return true;
    });
    if (counts.items) {
        writeData(project, { ...data, items: kept });
    }
    return counts;
};

// the warnings for expireCache's counts
const reportExpired = (project, counts) => {
    const full = `\`npm run full -- -p ${project.id}\``;
    if (counts.items) {
        console.error(`⚠️  ${counts.items} item(s) of ${project.id} were last fetched over ${project.maxCacheDays} days ago and were removed (the source's terms) - ${full} fetches them again`);
    }
    if (counts.images) {
        console.error(`⚠️  ${counts.images} image(s) of ${project.id} were older than ${project.maxCacheDays} days and were removed (the source's terms) - ${full} downloads them again`);
    }
    if (counts.soon) {
        console.log(`Heads-up: ${counts.soon} image(s) of ${project.id} expire within ${REFRESH_BEFORE_DAYS} days - ${full} renews them`);
    }
};

module.exports = {
    ROOT,
    NAME,
    MIX,
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
    mixCandidates,
    pickMix,
    pickMixProject,
    parseProjectArgs,
    projectArgs,
    readData,
    writeData,
    REFRESH_BEFORE_DAYS,
    oldImages,
    cacheNote,
    expireCache,
    reportExpired,
};
