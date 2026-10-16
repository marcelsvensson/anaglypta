const { test } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const { planCopies, expandHome } = require("../scripts/meet");

// a fake file system: two blob files Chrome created, and a folder
const fakeFs = { isFile: (file) => ["/meet/1/c", "/meet/1/d"].includes(file) };
const env = { GOOGLE_MEET_BLOB_PATH: "/meet/1/c", GOOGLE_MEET_BLOB_PATH_THUMBNAIL: "/meet/1/d" };

test("planCopies skips when Google Meet isn't configured", () => {
    assert.equal(planCopies({}, fakeFs), null);
    assert.equal(planCopies({ GOOGLE_MEET_BLOB_PATH: "", GOOGLE_MEET_BLOB_PATH_THUMBNAIL: "" }, fakeFs), null);
});

test("planCopies wants both blob files", () => {
    assert.throws(() => planCopies({ GOOGLE_MEET_BLOB_PATH: "/meet/1/c" }, fakeFs), /missing: GOOGLE_MEET_BLOB_PATH_THUMBNAIL/);
});

test("planCopies overwrites exactly the two blobs", () => {
    const copies = planCopies(env, fakeFs);
    assert.deepEqual(copies.map(({ source }) => path.basename(source)), ["collage.jpg", "collage_thumbnail.jpg"]);
    assert.deepEqual(copies.map(({ target }) => target), ["/meet/1/c", "/meet/1/d"]);
});

test("planCopies refuses folders and files that don't exist", () => {
    assert.throws(() => planCopies({ ...env, GOOGLE_MEET_BLOB_PATH: "/meet/1" }, fakeFs), /GOOGLE_MEET_BLOB_PATH isn't an existing file/);
    assert.throws(() => planCopies({ ...env, GOOGLE_MEET_BLOB_PATH_THUMBNAIL: "/meet/1/e" }, fakeFs), /THUMBNAIL isn't an existing file/);
});

test("expandHome expands ~", () => {
    assert.equal(expandHome("~/Library/x"), path.join(os.homedir(), "Library/x"));
    assert.equal(expandHome("/abs/~x"), "/abs/~x");
});
