"use strict";
// uploads the built site (_site) over sftp - skipped when no SFTP_* settings are present in .env

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SITE_DIR = path.join(__dirname, "..", "_site");
const FILES = ["index.html", "bitmap.jpg", "favicon.ico"];
const SFTP_KEYS = ["SFTP_HOST", "SFTP_USER", "SFTP_PASSWORD", "SFTP_PRIVATE_KEY_PATH", "SFTP_PORT", "SFTP_SPECIFIC_PATH"];

const expandHome = (file) => (file.startsWith("~") ? path.join(os.homedir(), file.slice(1)) : file);

// returns null when sftp isn't configured at all, throws on a half-done setup
const getConfig = (env) => {
    if (!SFTP_KEYS.some((key) => env[key])) {
        return null;
    }

    const missing = ["SFTP_HOST", "SFTP_USER"].filter((key) => !env[key]);
    if (!env.SFTP_PASSWORD && !env.SFTP_PRIVATE_KEY_PATH) {
        missing.push("SFTP_PASSWORD or SFTP_PRIVATE_KEY_PATH");
    }
    if (missing.length) {
        throw new Error(`Incomplete SFTP settings in .env, missing: ${missing.join(", ")}`);
    }

    const port = env.SFTP_PORT ? Number(env.SFTP_PORT) : 22;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`SFTP_PORT must be a number between 1 and 65535 (got "${env.SFTP_PORT}")`);
    }

    const config = { host: env.SFTP_HOST, port, username: env.SFTP_USER };
    if (env.SFTP_PRIVATE_KEY_PATH) {
        config.privateKeyPath = expandHome(env.SFTP_PRIVATE_KEY_PATH);
        if (env.SFTP_PASSPHRASE) {
            config.passphrase = env.SFTP_PASSPHRASE;
        }
    } else {
        config.password = env.SFTP_PASSWORD;
    }

    // relative to the folder you land in after login, leading slash optional
    config.remotePath = (env.SFTP_SPECIFIC_PATH || "").replace(/^\/+/, "");
    return config;
};

const uploadData = async (config, dryRun) => {
    for (const file of FILES) {
        if (!fs.existsSync(path.join(SITE_DIR, file))) {
            throw new Error(`_site/${file} is missing - build the site first (npx @11ty/eleventy)`);
        }
    }

    const target = `${config.username}@${config.host}:${config.port} ~/${config.remotePath}`;
    if (dryRun) {
        console.log(`Dry run - would upload ${FILES.join(", ")} to ${target}`);
        return;
    }

    const Client = require("ssh2-sftp-client");
    const sftpClient = new Client();
    const { privateKeyPath, remotePath, ...connectOptions } = config;
    if (privateKeyPath) {
        connectOptions.privateKey = fs.readFileSync(privateKeyPath);
    }

    try {
        await sftpClient.connect({ ...connectOptions, readyTimeout: 20000 });
        const remoteDir = path.posix.join(await sftpClient.cwd(), remotePath);
        if (!(await sftpClient.exists(remoteDir))) {
            await sftpClient.mkdir(remoteDir, true);
        }
        for (const file of FILES) {
            await sftpClient.fastPut(path.join(SITE_DIR, file), path.posix.join(remoteDir, file));
            console.log(`Uploaded ${file}`);
        }
        console.log(`✅ Site uploaded to ${target}`);
    } finally {
        await sftpClient.end().catch(() => {});
    }
};

const main = async () => {
    require("dotenv").config({ quiet: true });
    const config = getConfig(process.env);
    if (!config) {
        console.log("SFTP not configured in .env - skipping upload");
        return;
    }
    await uploadData(config, process.argv.includes("--dry-run"));
};

if (require.main === module) {
    main().catch((error) => {
        console.error(`❌ Upload failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { getConfig };
