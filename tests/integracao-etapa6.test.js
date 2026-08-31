const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { LOCAL_FIXTURE_MODE, loadConfig } = require("../backend/config");
const { loadFixtureSnapshot } = require("../backend/fixtures/operational-snapshot.fixture");
const { createServer } = require("../backend/server");
const { LIMITS, sanitizeOperationalData } = require("../backend/sanitize-operational-data");

const projectRoot = path.resolve(__dirname, "..");

async function startTestServer(options) {
  const server = createServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server
  };
}

async function stopTestServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function createFrontendHarness() {
  const listeners = new Map();
  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const window = {
    URL,
    URLSearchParams,
    AbortController,
    fetch,
    setTimeout,
    clearTimeout,
    CustomEvent: FakeCustomEvent,
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach(listener => listener(event));
      return true;
    }
  };
  const context = vm.createContext({ window, console });
  [
    "integracao-operacional.js",
    "integracao-painel.js",
    "integracao-fonte.js",
    "integracao-provider-http.js"
  ].forEach(file => {
    const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
    vm.runInContext(source, context, { filename: file });
  });
  return { context, window };
}

test("configuração usa somente opções permitidas e rejeita CORS curinga", () => {
  const defaults = loadConfig({});
  assert.equal(defaults.port, 8787);
  assert.equal(defaults.backendMode, "");
  assert.equal(defaults.useFixture, false);
  assert.deepEqual(Array.from(defaults.allowedOrigins), [
    "http://localhost:8000",
    "http://127.0.0.1:8000"
  ]);

  const configured = loadConfig({
    PORT: "9876",
    BACKEND_MODE: LOCAL_FIXTURE_MODE,
    ALLOWED_ORIGINS: "http://localhost:9000,https://painel-ficticio.exemplo",
    USE_FIXTURE: "false",
    TOKEN: "IGNORADO"
  });
  assert.deepEqual(Object.keys(configured).sort(), ["allowedOrigins", "backendMode", "port", "useFixture"]);
  assert.equal(configured.port, 9876);
  assert.equal(configured.useFixture, false);
  assert.deepEqual(Array.from(configured.allowedOrigins), [
    "http://localhost:9000",
    "https://painel-ficticio.exemplo"
  ]);
  assert.throws(() => loadConfig({ ALLOWED_ORIGINS: "*" }), /origem inválida/);
});

test("sanitizador mantém allowlists e remove PII, segredos e campos extras", () => {
  const sanitized = sanitizeOperationalData(loadFixtureSnapshot());
  assert.deepEqual(Object.keys(sanitized).sort(), ["audits", "dispatch", "waves"]);
  assert.deepEqual(Object.keys(sanitized.dispatch[0]).sort(), [
    "dock_number",
    "process",
    "route_id",
    "route_name",
    "start_time",
    "total_elapsed_time"
  ]);
  assert.deepEqual(Object.keys(sanitized.audits[0].driver).sort(), [
    "carrier_id",
    "cluster_id",
    "driver_id",
    "route_id",
    "vehicle_id"
  ]);
  assert.deepEqual(Object.keys(sanitized.audits[0].units[0]).sort(), ["entity_id", "status"]);

  const serialized = JSON.stringify(sanitized).toLowerCase();
  [
    "cpf",
    "document",
    "document_number",
    "email",
    "phone",
    "address",
    "password",
    "token",
    "access_token",
    "refresh_token",
    "cookie",
    "authorization",
    "csrf",
    "client_secret",
    "api_key",
    "nao_repassar",
    "não_repassar"
  ].forEach(forbidden => assert.equal(serialized.includes(forbidden), false));
});

test("sanitizador limita arrays, unidades e campos textuais", () => {
  const oversized = {
    waves: Array.from({ length: LIMITS.maxWaves + 2 }, (_, index) => ({
      wave_id: `W-${index}`,
      wave_name: "X".repeat(LIMITS.maxStringLength + 50)
    })),
    dispatch: Array.from({ length: LIMITS.maxDispatch + 2 }, (_, index) => ({
      route_id: `R-${index}`,
      route_name: `TESTE${index}_AM1`
    })),
    audits: Array.from({ length: LIMITS.maxAudits + 2 }, (_, index) => ({
      id: `A-${index}`,
      units: index === 0
        ? Array.from({ length: LIMITS.maxUnitsPerAudit + 2 }, (_, unitIndex) => ({
          entity_id: `U-${unitIndex}`,
          status: "audited"
        }))
        : []
    }))
  };

  const sanitized = sanitizeOperationalData(oversized);
  assert.equal(sanitized.waves.length, LIMITS.maxWaves);
  assert.equal(sanitized.dispatch.length, LIMITS.maxDispatch);
  assert.equal(sanitized.audits.length, LIMITS.maxAudits);
  assert.equal(sanitized.audits[0].units.length, LIMITS.maxUnitsPerAudit);
  assert.equal(sanitized.waves[0].wave_name.length, LIMITS.maxStringLength);
});

