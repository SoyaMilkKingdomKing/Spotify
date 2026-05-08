import { readEnv } from "../lib/env.mjs";
import { exchangeCodeForToken } from "../lib/spotify.mjs";

function parseCode(input) {
  if (!input) return null;

  if (input.startsWith("http://") || input.startsWith("https://")) {
    return new URL(input).searchParams.get("code");
  }

  return input;
}

const code = parseCode(process.argv[2] ?? process.env.SPOTIFY_AUTH_CODE);

if (!code) {
  throw new Error("Pass the Spotify authorization code as an argument or SPOTIFY_AUTH_CODE.");
}

const token = await exchangeCodeForToken({
  clientId: readEnv("SPOTIFY_CLIENT_ID"),
  clientSecret: readEnv("SPOTIFY_CLIENT_SECRET"),
  redirectUri: readEnv("SPOTIFY_REDIRECT_URI", {
    required: false,
    defaultValue: "http://127.0.0.1:8888/callback"
  }),
  code
});

console.log("Token exchange succeeded.");
console.log("");
console.log("Add this value to GitHub Secrets as SPOTIFY_REFRESH_TOKEN:");
console.log(token.refresh_token);
console.log("");
console.log("Access token expires in seconds:");
console.log(token.expires_in);
