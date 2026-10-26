// safety net: importing the project's modules must never load .env - only the entry points (main functions) may.
// Every .js under lib/ and scripts/ is checked, so a new source is covered by itself
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const exampleKeys = fs.readFileSync(path.join(ROOT, ".example.env"), "utf8")
    .split("\n")
    .map((line) => line.match(/^([A-Z_]+)=/)?.[1])
    .filter(Boolean);
// entry points that load .env at the top on purpose
const ENTRY_POINTS = ["lib/sources/spotify/auth.js"];

const modules = ["lib", "scripts"]
    .flatMap((dir) => fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map((file) => path.join(dir, file)))
    .filter((file) => file.endsWith(".js") && !ENTRY_POINTS.includes(file.split(path.sep).join("/")));

test("importing modules doesn't load .env", () => {
    assert.ok(modules.length > 20, "found the modules");
    const before = exampleKeys.filter((key) => key in process.env);

    for (const module of modules) {
        require(path.join(ROOT, module));
    }

    const after = exampleKeys.filter((key) => key in process.env);
    assert.deepEqual(after, before, "a module loaded .env when imported - move require('dotenv').config() into main()");
});
