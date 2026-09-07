"use strict";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createConfig } = require("../src/config");
const { createGatewayServer, validateRequestTarget } = require("../src/server");
const { createUpstreamClient } = require("../src/http/upstream-client");
const { createSafeLogger } = require("../src/logging");
const { sanitizeDispatch } = require("../src/sanitizers/dispatch");
const { sanitizeCustoms } = require("../src/sanitizers/customs");

let server;
let baseUrl;

function testConfig(overrides = {}) {
  return createConfig({}, {
    port: 0,
    nodeEnv: "development",
    mode: "mock",
    authMode: "unconfigured",
    mockScenario: "normal",
    allowedOrigins: ["http://localhost:8000"],
    allowedFacilityIds: ["SSP15"],
    allowedSiteIds: ["MLB"],
    allowedCycles: ["AM1"],
    allowedWaves: ["1", "2", "3", "4", "5"],
    upstreamTimeoutMs: 80,
    mockDelayMs: 1,
    mockTimeoutDelayMs: 200,
    ...overrides
  });
}

function query(extra = "") {
  const base = "facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&timezone=America%2FSao_Paulo&waves=1,2,3,4,5";
  return `${base}${extra}`;
}

async function jsonRequest(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { response, body: await response.json() };
}

async function withGateway(config, dependencies, operation) {
  const temporaryServer = createGatewayServer(config, dependencies);
  await new Promise(resolve => temporaryServer.listen(0, "127.0.0.1", resolve));
  const temporaryUrl = `http://127.0.0.1:${temporaryServer.address().port}`;
  try {
    return await operation(temporaryUrl);
  } finally {
    await new Promise(resolve => temporaryServer.close(resolve));
  }
}

function upstreamRequest(client, config, overrides = {}) {
  return client.get({
    baseUrl: config.dispatchBaseUrl,
    path: config.dispatchPath,
    query: { facilityId: "SSP15", groupId: "TESTE", siteId: "MLB", wave: "1" },
    allowedQueryKeys: ["facilityId", "groupId", "siteId", "wave"],
    authContext: { headers: {} },
    ...overrides
  });
}

