const { test } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const { getConfig } = require("../scripts/upload");

const base = { SFTP_HOST: "example.com", SFTP_USER: "me" };

test("getConfig returns null when sftp isn't configured", () => {
    assert.equal(getConfig({}), null);
    assert.equal(getConfig({ SFTP_HOST: "", SFTP_PORT: "" }), null);
});

test("getConfig lists what's missing in a half-done setup", () => {
    assert.throws(() => getConfig({ SFTP_HOST: "example.com" }), /SFTP_USER, SFTP_PASSWORD or SFTP_PRIVATE_KEY_PATH/);
    assert.throws(() => getConfig(base), /missing: SFTP_PASSWORD or SFTP_PRIVATE_KEY_PATH$/);
});

test("getConfig uses a password", () => {
    assert.deepEqual(getConfig({ ...base, SFTP_PASSWORD: "pw" }), {
        host: "example.com", port: 22, username: "me", password: "pw", remotePath: "",
    });
});

test("getConfig prefers a private key and expands ~", () => {
    const config = getConfig({ ...base, SFTP_PASSWORD: "pw", SFTP_PRIVATE_KEY_PATH: "~/.ssh/id_ed25519", SFTP_PASSPHRASE: "pp" });
    assert.equal(config.privateKeyPath, path.join(os.homedir(), ".ssh/id_ed25519"));
    assert.equal(config.passphrase, "pp");
    assert.equal(config.password, undefined);
});

test("getConfig validates the port", () => {
    assert.equal(getConfig({ ...base, SFTP_PASSWORD: "pw", SFTP_PORT: "2222" }).port, 2222);
    for (const port of ["abc", "0", "70000", "22.5"]) {
        assert.throws(() => getConfig({ ...base, SFTP_PASSWORD: "pw", SFTP_PORT: port }), /SFTP_PORT/);
    }
});

test("getConfig makes the remote path relative", () => {
    assert.equal(getConfig({ ...base, SFTP_PASSWORD: "pw", SFTP_SPECIFIC_PATH: "/public_html/albums" }).remotePath, "public_html/albums");
    assert.equal(getConfig({ ...base, SFTP_PASSWORD: "pw", SFTP_SPECIFIC_PATH: "public_html" }).remotePath, "public_html");
});
