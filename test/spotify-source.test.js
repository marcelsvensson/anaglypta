const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { toItem, knownFrom, filterNewItems, collectNewAlbums, freeSlots, fetchSpotify } = require("../lib/sources/spotify/fetch");
const { parseLimit } = require("../scripts/fetch");
const { readData, writeData } = require("../lib/utils/items");
const { normalizePage } = require("../lib/sources/spotify/api");
const fixture = require("./fixtures/playlist-items.json");

const entry = (overrides = {}) => ({
    added_at: "2026-01-01T10:00:00Z",
    track: {
        id: "track1",
        name: "Song",
        album: {
            name: "Album",
            id: "album1",
            release_date: "1999-12-31",
            images: [{ url: "https://i.scdn.co/image/abc" }],
            artists: [{ name: "Artist", id: "artist1" }],
        },
        ...overrides,
    },
});

test("toItem makes one item per album from every fixture song", () => {
    for (const entry of normalizePage(fixture).items) {
        const item = toItem(entry);
        assert.equal(item.id, entry.track.album.id);
        assert.equal(item.trackId, entry.track.id);
        assert.equal(item.title, entry.track.album.name);
        assert.equal(item.subtitle, entry.track.album.artists[0].name);
        assert.equal(item.addedAt, entry.added_at);
    }
});

test("toItem takes the largest cover and copes without one", () => {
    assert.equal(toItem(entry()).source, "https://i.scdn.co/image/abc");
    assert.equal(toItem(entry({ album: { ...entry().track.album, images: [] } })).source, "");
});

test("knownFrom reads track and album ids from items", () => {
    const known = knownFrom([{ id: "A", trackId: "t1" }, { id: "B" }]);
    assert.deepEqual([...known.trackIds], ["t1"]);
    assert.deepEqual([...known.albumIds], ["A", "B"]);
});

const song = (id, albumId) => ({ track: { id, album: { id: albumId, name: `Album ${albumId}` } } });

test("filterNewItems skips known tracks and duplicates within a page", () => {
    const known = { trackIds: new Set(["a"]), albumIds: new Set() };
    const items = [song("a", "A"), song("b", "B"), song("b", "B"), song("c", "C")];
    assert.deepEqual(filterNewItems(items, known).map(({ track }) => track.id), ["b", "c"]);
    assert.deepEqual([...known.trackIds].sort(), ["a", "b", "c"]);
});

test("filterNewItems keeps one song per album, the first one wins", () => {
    const known = { trackIds: new Set(), albumIds: new Set(["OLD"]) };
    const skipped = [];
    const items = [song("s1", "OLD"), song("s2", "NEW"), song("s3", "NEW"), song("s4", "OTHER")];
    const kept = filterNewItems(items, known, ({ track }) => skipped.push(track.id));
    assert.deepEqual(kept.map(({ track }) => track.id), ["s2", "s4"]);
    assert.deepEqual(skipped, ["s1", "s3"]);
    assert.deepEqual([...known.albumIds].sort(), ["NEW", "OLD", "OTHER"]);
});

// a fake playlist in the raw 2026 /items shape, served in pages of 5 like spotify.getPlaylistItems
const rawSong = (id, albumId) => ({
    added_at: "2026-01-01T10:00:00Z",
    item: { type: "track", id, name: `Song ${id}`, album: { id: albumId, name: `Album ${albumId}`, artists: [{ id: "x", name: "X" }], images: [] } },
});
const rawLocal = { added_at: "2026-01-01T10:00:00Z", item: { type: "track", is_local: true, id: null } };
const pagesOf = (raw, size = 5) => async (position) => normalizePage({
    items: raw.slice(position, position + size),
    next: position + size < raw.length ? "next" : null,
    total: raw.length,
});
const known = (albumIds = [], trackIds = []) => ({ trackIds: new Set(trackIds), albumIds: new Set(albumIds) });
const albumIdsOf = ({ entries }) => entries.map(({ track }) => track.album.id);

test("collectNewAlbums takes one album and stops right after it", async () => {
    const raw = [rawLocal, rawSong("s1", "A"), rawSong("s2", "B"), rawSong("s3", "C")];
    const seen = known();
    const first = await collectNewAlbums({ getPage: pagesOf(raw), offset: 0, known: seen, limit: 1 });
    assert.deepEqual(albumIdsOf(first), ["A"]);
    assert.equal(first.offset, 2, "the local file before it counts too");

    const second = await collectNewAlbums({ getPage: pagesOf(raw), offset: first.offset, known: seen, limit: 1 });
    assert.deepEqual(albumIdsOf(second), ["B"], "nothing on the page is skipped");
    assert.equal(second.offset, 3);
});

test("collectNewAlbums looks past duplicates, across pages", async () => {
    const raw = ["A", "B", "A", "C", "B", "C", "A", "D"].map((album, i) => rawSong(`s${i}`, album));
    const skipped = [];
    const result = await collectNewAlbums({
        getPage: pagesOf(raw), offset: 0, known: known(["A", "B", "C"]), limit: 1, onSkip: ({ track }) => skipped.push(track.id),
    });
    assert.deepEqual(albumIdsOf(result), ["D"]);
    assert.equal(result.offset, 8);
    assert.equal(skipped.length, 7);
});

