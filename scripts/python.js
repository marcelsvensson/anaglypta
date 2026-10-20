// runs a python script with the project's .venv python (falls back to python3/python with Pillow installed)
// usage: node scripts/python.js <script.py> [args...], or runPython() for a project's script
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const VENV_PYTHON = process.platform === "win32"
    ? path.join(ROOT, ".venv", "Scripts", "python.exe")
    : path.join(ROOT, ".venv", "bin", "python");

const hasPillow = (python) => spawnSync(python, ["-c", "import PIL"], { stdio: "ignore" }).status === 0;
// everything in requirements.txt (pillow_heif reads HEIC photos), setup.js reinstalls when something is missing
const hasPackages = (python) => spawnSync(python, ["-c", "import PIL, pillow_heif"], { stdio: "ignore" }).status === 0;

const findPython = () => {
    if (fs.existsSync(VENV_PYTHON)) {
        return VENV_PYTHON;
    }
    return ["python3", "python"].find(hasPillow) ?? null;
};

// runs a python script (path from the repo root) for a project: the resolved project goes along as --project-json, so
// python never reads settings.json or projects.json itself. returns the exit status (0 = fine, the script printed why not)
const runPython = (script, project, args = []) => {
    const python = findPython();
    if (!python) {
        throw new Error("Python packages missing - run `npm run setup:python` (needs Python 3)");
    }
    const result = spawnSync(python, [path.join(ROOT, script), "--project-json", JSON.stringify(project), ...args], { cwd: ROOT, stdio: "inherit" });
    if (result.error) {
        throw new Error(`Could not start ${python}: ${result.error.message}`);
    }
    return result.status ?? 1;
};

const main = () => {
    const [script, ...args] = process.argv.slice(2);
    if (!script) {
        console.error("usage: node scripts/python.js <script.py> [args...]");
        process.exit(1);
    }

    const python = findPython();
    if (!python) {
        console.error("❌ Python packages missing - run `npm run setup:python` (needs Python 3)");
        process.exit(1);
    }

    const result = spawnSync(python, [script, ...args], { stdio: "inherit" });
    if (result.error) {
        console.error(`❌ Could not start ${python}: ${result.error.message}`);
    }
    process.exitCode = result.status ?? 1;
};

if (require.main === module) {
    main();
}

module.exports = { VENV_PYTHON, hasPillow, hasPackages, runPython };
