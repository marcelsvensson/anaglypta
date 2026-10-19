// the spotify source: fetches new albums from the project's playlist into projects/spotify/<name>/items.json,
// one item per album (the first song added wins). Run through scripts/fetch.js, which loads .env
const { readData, writeData } = require("../project");

// one item per album: { id: album id, trackId, title, subtitle, addedAt, source: the cover url }
const toItem = ({ added_at, track }) => ({
    id: track.album.id,
    trackId: track.id,
    title: track.album.name,
    subtitle: track.album.artists?.[0]?.name ?? "",
    addedAt: added_at,
    source: track.album.images?.[0]?.url ?? "",
});

// the track and album ids already in items.json
const knownFrom = (items) => ({
    trackIds: new Set(items.map((item) => item.trackId).filter(Boolean)),
    albumIds: new Set(items.map((item) => item.id)),
});

// one tile per album: skips songs whose track or album is already known (or came earlier in the playlist),
// the first song added wins. Adds the new ids to known, onSkip(entry) is called for skipped duplicate albums
const filterNewItems = (items, known, onSkip = () => {}) => items.filter((entry) => {
    const { id, album } = entry.track;
    if (known.trackIds.has(id)) {
        return false;
    }
    known.trackIds.add(id);
    if (known.albumIds.has(album.id)) {
        onSkip(entry);
        return false;
    }
    known.albumIds.add(album.id);
    return true;
});

// walks the playlist from offset, page by page, until it has `limit` new albums or the playlist ends.
// returns { entries, offset, total } - offset points right after the last song it took (or the end of the playlist),
// so the next run continues there. When songs were removed (the playlist is shorter than last time, or the offset is
// past its end) the positions have shifted: it starts over from the top once, the duplicate check keeps it from
// adding anything twice
const collectNewAlbums = async ({ getPage, offset = 0, known, limit = Infinity, previousTotal = null, onSkip, onRestart = () => {} }) => {
    const entries = [];
    let position = offset;
    let restarted = false;
    let total = null;

    while (entries.length < limit) {
        const page = await getPage(position);
        total = page.total ?? total;
        const shrunk = total !== null && ((previousTotal !== null && total < previousTotal) || position > total);
        if (shrunk && !restarted && position > 0) {
            restarted = true;
            onRestart();
            position = 0;
            continue;
        }

        const pageStart = position;
        for (const item of page.items) {
            if (filterNewItems([item], known, onSkip).length) {
                entries.push(item);
                if (entries.length >= limit) {
                    return { entries, offset: pageStart + item.position + 1, total };
                }
            }
        }
        position = pageStart + page.count;
        if (!page.next || page.count === 0) {
            break;
        }
    }
    return { entries, offset: position, total };
};

// room left under maxItems, counted in unique albums
const freeSlots = (maxItems, known) => Math.max(0, maxItems - known.albumIds.size);

// spotify = api/spotify.js (passed in, so this module doesn't touch the network or .env on import)
const fetchSpotify = async (project, { limit = Infinity, spotify }) => {
    if (!project.playlistId) {
        throw new Error(`spotify.${project.name}.playlist in projects.json isn't a playlist link or id`);
    }
    const data = readData(project);
    const known = knownFrom(data.items);

    const maxItems = project.maxItems ?? 200;
    const free = freeSlots(maxItems, known);
    if (free === 0) {
        console.log(`${project.id} already has ${known.albumIds.size} albums (maxItems) - nothing added`);
        return;
    }

    data.state.playlist = await spotify.getPlaylistMeta(project.playlistId);
    console.log(`Playlist: ${data.state.playlist.name}`);

    // playlistOffset = position in the playlist, right after the last song taken
    const { entries, offset, total } = await collectNewAlbums({
        getPage: (position) => spotify.getPlaylistItems(project.playlistId, position),
        offset: data.state.playlistOffset ?? 0,
        known,
        limit: Math.min(limit, free),
        previousTotal: data.state.playlistTotal ?? null,
        onSkip: ({ track }) => console.log(`Skipped "${track.album.name}" - already in the grid`),
        onRestart: () => console.log("The playlist got shorter - checking it from the start"),
    });

    for (const entry of entries) {
        data.items.push(toItem(entry));
        console.log(`Added "${entry.track.album.name}" by ${entry.track.album.artists?.[0]?.name ?? "?"}`);
    }

    data.state.playlistOffset = offset;
    if (total !== null) {
        data.state.playlistTotal = total;
    }
    if (entries.length) {
        data.state.lastFetched = new Date().toLocaleDateString("sv");
    }
    writeData(project, data);

    if (!entries.length) {
        console.log("No new albums in the playlist - add one and run daily-new again");
    } else if (entries.length === free && free < limit) {
        console.log(`Stopped at ${maxItems} albums (maxItems)`);
    }
    console.log(`${entries.length} new album(s), ${known.albumIds.size} albums in ${project.id}`);
};

module.exports = {
    toItem,
    knownFrom,
    filterNewItems,
    collectNewAlbums,
    freeSlots,
    fetchSpotify,
};
