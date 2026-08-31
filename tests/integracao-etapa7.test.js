const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  LOCAL_FIXTURE_MODE,
  assertLocalFixtureConfig,
  loadConfig
} = require("../backend/config");
const { loadOperationalSnapshot } = require("../backend/operational-service");
const { createServer } = require("../backend/server");
const {
  allowedOriginsFromArguments,
  localFixtureConfig,
  startLocalServer
} = require("../backend/start-local");

const projectRoot = path.resolve(__dirname, "..");

async function availablePort() {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve, reject) => {
    reservation.close(error => error ? reject(error) : resolve());
  });
  return port;
}

async function startLocalRuntime(allowedOrigins = ["https://painel-ficticio.exemplo"]) {
  const port = await availablePort();
  const logs = [];
  const server = startLocalServer({
    env: {
      PORT: String(port),
      ALLOWED_ORIGINS: allowedOrigins.join(",")
    },
    logger: {
      log(message) {
        logs.push(String(message));
      }
    }
  });
  await once(server, "listening");
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    logs,
    server
  };
}

async function stopServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type"
          ? "application/json; charset=utf-8"
          : null;
      }
    },
    async json() {
      return payload;
    }
  };
}

function createFrontendHarness(options = {}) {
  const listeners = new Map();
  class FakeCustomEvent {
    constructor(type, eventOptions = {}) {
      this.type = type;
      this.detail = eventOptions.detail;
    }
  }

  const window = {
    URL,
    URLSearchParams,
    AbortController,
    Request: options.Request,
    fetch: options.fetch || fetch,
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
  const warnings = [];
  const context = vm.createContext({
    window,
    console: {
      info() {},
      log() {},
      warn(...args) {
        warnings.push(args);
      }
    }
  });

  [
    "integracao-operacional.js",
    "integracao-painel.js",
    "integracao-adaptador.js",
    "integracao-fonte.js",
    "integracao-provider-http.js",
    "integracao-local.js"
  ].forEach(file => {
    const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
    vm.runInContext(source, context, { filename: file });
  });
  return { context, warnings, window };
}

function installIntegrationUi(harness, manualData) {
  const indexSource = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
  const block = indexSource.match(/\/\/ INTEGRATION_UI_START([\s\S]*?)\/\/ INTEGRATION_UI_END/);
  assert.ok(block, "bloco da API de integração deve existir no index.html");

  const { context } = harness;
  context.integrationState = { enabled: false, lastAppliedSnapshot: null };
  context.data = manualData;
  context.renderCount = 0;
  context.render = () => {
    context.renderCount += 1;
  };
  context.normalize = value => String(value ?? "").trim();
  context.routeKey = value => context.normalize(value).toUpperCase();
  context.waveLabel = value => {
    const text = context.normalize(value);
    const number = text.match(/\d+/)?.[0];
    return number ? `Onda ${Number(number)}` : text;
  };
  vm.runInContext(block[1], context, { filename: "index-integration-ui.js" });
}

test("backend falha fechado sem modo local-fixture explícito", async () => {
  const defaults = loadConfig({});
  assert.equal(defaults.backendMode, "");
  assert.equal(defaults.useFixture, false);
  assert.throws(() => createServer({ config: defaults }), /Backend desabilitado/);
  await assert.rejects(() => loadOperationalSnapshot({}, {}), /não foi configurada/);

  assert.throws(
    () => loadConfig({ BACKEND_MODE: "producao" }),
    /BACKEND_MODE não suportado/
  );
  const fixtureDisabled = loadConfig({
    BACKEND_MODE: LOCAL_FIXTURE_MODE,
    USE_FIXTURE: "false"
  });
  assert.throws(() => assertLocalFixtureConfig(fixtureDisabled), /Backend desabilitado/);

  const directRun = spawnSync(process.execPath, [path.join("backend", "server.js")], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      BACKEND_MODE: "",
      USE_FIXTURE: ""
    }
  });
  assert.equal(directRun.status, 1);
  assert.match(directRun.stderr, /node backend\/start-local\.js/);
  assert.equal(directRun.stderr.includes("at startServer"), false);
});

