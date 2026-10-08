// runs a python script with the project's .venv python (falls back to python3/python with Pillow installed)
// usage: node scripts/python.js <script.py> [args...]
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const VENV_PYTHON = process.platform === "win32"
    ? path.join(ROOT, ".venv", "Scripts", "python.exe")
    : path.join(ROOT, ".venv", "bin", "python");

const findPython = () => {
    if (fs.existsSync(VENV_PYTHON)) {
        return VENV_PYTHON;
    }
    for (const candidate of ["python3", "python"]) {
        if (spawnSync(candidate, ["-c", "import PIL"], { stdio: "ignore" }).status === 0) {
            return candidate;
        }
    }
    return null;
};

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