before(async () => {
  server = createGatewayServer(testConfig());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("G1 /health responde 200", async () => {
  const { response, body } = await jsonRequest("/health");
  assert.equal(response.status, 200);
  assert.deepEqual(body, { status: "ok", gatewayMode: "mock", authMode: "unconfigured" });
});

test("G2 /snapshot normal respeita o contrato", async () => {
  const { response, body } = await jsonRequest(`/snapshot?${query()}`);
  assert.equal(response.status, 200);
  assert.equal(body.snapshotComplete, true);
  assert.equal(body.emptyConfirmed, false);
  assert.deepEqual(body.sources, { dispatch: "ok", aduana: "ok" });
  assert.ok(Array.isArray(body.operacional));
  assert.ok(Array.isArray(body.aduana));
});

test("G3 sanitizador Dispatch remove campos extras", () => {
  const result = sanitizeDispatch({
    route_name: "VT9_AM1",
    route_id: 1,
    process: "loading_packages",
    cpf: "remove",
    email: "remove",
    authorization: "remove",
    cookie: "remove",
    token: "remove",
    internal_secret: "remove"
  });
  assert.deepEqual(Object.keys(result), ["route_name", "route_id", "process", "dock_number", "start_time", "total_elapsed_time"]);
  for (const field of ["cpf", "email", "authorization", "cookie", "token", "internal_secret"]) {
    assert.equal(field in result, false);
  }
});

test("G4 sanitizador Aduana remove CPF, email e telefone", () => {
  const result = sanitizeCustoms({
    route_name: "VT9_AM1",
    cpf: "remove",
    document: "remove",
    email: "remove",
    phone: "remove",
    telefone: "remove",
    authorization: "remove",
    cookie: "remove",
    token: "remove",
    headers: "remove",
    internal_secret: "remove"
  });
  for (const field of ["cpf", "document", "email", "phone", "telefone", "authorization", "cookie", "token", "headers", "internal_secret"]) {
    assert.equal(field in result, false);
  }
});

test("G5 sanitizador Aduana preserva 0 e string 0", () => {
  const numeric = sanitizeCustoms({ aduanaUnidades: 0, aduanaBipadas: 0 });
  const textual = sanitizeCustoms({ aduanaUnidades: "0", aduanaBipadas: "0" });
  assert.equal(numeric.aduanaUnidades, 0);
  assert.equal(numeric.aduanaBipadas, 0);
  assert.equal(textual.aduanaUnidades, "0");
  assert.equal(textual.aduanaBipadas, "0");
});

test("G6 snapshot normal e completo", async () => {
  const { body } = await jsonRequest(`/snapshot?${query()}`);
  assert.equal(body.snapshotComplete, true);
});

test("G7 vazio nao confirmado permanece protegido", async () => {
  const { body } = await jsonRequest(`/snapshot?${query("&scenario=empty-unconfirmed")}`);
  assert.equal(body.emptyConfirmed, false);
  assert.deepEqual(body.operacional, []);
  assert.deepEqual(body.aduana, []);
});

test("G8 vazio confirmado exige cenario explicito", async () => {
  const { body } = await jsonRequest(`/snapshot?${query("&scenario=empty-confirmed")}`);
  assert.equal(body.snapshotComplete, true);
  assert.equal(body.emptyConfirmed, true);
});

test("G9 falha Dispatch nao retorna snapshot completo", async () => {
  const { response, body } = await jsonRequest(`/snapshot?${query("&scenario=failure-dispatch")}`);
  assert.equal(response.status, 502);
  assert.equal(body.snapshotComplete, false);
  assert.equal(body.sources.dispatch, "error");
});

test("G10 falha Aduana nao retorna snapshot completo", async () => {
  const { response, body } = await jsonRequest(`/snapshot?${query("&scenario=failure-customs")}`);
  assert.equal(response.status, 502);
  assert.equal(body.snapshotComplete, false);
  assert.equal(body.sources.aduana, "error");
});

test("G11 CORS aceita localhost configurado", async () => {
  const response = await fetch(`${baseUrl}/health`, { headers: { Origin: "http://localhost:8000" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:8000");
  const serverToServer = await fetch(`${baseUrl}/health`);
  assert.equal(serverToServer.status, 200);
  assert.equal(serverToServer.headers.get("access-control-allow-origin"), null);
});

test("G12 CORS rejeita origem nao autorizada", async () => {
  const { response, body } = await jsonRequest("/health", { headers: { Origin: "https://nao-autorizado.example" } });
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "ORIGIN_NOT_ALLOWED");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.throws(
    () => createConfig({ NODE_ENV: "production", GATEWAY_MODE: "mock" }),
    /PANEL_ALLOWED_ORIGIN/
  );
  assert.throws(
    () => createConfig({ NODE_ENV: "production", GATEWAY_MODE: "mock", PANEL_ALLOWED_ORIGIN: "*" }),
    /curinga/
  );
});

test("G13 POST /snapshot nao e permitido", async () => {
  const { response, body } = await jsonRequest(`/snapshot?${query()}`, { method: "POST" });
  assert.equal(response.status, 405);
  assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
});

test("G14 parametros invalidos sao rejeitados", async () => {
  const { response, body } = await jsonRequest(`/snapshot?${query("&targetUrl=https%3A%2F%2Finterno.example")}`);
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_QUERY");
  const excessiveWaves = Array.from({ length: 100 }, (_, index) => String(index % 5 + 1)).join(",");
  const excessive = await jsonRequest(`/snapshot?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&timezone=America%2FSao_Paulo&waves=${excessiveWaves}`);
  assert.equal(excessive.response.status, 400);
  const giant = await jsonRequest(`/snapshot?groupId=${"A".repeat(3000)}`);
  assert.equal(giant.response.status, 414);
  for (const target of ["/../snapshot", "/%2e%2e/snapshot", "//internal.example/snapshot", "/snapshot%0d%0a"]) {
    assert.throws(() => validateRequestTarget(target));
  }
});

test("G15 timeout do mock e tratado", async () => {
  const { response, body } = await jsonRequest(`/snapshot?${query("&scenario=timeout")}`);
  assert.equal(response.status, 504);
  assert.equal(body.snapshotComplete, false);
  assert.equal(body.error.code, "UPSTREAM_TIMEOUT");
  const health = await jsonRequest("/health");
  assert.equal(health.response.status, 200);
});

test("G16 resposta nao contem nomes de campos sensiveis", async () => {
  const { body } = await jsonRequest(`/snapshot?${query()}`);
  const serialized = JSON.stringify(body).toLowerCase();
  for (const forbidden of ["authorization", "cookie", "token", "csrf", "cpf", "email", "telefone"]) {
    assert.equal(serialized.includes(forbidden), false, `campo proibido encontrado: ${forbidden}`);
  }
  for (const header of ["Authorization", "Cookie", "X-CSRF-Token"]) {
    const rejected = await jsonRequest(`/snapshot?${query()}`, { headers: { [header]: "valor-nao-secreto-de-teste" } });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.error.code, "SENSITIVE_HEADER_REJECTED");
  }
});

test("G17 producao nao retorna stack interna", async () => {
  const productionServer = createGatewayServer(testConfig({ nodeEnv: "production", mode: "real" }));
  await new Promise(resolve => productionServer.listen(0, "127.0.0.1", resolve));
  const productionUrl = `http://127.0.0.1:${productionServer.address().port}`;
  try {
    const response = await fetch(`${productionUrl}/snapshot?${query()}`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "AUTH_NOT_CONFIGURED");
    assert.equal("stack" in body, false);
    assert.equal(JSON.stringify(body).includes("at "), false);
  } finally {
    await new Promise(resolve => productionServer.close(resolve));
  }
});

test("A1 real com auth unconfigured falha fechado", async () => {
  let upstreamCalls = 0;
  await withGateway(testConfig({ mode: "real", authMode: "unconfigured" }), {
    fetchImpl: async () => {
      upstreamCalls += 1;
      throw new Error("fetch upstream nao deveria ser executado");
    }
  }, async url => {
    const health = await fetch(`${url}/health`);
    const healthBody = await health.json();
    assert.equal(health.status, 200);
    assert.deepEqual(healthBody, { status: "ok", gatewayMode: "real", authMode: "unconfigured" });

    const ready = await fetch(`${url}/ready`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json()).ready, false);

    const response = await fetch(`${url}/snapshot?${query()}`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "AUTH_NOT_CONFIGURED");
    assert.equal(body.snapshotComplete, false);
  });
  assert.equal(upstreamCalls, 0);

  await withGateway(testConfig({ mode: "real" }), {
    authProvider: {
      async getAuthContext() {
        throw new Error("detalhe-sensivel-ficticio");
      }
    },
    upstreamClient: { async get() { return []; } }
  }, async url => {
    const response = await fetch(`${url}/snapshot?${query()}`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "AUTH_FAILED");
    assert.equal(JSON.stringify(body).includes("detalhe-sensivel-ficticio"), false);
  });
});

test("A2 health nao revela segredo", async () => {
  const { response, body } = await jsonRequest("/health");
  assert.equal(response.status, 200);
  const serialized = JSON.stringify(body).toLowerCase();
  for (const forbidden of ["authorization", "cookie", "token", "secret", "password", "csrf", "credential"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("A3 frontend nao escolhe destino upstream", async () => {
  for (const parameter of ["baseUrl", "host", "url", "upstreamUrl"]) {
    const { response, body } = await jsonRequest(`/snapshot?${query(`&${parameter}=destino-nao-permitido`)}`);
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "INVALID_QUERY");
  }
});

test("A4 URL upstream com usuario ou senha e rejeitada", () => {
  assert.throws(
    () => testConfig({ dispatchBaseUrl: "https://usuario:senha@envios.adminml.com" }),
    /usuario ou senha/
  );
  assert.throws(
    () => testConfig({ dispatchBaseUrl: "https://nao-autorizado.example" }),
    error => error.code === "UPSTREAM_HOST_NOT_ALLOWED"
  );
  assert.throws(
    () => testConfig({ dispatchPath: "/logistics/../destino" }),
    /caminho nao autorizado/
  );
});

test("A5 HTTP upstream inseguro e rejeitado em production", () => {
  assert.throws(
    () => testConfig({ nodeEnv: "production", dispatchBaseUrl: "http://envios.adminml.com" }),
    /HTTPS em production/
  );
  assert.throws(
    () => testConfig({ dispatchBaseUrl: "file:///destino" }),
    /protocolo HTTP\(S\)/
  );
});

test("A6 redirect upstream para outro host e rejeitado", async () => {
  const config = testConfig();
  const client = createUpstreamClient({
    config,
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: "https://nao-autorizado.example/redirect" }
    })
  });
  await assert.rejects(
    upstreamRequest(client, config),
    error => error.code === "UPSTREAM_HOST_NOT_ALLOWED"
  );
});

test("A7 headers do navegador nao sao encaminhados aos adaptadores reais", async () => {
  const calls = [];
  const dependencies = {
    authProvider: {
      async getAuthContext() {
        return { headers: { "x-official-test": "contexto-ficticio" } };
      }
    },
    upstreamClient: {
      async get(request) {
        calls.push(request);
        return [];
      }
    }
  };

  await withGateway(testConfig({ mode: "real" }), dependencies, async url => {
    const response = await fetch(`${url}/snapshot?${query()}`, {
      headers: { "X-Browser-Trace": "nao-encaminhar" }
    });
    assert.equal(response.status, 200);
  });

  assert.ok(calls.length >= 2);
  assert.equal(JSON.stringify(calls).includes("X-Browser-Trace"), false);
  assert.equal(JSON.stringify(calls).includes("nao-encaminhar"), false);

  const config = testConfig();
  let sentOptions;
  const client = createUpstreamClient({
    config,
    fetchImpl: async (_url, options) => {
      sentOptions = options;
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  await upstreamRequest(client, config, {
    authContext: { headers: { "x-official-test": "contexto-ficticio" } }
  });
  assert.deepEqual(Object.keys(sentOptions.headers).sort(), ["accept", "user-agent", "x-official-test"]);
  assert.equal(sentOptions.method, "GET");
  assert.equal(sentOptions.credentials, "omit");
  assert.equal(sentOptions.redirect, "manual");
});

test("A8 Authorization e Cookie recebidos do cliente continuam rejeitados", async () => {
  for (const header of ["Authorization", "Cookie", "X-CSRF-Token"]) {
    const { response, body } = await jsonRequest(`/snapshot?${query()}`, {
      headers: { [header]: "valor-ficticio-rejeitado" }
    });
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "SENSITIVE_HEADER_REJECTED");
  }
});

test("A9 logger mascara valores sensiveis", () => {
  const calls = [];
  const logger = createSafeLogger({ info: (...values) => calls.push(values) });
  logger.info("evento", {
    authorization: "segredo-authorization",
    nested: {
      api_key: "segredo-api-key",
      clientSecret: "segredo-client-secret",
      safe: "valor-publico"
    }
  });
  const serialized = JSON.stringify(calls);
  assert.equal(serialized.includes("segredo-authorization"), false);
  assert.equal(serialized.includes("segredo-api-key"), false);
  assert.equal(serialized.includes("segredo-client-secret"), false);
  assert.equal(serialized.includes("valor-publico"), true);
  assert.equal(serialized.includes("[REDACTED]"), true);
});

test("A10 resposta upstream acima do limite e rejeitada", async () => {
  const config = testConfig({ maxResponseBytes: 64 });
  const client = createUpstreamClient({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ data: "x".repeat(256) }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  await assert.rejects(
    upstreamRequest(client, config),
    error => error.code === "UPSTREAM_INVALID_RESPONSE" && /limite/.test(error.message)
  );
});

test("A11 timeout do cliente upstream e controlado", async () => {
  const config = testConfig({ upstreamTimeoutMs: 10 });
  const client = createUpstreamClient({
    config,
    fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("abortado")), { once: true });
    })
  });
  await assert.rejects(
    upstreamRequest(client, config),
    error => error.code === "UPSTREAM_TIMEOUT" && error.status === 504
  );
});

test("A12 resposta upstream invalida falha fechado", async () => {
  const config = testConfig();
  const invalidJsonClient = createUpstreamClient({
    config,
    fetchImpl: async () => new Response("nao-json", {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  await assert.rejects(
    upstreamRequest(invalidJsonClient, config),
    error => error.code === "UPSTREAM_INVALID_RESPONSE"
  );

  const invalidTypeClient = createUpstreamClient({
    config,
    fetchImpl: async () => new Response("[]", {
      status: 200,
      headers: { "content-type": "text/plain" }
    })
  });
  await assert.rejects(
    upstreamRequest(invalidTypeClient, config),
    error => error.code === "UPSTREAM_INVALID_RESPONSE"
  );
});

test("A13 sanitizacao Dispatch permanece por allowlist", () => {
  const result = sanitizeDispatch({
    route_name: "TESTE1_AM1",
    route_id: 123,
    process: "loading_packages",
    cookie: "remover"
  });
  assert.deepEqual(Object.keys(result), ["route_name", "route_id", "process", "dock_number", "start_time", "total_elapsed_time"]);
  assert.equal("cookie" in result, false);
});

test("A14 sanitizacao Aduana permanece por allowlist", () => {
  const result = sanitizeCustoms({
    route_name: "TESTE1_AM1",
    route_id: 123,
    status: "in_progress",
    cpf: "remover",
    email: "remover"
  });
  assert.deepEqual(Object.keys(result), [
    "route_name", "route_id", "status", "process", "operator_name", "audit_time",
    "aduanaUnidades", "aduanaBipadas", "driver_name", "carrier_name", "plate"
  ]);
  assert.equal("cpf" in result, false);
  assert.equal("email" in result, false);
});

test("A15 modo mock permanece compativel com o frontend atual", async () => {
  const ready = await jsonRequest("/ready");
  assert.equal(ready.response.status, 200);
  assert.deepEqual(ready.body, { ready: true, gatewayMode: "mock", authMode: "unconfigured" });

  const { response, body } = await jsonRequest(`/snapshot?${query()}`);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body), ["snapshotComplete", "emptyConfirmed", "sources", "operacional", "aduana"]);
  assert.equal(body.snapshotComplete, true);
  assert.equal(body.emptyConfirmed, false);
  assert.equal(body.operacional.some(row => row.route_name === "VT9_AM1" && row.route_id === 502731583001), true);
  assert.equal(body.aduana.some(row => row.route_name === "VJ3_AM1" && row.route_id === 502731583004), true);

  let upstreamCalls = 0;
  await withGateway(testConfig(), {
    fetchImpl: async () => {
      upstreamCalls += 1;
      throw new Error("fetch upstream nao deveria ser executado");
    }
  }, async url => {
    const mockResponse = await fetch(`${url}/snapshot?${query()}`);
    assert.equal(mockResponse.status, 200);
  });
  assert.equal(upstreamCalls, 0);
});
