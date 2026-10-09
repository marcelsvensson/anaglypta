// fetch new items from the spotify playlist and write one <project>/data/<date>.md per album
const fs = require('node:fs');
const path = require('node:path');

const settings = require("../settings.json");
const { project } = settings.spotify;

const projectDir = path.join(__dirname, "..", project);
// the album files live in a subfolder, so the images are easy to find in <project>/
const dataDir = path.join(projectDir, "data");
const statePath = path.join(__dirname, "..", "state.json");

// JSON strings are valid YAML scalars - this escapes colons, quotes, etc.
const yaml = (value) => JSON.stringify(value ?? "");

const buildFrontmatter = ({ track }, genres = []) => {
    const {
        id,
        name: song,
        album: { name: album, id: albumId, images, artists, release_date }
    } = track;
    const { id: artistId, name: artist } = artists[0];
    const tags = genres.length ? "\n" + genres.map((genre) => `    - ${yaml(genre)}`).join("\n") : " []";

    // images is left unquoted, bitmapper.py reads that line as-is
    return `---
    artist: ${yaml(artist)}
    artistId: ${yaml(artistId)}
    album: ${yaml(album)}
    albumId: ${yaml(albumId)}
    song: ${yaml(song)}
    id: ${yaml(id)}
    release: ${yaml(release_date)}
    images: ${images?.[0]?.url ?? ""}
    tags:${tags}
---`;
};

// track and album ids already written to <project>/data/*.md
const readKnownIds = (dir) => {
    const known = { trackIds: new Set(), albumIds: new Set() };
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
        const text = fs.readFileSync(path.join(dir, file), "utf8");
        const trackId = text.match(/^\s*id: "?([^"\n]+)"?$/m);
        const albumId = text.match(/^\s*albumId: "?([^"\n]+)"?$/m);
        if (trackId) {
            known.trackIds.add(trackId[1]);
        }
        if (albumId) {
            known.albumIds.add(albumId[1]);
        }
    }
    return known;
};

// one tile per album: skips songs whose track or album is already written (or came earlier in the playlist),
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

// room left under maxAlbums (settings.json), counted in unique albums
const freeSlots = (maxAlbums, known) => Math.max(0, maxAlbums - known.albumIds.size);

// --limit <n>: the most new albums one run adds (daily uses 1), no --limit = all of them
const parseLimit = (argv) => {
    const index = argv.indexOf("--limit");
    if (index === -1) {
        return Infinity;
    }
    const limit = Number(argv[index + 1]);
    if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`--limit needs a whole number of albums, like --limit 1 (got "${argv[index + 1] ?? ""}")`);
    }
    return limit;
};

// <date>.md, then <date>-0.md, <date>-1.md, ... for albums added on the same day
const fileNameFor = (date, exists) => {
    let fileName = `${date}.md`;
    for (let i = 0; exists(fileName); i++) {
        fileName = `${date}-${i}.md`;
    }
    return fileName;
};

const readState = () => {
    const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
    state.spotify = { lastDayFetched: "", daysFetched: 0, ...state.spotify };
    return state;
};

const getGenres = async (spotify, artistId) => {
    try {
        const { genres = [] } = await spotify.getArtist(artistId);
        return genres.slice(0, 2);
    } catch (error) {
        console.warn(`⚠️  No genres for artist ${artistId}: ${error.message}`);
        return [];
    }
};

const main = async () => {
    const limit = parseLimit(process.argv);
    require("dotenv").config({ quiet: true });
    const spotify = require("../api/spotify");
    const state = readState();
    fs.mkdirSync(dataDir, { recursive: true });
    const known = readKnownIds(dataDir);

    const maxAlbums = settings.spotify.maxAlbums ?? 200;
    const free = freeSlots(maxAlbums, known);
    if (free === 0) {
        console.log(`${project}/ already has ${known.albumIds.size} albums (maxAlbums in settings.json) - nothing added`);
        return;
    }

    state.spotify.playlist = await spotify.getPlaylistMeta();
    console.log(`Playlist: ${state.spotify.playlist.name}`);

    // playlistOffset = position in the playlist, daysFetched = number of album files
    const { entries, offset, total } = await collectNewAlbums({
        getPage: (position) => spotify.getPlaylistItems(position),
        offset: state.spotify.playlistOffset ?? state.spotify.daysFetched,
        known,
        limit: Math.min(limit, free),
        previousTotal: state.spotify.playlistTotal ?? null,
        onSkip: ({ track }) => console.log(`Skipped "${track.album.name}" - already in the grid`),
        onRestart: () => console.log("The playlist got shorter - checking it from the start"),
    });

    let { lastDayFetched } = state.spotify;
    for (const entry of entries) {
        const { album } = entry.track;
        const genres = await getGenres(spotify, album.artists[0].id);
        const date = new Date(entry.added_at).toLocaleDateString("sv");
        const fileName = fileNameFor(date, (name) => fs.existsSync(path.join(dataDir, name)));

        fs.writeFileSync(path.join(dataDir, fileName), buildFrontmatter(entry, genres));
        console.log(`Added "${album.name}" by ${album.artists[0].name}`);
        if (date > lastDayFetched) {
            lastDayFetched = date;
        }
    }

    state.spotify.playlistOffset = offset;
    if (total !== null) {
        state.spotify.playlistTotal = total;
    }
    state.spotify.lastDayFetched = lastDayFetched;
    state.spotify.daysFetched = fs.readdirSync(dataDir).filter((f) => f.endsWith(".md")).length;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    if (!entries.length) {
        console.log("No new albums in the playlist - add one and run daily again");
    } else if (entries.length === free && free < limit) {
        console.log(`Stopped at ${maxAlbums} albums (maxAlbums in settings.json)`);
    }
    console.log(`${entries.length} new album(s), ${known.albumIds.size} albums in ${project}/`);
};

if (require.main === module) {
    main().catch((error) => {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    buildFrontmatter,
    filterNewItems,
    collectNewAlbums,
    freeSlots,
    parseLimit,
    fileNameFor,
    readKnownIds,
};
