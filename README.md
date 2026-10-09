# Anaglypta

> *"Anaglypta is a range of paintable textured wallcoverings made from paper or vinyl."*
>
> — [Wikipedia](https://en.wikipedia.org/wiki/Anaglypta)

Turn a Spotify playlist into wallpaper. Anaglypta reads the albums in a playlist you own and makes:

- **a pixel bitmap**: every album cover shrunk to a 9×9 pixel tile, in a 10×10 grid that fills up one album at a time
- **a collage**: 100 album covers around a centrepiece (the pixel bitmap or a random cover), good as a desktop background

## Requirements

- [Node.js](https://nodejs.org) 20 or newer
- [Python](https://www.python.org) 3.9 or newer
- A **Spotify Premium** account (Spotify requires Premium for the owner of a developer app)
- A Spotify playlist that **you own or collaborate on** (Spotify only shares the contents of those)

## Quick start

1. **First, [create a Spotify app](#create-a-spotify-app).** It takes about five minutes, and the setup asks for its Client ID and your playlist link.
2. Then:

   ```sh
   git clone https://github.com/marcelsvensson/anaglypta.git
   cd anaglypta
   npm ci
   npm run setup
   npm run full
   ```

`npm run setup` walks you through the rest: it sets up Python, creates `.env`, asks for your Spotify Client ID and playlist link, and logs you in to Spotify. You can run it again at any time to check that everything is in place.

Then look in `album/`: `bitmap.jpg` and `collage.jpg`.

## Create a Spotify app

Anaglypta talks to the Spotify Web API through your own (free) developer app.

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in with your Spotify account.
2. Click **Create app** and fill in a name and description (anything, e.g. "Anaglypta").
3. Under **Redirect URIs**, add exactly:
   ```
   http://127.0.0.1:8888/callback
   ```
   (Spotify doesn't accept `localhost`. If port 8888 is taken, pick another port, use it here, and set `SPOTIFY_AUTH_PORT` in `.env`.)
4. Accept the Developer Terms and click **Save**.
5. Open your app, go to **Settings** and copy the **Client ID**. `npm run setup` asks for it.

You'll also need the link to your playlist: in Spotify, open the playlist, then **⋯ → Share → Copy link to playlist**.

When the app is set up, `npm run setup` (or `npm run auth`) opens your browser once to log in. The login is stored in `.spotify-token.json`. Keep that file private: it's already in `.gitignore`.

Good to know:

- New apps run in **development mode**: up to 5 Spotify users, and anyone other than you must be added under **User Management** in the app's settings.
- **Apps created before 2026** can still use the older login with a client secret: set `CLIENT_SECRET` in `.env` instead of running `npm run auth`.

## Three ways to use it

| Command | What it does | When |
|---|---|---|
| `npm run collage` | Remixes the collage: picks albums at random from the ones you already have. No Spotify needed. | You have your albums and just want a new background. |
| `npm run full` | Fetches the whole playlist, then builds the bitmap and the collage in playlist order, with a random album cover as the centrepiece. | The first run, or to catch up after adding many albums. |
| `npm run daily` | The day-by-day reveal: adds **one** new album (skipping albums you already have, further down the playlist if needed), updates the bitmap and puts the new album in the middle of the collage. | Once a day, to reveal one album at a time. |

Every album appears once: if the playlist has several songs from the same album, the first one added wins.

Extra options can be passed after `--`:

```sh
npm run collage -- --cover      # a random album cover in the middle instead of the bitmap
npm run collage -- --latest     # the newest album in the middle
```

## All commands

| Command | Does |
|---|---|
| `npm run setup` | Gets everything ready (safe to re-run) |
| `npm run setup:python` | Only the Python part (`.venv` with Pillow) |
| `npm run auth` | Log in to Spotify (again) |
| `npm run fetch` | Fetch new albums from the playlist into `album/` |
| `npm run bitmap` | Draw `album/bitmap.jpg` |
| `npm run collage` | Draw `album/collage.jpg` with random albums (`-- --cover` for a cover centrepiece) |
| `npm run full` | fetch + bitmap + collage (cover centrepiece) |
| `npm run daily` | fetch one new album + bitmap + collage (newest album centrepiece) |
| `npm run clean` | Remove what can be rebuilt (the cover cache in `tmp/`) |
| `npm run reset` | Start over: also removes your fetched albums and images (asks first) |
| `npm test` | Run the tests (`test:node` and `test:python` separately) |

To reinstall the Node packages, use `npm ci`.

## Configuration

### `.env`: credentials

Created by `npm run setup` from [`.example.env`](.example.env). Never commit it.

| Variable | | What |
|---|---|---|
| `CLIENT_ID` | required | Your Spotify app's Client ID |
| `PLAYLIST_ID` | required | The playlist ID, the part after `/playlist/` in its link |
| `CLIENT_SECRET` | optional | Only for apps created before 2026 (instead of `npm run auth`) |
| `SPOTIFY_MARKET` | optional | Country code such as `SE`, for track availability |
| `SPOTIFY_AUTH_PORT` | optional | Port for the login, default `8888` |

### `settings.json`: how things look

| Setting | What |
|---|---|
| `spotify.project` | Folder for the album files and images (default `album`) |
| `spotify.maxAlbums` | The most albums the folder will hold (default `200`). At the limit, `fetch`, `full` and `daily` add nothing more |
| `spotify.cover` | The pixel bitmap: `col` × `row` tiles, each cover shrunk to `width` × `height` pixels and enlarged `scale` times, with `gap` pixels between tiles |
| `spotify.collage` | The collage grid, same keys as `cover`, plus `center` (top-left cell and size of the centrepiece, in cells) and `skip` (cells to leave empty, as `[col, row]`) |

The bitmap holds `col × row` albums (100 by default). When you have more, it shows the latest 100, and `npm run collage` picks from all of them, up to `maxAlbums`.

## Run it every day

With cron (macOS/Linux), `crontab -e`:

```cron
0 8 * * * cd /path/to/anaglypta && PATH=/path/to/node/bin:$PATH npm run daily >> daily.log 2>&1
```

Cron doesn't load your shell profile, so give it the folder that contains `node` and `npm` (`dirname "$(which npm)"`). On macOS, cron may need **Full Disk Access** (System Settings → Privacy & Security) if the project lives in a protected folder such as Documents.

## How it works

1. `npm run fetch` asks Spotify for the playlist's new entries and writes one Markdown file per album to `album/` (artist, album, cover URL, genres).
2. `npm run bitmap` and `npm run collage` download each cover once into `tmp/covers/` and draw the images with Python/Pillow.
3. `state.json` remembers how far into the playlist you've come.

Everything generated (`album/`, `tmp/`, `state.json`) is ignored by git. `npm run reset` takes you back to a fresh start.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Not logged in to Spotify` | Run `npm run auth`. |
| `Spotify returned no tracks` / `403` on the playlist | You must own or collaborate on the playlist, and be logged in with `npm run auth`. |
| `403` on everything | The app owner needs Spotify Premium, and other users must be added under **User Management** in the app. |
| `invalid_grant` | The login expired or was revoked. Run `npm run auth` again. |
| `INVALID_CLIENT: Invalid redirect URI` | The Redirect URI in the app must be exactly `http://127.0.0.1:8888/callback` (or your `SPOTIFY_AUTH_PORT`). |
| `Port 8888 is busy` | Set `SPOTIFY_AUTH_PORT` in `.env` and add the matching Redirect URI to the app. |
| `Python packages missing` | Run `npm run setup:python`. |
| `No albums found` | Run `npm run fetch` (or `npm run full`) first. |
| `No new albums in the playlist` | Not an error: every album in the playlist is already in the grid. Add one to the playlist for tomorrow's `daily`. |
| `album/ already has 200 albums` | You've reached `maxAlbums` in `settings.json`. Raise it, or `npm run reset` to start over. |
| `The playlist got shorter - checking it from the start` | Not an error: songs were removed, so `fetch` looks through the playlist again. Albums you already have are skipped. |
| `npm error Unknown cli flag` | Put `--` before the options: `npm run collage -- --cover`. |

## Testing

```sh
npm test
```

Runs the Node tests (`node:test`) and the Python tests (`unittest`) in a couple of seconds. They need no network, no Spotify account and no `.env`: Spotify responses come from the fixtures in `test/fixtures/`, and the image tests draw solid-colour covers in a temp folder.

## Spotify content

Album covers, names and genres come from Spotify and belong to Spotify and the rights holders. The generated images are for your own use: don't commit them to your repository or redistribute them, and follow the [Spotify Developer Terms](https://developer.spotify.com/terms).

## License

[ISC](LICENSE)
