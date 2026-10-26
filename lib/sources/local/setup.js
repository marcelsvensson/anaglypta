// npm run setup for local: a folder of images per project, and the tiles' shape. Needs no credentials
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ROOT, expandHome, tilde } = require("../../utils/files");
const { ok, warn, askUntil, askProjectName, askAspect, toKebab } = require("../../setup/ui");
const { readSettings } = require("../../utils/projects");
const { SCRIPT } = require(".");

// a folder as typed or dragged into the terminal: '/My Photos', "/My Photos" or /My\ Photos -> /My Photos
const parseFolderInput = (input) => {
    const text = String(input ?? "").trim();
    const quoted = text.match(/^(["'])(.*)\1$/);
    return expandHome(quoted ? quoted[2] : text.replace(/\\(.)/g, "$1"));
};

// how many images local.py would find (it knows the file types), null when python isn't ready
const countImages = (folder) => {
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "python.js"), path.join(ROOT, SCRIPT), "--count", folder],
        { cwd: ROOT, encoding: "utf8" });
    try {
        return JSON.parse(result.stdout);
    } catch {
        return null;
    }
};

const addProject = async (input, projects) => {
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

// shown before a project is removed
const removeNote = (project) => (project.path ? `Your images in ${tilde(project.path)} aren't touched.` : null);

module.exports = { parseFolderInput, addProject, removeNote };
