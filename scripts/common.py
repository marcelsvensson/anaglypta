"""Shared helpers for collage.py and the sources: projects (the twin of scripts/project.js) and the square image cache."""
import io
import json
import random
import re
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps

try:  # HEIC/HEIF photos (iPhone), installed by `npm run setup:python`
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIF = True
except ImportError:
    HEIF = False

ROOT = Path(__file__).resolve().parent.parent
USER_AGENT = "anaglypta/1.0"
NAME = re.compile(r"^[a-z0-9][a-z0-9-]*$")
MIX = "mix"  # -p mix: a random project (allowMix isn't false) instead of a named one, a reserved name
MIX_COMMANDS = "collage, random-meet, daily-new and meet"
PLAYLIST = re.compile(r"playlist[/:]([A-Za-z0-9]{22})(?![A-Za-z0-9])")
TMDB_LIST = re.compile(r"list/(\d+)")


class Progress:
    """"12 / 200 images handled" on one line that updates itself, in a terminal. Elsewhere (cron logs) only the last
    count is written, by done()."""

    showing = None  # the Progress whose line is on screen, warn() clears it first

    def __init__(self, total, label="images handled", stream=None):
        self.total, self.label, self.count = total, label, 0
        self.stream = stream or sys.stdout
        self.live = self.stream.isatty()

    def text(self):
        return f"{self.count} / {self.total} {self.label}"

    def step(self):
        self.count += 1
        if self.live:
            self.stream.write(f"\r{self.text()}\033[K")
            self.stream.flush()
            Progress.showing = self

    def clear(self):
        if self.live:
            self.stream.write("\r\033[K")
            self.stream.flush()

    def done(self):
        """Leaves the final count on its own line (nothing when there was nothing to do)."""
        if Progress.showing is self:
            Progress.showing = None
        if self.count:
            if self.live:
                self.stream.write(f"\r{self.text()}\033[K\n")
            else:
                self.stream.write(f"{self.text()}\n")
            self.stream.flush()


def warn(message):
    if Progress.showing:
        Progress.showing.clear()  # the warning gets its own line, the count comes back with the next step
    sys.stdout.flush()  # keep warnings in order with the regular output
    print(f"⚠️  {message}", file=sys.stderr)


def read_json(path, fallback):
    if not path.exists():
        return fallback
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


# --- projects, the same rules as scripts/project.js ---

def parse_playlist_id(text):
    text = str(text or "").strip()
    match = PLAYLIST.search(text) or re.fullmatch(r"([A-Za-z0-9]{22})", text)
    return match.group(1) if match else None


def parse_list_id(text):
    text = str(text or "").strip()
    match = TMDB_LIST.search(text) or re.fullmatch(r"(\d+)", text)
    return match.group(1) if match else None


def deep_merge(*layers):
    """Dicts merge key by key (collage.center too), anything else (numbers, lists like skip) is replaced."""
    merged = {}
    for layer in layers:
        for key, value in (layer or {}).items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = deep_merge(merged[key], value)
            else:
                merged[key] = value
    return merged


def split_id(project_id):
    """'spotify/album' -> ('spotify', 'album'), 'album' -> (None, 'album')"""
    first, separator, second = str(project_id or "").partition("/")
    return (first, second) if separator else (None, first or None)


def resolve_project(settings, projects, source=None, project=None, root=ROOT):
    """settings.json + projects.json + the --source/--project flags (both optional) -> the project, ValueError if unknown."""
    sources = list(settings.get("sources", {}))
    everything = [(s, name) for s in sources for name in projects.get(s, {})]
    add = "add one with `npm run setup`"

    if project == MIX:
        raise ValueError(f"-p {MIX} only works with {MIX_COMMANDS}")
    if project and "/" in project:
        split_source, project = split_id(project)
        if source and source != split_source:
            raise ValueError(f"--source {source} doesn't match --project {split_source}/{project}")
        source = split_source
    if source and source not in sources:
        raise ValueError(f"Unknown source \"{source}\" - the sources are: {', '.join(sources)}")

    if not project:
        fallback_source, fallback_project = split_id(projects.get("default") or settings.get("default"))
        if not source or source == fallback_source:
            source, project = fallback_source, fallback_project
        else:
            project = next(iter(projects.get(source, {})), None)
            if not project:
                raise ValueError(f"No {source} projects in projects.json - {add}")
    elif not source:
        matches = [s for s, name in everything if name == project]
        if len(matches) > 1:
            raise ValueError(f"\"{project}\" is a project in {' and '.join(matches)} - pick one with --source")
        source = matches[0] if matches else None

    entry = projects.get(source, {}).get(project) if source else None
    if entry is None:
        known = ", ".join(f"{s}/{name}" for s, name in everything) or "none yet"
        raise ValueError(f"Unknown project \"{source + '/' if source else ''}{project}\" - the projects in projects.json are: {known} ({add})")
    if not NAME.match(project):
        raise ValueError(f"Project name \"{project}\" can only have lowercase letters, digits and - (it's a folder name)")

    merged = deep_merge(settings.get("defaults"), settings["sources"][source], entry)
    folder = f"projects/{source}/{project}"
    resolved = {**merged, "source": source, "name": project, "id": f"{source}/{project}", "folder": folder, "dir": Path(root) / folder}
    if source == "spotify":
        resolved["playlistId"] = parse_playlist_id(merged.get("playlist"))
    if source == "tmdb":
        resolved["listId"] = parse_list_id(merged.get("list"))
    if source == "local" and merged.get("path"):
        resolved["path"] = str(Path(merged["path"]).expanduser())
    return resolved


