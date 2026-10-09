const { project } = require("./settings.json").spotify;

// "R&B" -> "r_b", "Música Mexicana" -> "musica_mexicana" - safe in ids, classes and css selectors
const genreSlug = (genre) => String(genre)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const genresOf = (tags) => [].concat(tags || []).filter((tag) => tag && tag !== "album" && tag !== "null");

// same order as album_sort_key in scripts/common.py: <date>.md, <date>-0.md, <date>-1.md ... <date>-10.md
const albumSortKey = (inputPath) => {
    const name = inputPath.split("/").pop();
    const match = name.match(/^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.md$/);
    return match ? [match[1], match[2] === undefined ? -1 : Number(match[2])] : [name, -1];
};

const compareAlbums = (a, b) => {
    const [dateA, suffixA] = albumSortKey(a.inputPath);
    const [dateB, suffixB] = albumSortKey(b.inputPath);
    return dateA === dateB ? suffixA - suffixB : (dateA < dateB ? -1 : 1);
};

// oldest first, one per album (the first song added wins) - same as read_albums in scripts/common.py,
// the favicon in day.html relies on the site and the bitmap using the exact same albums in the same order
const uniqueAlbums = (items) => {
    const seen = new Set();
    return [...items].sort(compareAlbums).filter(({ data, inputPath }) => {
        const key = data.albumId || data.id || inputPath;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
};

module.exports = function(eleventyConfig) {
    // newest first, the order the page shows them in
    eleventyConfig.addCollection("albums", (collectionApi) => uniqueAlbums(collectionApi.getFilteredByTag("album")).reverse());

    eleventyConfig.addCollection("genresOnly", function (collectionApi) {
        const genresList = new Set();
        uniqueAlbums(collectionApi.getFilteredByTag("album")).map( item => {
            genresOf(item.data.tags).map( tag => genresList.add(tag) );
        });
        return genresList;
    });

    eleventyConfig.addShortcode("genreItem", function(genre) {
        return `<label class="filter-label"><input type="checkbox" class="filter-checkbox" id="genre-${genreSlug(genre)}-filter" />${escapeHtml(genre)}</label>`
    });

    eleventyConfig.addShortcode("genreFilter", function(genre) {
        const filter = `genre-${genreSlug(genre)}`;
        return `body:has(#show-filter:checked):has(#${filter}-filter:checked) .album--list a.${filter} { display: block; }
        body:has(#hide-filter:checked):has(#${filter}-filter:checked) .album--list a.${filter} { display: none; }`;
    });

    // css classes for an album's genres, e.g. "genre-death_metal genre-r_b"
    eleventyConfig.addFilter("genreClasses", (tags) => genresOf(tags).map((genre) => `genre-${genreSlug(genre)}`).join(" "));

    // genre names for the data-genres attribute, split on "|" in day.html
    eleventyConfig.addFilter("genreNames", (tags) => genresOf(tags).join("|"));

    eleventyConfig.addShortcode("noalbum", function(genre) {
        if (genre !== "album") {
            return `<span class="genre">${genre}</span>`;
        }
    });

    eleventyConfig.addPassthroughCopy({ "favicon.ico": "favicon.ico", [`${project}/bitmap.jpg`]: "bitmap.jpg" });

    // the generated album/*.md files are gitignored, so don't let 11ty skip .gitignore'd files
    eleventyConfig.setUseGitIgnore(false);
    ["README.md", "CLAUDE.md", "test/**", "tmp/**", ".venv/**"].forEach((pattern) => eleventyConfig.ignores.add(pattern));
}

module.exports.genreSlug = genreSlug;
