// npm run video [-- -p <project> | -p mix] [--minutes 10] [--every 10] [--fade 1] [--rewind] [--cover | --latest | --fill] [--layout X]:
// collage.mp4, a living collage (one tile crossfades to another image every 10 s, the centrepiece every 60 s; --rewind ends
// where it started, for a seamless loop), or --slideshow [--segments 20] [--seconds 30]. scripts/video.py does it, the options
// go to it. `npm run random-meet -- --video` makes one and puts it in the Meet background. Removes what's past the source's
// cache limit first (TMDb).
const { ROOT } = require("../lib/utils/files");
const { getProject, parseProjectArgs } = require("../lib/utils/cli");
const { expireCache, reportExpired } = require("../lib/utils/cache-limit");
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
