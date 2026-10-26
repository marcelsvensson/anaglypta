// npm run setup for steam: STEAM_API_KEY (once), a profile per project
const { ok, warn, readEnv, writeEnvValue, askUntil, askProjectName } = require("../../../scripts/setup/ui");
const { toKebab } = require("../../../scripts/project");
const { parseSteamProfile } = require(".");

// a Steam Web API key: 32 hex characters
const isSteamKey = (input) => /^[0-9a-f]{32}$/i.test(String(input ?? "").trim());

// a Steam profile's name and game count for the project name, when STEAM_API_KEY is set (setup doesn't load .env by itself).
// games = null when the library can't be read (Game details not public)
const lookupSteam = async (profile) => {
    const key = readEnv().STEAM_API_KEY;
    if (!key || !profile) {
        return null;
    }
    process.env.STEAM_API_KEY ||= key;
    const steam = require("./api");
    try {
        const steamId = profile.steamId ?? await steam.resolveVanity(profile.vanity);
        if (!steamId) {
            warn(`No Steam profile called "${profile.vanity}"`);
            return null;
        }
        const name = await steam.getPlayerName(steamId);
        const games = await steam.getOwnedGames(steamId).then((list) => list.length, () => null);
        return { name, games };
    } catch (error) {
        warn(`Couldn't look up the profile (${error.message})`);
        return null;
    }
};

const addProject = async (input, projects) => {
    console.log("\n  The profile: on steamcommunity.com, open the profile and copy its link (…/id/<name> or …/profiles/<number>).");
    console.log("  Its Game details have to be Public (Edit Profile -> Privacy Settings) - a friend's public profile works too.\n");
    const profile = await askUntil(input, "  Profile link (empty to skip): ", (answer) => parseSteamProfile(answer) && answer.trim(),
        "That doesn't look like a profile link (https://steamcommunity.com/id/... or /profiles/...)");
    if (!profile) {
        return null;
    }
    const found = await lookupSteam(parseSteamProfile(profile));
    if (found?.games === null) {
        warn("Couldn't read the library - set the profile's Game details to Public before `npm run full`");
    } else if (found) {
        ok(`Profile: ${found.name} (${found.games} games)`);
    }
    const name = await askProjectName(input, "steam", projects, toKebab(found?.name));
    return name && { name, entry: { profile } };
};

const printSteamGuide = () => {
    console.log(`
  Get a Steam Web API key (once, free):
    1. Log in at https://steamcommunity.com/dev/apikey - the account needs to be non-limited (spent $5 on Steam)
    2. Domain name: anything, http://127.0.0.1 is fine. Agree to the terms and register
    3. Copy the key (32 characters) and keep it to yourself. It reads any profile whose Game details are public
`);
};

// STEAM_API_KEY, only asked when there's a steam project
const credentials = async (input, todo) => {
    if (readEnv().STEAM_API_KEY) {
        ok("STEAM_API_KEY is set");
        return;
    }
    printSteamGuide();
    const key = await askUntil(input, "  Steam Web API key (empty to skip): ", (answer) => isSteamKey(answer) && answer.trim(),
        "That doesn't look like a Steam Web API key (32 letters and digits)");
    if (key) {
        writeEnvValue("STEAM_API_KEY", key);
        ok("STEAM_API_KEY saved to .env");
    } else {
        todo.push("Add STEAM_API_KEY to .env (a Steam Web API key from https://steamcommunity.com/dev/apikey)");
    }
};

const title = async (project) => (await lookupSteam(project.steam))?.name;

module.exports = { isSteamKey, credentials, addProject, title };
