const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function createHarness() {
  const listeners = new Map();
  const timers = new Map();
  let nextTimerId = 1;

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
    CustomEvent: FakeCustomEvent,
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach(listener => listener(event));
      return true;
    },
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fetch() {
      throw new Error("fetch fictício não configurado");
    }
  };

  const context = vm.createContext({
    window,
    console: {
      info() {},
      log() {},
      warn() {}
    }
  });

  [
    "integracao-operacional.js",
    "integracao-painel.js",
    "integracao-fonte.js",
    "integracao-provider-http.js"
  ].forEach(file => {
    const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
    vm.runInContext(source, context, { filename: file });
  });

  return { context, timers, window };
}

function jsonResponse(payload, options = {}) {
  const status = options.status ?? 200;
  const contentType = options.contentType ?? "application/json; charset=utf-8";
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? contentType : null;
      }
    },
    async json() {
      if (options.jsonError) throw options.jsonError;
      return payload;
    }
  };
}

function fictionalPayload(routeId = 5001, routeName = "HTTP_TESTE_AM1") {
  return {
    waves: [{
      wave_id: "W-HTTP-1",
      wave_name: "Onda 1",
      planned_routes: 1,
      dispatched_routes: 0,
      pending_routes: 1,
      has_associated_routes: true
    }],
    dispatch: [{
      route_id: routeId,
      route_name: routeName,
      dock_number: 15,
      process: "loading_packages"
    }],
    audits: []
  };
}

function runNextTimer(harness) {
  const nextTimer = harness.timers.entries().next().value;
  assert.ok(nextTimer, "deve existir um timeout agendado");
  const [id, timer] = nextTimer;
  harness.timers.delete(id);
  timer.callback();
  return timer;
}

test("validateEndpoint aceita HTTPS/local e rejeita esquemas, credenciais e query sensível", () => {
  const { window } = createHarness();
  const api = window.PainelIntegracaoHttpProvider;

  assert.equal(api.DEFAULT_TIMEOUT_MS, 15000);
  assert.equal(api.MIN_TIMEOUT_MS, 3000);
  assert.equal(api.MAX_TIMEOUT_MS, 60000);
  assert.deepEqual(Array.from(api.ALLOWED_CONTEXT_FIELDS), ["facilityId", "cycle", "date", "wave"]);
  assert.equal(
    api.validateEndpoint("https://backend-aprovado.exemplo/operational-snapshot"),
    "https://backend-aprovado.exemplo/operational-snapshot"
  );
  assert.equal(api.validateEndpoint("http://localhost:8080/api"), "http://localhost:8080/api");
  assert.equal(api.validateEndpoint("http://127.0.0.1:9000/api"), "http://127.0.0.1:9000/api");

  [
    "http://servidor-externo.exemplo",
    "file:///arquivo",
    "javascript:alert(1)",
    "data:text/plain,teste",
    "/rota-relativa"
  ].forEach(endpoint => {
    assert.throws(() => api.validateEndpoint(endpoint), /HTTPS|absoluta/);
  });
  assert.throws(
    () => api.validateEndpoint("https://usuario:senha@backend.exemplo/api"),
    /usuário ou senha/
  );

  [
    "token",
    "access_token",
    "refresh_token",
    "authorization",
    "cookie",
    "csrf",
    "client_secret",
    "api_key",
    "password",
    "senha"
  ].forEach(key => {
    assert.throws(
      () => api.validateEndpoint(`https://backend.exemplo/api?${key}=VALOR_FICTICIO`),
      /credenciais ou segredos/
    );
  });

  assert.throws(
    () => api.create({ endpoint: "https://backend.exemplo/api", timeoutMs: 2999 }),
    /entre 3000 e 60000 ms/
  );
  assert.throws(
    () => api.create({ endpoint: "https://backend.exemplo/api", timeoutMs: 60001 }),
    /entre 3000 e 60000 ms/
  );
});

test("load usa opções seguras, allowlist de contexto e remove metadados extras", async () => {
  const harness = createHarness();
  const api = harness.window.PainelIntegracaoHttpProvider;
  let capturedUrl = null;
  let capturedOptions = null;

  harness.window.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return jsonResponse({
      waves: [],
      dispatch: [],
      audits: [],
      internalToken: "NAO_REPASSAR",
      debug: { authorization: "NAO_REPASSAR" }
    });
  };

  const provider = api.create({
    endpoint: "https://backend-aprovado.exemplo/operational-snapshot?mode=teste"
  });
  const result = await provider.load({
    facilityId: "TESTE",
    cycle: "CICLO_TESTE",
    date: "2099-01-01",
    wave: "1",
    password: "NAO_ENVIAR",
    token: "NAO_ENVIAR",
    nested: { debug: true }
  });

  const requestedUrl = new URL(capturedUrl);
  assert.equal(requestedUrl.searchParams.get("mode"), "teste");
  assert.equal(requestedUrl.searchParams.get("facilityId"), "TESTE");
  assert.equal(requestedUrl.searchParams.get("cycle"), "CICLO_TESTE");
  assert.equal(requestedUrl.searchParams.get("date"), "2099-01-01");
  assert.equal(requestedUrl.searchParams.get("wave"), "1");
  assert.equal(requestedUrl.searchParams.has("password"), false);
  assert.equal(requestedUrl.searchParams.has("token"), false);
  assert.equal(requestedUrl.searchParams.has("nested"), false);

  assert.equal(capturedOptions.method, "GET");
  assert.equal(capturedOptions.credentials, "omit");
  assert.equal(capturedOptions.cache, "no-store");
  assert.deepEqual(Object.keys(capturedOptions.headers), ["Accept"]);
  assert.equal(capturedOptions.headers.Accept, "application/json");
  assert.ok(capturedOptions.signal);
  ["authorization", "cookie", "csrf"].forEach(header => {
    assert.equal(Object.keys(capturedOptions.headers).some(key => key.toLowerCase() === header), false);
  });

  assert.deepEqual(Object.keys(result).sort(), ["audits", "dispatch", "waves"]);
  assert.equal(Object.hasOwn(result, "internalToken"), false);
  assert.equal(Object.hasOwn(result, "debug"), false);
  assert.equal(harness.timers.size, 0);
});