def mix_candidates(settings, projects, source=None):
    """The projects -p mix picks from (all of them, or the source's ones), unless they set allowMix: false. Sorted ids."""
    candidates = []
    for s in settings.get("sources", {}):
        if source and s != source:
            continue
        for name in projects.get(s, {}):
            try:
                resolved = resolve_project(settings, projects, s, name)
            except ValueError:
                continue  # a broken entry (a bad name) is left out, naming it with -p still explains why
            if resolved.get("allowMix") is not False:
                candidates.append(resolved["id"])
    return sorted(candidates)


def pick_mix(candidates, state=None, rand=random.random):
    """Cycles through the candidates in random order, each once per round. state = { used: [ids this round], last }.
    A new round never starts with the one the last round ended on (unless it's the only one). (id, new state), or None."""
    state = state or {}
    used = [c for c in state.get("used", []) if c in candidates]
    pool = [c for c in candidates if c not in used]
    if not pool:
        used = []
        pool = [c for c in candidates if c != state.get("last")] if len(candidates) > 1 else candidates
    if not pool:
        return None
    chosen = pool[int(rand() * len(pool))]
    return chosen, {"used": [*used, chosen], "last": chosen}


def pick_mix_project(settings, projects, source=None, root=ROOT, rand=random.random):
    """-p mix: the next project of the round that has items (one without would need fetching first), remembered in projects/.mix.json."""
    if source and source not in settings.get("sources", {}):
        raise ValueError(f"Unknown source \"{source}\" - the sources are: {', '.join(settings.get('sources', {}))}")
    candidates = mix_candidates(settings, projects, source)
    ready = [c for c in candidates if read_data(resolve_project(settings, projects, project=c, root=root))["items"]]
    empty = [c for c in candidates if c not in ready]
    if empty:
        print(f"Mix: leaving out {', '.join(empty)} (nothing fetched yet, run `npm run full -- -p <project>`)")
    state = Path(root) / "projects" / ".mix.json"
    chosen, new_state = pick_mix(ready, read_json(state, {}), rand) or (None, None)
    if not chosen:
        raise ValueError(f"No {source + ' ' if source else ''}projects in the mix - they all have allowMix: false or nothing fetched yet")
    write_json(state, new_state)
    print(f"Mix: {chosen}")
    return resolve_project(settings, projects, project=chosen, root=root)


def load_project(source=None, project=None, mix=False):
    """The project from settings.json + projects.json, exits with the reason when it's unknown. mix: -p mix picks one."""
    settings, projects = read_json(ROOT / "settings.json", {}), read_json(ROOT / "projects.json", {})
    try:
        if mix and project == MIX:
            return pick_mix_project(settings, projects, source, ROOT)
        return resolve_project(settings, projects, source, project, ROOT)
    except ValueError as error:
        sys.exit(f"❌ {error}")


def add_project_args(parser):
    parser.add_argument("-s", "--source", help="the image source (spotify, local), default: the default project's")
    parser.add_argument("-p", "--project", help="the project name (or source/name), default: the default project. collage, random-meet, daily-new and meet also take mix: a random project")


def items_path(project):
    return project["dir"] / "items.json"


def read_data(project):
    """items.json: { source, project, state, items }, empty when the project hasn't been fetched yet."""
    data = read_json(items_path(project), {})
    return {**data, "source": project["source"], "project": project["name"], "state": data.get("state", {}), "items": data.get("items", [])}


def write_data(project, data):
    write_json(items_path(project), data)


def read_items(project):
    """The project's items, oldest first, each id once (the first one wins)."""
    items = []
    seen = set()
    for item in read_data(project)["items"]:
        if item.get("id") and item["id"] not in seen:
            seen.add(item["id"])
            items.append(item)
    return items


# --- the square image cache: projects/<source>/<name>/images/<id>.jpg ---

def image_path(project, item):
    return project["dir"] / "images" / f"{item['id']}.jpg"


def label(item):
    return item.get("title") or item["id"]


def parse_aspect(text):
    """'2:3' -> (2, 3), also 2x3 and 2/3. ValueError for anything else."""
    match = re.fullmatch(r"\s*(\d+)\s*[:x/]\s*(\d+)\s*", str(text or "1:1"))
    if not match or not int(match[1]) or not int(match[2]):
        raise ValueError(f'aspect "{text}" should look like 1:1, 2:3 or 16:9')
    return int(match[1]), int(match[2])


def image_dimensions(project):
    """The size of the project's cached copies: its aspect ratio, imageSize on the long side."""
    aspect_width, aspect_height = parse_aspect(project.get("aspect"))
    size = project.get("imageSize", 640)
    if aspect_width >= aspect_height:
        return size, round(size * aspect_height / aspect_width)
    return round(size * aspect_width / aspect_height), size


