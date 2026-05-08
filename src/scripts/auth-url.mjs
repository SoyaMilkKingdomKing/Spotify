import crypto from "node:crypto";
import { readEnv } from "../lib/env.mjs";
import { buildSpotifyAuthorizationUrl, SPOTIFY_SCOPES } from "../lib/spotify.mjs";

const clientId = readEnv("SPOTIFY_CLIENT_ID");
const redirectUri = readEnv("SPOTIFY_REDIRECT_URI", {
  required: false,
  defaultValue: "http://127.0.0.1:8888/callback"
});
const state = crypto.randomBytes(12).toString("hex");

console.log("Open this URL once to authorize Spotify:");
console.log("");
console.log(buildSpotifyAuthorizationUrl({ clientId, redirectUri, state }));
console.log("");
console.log("Scopes:");
console.log(SPOTIFY_SCOPES.join(" "));
console.log("");
console.log("After Spotify redirects, copy the `code` query parameter from the browser address bar.");
