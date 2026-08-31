(function exposeIntegrationSource(global) {
  "use strict";

  const DEFAULT_INTERVAL_MS = 30000;
  const MIN_INTERVAL_MS = 10000;

  let provider = null;
  let context = {};
  let intervalMs = DEFAULT_INTERVAL_MS;
  let running = false;
  let timerId = null;
  let activeRefreshPromise = null;
  let requestSequence = 0;
  let latestAppliedSequence = 0;
  let sourceGeneration = 0;

  const refreshState = {
    isRefreshing: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    successfulRefreshes: 0,
    failedRefreshes: 0
  };

  function timestamp() {
    return new Date().toISOString();
  }

  function cloneValue(value, seen = new WeakMap()) {
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (seen.has(value)) return seen.get(value);

    const copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    Object.keys(value).forEach(key => {
      copy[key] = cloneValue(value[key], seen);
    });
    return copy;
  }

  function sanitizedErrorMessage(error) {
    const rawMessage = error && typeof error.message === "string"
      ? error.message
      : "Falha ao atualizar a integração operacional.";
    const message = rawMessage.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    return (message || "Falha ao atualizar a integração operacional.").slice(0, 240);
  }

  function emit(name, detail) {
    if (typeof global.dispatchEvent !== "function" || typeof global.CustomEvent !== "function") return;
    global.dispatchEvent(new global.CustomEvent(name, { detail }));
  }

  function getStatus() {
    return {
      running,
      isRefreshing: refreshState.isRefreshing,
      lastAttemptAt: refreshState.lastAttemptAt,
      lastSuccessAt: refreshState.lastSuccessAt,
      lastErrorAt: refreshState.lastErrorAt,
      lastError: refreshState.lastError,
      successfulRefreshes: refreshState.successfulRefreshes,
      failedRefreshes: refreshState.failedRefreshes,
      intervalMs,
      hasProvider: Boolean(provider)
    };
  }

  function emitState() {
    emit("painel:integration-source-state", getStatus());
  }

  function getBridge() {
    const bridge = global.PainelIntegracaoBridge;
    if (!bridge || typeof bridge.ingest !== "function") {
      throw new Error("A ponte da integração operacional não está disponível.");
    }
    return bridge;
  }

  function currentBridgeSnapshot() {
    const bridge = global.PainelIntegracaoBridge;
    return bridge && typeof bridge.getSnapshot === "function" ? bridge.getSnapshot() : null;
  }

  function validateProvider(candidate) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.load !== "function") {
      throw new TypeError("O provider da integração deve possuir uma função load().");
    }
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("O provider deve retornar um objeto operacional válido.");
    }

    const requiredSources = ["waves", "dispatch", "audits"];
    const invalidSource = requiredSources.find(source => !Array.isArray(payload[source]));
    if (invalidSource) {
      throw new TypeError(`O campo ${invalidSource} retornado pelo provider deve ser um array.`);
    }

    return payload;
  }

  function setProvider(nextProvider) {
    validateProvider(nextProvider);
    provider = nextProvider;
    sourceGeneration += 1;
    emitState();
    return true;
  }

  function clearScheduledTimer() {
    if (timerId === null) return;
    if (typeof global.clearTimeout === "function") global.clearTimeout(timerId);
    timerId = null;
  }

  function stop() {
    running = false;
    clearScheduledTimer();
    emitState();
    return false;
  }

  function clearProvider() {
    provider = null;
    sourceGeneration += 1;
    stop();
    return false;
  }

  function setContext(nextContext) {
    if (!nextContext || typeof nextContext !== "object" || Array.isArray(nextContext)) {
      throw new TypeError("O contexto da integração deve ser um objeto.");
    }
    context = cloneValue(nextContext);
    sourceGeneration += 1;
    emitState();
    return getContext();
  }

  function getContext() {
    return cloneValue(context);
  }

  function scheduleNext() {
    clearScheduledTimer();
    if (!running) return;
    if (typeof global.setTimeout !== "function") {
      running = false;
      throw new Error("O ambiente atual não oferece suporte a temporizadores.");
    }

    timerId = global.setTimeout(() => {
      timerId = null;
      const refresh = refreshNow();
      refresh.then(
        () => {
          if (running) scheduleNext();
        },
        () => {
          if (running) scheduleNext();
        }
      );
    }, intervalMs);
    emitState();
  }

  function setIntervalMs(value) {
    if (!Number.isInteger(value) || value < MIN_INTERVAL_MS) {
      throw new RangeError(`O intervalo deve ser um número inteiro de pelo menos ${MIN_INTERVAL_MS} ms.`);
    }
    intervalMs = value;
    if (running && timerId !== null) scheduleNext();
    else emitState();
    return intervalMs;
  }

  function getIntervalMs() {
    return intervalMs;
  }

  function refreshNow() {
    if (activeRefreshPromise) return activeRefreshPromise;
    validateProvider(provider);

    const providerForRequest = provider;
    const contextForRequest = getContext();
    const requestId = ++requestSequence;
    const generation = sourceGeneration;
    refreshState.isRefreshing = true;
    refreshState.lastAttemptAt = timestamp();
    emitState();

    const refresh = (async () => {
      try {
        const payload = validatePayload(await providerForRequest.load(contextForRequest));

        // Esta guarda impede que uma resposta de uma configuração antiga sobrescreva outra mais nova.
        if (generation !== sourceGeneration || requestId < latestAppliedSequence) {
          return currentBridgeSnapshot();
        }

        const snapshot = getBridge().ingest(payload);
        latestAppliedSequence = requestId;
        refreshState.lastSuccessAt = timestamp();
        refreshState.lastError = null;
        refreshState.successfulRefreshes += 1;
        emit("painel:integration-refresh-success", {
          at: refreshState.lastSuccessAt,
          successfulRefreshes: refreshState.successfulRefreshes,
          snapshotGeneratedAt: snapshot && snapshot.generatedAt ? snapshot.generatedAt : null
        });
        return snapshot;
      } catch (error) {
        refreshState.lastErrorAt = timestamp();
        refreshState.lastError = sanitizedErrorMessage(error);
        refreshState.failedRefreshes += 1;
        emit("painel:integration-refresh-error", {
          at: refreshState.lastErrorAt,
          message: refreshState.lastError,
          failedRefreshes: refreshState.failedRefreshes
        });
        throw error;
      } finally {
        refreshState.isRefreshing = false;
      }
    })();

    let trackedRefresh;
    trackedRefresh = refresh.finally(() => {
      if (activeRefreshPromise === trackedRefresh) activeRefreshPromise = null;
      emitState();
    });
    activeRefreshPromise = trackedRefresh;
    return trackedRefresh;
  }

  function start() {
    validateProvider(provider);
    if (running) return activeRefreshPromise || Promise.resolve(currentBridgeSnapshot());

    running = true;
    emitState();
    const immediateRefresh = refreshNow();
    immediateRefresh.then(
      () => {
        if (running) scheduleNext();
      },
      () => {
        if (running) scheduleNext();
      }
    );
    return immediateRefresh;
  }

  function isRunning() {
    return running;
  }

  global.PainelIntegracaoFonte = Object.freeze({
    DEFAULT_INTERVAL_MS,
    MIN_INTERVAL_MS,
    setProvider,
    clearProvider,
    setContext,
    getContext,
    setIntervalMs,
    getIntervalMs,
    start,
    stop,
    refreshNow,
    isRunning,
    getStatus
  });
})(typeof window !== "undefined" ? window : globalThis);
