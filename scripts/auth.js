// one-time spotify login (authorization code + PKCE), stores a refresh token in .spotify-token.json
const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");

require("dotenv").config({ quiet: true });
const { TOKEN_PATH, env, postToken, saveTokenFile } = require("../api/spotify");

const SCOPES = "playlist-read-private playlist-read-collaborative";
const TIMEOUT_MS = 3 * 60 * 1000;

const port = Number(process.env.SPOTIFY_AUTH_PORT) || 8888;
const redirect_uri = `http://127.0.0.1:${port}/callback`;

const openBrowser = (url) => {
    const [command, args] = {
        darwin: ["open", [url]],
        win32: ["rundll32", ["url.dll,FileProtocolHandler", url]],
    }[process.platform] || ["xdg-open", [url]];
    // the url is printed as well, so a failing browser launch is fine
    execFile(command, args, () => {});
};

const waitForCode = (authorizeUrl, state) => new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, redirect_uri);
        if (url.pathname !== "/callback") {
            res.writeHead(404).end();
            return;
        }

        const error = url.searchParams.get("error")
            || (url.searchParams.get("state") !== state && "state mismatch");

        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        // browsers keep extra (pre)connections open, close them all or the process won't exit
        res.end(error ? `Spotify login failed: ${error}` : "Logged in to Spotify - you can close this tab.", () => {
            server.closeAllConnections();
        });

        clearTimeout(timer);
        server.close();
        if (error) {
            reject(new Error(`Spotify login failed: ${error}`));
        } else {
            resolve(url.searchParams.get("code"));
        }
    });

    const timer = setTimeout(() => {
        server.close();
        reject(new Error("Timed out waiting for the Spotify login (3 minutes)"));
    }, TIMEOUT_MS);

    server.on("error", (error) => {
        clearTimeout(timer);
        reject(error.code === "EADDRINUSE"
            ? new Error(`Port ${port} is busy - set SPOTIFY_AUTH_PORT in .env (and update the redirect URI)`)
            : error);
    });

    server.listen(port, "127.0.0.1", () => {
        console.log(`Make sure this redirect URI is added to your app in the Spotify dashboard:\n  ${redirect_uri}\n`);
        console.log(`Opening the Spotify login in your browser. If nothing happens, open:\n  ${authorizeUrl}\n`);
        openBrowser(authorizeUrl);
    });
});

const main = async () => {
    const client_id = env("CLIENT_ID");
    const code_verifier = crypto.randomBytes(64).toString("base64url");
    const code_challenge = crypto.createHash("sha256").update(code_verifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("base64url");

    const authorizeUrl = `https://accounts.spotify.com/authorize?${new URLSearchParams({
        client_id,
        response_type: "code",
        redirect_uri,
        code_challenge_method: "S256",
        code_challenge,
        state,
        scope: SCOPES,
    })}`;

    const code = await waitForCode(authorizeUrl, state);
    const json = await postToken({ grant_type: "authorization_code", code, redirect_uri, client_id, code_verifier });

    saveTokenFile({ refresh_token: json.refresh_token, scope: json.scope, created_at: new Date().toISOString() });
    console.log(`✅ Logged in - saved to ${path.basename(TOKEN_PATH)} (keep this file private)`);
};

main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
});
