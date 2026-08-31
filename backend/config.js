"use strict";

const DEFAULT_PORT = 8787;
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);

function parsePort(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError("PORT deve ser um número inteiro entre 1 e 65535.");
  }
  return port;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new TypeError("USE_FIXTURE deve ser true ou false.");
}

function normalizedOrigin(value) {
  const text = String(value || "").trim();
  if (!text || text === "*") throw new TypeError("ALLOWED_ORIGINS contém uma origem inválida.");

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new TypeError("ALLOWED_ORIGINS contém uma origem inválida.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || (parsed.pathname !== "/" && parsed.pathname !== "")
    || parsed.search
    || parsed.hash) {
    throw new TypeError("ALLOWED_ORIGINS contém uma origem inválida.");
  }
  return parsed.origin;
}

function parseAllowedOrigins(value) {
  const entries = value === undefined || value === null || String(value).trim() === ""
    ? DEFAULT_ALLOWED_ORIGINS
    : String(value).split(",");
  return Object.freeze([...new Set(entries.map(normalizedOrigin))]);
}

function loadConfig(env = process.env) {
  return Object.freeze({
    port: parsePort(env.PORT),
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    useFixture: parseBoolean(env.USE_FIXTURE, true)
  });
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_ALLOWED_ORIGINS,
  loadConfig,
  parseAllowedOrigins
};
