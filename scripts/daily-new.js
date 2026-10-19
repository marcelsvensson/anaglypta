// npm run daily-new [-- -p <project>]: the day-by-day reveal - fetches exactly one new item, draws the collage with it in
// the middle (--latest) and sends it to Google Meet (skipped when that isn't set up). A script and not a && chain in
// package.json, so -s/-p reach every step (npm only appends options to the last command). Other options go to the collage.
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ROOT, getProject, parseProjectArgs, projectArgs } = require("./project");

const steps = (project, rest) => [
    ["fetch.js", ...projectArgs(project), "--limit", "1"],
    ["python.js", "scripts/collage.py", "--latest", ...projectArgs(project), ...rest],
    ["meet.js", ...projectArgs(project)],
];

const main = () => {
    const { source, project: name, rest } = parseProjectArgs(process.argv.slice(2));
    const project = getProject({ source, project: name });
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

module.exports = { steps };
