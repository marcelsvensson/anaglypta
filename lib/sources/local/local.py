"""The local source: images from a folder on this computer -> projects/local/<name>/items.json + square copies in images/.

Reads the images in the project's folder - only that folder, never its subfolders (a path like ~ would otherwise
walk your whole home folder) - hidden files skipped. The project holds the newest maxItems images, by the file's date
(so nothing has to be opened to pick them): new ones are added (--limit n: at most n per run), the oldest are pushed
out to make room. Images that are gone (or changed, they come back as new) are dropped too. The square copies are made
right away, so broken files show up now and not in the collage - once: state.unreadable remembers them until they
change.

--count <folder>: prints {"images": n, "others": n} for `npm run setup`.
"""
import argparse
import hashlib
import json
import sys
from datetime import date, datetime
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))

from common import HEIF, Progress, add_project_args, ensure_image, image_path, load_project, read_data, warn, write_data  # noqa: E402

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif"}
EXIF_IFD = 0x8769
DATE_TAKEN = 0x9003  # DateTimeOriginal, in the EXIF IFD
DATE_TIME = 0x0132  # DateTime, when the file was last edited by a camera or app


def scan(folder):
    """(image files sorted by path, number of other files) directly in folder: no subfolders, no hidden files."""
    images, others = [], 0
    for path in Path(folder).iterdir():
        if path.name.startswith(".") or not path.is_file():
            continue
        if path.suffix.lower() in EXTENSIONS:
            images.append(path)
        else:
            others += 1
    return sorted(images), others


def item_id(path, stat=None):
    """The same file gives the same id, an edited (or replaced) file a new one, so its square copy is made again."""
    stat = stat or path.stat()
    return hashlib.sha1(f"{path.resolve()}\0{stat.st_size}\0{stat.st_mtime_ns}".encode()).hexdigest()[:16]


def date_taken(image, path):
    """When the photo was taken (EXIF), else the file's modification time, as 2026-01-31T12:00:00."""
    exif = image.getexif()
    value = exif.get_ifd(EXIF_IFD).get(DATE_TAKEN) or exif.get(DATE_TIME)
    try:
        return datetime.strptime(str(value).strip("\0 "), "%Y:%m:%d %H:%M:%S").isoformat()
    except ValueError:
        return datetime.fromtimestamp(path.stat().st_mtime).replace(microsecond=0).isoformat()


def fetch(project, limit=None):
    """Brings items.json in line with the folder, returns (added, dropped, skipped) counts."""
    folder = project.get("path")
    if not folder:
        sys.exit(f"❌ local.{project['name']}.path is missing in projects.json")
    folder = Path(folder)
    if not folder.is_dir():
        sys.exit(f"❌ {folder} isn't a folder (local.{project['name']}.path in projects.json)")

    data = read_data(project)
    files, others = scan(folder)
    stats = {path: path.stat() for path in files}
    ids = {path: item_id(path, stats[path]) for path in files}
    newest_first = sorted(files, key=lambda path: (stats[path].st_mtime_ns, path.name), reverse=True)

    known = {item["id"] for item in data["items"]}
    # files that couldn't be read before are skipped quietly (an edited file gets a new id and is tried again)
    unreadable = set(ids.values()) & set(data["state"].get("unreadable", []))
    max_items = project.get("maxItems", 200)

    def fits(kept, new):
        return kept + new < max_items and (not limit or new < limit)

    # the newest max_items files make the project, at most `limit` of them new this run. First only counted (for the
    # progress line), then walked again making the copies - a file that fails frees its place for the next one
    kept_count = new_count = 0
    for path in newest_first:
        if kept_count + new_count >= max_items:
            break
        if ids[path] in known:
            kept_count += 1
        elif ids[path] not in unreadable and fits(kept_count, new_count):
            new_count += 1

    if len(files) > max_items and new_count:
        print(f"{folder} has {len(files)} images, {project['id']} holds the newest {max_items} (maxItems)")

    keep, new_items = set(), []
    skipped = 0
    handled = Progress(new_count)
    for path in newest_first:
        if len(keep) + len(new_items) >= max_items:
            break
        id_ = ids[path]
        if id_ in known:
            keep.add(id_)
            continue
        if id_ in unreadable or not fits(len(keep), len(new_items)):
            continue
        handled.step()
        handled.total = max(handled.total, handled.count)
        try:
            with Image.open(path) as image:
                taken = date_taken(image, path)
        except Exception as error:  # not an image after all, or a format Pillow can't read
            hint = " (HEIC needs `npm run setup:python`)" if not HEIF and path.suffix.lower() in (".heic", ".heif") else ""
            warn(f"Skipped {path.name}: {error}{hint}")
            taken = None
        item = {"id": id_, "title": path.stem, "subtitle": folder.name, "addedAt": taken, "source": str(path)}
        # ensure_image warns itself when the copy can't be made
        if taken is None or ensure_image(project, item) is None:
            unreadable.add(id_)
            skipped += 1
            continue
        new_items.append(item)
    handled.done()
    # the oldest of the new ones first, so the newest is the last item (the centrepiece of --latest)
    added = new_items[::-1]
    if len(added) == 1:
        print(f"Added {Path(added[0]['source']).name}")

    present = set(ids.values())
    gone = [item for item in data["items"] if item["id"] not in present]
    pushed = [item for item in data["items"] if item["id"] in present and item["id"] not in keep]
    for item in gone + pushed:
        image_path(project, item).unlink(missing_ok=True)

    data["items"] = [item for item in data["items"] if item["id"] in keep] + added
    data["state"] = {**data["state"], "path": str(folder), "unreadable": sorted(unreadable)}
    if added:
        data["state"]["lastFetched"] = date.today().isoformat()
    write_data(project, data)

    if gone:
        print(f"Dropped {len(gone)} image(s) that are gone from {folder} (or changed, they're added again)")
    if pushed:
        print(f"Pushed out the {len(pushed)} oldest image(s) to make room for newer ones (maxItems)")
    if others:
        print(f"Ignored {others} file(s) that aren't images")
    if not added:
        print(f"No new images in {folder}")
    print(f"{len(added)} new image(s), {len(data['items'])} images in {project['id']}")
    return len(added), len(gone) + len(pushed), skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_project_args(parser)
    parser.add_argument("--limit", type=int, help="the most new images one run adds")
    parser.add_argument("--count", metavar="FOLDER", help="only count the images in FOLDER (for npm run setup)")
    args = parser.parse_args()

    if args.count:
        folder = Path(args.count).expanduser()
        if not folder.is_dir():
            sys.exit(f"❌ {folder} isn't a folder")
        images, others = scan(folder)
        print(json.dumps({"images": len(images), "others": others}))
        return

    if args.limit is not None and args.limit < 1:
        sys.exit("❌ --limit needs a whole number of images, like --limit 1")
    project = load_project(args.project_json)
    if project["source"] != "local":
        sys.exit(f"❌ {project['id']} isn't a local project")
    fetch(project, args.limit)


if __name__ == "__main__":
    main()
