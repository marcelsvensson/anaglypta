const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// the frontmatter parser eleventy uses
const matter = require("gray-matter");

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

test("buildFrontmatter round-trips every fixture album through eleventy's parser", () => {
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
        album: { ...entry().track.album, name: "Say \"Hi\": <Live> Ö", artists: [{ name: "Guns N' Roses: Live", id: "x" }] },
    });
    const data = matter(buildFrontmatter(tricky, [])).data;
    assert.equal(data.song, "Song: \"Live\" — part 2");
    assert.equal(data.album, "Say \"Hi\": <Live> Ö");
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

test("filterNewItems skips known tracks and duplicates within a page", () => {
    const known = new Set(["a"]);
    const items = ["a", "b", "b", "c"].map((id) => ({ track: { id } }));
    assert.deepEqual(filterNewItems(items, known).map(({ track }) => track.id), ["b", "c"]);
    assert.deepEqual([...known].sort(), ["a", "b", "c"]);
});

test("fileNameFor numbers albums added on the same day", () => {
    const existing = new Set(["2026-01-01.md", "2026-01-01-0.md"]);
    const exists = (name) => existing.has(name);
    assert.equal(fileNameFor("2026-01-02", exists), "2026-01-02.md");
    assert.equal(fileNameFor("2026-01-01", exists), "2026-01-01-1.md");
});

test("readKnownIds reads track ids from old and new album files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    try {
        fs.writeFileSync(path.join(dir, "old.md"), "---\n    artistId: x\n    albumId: y\n    id: oldId123\n---");
        fs.writeFileSync(path.join(dir, "new.md"), buildFrontmatter(entry({ id: "newId456" }), []));
        fs.writeFileSync(path.join(dir, "notes.txt"), "id: ignored");
        assert.deepEqual([...readKnownIds(dir)].sort(), ["newId456", "oldId123"]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
