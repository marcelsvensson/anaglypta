// the tmdb source: a public TMDb list, one poster per movie or series. projects.json: tmdb.<name>.list
// "https://www.themoviedb.org/list/8512345-my-series?..." or "8512345" -> "8512345", anything else -> null
const parseListId = (input) => {
    const text = String(input ?? "").trim();
    const match = text.match(/list\/(\d+)/) || text.match(/^(\d+)$/);
    return match ? match[1] : null;
};

module.exports = {
    name: "tmdb",
    label: "TMDb",
    description: "the posters of a TMDb list (movies and series)",
    resolve: (entry) => ({ listId: parseListId(entry.list) }),
    fetch: (project, { limit }) => {
        require("dotenv").config({ quiet: true });
        return require("./fetch").fetchTmdb(project, { limit, tmdb: require("./api") });
    },
    // setup: asks for what the source needs once (keys, logins), adds to todo what's still missing
    credentials: (input, todo) => require("./setup").credentials(input, todo),
    // setup: asks for a new project -> { name, entry } (its projects.json entry), null = skipped
    addProject: (input, projects) => require("./setup").addProject(input, projects),
    // setup: the name a rename suggests (looked up at the source), null = none
    title: (project) => require("./setup").title(project),
    parseListId,
};
