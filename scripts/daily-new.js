// npm run daily-new [-- -p <project> | -p mix]: the day-by-day reveal - fetches exactly one new item, draws the collage with it in
// the middle (--latest) and sends it to Google Meet (skipped when that isn't set up). A script and not a && chain in
// package.json, so -s/-p reach every step (npm only appends options to the last command), -p mix is picked once here (never one of a
// source without daily-new, like Steam). Other options go to the collage.
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ROOT, getProject, parseProjectArgs, projectArgs } = require("./project");
const { SOURCES, sourcesWithout } = require("../lib/sources");

// sources without a day-by-day reveal (their adapter says dailyNew: false, like Steam: no "newest game")
const NOT_IMPLEMENTED = sourcesWithout("dailyNew");

const notImplemented = (source) => NOT_IMPLEMENTED.includes(source) ? new Error(`Not implemented for ${SOURCES[source].label}`) : undefined;

const steps = (project, rest) => [
    ["fetch.js", ...projectArgs(project), "--limit", "1"],
    ["collage.js", "--latest", ...projectArgs(project), ...rest],
    ["meet.js", ...projectArgs(project)],
];

const main = () => {
    const { source, project: name, rest } = parseProjectArgs(process.argv.slice(2));
    if (notImplemented(source)) {
        throw notImplemented(source);
    }
    const project = getProject({ source, project: name }, ROOT, { mix: true, skipSources: NOT_IMPLEMENTED });
    if (notImplemented(project.source)) {
        throw notImplemented(project.source);
    }
    for (const [script, ...args] of steps(project, rest)) {
        const result = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { cwd: ROOT, stdio: "inherit" });
        if (result.status !== 0) {
            process.exitCode = result.status ?? 1;
            return;
        }
    }
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { steps, notImplemented, NOT_IMPLEMENTED };
