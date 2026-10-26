// npm run setup:python (and the first steps of npm run setup): Node, the Node packages, .venv with the Python packages
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ROOT } = require("../utils/files");
const { ok, step, warn, run } = require("./ui");
const { VENV_PYTHON, hasPackages } = require("../../scripts/python");

const MIN_NODE = 20;
const MIN_PYTHON = [3, 12];

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

module.exports = { checkNode, installNodePackages, setupPython };
