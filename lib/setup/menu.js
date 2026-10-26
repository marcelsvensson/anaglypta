// npm run setup's project menu: lists the projects, then [a]dd, change the [d]efault, re[n]ame, [r]emove. What a source
// asks (keys, its project questions, a rename suggestion, a remove note) comes from its adapter in lib/sources/.
// ctx = { input, todo, settings, askedFor, added }: what the menu's steps share during one run (manageProjects makes it)
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { toKebab, ok, warn, isYes, askUntil, askProjectName } = require("./ui");
const { setDefault, addProject, removeProject, renameProject, cronLinesFor } = require("./projects");
const { cacheNote } = require("../utils/cache-limit");
const { readData, writeData } = require("../utils/items");
const { readSettings, readProjects, writeProjects, listProjects, resolveProject } = require("../utils/projects");
const { getProject } = require("../utils/cli");
const { SOURCES } = require("../sources");

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

// the sources in settings.json's order that have an adapter to add projects with
const addableSources = (ctx) => Object.keys(ctx.settings.sources).filter((name) => SOURCES[name]?.addProject);

const ids = (ctx) => listProjects(ctx.settings, readProjects()).map(({ source, name }) => `${source}/${name}`);

const askSource = async (input, sources) => {
    console.log(`\n${sources.map((source, i) => `    ${i + 1}. ${source} - ${SOURCES[source].description}`).join("\n")}\n`);
    return askUntil(input, `  Make a collage from [${sources.map((_, i) => i + 1).join("/")}, empty to skip]: `,
        (answer) => sources[Number(answer.trim()) - 1] ?? sources.find((source) => source === answer.trim().toLowerCase()),
        `Pick ${sources.map((_, i) => i + 1).join(" or ")}`);
};

// a source's credentials (keys, logins), asked once per run
const ensureCredentials = async (ctx, source) => {
    if (SOURCES[source]?.credentials && !ctx.askedFor.has(source)) {
        ctx.askedFor.add(source);
        await SOURCES[source].credentials(ctx.input, ctx.todo);
    }
};

// a number from the list, or source/name
const pickProject = (ctx, question) => {
    const list = ids(ctx);
    return askUntil(ctx.input, `  ${question} [1-${list.length}, empty to ${list.length > 1 ? "cancel" : "skip"}]: `,
        (answer) => list[Number(answer.trim()) - 1] ?? list.find((id) => id === answer.trim()),
        `Pick a number from 1 to ${list.length}`);
};

// the project id a cron line's flags pick with these projects, null when they pick none
const resolveWith = (ctx, projects) => ({ source, project: name }) => {
    try {
        return resolveProject(ctx.settings, projects, { source, project: name }).id;
    } catch {
        return null;
    }
};

const addOne = async (ctx) => {
    const source = await askSource(ctx.input, addableSources(ctx));
    if (!source) {
        return;
    }
    await ensureCredentials(ctx, source);
    const projects = readProjects();
    const project = await SOURCES[source].addProject(ctx.input, projects);
    if (!project) {
        return;
    }
    const makeDefault = ids(ctx).length > 0 && isYes(await ctx.input.ask(`  Make ${source}/${project.name} the default project? [y/N] `));
    writeProjects(addProject(projects, source, project.name, project.entry, { makeDefault }));
    ok(`Added ${source}/${project.name} to projects.json`);
    ctx.added = { source, project: project.name };
};

const changeDefault = async (ctx) => {
    const id = await pickProject(ctx, "Default project");
    if (id) {
        writeProjects(setDefault(readProjects(), id));
        ok(`${id} is the default project`);
    }
};

