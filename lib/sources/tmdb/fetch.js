// the tmdb source: the posters of a public TMDb list (movies and series) into projects/tmdb/<name>/items.json.
// The project follows the list: the first maxItems entries in the list's order, at most --limit new ones per run,
// entries that left the list are dropped (with their images). Run through scripts/fetch.js, which loads .env
const fs = require("node:fs");
const path = require("node:path");

const { REFRESH_BEFORE_DAYS, oldImages } = require("../../utils/cache-limit");
const { readData, writeData } = require("../../utils/items");

// a list entry -> an item. ids carry the media type, a movie and a series can share a number
const toItem = (entry, posterUrl, addedAt) => ({
    id: `${entry.mediaType}-${entry.id}`,
    tmdbId: entry.id,
    mediaType: entry.mediaType,
    title: entry.title,
    subtitle: entry.year,
    addedAt,
    fetchedAt: addedAt,
    source: posterUrl(entry.posterPath),
});

// pure: the items after this fetch -> { items, added, dropped, noPoster }
// items keep their order in items.json (new ones at the end, so the newest is the last item, the --latest centrepiece).
// every item gets fetchedAt = addedAt (today): its data was just confirmed by TMDb, which restarts its cache limit
const syncItems = (existing, entries, { maxItems = 200, limit = Infinity, addedAt, posterUrl }) => {
    const withPoster = entries.filter((entry) => entry.posterPath);
    const wanted = withPoster.slice(0, maxItems).map((entry) => `${entry.mediaType}-${entry.id}`);
    const known = new Set(existing.map((item) => item.id));

    const keep = new Set();
    const added = [];
    for (const entry of withPoster.slice(0, maxItems)) {
        const id = `${entry.mediaType}-${entry.id}`;
        if (known.has(id)) {
            keep.add(id);
        } else if (added.length < limit) {
            added.push(toItem(entry, posterUrl, addedAt));
        }
    }
    // titles and years can change on TMDb, the kept items get the current ones
    const current = new Map(withPoster.map((entry) => [`${entry.mediaType}-${entry.id}`, entry]));
    const kept = existing.filter((item) => keep.has(item.id)).map((item) => {
        const entry = current.get(item.id);
        return { ...item, title: entry.title, subtitle: entry.year, fetchedAt: addedAt };
    });
    return {
        items: [...kept, ...added],
        added,
        dropped: existing.filter((item) => !wanted.includes(item.id)),
        noPoster: entries.length - withPoster.length,
    };
};

// tmdb = api/tmdb.js (passed in, so this module doesn't touch the network or .env on import)
const fetchTmdb = async (project, { limit = Infinity, tmdb, now = Date.now() }) => {
    const today = new Date(now).toLocaleDateString("sv");
    if (!project.listId) {
        throw new Error(`tmdb.${project.name}.list in projects.json isn't a TMDb list link or id`);
    }
    const data = readData(project);
    const list = await tmdb.getList(project.listId);
    console.log(`List: ${list.name} (${list.items.length} entries)`);

    const { items, added, dropped, noPoster } = syncItems(data.items, list.items, {
        maxItems: project.maxItems ?? 200,
        limit,
        addedAt: today,
        posterUrl: tmdb.posterUrl,
    });
    for (const item of dropped) {
        fs.rmSync(path.join(project.dir, "images", `${item.id}.jpg`), { force: true });
    }

    data.items = items;
    data.state.list = { id: project.listId, name: list.name, url: `https://www.themoviedb.org/list/${project.listId}` };
    if (added.length) {
        data.state.lastFetched = today;
    }
    writeData(project, data);

    // posters close to the cache limit are removed, fetch.js runs cache.py next, which downloads them again
    if (project.maxCacheDays) {
        const renew = oldImages(project.dir, items, project.maxCacheDays - REFRESH_BEFORE_DAYS, now);
        for (const { file } of renew) {
            fs.rmSync(file, { force: true });
        }
        if (renew.length) {
            console.log(`Renewing ${renew.length} poster(s) downloaded over ${project.maxCacheDays - REFRESH_BEFORE_DAYS} days ago (TMDb's cache limit)`);
        }
    }

    if (added.length === 1) {
        console.log(`Added "${added[0].title}"`);
    }
    if (dropped.length) {
        console.log(`Dropped ${dropped.length} item(s) that left the list (or fell outside maxItems)`);
    }
    if (noPoster) {
        console.log(`Skipped ${noPoster} entr${noPoster === 1 ? "y" : "ies"} without a poster on TMDb`);
    }
    if (!added.length) {
        console.log("Nothing new in the list - add something to it and run daily-new again");
    }
    console.log(`${added.length} new item(s), ${items.length} items in ${project.id}`);
};

module.exports = { toItem, syncItems, fetchTmdb };
