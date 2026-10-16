// npm run meet [-- --dry-run]: puts the collage and its thumbnail in as your Google Meet background, by overwriting the
// two blob files Chrome stored when you uploaded a background in Meet (GOOGLE_MEET_BLOB_PATH, GOOGLE_MEET_BLOB_PATH_THUMBNAIL
// in .env, `npm run setup:meet` finds them). Skipped when neither is set.
// npm run random-meet [-- --cover | --latest | --fill] (= --collage): draws a new random collage first, and refuses to run
// (before drawing anything) when Google Meet isn't set up.
// Experimental: Chrome's IndexedDB files are undocumented and may change with a Chrome update or a new upload.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const { project } = require("../settings.json").spotify;

const KEYS = ["GOOGLE_MEET_BLOB_PATH", "GOOGLE_MEET_BLOB_PATH_THUMBNAIL"];

const expandHome = (file) => (file === "~" || file.startsWith("~/") ? path.join(os.homedir(), file.slice(1)) : file);

// returns [{ source, target }] for the two images, null when not configured at all, throws on a half-done setup.
// the targets must be existing files (the blobs Chrome made), isFile is passed in so this stays testable
const planCopies = (env, { isFile }) => {
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

    const dir = path.join(ROOT, project);
    return [
        ["collage.jpg", blobFor("GOOGLE_MEET_BLOB_PATH")],
        ["collage_thumbnail.jpg", blobFor("GOOGLE_MEET_BLOB_PATH_THUMBNAIL")],
    ].map(([image, target]) => ({ source: path.join(dir, image), target }));
};

// python.js runs a script with the project's .venv python, stops here when a step fails
const python = (...args) => {
    const result = spawnSync(process.execPath, [path.join(__dirname, "python.js"), ...args], { cwd: ROOT, stdio: "inherit" });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
};

const main = () => {
    require("dotenv").config({ quiet: true });
    const isFile = (file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
    const copies = planCopies(process.env, { isFile });
    const drawCollage = process.argv.includes("--collage");
    if (!copies) {
        if (drawCollage) {
            throw new Error("not set up - run `npm run setup:meet` first");
        }
        console.log("Google Meet not configured in .env - skipping");
        return;
    }

    // --collage (npm run random-meet): a new random collage first, the other options (--cover, --latest, --fill) are for it
    if (drawCollage) {
        python("scripts/bitmapper.py");
        python("scripts/bitmapper_collage.py", "--randomize", ...process.argv.slice(2).filter((arg) => !["--collage", "--dry-run"].includes(arg)));
    }

    for (const { source } of copies) {
        if (!fs.existsSync(source)) {
            throw new Error(`${path.relative(ROOT, source)} is missing - run \`npm run collage\` first`);
        }
    }

    const dryRun = process.argv.includes("--dry-run");
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