const remove = async (ctx) => {
    const id = await pickProject(ctx, "Remove project");
    if (!id) {
        return;
    }
    const project = getProject({ project: id });
    const isDefault = id === defaultId();
    const crontab = readCrontab();
    const current = readProjects();
    const lines = cronLinesFor(crontab, id, resolveWith(ctx, current), resolveWith(ctx, removeProject(current, project.source, project.name)));
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
    if (!isYes(await ctx.input.ask(`  Remove ${id}? [y/N] `))) {
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
    if (ctx.added && `${ctx.added.source}/${ctx.added.project}` === id) {
        ctx.added = null;
    }
};

const rename = async (ctx) => {
    const id = await pickProject(ctx, "Rename project");
    if (!id) {
        return;
    }
    const project = getProject({ project: id });
    const current = readProjects();
    const title = await SOURCES[project.source]?.title?.(project);
    const name = await askProjectName(ctx.input, project.source, current, toKebab(title ?? ""), { replace: false });
    if (!name || name === project.name) {
        ok("Nothing renamed");
        return;
    }
    const next = renameProject(current, project.source, project.name, name);
    const newId = `${project.source}/${name}`;

    const failing = cronLinesFor(readCrontab(), id, resolveWith(ctx, current), resolveWith(ctx, next)).filter(({ to }) => !to);
    if (failing.length) {
        warn(`These crontab (crontab -l) lines name ${id} - change them to -p ${newId} (\`crontab -e\`, in another terminal):`);
        console.log(failing.map(({ line }) => `      ${line}`).join("\n"));
    }
    if (!isYes(await ctx.input.ask(`  Rename ${id} to ${newId}? [y/N] `))) {
        ok("Nothing renamed");
        return;
    }

    if (fs.existsSync(project.dir)) {
        const target = path.join(path.dirname(project.dir), name);
        fs.renameSync(project.dir, target);
        // items.json carries the project's name too
        const moved = { ...project, name, dir: target };
        if (fs.existsSync(path.join(target, "items.json"))) {
            writeData(moved, readData(moved));
        }
    }
    writeProjects(next);
    ok(`Renamed ${id} to ${newId}`);
    if (ctx.added && `${ctx.added.source}/${ctx.added.project}` === id) {
        ctx.added = { source: project.source, project: name };
    }
};

// the whole menu: credentials for the sources that have projects, then the first project or the menu loop. Adds to todo
// what's still missing, returns { source, project } of a project added (or renamed) in this run, null when none
const manageProjects = async (input, todo) => {
    const ctx = { input, todo, settings: readSettings(), askedFor: new Set(), added: null };

    for (const source of addableSources(ctx)) {
        if (ids(ctx).some((id) => id.startsWith(`${source}/`))) {
            await ensureCredentials(ctx, source);
        }
    }

    if (!ids(ctx).length) {
        console.log("\n  Let's add your first project.");
        await addOne(ctx);
    } else {
        for (;;) {
            const list = ids(ctx);
            if (!list.length) {
                break;
            }
            const current = defaultId();
            ok("Projects:");
            console.log(list.map((id, i) => `    ${i + 1}. ${id}${id === current ? " (default)" : ""}${cacheNote(getProject({ project: id }))}`).join("\n"));
            if (!current) {
                warn("No default project (the one used without -p) - pick one");
                await changeDefault(ctx);
            }
            const choices = ["[a]dd a project", ...(list.length > 1 ? ["change the [d]efault"] : []), "re[n]ame", "[r]emove one"];
            const answer = await input.ask(`\n  ${choices.join(", ")}, or Enter when done: `);
            const choice = answer?.trim().toLowerCase()[0];
            if (!choice) {
                break;
            }
            const action = { a: addOne, d: list.length > 1 && changeDefault, n: rename, r: remove }[choice];
            if (action) {
                await action(ctx);
            } else {
                warn(`Type ${list.length > 1 ? "a, d, n or r" : "a, n or r"}`);
            }
            console.log();
        }
    }

    if (!ids(ctx).length) {
        todo.push("Add a project: `npm run setup`");
    }
    return ctx.added;
};

module.exports = { manageProjects, defaultId, addOne, changeDefault, rename, remove };
