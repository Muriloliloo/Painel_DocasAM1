"use strict";

const DEFAULT_PORT = 8787;
const LOCAL_FIXTURE_MODE = "local-fixture";
const CENTRAL_MODE = "central";
const DEFAULT_SNAPSHOT_REFRESH_MS = 30000;
const MIN_SNAPSHOT_REFRESH_MS = 10000;
const MAX_SNAPSHOT_REFRESH_MS = 300000;
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
  if (mode !== LOCAL_FIXTURE_MODE && mode !== CENTRAL_MODE) {
    throw new TypeError("BACKEND_MODE não suportado.");
  }
  return mode;
}

function parseSnapshotRefreshMs(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_SNAPSHOT_REFRESH_MS;
  const interval = Number(value);
  if (!Number.isInteger(interval)
    || interval < MIN_SNAPSHOT_REFRESH_MS
    || interval > MAX_SNAPSHOT_REFRESH_MS) {
    throw new RangeError(
      `SNAPSHOT_REFRESH_MS deve ser um número inteiro entre ${MIN_SNAPSHOT_REFRESH_MS} e ${MAX_SNAPSHOT_REFRESH_MS}.`
    );
  }
  return interval;
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
    snapshotRefreshMs: parseSnapshotRefreshMs(env.SNAPSHOT_REFRESH_MS),
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

function assertCentralConfig(config) {
  if (!config
    || config.backendMode !== CENTRAL_MODE
    || config.useFixture !== false) {
    throw new Error("Backend central desabilitado: configuração central explícita é obrigatória.");
  }
  return config;
}

module.exports = {
  CENTRAL_MODE,
  DEFAULT_PORT,
  LOCAL_FIXTURE_MODE,
  DEFAULT_SNAPSHOT_REFRESH_MS,
  MIN_SNAPSHOT_REFRESH_MS,
  MAX_SNAPSHOT_REFRESH_MS,
  DEFAULT_ALLOWED_ORIGINS,
  assertCentralConfig,
  assertLocalFixtureConfig,
  loadConfig,
  parseAllowedOrigins,
  parseSnapshotRefreshMs
};
