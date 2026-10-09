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

test("genreItem escapes the genre name", () => {
    assert.match(registered.genreItem("<b>&"), /id="genre-b-filter" \/>&#60;b&#62;&#38;<\/label>/);
});