test("respostas HTTP, conteúdo e payload inválidos geram mensagens seguras", async () => {
  const harness = createHarness();
  const provider = harness.window.PainelIntegracaoHttpProvider.create({
    endpoint: "https://backend-aprovado.exemplo/operational-snapshot"
  });

  harness.window.fetch = async () => jsonResponse({}, { status: 500, contentType: "text/html" });
  await assert.rejects(() => provider.load(), {
    message: "Fonte operacional respondeu HTTP 500."
  });

  harness.window.fetch = async () => jsonResponse({}, { contentType: "text/html" });
  await assert.rejects(() => provider.load(), {
    message: "Fonte operacional não retornou JSON válido."
  });

  harness.window.fetch = async () => jsonResponse({}, { jsonError: new Error("JSON bruto fictício") });
  await assert.rejects(() => provider.load(), {
    message: "Fonte operacional não retornou JSON válido."
  });

  harness.window.fetch = async () => jsonResponse({ waves: [], dispatch: [] });
  await assert.rejects(() => provider.load(), {
    message: "Resposta operacional inválida."
  });
});

test("timeout aborta a requisição e retorna mensagem sem URL", async () => {
  const harness = createHarness();
  const api = harness.window.PainelIntegracaoHttpProvider;
  let capturedSignal = null;

  harness.window.fetch = (url, options) => {
    capturedSignal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("Abortado em endpoint fictício");
        error.name = "AbortError";
        reject(error);
      });
    });
  };

  const provider = api.create({
    endpoint: "https://backend-aprovado.exemplo/operational-snapshot",
    timeoutMs: 3000
  });
  const pendingLoad = provider.load();
  assert.equal(harness.timers.size, 1);
  assert.equal([...harness.timers.values()][0].delay, 3000);
  runNextTimer(harness);

  await assert.rejects(() => pendingLoad, {
    message: "Tempo limite ao consultar a fonte operacional."
  });
  assert.equal(capturedSignal.aborted, true);
  assert.equal(harness.timers.size, 0);
});

test("falha de rede não repassa mensagem nativa, URL ou stack", async () => {
  const harness = createHarness();
  const provider = harness.window.PainelIntegracaoHttpProvider.create({
    endpoint: "https://backend-aprovado.exemplo/operational-snapshot"
  });
  harness.window.fetch = async () => {
    throw new Error("GET https://backend-aprovado.exemplo token=SEGREDO_FICTICIO");
  };

  let receivedError = null;
  try {
    await provider.load();
  } catch (error) {
    receivedError = error;
  }
  assert.equal(receivedError.message, "Não foi possível consultar a fonte operacional.");
  assert.equal(receivedError.message.includes("backend-aprovado.exemplo"), false);
  assert.equal(receivedError.message.includes("SEGREDO_FICTICIO"), false);
});

test("provider HTTP integra com Fonte e Bridge sem iniciar polling", async () => {
  const harness = createHarness();
  const httpApi = harness.window.PainelIntegracaoHttpProvider;
  const source = harness.window.PainelIntegracaoFonte;
  const bridge = harness.window.PainelIntegracaoBridge;
  assert.equal(source.isRunning(), false);
  assert.equal(source.getStatus().hasProvider, false);

  harness.window.fetch = async () => jsonResponse(fictionalPayload(5101, "HTTP_FLUXO_AM1"));
  const provider = httpApi.create({
    endpoint: "https://backend-aprovado.exemplo/operational-snapshot"
  });
  source.setProvider(provider);
  const snapshot = await source.refreshNow();

  assert.equal(snapshot.routes.length, 1);
  assert.equal(snapshot.routes[0].routeId, 5101);
  assert.equal(snapshot.routes[0].routeName, "HTTP_FLUXO_AM1");
  assert.equal(bridge.getSnapshot(), snapshot);
  assert.equal(bridge.hasSnapshot(), true);
  assert.equal(source.isRunning(), false);
  assert.equal(harness.timers.size, 0);
});
