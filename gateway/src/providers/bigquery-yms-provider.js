"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { GatewayError } = require("../errors");

const RUNTIME_SQL_PATH = path.resolve(__dirname, "../../sql/yms-route-lifecycle-runtime.sql");

function loadRuntimeSql() {
  return fs.readFileSync(RUNTIME_SQL_PATH, "utf8");
}

function validateOperationDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new GatewayError(400, "INVALID_OPERATION_DATE", "operationDate deve usar YYYY-MM-DD.");
  }
  return text;
}

function currentDateInTimeZone(timezone = "America/Sao_Paulo", now = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now);
  } catch {
    throw new GatewayError(400, "INVALID_QUERY", "timezone invalido para YMS.");
  }

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return validateOperationDate(`${values.year}-${values.month}-${values.day}`);
}

function validateWaveNumbers(values) {
  const waves = Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => Number(value))
    .filter(value => Number.isSafeInteger(value) && value > 0)));

  if (!waves.length || waves.length > 10) {
    throw new GatewayError(400, "INVALID_QUERY", "waves invalidas para YMS.");
  }

  return waves;
}

function createBigQueryYmsProvider({ queryExecutor, sqlLoader = loadRuntimeSql } = {}) {
  const configured = typeof queryExecutor === "function";

  return Object.freeze({
    mode: "provider",

    inspectConfiguration() {
      return configured
        ? { configured: true, mode: "provider" }
        : { configured: false, mode: "provider", reason: "YMS_PROVIDER_NOT_CONFIGURED" };
    },

    async query({ facilityId, cycle, waves, operationDate, timezone, signal }) {
      if (!configured) {
        throw new GatewayError(
          503,
          "YMS_PROVIDER_NOT_CONFIGURED",
          "Executor BigQuery YMS nao configurado."
        );
      }

      const sql = sqlLoader();
      if (!sql || !sql.includes("@facility_id") || !sql.includes("@operation_date")
          || !sql.includes("@wave_numbers")) {
        throw new GatewayError(
          500,
          "YMS_SQL_INVALID",
          "SQL runtime YMS invalido."
        );
      }

      return queryExecutor({
        sql,
        params: {
          facility_id: String(facilityId),
          cycle_name: String(cycle),
          operation_date: operationDate
            ? validateOperationDate(operationDate)
            : currentDateInTimeZone(timezone),
          wave_numbers: validateWaveNumbers(waves)
        },
        signal
      });
    }
  });
}

module.exports = {
  RUNTIME_SQL_PATH,
  loadRuntimeSql,
  validateOperationDate,
  validateWaveNumbers,
  currentDateInTimeZone,
  createBigQueryYmsProvider
};
