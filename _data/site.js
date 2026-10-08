// global site data for the templates (site.title, site.playlist, site.cover)
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ quiet: true });

const settings = require("../settings.json");

const readState = () => {
    const statePath = path.join(__dirname, "..", "state.json");
    return fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
};

module.exports = () => {
    const playlist = readState().spotify?.playlist ?? {};
    const playlistId = process.env.PLAYLIST_ID;
    const { col, row, gap, width, scale } = settings.spotify.cover;

    return {
        // empty title in settings.json = use the playlist name
        title: settings.site?.title || playlist.name || "Anaglypta",
        playlist: {
            name: playlist.name || "Spotify playlist",
            url: playlist.url || (playlistId ? `https://open.spotify.com/playlist/${playlistId}` : ""),
        },
        // same grid as scripts/bitmapper.py, used to cut the favicon out of bitmap.jpg
        cover: { col, row, gap, cell: width * scale },
    };
};
