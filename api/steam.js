// Steam Web API client - reads STEAM_API_KEY from process.env, fetch.js loads .env. The key goes in the query string,
// so errors only ever show the path, never the url
const API_URL = "https://api.steampowered.com";
// the store's asset CDN, assets.asset_url_format of GetItems is relative to it
const ASSET_URL = "https://shared.akamai.steamstatic.com/store_item_assets/";
// apps per GetItems call (200 verified)
const BATCH = 200;
// the library capsule: 600x900 (2:3, with the title), the 1x is 300x450
const CAPSULES = ["library_capsule_2x", "library_capsule"];

const key = () => {
  const value = process.env.STEAM_API_KEY;
  if (!value) {
    throw new Error("Missing STEAM_API_KEY in .env - get one at https://steamcommunity.com/dev/apikey");
  }
  return value;
};

const request = async (url, attempt = 1) => {
  const { pathname } = new URL(url);
  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw new Error(`Steam ${pathname}: ${error.message}`);
  }

  if (response.status === 429 && attempt <= 3) {
    const wait = Number(response.headers.get("retry-after")) || attempt;
    console.warn(`Rate limited by Steam, retrying in ${wait}s...`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return request(url, attempt + 1);
  }

  if (!response.ok) {
    const hint = { 401: " - check STEAM_API_KEY in .env", 403: " - check STEAM_API_KEY in .env" }[response.status] ?? "";
    const error = new Error(`Steam ${response.status} on ${pathname}${hint}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

const withKey = (endpoint, params) => `${API_URL}${endpoint}?${new URLSearchParams({ key: key(), ...params })}`;

// /id/<name> -> the 64-bit steam id, null when there's no such profile
const resolveVanity = async (name) => {
  const json = await request(withKey("/ISteamUser/ResolveVanityURL/v1/", { vanityurl: name }));
  return json?.response?.success === 1 ? json.response.steamid : null;
};

// the profile's display name, null when there's no such profile
const getPlayerName = async (steamId) => {
  const json = await request(withKey("/ISteamUser/GetPlayerSummaries/v2/", { steamids: steamId }));
  return json?.response?.players?.[0]?.personaname ?? null;
};

// GetOwnedGames -> [{ appid, name }]. A private library answers {} (not an error), so a missing games list is the hint
const normalizeOwnedGames = (json) => {
  const games = json?.response?.games;
  if (!Array.isArray(games)) {
    throw new Error("Steam returned no games - the profile's Game details have to be Public (Steam: Edit Profile -> Privacy Settings)");
  }
  return games.map((game) => ({ appid: game.appid, name: game.name ?? "" }));
};

const getOwnedGames = async (steamId) => normalizeOwnedGames(await request(withKey("/IPlayerService/GetOwnedGames/v1/", {
  steamid: steamId,
  include_appinfo: "1",
  include_played_free_games: "1",
})));

// GetItems -> Map(appid -> library capsule url). Apps without a capsule (or unknown to the store) aren't in it
const normalizeStoreItems = (json) => {
  const capsules = new Map();
  for (const item of json?.response?.store_items ?? []) {
    const assets = item.assets ?? {};
    const file = CAPSULES.map((name) => assets[name]).find(Boolean);
    if (item.success === 1 && assets.asset_url_format && file) {
      capsules.set(item.appid ?? item.id, ASSET_URL + assets.asset_url_format.replace("${FILENAME}", file));
    }
  }
  return capsules;
};

// the store's asset paths (newer games have hashed ones, so they can't be guessed). Needs no key
const getCapsules = async (appids) => {
  const capsules = new Map();
  for (let i = 0; i < appids.length; i += BATCH) {
    const input = {
      ids: appids.slice(i, i + BATCH).map((appid) => ({ appid })),
      context: { language: "english", country_code: "US" },
      data_request: { include_assets: true },
    };
    const json = await request(`${API_URL}/IStoreBrowseService/GetItems/v1/?${new URLSearchParams({ input_json: JSON.stringify(input) })}`);
    for (const [appid, url] of normalizeStoreItems(json)) {
      capsules.set(appid, url);
    }
  }
  return capsules;
};

module.exports = { request, resolveVanity, getPlayerName, normalizeOwnedGames, getOwnedGames, normalizeStoreItems, getCapsules };
