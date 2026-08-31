"use strict";

const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { loadConfig } = require("./config");
const { loadOperationalSnapshot } = require("./operational-service");
const { sanitizeOperationalData } = require("./sanitize-operational-data");

const CONTEXT_LIMITS = Object.freeze({
  facilityId: 64,
  cycle: 64,
  date: 10,
  wave: 32
});

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

function createRequestHandler(options = {}) {
  const config = options.config || loadConfig();
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

    const knownPath = parsedUrl.pathname === "/health" || parsedUrl.pathname === "/operational-snapshot";
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

    if (parsedUrl.pathname !== "/operational-snapshot") {
      sendJson(response, 404, { error: "Recurso não encontrado." });
      return;
    }
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET, OPTIONS");
      sendJson(response, 405, { error: "Método não permitido." });
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

function startServer() {
  const config = loadConfig();
  const server = createServer({ config });
  server.listen(config.port, "127.0.0.1", () => {
    console.log(`Backend local de referência ativo na porta ${config.port}.`);
  });
  return server;
}

if (require.main === module) startServer();

module.exports = {
  CONTEXT_LIMITS,
  ContextValidationError,
  createRequestHandler,
  createServer,
  operationalContext,
  startServer
};
