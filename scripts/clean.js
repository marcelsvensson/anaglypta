// npm run clean: removes everything that can be rebuilt (the cover cache in tmp/)
// npm run reset: also removes the fetched albums, images and state.json for a fresh start (asks first, --yes skips that)
// never touches .env, .spotify-token.json, .venv or node_modules
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");

const ROOT = path.join(__dirname, "..");
const { project } = require("../settings.json").spotify;

const filesIn = (dir, matches) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(matches).map((file) => path.join(dir, file)) : []);

const cleanTargets = () => [
    path.join(ROOT, "scripts", "__pycache__"),
    ...filesIn(path.join(ROOT, "tmp"), (file) => file !== ".gitkeep"),
];

const resetTargets = () => [
    ...filesIn(path.join(ROOT, project), (file) => file.endsWith(".md") || file === "bitmap.jpg" || file === "collage.jpg"),
    path.join(ROOT, "state.json"),
];

// "album/ (100 files)" instead of a hundred lines
const summarize = (targets) => {
    const byDir = {};
    for (const target of targets) {
        const dir = path.relative(ROOT, path.dirname(target)) || ".";
        (byDir[dir] ||= []).push(path.basename(target));
    }
    return Object.entries(byDir).map(([dir, files]) =>
        files.length > 3 ? `  ${dir}/ (${files.length} files)` : files.map((file) => `  ${path.join(dir, file)}`).join("\n"));
};

const main = async () => {
    const reset = process.argv.includes("--reset");
    const targets = [...cleanTargets(), ...(reset ? resetTargets() : [])].filter((target) => fs.existsSync(target));

    if (!targets.length) {
        console.log("Nothing to remove");
        return;
    }

    console.log(`${reset ? "Reset" : "Clean"} removes:\n${summarize(targets).join("\n")}`);

    if (reset && !process.argv.includes("--yes")) {
        const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await prompt.question("This deletes your fetched albums, they are fetched again on the next run. Continue? [y/N] ");
        prompt.close();
        if (answer.trim().toLowerCase() !== "y") {
            console.log("Nothing removed");
            return;
        }
    }

    for (const target of targets) {
        fs.rmSync(target, { recursive: true, force: true });
    }
    console.log(`✅ Removed ${targets.length} item(s)`);
};

main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
});
