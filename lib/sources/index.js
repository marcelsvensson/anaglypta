// the sources: every folder here with an index.js is one, its adapter. The generic scripts ask the adapter what they need
// (resolve, fetch, setup, daily-new) instead of knowing source names. A new source = a folder + sources.<name> in
// settings.json. Node built-ins only (setup.js runs before `npm ci`), and adapters load nothing heavy on import
const fs = require("node:fs");
const path = require("node:path");

const SOURCES = Object.fromEntries(fs.readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(__dirname, entry.name, "index.js")))
    .map((entry) => [entry.name, require(path.join(__dirname, entry.name))]));

const getSource = (name) => {
    const source = SOURCES[name];
    if (!source) {
        throw new Error(`Can't fetch from ${name} yet - there's no lib/sources/${name}/`);
    }
    return source;
};

// the sources a command can't run (daily-new: dailyNew: false)
const sourcesWithout = (feature) => Object.values(SOURCES).filter((source) => source[feature] === false).map((source) => source.name);

module.exports = { SOURCES, getSource, sourcesWithout };
