// npm run setup: gets a fresh clone ready to run and adds projects (a spotify playlist or a local folder) to projects.json
// - safe to re-run, every step skips what's already done
// npm run setup:python (--python): only the python part
// npm run setup:meet (--meet) [-- -p <project>]: the Google Meet background
// uses node built-ins only, so it works before `npm ci`
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawnSync } = require("node:child_process");

const { VENV_PYTHON, hasPackages } = require("./python");
const {
    MIX, expandHome, parsePlaylistId, parseListId, toKebab, cacheNote, readSettings, readProjects, writeProjects, listProjects, getProject, resolveProject,
    parseProjectArgs,
} = require("./project");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const EXAMPLE_ENV_PATH = path.join(ROOT, ".example.env");
const TOKEN_PATH = path.join(ROOT, ".spotify-token.json");
const MIN_NODE = 20;
const MIN_PYTHON = [3, 12];
const REDIRECT_URI = `http://127.0.0.1:${process.env.SPOTIFY_AUTH_PORT || 8888}/callback`;

const ok = (message) => console.log(`✓ ${message}`);
const step = (message) => console.log(`→ ${message}`);
const warn = (message) => console.log(`⚠️  ${message}`);

// --- pure helpers (exported for tests) ---

const isClientId = (input) => /^[0-9a-f]{32}$/i.test(String(input ?? "").trim());

// TMDb's API Read Access Token is a JWT (eyJ....), the 32-character API key is a different thing
const isTmdbToken = (input) => /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(String(input ?? "").trim());

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

