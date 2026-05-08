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
