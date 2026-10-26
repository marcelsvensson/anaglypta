# Reference

The details behind the [README](../README.md): every setting, how each source behaves, and what to do when something goes wrong.

## `.env`: credentials

Created by `npm run setup` from [`.example.env`](../.example.env). Never commit it.

| Variable | | What |
|---|---|---|
| `CLIENT_ID` | Spotify | Your Spotify app's Client ID |
| `TMDB_TOKEN` | TMDb | Your TMDb API Read Access Token |
| `STEAM_API_KEY` | Steam | Your Steam Web API key (it reads any profile whose Game details are public) |
| `CLIENT_SECRET` | optional | Only for Spotify apps created before 2026 (instead of `npm run auth`) |
| `SPOTIFY_MARKET` | optional | Country code such as `SE`, for track availability |
| `SPOTIFY_AUTH_PORT` | optional | Port for the Spotify login, default `8888` |
| `GOOGLE_MEET_BLOB_PATH` | optional | The Chrome file of your Google Meet background, see [below](#google-meet-by-hand) |

## Settings

[`settings.json`](../settings.json) has the defaults for every project under `defaults`, and per source under `sources.<source>`. A project in `projects.json` overrides both. Objects such as `collage` merge key by key, lists are replaced.

| Setting | What |
|---|---|
| `default` | The default project when `projects.json` doesn't name one |
| `maxItems` | The most items a project holds (`200`). At the limit, `full` and `daily-new` add nothing more |
| `aspect` | The shape of the tiles: `1:1` (default), `2:3` (TMDb and Steam, posters), `3:2`, `16:9`, ... Images are cropped to it around the middle, never stretched |
| `imageSize` | The long side of the copies in `images/` (`640`, TMDb `960`, Steam `900`, big enough for the centrepiece). They're made again by themselves when this or `aspect` changes |
| `allowMix` | Whether `-p mix` may pick the project (`true`) |
| `collage.layout` | The grid: `COLSxROWS/CENTRE` like `13x9/5` (default), or `auto` (TMDb's and Steam's default): the largest grid the project's images fill, widescreen (shape 1.6 and up) unless that grid would be much smaller, with the biggest centrepiece up to 40% of the cells. `npm run collage -- --grid` lists them all. See [Layouts](../README.md#layouts) |
| `collage.canvasWidth` | About how wide the collage is, in pixels (`1412`). The tiles get their size from it |
| `collage.gap` | Pixels between the tiles (`8`) |
| `collage.scale` | How many times each tile is enlarged without smoothing, for a pixel look (`1`) |
| `collage.skip` | Cells to leave empty, as `[col, row]` |
| `sources.tmdb.maxCacheDays` | How long TMDb data and posters may be kept (`180`). TMDb's terms allow 6 months, so don't raise it |

When a project has more images than the layout has cells, `npm run collage` picks at random from all of them.

## Sources

- **Spotify**: one item per album. Every album appears once: if the playlist has several songs from the same album, the first one added wins. `full` remembers how far into the playlist it got, and when songs are removed it looks through the playlist again from the start (albums you already have are skipped). Your playlist must be one you own or collaborate on.
- **Local**: the image files directly in the folder (jpg, png, webp, gif, bmp, tiff, heic). Subfolders and hidden files are left alone. The project holds the newest `maxItems` images, by the file's date. New photos are added by the next `full`, pushing the oldest out. Deleted photos are dropped, and edited ones come back as new. A broken file shows up as a warning once and is skipped from then on.
- **TMDb**: one poster per movie or series in a public list, in the list's order. The project follows the list: what you add shows up on the next `full` or `daily-new`, and what you remove is dropped. Entries without a poster are picked up once they have one.
- **Steam**: one library capsule (the 600×900 portrait art, with the game's title) per game a profile owns, including free games it has played. Steam's API has no purchase dates, so the project is the first `maxItems` games by app id (roughly the order they came out on Steam), which keeps the pick stable. New games show up on the next `full`, and games that left the library are dropped. Games without library art on the store (some DLC, tools and old or delisted games) are skipped. `daily-new` isn't available for Steam: there's no "newest game" to reveal.

## How it works

1. `npm run full` (and `daily-new`) asks the project's source for new items and adds them to `projects/<source>/<name>/items.json`, together with how far it has come.
2. It then makes a copy of every new image in `images/`, cropped to the project's `aspect`. Spotify covers, TMDb posters and Steam capsules are downloaded for this, and photos are turned upright. A failed download is tried again on the next run.
3. `npm run collage` draws `collage.jpg` from `images/` with Python/Pillow. It works offline, which is good for a `random-meet` from cron on a laptop.

`npm run video` writes `collage.mp4`, a **living collage**: it starts from a random collage, then every 10 s one tile crossfades (1 s) to an image that isn't on screen, and every 60 s the centrepiece does too. An image that leaves sits out 5 minutes before it can come back (sooner when the project has few spare images), and the next tile is never one of the last few that changed or their neighbours. A centrepiece isn't repeated within a video while there are others to choose from, and the video always ends on the centrepiece it started with. With `--rewind` the tiles go back too: towards the end (the last minute for the defaults) up to 9 at a time fade back to their first image, in the order they first changed, so Meet's loop is seamless. Options: `--minutes`, `--every`, `--centre-every`, `--fade` (0 for a cut), `--cooldown` (seconds), `--rewind`. A project with no images to spare (exactly as many as the layout needs) has nothing to change to. `--slideshow` makes whole random collages one after another instead (`--segments 20 --seconds 30`). Frames are padded to 1920×1080 on black and encoded as H.264 with [PyAV](https://pypi.org/project/av/): 10 fps for the crossfades, but an unchanged frame costs next to nothing, so 10 minutes of posters stay around 4 MB (the Meet background holds 20 MB). Making one takes about a minute.

Node reads the settings, picks the project and hands it to the Python scripts, which only do the image work (Pillow, which also reads iPhone HEIC photos, and PyAV for the video).

Everything generated (`projects/`) and `projects.json` are ignored by git. `npm run clean` removes what can be rebuilt (every project's `images/`, and the padded Meet card in `tmp-upload/`), and `npm run reset` takes one project back to a fresh start.

## TMDb's 6-month limit

TMDb's terms allow caching for at most 6 months. Anaglypta keeps to that by itself, without an extra cron job:

- `full` and `daily-new` check the list again and download posters older than 150 days again, so a scheduled `daily-new` keeps everything fresh.
- `collage`, `random-meet` and `npm run setup` warn when posters are within 30 days of the limit. `collage` and `random-meet` remove what's past 6 months, with a warning. A TMDb project that's never fetched again slowly empties itself.
- `npm run reset`, or removing the project in setup, deletes everything at once.

## Google Meet by hand

`npm run setup:meet` normally finds the file. How it works, and how to do it yourself:

- The background is a **video**: Meet converts an uploaded image to a small webp, too small to put a collage in. The still collage goes in as a one-frame video (`collage_still.mp4`, made from `collage.jpg`).
- Chrome reads exactly as many bytes as were uploaded, and only while the file keeps its date. So the upload is the Anaglypta card (`assets/anaglypta.mp4`) padded to 20,000,000 bytes, and `meet` pads every collage and video to exactly that size and keeps the date. A video bigger than 20 MB doesn't fit (fewer `--segments` help).
- Meet's upload only offers images until you run this in Chrome's console, with Meet's background panel open:

  ```js
  document.querySelector('input[type="file"]').setAttribute('accept', 'image/jpeg, image/png, video/mp4');
  ```

- Then upload the padded card (setup writes it to `tmp-upload/anaglypta.mp4`, ignored by git) and point `GOOGLE_MEET_BLOB_PATH` at the 20,000,000-byte file under `~/Library/Application Support/Google/Chrome/Default/IndexedDB/https_meet.google.com_0.indexeddb.blob` (`ls -lt` helps). Leave it empty and the step is skipped. `npm run meet -- --dry-run` shows what would be copied.

The card comes from `node scripts/python.js scripts/brand.py`.

There's one Meet background for all projects: it gets the collage of the project you run the command for.

## Cron on macOS

- Nothing in the log at all usually means cron needs **Full Disk Access** (System Settings → Privacy & Security → Full Disk Access, add `/usr/sbin/cron`). That happens when the project lives in a protected folder such as Documents or Desktop.
- Cron doesn't run while the Mac sleeps, and doesn't catch up afterwards. A missed `daily-new` simply happens the next day.
- `couldn't find node/npm` in the log: install Node with asdf, nvm or Homebrew, or add a `PATH=...` line with your Node folder at the top of your crontab.
- Each run starts with a timestamped line in the log. `crontab -l` lists your jobs.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Not logged in to Spotify` | Run `npm run auth`. |
| `Spotify returned no tracks` / `403` on the playlist | You must own or collaborate on the playlist, and be logged in with `npm run auth`. |
| `403` on everything | The app owner needs Spotify Premium, and other users must be added under **User Management** in the app. |
| `invalid_grant` | The login expired or was revoked. Run `npm run auth` again. |
| `INVALID_CLIENT: Invalid redirect URI` | The Redirect URI in the app must be exactly `http://127.0.0.1:8888/callback` (or your `SPOTIFY_AUTH_PORT`). |
| `Port 8888 is busy` | Set `SPOTIFY_AUTH_PORT` in `.env` and add the matching Redirect URI to the app. |
| `Missing TMDB_TOKEN` / TMDb `401` | Add the API Read Access Token (not the API Key) to `.env`, or run `npm run setup`. |
| TMDb `404` on the list / `TMDb returned no list items` | The list has to be public, and the link or id in `projects.json` must be the list's. |
| `Missing STEAM_API_KEY` / Steam `401` or `403` | Add your Steam Web API key to `.env`, or run `npm run setup`. |
| `Steam returned no games - ... Game details have to be Public` | Steam answers a private library with nothing at all. Set the profile's Game details to Public (Edit Profile → Privacy Settings; Friends only isn't enough). |
| `No Steam profile called ...` | The `/id/<name>` in `projects.json` doesn't exist. Copy the link from the profile page again. |
| `Not implemented for Steam` | `daily-new` doesn't work on Steam projects. Use `random-meet` or `collage` instead. |
| `Python packages missing` | Run `npm run setup:python`. |
| `Nothing fetched for ... yet` | Run `npm run full` first (with the same `-p`). |
| `Unknown project` | Check the name with `npm run setup` (it lists your projects), or add the project there. |
| `... is a project in spotify and local` | Two sources have a project with that name: use `-p source/name`. |
| `PyAV is missing` | `npm run video` needs it: run `npm run setup:python` (Python 3.12+). |
| `-p mix only works with ...` | `mix` picks a project for `collage`, `video`, `random-meet`, `daily-new` and `meet` only. Name the project for the others. |
| `No projects in the mix` | Every project has `"allowMix": false` or nothing fetched yet. |
| `Skipped photo.heic` | HEIC needs pillow-heif: run `npm run setup:python`. Other skipped files are broken or not images. |
| `... already has 200 albums` / `images` | You've reached `maxItems`. Raise it in `settings.json` or for the project in `projects.json`, or `npm run reset` to start over. |
| `npm error Unknown cli flag` | Put `--` before the options: `npm run collage -- --cover`. |
| `Google Meet isn't set up` | `random-meet` needs `npm run setup:meet` first (and again after a Chrome update or a new upload). |
| `isn't the uploaded Anaglypta video card` | Your Meet background is from an older setup (an image upload): run `npm run setup:meet` again. |
| `doesn't fit: it's ... MB, more than the 20.0 MB` | The video is too big for the background: fewer `--segments`. |

Not errors: `No new albums in the playlist` (everything is already in), `Skipped ... without a poster on TMDb` (picked up once it has one), `The playlist got shorter - checking it from the start`.

## Development

`npm test` runs the Node tests (`node:test`) and the Python tests (`unittest`) in a couple of seconds. They need no network, no Spotify account and no `.env`: responses come from `test/fixtures/`, and the image tests draw solid-colour images in a temp folder.

### Adding a source

Every source is a folder in [`lib/sources/`](../lib/sources) with an adapter (`index.js`) that the rest of Anaglypta asks what it needs: how to read a project's entry in `projects.json`, how to fetch, what `npm run setup` should ask, and whether `daily-new` works for it. Nothing outside the folder names a source. To add one:

1. Make `lib/sources/<name>/` with an `index.js` (copy TMDb's or Steam's), and next to it `api.js` (the client), `fetch.js` (turns the API's answer into items) and `setup.js` (its keys and its project questions).
2. Add `sources.<name>` to `settings.json`, with the source's defaults (`aspect`, `imageSize`, `collage.layout`, and `maxCacheDays` if its terms limit caching).
3. Add its keys to `.example.env`, a row and a "Get a ... key" section to the README (plus any notice its terms ask for), and its details here.
4. Add `test/<name>.test.js` with fixtures, using made-up accounts. `test/sources.test.js` checks the adapter and that `settings.json` and `lib/sources/` agree.

Removing a source is the reverse: delete the folder and its `settings.json` entry.

The README's example images, and the living collage GIF at the top, are drawn by the real layout code from made-up colour tiles: run `node scripts/python.js docs/make-images.py` to make them again after changing the layouts or the drawing.
