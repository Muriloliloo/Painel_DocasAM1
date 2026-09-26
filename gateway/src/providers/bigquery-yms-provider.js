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

function createBigQueryYmsProvider({ queryExecutor, sqlLoader = loadRuntimeSql } = {}) {
  const configured = typeof queryExecutor === "function";

  return Object.freeze({
    mode: "provider",

    inspectConfiguration() {
      return configured
        ? { configured: true, mode: "provider" }
        : { configured: false, mode: "provider", reason: "YMS_PROVIDER_NOT_CONFIGURED" };
    },

    async query({ facilityId, cycle, operationDate, timezone, signal }) {
      if (!configured) {
        throw new GatewayError(
          503,
          "YMS_PROVIDER_NOT_CONFIGURED",
          "Executor BigQuery YMS nao configurado."
        );
      }

      const sql = sqlLoader();
      if (!sql || !sql.includes("@facility_id") || !sql.includes("@operation_date")) {
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
            : currentDateInTimeZone(timezone)
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
  currentDateInTimeZone,
  createBigQueryYmsProvider
};