test("start-local explicita fixture, aceita origem exata e rejeita argumentos inseguros", () => {
  const pageOrigin = "https://muriloliloo.github.io";
  const config = localFixtureConfig(
    { PORT: "8787" },
    [`--allow-origin=${pageOrigin}`]
  );
  assert.equal(config.backendMode, LOCAL_FIXTURE_MODE);
  assert.equal(config.useFixture, true);
  assert.deepEqual(Array.from(config.allowedOrigins), [pageOrigin]);
  assert.deepEqual(allowedOriginsFromArguments([`--allow-origin=${pageOrigin}`]), [pageOrigin]);
  assert.throws(() => localFixtureConfig({}, ["--allow-origin=*"]), /origem inválida/);
  assert.throws(() => localFixtureConfig({}, ["--modo=outro"]), /Argumento inválido/);
});

test("start-local vincula somente loopback e serve health e fixture sanitizada com CORS restrito", async () => {
  const allowedOrigin = "https://painel-ficticio.exemplo";
  const runtime = await startLocalRuntime([allowedOrigin]);
  try {
    const address = runtime.server.address();
    assert.equal(address.address, "127.0.0.1");
    assert.equal(address.family, "IPv4");
    assert.match(runtime.logs.join("\n"), /MODO LOCAL COM FIXTURE FICTÍCIA/);
    assert.match(runtime.logs.join("\n"), new RegExp(`http://127\\.0\\.0\\.1:${address.port}/health`));

    const healthResponse = await fetch(`${runtime.baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { status: "ok" });

    const snapshotResponse = await fetch(`${runtime.baseUrl}/operational-snapshot`, {
      headers: { Origin: allowedOrigin }
    });
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshotResponse.status, 200);
    assert.equal(snapshotResponse.headers.get("access-control-allow-origin"), allowedOrigin);
    assert.deepEqual(Object.keys(snapshot).sort(), ["audits", "dispatch", "waves"]);
    assert.deepEqual(
      snapshot.dispatch.map(route => route.route_name),
      ["TESTE1_AM1", "TESTE2_AM1", "TESTE3_AM1"]
    );
    const serialized = JSON.stringify(snapshot).toLowerCase();
    ["password", "token", "cookie", "authorization", "cpf", "email"].forEach(field => {
      assert.equal(serialized.includes(field), false);
    });

    const deniedResponse = await fetch(`${runtime.baseUrl}/operational-snapshot`, {
      headers: { Origin: "https://origem-nao-autorizada.exemplo" }
    });
    assert.equal(deniedResponse.status, 200);
    assert.equal(deniedResponse.headers.has("access-control-allow-origin"), false);
  } finally {
    await stopServer(runtime.server);
  }
});

test("helper local fica inerte até configure e disconnect remove provider sem habilitar UI", () => {
  let fetchCalls = 0;
  const harness = createFrontendHarness({
    fetch: async () => {
      fetchCalls += 1;
      return jsonResponse({ waves: [], dispatch: [], audits: [] });
    }
  });
  const source = harness.window.PainelIntegracaoFonte;
  const local = harness.window.PainelIntegracaoLocal;

  assert.equal(local.getStatus().configured, false);
  assert.equal(source.getStatus().hasProvider, false);
  assert.equal(source.isRunning(), false);
  assert.equal(fetchCalls, 0);

  const configured = local.configure();
  assert.equal(configured.configured, true);
  assert.equal(configured.endpoint, "http://127.0.0.1:8787/operational-snapshot");
  assert.equal(configured.sourceRunning, false);
  assert.equal(configured.uiEnabled, false);
  assert.equal(source.getStatus().hasProvider, true);
  assert.equal(source.isRunning(), false);
  assert.equal(fetchCalls, 0);

  const disconnected = local.disconnect();
  assert.equal(disconnected.configured, false);
  assert.equal(disconnected.endpoint, null);
  assert.equal(source.getStatus().hasProvider, false);
  assert.equal(source.isRunning(), false);
  assert.equal(fetchCalls, 0);
});

test("provider usa targetAddressSpace somente em loopback e mantém fallback compatível", async () => {
  class LoopbackAwareRequest {
    constructor(url, options = {}) {
      this.url = url;
      this.targetAddressSpace = options.targetAddressSpace || "unknown";
    }
  }

  const capturedOptions = [];
  const payload = { waves: [], dispatch: [], audits: [] };
  const supported = createFrontendHarness({
    Request: LoopbackAwareRequest,
    fetch: async (url, options) => {
      capturedOptions.push({ options, url });
      return jsonResponse(payload);
    }
  });
  const providerApi = supported.window.PainelIntegracaoHttpProvider;
  await providerApi.create({
    endpoint: "http://127.0.0.1:8787/operational-snapshot"
  }).load();
  await providerApi.create({
    endpoint: "https://backend-futuro.exemplo/operational-snapshot"
  }).load();

  assert.equal(capturedOptions[0].options.targetAddressSpace, "loopback");
  assert.equal(Object.hasOwn(capturedOptions[1].options, "targetAddressSpace"), false);

  let fallbackOptions = null;
  const unsupported = createFrontendHarness({
    fetch: async (url, options) => {
      fallbackOptions = options;
      return jsonResponse(payload);
    }
  });
  await unsupported.window.PainelIntegracaoHttpProvider.create({
    endpoint: "http://localhost:8787/operational-snapshot"
  }).load();
  assert.equal(Object.hasOwn(fallbackOptions, "targetAddressSpace"), false);
});

test("fetch local real atualiza Bridge e UI somente quando habilitada, preservando dados manuais", async () => {
  const runtime = await startLocalRuntime();
  try {
    const harness = createFrontendHarness({ Request, fetch });
    const manualData = {
      extracao: [{ onda: "Onda 1", idRota: "MANUAL-1", rota: "MANUAL_AM1", doca: "1" }],
      baseOperacional: [],
      baseAduana: [],
      base: []
    };
    const manualBefore = JSON.stringify(manualData);
    installIntegrationUi(harness, manualData);

    const provider = harness.window.PainelIntegracaoHttpProvider.create({
      endpoint: `${runtime.baseUrl}/operational-snapshot`,
      timeoutMs: 3000
    });
    const source = harness.window.PainelIntegracaoFonte;
    const bridge = harness.window.PainelIntegracaoBridge;
    const ui = harness.window.PainelIntegracaoUI;
    source.setProvider(provider);

    assert.equal(source.isRunning(), false);
    assert.equal(ui.isEnabled(), false);
    const disabledSnapshot = await source.refreshNow();
    assert.equal(disabledSnapshot.routes.length, 3);
    assert.equal(bridge.getSnapshot(), disabledSnapshot);
    assert.equal(ui.getLastAppliedSnapshot(), null);
    assert.equal(harness.context.renderCount, 0);
    assert.equal(JSON.stringify(manualData), manualBefore);

    ui.enable();
    assert.equal(ui.getLastAppliedSnapshot(), null);
    await source.refreshNow();
    const applied = ui.getLastAppliedSnapshot();
    assert.ok(applied.routes.some(route => route.rota === "TESTE1_AM1"));
    assert.equal(harness.context.renderCount, 2);
    assert.equal(vm.runInContext("effectiveExtractionRows().length", harness.context), 4);
    assert.equal(source.isRunning(), false);
    assert.equal(JSON.stringify(manualData), manualBefore);

    ui.disable();
    assert.equal(ui.getLastAppliedSnapshot(), null);
    assert.equal(vm.runInContext("effectiveExtractionRows().length", harness.context), 1);
    assert.equal(JSON.stringify(manualData), manualBefore);
    assert.equal(harness.warnings.length, 0);
    source.clearProvider();
  } finally {
    await stopServer(runtime.server);
  }
});

test("index carrega helper local após Fonte e provider sem configuração automática", () => {
  const source = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
  const sourcePosition = source.indexOf('<script src="integracao-fonte.js"></script>');
  const providerPosition = source.indexOf('<script src="integracao-provider-http.js"></script>');
  const localPosition = source.indexOf('<script src="integracao-local.js"></script>');
  assert.ok(sourcePosition >= 0);
  assert.ok(providerPosition > sourcePosition);
  assert.ok(localPosition > providerPosition);
  assert.equal((source.match(/integracao-local\.js/g) || []).length, 1);
});
