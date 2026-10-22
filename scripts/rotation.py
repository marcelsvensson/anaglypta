"""The living collage (video.py): which tile changes when, and to what. Pure and seeded, so it's tested without images.

Every step (10 s in the video) one tile changes to an item that isn't on screen; every centre_every-th step (60 s) the
centrepiece too. An item that leaves cools down for `cooldown` steps before it can come back, unless there's nothing
else left: then the one that has waited longest comes back. The next tile is random, but never one of the last few that
changed or a neighbour of them, so the changes wander over the grid.
"""
from collections import deque


def neighbours(cell):
    """The cell and the 8 around it."""
    col, row = cell
    return {(col + dc, row + dr) for dc in (-1, 0, 1) for dr in (-1, 0, 1)}


def rotate(tiles, centre, items, steps, rng, centre_every=6, cooldown=30, spread=3):
    """tiles = {cell: item id} on screen, centre = the centrepiece's item id (None: no centrepiece), items = every item id
    that may be shown. Yields one list of changes per step: ("tile", cell, old id, new id) and ("centre", None, old id, new id)."""
    tiles = dict(tiles)
    on_screen = set(tiles.values()) | ({centre} if centre is not None else set())
    pool = [item for item in items if item not in on_screen]
    cooling = deque()  # (item, the step it's free again), oldest first
    recent = deque(maxlen=spread)

    def take():
        if pool:
            return pool.pop(rng.randrange(len(pool)))
        return cooling.popleft()[0] if cooling else None

    def next_cell():
        blocked = set().union(*(neighbours(cell) for cell in recent)) if recent else set()
        for allowed in ([c for c in tiles if c not in blocked], [c for c in tiles if c not in recent], list(tiles)):
            if allowed:
                return rng.choice(sorted(allowed))
        return None

    for step in range(1, steps + 1):
        while cooling and cooling[0][1] <= step:
            pool.append(cooling.popleft()[0])
        changes = []
        cell = next_cell()
        new = take() if cell is not None else None
        if new is not None:
            old, tiles[cell] = tiles[cell], new
            cooling.append((old, step + cooldown))
            recent.append(cell)
            changes.append(("tile", cell, old, new))
        if centre is not None and step % centre_every == 0:
            new = take()
            if new is not None:
                old, centre = centre, new
                cooling.append((old, step + cooldown))
                changes.append(("centre", None, old, new))
        yield changes
