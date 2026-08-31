"use strict";

const LIMITS = Object.freeze({
  maxWaves: 500,
  maxDispatch: 10000,
  maxAudits: 10000,
  maxUnitsPerAudit: 5000,
  maxStringLength: 500
});

const WAVE_FIELDS = Object.freeze([
  "waveId",
  "waveName",
  "startTime",
  "endTime",
  "plannedRoutes",
  "dispatchedRoutes",
  "pendingRoutes",
  "hasAssociatedRoutes",
  "wave_id",
  "wave_name",
  "start_time",
  "end_time",
  "planned_routes",
  "dispatched_routes",
  "pending_routes",
  "has_associated_routes"
]);

const DISPATCH_FIELDS = Object.freeze([
  "route_id",
  "route_name",
  "dock_number",
  "process",
  "start_time",
  "total_elapsed_time"
]);

const AUDIT_FIELDS = Object.freeze([
  "id",
  "facility_id",
  "status",
  "audit_type",
  "operator_id",
  "created_at",
  "started_at",
  "finished_at",
  "leftover_count"
]);

const NESTED_FIELDS = Object.freeze({
  driver: Object.freeze(["route_id", "driver_id", "vehicle_id", "carrier_id", "cluster_id"]),
  operator: Object.freeze(["name", "last_name"]),
  transporter: Object.freeze(["first_name", "last_name"]),
  vehicle: Object.freeze(["license_plate"]),
  carrier: Object.freeze(["display_name"]),
  units: Object.freeze(["entity_id", "status"])
});

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizedScalar(value) {
  if (value === null) return null;
  if (typeof value === "string") {
    return value.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, LIMITS.maxStringLength);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  return undefined;
}

function pickFields(source, fields) {
  if (!isRecord(source)) return {};
  const output = {};
  fields.forEach(field => {
    if (!Object.prototype.hasOwnProperty.call(source, field)) return;
    const value = sanitizedScalar(source[field]);
    if (value !== undefined) output[field] = value;
  });
  return output;
}

function sanitizeWave(wave) {
  return pickFields(wave, WAVE_FIELDS);
}

function sanitizeDispatchRoute(route) {
  return pickFields(route, DISPATCH_FIELDS);
}

function sanitizeAudit(audit) {
  const output = pickFields(audit, AUDIT_FIELDS);
  ["driver", "operator", "transporter", "vehicle", "carrier"].forEach(field => {
    if (!isRecord(audit && audit[field])) return;
    output[field] = pickFields(audit[field], NESTED_FIELDS[field]);
  });
  if (Array.isArray(audit && audit.units)) {
    output.units = audit.units
      .slice(0, LIMITS.maxUnitsPerAudit)
      .map(unit => pickFields(unit, NESTED_FIELDS.units));
  }
  return output;
}

function sanitizeOperationalData(input) {
  const source = isRecord(input) ? input : {};
  return {
    waves: (Array.isArray(source.waves) ? source.waves : [])
      .slice(0, LIMITS.maxWaves)
      .map(sanitizeWave),
    dispatch: (Array.isArray(source.dispatch) ? source.dispatch : [])
      .slice(0, LIMITS.maxDispatch)
      .map(sanitizeDispatchRoute),
    audits: (Array.isArray(source.audits) ? source.audits : [])
      .slice(0, LIMITS.maxAudits)
      .map(sanitizeAudit)
  };
}

module.exports = {
  LIMITS,
  sanitizeOperationalData
};
