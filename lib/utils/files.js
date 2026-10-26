// where things are on disk: the repo root, ~ in paths (both ways), and the JSON files Anaglypta keeps. Depends on nothing,
// so every module can use it. Node built-ins only (setup runs before `npm ci`)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

const expandHome = (file) => (file === "~" || file.startsWith("~/") ? path.join(os.homedir(), file.slice(1)) : file);

const tilde = (file) => file.replace(os.homedir(), "~");

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);

const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");

module.exports = { ROOT, expandHome, tilde, readJson, writeJson };
