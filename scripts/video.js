// npm run video [-- -p <project> | -p mix] [--segments 20] [--seconds 30] [--cover | --latest | --fill] [--layout X]: an mp4
// background of random collages, each shown for a while (scripts/video.py, the options go to it). Experimental: upload
// projects/<source>/<name>/collage.mp4 in Google Meet by hand. Removes what's past the source's cache limit first (TMDb).
const { ROOT, getProject, parseProjectArgs, expireCache, reportExpired } = require("./project");
const { runPython } = require("./python");

// returns video.py's exit status
const drawVideo = (project, args) => {
    reportExpired(project, expireCache(project));
    return runPython("scripts/video.py", project, args);
};

const main = () => {
    const { source, project: name, rest } = parseProjectArgs(process.argv.slice(2));
    const project = getProject({ source, project: name }, ROOT, { mix: true });
    process.exitCode = drawVideo(project, rest);
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { drawVideo };
