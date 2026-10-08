module.exports = function(eleventyConfig) {
    eleventyConfig.addCollection("genresOnly", function (collectionApi) {
        const genresList = new Set();
        collectionApi.getAll().map( item => {
            if (item.data.tags) { // handle pages that don't have tags
                item.data.tags.map( tag => {  if (tag && tag !== "album" && tag !== "null") { genresList.add(tag) } });
            }
        });
        return genresList;
    });

    eleventyConfig.addShortcode("genreItem", function(genre) {
        return `<label class="filter-label"><input type="checkbox" class="filter-checkbox" id="genre-${genre.toLowerCase().replace(/\s+/g, "_")}-filter" />${genre}</label>`
    });

    eleventyConfig.addShortcode("joinTags", function(genre) {
        return genre.replace(/,/g, "");
    });

    eleventyConfig.addShortcode("genreFilter", function(genre) {
        const filter = `genre-${genre.toLowerCase().replace(/\s+/g, "_")}`;
        return `body:has(#show-filter:checked):has(#${filter}-filter:checked) .album--list a.${filter} { display: block; }
        body:has(#hide-filter:checked):has(#${filter}-filter:checked) .album--list a.${filter} { display: none; }`;
    });

    eleventyConfig.addShortcode("noalbum", function(genre) {
        if (genre !== "album") {
            return `<span class="genre">${genre}</span>`;
        }
    });

    eleventyConfig.addPassthroughCopy({ "favicon.ico": "favicon.ico", "album/bitmap.jpg": "bitmap.jpg" });

    // the generated album/*.md files are gitignored, so don't let 11ty skip .gitignore'd files
    eleventyConfig.setUseGitIgnore(false);
    ["README.md", "CLAUDE.md", "test/**", "tmp/**", ".venv/**"].forEach((pattern) => eleventyConfig.ignores.add(pattern));

    
}