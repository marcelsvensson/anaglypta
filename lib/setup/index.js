// npm run setup (scripts/setup.js runs main): the run around the project menu (menu.js) - Node and Python, .env, the
// todo list and the next steps. Node built-ins only, so it works before `npm ci`
const { readEnv, ensureEnvFile, createInput } = require("./ui");
const { checkNode, installNodePackages, setupPython } = require("./python");
const { setupMeet } = require("./meet");
const { manageProjects, defaultId } = require("./menu");
const { getProject, parseProjectArgs } = require("../utils/cli");
const { SOURCES } = require("../sources");

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
    const added = await manageProjects(input, todo);
    input.close();

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
    if (SOURCES[project.source]?.dailyNew !== false) {
        console.log(`  ${pad(`npm run daily-new${flags}`)} # later: add one new item a day, with it in the middle`);
    }
    if (!readEnv().GOOGLE_MEET_BLOB_PATH) {
        console.log(`\nOptional: use the collage as your Google Meet background - \`npm run setup:meet${flags}\` (once you have a collage)`);
    }
};

module.exports = { main };
