const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveProject, getProject, mixCandidates, pickMix, pickMixProject, parseProjectArgs, projectArgs, toKebab, deepMerge, listProjects, readData, writeData, cacheNote, expireCache, reportExpired } = require("../scripts/project");
const { settings, projects, cases, mixCases } = require("./fixtures/project-cases.json");

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

for (const { source, expected } of mixCases) {
    test(`mixCandidates ${source ?? "(every source)"}`, () => {
        assert.deepEqual(mixCandidates(settings, projects, { source: source ?? undefined }), expected);
    });
}

test("pickMix cycles through every candidate before one comes back, a round never starts with the last one", () => {
    assert.deepEqual(pickMix(["a", "b", "c"], {}, () => 0), { id: "a", state: { used: ["a"], last: "a" } });
    assert.deepEqual(pickMix(["a", "b", "c"], { used: ["a"], last: "a" }, () => 0.99), { id: "c", state: { used: ["a", "c"], last: "c" } });
    assert.equal(pickMix(["a", "b", "c"], { used: ["a", "c"], last: "c" }, () => 0).id, "b");
    // a new round, without c (the last one)
    assert.deepEqual(pickMix(["a", "b", "c"], { used: ["a", "b", "c"], last: "c" }, () => 0.99), { id: "b", state: { used: ["b"], last: "b" } });
    // gone projects drop out of the round, a new one joins it
    assert.equal(pickMix(["b", "d"], { used: ["a", "b"], last: "b" }, () => 0).id, "d");
    assert.equal(pickMix(["a"], { used: ["a"], last: "a" }, () => 0).id, "a");
    assert.equal(pickMix([], {}), null);
    // the old { last } state still works
    assert.equal(pickMix(["a", "b"], { last: "a" }, () => 0).id, "a");
});

test("pickMix shows every candidate once per round", () => {
    const candidates = ["a", "b", "c", "d"];
    let state = {};
    const picks = [];
    for (let i = 0; i < 12; i++) {
        ({ id: picks[i], state } = pickMix(candidates, state));
    }
    for (let round = 0; round < 3; round++) {
        assert.deepEqual(picks.slice(round * 4, round * 4 + 4).sort(), candidates);
    }
    assert.ok(picks.every((id, i) => id !== picks[i - 1]));
});

