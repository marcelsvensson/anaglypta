// npm run setup: gets a fresh clone ready to run - safe to re-run, every step skips what's already done
// npm run setup:python (--python): only the python part
// uses node built-ins only, so it works before `npm ci`
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawnSync } = require("node:child_process");

const { VENV_PYTHON, hasPillow } = require("./python");
const { expandHome } = require("./meet");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const EXAMPLE_ENV_PATH = path.join(ROOT, ".example.env");
const TOKEN_PATH = path.join(ROOT, ".spotify-token.json");
const MIN_NODE = 20;
const MIN_PYTHON = [3, 9];
const REDIRECT_URI = `http://127.0.0.1:${process.env.SPOTIFY_AUTH_PORT || 8888}/callback`;

const ok = (message) => console.log(`✓ ${message}`);
const step = (message) => console.log(`→ ${message}`);
const warn = (message) => console.log(`⚠️  ${message}`);

// --- pure helpers (exported for tests) ---

// "https://open.spotify.com/playlist/<id>?si=..", "spotify:playlist:<id>" or "<id>" -> "<id>", anything else -> null
const parsePlaylistId = (input) => {
    const text = String(input ?? "").trim();
    const match = text.match(/playlist[/:]([A-Za-z0-9]{22})(?![A-Za-z0-9])/) || text.match(/^([A-Za-z0-9]{22})$/);
    return match ? match[1] : null;
};

const isClientId = (input) => /^[0-9a-f]{32}$/i.test(String(input ?? "").trim());

// KEY=value lines, comments and empty lines ignored
const parseEnv = (text) => {
    const env = {};
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (match) {
            env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
        }
    }
    return env;
};

// replaces the KEY= line in place (keeps comments and order), appends the key when it's missing
const setEnvValue = (text, key, value) => {
    const line = new RegExp(`^${key}=.*$`, "m");
    if (line.test(text)) {
        return text.replace(line, `${key}=${value}`);
    }
    return `${text.replace(/\n?$/, "\n")}${key}=${value}\n`;
};

// the two files Chrome writes when you upload a Meet background: of the files changed since `since`, the largest is the
// image and the smallest its thumbnail. files = [{ path, size, mtimeMs }], returns { image, thumbnail, count } or null
const pickBlobs = (files, since) => {
    const fresh = files.filter((file) => file.mtimeMs >= since).sort((a, b) => b.size - a.size);
    if (fresh.length < 2) {
        return null;
    }
    return { image: fresh[0].path, thumbnail: fresh[fresh.length - 1].path, count: fresh.length };
};

// --- input that works for both a terminal and piped answers ---

const createInput = () => {
    const rl = readline.createInterface({ input: process.stdin });
    const lines = [];
    const waiting = [];
    let closed = false;
    rl.on("line", (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)));
    rl.on("close", () => {
        closed = true;
        waiting.splice(0).forEach((resolve) => resolve(null));
    });

    return {
        // resolves to the answer, or null when there is no more input
        ask(question) {
            process.stdout.write(question);
            if (lines.length) {
                return Promise.resolve(lines.shift());
            }
            if (closed) {
                process.stdout.write("\n");
                return Promise.resolve(null);
            }
            return new Promise((resolve) => waiting.push(resolve));
        },
        close: () => rl.close(),
    };
};

// asks until parse() returns a value, empty answer or end of input = skip (null)
const askUntil = async (input, question, parse, hint) => {
    for (;;) {
        const answer = await input.ask(question);
        if (answer === null || !answer.trim()) {
            return null;
        }
        const value = parse(answer);
        if (value) {
            return value;
        }
        warn(hint);
    }
};

// --- steps ---

const run = (command, args) => spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });

const checkNode = () => {
    const major = Number(process.versions.node.split(".")[0]);
    if (major < MIN_NODE) {
        console.error(`❌ Node ${MIN_NODE}+ is needed, you have ${process.versions.node}`);
        process.exit(1);
    }
    ok(`Node ${process.versions.node}`);
};

const installNodePackages = () => {
    if (fs.existsSync(path.join(ROOT, "node_modules"))) {
        ok("Node packages installed");
        return true;
    }
    step("Installing Node packages (npm ci)");
    return run("npm", ["ci"]).status === 0;
};

const findSystemPython = () => {
    for (const candidate of ["python3", "python"]) {
        const result = spawnSync(candidate, ["-c", "import sys; print('%d.%d' % sys.version_info[:2])"], { encoding: "utf8" });
        if (result.status !== 0) {
            continue;
        }
        const [major, minor] = result.stdout.trim().split(".").map(Number);
        if (major > MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor >= MIN_PYTHON[1])) {
            return candidate;
        }
    }
    return null;
};

