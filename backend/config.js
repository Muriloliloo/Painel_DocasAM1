"use strict";

const DEFAULT_PORT = 8787;
const LOCAL_FIXTURE_MODE = "local-fixture";
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

function parseBackendMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (!mode) return "";
  if (mode !== LOCAL_FIXTURE_MODE) {
    throw new TypeError("BACKEND_MODE não suportado.");
  }
  return mode;
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
  const backendMode = parseBackendMode(env.BACKEND_MODE);
  const useFixture = backendMode === LOCAL_FIXTURE_MODE
    && parseBoolean(env.USE_FIXTURE, true);

  return Object.freeze({
    backendMode,
    port: parsePort(env.PORT),
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    useFixture
  });
}

function assertLocalFixtureConfig(config) {
  if (!config
    || config.backendMode !== LOCAL_FIXTURE_MODE
    || config.useFixture !== true) {
    throw new Error("Backend desabilitado: use explicitamente o modo local com fixture fictícia.");
  }
  return config;
}

module.exports = {
  DEFAULT_PORT,
  LOCAL_FIXTURE_MODE,
  DEFAULT_ALLOWED_ORIGINS,
  assertLocalFixtureConfig,
  loadConfig,
  parseAllowedOrigins
};
