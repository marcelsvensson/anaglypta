// the steam source: the library capsules (2:3) of the games a Steam profile owns into projects/steam/<name>/items.json.
// The project follows the library: the first maxItems games with a capsule (appid order, so the pick is stable), at most
// --limit new ones per run, games that left the library are dropped (with their images). Run through scripts/fetch.js,
// which loads .env. The profile's Game details have to be public
const fs = require("node:fs");
const path = require("node:path");

const { readData, writeData } = require("../../utils/items");

const toItem = (game, source, addedAt) => ({
    id: String(game.appid),
    appid: game.appid,
    title: game.name,
    subtitle: "",
    addedAt,
    source,
});

// pure: the items after this fetch -> { items, added, dropped, noArt }. capsules = Map(appid -> url).
// items keep their order in items.json, new ones at the end. kept items get the current title and capsule url
const syncGames = (existing, games, capsules, { maxItems = 200, limit = Infinity, addedAt }) => {
    const withArt = games.filter((game) => capsules.has(game.appid)).sort((a, b) => a.appid - b.appid);
    const wanted = new Map(withArt.slice(0, maxItems).map((game) => [String(game.appid), game]));
    const known = new Set(existing.map((item) => item.id));

    const added = [];
    for (const [id, game] of wanted) {
        if (!known.has(id) && added.length < limit) {
            added.push(toItem(game, capsules.get(game.appid), addedAt));
        }
    }
    const kept = existing.filter((item) => wanted.has(item.id)).map((item) => {
        const game = wanted.get(item.id);
        return { ...item, title: game.name, source: capsules.get(game.appid) };
    });
    return {
        items: [...kept, ...added],
        added,
        dropped: existing.filter((item) => !wanted.has(item.id)),
        noArt: games.length - withArt.length,
    };
};

// project.steam = { steamId } or { vanity } (parseSteamProfile), a vanity name is looked up once and kept in state
const steamIdFor = async (project, state, steam) => {
    if (project.steam.steamId) {
        return project.steam.steamId;
    }
    if (state.steamId && state.profile === project.profile) {
        return state.steamId;
    }
    const steamId = await steam.resolveVanity(project.steam.vanity);
    if (!steamId) {
        throw new Error(`No Steam profile called "${project.steam.vanity}" - check steam.${project.name}.profile in projects.json`);
    }
    return steamId;
};

// steam = api/steam.js (passed in, so this module doesn't touch the network or .env on import)
const fetchSteam = async (project, { limit = Infinity, steam, now = Date.now() }) => {
    const today = new Date(now).toLocaleDateString("sv");
    if (!project.steam) {
        throw new Error(`steam.${project.name}.profile in projects.json isn't a Steam profile link or id`);
    }
    const data = readData(project);
    const steamId = await steamIdFor(project, data.state, steam);
    const player = await steam.getPlayerName(steamId);
    const games = await steam.getOwnedGames(steamId);
    console.log(`Library: ${player ?? steamId} (${games.length} games)`);
    const capsules = await steam.getCapsules(games.map((game) => game.appid));

    const { items, added, dropped, noArt } = syncGames(data.items, games, capsules, { maxItems: project.maxItems ?? 200, limit, addedAt: today });
    for (const item of dropped) {
        fs.rmSync(path.join(project.dir, "images", `${item.id}.jpg`), { force: true });
    }

    data.items = items;
    data.state.profile = project.profile;
    data.state.steamId = steamId;
    data.state.player = { name: player, url: `https://steamcommunity.com/profiles/${steamId}` };
    if (added.length) {
        data.state.lastFetched = today;
    }
    writeData(project, data);

    if (added.length === 1) {
        console.log(`Added "${added[0].title}"`);
    }
    if (dropped.length) {
        console.log(`Dropped ${dropped.length} game(s) that left the library (or fell outside maxItems)`);
    }
    if (noArt) {
        console.log(`Skipped ${noArt} game(s) without library art on the Steam store`);
    }
    console.log(`${added.length} new item(s), ${items.length} items in ${project.id}`);
};

module.exports = { syncGames, fetchSteam };
