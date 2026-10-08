# Anaglypta

> *"Anaglypta is a range of paintable textured wallcoverings made from paper or vinyl."*
>
> — [Wikipedia](https://en.wikipedia.org/wiki/Anaglypta)

Turn a Spotify playlist into wallpaper. Anaglypta reads the albums in a playlist you own and makes:

- **a pixel bitmap**: every album cover shrunk to a 9×9 pixel tile, in a 10×10 grid that fills up one album at a time
- **a collage**: 100 album covers around a centrepiece (the pixel bitmap or a random cover), good as a desktop background
- **a small website**: every album as a tile, with a Spotify player, genre filter and the album's pixel as favicon, ready to upload over SFTP

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
| `npm run full` | Fetches the whole playlist, then builds the bitmap and the collage in playlist order. | The first run, or to catch up after adding many albums. |
| `npm run daily` | Fetches new albums, updates the bitmap, builds the website and uploads it (if SFTP is set up). | Once a day, to reveal one album at a time. |

Extra options can be passed after `--`:

```sh
npm run collage -- --cover      # a random album cover in the middle instead of the bitmap
npm run upload -- --dry-run     # show what would be uploaded, without connecting
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
| `npm run full` | fetch + bitmap + collage |
| `npm run daily` | fetch + bitmap + build + upload |
| `npm run build` | Build the website into `_site/` |
| `npm run dev` | Preview the website at http://localhost:8080 |
| `npm run upload` | Upload the website over SFTP (`-- --dry-run` to check first) |
| `npm run clean` | Remove what can be rebuilt (`_site/`, the cover cache in `tmp/`) |
| `npm run reset` | Start over: also removes your fetched albums and images (asks first) |

To reinstall the Node packages, use `npm ci`.

## Configuration

### `.env`: credentials and connections

Created by `npm run setup` from [`.example.env`](.example.env). Never commit it.

| Variable | | What |
|---|---|---|
| `CLIENT_ID` | required | Your Spotify app's Client ID |
| `PLAYLIST_ID` | required | The playlist ID, the part after `/playlist/` in its link |
| `CLIENT_SECRET` | optional | Only for apps created before 2026 (instead of `npm run auth`) |
| `SPOTIFY_MARKET` | optional | Country code such as `SE`, for track availability |
| `SPOTIFY_AUTH_PORT` | optional | Port for the login, default `8888` |
| `SFTP_HOST`, `SFTP_USER` | optional | Server and user for the upload, leave empty to skip uploading |
| `SFTP_PASSWORD` or `SFTP_PRIVATE_KEY_PATH` | optional | Password, or a private key such as `~/.ssh/id_ed25519` (plus `SFTP_PASSPHRASE` if it has one) |
| `SFTP_PORT` | optional | Default `22` |
| `SFTP_SPECIFIC_PATH` | optional | Folder to upload to, relative to where you land after logging in, e.g. `public_html/albums` |

### `settings.json`: how things look

| Setting | What |
|---|---|
| `site.title` | Page title of the website. Empty = the playlist name. |
| `spotify.project` | Folder for the album files and images (default `album`) |
| `spotify.cover` | The pixel bitmap: `col` × `row` tiles, each cover shrunk to `width` × `height` pixels and enlarged `scale` times, with `gap` pixels between tiles |
| `spotify.collage` | The collage grid, same keys as `cover`, plus `center` (top-left cell and size of the centrepiece, in cells) and `skip` (cells to leave empty, as `[col, row]`) |

The bitmap holds `col × row` albums (100 by default). When the playlist grows past that, it shows the latest 100. `npm run collage` picks from all of them.

## Upload to your own website

Fill in the `SFTP_*` variables in `.env`, then check the settings without connecting:

```sh
npm run build
npm run upload -- --dry-run
```

`npm run upload` sends `index.html`, `bitmap.jpg` and `favicon.ico` and creates the folder if needed. `npm run daily` does the same, and without SFTP settings it simply skips the upload.

## Run it every day

With cron (macOS/Linux), `crontab -e`:

```cron
0 8 * * * cd /path/to/anaglypta && PATH=/path/to/node/bin:$PATH npm run daily >> daily.log 2>&1
```

Cron doesn't load your shell profile, so give it the folder that contains `node` and `npm` (`dirname "$(which npm)"`). On macOS, cron may need **Full Disk Access** (System Settings → Privacy & Security) if the project lives in a protected folder such as Documents.

## How it works

1. `npm run fetch` asks Spotify for the playlist's new entries and writes one Markdown file per album to `album/` (artist, album, cover URL, genres).
2. `npm run bitmap` and `npm run collage` download the covers once into `tmp/` and draw the images with Python/Pillow.
3. `npm run build` turns the album files into the website with [Eleventy](https://www.11ty.dev).
4. `state.json` remembers how far into the playlist you've come.

Everything generated (`album/*.md`, the images, `tmp/`, `_site/`, `state.json`) is ignored by git. `npm run reset` takes you back to a fresh start.

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
| Upload fails | Check the settings with `npm run upload -- --dry-run`. A half-filled `SFTP_*` setup lists what's missing. |

## Spotify content

Album covers, names and genres come from Spotify and belong to Spotify and the rights holders. The generated images are for your own use: don't commit them to your repository or redistribute them, and follow the [Spotify Developer Terms](https://developer.spotify.com/terms).

## License

[ISC](LICENSE)
