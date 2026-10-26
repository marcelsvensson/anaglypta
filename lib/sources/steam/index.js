// the steam source: a Steam profile's games, one library capsule per game. projects.json: steam.<name>.profile.
// No daily-new: the api has no purchase dates, so there's no "newest game" to reveal
// "https://steamcommunity.com/profiles/<17 digits>" or "<17 digits>" -> { steamId }, "https://steamcommunity.com/id/<name>"
// or "<name>" -> { vanity } (looked up with the api key), anything else -> null
const parseSteamProfile = (input) => {
    const text = String(input ?? "").trim();
    const id = text.match(/profiles\/(\d{17})(?!\d)/) || text.match(/^(\d{17})$/);
    if (id) {
        return { steamId: id[1] };
    }
    const vanity = text.match(/steamcommunity\.com\/id\/([\w-]+)/) || text.match(/^([\w-]{2,32})$/);
    return vanity ? { vanity: vanity[1] } : null;
};

module.exports = {
    name: "steam",
    label: "Steam",
    description: "the library art of a Steam profile's games",
    dailyNew: false,
    resolve: (entry) => ({ steam: parseSteamProfile(entry.profile) }),
    fetch: (project, { limit }) => {
        require("dotenv").config({ quiet: true });
        return require("./fetch").fetchSteam(project, { limit, steam: require("./api") });
    },
    // setup: asks for what the source needs once (keys, logins), adds to todo what's still missing
    credentials: (input, todo) => require("./setup").credentials(input, todo),
    // setup: asks for a new project -> { name, entry } (its projects.json entry), null = skipped
    addProject: (input, projects) => require("./setup").addProject(input, projects),
    // setup: the name a rename suggests (looked up at the source), null = none
    title: (project) => require("./setup").title(project),
    parseSteamProfile,
};
