const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ quiet: true });

const API_URL = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const TOKEN_PATH = path.join(__dirname, "..", ".spotify-token.json");

const env = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} in .env (see .example.env)`);
  }
  return value;
};

const market = () => (process.env.SPOTIFY_MARKET ? { market: process.env.SPOTIFY_MARKET } : {});

const readTokenFile = () => JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));

const saveTokenFile = (data) =>
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });

const postToken = async (params, headers = {}) => {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(params),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      `Spotify login failed (${response.status}): ${json.error_description || json.error || response.statusText}`
    );
    error.code = json.error;
    throw error;
  }
  return json;
};

// user = PKCE login via `npm run auth` (required for apps created after the 2026 API changes)
// app  = client credentials, only works for older (grandfathered) apps
const getAuthMode = () => {
  if (fs.existsSync(TOKEN_PATH)) {
    return "user";
  }
  if (process.env.CLIENT_SECRET) {
    return "app";
  }
  throw new Error("Not logged in to Spotify - run `npm run auth` first (or set CLIENT_SECRET for an older app)");
};

let cached;

const getAccessToken = async () => {
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const mode = getAuthMode();
  const client_id = env("CLIENT_ID");
  let json;

  if (mode === "user") {
    const stored = readTokenFile();
    try {
      json = await postToken({ grant_type: "refresh_token", refresh_token: stored.refresh_token, client_id });
    } catch (error) {
      if (error.code === "invalid_grant") {
        error.message += " - run `npm run auth` again";
      }
      throw error;
    }
    // spotify may rotate the refresh token, keep the newest one
    if (json.refresh_token && json.refresh_token !== stored.refresh_token) {
      saveTokenFile({ ...stored, refresh_token: json.refresh_token });
    }
  } else {
    const basic = Buffer.from(`${client_id}:${process.env.CLIENT_SECRET}`).toString("base64");
    json = await postToken({ grant_type: "client_credentials" }, { Authorization: `Basic ${basic}` });
  }

  if (!cached) {
    console.log(`Spotify: ${mode} mode`);
  }
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return cached.token;
};

const request = async (url, attempt = 1) => {
  const token = await getAccessToken();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (response.status === 429 && attempt <= 3) {
    const wait = Number(response.headers.get("retry-after")) || 1;
    if (wait <= 60) {
      console.warn(`Rate limited by Spotify, retrying in ${wait}s...`);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      return request(url, attempt + 1);
    }
  }

  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    const error = new Error(
      `Spotify API ${response.status} on ${new URL(url).pathname}: ${json.error?.message || response.statusText}`
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
};

const getArtist = (id) => request(`${API_URL}/artists/${id}`);

const getPlaylistMeta = async () => {
  const query = new URLSearchParams({ fields: "name,external_urls,owner(display_name)", ...market() });
  const { name, external_urls, owner } = await request(`${API_URL}/playlists/${env("PLAYLIST_ID")}?${query}`);
  return { name, url: external_urls?.spotify, owner: owner?.display_name };
};

// returns { items: [{ added_at, track }], count, next } - count is the raw number of entries on the page
const getPlaylistItems = async (offset = 0) => {
  const query = new URLSearchParams({ offset, limit: 100, ...market() });
  const playlistUrl = `${API_URL}/playlists/${env("PLAYLIST_ID")}`;

  let page;
  try {
    page = await request(`${playlistUrl}/items?${query}`);
  } catch (error) {
    if (![403, 404].includes(error.status)) {
      throw error;
    }
    try {
      // older apps still use the pre-2026 endpoint
      page = await request(`${playlistUrl}/tracks?${query}`);
    } catch {
      error.message += " - you must own or collaborate on the playlist and be logged in with `npm run auth`";
      throw error;
    }
  }

  if (!Array.isArray(page.items)) {
    throw new Error(
      "Spotify returned no tracks - you must own or collaborate on the playlist and be logged in with `npm run auth`"
    );
  }

  const items = page.items
    .map((entry) => ({ added_at: entry.added_at, track: entry.item ?? entry.track }))
    .filter(({ track }) => track?.id && track.type !== "episode" && !track.is_local);

  return { items, count: page.items.length, next: page.next };
};

module.exports = {
  TOKEN_PATH,
  env,
  postToken,
  saveTokenFile,
  getArtist,
  getPlaylistMeta,
  getPlaylistItems,
};
