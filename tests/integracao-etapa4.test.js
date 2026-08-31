const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function createHarness() {
  const listeners = new Map();
  const emittedEvents = [];
  const timers = new Map();
  let nextTimerId = 1;

  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const window = {
    CustomEvent: FakeCustomEvent,
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    dispatchEvent(event) {
      emittedEvents.push(event);
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
    "integracao-fonte.js"
  ].forEach(file => {
    const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
    vm.runInContext(source, context, { filename: file });
  });

  return { context, emittedEvents, timers, warnings, window };
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

function fictionalPayload(routeId = 4001, routeName = "FONTE_A_AM1", process = "customs_in_progress") {
  return {
    waves: [{
      wave_id: "W-FONTE-1",
      wave_name: "Onda 1",
      planned_routes: 1,
      dispatched_routes: process === "dispatched" ? 1 : 0,
      pending_routes: process === "dispatched" ? 0 : 1,
      has_associated_routes: true
    }],
    dispatch: [{
      route_id: routeId,
      route_name: routeName,
      dock_number: 12,
      process,
      start_time: 30,
      total_elapsed_time: 90
    }],
    audits: []
  };
}

function eventDetails(harness, type) {
  return harness.emittedEvents.filter(event => event.type === type).map(event => event.detail);
}

async function runNextTimer(harness) {
  const nextTimer = harness.timers.entries().next().value;
  assert.ok(nextTimer, "deve existir um ciclo agendado");
  const [id, timer] = nextTimer;
  harness.timers.delete(id);
  timer.callback();
  await new Promise(resolve => setImmediate(resolve));
}

test("Fonte inicia parada e valida provider, contexto e intervalo", async () => {
  const harness = createHarness();
  const source = harness.window.PainelIntegracaoFonte;

  assert.equal(source.isRunning(), false);
  assert.equal(source.getIntervalMs(), 30000);
  assert.deepEqual(JSON.parse(JSON.stringify(source.getStatus())), {
    running: false,
    isRefreshing: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    successfulRefreshes: 0,
    failedRefreshes: 0,
    intervalMs: 30000,
    hasProvider: false
  });
  assert.throws(() => source.setProvider({}), /load\(\)/);
  assert.throws(() => source.setIntervalMs(9999), /pelo menos 10000 ms/);
  assert.throws(() => source.setIntervalMs("30000"), /número inteiro/);

  const originalContext = { facilityId: "FACILIDADE-FICTICIA", filters: { wave: "Onda 1" } };
  source.setContext(originalContext);
  originalContext.filters.wave = "alterada externamente";
  assert.equal(source.getContext().filters.wave, "Onda 1");

  const returnedContext = source.getContext();
  returnedContext.filters.wave = "alterada na cópia";
  assert.equal(source.getContext().filters.wave, "Onda 1");
  assert.equal(source.setIntervalMs(15000), 15000);
  assert.equal(source.getIntervalMs(), 15000);
  assert.throws(() => source.refreshNow(), /load\(\)/);

  source.setProvider({
    async load() {
      return { waves: [], dispatch: [] };
    }
  });
  await assert.rejects(() => source.refreshNow(), /audits.*array/);
});

test("refreshNow encaminha o payload ao Bridge e registra sucesso", async () => {
  const harness = createHarness();
  const source = harness.window.PainelIntegracaoFonte;
  const bridge = harness.window.PainelIntegracaoBridge;
  let calls = 0;
  let receivedContext = null;

  source.setContext({ facilityId: "FACILIDADE-FICTICIA", cycle: "CICLO-TESTE" });
  source.setProvider({
    async load(context) {
      calls += 1;
      receivedContext = context;
      return fictionalPayload();
    }
  });

  const snapshot = await source.refreshNow();
  const status = source.getStatus();
  assert.equal(calls, 1);
  assert.equal(receivedContext.facilityId, "FACILIDADE-FICTICIA");
  assert.equal(snapshot.routes[0].routeId, 4001);
  assert.equal(bridge.getSnapshot(), snapshot);
  assert.equal(bridge.hasSnapshot(), true);
  assert.ok(status.lastAttemptAt);
  assert.ok(status.lastSuccessAt);
  assert.equal(status.successfulRefreshes, 1);
  assert.equal(status.failedRefreshes, 0);
  assert.equal(status.isRefreshing, false);
  assert.equal(eventDetails(harness, "painel:integration-refresh-success").length, 1);
});

test("start é idempotente, cria um único timer e stop preserva o snapshot", async () => {
  const harness = createHarness();
  const source = harness.window.PainelIntegracaoFonte;
  const bridge = harness.window.PainelIntegracaoBridge;
  let calls = 0;

  source.setProvider({
    async load() {
      calls += 1;
      return fictionalPayload();
    }
  });

  const firstStart = source.start();
  const secondStart = source.start();
  assert.equal(firstStart, secondStart);
  await firstStart;
  assert.equal(calls, 1);
  assert.equal(source.isRunning(), true);
  assert.equal(harness.timers.size, 1);
  assert.equal([...harness.timers.values()][0].delay, 30000);

  await source.start();
  assert.equal(calls, 1);
  assert.equal(harness.timers.size, 1);

  const snapshotBeforeStop = bridge.getSnapshot();
  source.stop();
  assert.equal(source.isRunning(), false);
  assert.equal(harness.timers.size, 0);
  assert.equal(bridge.getSnapshot(), snapshotBeforeStop);
  assert.equal(bridge.hasSnapshot(), true);
});

test("falha preserva snapshot anterior e uma tentativa seguinte pode se recuperar", async () => {
  const harness = createHarness();
  const source = harness.window.PainelIntegracaoFonte;
  const bridge = harness.window.PainelIntegracaoBridge;
  let calls = 0;

  source.setProvider({
    async load() {
      calls += 1;
      if (calls === 1) return fictionalPayload(4101, "FONTE_PRIMEIRA_AM1");
      if (calls === 2) throw new Error("falha fictícia\nsem stack no evento");
      return fictionalPayload(4102, "FONTE_RECUPERADA_AM1", "loading_packages");
    }
  });

  const firstSnapshot = await source.refreshNow();
  await assert.rejects(() => source.start(), /falha fictícia/);
  const failedStatus = source.getStatus();
  const errorDetail = eventDetails(harness, "painel:integration-refresh-error")[0];
  assert.equal(bridge.getSnapshot(), firstSnapshot);
  assert.equal(bridge.getSnapshot().routes[0].routeId, 4101);
  assert.equal(failedStatus.failedRefreshes, 1);
  assert.ok(failedStatus.lastErrorAt);
  assert.equal(failedStatus.lastError, "falha fictícia sem stack no evento");
  assert.deepEqual(Object.keys(errorDetail).sort(), ["at", "failedRefreshes", "message"]);
  assert.equal(source.isRunning(), true);
  assert.equal(harness.timers.size, 1);

  await runNextTimer(harness);
  const recoveredSnapshot = bridge.getSnapshot();
  const recoveredStatus = source.getStatus();
  assert.equal(recoveredSnapshot.routes[0].routeId, 4102);
  assert.equal(recoveredStatus.successfulRefreshes, 2);
  assert.equal(recoveredStatus.failedRefreshes, 1);
  assert.equal(recoveredStatus.lastError, null);
  assert.equal(recoveredStatus.lastErrorAt, failedStatus.lastErrorAt);
  assert.equal(harness.timers.size, 1);
  source.stop();
});

test("refreshNow reutiliza a Promise ativa e nunca chama o provider em paralelo", async () => {
  const harness = createHarness();
  const source = harness.window.PainelIntegracaoFonte;
  let calls = 0;
  let activeCalls = 0;
  let maximumActiveCalls = 0;
  let resolveLoad;

  source.setProvider({
    load() {
      calls += 1;
      activeCalls += 1;
      maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
      return new Promise(resolve => {
        resolveLoad = payload => {
          activeCalls -= 1;
          resolve(payload);
        };
      });
    }
  });

  const firstRefresh = source.refreshNow();
  const secondRefresh = source.refreshNow();
  assert.equal(firstRefresh, secondRefresh);
  assert.equal(calls, 1);
  assert.equal(source.getStatus().isRefreshing, true);

  resolveLoad(fictionalPayload(4201, "FONTE_LENTA_AM1"));
  const [firstSnapshot, secondSnapshot] = await Promise.all([firstRefresh, secondRefresh]);
  assert.equal(firstSnapshot, secondSnapshot);
  assert.equal(calls, 1);
  assert.equal(maximumActiveCalls, 1);
  assert.equal(source.getStatus().isRefreshing, false);
});

test("stop invalida refresh pendente e um novo refresh manual continua válido", async () => {
  const harness = createHarness();
  const source = harness.window.PainelIntegracaoFonte;
  const bridge = harness.window.PainelIntegracaoBridge;
  let calls = 0;
  let resolvePendingLoad;

  source.setProvider({
    load() {
      calls += 1;
      if (calls === 1) return Promise.resolve(fictionalPayload(4401, "FONTE_ANTERIOR_AM1"));
      if (calls === 2) {
        return new Promise(resolve => {
          resolvePendingLoad = resolve;
        });
      }
      return Promise.resolve(fictionalPayload(4403, "FONTE_APOS_STOP_AM1", "loading_packages"));
    }
  });

  const previousSnapshot = await source.refreshNow();
  const successfulEventsBeforeStop = eventDetails(harness, "painel:integration-refresh-success").length;
  const pendingRefresh = source.start();
  assert.equal(source.getStatus().isRefreshing, true);

  source.stop();
  assert.equal(source.isRunning(), false);
  resolvePendingLoad(fictionalPayload(4402, "FONTE_OBSOLETA_AM1", "dispatched"));
  const staleResult = await pendingRefresh;

  assert.equal(staleResult, previousSnapshot);
  assert.equal(bridge.getSnapshot(), previousSnapshot);
  assert.equal(bridge.getSnapshot().routes[0].routeId, 4401);
  assert.equal(source.getStatus().successfulRefreshes, 1);
  assert.equal(eventDetails(harness, "painel:integration-refresh-success").length, successfulEventsBeforeStop);
  assert.equal(source.isRunning(), false);

  const snapshotAfterStop = await source.refreshNow();
  assert.equal(calls, 3);
  assert.equal(snapshotAfterStop.routes[0].routeId, 4403);
  assert.equal(snapshotAfterStop.routes[0].processLabel, "CARREGAMENTO");
  assert.equal(bridge.getSnapshot(), snapshotAfterStop);
  assert.equal(source.getStatus().successfulRefreshes, 2);
  assert.equal(source.isRunning(), false);
});

test("status e evento sanitizam dados sensíveis sem alterar o erro rejeitado", async () => {
  const harness = createHarness();
  const source = harness.window.PainelIntegracaoFonte;
  const originalError = new Error(
    "401 https://interno.exemplo/api Authorization: Bearer segredo123 token=abc client_secret=xyz\n"
    + "CSRF=csrf123 access_token=acesso123 refresh_token=renova123 api_key=chave123 "
    + "opaque=ABCDEFGHIJKLMNOP1234567890\nCookie: sessao=sessao123"
  );

  source.setProvider({
    async load() {
      throw originalError;
    }
  });

  let rejectedError = null;
  try {
    await source.refreshNow();
  } catch (error) {
    rejectedError = error;
  }

  const statusMessage = source.getStatus().lastError;
  const errorEvent = eventDetails(harness, "painel:integration-refresh-error").at(-1);
  assert.equal(rejectedError, originalError);
  assert.match(rejectedError.message, /interno\.exemplo/);
  assert.match(statusMessage, /401/);
  assert.match(statusMessage, /\[URL_REMOVIDA\]/);
  assert.match(statusMessage, /\[REMOVIDO\]/);
  assert.equal(errorEvent.message, statusMessage);
  assert.equal(Object.hasOwn(errorEvent, "stack"), false);

  [
    "interno.exemplo",
    "segredo123",
    "token=abc",
    "client_secret=xyz",
    "csrf123",
    "acesso123",
    "renova123",
    "chave123",
    "ABCDEFGHIJKLMNOP1234567890",
    "sessao123"
  ].forEach(secret => {
    assert.equal(statusMessage.includes(secret), false);
    assert.equal(errorEvent.message.includes(secret), false);
  });
});

test("Fonte e UI são independentes e o fluxo completo usa adaptador e render existente", async () => {
  const harness = createHarness();
  const source = harness.window.PainelIntegracaoFonte;
  const bridge = harness.window.PainelIntegracaoBridge;
  const manualData = {
    extracao: [{ onda: "Onda 1", idRota: "MANUAL-1", rota: "MANUAL_AM1", doca: "1" }],
    baseOperacional: [{ rota: "MANUAL_AM1", processo: "Guardando" }],
    baseAduana: [{ rota: "MANUAL_AM1", repLog: "REP Manual" }],
    base: [{ rota: "MANUAL_AM1", processo: "Guardando", repLog: "REP Manual" }]
  };
  const manualBefore = JSON.stringify(manualData);
  let calls = 0;
  installIntegrationUi(harness, manualData);

  source.setProvider({
    async load() {
      calls += 1;
      return calls === 1
        ? fictionalPayload(4301, "FONTE_BRIDGE_AM1")
        : fictionalPayload(4302, "FONTE_UI_AM1", "loading_packages");
    }
  });

  const integrationUi = harness.window.PainelIntegracaoUI;
  integrationUi.disable();
  await source.refreshNow();
  assert.equal(bridge.hasSnapshot(), true);
  assert.equal(integrationUi.getLastAppliedSnapshot(), null);
  assert.equal(vm.runInContext("effectiveExtractionRows().length", harness.context), 1);
  assert.equal(JSON.stringify(manualData), manualBefore);

  integrationUi.enable();
  assert.equal(integrationUi.getLastAppliedSnapshot(), null);
  await source.refreshNow();
  const applied = integrationUi.getLastAppliedSnapshot();
  assert.equal(applied.routes.length, 1);
  assert.equal(applied.routes[0].routeId, 4302);
  assert.equal(applied.routes[0].processo, "Guardando");
  assert.equal(vm.runInContext("effectiveExtractionRows().length", harness.context), 2);
  assert.ok(harness.context.renderCount >= 3);
  assert.equal(JSON.stringify(manualData), manualBefore);
  assert.equal(source.isRunning(), false);
});
