"use strict";

const { fetchDispatch } = require("../adapters/dispatch");
const { fetchCustoms } = require("../adapters/customs");
const { sanitizeDispatch } = require("../sanitizers/dispatch");
const { sanitizeCustoms } = require("../sanitizers/customs");
const { GatewayError } = require("../errors");

async function withinTimeout(config, operation) {
  const controller = new AbortController();
  let timer;

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new GatewayError(504, "UPSTREAM_TIMEOUT", "Tempo limite das fontes internas excedido."));
        }, config.upstreamTimeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function sourceFailure(result, sourceName) {
  if (result.status === "fulfilled") return null;
  const reason = result.reason;
  if (reason instanceof GatewayError) return reason;
  return new GatewayError(502, "UPSTREAM_UNAVAILABLE", `Falha segura na fonte ${sourceName}.`);
}

async function acquireBoth({
  config,
  scenario,
  waves,
  facilityId,
  groupId,
  siteId,
  timezone,
  dependencies = {}
}) {
  return withinTimeout(config, signal => Promise.allSettled([
    fetchDispatch({ config, scenario, waves, facilityId, groupId, siteId, signal, ...dependencies }),
    fetchCustoms({ config, scenario, timezone, signal, ...dependencies })
  ]));
}

async function buildSnapshot(options) {
  const { config, scenario } = options;
  const [dispatchResult, customsResult] = await acquireBoth(options);
  const dispatchFailure = sourceFailure(dispatchResult, "dispatch");
  const customsFailure = sourceFailure(customsResult, "aduana");

  if (dispatchFailure || customsFailure) {
    const primaryFailure = dispatchFailure || customsFailure;
    throw new GatewayError(
      primaryFailure.status,
      primaryFailure.code,
      primaryFailure.message,
      {
        sources: {
          dispatch: dispatchFailure ? "error" : "ok",
          aduana: customsFailure ? "error" : "ok"
        }
      }
    );
  }

  const operacional = dispatchResult.value.map(sanitizeDispatch);
  const aduana = customsResult.value.map(sanitizeCustoms);
  const emptyConfirmed = scenario === "empty-confirmed" && operacional.length === 0 && aduana.length === 0;

  return {
    snapshotComplete: true,
    emptyConfirmed,
    sources: { dispatch: "ok", aduana: "ok" },
    operacional,
    aduana
  };
}

async function buildDispatchSnapshot({
  config,
  scenario,
  wave,
  facilityId,
  groupId,
  siteId,
  dependencies = {}
}) {
  const rows = await withinTimeout(config, signal => fetchDispatch({
    config,
    scenario,
    waves: [wave],
    facilityId,
    groupId,
    siteId,
    signal,
    ...dependencies
  }));
  const operacional = rows.map(sanitizeDispatch);
  return {
    snapshotComplete: true,
    emptyConfirmed: scenario === "empty-confirmed" && operacional.length === 0,
    sources: { dispatch: "ok" },
    operacional
  };
}

async function buildCustomsSnapshot({ config, scenario, timezone, dependencies = {} }) {
  const rows = await withinTimeout(config, signal => fetchCustoms({
    config,
    scenario,
    timezone,
    signal,
    ...dependencies
  }));
  const aduana = rows.map(sanitizeCustoms);
  return {
    snapshotComplete: true,
    emptyConfirmed: scenario === "empty-confirmed" && aduana.length === 0,
    sources: { aduana: "ok" },
    aduana
  };
}

module.exports = { buildSnapshot, buildDispatchSnapshot, buildCustomsSnapshot };
