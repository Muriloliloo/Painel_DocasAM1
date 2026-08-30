(function exposeOperationalIntegration(global) {
  "use strict";

  const PROCESS_MAP = Object.freeze({
    customs_in_progress: "ADUANA",
    loading_packages: "CARREGAMENTO",
    dispatched: "EXPEDIDA"
  });

  function firstValue(source, keys, fallback = "") {
    if (!source || typeof source !== "object") return fallback;

    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
    }

    return fallback;
  }

  function extractRecords(source, keys) {
    if (Array.isArray(source)) return source;
    if (!source || typeof source !== "object") return [];

    for (const key of keys) {
      if (Array.isArray(source[key])) return source[key];
    }

    if (source.data && typeof source.data === "object") {
      for (const key of keys) {
        if (Array.isArray(source.data[key])) return source.data[key];
      }
      if (Array.isArray(source.data)) return source.data;
    }

    return [source];
  }

  function firstObject(value) {
    if (Array.isArray(value)) return value[0] || {};
    return value && typeof value === "object" ? value : {};
  }

  function toNonNegativeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function toWholeNumber(value) {
    return Math.floor(toNonNegativeNumber(value));
  }

  function toText(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function routeKey(value) {
    return toText(value);
  }

  function joinName(...parts) {
    return parts.map(toText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function formatSeconds(value) {
    const totalSeconds = toWholeNumber(value);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
    }

    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  function progressPercent(dispatchedRoutes, plannedRoutes) {
    if (plannedRoutes <= 0) return 0;
    const progress = Math.min(100, (dispatchedRoutes / plannedRoutes) * 100);
    return Number(progress.toFixed(2));
  }

  function normalizeWaves(source) {
    const waves = extractRecords(source, ["waves", "results", "items"]);

    return waves.map(wave => {
      const plannedRoutes = toWholeNumber(firstValue(wave, ["plannedRoutes", "planned_routes", "planned"]));
      const dispatchedRoutes = toWholeNumber(firstValue(wave, ["dispatchedRoutes", "dispatched_routes", "dispatched"]));
      const providedPending = firstValue(wave, ["pendingRoutes", "pending_routes", "pending"], null);
      const pendingRoutes = providedPending === null
        ? Math.max(0, plannedRoutes - dispatchedRoutes)
        : toWholeNumber(providedPending);
      const providedAssociation = firstValue(wave, ["hasAssociatedRoutes", "has_associated_routes"], null);
      const hasAssociatedRoutes = providedAssociation === null
        ? plannedRoutes > 0 || dispatchedRoutes > 0 || pendingRoutes > 0
        : Boolean(providedAssociation);
      const isFinished = plannedRoutes > 0 && pendingRoutes === 0 && dispatchedRoutes >= plannedRoutes;
      const status = plannedRoutes === 0
        ? "SEM_ROTAS"
        : isFinished
          ? "FINALIZADA"
          : dispatchedRoutes > 0
            ? "EM_ANDAMENTO"
            : hasAssociatedRoutes
              ? "PENDENTE"
              : "SEM_ROTAS";

      return {
        waveId: firstValue(wave, ["waveId", "wave_id", "id"]),
        waveName: toText(firstValue(wave, ["waveName", "wave_name", "name"])),
        startTime: firstValue(wave, ["startTime", "start_time"]),
        endTime: firstValue(wave, ["endTime", "end_time"]),
        plannedRoutes,
        dispatchedRoutes,
        pendingRoutes,
        hasAssociatedRoutes,
        progress: progressPercent(dispatchedRoutes, plannedRoutes),
        status,
        isFinished
      };
    });
  }

  function normalizeDispatch(source) {
    const routes = extractRecords(source, ["dispatch", "routes", "results", "items"]);

    return routes.map(route => {
      const originalProcess = toText(firstValue(route, ["process", "processOriginal"]));
      const normalizedProcess = originalProcess.toLowerCase();
      const startTimeSeconds = toWholeNumber(firstValue(route, ["startTimeSeconds", "start_time", "startTime"]));
      const totalElapsedTimeSeconds = toWholeNumber(firstValue(route, [
        "totalElapsedTimeSeconds",
        "total_elapsed_time",
        "totalElapsedTime"
      ]));
      const wasDispatched = normalizedProcess === "dispatched";

      return {
        routeId: firstValue(route, ["routeId", "route_id"]),
        routeName: toText(firstValue(route, ["routeName", "route_name"])),
        dockNumber: firstValue(route, ["dockNumber", "dock_number"]),
        process: originalProcess,
        processOriginal: originalProcess,
        processLabel: PROCESS_MAP[normalizedProcess] || originalProcess,
        startTimeSeconds,
        startTime: formatSeconds(startTimeSeconds),
        totalElapsedTimeSeconds,
        totalElapsedTime: formatSeconds(totalElapsedTimeSeconds),
        startTimeMeaning: wasDispatched ? "elapsed_since_dispatched" : "current_stage_elapsed",
        totalElapsedTimeMeaning: wasDispatched ? "accumulated_until_dispatch" : "total_accumulated"
      };
    });
  }

  function normalizeUnitStatus(value) {
    return toText(value).toLowerCase().replace(/[\s-]+/g, "_") || "unknown";
  }

  function normalizeUnits(source) {
    const units = extractRecords(source, ["units", "results", "items"]);
    if (!source || (typeof source === "object" && !Array.isArray(source) && !units.length)) return [];

    return units.map(unit => ({
      entityId: firstValue(unit, ["entityId", "entity_id", "id"]),
      status: normalizeUnitStatus(firstValue(unit, ["status"]))
    }));
  }

  function countUnits(units) {
    return units.reduce((counts, unit) => {
      counts[unit.status] = (counts[unit.status] || 0) + 1;
      return counts;
    }, {});
  }

  function normalizeAudit(source) {
    const audits = extractRecords(source, ["audits", "results", "items"]);

    return audits.map(audit => {
      const driver = firstObject(firstValue(audit, ["driver"]));
      const operator = firstObject(firstValue(audit, ["operator"]));
      const transporter = firstObject(firstValue(audit, ["transporter"]));
      const vehicle = firstObject(firstValue(audit, ["vehicle"]));
      const carrier = firstObject(firstValue(audit, ["carrier"]));
      const rawUnits = firstValue(audit, ["units"], []);
      const units = normalizeUnits(rawUnits);
      const existingUnitCounts = firstValue(audit, ["unitCounts"], null);
      const unitCounts = existingUnitCounts && typeof existingUnitCounts === "object"
        ? { ...existingUnitCounts }
        : countUnits(units);

      return {
        auditId: firstValue(audit, ["auditId", "id"]),
        facilityId: firstValue(audit, ["facilityId", "facility_id"]),
        auditStatus: toText(firstValue(audit, ["auditStatus", "status"])),
        auditType: toText(firstValue(audit, ["auditType", "audit_type"])),
        routeId: firstValue(audit, ["routeId", "route_id"], firstValue(driver, ["routeId", "route_id"])),
        routeName: toText(
          firstValue(audit, ["routeName"])
          || firstValue(audit, ["route_name"])
          || firstValue(driver, ["cluster_id"])
          || firstValue(driver, ["clusterId"])
          || firstValue(driver, ["route_name"])
          || firstValue(driver, ["routeName"])
        ),
        operatorId: firstValue(audit, ["operatorId", "operator_id"], firstValue(operator, ["operatorId", "operator_id", "id"])),
        operatorName: toText(firstValue(audit, ["operatorName"], joinName(
          firstValue(operator, ["name", "first_name"]),
          firstValue(operator, ["last_name", "lastName"])
        ))),
        driverId: firstValue(audit, ["driverId"], firstValue(driver, ["driverId", "driver_id", "id"])),
        driverName: toText(firstValue(audit, ["driverName"], joinName(
          firstValue(transporter, ["first_name", "firstName", "name"]),
          firstValue(transporter, ["last_name", "lastName"])
        ) || joinName(
          firstValue(driver, ["first_name", "firstName", "name"]),
          firstValue(driver, ["last_name", "lastName"])
        ))),
        vehicleId: firstValue(audit, ["vehicleId"], firstValue(driver, ["vehicleId", "vehicle_id"], firstValue(vehicle, ["vehicleId", "vehicle_id", "id"]))),
        licensePlate: toText(firstValue(audit, ["licensePlate"], firstValue(vehicle, ["licensePlate", "license_plate"]))),
        carrierId: firstValue(audit, ["carrierId"], firstValue(driver, ["carrierId", "carrier_id"], firstValue(carrier, ["carrierId", "carrier_id", "id"]))),
        carrierName: toText(firstValue(audit, ["carrierName"], firstValue(carrier, ["displayName", "display_name", "name"]))),
        createdAt: firstValue(audit, ["createdAt", "created_at"]),
        startedAt: firstValue(audit, ["startedAt", "started_at"]),
        finishedAt: firstValue(audit, ["finishedAt", "finished_at"]),
        leftoverCount: toWholeNumber(firstValue(audit, ["leftoverCount", "leftover_count"])),
        totalUnits: toWholeNumber(firstValue(audit, ["totalUnits", "total_units"], units.length)),
        unitCounts,
        units
      };
    });
  }

  function auditTimestamp(audit) {
    const preferredTime = audit.startedAt || audit.createdAt;
    const timestamp = new Date(preferredTime || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function latestAuditsByRoute(audits) {
    return audits.reduce((latest, audit) => {
      const key = routeKey(audit.routeId);
      if (!key) return latest;

      const current = latest.get(key);
      if (!current || auditTimestamp(audit) >= auditTimestamp(current)) latest.set(key, audit);
      return latest;
    }, new Map());
  }

  function mergeOperationalData(dispatchSource, auditSource) {
    const dispatch = normalizeDispatch(dispatchSource);
    const audits = normalizeAudit(auditSource);
    const auditsByRoute = latestAuditsByRoute(audits);

    function consolidateRoute(route, audit) {
      const unitCounts = audit ? { ...audit.unitCounts } : {};

      return {
        routeId: route?.routeId ?? audit?.routeId ?? "",
        routeName: route?.routeName || audit?.routeName || "",
        dockNumber: route ? route.dockNumber : null,
        process: route?.process || "",
        processOriginal: route?.processOriginal || "",
        processLabel: route?.processLabel || "",
        startTimeSeconds: route ? route.startTimeSeconds : null,
        startTime: route?.startTime || "",
        totalElapsedTimeSeconds: route ? route.totalElapsedTimeSeconds : null,
        totalElapsedTime: route?.totalElapsedTime || "",
        startTimeMeaning: route?.startTimeMeaning || "",
        totalElapsedTimeMeaning: route?.totalElapsedTimeMeaning || "",
        audit,
        auditId: audit?.auditId ?? null,
        auditStatus: audit?.auditStatus || "",
        repId: audit?.operatorId ?? null,
        rep: audit?.operatorName || "",
        driverId: audit?.driverId ?? null,
        driverName: audit?.driverName || "",
        vehicleId: audit?.vehicleId ?? null,
        licensePlate: audit?.licensePlate || "",
        carrierId: audit?.carrierId ?? null,
        carrierName: audit?.carrierName || "",
        units: audit?.totalUnits || 0,
        totalUnits: audit?.totalUnits || 0,
        unitCounts,
        leftover: audit?.leftoverCount || 0,
        leftoverCount: audit?.leftoverCount || 0
      };
    }

    const consolidatedRoutes = dispatch.map(route => {
      const audit = auditsByRoute.get(routeKey(route.routeId)) || null;
      return consolidateRoute(route, audit);
    });

    const dispatchRouteIds = new Set(dispatch.map(route => routeKey(route.routeId)).filter(Boolean));
    auditsByRoute.forEach((audit, key) => {
      if (!dispatchRouteIds.has(key)) consolidatedRoutes.push(consolidateRoute(null, audit));
    });

    return consolidatedRoutes;
  }

  function buildOperationalSnapshot({ waves = [], dispatch = [], audits = [] } = {}) {
    const normalizedWaves = normalizeWaves(waves);
    const plannedRoutes = normalizedWaves.reduce((total, wave) => total + wave.plannedRoutes, 0);
    const dispatchedRoutes = normalizedWaves.reduce((total, wave) => total + wave.dispatchedRoutes, 0);
    const pendingRoutes = normalizedWaves.reduce((total, wave) => total + wave.pendingRoutes, 0);

    return {
      generatedAt: new Date().toISOString(),
      waves: normalizedWaves,
      waveTotals: {
        plannedRoutes,
        dispatchedRoutes,
        pendingRoutes,
        progress: progressPercent(dispatchedRoutes, plannedRoutes),
        isFinished: plannedRoutes > 0 && pendingRoutes === 0 && dispatchedRoutes >= plannedRoutes
      },
      routes: mergeOperationalData(dispatch, audits)
    };
  }

  const api = Object.freeze({
    PROCESS_MAP,
    formatSeconds,
    normalizeWaves,
    normalizeDispatch,
    normalizeAudit,
    mergeOperationalData,
    buildOperationalSnapshot
  });

  global.PainelIntegracaoOperacional = api;
})(typeof window !== "undefined" ? window : globalThis);
