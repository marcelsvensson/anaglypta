// npm run full [-- -p <project>] [--limit n]: fetches new items for a project from its source into
// projects/<source>/<name>/items.json, then makes the square copies that are missing (cache.py), so the collage works
// offline. --limit n: the most new items one run adds (daily-new uses 1), no --limit = all of them, up to maxItems.
// A new source = a fetcher in scripts/sources/ plus a line in FETCHERS.
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ROOT, getProject, parseProjectArgs, projectArgs } = require("./project");

// --limit <n> -> n, no --limit -> Infinity
const parseLimit = (argv) => {
    const index = argv.indexOf("--limit");
    if (index === -1) {
        return Infinity;
    }
    const limit = Number(argv[index + 1]);
    if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`--limit needs a whole number of items, like --limit 1 (got "${argv[index + 1] ?? ""}")`);
    }
    return limit;
};

// runs a python script for the project through python.js (the .venv python)
const runPython = (script, project, args = []) => {
    const result = spawnSync(process.execPath, [path.join(__dirname, "python.js"), path.join(__dirname, script), ...projectArgs(project), ...args],
        { cwd: ROOT, stdio: "inherit" });
    if (result.status !== 0) {
        throw new Error(`${script} failed`);
    }
};

// a python fetcher, it takes the same flags
const python = (script) => (project, { limit }) => runPython(script, project, limit === Infinity ? [] : ["--limit", String(limit)]);

const FETCHERS = {
    spotify: (project, options) => {
        require("dotenv").config({ quiet: true });
        return require("./sources/spotify").fetchSpotify(project, { ...options, spotify: require("../api/spotify") });
    },
    local: python("sources/local.py"),
    tmdb: (project, options) => {
        require("dotenv").config({ quiet: true });
        return require("./sources/tmdb").fetchTmdb(project, { ...options, tmdb: require("../api/tmdb") });
    },
};

const main = async () => {
    const { source, project: name, rest } = parseProjectArgs(process.argv.slice(2));
    const limit = parseLimit(rest);
    const unknown = rest.filter((arg, i) => arg !== "--limit" && rest[i - 1] !== "--limit");
    if (unknown.length) {
        throw new Error(`Unknown option ${unknown[0]} - fetch takes -s/--source, -p/--project and --limit`);
    }

    const project = getProject({ source, project: name });
    const fetcher = FETCHERS[project.source];
    if (!fetcher) {
        throw new Error(`Can't fetch from ${project.source} yet`);
    }
    await fetcher(project, { limit });
    runPython("cache.py", project);
};

if (require.main === module) {
    main().catch((error) => {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { parseLimit, FETCHERS };
