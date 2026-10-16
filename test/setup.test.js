const { test } = require("node:test");
const assert = require("node:assert/strict");

const { parsePlaylistId, isClientId, parseEnv, setEnvValue, pickBlobs } = require("../scripts/setup");

const ID = "37i9dQZF1DXcBWIGoYBM5M";

test("parsePlaylistId accepts links, uris and bare ids", () => {
    assert.equal(parsePlaylistId(`https://open.spotify.com/playlist/${ID}?si=abc123`), ID);
    assert.equal(parsePlaylistId(`https://open.spotify.com/intl-sv/playlist/${ID}`), ID);
    assert.equal(parsePlaylistId(`spotify:playlist:${ID}`), ID);
    assert.equal(parsePlaylistId(`  ${ID}\n`), ID);
});

test("parsePlaylistId rejects everything else", () => {
    for (const input of [`https://open.spotify.com/album/${ID}`, "hello", `${ID}X`, "", null]) {
        assert.equal(parsePlaylistId(input), null, String(input));
    }
});

test("isClientId wants 32 hex characters", () => {
    assert.equal(isClientId("0123456789abcdef0123456789ABCDEF"), true);
    assert.equal(isClientId("0123456789abcdef"), false);
    assert.equal(isClientId("g123456789abcdef0123456789abcdef"), false);
});

test("parseEnv reads KEY=value lines and skips comments", () => {
    const text = "# comment\nCLIENT_ID=\nPLAYLIST_ID=\"quoted\"\n  SPACED = value  \nnot a line\n";
    assert.deepEqual(parseEnv(text), { CLIENT_ID: "", PLAYLIST_ID: "quoted", SPACED: "value" });
});

test("setEnvValue replaces a line in place and keeps the rest", () => {
    const text = "# comment\nCLIENT_ID=\n# other\nPLAYLIST_ID=\n";
    assert.equal(setEnvValue(text, "CLIENT_ID", "abc"), "# comment\nCLIENT_ID=abc\n# other\nPLAYLIST_ID=\n");
});

test("setEnvValue only matches the exact key and appends missing keys", () => {
    assert.equal(setEnvValue("SFTP_HOST=x\nHOST=y\n", "HOST", "z"), "SFTP_HOST=x\nHOST=z\n");
    assert.equal(setEnvValue("A=1", "B", "2"), "A=1\nB=2\n");
});

test("pickBlobs finds the uploaded image and thumbnail among the files changed since the upload started", () => {
    const files = [
        { path: "/old/a", size: 900000, mtimeMs: 100 },
        { path: "/new/c", size: 450000, mtimeMs: 2000 },
        { path: "/new/d", size: 3000, mtimeMs: 2001 },
    ];
    assert.deepEqual(pickBlobs(files, 1000), { image: "/new/c", thumbnail: "/new/d", count: 2 });
});

test("pickBlobs needs two new files", () => {
    assert.equal(pickBlobs([{ path: "/new/c", size: 1, mtimeMs: 2000 }, { path: "/old/a", size: 1, mtimeMs: 100 }], 1000), null);
    assert.equal(pickBlobs([], 1000), null);
});
