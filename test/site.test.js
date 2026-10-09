const { test } = require("node:test");
const assert = require("node:assert/strict");

const eleventyConfig = require("../eleventy.config");

// runs eleventy.config.js against a fake config object to get at the filters and shortcodes
const registered = {};
const fakeConfig = new Proxy({}, {
    get: (target, name) => {
        if (name === "ignores") {
            return { add: () => {} };
        }
        return (key, fn) => {
            registered[key] = fn;
        };
    },
});
eleventyConfig(fakeConfig);

test("genreSlug makes genres safe for ids, classes and css selectors", () => {
    const { genreSlug } = eleventyConfig;
    assert.equal(genreSlug("r&b"), "r_b");
    assert.equal(genreSlug("Death Metal"), "death_metal");
    assert.equal(genreSlug("Música Mexicana"), "musica_mexicana");
    assert.equal(genreSlug("  -post-rock!  "), "post_rock");
    assert.match(genreSlug("k-pop / j-pop"), /^[a-z0-9_]+$/);
});

test("genreClasses turns an album's tags into css classes, without the album tag", () => {
    assert.equal(registered.genreClasses(["album", "r&b", "Death Metal"]), "genre-r_b genre-death_metal");
    assert.equal(registered.genreClasses(["album"]), "");
    assert.equal(registered.genreClasses(undefined), "");
});

test("genreNames keeps the real genre names for the page", () => {
    assert.equal(registered.genreNames(["album", "r&b", "Música Mexicana"]), "r&b|Música Mexicana");
});

// a fake collection api over album files: [file name, albumId, track id]
const collectionApi = (files) => ({
    getFilteredByTag: () => files.map(([name, albumId, id]) => ({ inputPath: `./album/${name}`, data: { albumId, id } })),
});
const fileNames = (items) => items.map(({ inputPath }) => inputPath.split("/").pop());

test("albums are ordered like the python scripts, newest first", () => {
    const albums = registered.albums(collectionApi([
        ["2025-08-11-10.md", "a10"], ["2025-08-11-2.md", "a2"], ["2025-08-12.md", "b"],
        ["2025-08-11.md", "a"], ["2025-08-11-0.md", "a0"],
    ]));
    assert.deepEqual(fileNames(albums), ["2025-08-12.md", "2025-08-11-10.md", "2025-08-11-2.md", "2025-08-11-0.md", "2025-08-11.md"]);
});

test("albums has one entry per album, the first song added wins", () => {
    const albums = registered.albums(collectionApi([
        ["2025-08-11.md", "same"], ["2025-08-11-0.md", "same"], ["2025-08-12.md", "other"], ["2025-08-13.md", "same"],
    ]));
    assert.deepEqual(fileNames(albums), ["2025-08-12.md", "2025-08-11.md"]);
});

test("genreItem escapes the genre name", () => {
    assert.match(registered.genreItem("<b>&"), /id="genre-b-filter" \/>&#60;b&#62;&#38;<\/label>/);
});
