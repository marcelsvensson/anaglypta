// -p mix: a random project instead of a named one, every project once per round (projects/.mix.json remembers the round)
const fs = require("node:fs");
const path = require("node:path");

const { MIX, sourceNames, listProjects, splitId, resolveProject } = require("./projects");
const { readJson, writeJson } = require("./files");
const { readData } = require("./items");

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

// -p mix: the next project of the round that has items (one without would need fetching first), remembered in projects/.mix.json.
// skipSources: sources the command can't run (daily-new: steam)
const pickMixProject = (settings, projects, source, root, { random = Math.random, skipSources = [] } = {}) => {
    if (source && !sourceNames(settings).includes(source)) {
        throw new Error(`Unknown source "${source}" - the sources are: ${sourceNames(settings).join(", ")}`);
    }
    const candidates = mixCandidates(settings, projects, { source }).filter((id) => !skipSources.includes(splitId(id).source));
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

module.exports = { MIX, mixCandidates, pickMix, pickMixProject };
