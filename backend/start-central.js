"use strict";

const {
  assertCentralConfig,
  loadConfig
} = require("./config");
const { LOOPBACK_HOST, createServer } = require("./server");
const { createSnapshotManager } = require("./snapshot-manager");

const CENTRAL_NOT_CONFIGURED_MESSAGE =
  "Backend central não iniciado: fonte operacional autorizada não configurada.";

function createCentralRuntime(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("As opções do backend central devem ser um objeto.");
  }
  if (typeof options.loader !== "function" && !options.snapshotManager) {
    throw new Error(CENTRAL_NOT_CONFIGURED_MESSAGE);
  }

  const config = assertCentralConfig(options.config || loadConfig(options.env || process.env));
  const snapshotManager = options.snapshotManager || createSnapshotManager({
    loader: options.loader,
    context: options.context || {},
    refreshIntervalMs: config.snapshotRefreshMs
  });
  const server = createServer({ config, snapshotManager });
  return Object.freeze({ config, server, snapshotManager });
}

function startCentralServer(options = {}) {
  const host = options.host || LOOPBACK_HOST;
  if (host !== LOOPBACK_HOST) {
    throw new Error("Bind externo do backend central ainda não está habilitado.");
  }

  const runtime = createCentralRuntime(options);
  const logger = options.logger || console;
  runtime.server.once("error", () => {
    runtime.snapshotManager.stop();
    if (logger && typeof logger.error === "function") {
      logger.error("Backend central não iniciado: falha ao abrir a porta local.");
    }
  });
  runtime.server.listen(runtime.config.port, host, () => {
    if (logger && typeof logger.log === "function") {
      logger.log(`Backend central de referência ativo em http://${host}:${runtime.config.port}`);
    }
  });
  runtime.snapshotManager.start().catch(() => {
    // O manager permanece ativo e agenda a próxima tentativa sem expor o erro bruto.
  });
  return runtime;
}

if (require.main === module) {
  console.error(CENTRAL_NOT_CONFIGURED_MESSAGE);
  process.exitCode = 1;
}

module.exports = {
  CENTRAL_NOT_CONFIGURED_MESSAGE,
  createCentralRuntime,
  startCentralServer
};
