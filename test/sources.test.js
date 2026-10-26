// the source adapters (lib/sources/<name>/index.js): what the generic scripts rely on, so adding or removing a source is a
// folder + settings.json and nothing else
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SOURCES, getSource, sourcesWithout } = require("../lib/sources");
const { NOT_IMPLEMENTED } = require("../scripts/daily-new");

const ROOT = path.join(__dirname, "..");
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, "settings.json"), "utf8"));

for (const [folder, source] of Object.entries(SOURCES)) {
    test(`the ${folder} adapter has what the generic scripts ask for`, () => {
        assert.equal(source.name, folder, "name is its folder's name");
        assert.equal(typeof source.label, "string");
        assert.equal(typeof source.description, "string");
        for (const hook of ["resolve", "fetch", "addProject"]) {
            assert.equal(typeof source[hook], "function", `${hook}()`);
        }
        for (const hook of ["credentials", "title", "removeNote"]) {
            assert.ok(source[hook] === undefined || typeof source[hook] === "function", `${hook} is optional, a function when set`);
        }
        assert.ok(source.dailyNew === undefined || typeof source.dailyNew === "boolean");
    });
}

test("settings.json and lib/sources know the same sources", () => {
    assert.deepEqual(Object.keys(settings.sources).sort(), Object.keys(SOURCES).sort());
});

test("getSource explains an unknown source", () => {
    assert.equal(getSource("local"), SOURCES.local);
    assert.throws(() => getSource("instagram"), /Can't fetch from instagram yet - there's no lib\/sources\/instagram\//);
});

test("daily-new skips exactly the sources without it", () => {
    assert.deepEqual(NOT_IMPLEMENTED, sourcesWithout("dailyNew"));
    assert.deepEqual(NOT_IMPLEMENTED, Object.values(SOURCES).filter((source) => source.dailyNew === false).map((source) => source.name));
    assert.ok(NOT_IMPLEMENTED.includes("steam"));
});

test("resolve adds the source's own fields", () => {
    assert.deepEqual(SOURCES.local.resolve({ path: "~/cats" }), { path: path.join(os.homedir(), "cats") });
    assert.deepEqual(SOURCES.local.resolve({}), {});
    assert.deepEqual(SOURCES.tmdb.resolve({ list: "42" }), { listId: "42" });
});
