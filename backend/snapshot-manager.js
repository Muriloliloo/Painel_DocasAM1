"use strict";

const {
  DEFAULT_SNAPSHOT_REFRESH_MS,
  MAX_SNAPSHOT_REFRESH_MS,
  MIN_SNAPSHOT_REFRESH_MS,
  parseSnapshotRefreshMs
} = require("./config");
const { sanitizeOperationalData } = require("./sanitize-operational-data");

const CONTEXT_LIMITS = Object.freeze({
  facilityId: 64,
  cycle: 64,
  date: 10,
  wave: 32
});

function cloneValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  return Object.keys(value).reduce((copy, key) => {
    copy[key] = cloneValue(value[key]);
    return copy;
  }, {});
}

function timestamp(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Relógio inválido para o Snapshot Manager.");
  return date.toISOString();
}

function normalizeContext(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("O contexto central deve ser um objeto.");
  }

  return Object.keys(CONTEXT_LIMITS).reduce((context, field) => {
    const rawValue = source[field];
    if (rawValue === undefined || rawValue === null || rawValue === "") return context;
    if (!["string", "number", "boolean"].includes(typeof rawValue)) {
      throw new TypeError("O contexto central contém um valor inválido.");
    }
    const value = String(rawValue).trim();
    if (!value) return context;
    if (value.length > CONTEXT_LIMITS[field] || /[\u0000-\u001F\u007F]/.test(value)) {
      throw new RangeError("O contexto central excede os limites permitidos.");
    }
    if (field === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new TypeError("A data do contexto central deve usar YYYY-MM-DD.");
      }
      const parsed = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new TypeError("A data do contexto central é inválida.");
      }
    }
    context[field] = value;
    return context;
  }, {});
}

function validateLoaderPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("O loader central retornou um payload inválido.");
  }
  if (!Array.isArray(payload.waves)
    || !Array.isArray(payload.dispatch)
    || !Array.isArray(payload.audits)) {
    throw new TypeError("O loader central deve retornar waves, dispatch e audits como arrays.");
  }
  return payload;
}

function contextsEqual(left, right) {
  return Object.keys(CONTEXT_LIMITS).every(field => left[field] === right[field]);
}

function createSnapshotManager(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("As opções do Snapshot Manager devem ser um objeto.");
  }
  if (typeof options.loader !== "function") {
    throw new TypeError("O Snapshot Manager exige um loader operacional injetado.");
  }

  const loader = options.loader;
  const refreshIntervalMs = parseSnapshotRefreshMs(
    options.refreshIntervalMs === undefined
      ? DEFAULT_SNAPSHOT_REFRESH_MS
      : options.refreshIntervalMs
  );
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const now = options.now || (() => new Date());

  let context = normalizeContext(options.context || {});
  let generation = 0;
  let running = false;
  let ready = false;
  let refreshing = false;
  let timerId = null;
  let activeRefreshPromise = null;
  let snapshotState = null;

  const refreshState = {
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    successfulRefreshes: 0,
    failedRefreshes: 0
  };

  function clearScheduledTimer() {
    if (timerId === null) return;
    clearTimer(timerId);
    timerId = null;
  }

  function getSnapshot() {
    return ready && snapshotState ? cloneValue(snapshotState.data) : null;
  }

  function getStatus() {
    return {
      running,
      ready,
      refreshing,
      lastAttemptAt: refreshState.lastAttemptAt,
      lastSuccessAt: refreshState.lastSuccessAt,
      lastErrorAt: refreshState.lastErrorAt,
      successfulRefreshes: refreshState.successfulRefreshes,
      failedRefreshes: refreshState.failedRefreshes,
      refreshIntervalMs
    };
  }

  function getContext() {
    return cloneValue(context);
  }

  function setContext(nextContext) {
    const normalized = normalizeContext(nextContext);
    if (contextsEqual(context, normalized)) return getContext();

    context = normalized;
    generation += 1;
    ready = false;
    snapshotState = null;
    refreshState.lastSuccessAt = null;
    return getContext();
  }

  function refreshNow() {
    if (activeRefreshPromise) return activeRefreshPromise;

    const requestGeneration = generation;
    const requestContext = getContext();
    refreshing = true;
    refreshState.lastAttemptAt = timestamp(now);

    const refresh = (async () => {
      try {
        const rawPayload = validateLoaderPayload(await loader(requestContext));
        const sanitized = sanitizeOperationalData(rawPayload);
        if (requestGeneration !== generation) return null;

        const refreshedAt = timestamp(now);
        snapshotState = {
          data: sanitized,
          generatedAt: refreshedAt,
          refreshedAt
        };
        ready = true;
        refreshState.lastSuccessAt = refreshedAt;
        refreshState.successfulRefreshes += 1;
        return getSnapshot();
      } catch (error) {
        if (requestGeneration === generation) {
          refreshState.lastErrorAt = timestamp(now);
          refreshState.failedRefreshes += 1;
        }
        throw error;
      } finally {
        refreshing = false;
      }
    })();

    let trackedRefresh;
    trackedRefresh = refresh.finally(() => {
      if (activeRefreshPromise === trackedRefresh) activeRefreshPromise = null;
    });
    activeRefreshPromise = trackedRefresh;
    return trackedRefresh;
  }

  function scheduleNext() {
    clearScheduledTimer();
    if (!running) return;
    timerId = setTimer(() => {
      timerId = null;
      runScheduledCycle();
    }, refreshIntervalMs);
  }

  function runScheduledCycle() {
    const refresh = refreshNow();
    refresh.then(scheduleNext, scheduleNext);
    return refresh;
  }

  function start() {
    if (running) return activeRefreshPromise || Promise.resolve(getSnapshot());
    running = true;
    return runScheduledCycle();
  }

  function stop() {
    running = false;
    clearScheduledTimer();
    return false;
  }

  return Object.freeze({
    start,
    stop,
    refreshNow,
    getSnapshot,
    getStatus,
    setContext,
    getContext
  });
}

module.exports = {
  CONTEXT_LIMITS,
  DEFAULT_SNAPSHOT_REFRESH_MS,
  MAX_SNAPSHOT_REFRESH_MS,
  MIN_SNAPSHOT_REFRESH_MS,
  createSnapshotManager,
  normalizeContext,
  validateLoaderPayload
};
