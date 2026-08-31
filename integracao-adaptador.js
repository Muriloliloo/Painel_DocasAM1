(function exposeOperationalAdapter(global) {
  "use strict";

  const STATUS_MAP = Object.freeze({
    customs_in_progress: "Em aduana",
    loading_packages: "Guardando",
    dispatched: "Expedida"
  });

  const PROCESS_LABEL_MAP = Object.freeze({
    ADUANA: "Em aduana",
    CARREGAMENTO: "Guardando",
    EXPEDIDA: "Expedida"
  });

  function toText(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function firstValue(source, keys, fallback = "") {
    if (!source || typeof source !== "object") return fallback;

    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
    }

    return fallback;
  }

  function numberOrNull(value) {
    if (value === "" || value === undefined || value === null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function nonNegativeIntegerOrNull(value) {
    const number = numberOrNull(value);
    return number === null ? null : Math.max(0, Math.floor(number));
  }

  function normalizeDock(value) {
    const number = numberOrNull(value);
    if (number === null || number <= 0 || !Number.isInteger(number)) return "";
    return String(number);
  }

  function normalizeUnitCounts(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};

    return Object.entries(value).reduce((counts, [status, count]) => {
      const normalizedCount = nonNegativeIntegerOrNull(count);
      if (toText(status) && normalizedCount !== null) counts[toText(status)] = normalizedCount;
      return counts;
    }, {});
  }

  function unitSummary(unitCounts) {
    return Object.entries(unitCounts)
      .map(([status, count]) => `${status}: ${count}`)
      .join(" | ");
  }

  function panelStatus(route) {
    const process = toText(firstValue(route, ["process", "processOriginal"])).toLowerCase();
    if (STATUS_MAP[process]) return STATUS_MAP[process];

    const processLabel = toText(firstValue(route, ["processLabel"])).toUpperCase();
    return PROCESS_LABEL_MAP[processLabel] || "";
  }

  function adaptRoute(route = {}) {
    const routeId = firstValue(route, ["routeId", "idRota"]);
    const routeName = toText(firstValue(route, ["routeName", "rota"]));
    const dockNumber = numberOrNull(firstValue(route, ["dockNumber", "doca"], null));
    const process = toText(firstValue(route, ["process", "processOriginal"]));
    const processLabel = toText(firstValue(route, ["processLabel"]));
    const status = panelStatus(route);
    const startTimeSeconds = nonNegativeIntegerOrNull(firstValue(route, ["startTimeSeconds"], null));
    const startTime = toText(firstValue(route, ["startTime", "tempoProcesso"]));
    const totalElapsedTimeSeconds = nonNegativeIntegerOrNull(firstValue(route, ["totalElapsedTimeSeconds"], null));
    const totalElapsedTime = toText(firstValue(route, ["totalElapsedTime", "tempoTotal"]));
    const rep = toText(firstValue(route, ["rep", "repLog"]));
    const driverName = toText(firstValue(route, ["driverName", "motorista"]));
    const licensePlate = toText(firstValue(route, ["licensePlate", "placa"]));
    const carrierName = toText(firstValue(route, ["carrierName", "transportadora"]));
    const unitCounts = normalizeUnitCounts(firstValue(route, ["unitCounts"], {}));
    const totalUnits = nonNegativeIntegerOrNull(firstValue(route, ["totalUnits", "units"], null));
    const leftoverCount = nonNegativeIntegerOrNull(firstValue(route, ["leftoverCount", "leftover"], null));
    const auditedUnits = nonNegativeIntegerOrNull(unitCounts.audited);

    return {
      routeId,
      routeName,
      idRota: routeId,
      rota: routeName,
      waveId: firstValue(route, ["waveId"]),
      onda: toText(firstValue(route, ["waveName", "onda"])),
      dockNumber,
      doca: normalizeDock(dockNumber),
      process,
      processLabel,
      processo: status,
      status,
      startTimeSeconds,
      startTime,
      tempoProcesso: startTime,
      totalElapsedTimeSeconds,
      totalElapsedTime,
      tempoTotal: totalElapsedTime,
      startTimeMeaning: toText(firstValue(route, ["startTimeMeaning"])),
      totalElapsedTimeMeaning: toText(firstValue(route, ["totalElapsedTimeMeaning"])),
      auditId: firstValue(route, ["auditId"], null),
      auditStatus: toText(firstValue(route, ["auditStatus"])),
      estadoAduana: toText(firstValue(route, ["auditStatus", "estadoAduana"])),
      rep,
      repId: firstValue(route, ["repId"], null),
      repLog: rep,
      driverName,
      driverId: firstValue(route, ["driverId"], null),
      motorista: driverName,
      licensePlate,
      vehicleId: firstValue(route, ["vehicleId"], null),
      placa: licensePlate,
      carrierName,
      carrierId: firstValue(route, ["carrierId"], null),
      transportadora: carrierName,
      totalUnits,
      unitCounts,
      aduanaUnidades: unitSummary(unitCounts) || (totalUnits === null ? "" : String(totalUnits)),
      aduanaBipadas: auditedUnits === null ? "" : String(auditedUnits),
      leftoverCount,
      auditTime: status === "Em aduana" ? startTime : ""
    };
  }

  function adaptRoutes(routes = []) {
    return Array.isArray(routes) ? routes.map(adaptRoute) : [];
  }

  function adaptSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.routes)) {
      throw new TypeError("O snapshot operacional é inválido.");
    }

    return {
      generatedAt: toText(snapshot.generatedAt),
      waves: Array.isArray(snapshot.waves) ? snapshot.waves.map(wave => ({ ...wave })) : [],
      waveTotals: snapshot.waveTotals && typeof snapshot.waveTotals === "object"
        ? { ...snapshot.waveTotals }
        : {},
      routes: adaptRoutes(snapshot.routes)
    };
  }

  global.PainelIntegracaoAdaptador = Object.freeze({
    STATUS_MAP,
    adaptRoute,
    adaptRoutes,
    adaptSnapshot
  });
})(typeof window !== "undefined" ? window : globalThis);
