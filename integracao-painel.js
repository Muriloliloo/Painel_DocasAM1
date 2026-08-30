(function exposeOperationalBridge(global) {
  "use strict";

  let currentSnapshot = null;
  let lastUpdatedAt = null;
  let snapshotAvailable = false;

  function getSnapshotBuilder() {
    const integration = global.PainelIntegracaoOperacional;
    if (!integration || typeof integration.buildOperationalSnapshot !== "function") {
      throw new Error("A camada de integração operacional não está disponível.");
    }

    return integration.buildOperationalSnapshot;
  }

  function isValidSnapshot(snapshot) {
    return Boolean(
      snapshot
      && typeof snapshot === "object"
      && Array.isArray(snapshot.waves)
      && snapshot.waveTotals
      && typeof snapshot.waveTotals === "object"
      && Array.isArray(snapshot.routes)
    );
  }

  function emitSnapshot(snapshot) {
    if (typeof global.dispatchEvent !== "function" || typeof global.CustomEvent !== "function") return;

    global.dispatchEvent(new global.CustomEvent("painel:operational-snapshot", {
      detail: snapshot
    }));
  }

  function ingest(payload = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("O payload operacional deve ser um objeto.");
    }

    const buildOperationalSnapshot = getSnapshotBuilder();
    const snapshot = buildOperationalSnapshot({
      waves: payload.waves || [],
      dispatch: payload.dispatch || [],
      audits: payload.audits || []
    });

    if (!isValidSnapshot(snapshot)) {
      throw new Error("A camada operacional retornou um snapshot inválido.");
    }

    currentSnapshot = snapshot;
    lastUpdatedAt = snapshot.generatedAt || new Date().toISOString();
    snapshotAvailable = true;
    emitSnapshot(snapshot);

    return snapshot;
  }

  function getSnapshot() {
    return currentSnapshot;
  }

  function clear() {
    currentSnapshot = null;
    lastUpdatedAt = null;
    snapshotAvailable = false;
  }

  function hasSnapshot() {
    return snapshotAvailable && Boolean(lastUpdatedAt) && currentSnapshot !== null;
  }

  global.PainelIntegracaoBridge = Object.freeze({
    ingest,
    getSnapshot,
    clear,
    hasSnapshot
  });
})(typeof window !== "undefined" ? window : globalThis);
