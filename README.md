# Anaglypta

> *"Anaglypta is a range of paintable textured wallcoverings made from paper or vinyl."*
>
> — [Wikipedia](https://en.wikipedia.org/wiki/Anaglypta)

Turn a Spotify playlist or a folder of photos into wallpaper. Anaglypta makes **a collage**: 92 square images around a big centrepiece (a random one or the newest), or 117 without one, good as a desktop background or in Google Meet — an icebreaker, a conversation piece or just an excellent way to show off your awesome taste in music (or cats).

## Sources and projects

Images come from a **source**, and every source can have several **projects**:

| Source | A project is | Needs |
|---|---|---|
| `spotify` | a playlist: one image per album cover | a Spotify app and Premium, see [below](#create-a-spotify-app) |
| `local` | a folder on this computer: jpg, png, webp, gif, bmp, tiff and heic, directly in that folder (subfolders are left alone) | nothing else |

Each project lives in `projects/<source>/<name>/`: `items.json` (what's been fetched, and how far), `images/` (square copies, 640×640 by default) and the collages. `npm run setup` adds projects, they're stored in `projects.json`.

## Requirements

- [Node.js](https://nodejs.org) 20 or newer
- [Python](https://www.python.org) 3.9 or newer
- For Spotify projects: a **Spotify Premium** account (Spotify requires Premium for the owner of a developer app) and a playlist that **you own or collaborate on** (Spotify only shares the contents of those)

## Quick start

1. For a Spotify playlist, **first [create a Spotify app](#create-a-spotify-app).** It takes about five minutes, and the setup asks for its Client ID and your playlist link. For a folder of images, skip this.
2. Then:

   ```sh
   git clone https://github.com/marcelsvensson/anaglypta.git
   cd anaglypta
   npm ci
   npm run setup
   npm run full
   npm run collage
   ```

`npm run setup` walks you through the rest: it sets up Python, creates `.env` and adds your first project. For Spotify it asks for your Client ID, logs you in and suggests a project name from the playlist's name. For a folder it counts the images and suggests the folder's name. Run it again at any time to check that everything is in place, and to add a project, pick which one is the default, rename one or remove one. Removing deletes the project's folder in `projects/` (never your own photos), and first shows the lines in your crontab that use the project, so you can change them before they start failing. `npm run full` fetches the images, `npm run collage` draws the collage.

Then look in `projects/<source>/<name>/`: `collage.jpg` (and a small `collage_thumbnail.jpg`).

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

You'll also need the link to your playlist: in Spotify, open the playlist, then **⋯ → Share → Copy link to playlist**. Each playlist becomes its own project, run `npm run setup` again to add another one.

When the app is set up, `npm run setup` (or `npm run auth`) opens your browser once to log in. The login is stored in `.spotify-token.json`. Keep that file private: it's already in `.gitignore`.

Good to know:

- New apps run in **development mode**: up to 5 Spotify users, and anyone other than you must be added under **User Management** in the app's settings.
- **Apps created before 2026** can still use the older login with a client secret: set `CLIENT_SECRET` in `.env` instead of running `npm run auth`.

## Ways to use it

| Command | What it does | When |
|---|---|---|
| `npm run full` | Fetches everything new (up to `maxItems`). Draws nothing. | The first run, or to catch up after adding many albums or photos. |
| `npm run collage` | Draws a new random collage from the images you already have. No Spotify needed. | Whenever you want a new background. |
| `npm run daily-new` | The day-by-day reveal: adds **one** new item (skipping what you already have), puts it in the middle of the collage and sends it to Google Meet (if set up). | Once a day, to reveal one album or photo at a time. |
| `npm run random-meet` | A new random collage as your Google Meet background. Needs `npm run setup:meet` first. | As often as you like, e.g. every hour from cron. |

Every command works on the default project (the first one you added, or `"default"` in `projects.json`). Pick another one with `-p` (`--project`) after `--`, as `name` or `source/name`. When two sources have a project with the same name, add `-s` (`--source`) or use `source/name`:

```sh
npm run full -- -p cats             # the project called cats
npm run collage -- -p local/cats    # the same, with its source
npm run daily-new -- -s spotify     # the default spotify project
```

Spotify: every album appears once, if the playlist has several songs from the same album the first one added wins. Local: the project holds the newest `maxItems` images in the folder, by the file's date. Drop new photos in and the next `full` adds them, pushing the oldest out. Photos you delete from the folder are dropped, edited ones come back as new.

`collage` and `random-meet` take an option for the middle of the collage, after `--`:

```sh
npm run collage -- --cover          # a random image in the middle (the default)
npm run collage -- --latest         # the newest one in the middle
npm run random-meet -- --fill       # no centrepiece, the middle is filled with images too
```

## All commands

All of them take `-p <project>` / `-s <source>` after `--`.

| Command | Does |
|---|---|
| `npm run setup` | Gets everything ready, adds, renames, removes and picks the default project (safe to re-run) |
| `npm run setup:python` | Only the Python part (`.venv` with Pillow and pillow-heif) |
| `npm run setup:meet` | Optional: set up the collage as your Google Meet background (macOS + Chrome) |
| `npm run auth` | Log in to Spotify (again) |
| `npm run full` | Fetch new items into the project's `items.json` and their square images into `images/` (all of them, up to `maxItems`, `-- --limit n` for at most n) |
| `npm run collage` | Draw the project's `collage.jpg` from random images (`-- --cover`, `-- --latest` or `-- --fill` for the centre) |
| `npm run daily-new` | fetch one new item + collage (newest item centrepiece) + meet |
| `npm run random-meet` | collage (same options) + meet, only when Google Meet is set up |
| `npm run clean` | Remove what can be rebuilt (every project's `images/`) |
| `npm run reset` | Start a project over: removes its folder, so everything is fetched again (asks first) |
| `npm run meet` | Copy the project's collage into Google Meet (experimental, see below, `-- --dry-run` to check first) |
| `npm test` | Run the tests (`test:node` and `test:python` separately) |

To reinstall the Node packages, use `npm ci`.

## Configuration

### `.env`: credentials

Created by `npm run setup` from [`.example.env`](.example.env). Never commit it.

| Variable | | What |
|---|---|---|
| `CLIENT_ID` | Spotify | Your Spotify app's Client ID |
| `CLIENT_SECRET` | optional | Only for apps created before 2026 (instead of `npm run auth`) |
| `SPOTIFY_MARKET` | optional | Country code such as `SE`, for track availability |
| `SPOTIFY_AUTH_PORT` | optional | Port for the login, default `8888` |
| `GOOGLE_MEET_BLOB_PATH`, `GOOGLE_MEET_BLOB_PATH_THUMBNAIL` | optional | The two Chrome files for your Google Meet background, see below |

### `projects.json`: your projects

Written by `npm run setup`, ignored by git (see [`projects.example.json`](projects.example.json)). You can edit it by hand too:

```json
{
  "default": "spotify/album",
  "spotify": { "album": { "playlist": "https://open.spotify.com/playlist/..." } },
  "local": { "cats": { "path": "~/Pictures/cats", "collage": { "center": { "size": 3 } } } }
}
```

Project names are folder names: lowercase letters, digits and `-`. A project can override any of the settings below, like `cats` does with a smaller centrepiece.

### `settings.json`: how things look

Defaults for every project, under `defaults`, and per source under `sources.<source>`. A project in `projects.json` overrides both (objects such as `collage.center` merge key by key).

| Setting | What |
|---|---|
| `default` | The default project when `projects.json` doesn't name one |
| `maxItems` | The most items a project will hold (default `200`). At the limit, `full` and `daily-new` add nothing more |
| `imageSize` | The size of the square copies in `images/` (default `640`, big enough for the centrepiece). Run `npm run clean` after changing it |
| `collage` | The collage grid: `col` × `row` cells, each image cropped to `width` × `height` pixels and enlarged `scale` times, with `gap` pixels between cells, plus `center` (top-left cell and size of the centrepiece, in cells) and `skip` (cells to leave empty, as `[col, row]`) |

The collage has 92 cells around the centrepiece by default. When you have more images, `npm run collage` picks at random from all of them, up to `maxItems`.

## Google Meet background (experimental)

On a Mac with Chrome, `npm run meet` makes the collage your Google Meet background. It overwrites the two files Chrome stored when you uploaded a background in Meet: the large image with the collage, the thumbnail with `collage_thumbnail.jpg` (97×68). `daily-new` and `random-meet` do this as their last step. There's one Meet background for all projects: it gets the collage of the project you run the command for.

Set it up once, after your first `npm run full` and `npm run collage`:

```sh
npm run setup:meet
```

It walks you through uploading the default project's `collage.jpg` (`-- -p <project>` for another one) as a background in Google Meet, finds the two files Chrome creates for it, saves their paths in `.env` and copies the collage in. From then on, reload Meet after a `daily-new` or `random-meet` to see the new collage.

This relies on Chrome internals that aren't documented: after a Chrome update, or if you upload the background again, run `npm run setup:meet` again. To set the paths by hand, upload a background and point `GOOGLE_MEET_BLOB_PATH` (the large file) and `GOOGLE_MEET_BLOB_PATH_THUMBNAIL` (the small one) at the two newest files under `~/Library/Application Support/Google/Chrome/Default/IndexedDB/https_meet.google.com_0.indexeddb.blob` (`ls -lt` helps). Leave both variables empty and the step is skipped.

## Run it on a schedule

`cron.sh` in the project folder runs any of the commands from cron. It finds Node by itself (asdf, nvm or Homebrew), so the cron line only needs the path to the script.

**1. Try it in the terminal**, from the project folder:

```sh
./cron.sh collage
```

**2. Add the job** with `crontab -e` (`EDITOR=nano crontab -e` if you'd rather not use vim). Use the full path to your project folder (`pwd` in the project folder shows it). One new album every morning at 8:

```cron
0 8 * * * /path/to/anaglypta/cron.sh daily-new >> /path/to/anaglypta/daily.log 2>&1
```

Or a new random Google Meet background every hour, 9–17 on weekdays (after `npm run setup:meet`):

```cron
0 9-17 * * 1-5 /path/to/anaglypta/cron.sh random-meet >> /path/to/anaglypta/meet.log 2>&1
```

Options go after the command, like in the terminal but without `--`: `cron.sh random-meet --latest`, `cron.sh random-meet --fill` or `cron.sh daily-new -p local/cats`. Reload Meet (or start a new meeting) to see the new background.

**3. Check it ran:** each run starts with a timestamped line in the log (`tail /path/to/anaglypta/daily.log`). `crontab -l` lists your jobs.

Good to know on macOS:
- Cron may need **Full Disk Access** (System Settings → Privacy & Security → Full Disk Access, add `/usr/sbin/cron`) if the project lives in a protected folder such as Documents or Desktop. Nothing in the log at all is the usual sign.
- Cron doesn't run while the Mac sleeps, and doesn't catch up afterwards. A missed `daily-new` simply happens the next day.
- `couldn't find node/npm` in the log: install Node with asdf, nvm or Homebrew, or add a `PATH=...` line with your Node folder at the top of your crontab.

## How it works

1. `npm run full` (and `daily-new`) asks the project's source for new items and adds them to `projects/<source>/<name>/items.json`, together with how far it has come (the position in the playlist, for Spotify).
   - `spotify`: one item per album (title, artist, cover URL), from the playlist's new entries.
   - `local`: one item per image in the folder. The square copies are made right away, so a broken file shows up as a warning (once) and is skipped.
2. Then it makes a square copy of every new image in `images/` (Spotify covers are downloaded for it). Images are cropped to the centre, never stretched, and photos are turned upright. A failed download is tried again on the next run.
3. `npm run collage` draws the collage from `images/` with Python/Pillow, so it works offline (good for a `random-meet` from cron on a laptop).

Everything generated (`projects/`) and `projects.json` are ignored by git. `npm run reset` takes a project back to a fresh start.

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
| `Nothing fetched for ... yet` | Run `npm run full` first (with the same `-p`). |
| `Unknown project` | Check the name with `npm run setup` (it lists your projects), or add the project there. |
| `... is a project in spotify and local` | Two sources have a project with that name: use `-p source/name`. |
| `Skipped photo.heic` | HEIC needs pillow-heif: run `npm run setup:python`. Other skipped files are broken or not images, they're skipped quietly from then on. |
| `No new albums in the playlist` | Not an error: every album in the playlist is already in the grid. Add one to the playlist for tomorrow's `daily-new`. |
| `... already has 200 albums` / `images` | You've reached `maxItems`. Raise it in `settings.json` or for the project in `projects.json`, or `npm run reset` to start over. |
| `The playlist got shorter - checking it from the start` | Not an error: songs were removed, so `full` / `daily-new` look through the playlist again. Albums you already have are skipped. |
| `npm error Unknown cli flag` | Put `--` before the options: `npm run collage -- --cover`. |
| `Google Meet isn't set up` | `random-meet` needs `npm run setup:meet` first (and again after a Chrome update or a new upload). |

## Testing

```sh
npm test
```

Runs the Node tests (`node:test`) and the Python tests (`unittest`) in a couple of seconds. They need no network, no Spotify account and no `.env`: Spotify responses come from the fixtures in `test/fixtures/`, and the image tests draw solid-colour images in a temp folder.

## Spotify content

Album covers and names come from Spotify and belong to Spotify and the rights holders. The generated images are for your own use: don't commit them to your repository or redistribute them, and follow the [Spotify Developer Terms](https://developer.spotify.com/terms).

## License

[ISC](LICENSE)
