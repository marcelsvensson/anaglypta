// mock spotify-api
const fs = require('node:fs');
const path = require('path');

const spotify = require("../api/spotify");
const settings = require("../settings.json");
const { project } = settings.spotify;

// runtime state lives in state.json (gitignored) so a fresh clone starts clean
const statePath = path.join(__dirname, "..", "state.json");
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
state.spotify = { lastDayFetched: "", daysFetched: 0, ...state.spotify };
const { lastDayFetched, daysFetched } = state.spotify;

const doGenerate = async () => {
    // daysFetched can be used as an offset on the API-call since it's limited
    let newLastDayFetched, filesWritten = 0;

    console.log(`Starting generation with lastDayFetched: ${lastDayFetched} and daysFetched: ${daysFetched}`);
    const spotifyList = await spotify.getPlaylist(daysFetched);
    console.log(`Fetched ${spotifyList.items.length} items from Spotify playlist.`);

    for (let i=0; i < spotifyList.items.length; i++) {
        const { 
            added_at,
            track: {
                id,
                name: song, 
                album: { 
                    name: album, 
                    id: albumId,
                    images, 
                    artists, 
                    release_date
                }
            }
        } = spotifyList.items[i];
        

        const date = new Date(added_at).toLocaleDateString("sv");
        if (date<=lastDayFetched) {
            continue;
        }

        const { id: artistId, name: artistName } = artists[0];
        const spotifyArtist = await spotify.getArtist(artistId);
        const allGenres = spotifyArtist.genres
        const genres = [];
        if (allGenres.length) {
            genres.push(allGenres.shift());
        }
        if (allGenres.length) {
            genres.push(allGenres.shift());
        }

        const content = `---
    artist: ${artistName.replace(":", "&colon;")}
    artistId: ${artistId}
    album: ${album.replace(":", "&colon;")}
    albumId: ${albumId}
    song: ${song}
    id: ${id}
    release: "${release_date}"
    images: ${images[0].url}
    tags: 
    - ${genres.join("\n    - ")}
    genreTags: "${genres.map((genre) => `genre-${genre.toLowerCase().replace(/\s+/g, "_")}`).join(", ")}"
---`;

        let file = path.join(__dirname, "..", project) + `/${date}.md`;;
        let j = 0
        while (fs.existsSync(file)) {
            file = path.join(__dirname, "..", project) + `/${date + '-' + j}.md`;
            j++;
        }
        fs.writeFileSync(file, content, (err) => {
            if (err) {
                console.error('Error writing file:', err);
                return false;
            }
        });
        filesWritten++;
        if (date>lastDayFetched) {
            newLastDayFetched = date;
        }
    }

    if (filesWritten) {
        state.spotify.lastDayFetched = newLastDayFetched;
        state.spotify.daysFetched = daysFetched+filesWritten;

        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        console.log(`State updated, (${filesWritten} new file(s) fetched and written)!`);
    }

    return true;
};

doGenerate();

