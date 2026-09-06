"use strict";

const { GatewayError } = require("./errors");

function csvValues(value, fallback) {
  return String(value || fallback)
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", `${name} deve ser um inteiro positivo.`);
  }
  return parsed;
}

function validatedSet(name, values, pattern, maxEntries = 20) {
  const normalized = Array.from(new Set(values));
  if (!normalized.length || normalized.length > maxEntries || normalized.some(value => !pattern.test(value))) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", `${name} possui valores invalidos.`);
  }
  return new Set(normalized);
}

function configuredOrigins(env, overrides, nodeEnv) {
  const values = overrides.allowedOrigins
    ?? (env.PANEL_ALLOWED_ORIGIN
      ? csvValues(env.PANEL_ALLOWED_ORIGIN, "")
      : nodeEnv === "production" ? [] : ["http://localhost:8000"]);

  if (!values.length && nodeEnv === "production") {
    throw new GatewayError(
      500,
      "INVALID_CONFIGURATION",
      "PANEL_ALLOWED_ORIGIN e obrigatorio em production."
    );
  }

  const normalized = values.map(value => {
    if (value === "*") {
      throw new GatewayError(500, "INVALID_CONFIGURATION", "CORS curinga nao e permitido.");
    }
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new GatewayError(500, "INVALID_CONFIGURATION", "PANEL_ALLOWED_ORIGIN possui origem invalida.");
    }
    if (!new Set(["http:", "https:"]).has(url.protocol) || url.origin !== value || url.username || url.password) {
      throw new GatewayError(500, "INVALID_CONFIGURATION", "PANEL_ALLOWED_ORIGIN deve conter somente origens HTTP(S) exatas.");
    }
    return value;
  });

  return new Set(normalized);
}

function createConfig(env = process.env, overrides = {}) {
  const mode = String(overrides.mode ?? env.GATEWAY_MODE ?? "mock").trim().toLowerCase();
  if (!new Set(["mock", "real"]).has(mode)) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", "GATEWAY_MODE deve ser mock ou real.");
  }

  const nodeEnv = String(overrides.nodeEnv ?? env.NODE_ENV ?? "development").trim().toLowerCase();
  const mockScenario = String(overrides.mockScenario ?? env.MOCK_SCENARIO ?? "normal").trim().toLowerCase();
  const configuredPort = Number(overrides.port ?? env.PORT ?? 8787);
  if (!Number.isSafeInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", "PORT deve ser uma porta valida.");
  }

  return Object.freeze({
    port: configuredPort,
    nodeEnv,
    mode,
    mockScenario,
    allowedOrigins: configuredOrigins(env, overrides, nodeEnv),
    allowedFacilityIds: validatedSet(
      "ALLOWED_FACILITY_IDS",
      overrides.allowedFacilityIds ?? csvValues(env.ALLOWED_FACILITY_IDS, "SSP15"),
      /^[A-Za-z0-9_-]{1,32}$/
    ),
    allowedSiteIds: validatedSet(
      "ALLOWED_SITE_IDS",
      overrides.allowedSiteIds ?? csvValues(env.ALLOWED_SITE_IDS, "MLB"),
      /^[A-Za-z0-9_-]{1,16}$/
    ),
    allowedCycles: validatedSet(
      "ALLOWED_CYCLES",
      overrides.allowedCycles ?? csvValues(env.ALLOWED_CYCLES, "AM1"),
      /^[A-Za-z0-9_-]{1,16}$/
    ),
    allowedWaves: validatedSet(
      "ALLOWED_WAVES",
      overrides.allowedWaves ?? csvValues(env.ALLOWED_WAVES, "1,2,3,4,5"),
      /^[A-Za-z0-9_-]{1,8}$/,
      10
    ),
    upstreamTimeoutMs: positiveInteger(
      overrides.upstreamTimeoutMs ?? env.UPSTREAM_TIMEOUT_MS,
      1000,
      "UPSTREAM_TIMEOUT_MS"
    ),
    maxResponseBytes: positiveInteger(
      overrides.maxResponseBytes ?? env.MAX_RESPONSE_BYTES,
      262144,
      "MAX_RESPONSE_BYTES"
    ),
    mockDelayMs: positiveInteger(overrides.mockDelayMs ?? env.MOCK_DELAY_MS, 5, "MOCK_DELAY_MS"),
    mockTimeoutDelayMs: positiveInteger(
      overrides.mockTimeoutDelayMs ?? env.MOCK_TIMEOUT_DELAY_MS,
      2500,
      "MOCK_TIMEOUT_DELAY_MS"
    )
  });
}

module.exports = { createConfig };
