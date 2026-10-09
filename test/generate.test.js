const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildFrontmatter, filterNewItems, fileNameFor, readKnownIds } = require("../scripts/generate");
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
