// npm run full [-- -p <project>] [--limit n]: fetches new items for a project from its source into
// projects/<source>/<name>/items.json, then makes the square copies that are missing (cache.py), so the collage works
// offline. --limit n: the most new items one run adds (daily-new uses 1), no --limit = all of them, up to maxItems.
// The project's source fetches (its adapter in lib/sources/<source>/).
const { getProject, parseProjectArgs, expireCache } = require("./project");
const { runPython } = require("./python");
const { getSource } = require("../lib/sources");

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

// a python script for the project, stops here when it fails (it said why)
const python = (script, project, args) => {
    if (runPython(script, project, args) !== 0) {
        throw new Error(`${script} failed`);
    }
};

const main = async () => {
    const { source, project: name, rest } = parseProjectArgs(process.argv.slice(2));
    const limit = parseLimit(rest);
    const unknown = rest.filter((arg, i) => arg !== "--limit" && rest[i - 1] !== "--limit");
    if (unknown.length) {
        throw new Error(`Unknown option ${unknown[0]} - fetch takes -s/--source, -p/--project and --limit`);
    }

    const project = getProject({ source, project: name });
    await getSource(project.source).fetch(project, { limit });
    // what's past the source's cache limit goes first (quietly: the fetch just renewed what it could), cache.py downloads it again
    expireCache(project);
    python("scripts/cache.py", project, []);
};

if (require.main === module) {
    main().catch((error) => {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { parseLimit };
