import { existsSync, readFileSync } from "node:fs";

function loadLocalDotenv() {
  if (!existsSync(".env")) return;

  const lines = readFileSync(".env", "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    let value = match[2].trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadLocalDotenv();

export function readEnv(name, options = {}) {
  const { required = true, defaultValue } = options;
  const value = process.env[name] ?? defaultValue;

  if (required && (value === undefined || value === "")) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function readNumberEnv(name, defaultValue) {
  const raw = readEnv(name, { required: false, defaultValue: String(defaultValue) });
  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be a number.`);
  }

  return value;
}

export function readBooleanEnv(name, defaultValue = false) {
  const raw = readEnv(name, { required: false, defaultValue: String(defaultValue) });
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}
