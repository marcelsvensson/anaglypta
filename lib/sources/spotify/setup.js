// npm run setup for spotify: CLIENT_ID and the login (once), a playlist per project
const fs = require("node:fs");
const path = require("node:path");

const { ROOT, ok, warn, run, readEnv, writeEnvValue, askUntil, askProjectName } = require("../../../scripts/setup/ui");
const { toKebab } = require("../../../scripts/project");
const { parsePlaylistId } = require(".");

const TOKEN_PATH = path.join(ROOT, ".spotify-token.json");
const REDIRECT_URI = `http://127.0.0.1:${process.env.SPOTIFY_AUTH_PORT || 8888}/callback`;

const isClientId = (input) => /^[0-9a-f]{32}$/i.test(String(input ?? "").trim());

const printSpotifyGuide = () => {
    console.log(`
  Create a Spotify app (once):
    1. Open https://developer.spotify.com/dashboard and log in (the app owner needs Spotify Premium)
    2. Click "Create app", give it a name and description
    3. Add this Redirect URI: ${REDIRECT_URI}
    4. Accept the terms and save
    5. Open the app -> Settings and copy the Client ID
`);
};

// the playlist's name for the project name, when logged in (setup doesn't load .env into process.env by itself)
const lookupPlaylistName = async (playlistId) => {
    const env = readEnv();
    if (!fs.existsSync(TOKEN_PATH) && !env.CLIENT_SECRET) {
        return null;
    }
    for (const key of ["CLIENT_ID", "CLIENT_SECRET", "SPOTIFY_MARKET"]) {
        if (env[key] && !process.env[key]) {
            process.env[key] = env[key];
        }
    }
    try {
        return (await require("./api").getPlaylistMeta(playlistId)).name;
    } catch (error) {
        warn(`Couldn't look up the playlist (${error.message})`);
        return null;
    }
};

const addProject = async (input, projects) => {
    console.log("\n  Your playlist: in Spotify, open the playlist -> ... -> Share -> Copy link to playlist.");
    console.log("  It has to be a playlist you own or collaborate on.\n");
    const playlistId = await askUntil(input, "  Playlist link (empty to skip): ", parsePlaylistId,
        "That doesn't look like a playlist link (https://open.spotify.com/playlist/...)");
    if (!playlistId) {
        return null;
    }
    const title = await lookupPlaylistName(playlistId);
    if (title) {
        ok(`Playlist: ${title}`);
    }
    const name = await askProjectName(input, "spotify", projects, toKebab(title));
    return name && { name, entry: { playlist: `https://open.spotify.com/playlist/${playlistId}` } };
};

// CLIENT_ID and the login, only asked when there's a spotify project
const credentials = async (input, todo) => {
    if (readEnv().CLIENT_ID) {
        ok("CLIENT_ID is set");
    } else {
        printSpotifyGuide();
        const clientId = await askUntil(input, "  Client ID (empty to skip): ", (answer) => isClientId(answer) && answer.trim(),
            "That doesn't look like a Client ID (32 letters and digits from the app's Settings page)");
        if (clientId) {
            writeEnvValue("CLIENT_ID", clientId);
            ok("CLIENT_ID saved to .env");
        } else {
            todo.push("Add CLIENT_ID to .env");
        }
    }

    const env = readEnv();
    if (fs.existsSync(TOKEN_PATH)) {
        ok("Logged in to Spotify");
    } else if (env.CLIENT_SECRET) {
        ok("CLIENT_SECRET is set (app mode, only works for apps created before 2026)");
    } else if (!env.CLIENT_ID) {
        todo.push("Log in to Spotify: `npm run auth` (after adding CLIENT_ID)");
    } else if (!process.stdin.isTTY) {
        // the login opens a browser and waits for it, only when someone is at the terminal
        todo.push("Log in to Spotify: `npm run auth`");
    } else {
        const answer = await input.ask("\n  Log in to Spotify now? [Y/n] ");
        if (answer !== null && !/^n/i.test(answer.trim()) && run(process.execPath, [path.join(__dirname, "auth.js")]).status === 0) {
            ok("Logged in to Spotify");
        } else {
            todo.push("Log in to Spotify: `npm run auth`");
        }
    }
};

const title = async (project) => (project.playlistId ? lookupPlaylistName(project.playlistId) : null);

module.exports = { isClientId, credentials, addProject, title };
