"""Makes the cached copy (cropped to the project's aspect) of every item in a project that doesn't have one yet (fetch.js runs it after every fetch), so
collage.py doesn't need the network later. Failed downloads are tried again on the next run.

fetch.js runs it with the project it resolved: runPython("scripts/cache.py", project) in scripts/python.js.
"""
import argparse

from common import Progress, add_project_args, ensure_image, image_ready, load_project, read_items, warn

# this many failures in a row before anything worked: probably offline, the rest would only fail slowly too
GIVE_UP_AFTER = 3


def cache(project):
    """Returns (made, failed, missing) - missing counts the items it didn't get to after giving up."""
    # missing, or made for another aspect or imageSize
    missing = [item for item in read_items(project) if not image_ready(project, item)]
    progress = Progress(len(missing))
    made = failed = 0
    try:
        for i, item in enumerate(missing):
            progress.step()
            if ensure_image(project, item):
                made += 1
                continue
            failed += 1
            if not made and failed >= GIVE_UP_AFTER:
                return made, failed, len(missing) - i - 1
        return made, failed, 0
    finally:
        progress.done()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_project_args(parser)
    args = parser.parse_args()

    project = load_project(args.project_json)
    made, failed, skipped = cache(project)
    if skipped:
        warn(f"Gave up after {failed} failed images in a row (offline?) - {skipped + failed} are fetched on the next run")
    elif failed:
        warn(f"{failed} image(s) couldn't be made - tried again on the next run")
    if made:
        print(f"Saved {made} image(s) to {project['folder']}/images")


if __name__ == "__main__":
    main()
