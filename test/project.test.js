const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveProject, parseProjectArgs, projectArgs, toKebab, deepMerge, listProjects, readData, writeData } = require("../scripts/project");
const { settings, projects, cases } = require("./fixtures/project-cases.json");

// the same cases run in test/test_project.py, so both resolvers agree
for (const { flags, expected, error } of cases) {
    test(`resolveProject ${JSON.stringify(flags)}`, () => {
        if (error) {
            assert.throws(() => resolveProject(settings, projects, flags, "/root"), (thrown) => thrown.message.includes(error));
            return;
        }
        const project = resolveProject(settings, projects, flags, "/root");
        for (const [key, value] of Object.entries(expected)) {
            assert.deepEqual(project[key], value, key);
        }
        assert.equal(project.dir, path.join("/root", project.folder));
    });
}

test("resolveProject falls back to settings.json's default without projects.json's", () => {
    const { default: _, ...withoutDefault } = projects;
    assert.equal(resolveProject(settings, withoutDefault, {}).id, "spotify/album");
});

test("resolveProject explains an empty projects.json", () => {
    assert.throws(() => resolveProject(settings, {}, {}), /none yet \(add one with `npm run setup`\)/);
});

test("resolveProject expands ~ in a local path", () => {
    const project = resolveProject(settings, { local: { pics: { path: "~/Pictures" } } }, { project: "pics" });
    assert.equal(project.path, path.join(os.homedir(), "Pictures"));
});

test("deepMerge merges objects and replaces lists", () => {
    assert.deepEqual(deepMerge({ a: { b: 1, c: [1] } }, undefined, { a: { c: [], d: 2 } }), { a: { b: 1, c: [], d: 2 } });
});

test("listProjects lists the projects of known sources only", () => {
    assert.deepEqual(listProjects(settings, { default: "x", spotify: { a: {} }, instagram: { b: {} } }), [{ source: "spotify", name: "a" }]);
});

test("parseProjectArgs reads short, long and = flags and keeps the rest in order", () => {
    assert.deepEqual(parseProjectArgs(["--latest", "-p", "cats", "--source=local", "--limit", "1"]),
        { source: "local", project: "cats", rest: ["--latest", "--limit", "1"] });
    assert.deepEqual(parseProjectArgs(["--project", "spotify/album"]), { source: undefined, project: "spotify/album", rest: [] });
    assert.throws(() => parseProjectArgs(["-p"]), /-p needs a name/);
    assert.throws(() => parseProjectArgs(["-p", "--latest"]), /-p needs a name/);
});

test("projectArgs round-trips through parseProjectArgs", () => {
    const { source, project } = parseProjectArgs(projectArgs({ source: "local", name: "cats" }));
    assert.deepEqual({ source, project }, { source: "local", project: "cats" });
});

test("toKebab makes a folder name from a playlist or folder name", () => {
    assert.equal(toKebab("Chill Vibes 🌊"), "chill-vibes");
    assert.equal(toKebab("  Blåbär & Öl!  "), "blabar-ol");
    assert.equal(toKebab("2024_Summer.Photos"), "2024-summer-photos");
    assert.equal(toKebab("🌊"), "");
});

test("readData and writeData round-trip items.json, a new project is empty", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    try {
        const project = { source: "local", name: "cats", dir: path.join(root, "projects", "local", "cats") };
        assert.deepEqual(readData(project), { source: "local", project: "cats", state: {}, items: [] });
        writeData(project, { ...readData(project), state: { lastFetched: "2026-01-01" }, items: [{ id: "a" }] });
        assert.deepEqual(readData(project).items, [{ id: "a" }]);
        assert.equal(readData(project).state.lastFetched, "2026-01-01");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("daily-new passes the project to every step and other options to the collage", () => {
    const { steps } = require("../scripts/daily-new");
    const all = steps({ source: "local", name: "cats" }, ["--fill"]);
    assert.ok(all.every((args) => args.join(" ").includes("--source local --project cats")));
    assert.deepEqual(all.map(([script]) => script), ["fetch.js", "python.js", "meet.js"]);
    assert.ok(all[1].includes("--fill") && all[1].includes("--latest"));
});

test("clean removes every project's image cache, nothing else in projects/", () => {
    const { cleanTargets } = require("../scripts/clean");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    try {
        for (const dir of ["projects/local/cats/images", "projects/spotify/album/images"]) {
            fs.mkdirSync(path.join(root, dir), { recursive: true });
        }
        fs.writeFileSync(path.join(root, "projects", ".gitkeep"), "");
        const targets = cleanTargets(root).map((target) => path.relative(root, target)).filter((target) => fs.existsSync(path.join(root, target)));
        assert.deepEqual(targets.sort(), ["projects/local/cats/images", "projects/spotify/album/images"]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