// a folder as typed or dragged into the terminal: '/My Photos', "/My Photos" or /My\ Photos -> /My Photos
const parseFolderInput = (input) => {
    const text = String(input ?? "").trim();
    const quoted = text.match(/^(["'])(.*)\1$/);
    return expandHome(quoted ? quoted[2] : text.replace(/\\(.)/g, "$1"));
};

// projects.json with id ("source/name") as the default, kept first in the file
const setDefault = (projects, id) => {
    const { default: _, ...rest } = projects;
    return { default: id, ...rest };
};

// projects.json with source/name added (replacing one with that name), the default when asked or when there's none yet
const addProject = (projects, source, name, entry, { makeDefault = false } = {}) => {
    const id = makeDefault || !projects.default ? `${source}/${name}` : projects.default;
    return setDefault({ ...projects, [source]: { ...projects[source], [name]: entry } }, id);
};

// projects.json without source/name (and without its source when that was its last project). When it was the default,
// the first project left is the new one
const removeProject = (projects, source, name) => {
    const { [name]: _, ...left } = projects[source] ?? {};
    const next = { ...projects, [source]: left };
    if (!Object.keys(left).length) {
        delete next[source];
    }
    if (next.default !== `${source}/${name}`) {
        return next;
    }
    const first = Object.entries(next)
        .filter(([key]) => key !== "default")
        .flatMap(([s, list]) => Object.keys(list).map((n) => `${s}/${n}`))[0];
    if (first) {
        return setDefault(next, first);
    }
    delete next.default;
    return next;
};

// projects.json with source/from renamed to source/to, in the same place in the file, the default following along
const renameProject = (projects, source, from, to) => {
    const renamed = Object.fromEntries(Object.entries(projects[source] ?? {}).map(([name, entry]) => [name === from ? to : name, entry]));
    const next = { ...projects, [source]: renamed };
    return next.default === `${source}/${from}` ? setDefault(next, `${source}/${to}`) : next;
};

// the cron.sh lines in a crontab (`crontab -l`) that run project id. before/after resolve a line's own -s/-p flags to a
// project id (null = an error) with the project still there and without it. -> [{ line, named, to }]: named = it has -p
// (it fails once the project is gone), else it ran id as a default and runs `to` from now on (null: fails too)
const cronLinesFor = (crontab, id, before, after) => String(crontab ?? "").split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && /cron\.sh(\s|$)/.test(line))
    .flatMap((line) => {
        // the options after `cron.sh <script>`, up to a redirect or the next command
        const options = line.split(/cron\.sh\s+\S+/)[1]?.split(/\s(?:>|>>|2>|2>&1|&&|\||;)/)[0] ?? "";
        let flags;
        try {
            flags = parseProjectArgs(options.split(/\s+/).filter(Boolean));
        } catch {
            return [];
        }
        if (before(flags) !== id) {
            return [];
        }
        return [{ line, named: Boolean(flags.project), to: flags.project ? null : after(flags) }];
    });

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
    if (fs.existsSync(VENV_PYTHON) && hasPackages(VENV_PYTHON)) {
        ok("Python environment (.venv) with Pillow, HEIC and video support");
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

    step("Installing Python packages (Pillow, pillow-heif, PyAV)");
    // wheels only: pip never builds a package from source (and runs its build script)
    if (run(VENV_PYTHON, ["-m", "pip", "install", "--quiet", "--only-binary", ":all:", "-r", "requirements.txt"]).status !== 0) {
        warn("Could not install the Python packages - run `npm run setup:python` again");
        return false;
    }
    ok("Python environment (.venv) with Pillow, HEIC and video support");
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

// the Meet background is a video (an uploaded image gets converted to a small webp, too small to put a collage in): the
// Anaglypta card (assets/anaglypta.mp4), padded to CARD_BYTES so a collage video fits. Meet's upload only offers images
// until this line has run in Chrome's console
const MEET_CONSOLE_LINE = "document.querySelector('input[type=\"file\"]').setAttribute('accept', 'image/jpeg, image/png, video/mp4');";

// npm run setup:meet
const setupMeet = async (input, project) => {
    const { KEY, CARD_BYTES, padTo, isMp4, readHead } = require("./meet");
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
            return run(process.execPath, [path.join(__dirname, "meet.js"), "--project", project.id]).status === 0;
        }
        console.log(`  Make a collage with \`npm run collage -- -p ${project.id}\`, then \`npm run meet\` puts it in`);
        return true;
    }
    warn(`Couldn't find the file - set ${KEY} by hand (see docs/reference.md)`);
    return false;
};

// --- projects ---

// `crontab -l`, "" when there's no crontab, null when there's no crontab command (windows)
const readCrontab = () => {
    const result = spawnSync("crontab", ["-l"], { encoding: "utf8" });
    if (result.error) {
        return null;
    }
    return result.status === 0 ? result.stdout : "";
};

const SOURCES = {
    spotify: "the album covers of a Spotify playlist",
    local: "the images in a folder on this computer",
    tmdb: "the posters of a TMDb list (movies and series)",
};

const isYes = (answer) => answer !== null && /^y/i.test(answer.trim());

// the default project's source/name, null when projects.json points at one that doesn't exist
const defaultId = () => {
    try {
        return getProject({}).id;
    } catch {
        return null;
    }
};

const askSource = async (input, sources) => {
    console.log(`\n${sources.map((source, i) => `    ${i + 1}. ${source} - ${SOURCES[source] ?? source}`).join("\n")}\n`);
    return askUntil(input, `  Make a collage from [${sources.map((_, i) => i + 1).join("/")}, empty to skip]: `,
        (answer) => sources[Number(answer.trim()) - 1] ?? sources.find((source) => source === answer.trim().toLowerCase()),
        `Pick ${sources.map((_, i) => i + 1).join(" or ")}`);
};

// asks for a name (suggestion on Enter), turned into kebab-case, null = skip. replace: an existing name may be replaced
// (asks first), else it has to be a new one
const askProjectName = async (input, source, projects, suggestion, { replace = true } = {}) => {
    for (;;) {
        const answer = await input.ask(`  Project name${suggestion ? ` [${suggestion}]` : ""}: `);
        if (answer === null) {
            return null;
        }
        if (/^\s*(https?:|spotify:)/i.test(answer)) {
            warn("That's a link - type a short name for the project, like my-playlist");
            continue;
        }
        const name = toKebab(answer.trim() || suggestion);
        if (!name) {
            if (!answer.trim()) {
                return null;
            }
            warn("Use letters and digits, like my-playlist");
            continue;
        }
        if (name === MIX) {
            warn(`"${MIX}" is reserved (-p ${MIX} picks a random project) - pick another name`);
            continue;
        }
        if (projects[source]?.[name]) {
            if (!replace) {
                warn(`${source}/${name} already exists - pick another name`);
                continue;
            }
            if (!isYes(await input.ask(`  ${source}/${name} already exists - replace it? [y/N] `))) {
                continue;
            }
        }
        return name;
    }
};

// the playlist's name for the project name, when logged in (setup doesn't load .env into process.env by itself)
const lookupPlaylistName = async (playlistId) => {
    const env = readEnv();
    if (!fs.existsSync(TOKEN_PATH) && !env.CLIENT_SECRET) {
        return null;
    }
    for (const key of ["CLIENT_ID", "CLIENT_SECRET", "SPOTIFY_MARKET"]) {
        if (env[key] && !process.env[key]) {
            process.env[key] = env[key];
        }
    }
    try {
        return (await require("../api/spotify").getPlaylistMeta(playlistId)).name;
    } catch (error) {
        warn(`Couldn't look up the playlist (${error.message})`);
        return null;
    }
};

// a TMDb list's name and length for the project name, when TMDB_TOKEN is set (setup doesn't load .env by itself)
const lookupList = async (listId) => {
    const token = readEnv().TMDB_TOKEN;
    if (!token) {
        return null;
    }
    process.env.TMDB_TOKEN ||= token;
    try {
        return await require("../api/tmdb").getListPage(listId, 1);
    } catch (error) {
        warn(`Couldn't look up the list (${error.message})`);
        return null;
    }
};

const askTmdbProject = async (input, projects) => {
    console.log("\n  Your list: on themoviedb.org, open the list and copy its link (themoviedb.org/list/<number>...).");
    console.log("  It has to be public (a setting when you edit the list).\n");
    const listId = await askUntil(input, "  List link (empty to skip): ", parseListId,
        "That doesn't look like a list link (https://www.themoviedb.org/list/...)");
    if (!listId) {
        return null;
    }
    const list = await lookupList(listId);
    if (list) {
        ok(`List: ${list.name}${list.itemCount !== null ? ` (${list.itemCount} entries)` : ""}`);
    }
    const name = await askProjectName(input, "tmdb", projects, toKebab(list?.name));
    return name && { name, entry: { list: `https://www.themoviedb.org/list/${listId}` } };
};

const printTmdbGuide = () => {
    console.log(`
  Get a TMDb token (once, free for non-commercial use):
    1. Make an account at https://www.themoviedb.org/signup
    2. Open https://www.themoviedb.org/settings/api and request an API key (type: personal). As the
       application URL, your copy of the repo (e.g. on GitHub) or http://127.0.0.1 is fine
    3. Copy the "API Read Access Token" - the long one starting with eyJ, not the shorter API Key
`);
};

// TMDB_TOKEN, only asked when there's a tmdb project
const setupTmdb = async (input, todo) => {
    if (readEnv().TMDB_TOKEN) {
        ok("TMDB_TOKEN is set");
        return;
    }
    printTmdbGuide();
    const token = await askUntil(input, "  API Read Access Token (empty to skip): ", (answer) => isTmdbToken(answer) && answer.trim(),
        "That doesn't look like the Read Access Token (it starts with eyJ and is a few hundred characters long)");
    if (token) {
        writeEnvValue("TMDB_TOKEN", token);
        ok("TMDB_TOKEN saved to .env");
    } else {
        todo.push("Add TMDB_TOKEN to .env (the API Read Access Token from https://www.themoviedb.org/settings/api)");
    }
};

const askSpotifyProject = async (input, projects) => {
    console.log("\n  Your playlist: in Spotify, open the playlist -> ... -> Share -> Copy link to playlist.");
    console.log("  It has to be a playlist you own or collaborate on.\n");
    const playlistId = await askUntil(input, "  Playlist link (empty to skip): ", parsePlaylistId,
        "That doesn't look like a playlist link (https://open.spotify.com/playlist/...)");
    if (!playlistId) {
        return null;
    }
    const title = await lookupPlaylistName(playlistId);
    if (title) {
        ok(`Playlist: ${title}`);
    }
    const name = await askProjectName(input, "spotify", projects, toKebab(title));
    return name && { name, entry: { playlist: `https://open.spotify.com/playlist/${playlistId}` } };
};

// how many images local.py would find (it knows the file types), null when python isn't ready
const countImages = (folder) => {
    const result = spawnSync(process.execPath, [path.join(__dirname, "python.js"), path.join(__dirname, "sources", "local.py"), "--count", folder],
        { cwd: ROOT, encoding: "utf8" });
    try {
        return JSON.parse(result.stdout);
    } catch {
        return null;
    }
};

const askLocalProject = async (input, projects) => {
    console.log("\n  A folder of images (jpg, png, webp, gif, heic, ...). Only that folder, not its subfolders. Tip: drag it into the terminal.\n");
    const isDir = (dir) => fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;
    const folder = await askUntil(input, "  Folder (empty to skip): ", (answer) => {
        const dir = path.resolve(parseFolderInput(answer));
        return isDir(dir) && dir;
    }, "That isn't a folder");
    if (!folder) {
        return null;
    }
    const count = countImages(folder);
    if (count?.images === 0) {
        warn(`No images in ${tilde(folder)} yet - add some before \`npm run full\``);
    } else if (count) {
        ok(`${count.images} images${count.others ? ` (and ${count.others} other files, ignored)` : ""}`);
        const maxItems = readSettings().defaults?.maxItems ?? 200;
        if (count.images > maxItems) {
            warn(`Only the newest ${maxItems} are used (maxItems in settings.json, or per project in projects.json)`);
        }
    }
    const aspect = await askAspect(input);
    const name = await askProjectName(input, "local", projects, toKebab(path.basename(folder)));
    // a shape other than square gets a grid that grows with the folder (the default 13x9 is made for square tiles)
    const shape = aspect === "1:1" ? {} : { aspect, collage: { layout: "auto" } };
    return name && { name, entry: { path: tilde(folder), ...shape } };
};

const ASPECTS = [
    ["1:1", "square"],
    ["2:3", "portrait - phone photos, posters"],
    ["3:2", "landscape - camera photos"],
    ["16:9", "wide - screenshots, video stills"],
];

// the tiles' shape, Enter = square
const askAspect = async (input) => {
    console.log(`\n  The shape of the tiles (the images are cropped to it around the middle):`);
    console.log(ASPECTS.map(([aspect, what], i) => `    ${i + 1}. ${aspect.padEnd(5)} ${what}`).join("\n"));
    const aspect = await askUntil(input, `  Shape [1-${ASPECTS.length}, Enter = square]: `,
        (answer) => ASPECTS[Number(answer.trim()) - 1]?.[0] ?? ASPECTS.find(([value]) => value === answer.trim())?.[0],
        `Pick a number from 1 to ${ASPECTS.length}`);
    return aspect ?? "1:1";
};

// CLIENT_ID and the login, only asked when there's a spotify project
const setupSpotify = async (input, todo) => {
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

    const env = readEnv();
    if (fs.existsSync(TOKEN_PATH)) {
        ok("Logged in to Spotify");
    } else if (env.CLIENT_SECRET) {
        ok("CLIENT_SECRET is set (app mode, only works for apps created before 2026)");
    } else if (!env.CLIENT_ID) {
        todo.push("Log in to Spotify: `npm run auth` (after adding CLIENT_ID)");
    } else if (!process.stdin.isTTY) {
        // the login opens a browser and waits for it, only when someone is at the terminal
        todo.push("Log in to Spotify: `npm run auth`");
    } else {
        const answer = await input.ask("\n  Log in to Spotify now? [Y/n] ");
        if (answer !== null && !/^n/i.test(answer.trim()) && run(process.execPath, [path.join(__dirname, "auth.js")]).status === 0) {
            ok("Logged in to Spotify");
        } else {
            todo.push("Log in to Spotify: `npm run auth`");
        }
    }
};

const main = async () => {
    const pythonOnly = process.argv.includes("--python");
    checkNode();

    if (pythonOnly) {
        process.exitCode = setupPython() ? 0 : 1;
        return;
    }
    if (process.argv.includes("--meet")) {
        const { source, project } = parseProjectArgs(process.argv.slice(2));
        const meetProject = getProject({ source, project });
        ensureEnvFile();
        const input = createInput();
        process.exitCode = (await setupMeet(input, meetProject)) ? 0 : 1;
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
    const settings = readSettings();
    const sources = Object.keys(settings.sources);
    const ids = () => listProjects(settings, readProjects()).map(({ source, name }) => `${source}/${name}`);
    let added = null;

    // a source's credentials, asked once per run: the Spotify app + login, the TMDb token
    const credentials = { spotify: () => setupSpotify(input, todo), tmdb: () => setupTmdb(input, todo) };
    const askedFor = new Set();
    const ensureCredentials = async (source) => {
        if (credentials[source] && !askedFor.has(source)) {
            askedFor.add(source);
            await credentials[source]();
        }
    };
    const adders = { spotify: askSpotifyProject, local: askLocalProject, tmdb: askTmdbProject };

    // a number from the list, or source/name
    const pickProject = (question) => {
        const list = ids();
        return askUntil(input, `  ${question} [1-${list.length}, empty to ${list.length > 1 ? "cancel" : "skip"}]: `,
            (answer) => list[Number(answer.trim()) - 1] ?? list.find((id) => id === answer.trim()),
            `Pick a number from 1 to ${list.length}`);
    };

    const add = async () => {
        const source = await askSource(input, sources.filter((name) => adders[name]));
        if (!source) {
            return;
        }
        await ensureCredentials(source);
        const projects = readProjects();
        const project = await adders[source](input, projects);
        if (!project) {
            return;
        }
        const makeDefault = ids().length > 0 && isYes(await input.ask(`  Make ${source}/${project.name} the default project? [y/N] `));
        writeProjects(addProject(projects, source, project.name, project.entry, { makeDefault }));
        ok(`Added ${source}/${project.name} to projects.json`);
        added = { source, project: project.name };
    };

    const changeDefault = async () => {
        const id = await pickProject("Default project");
        if (id) {
            writeProjects(setDefault(readProjects(), id));
            ok(`${id} is the default project`);
        }
    };

    // the project id a cron line's flags pick with these projects, null when they pick none
    const resolveWith = (projects) => ({ source, project: name }) => {
        try {
            return resolveProject(settings, projects, { source, project: name }).id;
        } catch {
            return null;
        }
    };

    const remove = async () => {
        const id = await pickProject("Remove project");
        if (!id) {
            return;
        }
        const project = getProject({ project: id });
        const isDefault = id === defaultId();
        const crontab = readCrontab();
        const current = readProjects();
        const lines = cronLinesFor(crontab, id, resolveWith(current), resolveWith(removeProject(current, project.source, project.name)));
        const show = (list) => console.log(list.map(({ line }) => `      ${line}`).join("\n"));
        const failing = lines.filter(({ to }) => !to);
        const moving = lines.filter(({ to }) => to);
        if (failing.length) {
            warn(`Your crontab (crontab -l) runs ${id}, these lines fail once it's gone:`);
            show(failing);
            console.log("    Remove or change them first (`crontab -e`, in another terminal).");
        }
        for (const to of new Set(moving.map((entry) => entry.to))) {
            ok(`These crontab lines don't name a project and run ${id} now - they keep running, with ${to} from now on:`);
            show(moving.filter((entry) => entry.to === to));
        }
        if (!lines.length && crontab !== null) {
            ok(`Nothing in your crontab (crontab -l) runs ${id}`);
        }
        console.log(`\n  This deletes ${project.folder}/ (what was fetched, the images and collages) and removes it from projects.json.`);
        if (project.source === "local" && project.path) {
            console.log(`  Your images in ${tilde(project.path)} aren't touched.`);
        }
        if (!isYes(await input.ask(`  Remove ${id}? [y/N] `))) {
            ok("Nothing removed");
            return;
        }
        fs.rmSync(project.dir, { recursive: true, force: true });
        const sourceDir = path.dirname(project.dir);
        if (fs.existsSync(sourceDir) && !fs.readdirSync(sourceDir).length) {
            fs.rmdirSync(sourceDir);
        }
        const next = removeProject(readProjects(), project.source, project.name);
        writeProjects(next);
        ok(`Removed ${id}`);
        if (isDefault && next.default) {
            ok(`${next.default} is the default project now`);
        }
        if (added && `${added.source}/${added.project}` === id) {
            added = null;
        }
    };

    const rename = async () => {
        const id = await pickProject("Rename project");
        if (!id) {
            return;
        }
        const project = getProject({ project: id });
        const current = readProjects();
        const title = project.source === "spotify" && project.playlistId ? await lookupPlaylistName(project.playlistId)
            : project.source === "tmdb" && project.listId ? (await lookupList(project.listId))?.name : null;
        const name = await askProjectName(input, project.source, current, toKebab(title ?? ""), { replace: false });
        if (!name || name === project.name) {
            ok("Nothing renamed");
            return;
        }
        const next = renameProject(current, project.source, project.name, name);
        const newId = `${project.source}/${name}`;

        const failing = cronLinesFor(readCrontab(), id, resolveWith(current), resolveWith(next)).filter(({ to }) => !to);
        if (failing.length) {
            warn(`These crontab (crontab -l) lines name ${id} - change them to -p ${newId} (\`crontab -e\`, in another terminal):`);
            console.log(failing.map(({ line }) => `      ${line}`).join("\n"));
        }
        if (!isYes(await input.ask(`  Rename ${id} to ${newId}? [y/N] `))) {
            ok("Nothing renamed");
            return;
        }

        if (fs.existsSync(project.dir)) {
            const target = path.join(path.dirname(project.dir), name);
            fs.renameSync(project.dir, target);
            const itemsFile = path.join(target, "items.json");
            if (fs.existsSync(itemsFile)) {
                const data = JSON.parse(fs.readFileSync(itemsFile, "utf8"));
                fs.writeFileSync(itemsFile, JSON.stringify({ ...data, project: name }, null, 2) + "\n");
            }
        }
        writeProjects(next);
        ok(`Renamed ${id} to ${newId}`);
        if (added && `${added.source}/${added.project}` === id) {
            added = { source: project.source, project: name };
        }
    };

    for (const source of Object.keys(credentials)) {
        if (ids().some((id) => id.startsWith(`${source}/`))) {
            await ensureCredentials(source);
        }
    }

    if (!ids().length) {
        console.log("\n  Let's add your first project.");
        await add();
    } else {
        for (;;) {
            const list = ids();
            if (!list.length) {
                break;
            }
            const current = defaultId();
            ok("Projects:");
            console.log(list.map((id, i) => `    ${i + 1}. ${id}${id === current ? " (default)" : ""}${cacheNote(getProject({ project: id }))}`).join("\n"));
            if (!current) {
                warn("No default project (the one used without -p) - pick one");
                await changeDefault();
            }
            const choices = ["[a]dd a project", ...(list.length > 1 ? ["change the [d]efault"] : []), "re[n]ame", "[r]emove one"];
            const answer = await input.ask(`\n  ${choices.join(", ")}, or Enter when done: `);
            const choice = answer?.trim().toLowerCase()[0];
            if (!choice) {
                break;
            }
            const action = { a: add, d: list.length > 1 && changeDefault, n: rename, r: remove }[choice];
            if (action) {
                await action();
            } else {
                warn(`Type ${list.length > 1 ? "a, d, n or r" : "a, n or r"}`);
            }
            console.log();
        }
    }
    input.close();

    if (!ids().length) {
        todo.push("Add a project: `npm run setup`");
    }
    if (todo.length) {
        console.log(`\nAlmost there, still to do:\n${todo.map((item) => `  - ${item}`).join("\n")}`);
        console.log("Then run `npm run setup` again to check.");
        process.exitCode = 1;
        return;
    }

    const project = getProject(added ?? {});
    const flags = project.id === defaultId() ? "" : ` -- -p ${project.id}`;
    const pad = (command) => command.padEnd(flags.length + 20);
    console.log(`\n✅ All set! Next, for ${project.id}:`);
    console.log(`  ${pad(`npm run full${flags}`)} # fetch everything (up to maxItems)`);
    console.log(`  ${pad(`npm run collage${flags}`)} # draw a random collage, again whenever you like`);
    console.log(`  ${pad(`npm run daily-new${flags}`)} # later: add one new item a day, with it in the middle`);
    if (!readEnv().GOOGLE_MEET_BLOB_PATH) {
        console.log(`\nOptional: use the collage as your Google Meet background - \`npm run setup:meet${flags}\` (once you have a collage)`);
    }
};

if (require.main === module) {
    main().catch((error) => {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { parsePlaylistId, isClientId, isTmdbToken, parseEnv, setEnvValue, parseFolderInput, setDefault, addProject, removeProject, renameProject, cronLinesFor };
