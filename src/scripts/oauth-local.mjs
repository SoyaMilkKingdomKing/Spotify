import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { execFile } from "node:child_process";
import { readEnv } from "../lib/env.mjs";
import {
  buildSpotifyAuthorizationUrl,
  exchangeCodeForToken
} from "../lib/spotify.mjs";

function updateEnvValue(key, value) {
  const envPath = ".env";
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  let found = false;
  const updated = lines.map((line) => {
    if (line.match(new RegExp(`^\\s*${key}\\s*=`))) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    updated.push(`${key}=${value}`);
  }

  writeFileSync(envPath, updated.join("\n"), "utf8");
}

function openBrowser(url) {
  if (process.platform === "win32") {
    execFile("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Start-Process -FilePath $args[0]",
      url
    ]);
    return;
  }

  if (process.platform === "darwin") {
    execFile("open", [url]);
    return;
  }

  execFile("xdg-open", [url]);
}

const clientId = readEnv("SPOTIFY_CLIENT_ID");
const clientSecret = readEnv("SPOTIFY_CLIENT_SECRET");
const redirectUri = readEnv("SPOTIFY_REDIRECT_URI", {
  required: false,
  defaultValue: "http://127.0.0.1:8888/callback"
});
const redirect = new URL(redirectUri);
const state = crypto.randomBytes(12).toString("hex");
const authorizationUrl = buildSpotifyAuthorizationUrl({
  clientId,
  redirectUri,
  state
});

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, redirect.origin);

  if (requestUrl.pathname !== redirect.pathname) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const error = requestUrl.searchParams.get("error");
  const code = requestUrl.searchParams.get("code");
  const returnedState = requestUrl.searchParams.get("state");

  if (error || !code || returnedState !== state) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Spotify authorization failed. You can close this tab and retry.");
    server.close();
    return;
  }

  try {
    const token = await exchangeCodeForToken({
      clientId,
      clientSecret,
      code,
      redirectUri
    });

    updateEnvValue("SPOTIFY_REFRESH_TOKEN", token.refresh_token);

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`
      <html>
        <body style="font-family: system-ui, sans-serif; padding: 32px;">
          <h1>Spotify authorization complete</h1>
          <p>You can close this tab and return to Codex.</p>
        </body>
      </html>
    `);

    console.log("Spotify authorization complete. SPOTIFY_REFRESH_TOKEN was saved to .env.");
  } catch (exchangeError) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Token exchange failed. Return to Codex for details.");
    console.error(exchangeError);
  } finally {
    server.close();
  }
});

server.listen(Number(redirect.port || 80), redirect.hostname, () => {
  console.log(`Listening for Spotify callback at ${redirectUri}`);
  console.log("Opening Spotify authorization page...");
  openBrowser(authorizationUrl);
});
