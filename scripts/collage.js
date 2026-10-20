// npm run collage [-- -p <project> | -p mix] [--cover | --latest | --fill] [--grid] [--layout X]: draws the project's
// collage.jpg with scripts/collage.py (the options go to it). Removes what's past the source's cache limit first (TMDb).
// meet.js (random-meet) and daily-new use drawCollage too.
const { ROOT, getProject, parseProjectArgs, expireCache, reportExpired } = require("./project");
const { runPython } = require("./python");

// returns collage.py's exit status
const drawCollage = (project, args) => {
    reportExpired(project, expireCache(project));
    return runPython("scripts/collage.py", project, args);
};

const main = () => {
    const { source, project: name, rest } = parseProjectArgs(process.argv.slice(2));
    const project = getProject({ source, project: name }, ROOT, { mix: true });
    process.exitCode = drawCollage(project, rest);
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { drawCollage };