test("pickMixProject skips projects without items and remembers its pick in projects/.mix.json", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    t.mock.method(console, "log", () => {});
    try {
        for (const id of ["local/cats", "local/dogs", "spotify/album"]) {
            writeData(resolveProject(settings, projects, { project: id }, root), { items: [{ id: "a" }] });
        }
        const picked = [];
        for (let i = 0; i < 4; i++) {
            picked.push(pickMixProject(settings, projects, undefined, root, () => 0).id);
        }
        // tmdb/series has no items, spotify/cats opts out, every one once per round
        assert.deepEqual(picked, ["local/cats", "local/dogs", "spotify/album", "local/cats"]);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "projects", ".mix.json"), "utf8")), { used: ["local/cats"], last: "local/cats" });
        assert.equal(pickMixProject(settings, projects, "spotify", root).id, "spotify/album");
        assert.throws(() => pickMixProject(settings, projects, "tmdb", root), /No tmdb projects in the mix/);
        assert.throws(() => pickMixProject(settings, projects, "instagram", root), /Unknown source/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("getProject only takes -p mix when asked to", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    t.mock.method(console, "log", () => {});
    try {
        fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify(settings));
        fs.writeFileSync(path.join(root, "projects.json"), JSON.stringify(projects));
        writeData(resolveProject(settings, projects, { project: "dogs" }, root), { items: [{ id: "a" }] });
        assert.throws(() => getProject({ project: "mix" }, root), /-p mix only works with collage, video, random-meet, daily-new and meet/);
        assert.equal(getProject({ project: "mix" }, root, { mix: true }).id, "local/dogs");
        assert.equal(getProject({ project: "cats", source: "local" }, root, { mix: true }).id, "local/cats");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

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
    assert.deepEqual(all.map(([script]) => script), ["fetch.js", "collage.js", "meet.js"]);
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

test("cacheNote warns about images close to or past the cache limit, only for sources with one", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    try {
        const project = { source: "tmdb", name: "s", id: "tmdb/s", dir: path.join(root, "s"), maxCacheDays: 180 };
        const now = Date.now();
        writeData(project, { items: [{ id: "a" }, { id: "b" }] });
        fs.mkdirSync(path.join(project.dir, "images"));
        const poster = (id, daysAgo) => {
            const file = path.join(project.dir, "images", `${id}.jpg`);
            fs.writeFileSync(file, "x");
            fs.utimesSync(file, new Date(now - daysAgo * 86400000), new Date(now - daysAgo * 86400000));
        };
        poster("a", 10);
        poster("b", 10);
        assert.equal(cacheNote(project, now), "");
        poster("b", 160);
        assert.match(cacheNote(project, now), /1 image\(s\) expire within 30 days, run `npm run full -- -p tmdb\/s`/);
        poster("b", 200);
        assert.match(cacheNote(project, now), /1 image\(s\) past the 180-day limit/);
        assert.equal(cacheNote({ ...project, maxCacheDays: undefined }, now), "");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// expireCache: the cache limit of sources like tmdb, with fixed dates
const NOW = Date.parse("2026-10-20T12:00:00");
const DAY = 86400000;

const expireProject = (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const project = { source: "tmdb", name: "s", id: "tmdb/s", dir: path.join(root, "s"), maxCacheDays: 180 };
    const imageFile = (id) => path.join(project.dir, "images", `${id}.jpg`);
    // an item fetched days ago, with an image downloaded imageDaysAgo (none when undefined)
    const item = (id, fetchedDaysAgo, imageDaysAgo) => {
        if (imageDaysAgo !== undefined) {
            fs.mkdirSync(path.dirname(imageFile(id)), { recursive: true });
            fs.writeFileSync(imageFile(id), "x");
            const when = new Date(NOW - imageDaysAgo * DAY);
            fs.utimesSync(imageFile(id), when, when);
        }
        return { id, fetchedAt: new Date(NOW - fetchedDaysAgo * DAY).toISOString().slice(0, 10) };
    };
    return { project, imageFile, item };
};

test("expireCache removes what's past the limit and counts what's close", (t) => {
    const { project, imageFile, item } = expireProject(t);
    writeData(project, { items: [item("fresh", 10, 149), item("soon", 10, 151), item("old-image", 10, 181), item("old-item", 181, 10), item("no-image", 10)] });
    assert.deepEqual(expireCache(project, NOW), { items: 1, images: 1, soon: 1 });
    assert.deepEqual(readData(project).items.map(({ id }) => id), ["fresh", "soon", "old-image", "no-image"]);
    assert.ok(fs.existsSync(imageFile("fresh")));
    assert.ok(!fs.existsSync(imageFile("old-image")), "downloaded again when needed");
    assert.ok(!fs.existsSync(imageFile("old-item")), "goes with its item");
});

test("expireCache uses addedAt for items without fetchedAt, and keeps items without a date", (t) => {
    const { project } = expireProject(t);
    writeData(project, { items: [{ id: "a", addedAt: "2026-01-01" }, { id: "b", addedAt: "not a date" }, { id: "c" }] });
    assert.equal(expireCache(project, NOW).items, 1);
    assert.deepEqual(readData(project).items.map(({ id }) => id), ["b", "c"]);
});

test("expireCache never touches sources without a limit", (t) => {
    const { project, item } = expireProject(t);
    delete project.maxCacheDays;
    writeData(project, { items: [item("old", 999, 999)] });
    assert.deepEqual(expireCache(project, NOW), { items: 0, images: 0, soon: 0 });
    assert.equal(readData(project).items.length, 1);
});

test("reportExpired explains what happened", (t) => {
    const { project } = expireProject(t);
    const errors = t.mock.method(console, "error", () => {});
    const logs = t.mock.method(console, "log", () => {});
    reportExpired(project, { items: 2, images: 1, soon: 3 });
    reportExpired(project, { items: 0, images: 0, soon: 0 });
    const text = (mock) => mock.mock.calls.map((call) => call.arguments.join(" ")).join("\n");
    assert.match(text(errors), /2 item\(s\) of tmdb\/s were last fetched over 180 days ago/);
    assert.match(text(errors), /npm run full -- -p tmdb\/s/);
    assert.match(text(logs), /3 image\(s\) of tmdb\/s expire within 30 days/);
    assert.equal(errors.mock.callCount() + logs.mock.callCount(), 3);
});
