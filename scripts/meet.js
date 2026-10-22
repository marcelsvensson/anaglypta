// npm run meet [-- -p <project> | -p mix] [--video] [--dry-run]: puts the project's collage in as your Google Meet background, by
// overwriting the blob file Chrome stored when you uploaded the Anaglypta card in Meet (GOOGLE_MEET_BLOB_PATH in .env,
// `npm run setup:meet` finds it). Skipped when not set. The background is a video: the collage goes in as a one-frame
// video (collage_still.mp4, made from collage.jpg), --video puts collage.mp4 in instead (`npm run video`).
// npm run random-meet [-- -p <project>] [--cover | --latest | --fill] (= --collage): draws a new random collage first, and refuses to run
// (before drawing anything) when Google Meet isn't set up. -p mix: a random project (not last time's, allowMix: false opts out),
// picked once here and passed on by name. With --video it makes a new video first (--segments, --seconds go to it).
// Experimental: Chrome's IndexedDB files are undocumented and may change with a Chrome update or a new upload. What Chrome
// checks, found the hard way: the blob's file date (it's the uploaded file's lastModified) and its size (Chrome reads exactly
// as many bytes as were uploaded), so the file is padded to that size and keeps its date. An image upload doesn't work:
// Meet converts it to a small webp.
const fs = require("node:fs");
const path = require("node:path");

const { ROOT, MIX, expandHome, getProject, parseProjectArgs } = require("./project");
const { drawCollage } = require("./collage");
const { drawVideo } = require("./video");
const { runPython } = require("./python");

const KEY = "GOOGLE_MEET_BLOB_PATH";
// setup pads the card to this size before you upload it: the most a collage video can be
const CARD_BYTES = 20_000_000;

// what goes into the background: the project's file, how to make it (draw = random-meet's new one)
const MODES = {
    collage: {
        file: "collage_still.mp4",
        make: "npm run collage",
        draw: (project, args) => drawCollage(project, ["--randomize", ...args]),
        // the one-frame video of collage.jpg, made every time
        prepare: (project) => runPython("scripts/video.py", project, ["--still"]),
    },
    video: {
        file: "collage.mp4",
        make: "npm run video",
        draw: drawVideo,
        prepare: () => 0,
    },
};

// pure: an mp4 padded to exactly size bytes with a trailing "free" box (players skip it): Chrome reads exactly the size
// it recorded for the upload
const padTo = (data, size) => {
    const extra = size - data.length;
    if (extra < 0) {
        throw new Error(`it's ${(data.length / 1e6).toFixed(1)} MB, more than the ${(size / 1e6).toFixed(1)} MB the Meet background holds`);
    }
    if (extra === 0) {
        return data;
    }
    if (extra < 8) {
        throw new Error(`it's ${extra} bytes short of the background's size, too few to pad an mp4 - make it again`);
    }
    const box = Buffer.alloc(extra);
    box.writeUInt32BE(extra, 0);
    box.write("free", 4, "latin1");
    return Buffer.concat([data, box]);
};

// writes source over the blob file at exactly the blob's size, and keeps the blob's own times
const copyToBlob = (source, target) => {
    const { atime, mtime, size } = fs.statSync(target);
    fs.writeFileSync(target, padTo(fs.readFileSync(source), size));
    fs.utimesSync(target, atime, mtime);
};

const isMp4 = (head) => head.length >= 8 && head.toString("latin1", 4, 8) === "ftyp";

// returns { source, target } for the mode's file (dir = the project's folder), null when not configured, throws when the
// blob is gone or isn't the video card's (an older setup uploaded an image: writing a video there breaks Meet).
// fs = { isFile, head } (head = a file's first bytes), passed in so this stays testable
const planCopy = (env, { isFile, head }, dir, mode = MODES.collage) => {
    if (!env[KEY]) {
        return null;
    }
    const target = expandHome(env[KEY].trim());
    if (!isFile(target)) {
        throw new Error(`${KEY} isn't an existing file - run \`npm run setup:meet\` to find it again (a new upload or a Chrome update changes it)`);
    }
    if (!isMp4(head(target))) {
        throw new Error(`${KEY} isn't the uploaded Anaglypta video card (an older setup?) - run \`npm run setup:meet\` again`);
    }
    return { source: path.join(dir, mode.file), target };
};

const readHead = (file) => {
    const fd = fs.openSync(file, "r");
    try {
        const head = Buffer.alloc(12);
        return head.subarray(0, fs.readSync(fd, head, 0, 12, 0));
    } finally {
        fs.closeSync(fd);
    }
};

const main = () => {
    const { source, project: name, rest } = parseProjectArgs(process.argv.slice(2));
    require("dotenv").config({ quiet: true });
    const withCollage = rest.includes("--collage");
    const mode = rest.includes("--video") ? MODES.video : MODES.collage;
    // -p mix waits until Meet is set up, so it doesn't use up a pick when there's nothing to send it to
    const configured = Boolean(process.env[KEY]);
    const project = configured || name !== MIX ? getProject({ source, project: name }, ROOT, { mix: true }) : null;
    const isFile = (file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
    const copy = configured ? planCopy(process.env, { isFile, head: readHead }, project.dir, mode) : null;
    if (!copy) {
        if (withCollage) {
            throw new Error("not set up - run `npm run setup:meet` first");
        }
        console.log("Google Meet not configured in .env - skipping");
        return;
    }

    // --collage (npm run random-meet): a new random collage (or video) first, the other options (--cover, --latest, --fill,
    // --segments, ...) are for it
    const steps = [
        ...(withCollage ? [() => mode.draw(project, rest.filter((arg) => !["--collage", "--dry-run", "--video"].includes(arg)))] : []),
        () => mode.prepare(project),
    ];
    for (const step of steps) {
        const status = step();
        if (status !== 0) {
            process.exit(status);
        }
    }

    const shown = path.relative(ROOT, copy.source);
    if (!fs.existsSync(copy.source)) {
        throw new Error(`${shown} is missing - run \`${mode.make} -- -p ${project.id}\` first`);
    }
    if (rest.includes("--dry-run")) {
        console.log(`Dry run - would copy ${shown} to ${copy.target}`);
        return;
    }
    try {
        copyToBlob(copy.source, copy.target);
    } catch (error) {
        throw new Error(`${shown} doesn't fit: ${error.message}`);
    }
    console.log(`Copied ${shown} to ${copy.target}`);
    console.log("Reload Google Meet to see the new background");
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`❌ Google Meet: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { KEY, CARD_BYTES, MODES, padTo, copyToBlob, planCopy, isMp4, readHead, expandHome };