const setupPython = () => {
    if (fs.existsSync(VENV_PYTHON) && hasPillow(VENV_PYTHON)) {
        ok("Python environment (.venv) with Pillow");
        return true;
    }

    if (!fs.existsSync(VENV_PYTHON)) {
        const python = findSystemPython();
        if (!python) {
            warn(`Python ${MIN_PYTHON.join(".")}+ not found - install it from https://www.python.org and run \`npm run setup:python\``);
            return false;
        }
        step(`Creating .venv with ${python}`);
        if (run(python, ["-m", "venv", ".venv"]).status !== 0) {
            warn("Could not create .venv");
            return false;
        }
    }

    step("Installing Python packages (Pillow)");
    if (run(VENV_PYTHON, ["-m", "pip", "install", "--quiet", "-r", "requirements.txt"]).status !== 0) {
        warn("Could not install the Python packages - run `npm run setup:python` again");
        return false;
    }
    ok("Python environment (.venv) with Pillow");
    return true;
};

const readEnv = () => parseEnv(fs.readFileSync(ENV_PATH, "utf8"));

const writeEnvValue = (key, value) => {
    fs.writeFileSync(ENV_PATH, setEnvValue(fs.readFileSync(ENV_PATH, "utf8"), key, value));
};

const ensureEnvFile = () => {
    if (fs.existsSync(ENV_PATH)) {
        ok(".env exists");
        return;
    }
    fs.copyFileSync(EXAMPLE_ENV_PATH, ENV_PATH);
    fs.chmodSync(ENV_PATH, 0o600);
    step("Created .env from .example.env");
};

const printSpotifyGuide = () => {
    console.log(`
  Create a Spotify app (once):
    1. Open https://developer.spotify.com/dashboard and log in (the app owner needs Spotify Premium)
    2. Click "Create app", give it a name and description
    3. Add this Redirect URI: ${REDIRECT_URI}
    4. Accept the terms and save
    5. Open the app -> Settings and copy the Client ID
`);
};

// --- google meet (npm run setup:meet) ---

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

const tilde = (file) => file.replace(os.homedir(), "~");

const setupMeet = async (input) => {
    if (process.platform !== "darwin") {
        warn("The Google Meet step only knows where Chrome keeps its files on macOS - see the README to set the two paths by hand");
        return false;
    }
    const env = readEnv();
    const isFile = (file) => fs.statSync(expandHome(file), { throwIfNoEntry: false })?.isFile() ?? false;
    if (env.GOOGLE_MEET_BLOB_PATH || env.GOOGLE_MEET_BLOB_PATH_THUMBNAIL) {
        if (![env.GOOGLE_MEET_BLOB_PATH, env.GOOGLE_MEET_BLOB_PATH_THUMBNAIL].every((file) => file && isFile(file))) {
            warn("The Google Meet paths in .env don't point at two existing files (moved by Chrome, or folders) - let's find them again");
        }
    }
    if (env.GOOGLE_MEET_BLOB_PATH && env.GOOGLE_MEET_BLOB_PATH_THUMBNAIL
            && isFile(env.GOOGLE_MEET_BLOB_PATH) && isFile(env.GOOGLE_MEET_BLOB_PATH_THUMBNAIL)) {
        const answer = await input.ask("  Google Meet is already set up. Find the files again (after a new upload or a Chrome update)? [y/N] ");
        if (answer === null || !/^y/i.test(answer.trim())) {
            ok("Google Meet is set up");
            return true;
        }
    }

    const { project } = require("../settings.json").spotify;
    const collage = path.join(ROOT, project, "collage.jpg");
    if (!fs.existsSync(collage)) {
        warn(`No ${project}/collage.jpg yet - run \`npm run full\` and \`npm run collage\` first, then \`npm run setup:meet\``);
        return false;
    }
    const dirs = meetBlobDirs();
    if (!dirs.length) {
        warn("Couldn't find Chrome's Google Meet folder - open Google Meet in Chrome once, then run `npm run setup:meet` again");
        return false;
    }

    const since = Date.now() - 2000;
    console.log(`
  Upload the collage as a background in Google Meet once, Anaglypta replaces it from then on:
    1. In Chrome, open https://meet.google.com and start or preview a meeting
    2. Click "Apply visual effects" -> Backgrounds -> the + (upload) button
    3. Pick ${project}/collage.jpg (opening it in Finder for you now)
`);
    spawnSync("open", ["-R", collage]);

    for (let attempt = 1; attempt <= 3; attempt++) {
        const answer = await input.ask("  Press Enter when the background is uploaded (s to skip): ");
        if (answer === null || /^s/i.test(answer.trim())) {
            return false;
        }
        const found = pickBlobs(dirs.flatMap(listFiles), since);
        if (!found) {
            warn("No new files from Meet yet - make sure the upload finished (it shows up in the list of backgrounds)");
            continue;
        }

        console.log(`\n  Found the uploaded background:\n    image:     ${tilde(found.image)}\n    thumbnail: ${tilde(found.thumbnail)}`);
        if (found.count > 2) {
            warn(`${found.count} files changed while you uploaded, picked the largest and smallest - check that these look right`);
        }
        const confirm = await input.ask("  Use these? [Y/n] ");
        if (confirm === null || /^n/i.test(confirm.trim())) {
            return false;
        }
        writeEnvValue("GOOGLE_MEET_BLOB_PATH", found.image);
        writeEnvValue("GOOGLE_MEET_BLOB_PATH_THUMBNAIL", found.thumbnail);
        ok("Google Meet paths saved to .env");
        return run(process.execPath, [path.join(__dirname, "meet.js")]).status === 0;
    }
    warn("Couldn't find the files - set GOOGLE_MEET_BLOB_PATH and GOOGLE_MEET_BLOB_PATH_THUMBNAIL by hand (see the README)");
    return false;
};

