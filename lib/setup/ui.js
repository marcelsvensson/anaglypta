// what every setup step shares: output, questions that work for a terminal and piped answers, and .env (read and written,
// never printed). The sources' setup (lib/sources/<name>/setup.js) uses it too. Node built-ins only
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawnSync } = require("node:child_process");

const { ROOT } = require("../utils/files");
const { MIX } = require("../utils/projects");

const ENV_PATH = path.join(ROOT, ".env");
const EXAMPLE_ENV_PATH = path.join(ROOT, ".example.env");

const ok = (message) => console.log(`✓ ${message}`);
const step = (message) => console.log(`→ ${message}`);
const warn = (message) => console.log(`⚠️  ${message}`);

// "Chill Vibes 🌊" -> "chill-vibes", "Blåbär & Ö" -> "blabar-o", a project name that works as a folder name
const toKebab = (text) => String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const isYes = (answer) => answer !== null && /^y/i.test(answer.trim());

const run = (command, args) => spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });

// --- .env ---

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

module.exports = {
    ok, step, warn, isYes, run, toKebab, parseEnv, setEnvValue, readEnv, writeEnvValue, ensureEnvFile, createInput, askUntil,
    askProjectName, askAspect,
};
