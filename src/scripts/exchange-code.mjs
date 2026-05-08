import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const shouldSave = process.argv.includes("--save");

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
if (shouldSave) {
  updateEnvValue("SPOTIFY_REFRESH_TOKEN", token.refresh_token);
  console.log("SPOTIFY_REFRESH_TOKEN was saved to .env.");
} else {
  console.log("Add this value to GitHub Secrets as SPOTIFY_REFRESH_TOKEN:");
  console.log(token.refresh_token);
}
console.log("");
console.log("Access token expires in seconds:");
console.log(token.expires_in);