test("collectNewAlbums with nothing new ends at the end of the playlist", async () => {
    const raw = [rawSong("s1", "A"), rawSong("s2", "B")];
    const result = await collectNewAlbums({ getPage: pagesOf(raw), offset: 0, known: known(["A", "B"]), limit: 1 });
    assert.deepEqual(result.entries, []);
    assert.equal(result.offset, 2);
    assert.equal(result.total, 2);
});

test("collectNewAlbums without a limit takes every new album", async () => {
    const raw = ["A", "B", "A", "C", "D", "E", "F"].map((album, i) => rawSong(`s${i}`, album));
    const result = await collectNewAlbums({ getPage: pagesOf(raw), offset: 0, known: known() });
    assert.deepEqual(albumIdsOf(result), ["A", "B", "C", "D", "E", "F"]);
    assert.equal(result.offset, 7);
});

test("collectNewAlbums starts over when songs were removed from the playlist", async () => {
    // last time the playlist had 6 songs and we stopped at 6, now one is gone and "N" moved before the old offset
    const raw = [rawSong("s1", "A"), rawSong("s2", "B"), rawSong("n1", "N"), rawSong("s4", "C"), rawSong("s5", "D")];
    let restarts = 0;
    const seen = known(["A", "B", "C", "D"], ["s1", "s2", "s4", "s5"]);
    const result = await collectNewAlbums({
        getPage: pagesOf(raw), offset: 6, known: seen, limit: 1, previousTotal: 6, onRestart: () => restarts++,
    });
    assert.equal(restarts, 1);
    assert.deepEqual(albumIdsOf(result), ["N"]);
    assert.equal(result.offset, 3);
});

test("collectNewAlbums doesn't restart when the playlist only grew", async () => {
    const raw = [rawSong("s1", "A"), rawSong("s2", "B"), rawSong("s3", "C")];
    let restarts = 0;
    const result = await collectNewAlbums({
        getPage: pagesOf(raw), offset: 2, known: known(["A", "B"]), limit: 1, previousTotal: 2, onRestart: () => restarts++,
    });
    assert.equal(restarts, 0);
    assert.deepEqual(albumIdsOf(result), ["C"]);
});

test("freeSlots counts the room left under maxItems", () => {
    const withAlbums = (n) => known(Array.from({ length: n }, (_, i) => `a${i}`));
    assert.equal(freeSlots(200, withAlbums(0)), 200);
    assert.equal(freeSlots(200, withAlbums(199)), 1);
    assert.equal(freeSlots(200, withAlbums(200)), 0);
    assert.equal(freeSlots(200, withAlbums(250)), 0);
});

test("parseLimit reads --limit", () => {
    assert.equal(parseLimit([]), Infinity);
    assert.equal(parseLimit(["--limit", "1"]), 1);
    for (const bad of [["--limit"], ["--limit", "0"], ["--limit", "one"], ["--limit", "1.5"]]) {
        assert.throws(() => parseLimit(bad), /--limit needs a whole number/);
    }
});

// a fake api/spotify.js serving raw songs, and a project in a temp dir
const fakeSpotify = (raw) => ({
    getPlaylistMeta: async (id) => ({ name: `Playlist ${id}`, url: "https://open.spotify.com/playlist/x" }),
    getPlaylistItems: async (id, position) => pagesOf(raw)(position),
});
const withProject = async (overrides, run) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    const project = { source: "spotify", name: "album", id: "spotify/album", playlistId: "P".repeat(22), maxItems: 200,
        dir: path.join(root, "projects", "spotify", "album"), ...overrides };
    const log = console.log;
    console.log = () => {};
    try {
        await run(project);
    } finally {
        console.log = log;
        fs.rmSync(root, { recursive: true, force: true });
    }
};

test("fetchSpotify adds new albums to items.json and continues where it stopped", async () => {
    const raw = ["A", "B", "A", "C"].map((album, i) => rawSong(`s${i}`, album));
    await withProject({}, async (project) => {
        await fetchSpotify(project, { limit: 1, spotify: fakeSpotify(raw) });
        let data = readData(project);
        assert.deepEqual(data.items.map((item) => item.id), ["A"]);
        assert.equal(data.state.playlistOffset, 1);
        assert.equal(data.state.playlist.name, `Playlist ${"P".repeat(22)}`);

        await fetchSpotify(project, { spotify: fakeSpotify(raw) });
        data = readData(project);
        assert.deepEqual(data.items.map((item) => item.id), ["A", "B", "C"]);
        assert.equal(data.state.playlistOffset, 4);
        assert.equal(data.state.playlistTotal, 4);
    });
});

test("fetchSpotify stops at maxItems", async () => {
    const raw = ["A", "B", "C"].map((album, i) => rawSong(`s${i}`, album));
    await withProject({ maxItems: 2 }, async (project) => {
        writeData(project, { items: [{ id: "OLD", trackId: "old" }] });
        await fetchSpotify(project, { spotify: fakeSpotify(raw) });
        assert.deepEqual(readData(project).items.map((item) => item.id), ["OLD", "A"]);
    });
});

test("fetchSpotify needs a playlist", async () => {
    await withProject({ playlistId: null }, async (project) => {
        await assert.rejects(fetchSpotify(project, { spotify: fakeSpotify([]) }), /isn't a playlist link or id/);
    });
});
