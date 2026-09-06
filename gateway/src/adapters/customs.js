"use strict";

const { GatewayError } = require("../errors");

const CUSTOMS_IN_PROGRESS = Object.freeze({
  route_name: "VJ3_AM1",
  route_id: 502731583004,
  status: "in_progress",
  process: "customs_in_progress",
  operator_name: "REP TESTE",
  audit_time: 18,
  aduanaUnidades: 190,
  aduanaBipadas: 3,
  driver_name: "MOTORISTA TESTE",
  carrier_name: "TRANSPORTADORA TESTE",
  plate: "ABC1D23"
});

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      const error = new Error("Operacao cancelada.");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
}

function realAdapterNotConfigured() {
  throw new GatewayError(
    503,
    "REAL_ADAPTER_NOT_CONFIGURED",
    "Real internal authentication adapter is not configured."
  );
}

function selectRows(scenario) {
  if (new Set(["empty-unconfirmed", "empty-confirmed", "loading", "dispatched"]).has(scenario)) return [];
  if (scenario === "customs-complete") {
    return [{
      ...CUSTOMS_IN_PROGRESS,
      status: "completed",
      process: "customs_completed",
      audit_time: 42,
      aduanaBipadas: 190
    }];
  }
  return [{ ...CUSTOMS_IN_PROGRESS }];
}

async function fetchCustoms({ config, scenario, signal }) {
  if (config.mode === "real") realAdapterNotConfigured();
  if (scenario === "failure-customs") {
    throw new GatewayError(502, "CUSTOMS_UPSTREAM_FAILURE", "Aduana indisponivel no cenario mock.");
  }

  const delayMs = scenario === "timeout" ? config.mockTimeoutDelayMs : config.mockDelayMs;
  await delay(delayMs, signal);
  return selectRows(scenario);
}

module.exports = { fetchCustoms };
