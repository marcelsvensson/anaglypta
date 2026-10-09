const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildFrontmatter, filterNewItems, collectNewAlbums, freeSlots, parseLimit, fileNameFor, readKnownIds } = require("../scripts/generate");
const { normalizePage } = require("../api/spotify");
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

// reads the frontmatter the way parse_frontmatter in scripts/common.py does:
// quoted values are JSON strings, unquoted ones are taken as-is, "- item" lines form the tags list
const matter = (text) => {
    const data = {};
    let list = null;
    for (const line of text.split("\n").slice(1, -1)) {
        const item = line.match(/^\s*- (.*)$/);
        if (item) {
            list.push(JSON.parse(item[1]));
            continue;
        }
        const [, key, value] = line.match(/^\s*(\w+):\s?(.*)$/);
        data[key] = value === "" ? (list = []) : value === "[]" ? [] : value.startsWith("\"") ? JSON.parse(value) : value;
    }
    return { data };
};

test("buildFrontmatter round-trips every fixture album", () => {
    for (const item of normalizePage(fixture).items) {
        const data = matter(buildFrontmatter(item, ["metal", "r&b"])).data;
        assert.equal(data.album, item.track.album.name);
        assert.equal(data.artist, item.track.album.artists[0].name);
        assert.equal(data.song, item.track.name);
        assert.equal(data.id, item.track.id);
        assert.deepEqual(data.tags, ["metal", "r&b"]);
    }
});

test("buildFrontmatter keeps quotes, colons, html and unicode intact", () => {
    const tricky = entry({
        name: "Song: \"Live\" — part 2",
        album: { ...entry().track.album, name: "\"Heroes\": <Live> Ö", artists: [{ name: "Guns N' Roses: Live", id: "x" }] },
    });
    const data = matter(buildFrontmatter(tricky, [])).data;
    assert.equal(data.song, "Song: \"Live\" — part 2");
    assert.equal(data.album, "\"Heroes\": <Live> Ö");
    assert.equal(data.artist, "Guns N' Roses: Live");
    assert.equal(data.release, "1999-12-31");
});

test("buildFrontmatter writes empty genres as an empty list", () => {
    const data = matter(buildFrontmatter(entry(), [])).data;
    assert.deepEqual(data.tags, []);
});

test("buildFrontmatter leaves the images line unquoted for the python scripts", () => {
    const line = buildFrontmatter(entry(), []).split("\n").find((l) => l.startsWith("    images: "));
    assert.equal(line, "    images: https://i.scdn.co/image/abc");
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

test("fileNameFor numbers albums added on the same day", () => {
    const existing = new Set(["2026-01-01.md", "2026-01-01-0.md"]);
    const exists = (name) => existing.has(name);
    assert.equal(fileNameFor("2026-01-02", exists), "2026-01-02.md");
    assert.equal(fileNameFor("2026-01-01", exists), "2026-01-01-1.md");
});

test("readKnownIds reads track and album ids from old and new album files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    try {
        fs.writeFileSync(path.join(dir, "old.md"), "---\n    artistId: x\n    albumId: oldAlbum\n    id: oldId123\n---");
        fs.writeFileSync(path.join(dir, "new.md"), buildFrontmatter(entry({ id: "newId456" }), []));
        fs.writeFileSync(path.join(dir, "notes.txt"), "id: ignored");
        const known = readKnownIds(dir);
        assert.deepEqual([...known.trackIds].sort(), ["newId456", "oldId123"]);
        assert.deepEqual([...known.albumIds].sort(), ["album1", "oldAlbum"]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
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

test("freeSlots counts the room left under maxAlbums", () => {
    const withAlbums = (n) => known(Array.from({ length: n }, (_, i) => `a${i}`));
    assert.equal(freeSlots(200, withAlbums(0)), 200);
    assert.equal(freeSlots(200, withAlbums(199)), 1);
    assert.equal(freeSlots(200, withAlbums(200)), 0);
    assert.equal(freeSlots(200, withAlbums(250)), 0);
});

test("parseLimit reads --limit", () => {
    assert.equal(parseLimit(["node", "generate.js"]), Infinity);
    assert.equal(parseLimit(["node", "generate.js", "--limit", "1"]), 1);
    for (const bad of [["--limit"], ["--limit", "0"], ["--limit", "one"], ["--limit", "1.5"]]) {
        assert.throws(() => parseLimit(bad), /--limit needs a whole number/);
    }
});
