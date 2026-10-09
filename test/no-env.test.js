// safety net: importing the project's modules must never load .env - only the entry points (main functions) may
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const exampleKeys = fs.readFileSync(path.join(ROOT, ".example.env"), "utf8")
    .split("\n")
    .map((line) => line.match(/^([A-Z_]+)=/)?.[1])
    .filter(Boolean);

test("importing modules doesn't load .env", () => {
    const before = exampleKeys.filter((key) => key in process.env);

    for (const module of ["api/spotify", "scripts/generate", "scripts/setup", "scripts/python"]) {
        require(path.join(ROOT, module));
    }

    const after = exampleKeys.filter((key) => key in process.env);
    assert.deepEqual(after, before, "a module loaded .env when imported - move require('dotenv').config() into main()");
});
