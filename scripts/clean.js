// npm run clean: removes everything that can be rebuilt (every project's square image copies in images/, and the padded
// Meet card in tmp-upload/)
// npm run reset [-- -p <project>]: removes one project's folder (items.json, images, collages) for a fresh start -
// asks first, --yes skips that. The project stays in projects.json, the next fetch starts from scratch.
// never touches .env, .spotify-token.json, projects.json, .venv or node_modules
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");

const { ROOT, getProject, parseProjectArgs } = require("./project");

const filesIn = (dir, matches = () => true) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(matches).map((file) => path.join(dir, file)) : []);
const notGitkeep = (file) => file !== ".gitkeep";
// only the folders (projects/ also holds .mix.json, and Finder leaves .DS_Store files around)
const dirsIn = (dir) => filesIn(dir).filter((file) => fs.statSync(file).isDirectory());

// projects/<source>/<name>/images of every project on disk
const imageDirs = (root = ROOT) => dirsIn(path.join(root, "projects"))
    .flatMap((sourceDir) => dirsIn(sourceDir))
    .map((projectDir) => path.join(projectDir, "images"));

const cleanTargets = (root = ROOT) => [
    path.join(root, "scripts", "__pycache__"),
    // a source with python in it (local.py) gets one next to it
    ...dirsIn(path.join(root, "lib", "sources")).map((sourceDir) => path.join(sourceDir, "__pycache__")),
    ...imageDirs(root),
    ...filesIn(path.join(root, "tmp-upload"), notGitkeep),
];

const main = async () => {
    const { source, project: name, rest } = parseProjectArgs(process.argv.slice(2));
    const reset = rest.includes("--reset");
    const project = reset ? getProject({ source, project: name }) : null;
    const targets = (reset ? [project.dir] : cleanTargets()).filter((target) => fs.existsSync(target));

    if (!targets.length) {
        console.log("Nothing to remove");
        return;
    }

    console.log(`${reset ? "Reset" : "Clean"} removes:\n${targets.map((target) => `  ${path.relative(ROOT, target)}`).join("\n")}`);

    if (reset && !rest.includes("--yes")) {
        const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await prompt.question(`This deletes everything fetched for ${project.id}, it's fetched again on the next run. Continue? [y/N] `);
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

if (require.main === module) {
    main().catch((error) => {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { cleanTargets };
