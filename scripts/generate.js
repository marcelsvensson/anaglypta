// fetch new items from the spotify playlist and write one <project>/<date>.md per album
const fs = require('node:fs');
const path = require('node:path');

const settings = require("../settings.json");
const { project } = settings.spotify;

const projectDir = path.join(__dirname, "..", project);
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

// track ids already written to <project>/*.md
const readKnownIds = (dir) => {
    const ids = new Set();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
        const match = fs.readFileSync(path.join(dir, file), "utf8").match(/^\s*id: "?([^"\n]+)"?$/m);
        if (match) {
            ids.add(match[1]);
        }
    }
    return ids;
};

// skips tracks that are already written (or appear twice in the playlist), adds new ids to knownIds
const filterNewItems = (items, knownIds) => items.filter(({ track }) => {
    if (knownIds.has(track.id)) {
        return false;
    }
    knownIds.add(track.id);
    return true;
});

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
    const spotify = require("../api/spotify");
    const state = readState();
    fs.mkdirSync(projectDir, { recursive: true });
    const knownIds = readKnownIds(projectDir);

    state.spotify.playlist = await spotify.getPlaylistMeta();
    console.log(`Playlist: ${state.spotify.playlist.name}`);

    // playlistOffset = position in the playlist, daysFetched = number of album files
    let offset = state.spotify.playlistOffset ?? state.spotify.daysFetched;
    let { lastDayFetched } = state.spotify;
    let filesWritten = 0;
    let page;

    do {
        page = await spotify.getPlaylistItems(offset);
        offset += page.count;

        for (const entry of filterNewItems(page.items, knownIds)) {
            const genres = await getGenres(spotify, entry.track.album.artists[0].id);
            const date = new Date(entry.added_at).toLocaleDateString("sv");
            const fileName = fileNameFor(date, (name) => fs.existsSync(path.join(projectDir, name)));

            fs.writeFileSync(path.join(projectDir, fileName), buildFrontmatter(entry, genres));
            filesWritten++;
            if (date > lastDayFetched) {
                lastDayFetched = date;
            }
        }
    } while (page.next);

    state.spotify.playlistOffset = offset;
    state.spotify.lastDayFetched = lastDayFetched;
    state.spotify.daysFetched = fs.readdirSync(projectDir).filter((f) => f.endsWith(".md")).length;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    console.log(`${filesWritten} new album(s) written, ${state.spotify.daysFetched} in total`);
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
    fileNameFor,
    readKnownIds,
};
