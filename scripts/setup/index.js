// npm run setup: gets a fresh clone ready to run and adds projects to projects.json - safe to re-run, every step skips
// what's already done. What a source needs (keys, logins, its project questions) comes from its adapter in lib/sources/
// npm run setup:python (--python): only the python part
// npm run setup:meet (--meet) [-- -p <project>]: the Google Meet background
// uses node built-ins only, so it works before `npm ci`
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { cacheNote, toKebab, readSettings, readProjects, writeProjects, listProjects, getProject, resolveProject, parseProjectArgs } = require("../project");
const { SOURCES } = require("../../lib/sources");
const { ok, warn, isYes, readEnv, ensureEnvFile, createInput, askUntil, askProjectName } = require("./ui");
const { setDefault, addProject, removeProject, renameProject, cronLinesFor } = require("./projects");
const { checkNode, installNodePackages, setupPython } = require("./python");
const { setupMeet } = require("./meet");

// `crontab -l`, "" when there's no crontab, null when there's no crontab command (windows)
const readCrontab = () => {
    const result = spawnSync("crontab", ["-l"], { encoding: "utf8" });
    if (result.error) {
        return null;
    }
    return result.status === 0 ? result.stdout : "";
};

// the default project's source/name, null when projects.json points at one that doesn't exist
const defaultId = () => {
    try {
        return getProject({}).id;
    } catch {
        return null;
    }
};

const askSource = async (input, sources) => {
    console.log(`\n${sources.map((source, i) => `    ${i + 1}. ${source} - ${SOURCES[source].description}`).join("\n")}\n`);
    return askUntil(input, `  Make a collage from [${sources.map((_, i) => i + 1).join("/")}, empty to skip]: `,
        (answer) => sources[Number(answer.trim()) - 1] ?? sources.find((source) => source === answer.trim().toLowerCase()),
        `Pick ${sources.map((_, i) => i + 1).join(" or ")}`);
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
    // the sources in settings.json's order that have an adapter to add projects with
    const sources = Object.keys(settings.sources).filter((name) => SOURCES[name]?.addProject);
    const ids = () => listProjects(settings, readProjects()).map(({ source, name }) => `${source}/${name}`);
    let added = null;

    // a source's credentials (keys, logins), asked once per run
    const askedFor = new Set();
    const ensureCredentials = async (source) => {
        if (SOURCES[source]?.credentials && !askedFor.has(source)) {
            askedFor.add(source);
            await SOURCES[source].credentials(input, todo);
        }
    };

    // a number from the list, or source/name
    const pickProject = (question) => {
        const list = ids();
        return askUntil(input, `  ${question} [1-${list.length}, empty to ${list.length > 1 ? "cancel" : "skip"}]: `,
            (answer) => list[Number(answer.trim()) - 1] ?? list.find((id) => id === answer.trim()),
            `Pick a number from 1 to ${list.length}`);
    };

    const add = async () => {
        const source = await askSource(input, sources);
        if (!source) {
            return;
        }
        await ensureCredentials(source);
        const projects = readProjects();
        const project = await SOURCES[source].addProject(input, projects);
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
        const note = SOURCES[project.source]?.removeNote?.(project);
        if (note) {
            console.log(`  ${note}`);
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
        const title = await SOURCES[project.source]?.title?.(project);
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

    for (const source of sources) {
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
    if (SOURCES[project.source]?.dailyNew !== false) {
        console.log(`  ${pad(`npm run daily-new${flags}`)} # later: add one new item a day, with it in the middle`);
    }
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

module.exports = { main };
