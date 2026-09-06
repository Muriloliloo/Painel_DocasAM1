"use strict";

const { GatewayError } = require("../errors");

const DISPATCH_BY_WAVE = Object.freeze({
  "1": {
    route_name: "VT9_AM1",
    route_id: 502731583001,
    process: "loading_packages",
    dock_number: 3,
    start_time: 60,
    total_elapsed_time: 240
  },
  "2": {
    route_name: "VJ3_AM1",
    route_id: 502731583004,
    process: "waiting_customs",
    dock_number: 2,
    start_time: 35,
    total_elapsed_time: 120
  },
  "3": {
    route_name: "VT12_AM1",
    route_id: 502731588003,
    process: "dispatched",
    dock_number: 1,
    start_time: 20,
    total_elapsed_time: 95
  }
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

function selectRows(scenario, waves) {
  if (new Set(["empty-unconfirmed", "empty-confirmed"]).has(scenario)) return [];

  if (scenario === "loading") return [{ ...DISPATCH_BY_WAVE["1"] }];
  if (scenario === "dispatched") return [{ ...DISPATCH_BY_WAVE["3"] }];
  if (new Set(["customs-in-progress", "customs-complete"]).has(scenario)) {
    return [{ ...DISPATCH_BY_WAVE["2"] }];
  }

  return waves.flatMap(wave => DISPATCH_BY_WAVE[wave] ? [{ ...DISPATCH_BY_WAVE[wave] }] : []);
}

async function fetchDispatch({ config, scenario, waves, signal }) {
  if (config.mode === "real") realAdapterNotConfigured();
  if (scenario === "failure-dispatch") {
    throw new GatewayError(502, "DISPATCH_UPSTREAM_FAILURE", "Dispatch indisponivel no cenario mock.");
  }

  const delayMs = scenario === "timeout" ? config.mockTimeoutDelayMs : config.mockDelayMs;
  await delay(delayMs, signal);
  return selectRows(scenario, waves);
}

module.exports = { fetchDispatch };
