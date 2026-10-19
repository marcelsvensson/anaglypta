// TMDb (themoviedb.org) api client - reads TMDB_TOKEN (the API Read Access Token) from process.env, fetch.js loads .env
const API_URL = "https://api.themoviedb.org/3";
// stable, documented as the base of every image url (/configuration returns the same)
const IMAGE_URL = "https://image.tmdb.org/t/p/";
const MAX_PAGES = 100;

const token = () => {
  const value = process.env.TMDB_TOKEN;
  if (!value) {
    throw new Error("Missing TMDB_TOKEN in .env - the API Read Access Token from https://www.themoviedb.org/settings/api");
  }
  return value;
};

const request = async (url, attempt = 1) => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token()}`, Accept: "application/json" } });

  if (response.status === 429 && attempt <= 3) {
    const wait = Number(response.headers.get("retry-after")) || attempt;
    console.warn(`Rate limited by TMDb, retrying in ${wait}s...`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return request(url, attempt + 1);
  }

  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    const hint = {
      401: " - check TMDB_TOKEN in .env (the API Read Access Token, not the shorter API key)",
      404: " - is the list public, and is the id right?",
    }[response.status] ?? "";
    const error = new Error(`TMDb ${response.status} on ${new URL(url).pathname}: ${json.status_message || response.statusText}${hint}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

// one page of /list/{id} -> { name, itemCount, totalPages, items: [{ id, mediaType, title, year, posterPath }] }
// series have name/first_air_date, movies title/release_date - a list can mix them
const normalizeListPage = (json) => {
  if (!Array.isArray(json?.items)) {
    throw new Error("TMDb returned no list items - is the list public?");
  }
  const items = json.items.map((entry) => {
    const mediaType = entry.media_type ?? (entry.first_air_date !== undefined || (entry.name && !entry.title) ? "tv" : "movie");
    const date = entry.first_air_date ?? entry.release_date ?? "";
    return {
      id: entry.id,
      mediaType,
      title: entry.name ?? entry.title ?? "",
      year: date.slice(0, 4),
      posterPath: entry.poster_path ?? null,
    };
  });
  return { name: json.name ?? "", itemCount: json.item_count ?? null, totalPages: json.total_pages ?? null, items };
};

const getListPage = async (listId, page = 1) => {
  const query = new URLSearchParams({ page: String(page) });
  return normalizeListPage(await request(`${API_URL}/list/${listId}?${query}`));
};

// every item of a list, in the list's order: pages until total_pages, an empty page or item_count items
const getList = async (listId, getPage = getListPage) => {
  const first = await getPage(listId, 1);
  const items = [...first.items];
  for (let page = 2; page <= MAX_PAGES; page++) {
    const done = first.totalPages !== null ? page > first.totalPages : first.itemCount !== null && items.length >= first.itemCount;
    if (done || !first.items.length) {
      break;
    }
    const next = await getPage(listId, page);
    if (!next.items.length) {
      break;
    }
    items.push(...next.items);
  }
  return { name: first.name, itemCount: first.itemCount, items };
};

const posterUrl = (posterPath, size = "w780") => (posterPath ? `${IMAGE_URL}${size}${posterPath}` : "");

module.exports = { normalizeListPage, getListPage, getList, posterUrl };
