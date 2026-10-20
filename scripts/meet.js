// npm run meet [-- -p <project> | -p mix] [--dry-run]: puts the project's collage and its thumbnail in as your Google Meet background, by overwriting the
// two blob files Chrome stored when you uploaded a background in Meet (GOOGLE_MEET_BLOB_PATH, GOOGLE_MEET_BLOB_PATH_THUMBNAIL
// in .env, `npm run setup:meet` finds them). Skipped when neither is set.
// npm run random-meet [-- -p <project>] [--cover | --latest | --fill] (= --collage): draws a new random collage first, and refuses to run
// (before drawing anything) when Google Meet isn't set up. -p mix: a random project (not last time's, allowMix: false opts out),
// picked once here and passed on by name.
// Experimental: Chrome's IndexedDB files are undocumented and may change with a Chrome update or a new upload.
const fs = require("node:fs");
const path = require("node:path");

const { ROOT, MIX, expandHome, getProject, parseProjectArgs } = require("./project");
const { drawCollage } = require("./collage");

const KEYS = ["GOOGLE_MEET_BLOB_PATH", "GOOGLE_MEET_BLOB_PATH_THUMBNAIL"];

// returns [{ source, target }] for the two images in dir (the project's folder), null when not configured at all,
// throws on a half-done setup. the targets must be existing files (the blobs Chrome made), isFile is passed in so this
// stays testable
const planCopies = (env, { isFile }, dir) => {
    if (!KEYS.some((key) => env[key])) {
        return null;
    }
    const missing = KEYS.filter((key) => !env[key]);
    if (missing.length) {
        throw new Error(`Set both Google Meet blob files in .env (\`npm run setup:meet\` does it), missing: ${missing.join(", ")}`);
    }

    const blobFor = (key) => {
        const value = expandHome(env[key].trim());
        if (!isFile(value)) {
            throw new Error(`${key} isn't an existing file - run \`npm run setup:meet\` to find the files again (a new upload or a Chrome update changes them)`);
        }
        return value;
    };

    return [
        ["collage.jpg", blobFor("GOOGLE_MEET_BLOB_PATH")],
        ["collage_thumbnail.jpg", blobFor("GOOGLE_MEET_BLOB_PATH_THUMBNAIL")],
    ].map(([image, target]) => ({ source: path.join(dir, image), target }));
};

const main = () => {
    const { source, project: name, rest } = parseProjectArgs(process.argv.slice(2));
    require("dotenv").config({ quiet: true });
    const withCollage = rest.includes("--collage");
    // -p mix waits until Meet is set up, so it doesn't use up a pick when there's nothing to send it to
    const configured = KEYS.some((key) => process.env[key]);
    const project = configured || name !== MIX ? getProject({ source, project: name }, ROOT, { mix: true }) : null;
    const isFile = (file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
    const copies = configured ? planCopies(process.env, { isFile }, project.dir) : null;
    if (!copies) {
        if (withCollage) {
            throw new Error("not set up - run `npm run setup:meet` first");
        }
        console.log("Google Meet not configured in .env - skipping");
        return;
    }

    // --collage (npm run random-meet): a new random collage first, the other options (--cover, --latest, --fill) are for it
    if (withCollage) {
        const status = drawCollage(project, ["--randomize", ...rest.filter((arg) => !["--collage", "--dry-run"].includes(arg))]);
        if (status !== 0) {
            process.exit(status);
        }
    }

    for (const { source } of copies) {
        if (!fs.existsSync(source)) {
            throw new Error(`${path.relative(ROOT, source)} is missing - run \`npm run collage -- -p ${project.id}\` first`);
        }
    }

    const dryRun = rest.includes("--dry-run");
    for (const { source, target } of copies) {
        if (dryRun) {
            console.log(`Dry run - would copy ${path.relative(ROOT, source)} to ${target}`);
        } else {
            fs.copyFileSync(source, target);
            console.log(`Copied ${path.relative(ROOT, source)} to ${target}`);
        }
    }
    if (!dryRun) {
        console.log("Reload Google Meet to see the new background");
    }
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`❌ Google Meet: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { planCopies, expandHome };
