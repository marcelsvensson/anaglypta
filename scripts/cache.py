"""Makes the square copy of every item in a project that doesn't have one yet (fetch.js runs it after every fetch), so
collage.py doesn't need the network later. Failed downloads are tried again on the next run.

usage: python scripts/cache.py [-s <source>] [-p <project>]
"""
import argparse

from common import add_project_args, ensure_image, image_path, load_project, read_items, warn

# this many failures in a row before anything worked: probably offline, the rest would only fail slowly too
GIVE_UP_AFTER = 3


def cache(project):
    """Returns (made, failed, missing) - missing counts the items it didn't get to after giving up."""
    missing = [item for item in read_items(project) if not image_path(project, item).exists()]
    made = failed = 0
    for i, item in enumerate(missing):
        if ensure_image(project, item):
            made += 1
            continue
        failed += 1
        if not made and failed >= GIVE_UP_AFTER:
            return made, failed, len(missing) - i - 1
    return made, failed, 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_project_args(parser)
    args = parser.parse_args()

    project = load_project(args.source, args.project)
    made, failed, skipped = cache(project)
    if skipped:
        warn(f"Gave up after {failed} failed images in a row (offline?) - {skipped + failed} are fetched on the next run")
    elif failed:
        warn(f"{failed} image(s) couldn't be made - tried again on the next run")
    if made:
        print(f"Saved {made} image(s) to {project['folder']}/images")


if __name__ == "__main__":
    main()
