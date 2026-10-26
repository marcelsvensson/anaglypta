// a project's items.json, the one way to read and write it
const fs = require("node:fs");
const path = require("node:path");

const { readJson, writeJson } = require("./files");

// items.json: { source, project, state: {...}, items: [{ id, title, subtitle, addedAt, source }] }, oldest item first
const itemsPath = (dir) => path.join(dir, "items.json");

const readData = (project) => {
    const data = readJson(itemsPath(project.dir), {});
    return { ...data, source: project.source, project: project.name, state: { ...data.state }, items: data.items ?? [] };
};

const writeData = (project, data) => {
    fs.mkdirSync(project.dir, { recursive: true });
    writeJson(itemsPath(project.dir), data);
};

module.exports = { readData, writeData };