test("servidor local cumpre contrato HTTP, contexto, métodos e CORS", async () => {
  const allowedOrigin = "http://localhost:8000";
  let receivedContext = null;
  const runtime = await startTestServer({
    config: {
      allowedOrigins: [allowedOrigin],
      backendMode: LOCAL_FIXTURE_MODE,
      useFixture: true
    },
    operationalLoader: async context => {
      receivedContext = context;
      return loadFixtureSnapshot();
    }
  });

  try {
    const snapshotResponse = await fetch(
      `${runtime.baseUrl}/operational-snapshot?facilityId=TESTE&cycle=CICLO_TESTE&date=2099-01-01&wave=1&token=NAO_USAR`,
      { headers: { Origin: allowedOrigin } }
    );
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshotResponse.status, 200);
    assert.match(snapshotResponse.headers.get("content-type"), /^application\/json; charset=utf-8$/i);
    assert.equal(snapshotResponse.headers.get("cache-control"), "no-store");
    assert.equal(snapshotResponse.headers.get("access-control-allow-origin"), allowedOrigin);
    assert.ok(snapshotResponse.headers.get("x-request-id"));
    assert.deepEqual(Object.keys(snapshot).sort(), ["audits", "dispatch", "waves"]);
    assert.ok(Array.isArray(snapshot.waves));
    assert.ok(Array.isArray(snapshot.dispatch));
    assert.ok(Array.isArray(snapshot.audits));
    assert.deepEqual(receivedContext, {
      facilityId: "TESTE",
      cycle: "CICLO_TESTE",
      date: "2099-01-01",
      wave: "1"
    });

    const healthResponse = await fetch(`${runtime.baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { status: "ok" });

    const postResponse = await fetch(`${runtime.baseUrl}/operational-snapshot`, { method: "POST" });
    assert.equal(postResponse.status, 405);
    assert.equal(postResponse.headers.get("allow"), "GET, OPTIONS");

    const deniedCors = await fetch(`${runtime.baseUrl}/operational-snapshot`, {
      headers: { Origin: "https://origem-nao-autorizada.exemplo" }
    });
    assert.equal(deniedCors.status, 200);
    assert.equal(deniedCors.headers.has("access-control-allow-origin"), false);

    const optionsResponse = await fetch(`${runtime.baseUrl}/operational-snapshot`, {
      method: "OPTIONS",
      headers: { Origin: allowedOrigin }
    });
    assert.equal(optionsResponse.status, 204);
    assert.equal(optionsResponse.headers.get("access-control-allow-origin"), allowedOrigin);

    const invalidContext = await fetch(
      `${runtime.baseUrl}/operational-snapshot?facilityId=${"X".repeat(65)}`
    );
    assert.equal(invalidContext.status, 400);
    assert.deepEqual(await invalidContext.json(), { error: "Parâmetros operacionais inválidos." });
  } finally {
    await stopTestServer(runtime.server);
  }
});

test("erro do serviço retorna mensagem e requestId seguros", async () => {
  const runtime = await startTestServer({
    config: { allowedOrigins: [], backendMode: LOCAL_FIXTURE_MODE, useFixture: true },
    operationalLoader: async () => {
      throw new Error("Falha em sistema fictício com token=NAO_REPASSAR");
    }
  });

  try {
    const response = await fetch(`${runtime.baseUrl}/operational-snapshot`);
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.deepEqual(body, { error: "Não foi possível obter os dados operacionais." });
    assert.ok(response.headers.get("x-request-id"));
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("NAO_REPASSAR"), false);
    assert.equal(serialized.includes("stack"), false);
  } finally {
    await stopTestServer(runtime.server);
  }
});

test("fluxo frontend para backend local cria snapshot no Bridge sem autostart", async () => {
  const runtime = await startTestServer({
    config: {
      allowedOrigins: ["http://localhost:8000"],
      backendMode: LOCAL_FIXTURE_MODE,
      useFixture: true
    }
  });

  try {
    const harness = createFrontendHarness();
    const source = harness.window.PainelIntegracaoFonte;
    const bridge = harness.window.PainelIntegracaoBridge;
    const httpProvider = harness.window.PainelIntegracaoHttpProvider.create({
      endpoint: `${runtime.baseUrl}/operational-snapshot`,
      timeoutMs: 3000
    });

    assert.equal(source.isRunning(), false);
    assert.equal(source.getStatus().hasProvider, false);
    source.setContext({
      facilityId: "TESTE",
      cycle: "CICLO_TESTE",
      date: "2099-01-01",
      wave: "1",
      token: "NAO_ENVIAR"
    });
    source.setProvider(httpProvider);
    const snapshot = await source.refreshNow();

    assert.equal(snapshot.routes.length, 3);
    assert.ok(snapshot.routes.some(route => route.routeName === "TESTE1_AM1"));
    assert.equal(bridge.getSnapshot(), snapshot);
    assert.equal(bridge.hasSnapshot(), true);
    assert.equal(source.isRunning(), false);
  } finally {
    await stopTestServer(runtime.server);
  }
});
