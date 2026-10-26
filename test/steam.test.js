const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { normalizeOwnedGames, normalizeStoreItems, getCapsules, request } = require("../lib/sources/steam/api");
const { syncGames, fetchSteam } = require("../lib/sources/steam/fetch");
const { readData, writeData } = require("../scripts/project");
const { parseSteamProfile } = require("../lib/sources/steam");
const { notImplemented } = require("../scripts/daily-new");
const ownedFixture = require("./fixtures/steam-owned-games.json");
const storeFixture = require("./fixtures/steam-store-items.json");

const ASSETS = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";

test("normalizeOwnedGames reads appid and name", () => {
    assert.deepEqual(normalizeOwnedGames(ownedFixture).slice(0, 2), [{ appid: 2358720, name: "Black Myth: Wukong" }, { appid: 620, name: "Portal 2" }]);
});

test("normalizeOwnedGames explains a private library (Steam answers {})", () => {
    assert.throws(() => normalizeOwnedGames({ response: {} }), /Game details have to be Public/);
});

test("normalizeStoreItems takes the library capsule, the 2x first", () => {
    const capsules = normalizeStoreItems(storeFixture);
    assert.equal(capsules.get(620), `${ASSETS}/620/library_600x900_2x.jpg?t=1790187113`);
    assert.equal(capsules.get(1230), `${ASSETS}/1230/portrait.png?t=1447351524`, "an old game with only the 1x");
    assert.equal(capsules.has(660), false, "a DLC without a capsule");
    assert.equal(capsules.has(90), false, "unknown to the store (success 15)");
    assert.equal(capsules.size, 3);
});

test("getCapsules asks the store in batches of 200, without a key", async (t) => {
    const urls = [];
    t.mock.method(globalThis, "fetch", async (url) => {
        urls.push(url);
        return new Response(JSON.stringify(storeFixture));
    });
    const capsules = await getCapsules(Array.from({ length: 450 }, (_, i) => i + 1));
    assert.equal(urls.length, 3);
    assert.ok(urls.every((url) => !url.includes("key=")));
    assert.equal(JSON.parse(new URL(urls[2]).searchParams.get("input_json")).ids.length, 50);
    assert.equal(capsules.size, 3);
});

test("request errors never show the key", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("", { status: 403 }));
    await assert.rejects(request("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=SECRETKEY&steamid=1"), (error) => {
        assert.match(error.message, /Steam 403 on \/IPlayerService\/GetOwnedGames\/v1\/ - check STEAM_API_KEY/);
        assert.doesNotMatch(error.message, /SECRETKEY/);
        return true;
    });
    t.mock.method(globalThis, "fetch", async () => {
        throw new TypeError("fetch failed");
    });
    await assert.rejects(request("https://api.steampowered.com/x/?key=SECRETKEY"), (error) => !error.message.includes("SECRETKEY"));
});

test("parseSteamProfile reads profile links, ids and names", () => {
    assert.deepEqual(parseSteamProfile("https://steamcommunity.com/profiles/76500000000000042/"), { steamId: "76500000000000042" });
    assert.deepEqual(parseSteamProfile(" 76500000000000042 "), { steamId: "76500000000000042" });
    assert.deepEqual(parseSteamProfile("https://steamcommunity.com/id/your-name/games"), { vanity: "your-name" });
    assert.deepEqual(parseSteamProfile("your-name"), { vanity: "your-name" });
    assert.equal(parseSteamProfile("https://store.steampowered.com/app/620/Portal_2/"), null);
    assert.equal(parseSteamProfile(""), null);
    assert.equal(parseSteamProfile(undefined), null);
});

const games = normalizeOwnedGames(ownedFixture);
const capsules = normalizeStoreItems(storeFixture);
const options = { addedAt: "2026-10-26" };

