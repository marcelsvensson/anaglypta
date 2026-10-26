// the spotify source: a playlist, one item per album cover. projects.json: spotify.<name>.playlist
// "https://open.spotify.com/playlist/<id>?si=..", "spotify:playlist:<id>" or "<id>" -> "<id>", anything else -> null
const parsePlaylistId = (input) => {
    const text = String(input ?? "").trim();
    const match = text.match(/playlist[/:]([A-Za-z0-9]{22})(?![A-Za-z0-9])/) || text.match(/^([A-Za-z0-9]{22})$/);
    return match ? match[1] : null;
};

module.exports = {
    name: "spotify",
    label: "Spotify",
    description: "the album covers of a Spotify playlist",
    resolve: (entry) => ({ playlistId: parsePlaylistId(entry.playlist) }),
    fetch: (project, { limit }) => {
        require("dotenv").config({ quiet: true });
        return require("./fetch").fetchSpotify(project, { limit, spotify: require("./api") });
    },
    // setup: asks for what the source needs once (keys, logins), adds to todo what's still missing
    credentials: (input, todo) => require("./setup").credentials(input, todo),
    // setup: asks for a new project -> { name, entry } (its projects.json entry), null = skipped
    addProject: (input, projects) => require("./setup").addProject(input, projects),
    // setup: the name a rename suggests (looked up at the source), null = none
    title: (project) => require("./setup").title(project),
    parsePlaylistId,
};