const main = async () => {
    const pythonOnly = process.argv.includes("--python");
    checkNode();

    if (pythonOnly) {
        process.exitCode = setupPython() ? 0 : 1;
        return;
    }
    if (process.argv.includes("--meet")) {
        ensureEnvFile();
        const input = createInput();
        process.exitCode = (await setupMeet(input)) ? 0 : 1;
        input.close();
        return;
    }

    const todo = [];
    if (!installNodePackages()) {
        todo.push("Install the Node packages: `npm ci`");
    }
    if (!setupPython()) {
        todo.push("Set up Python: `npm run setup:python`");
    }

    ensureEnvFile();
    const input = createInput();

    if (readEnv().CLIENT_ID) {
        ok("CLIENT_ID is set");
    } else {
        printSpotifyGuide();
        const clientId = await askUntil(input, "  Client ID (empty to skip): ", (answer) => isClientId(answer) && answer.trim(),
            "That doesn't look like a Client ID (32 letters and digits from the app's Settings page)");
        if (clientId) {
            writeEnvValue("CLIENT_ID", clientId);
            ok("CLIENT_ID saved to .env");
        } else {
            todo.push("Add CLIENT_ID to .env");
        }
    }

    if (readEnv().PLAYLIST_ID) {
        ok("PLAYLIST_ID is set");
    } else {
        console.log("\n  Your playlist: in Spotify, open the playlist -> ... -> Share -> Copy link to playlist.");
        console.log("  It has to be a playlist you own or collaborate on.\n");
        const playlistId = await askUntil(input, "  Playlist link (empty to skip): ", parsePlaylistId,
            "That doesn't look like a playlist link (https://open.spotify.com/playlist/...)");
        if (playlistId) {
            writeEnvValue("PLAYLIST_ID", playlistId);
            ok("PLAYLIST_ID saved to .env");
        } else {
            todo.push("Add PLAYLIST_ID to .env");
        }
    }

    const env = readEnv();
    if (fs.existsSync(TOKEN_PATH)) {
        ok("Logged in to Spotify");
    } else if (env.CLIENT_SECRET) {
        ok("CLIENT_SECRET is set (app mode, only works for apps created before 2026)");
    } else if (!env.CLIENT_ID) {
        todo.push("Log in to Spotify: `npm run auth` (after adding CLIENT_ID)");
    } else {
        const answer = await input.ask("\n  Log in to Spotify now? [Y/n] ");
        input.close();
        if (answer !== null && !/^n/i.test(answer.trim()) && run(process.execPath, [path.join(__dirname, "auth.js")]).status === 0) {
            ok("Logged in to Spotify");
        } else {
            todo.push("Log in to Spotify: `npm run auth`");
        }
    }
    input.close();

    if (todo.length) {
        console.log(`\nAlmost there, still to do:\n${todo.map((item) => `  - ${item}`).join("\n")}`);
        console.log("Then run `npm run setup` again to check.");
        process.exitCode = 1;
    } else {
        console.log("\n✅ All set! Next:\n  npm run full       # fetch your playlist\n  npm run collage    # draw a random collage");
        console.log("  npm run daily-new  # later: add one new album a day, with it in the middle of the collage");
        console.log("  npm run collage    # remix the collage whenever you like");
    }
    if (!readEnv().GOOGLE_MEET_BLOB_PATH) {
        console.log("\nOptional: use the collage as your Google Meet background - `npm run setup:meet` (once you have a collage)");
    }
};

if (require.main === module) {
    main().catch((error) => {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { parsePlaylistId, isClientId, parseEnv, setEnvValue, pickBlobs };
