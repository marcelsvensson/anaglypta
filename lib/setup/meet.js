// npm run setup:meet: uploads the Anaglypta card as a Google Meet background once, then finds the file Chrome keeps for it
// (GOOGLE_MEET_BLOB_PATH). macOS + Chrome only
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ROOT, expandHome, tilde } = require("../utils/files");
const { ok, warn, isYes, run, readEnv, writeEnvValue } = require("./ui");

const CHROME_DIR = path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
const MEET_BLOB_DIR = path.join("IndexedDB", "https_meet.google.com_0.indexeddb.blob");

// the Meet blob folder of every Chrome profile (Default, Profile 1, ...)
const meetBlobDirs = () => (fs.existsSync(CHROME_DIR) ? fs.readdirSync(CHROME_DIR) : [])
    .map((profile) => path.join(CHROME_DIR, profile, MEET_BLOB_DIR))
    .filter((dir) => fs.existsSync(dir));

const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
        return listFiles(file);
    }
    const { size, mtimeMs } = fs.statSync(file);
    return [{ path: file, size, mtimeMs }];
});

// the Meet background is a video (an uploaded image gets converted to a small webp, too small to put a collage in): the
// Anaglypta card (assets/anaglypta.mp4), padded to CARD_BYTES so a collage video fits. Meet's upload only offers images
// until this line has run in Chrome's console
const MEET_CONSOLE_LINE = "document.querySelector('input[type=\"file\"]').setAttribute('accept', 'image/jpeg, image/png, video/mp4');";

const setupMeet = async (input, project) => {
    const { KEY, CARD_BYTES, padTo, isMp4, readHead } = require("../../scripts/meet");
    if (process.platform !== "darwin") {
        warn("The Google Meet step only knows where Chrome keeps its files on macOS - see docs/reference.md to set the path by hand");
        return false;
    }
    const env = readEnv();
    const blob = env[KEY] && expandHome(env[KEY]);
    if (blob && fs.statSync(blob, { throwIfNoEntry: false })?.isFile()) {
        if (isMp4(readHead(blob))) {
            const answer = await input.ask("  Google Meet is set up. Find the file again (after a new upload or a Chrome update)? [y/N] ");
            if (!isYes(answer)) {
                ok("Google Meet is set up");
                return true;
            }
        } else {
            warn("Your Meet background is from an older setup (an image upload) - let's upload the Anaglypta card instead");
        }
    } else if (blob) {
        warn(`${KEY} in .env doesn't point at an existing file any more (moved by Chrome) - let's find it again`);
    }

    // the padded card, in tmp-upload/ (ignored by git, easy to find in Chrome's file picker; the repo keeps the small one)
    const card = path.join(ROOT, "tmp-upload", "anaglypta.mp4");
    fs.mkdirSync(path.dirname(card), { recursive: true });
    fs.writeFileSync(card, padTo(fs.readFileSync(path.join(ROOT, "assets", "anaglypta.mp4")), CARD_BYTES));
    spawnSync("pbcopy", { input: MEET_CONSOLE_LINE });
    console.log(`
  Upload the Anaglypta card as a background in Google Meet once, Anaglypta replaces it from then on.
  Meet's upload only offers images, one line in Chrome's console lets it take a video (it's in your clipboard now):

    ${MEET_CONSOLE_LINE}

    1. In Chrome, open https://meet.google.com and start or preview a meeting
    2. Click "Apply visual effects" -> Backgrounds
    3. Open the console (View -> Developer -> JavaScript Console, or Cmd+Option+J), paste the line and press Enter
       (Chrome may ask you to type "allow pasting" first)
    4. Click the + (upload) button and pick ${path.relative(ROOT, card)} in this folder (opening it in Finder for you now,
       you can drag it from there into Chrome's file picker)
`);
    spawnSync("open", ["-R", card]);

    for (let attempt = 1; attempt <= 3; attempt++) {
        const answer = await input.ask("  Press Enter when the background is uploaded (s to skip): ");
        if (answer === null || /^s/i.test(answer.trim())) {
            return false;
        }
        // Chrome only creates Meet's folder with the first uploaded background, so it's looked for now
        const dirs = meetBlobDirs();
        if (!dirs.length) {
            warn("Couldn't find Chrome's Google Meet folder yet - it appears with the first background you upload in Meet "
                + "(any image will do, if the card upload didn't work). Upload one, then press Enter again");
            continue;
        }
        // the card is the only video of exactly that size, so it's found whenever it was uploaded
        const uploads = dirs.flatMap(listFiles)
            .filter((file) => file.size === CARD_BYTES && isMp4(readHead(file.path)))
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
        if (!uploads.length) {
            warn("No uploaded card in Meet yet - make sure the upload finished (it shows up in the list of backgrounds)");
            continue;
        }
        const found = uploads[0].path;
        console.log(`\n  Found the uploaded card (${new Date(uploads[0].mtimeMs).toLocaleString()}):\n    ${tilde(found)}`);
        const confirm = await input.ask("  Use it? [Y/n] ");
        if (confirm === null || /^n/i.test(confirm.trim())) {
            return false;
        }
        writeEnvValue(KEY, found);
        ok("Google Meet path saved to .env");
        if (fs.existsSync(path.join(project.dir, "collage.jpg"))) {
            return run(process.execPath, [path.join(ROOT, "scripts", "meet.js"), "--project", project.id]).status === 0;
        }
        console.log(`  Make a collage with \`npm run collage -- -p ${project.id}\`, then \`npm run meet\` puts it in`);
        return true;
    }
    warn(`Couldn't find the file - set ${KEY} by hand (see docs/reference.md)`);
    return false;
};

module.exports = { setupMeet };