def crop(image, dimensions):
    """Turned upright (EXIF), RGB, cropped around the centre to the ratio of dimensions and resized - never stretched."""
    image = ImageOps.exif_transpose(image)
    return ImageOps.fit(image.convert("RGB"), dimensions, Image.Resampling.LANCZOS)


def image_ready(project, item):
    """The cached copy exists with the project's current shape and size (aspect and imageSize can change)."""
    path = image_path(project, item)
    if not path.exists():
        return False
    try:
        with Image.open(path) as cached:
            return cached.size == image_dimensions(project)
    except Exception:  # a broken copy is made again
        return False


def download(url, retries=3):
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=15) as response:
                return response.read()
        except Exception:  # network and http errors alike
            if attempt == retries:
                raise
            time.sleep(attempt)


def open_source(source, retries=3):
    """The item's image: downloaded when source is a url, else read from the file."""
    if source.startswith(("http://", "https://")):
        image = Image.open(io.BytesIO(download(source, retries)))
    else:
        image = Image.open(source)
    image.load()
    return image


def ensure_image(project, item, retries=3):
    """Path to the item's cached copy, made first if needed (or when the project's shape or size changed - the old copy
    is used when that fails). None if the source can't be read."""
    path = image_path(project, item)
    if image_ready(project, item):
        return path
    fallback = path if path.exists() else None
    if fallback:
        retries = 1  # an old copy can stand in, no need to wait for retries (offline after an aspect change)

    source = item.get("source")
    if not source:
        warn(f"No image for {label(item)}")
        return fallback
    try:
        with open_source(source, retries) as image:
            cropped = crop(image, image_dimensions(project))
    except Exception as error:  # network errors and broken or unknown images alike
        hint = " (HEIC needs `npm run setup:python`)" if not HEIF and source.lower().endswith((".heic", ".heif")) else ""
        warn(f"Could not read the image for {label(item)}: {error}{hint}")
        return fallback

    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(".part")
    cropped.save(part, "JPEG", quality=90)
    part.replace(path)
    return path


# --- cache limits: sources with "maxCacheDays" (tmdb: 180, its terms allow 6 months) ---

REFRESH_BEFORE_DAYS = 30  # full/daily-new renew images this long before they expire, a heads-up is shown from then on


def days_since(when, now):
    return (now - when).total_seconds() / 86400


def expire_cache(project, now=None):
    """Removes what's older than the source allows: items whose data wasn't confirmed by a fetch (fetchedAt) and images
    downloaded (file date) more than maxCacheDays ago. Returns {"items", "images", "soon"} counts, soon = images that
    expire within REFRESH_BEFORE_DAYS. Does nothing for sources without a limit."""
    counts = {"items": 0, "images": 0, "soon": 0}
    max_days = project.get("maxCacheDays")
    if not max_days:
        return counts
    now = now or datetime.now()
    data = read_data(project)

    def expired(item):
        try:
            return days_since(datetime.fromisoformat(item.get("fetchedAt") or item.get("addedAt") or ""), now) > max_days
        except ValueError:
            return False

    kept = []
    for item in data["items"]:
        if expired(item):
            image_path(project, item).unlink(missing_ok=True)
            counts["items"] += 1
            continue
        kept.append(item)
        path = image_path(project, item)
        if path.exists():
            age = days_since(datetime.fromtimestamp(path.stat().st_mtime), now)
            if age > max_days:
                path.unlink()
                counts["images"] += 1
            elif age > max_days - REFRESH_BEFORE_DAYS:
                counts["soon"] += 1
    if counts["items"]:
        data["items"] = kept
        write_data(project, data)
    return counts


def report_expired(project, counts):
    """The warnings for expire_cache's counts."""
    days = project.get("maxCacheDays")
    full = f"`npm run full -- -p {project['id']}`"
    if counts["items"]:
        warn(f"{counts['items']} item(s) of {project['id']} were last fetched over {days} days ago and were removed "
             f"(the source's terms) - {full} fetches them again")
    if counts["images"]:
        warn(f"{counts['images']} image(s) of {project['id']} were older than {days} days and were removed "
             f"(the source's terms) - {full} downloads them again")
    if counts["soon"]:
        print(f"Heads-up: {counts['soon']} image(s) of {project['id']} expire within {REFRESH_BEFORE_DAYS} days - "
              f"{full} renews them")


def load_tile(path, width, height, scale):
    """The image cropped to width x height, then blown up x scale without smoothing (pixel art)."""
    with Image.open(path) as image:
        small = ImageOps.fit(image.convert("RGB"), (width, height), Image.Resampling.LANCZOS)
    return small.resize((width * scale, height * scale), Image.Resampling.NEAREST)


def canvas_size(col, row, cell_width, cell_height, gap):
    return (col * cell_width + (col + 1) * gap, row * cell_height + (row + 1) * gap)


def cell_xy(col_index, row_index, cell_width, cell_height, gap):
    """Top left pixel of a grid cell."""
    return (gap + (cell_width + gap) * col_index, gap + (cell_height + gap) * row_index)
