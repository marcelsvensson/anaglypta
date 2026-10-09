const { test } = require("node:test");
const assert = require("node:assert/strict");

const { normalizePage } = require("../api/spotify");
const itemsShape = require("./fixtures/playlist-items.json");
const tracksShape = require("./fixtures/playlist-tracks.json");

test("normalizePage reads the 2026 /items shape", () => {
    const { items, count, next } = normalizePage(itemsShape);
    assert.equal(items.length, 21);
    assert.equal(next, null);
    assert.ok(items.every(({ added_at, track }) => added_at && track.id && track.album));
    // the raw count includes the skipped entries, it's the offset for the next page
    assert.equal(count, itemsShape.items.length);
});

test("normalizePage reads the legacy /tracks shape the same way", () => {
    const legacy = normalizePage(tracksShape).items.map(({ track }) => track.id);
    const current = normalizePage(itemsShape).items.map(({ track }) => track.id);
    assert.deepEqual(legacy, current);
});

test("normalizePage skips local files, podcast episodes and removed tracks", () => {
    const ids = normalizePage(itemsShape).items.map(({ track }) => track.id);
    assert.ok(!ids.includes(null));
    assert.ok(!ids.includes("4rOoJ6Egrf8K2IrywzwOMk"));
});

test("normalizePage explains a response without items", () => {
    assert.throws(() => normalizePage({ name: "Someone else's playlist" }), /own or collaborate/);
});

test("normalizePage keeps each song's place on the page and the playlist's length", () => {
    const page = normalizePage({
        items: [
            { added_at: "x", item: { type: "track", is_local: true, id: null } },
            { added_at: "x", item: { type: "track", id: "a", album: {} } },
            { added_at: "x", item: null },
            { added_at: "x", item: { type: "track", id: "b", album: {} } },
        ],
        next: null,
        total: 42,
    });
    assert.deepEqual(page.items.map(({ track, position }) => [track.id, position]), [["a", 1], ["b", 3]]);
    assert.equal(page.count, 4);
    assert.equal(page.total, 42);
});
