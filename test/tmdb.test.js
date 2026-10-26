const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { normalizeListPage, getList, posterUrl } = require("../lib/sources/tmdb/api");
const { syncItems, fetchTmdb } = require("../lib/sources/tmdb/fetch");
const { readData, writeData } = require("../lib/utils/items");
const { parseListId } = require("../lib/sources/tmdb");
const fixture = require("./fixtures/tmdb-list.json");

test("normalizeListPage reads series and movies alike", () => {
    const page = normalizeListPage(fixture);
    assert.equal(page.name, "My series");
    assert.equal(page.itemCount, 5);
    assert.deepEqual(page.items[1], { id: 1429, mediaType: "tv", title: "Attack on Titan", year: "2013", posterPath: "/hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg" });
    assert.deepEqual(page.items[3], { id: 496243, mediaType: "movie", title: "Parasite", year: "2019", posterPath: "/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg" });
    assert.equal(page.items[2].posterPath, null);
    assert.equal(page.items[2].year, "");
});

test("normalizeListPage guesses the media type when it's missing", () => {
    const page = normalizeListPage({ items: [{ id: 1, name: "A series", first_air_date: "2020-01-01" }, { id: 2, title: "A movie" }] });
    assert.deepEqual(page.items.map((item) => item.mediaType), ["tv", "movie"]);
});

test("normalizeListPage explains a response without items", () => {
    assert.throws(() => normalizeListPage({ status_message: "nope" }), /is the list public/);
});

// a fake getListPage serving `count` entries, 20 a page
const pages = (count, { totalPages = true, itemCount = true } = {}) => {
    const all = Array.from({ length: count }, (_, i) => ({ id: i, mediaType: "tv", title: `S${i}`, year: "2020", posterPath: `/p${i}.jpg` }));
    const calls = [];
    const getPage = async (listId, page) => {
        calls.push(page);
        return {
            name: "L",
            itemCount: itemCount ? count : null,
            totalPages: totalPages ? Math.max(1, Math.ceil(count / 20)) : null,
            items: all.slice((page - 1) * 20, page * 20),
        };
    };
    return { getPage, calls };
};

test("getList walks every page", async () => {
    for (const options of [{}, { totalPages: false }, { totalPages: false, itemCount: false }]) {
        const { getPage, calls } = pages(47, options);
        const list = await getList("1", getPage);
        assert.equal(list.items.length, 47, JSON.stringify(options));
        assert.deepEqual(calls.slice(0, 3), [1, 2, 3]);
    }
    const { getPage, calls } = pages(40);
    await getList("1", getPage);
    assert.deepEqual(calls, [1, 2], "no extra request when total_pages says it's done");
});

test("posterUrl builds the image url, empty without a poster", () => {
    assert.equal(posterUrl("/abc.jpg"), "https://image.tmdb.org/t/p/w780/abc.jpg");
    assert.equal(posterUrl("/abc.jpg", "w342"), "https://image.tmdb.org/t/p/w342/abc.jpg");
    assert.equal(posterUrl(null), "");
});

test("parseListId reads list links and ids", () => {
    assert.equal(parseListId("https://www.themoviedb.org/list/8512345-my-series?view=grid"), "8512345");
    assert.equal(parseListId("https://www.themoviedb.org/list/8512345"), "8512345");
    assert.equal(parseListId(" 42 "), "42");
    assert.equal(parseListId("https://www.themoviedb.org/u/someone/lists"), null);
    assert.equal(parseListId(""), null);
});

const entries = normalizeListPage(fixture).items;
const options = { addedAt: "2026-10-20", posterUrl };

test("syncItems adds every entry with a poster, ids carry the media type", () => {
    const { items, added, dropped, noPoster } = syncItems([], entries, options);
    assert.deepEqual(items.map((item) => item.id), ["tv-1396", "tv-1429", "movie-496243", "movie-1429"]);
    assert.equal(added.length, 4);
    assert.deepEqual(dropped, []);
    assert.equal(noPoster, 1);
    assert.deepEqual(items[1], {
        id: "tv-1429", tmdbId: 1429, mediaType: "tv", title: "Attack on Titan", subtitle: "2013", addedAt: "2026-10-20",
        fetchedAt: "2026-10-20", source: "https://image.tmdb.org/t/p/w780/hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg",
    });
});

