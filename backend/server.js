"use strict";

const http = require("node:http");
const { randomUUID } = require("node:crypto");
const {
  assertCentralConfig,
  assertLocalFixtureConfig,
  loadConfig
} = require("./config");
const { loadOperationalSnapshot } = require("./operational-service");
const { sanitizeOperationalData } = require("./sanitize-operational-data");

const CONTEXT_LIMITS = Object.freeze({
  facilityId: 64,
  cycle: 64,
  date: 10,
  wave: 32
});
const LOOPBACK_HOST = "127.0.0.1";

class ContextValidationError extends Error {}

function safeContextValue(field, value) {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  if (text.length > CONTEXT_LIMITS[field] || /[\u0000-\u001F\u007F]/.test(text)) {
    throw new ContextValidationError("Contexto operacional inválido.");
  }
  if (field === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      throw new ContextValidationError("Contexto operacional inválido.");
    }
    const parsed = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
      throw new ContextValidationError("Contexto operacional inválido.");
    }
  }
  return text;
}

function operationalContext(searchParams) {
  const context = {};
  Object.keys(CONTEXT_LIMITS).forEach(field => {
    const value = safeContextValue(field, searchParams.get(field));
    if (value) context[field] = value;
  });
  return context;
}

function applyCommonHeaders(response, request, requestId, allowedOrigins) {
  response.setHeader("X-Request-Id", requestId);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  const origin = request.headers.origin;
  if (origin) {
    response.setHeader("Vary", "Origin");
    if (allowedOrigins.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  }
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendOptions(response) {
  response.statusCode = 204;
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
  response.end();
}

function validateSnapshotManager(manager) {
  if (!manager
    || typeof manager.getSnapshot !== "function"
    || typeof manager.getStatus !== "function") {
    throw new TypeError("Snapshot Manager central inválido.");
  }
  return manager;
}

function publicSnapshot(snapshot) {
  if (!snapshot
    || typeof snapshot !== "object"
    || !Array.isArray(snapshot.waves)
    || !Array.isArray(snapshot.dispatch)
    || !Array.isArray(snapshot.audits)) {
    return null;
  }
  return {
    waves: snapshot.waves,
    dispatch: snapshot.dispatch,
    audits: snapshot.audits
  };
}

function createRequestHandler(options = {}) {
  const config = options.config || loadConfig();
  const snapshotManager = options.snapshotManager
    ? validateSnapshotManager(options.snapshotManager)
    : null;
  if (snapshotManager) assertCentralConfig(config);
  else assertLocalFixtureConfig(config);
  const operationalLoader = options.operationalLoader || loadOperationalSnapshot;
  const allowedOrigins = new Set(config.allowedOrigins || []);

  return async function requestHandler(request, response) {
    const requestId = randomUUID();
    applyCommonHeaders(response, request, requestId, allowedOrigins);

    let parsedUrl;
    try {
      parsedUrl = new URL(request.url, "http://backend-local.invalid");
    } catch {
      sendJson(response, 400, { error: "Requisição inválida." });
      return;
    }

    const knownPath = ["/health", "/ready", "/operational-snapshot"].includes(parsedUrl.pathname);
    if (request.method === "OPTIONS" && knownPath) {
      sendOptions(response);
      return;
    }

    if (parsedUrl.pathname === "/health") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET, OPTIONS");
        sendJson(response, 405, { error: "Método não permitido." });
        return;
      }
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (parsedUrl.pathname === "/ready") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET, OPTIONS");
        sendJson(response, 405, { error: "Método não permitido." });
        return;
      }
      const isReady = snapshotManager
        ? snapshotManager.getStatus().ready === true
        : true;
      sendJson(response, isReady ? 200 : 503, {
        status: isReady ? "ready" : "not_ready"
      });
      return;
    }

    if (parsedUrl.pathname !== "/operational-snapshot") {
      sendJson(response, 404, { error: "Recurso não encontrado." });
      return;
    }
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET, OPTIONS");
      sendJson(response, 405, { error: "Método não permitido." });
      return;
    }


    if (snapshotManager) {
      const status = snapshotManager.getStatus();
      const snapshot = status.ready === true
        ? publicSnapshot(snapshotManager.getSnapshot())
        : null;
      if (!snapshot) {
        sendJson(response, 503, { error: "Dados operacionais ainda não estão disponíveis." });
        return;
      }
      sendJson(response, 200, snapshot);
      return;
    }

    try {
      const context = operationalContext(parsedUrl.searchParams);
      const rawSnapshot = await operationalLoader(context, { useFixture: config.useFixture });
      sendJson(response, 200, sanitizeOperationalData(rawSnapshot));
    } catch (error) {
      if (error instanceof ContextValidationError) {
        sendJson(response, 400, { error: "Parâmetros operacionais inválidos." });
        return;
      }
      sendJson(response, 500, { error: "Não foi possível obter os dados operacionais." });
    }
  };
}

function createServer(options = {}) {
  return http.createServer(createRequestHandler(options));
}

function startupMessage(port) {
  return [
    "Backend local do Painel de Docas",
    "MODO LOCAL COM FIXTURE FICTÍCIA",
    "Modo: fixture fictícia",
    `Endereço: http://${LOOPBACK_HOST}:${port}`,
    `Health: http://${LOOPBACK_HOST}:${port}/health`
  ].join("\n");
}

function startServer(options = {}) {
  const config = assertLocalFixtureConfig(options.config || loadConfig());
  const logger = options.logger || console;
  const server = createServer({ config });
  server.listen(config.port, LOOPBACK_HOST, () => {
    if (logger && typeof logger.log === "function") logger.log(startupMessage(config.port));
  });
  return server;
}

if (require.main === module) {
  try {
    const server = startServer();
    server.once("error", () => {
      console.error("Backend não iniciado. Execute: node backend/start-local.js");
      process.exitCode = 1;
    });
  } catch {
    console.error("Backend não iniciado. Execute: node backend/start-local.js");
    process.exitCode = 1;
  }
}

module.exports = {
  CONTEXT_LIMITS,
  ContextValidationError,
  LOOPBACK_HOST,
  createRequestHandler,
  createServer,
  operationalContext,
  publicSnapshot,
  startServer,
  startupMessage,
  validateSnapshotManager
};
