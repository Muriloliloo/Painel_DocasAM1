"use strict";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createConfig } = require("../src/config");
const { createGatewayServer, validateRequestTarget } = require("../src/server");
const { sanitizeDispatch } = require("../src/sanitizers/dispatch");
const { sanitizeCustoms } = require("../src/sanitizers/customs");

let server;
let baseUrl;

function testConfig(overrides = {}) {
  return createConfig({}, {
    port: 0,
    nodeEnv: "development",
    mode: "mock",
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
  assert.deepEqual(body, { status: "ok", mode: "mock" });
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
    assert.equal("stack" in body, false);
    assert.equal(JSON.stringify(body).includes("at "), false);
  } finally {
    await new Promise(resolve => productionServer.close(resolve));
  }
});
