"""Shared helpers for collage.py and the sources: projects (the twin of scripts/project.js) and the square image cache."""
import io
import json
import re
import sys
import time
import urllib.request
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


def load_project(source=None, project=None):
    """The project from settings.json + projects.json, exits with the reason when it's unknown."""
    try:
        return resolve_project(read_json(ROOT / "settings.json", {}), read_json(ROOT / "projects.json", {}), source, project, ROOT)
    except ValueError as error:
        sys.exit(f"❌ {error}")


def add_project_args(parser):
    parser.add_argument("-s", "--source", help="the image source (spotify, local), default: the default project's")
    parser.add_argument("-p", "--project", help="the project name (or source/name), default: the default project")


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


def square(image, size):
    """Turned upright (EXIF), RGB, cropped to a centred square and resized to size x size - never stretched."""
    image = ImageOps.exif_transpose(image)
    return ImageOps.fit(image.convert("RGB"), (size, size), Image.Resampling.LANCZOS)


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
    """Path to the item's square image, made first if needed. None if the source can't be read."""
    path = image_path(project, item)
    if path.exists():
        return path

    source = item.get("source")
    if not source:
        warn(f"No image for {label(item)}")
        return None
    try:
        with open_source(source, retries) as image:
            squared = square(image, project.get("imageSize", 640))
    except Exception as error:  # network errors and broken or unknown images alike
        hint = " (HEIC needs `npm run setup:python`)" if not HEIF and source.lower().endswith((".heic", ".heif")) else ""
        warn(f"Could not read the image for {label(item)}: {error}{hint}")
        return None

    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(".part")
    squared.save(part, "JPEG", quality=90)
    part.replace(path)
    return path


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