test("syncGames adds the games with a capsule in appid order", () => {
    const { items, added, dropped, noArt } = syncGames([], games, capsules, options);
    assert.deepEqual(items.map((item) => item.id), ["620", "1230", "2358720"]);
    assert.equal(added.length, 3);
    assert.deepEqual(dropped, []);
    assert.equal(noArt, 1);
    assert.deepEqual(items[0], { id: "620", appid: 620, title: "Portal 2", subtitle: "", addedAt: "2026-10-26", source: capsules.get(620) });
});

test("syncGames keeps the order, appends new ones, drops what left the library and refreshes titles and art", () => {
    const existing = [
        { id: "2358720", appid: 2358720, title: "Old title", addedAt: "2026-01-01", source: "old url" },
        { id: "4000", appid: 4000, title: "Sold", addedAt: "2026-01-01", source: "x" },
    ];
    const { items, dropped } = syncGames(existing, games, capsules, options);
    assert.deepEqual(items.map((item) => item.id), ["2358720", "620", "1230"]);
    assert.equal(items[0].title, "Black Myth: Wukong");
    assert.equal(items[0].source, capsules.get(2358720));
    assert.equal(items[0].addedAt, "2026-01-01");
    assert.deepEqual(dropped.map((item) => item.id), ["4000"]);
});

test("syncGames takes the first maxItems and at most limit new ones", () => {
    assert.deepEqual(syncGames([], games, capsules, { ...options, maxItems: 2 }).items.map((item) => item.id), ["620", "1230"]);
    assert.deepEqual(syncGames([{ id: "620" }], games, capsules, { ...options, limit: 1 }).items.map((item) => item.id), ["620", "1230"]);
    assert.deepEqual(syncGames([{ id: "2358720" }], games, capsules, { ...options, maxItems: 2 }).dropped.map((item) => item.id), ["2358720"]);
});

// a fake api/steam.js
const fakeSteam = (calls = []) => ({
    resolveVanity: async (name) => {
        calls.push(`resolve ${name}`);
        return name === "your-name" ? "76500000000000042" : null;
    },
    getPlayerName: async () => "Your Name",
    getOwnedGames: async () => games,
    getCapsules: async () => capsules,
});

test("fetchSteam writes items.json, removes dropped images and resolves a vanity name once", async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    t.mock.method(console, "log", () => {});
    try {
        const project = { source: "steam", name: "games", id: "steam/games", profile: "https://steamcommunity.com/id/your-name", steam: { vanity: "your-name" },
            maxItems: 200, dir: path.join(root, "projects", "steam", "games") };
        writeData(project, { items: [{ id: "4000", title: "Sold" }] });
        fs.mkdirSync(path.join(project.dir, "images"));
        fs.writeFileSync(path.join(project.dir, "images", "4000.jpg"), "x");
        const calls = [];

        await fetchSteam(project, { steam: fakeSteam(calls), now: new Date("2026-10-26T12:00:00").getTime() });
        const data = readData(project);
        assert.equal(data.items.length, 3);
        assert.deepEqual(data.state, {
            profile: "https://steamcommunity.com/id/your-name", steamId: "76500000000000042", lastFetched: "2026-10-26",
            player: { name: "Your Name", url: "https://steamcommunity.com/profiles/76500000000000042" },
        });
        assert.equal(fs.existsSync(path.join(project.dir, "images", "4000.jpg")), false);

        await fetchSteam(project, { steam: fakeSteam(calls) });
        assert.deepEqual(calls, ["resolve your-name"], "the steam id is kept in state");

        await assert.rejects(fetchSteam({ ...project, profile: "nobody", steam: { vanity: "nobody" } }, { steam: fakeSteam() }), /No Steam profile called "nobody"/);
        await assert.rejects(fetchSteam({ ...project, steam: null }, { steam: fakeSteam() }), /isn't a Steam profile link or id/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("daily-new isn't implemented for steam", () => {
    assert.equal(notImplemented("steam").message, "Not implemented for Steam");
    assert.equal(notImplemented("local"), undefined);
    assert.equal(notImplemented(undefined), undefined);
});