test("syncItems keeps the order, appends new ones, drops what left the list and updates titles", () => {
    const existing = [
        { id: "movie-496243", title: "Old title", subtitle: "2019", addedAt: "2026-01-01" },
        { id: "tv-gone", title: "Gone", subtitle: "1999", addedAt: "2026-01-01" },
    ];
    const { items, dropped } = syncItems(existing, entries, options);
    assert.deepEqual(items.map((item) => item.id), ["movie-496243", "tv-1396", "tv-1429", "movie-1429"]);
    assert.equal(items[0].title, "Parasite");
    assert.equal(items[0].addedAt, "2026-01-01");
    assert.equal(items[0].fetchedAt, "2026-10-20", "confirmed by this fetch");
    assert.deepEqual(dropped.map((item) => item.id), ["tv-gone"]);
});

test("syncItems takes the first maxItems of the list and at most limit new ones", () => {
    assert.deepEqual(syncItems([], entries, { ...options, maxItems: 2 }).items.map((item) => item.id), ["tv-1396", "tv-1429"]);
    const limited = syncItems([{ id: "tv-1396" }], entries, { ...options, limit: 1 });
    assert.deepEqual(limited.items.map((item) => item.id), ["tv-1396", "tv-1429"]);
    // an item that falls outside maxItems is dropped
    const shrunk = syncItems([{ id: "movie-1429" }], entries, { ...options, maxItems: 2 });
    assert.deepEqual(shrunk.dropped.map((item) => item.id), ["movie-1429"]);
});

test("fetchTmdb writes items.json and removes the images of dropped items", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    const log = console.log;
    console.log = () => {};
    try {
        const project = { source: "tmdb", name: "series", id: "tmdb/series", listId: "8512345", maxItems: 200, dir: path.join(root, "projects", "tmdb", "series") };
        writeData(project, { items: [{ id: "tv-gone", title: "Gone" }] });
        fs.mkdirSync(path.join(project.dir, "images"));
        fs.writeFileSync(path.join(project.dir, "images", "tv-gone.jpg"), "x");
        const tmdb = { getList: async () => ({ name: "My series", items: entries }), posterUrl };

        await fetchTmdb(project, { tmdb, now: new Date("2026-10-20T12:00:00").getTime() });
        const data = readData(project);
        assert.equal(data.items.length, 4);
        assert.deepEqual(data.state.list, { id: "8512345", name: "My series", url: "https://www.themoviedb.org/list/8512345" });
        assert.equal(data.state.lastFetched, "2026-10-20");
        assert.equal(fs.existsSync(path.join(project.dir, "images", "tv-gone.jpg")), false);

        await assert.rejects(fetchTmdb({ ...project, listId: null }, { tmdb }), /isn't a TMDb list link or id/);
    } finally {
        console.log = log;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("fetchTmdb renews posters downloaded over maxCacheDays - 30 days ago", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    const log = console.log;
    const lines = [];
    console.log = (line) => lines.push(line);
    try {
        const project = { source: "tmdb", name: "s", id: "tmdb/s", listId: "1", maxCacheDays: 180, dir: path.join(root, "p") };
        const now = Date.now();
        const day = 86400000;
        writeData(project, { items: [{ id: "tv-1396" }, { id: "tv-1429" }] });
        fs.mkdirSync(path.join(project.dir, "images"));
        const poster = (id, daysAgo) => {
            const file = path.join(project.dir, "images", `${id}.jpg`);
            fs.writeFileSync(file, "x");
            fs.utimesSync(file, new Date(now - daysAgo * day), new Date(now - daysAgo * day));
            return file;
        };
        const fresh = poster("tv-1396", 149);
        const old = poster("tv-1429", 151);
        const tmdb = { getList: async () => ({ name: "L", items: entries.slice(0, 2) }), posterUrl };

        await fetchTmdb(project, { tmdb, now });
        assert.equal(fs.existsSync(fresh), true);
        assert.equal(fs.existsSync(old), false, "renewed: cache.py downloads it again");
        assert.ok(lines.some((line) => /Renewing 1 poster/.test(line)));

        // a source without a limit keeps everything
        poster("tv-1429", 400);
        await fetchTmdb({ ...project, maxCacheDays: undefined }, { tmdb, now });
        assert.equal(fs.existsSync(path.join(project.dir, "images", "tv-1429.jpg")), true);
    } finally {
        console.log = log;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
