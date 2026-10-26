// npm run setup for tmdb: TMDB_TOKEN (once), a public list per project
const { ok, warn, readEnv, writeEnvValue, askUntil, askProjectName, toKebab } = require("../../setup/ui");
const { parseListId } = require(".");

// TMDb's API Read Access Token is a JWT (eyJ....), the 32-character API key is a different thing
const isTmdbToken = (input) => /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(String(input ?? "").trim());

// a TMDb list's name and length for the project name, when TMDB_TOKEN is set (setup doesn't load .env by itself)
const lookupList = async (listId) => {
    const token = readEnv().TMDB_TOKEN;
    if (!token) {
        return null;
    }
    process.env.TMDB_TOKEN ||= token;
    try {
        return await require("./api").getListPage(listId, 1);
    } catch (error) {
        warn(`Couldn't look up the list (${error.message})`);
        return null;
    }
};

const addProject = async (input, projects) => {
    console.log("\n  Your list: on themoviedb.org, open the list and copy its link (themoviedb.org/list/<number>...).");
    console.log("  It has to be public (a setting when you edit the list).\n");
    const listId = await askUntil(input, "  List link (empty to skip): ", parseListId,
        "That doesn't look like a list link (https://www.themoviedb.org/list/...)");
    if (!listId) {
        return null;
    }
    const list = await lookupList(listId);
    if (list) {
        ok(`List: ${list.name}${list.itemCount !== null ? ` (${list.itemCount} entries)` : ""}`);
    }
    const name = await askProjectName(input, "tmdb", projects, toKebab(list?.name));
    return name && { name, entry: { list: `https://www.themoviedb.org/list/${listId}` } };
};

const printTmdbGuide = () => {
    console.log(`
  Get a TMDb token (once, free for non-commercial use):
    1. Make an account at https://www.themoviedb.org/signup
    2. Open https://www.themoviedb.org/settings/api and request an API key (type: personal). As the
       application URL, your copy of the repo (e.g. on GitHub) or http://127.0.0.1 is fine
    3. Copy the "API Read Access Token" - the long one starting with eyJ, not the shorter API Key
`);
};

// TMDB_TOKEN, only asked when there's a tmdb project
const credentials = async (input, todo) => {
    if (readEnv().TMDB_TOKEN) {
        ok("TMDB_TOKEN is set");
        return;
    }
    printTmdbGuide();
    const token = await askUntil(input, "  API Read Access Token (empty to skip): ", (answer) => isTmdbToken(answer) && answer.trim(),
        "That doesn't look like the Read Access Token (it starts with eyJ and is a few hundred characters long)");
    if (token) {
        writeEnvValue("TMDB_TOKEN", token);
        ok("TMDB_TOKEN saved to .env");
    } else {
        todo.push("Add TMDB_TOKEN to .env (the API Read Access Token from https://www.themoviedb.org/settings/api)");
    }
};

const title = async (project) => (project.listId ? (await lookupList(project.listId))?.name : null);

module.exports = { isTmdbToken, credentials, addProject, title };
