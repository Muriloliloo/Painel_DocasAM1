const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function createBrowserHarness() {
  const listeners = new Map();
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

  ["integracao-operacional.js", "integracao-painel.js", "integracao-adaptador.js"].forEach(file => {
    const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
    vm.runInContext(source, context, { filename: file });
  });

  return { context, window, warnings };
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

function fictionalPayload({ emptyAuditPeople = false } = {}) {
  return {
    waves: [{
      wave_id: "W-TESTE-1",
      wave_name: "Onda 1",
      planned_routes: 4,
      dispatched_routes: 1,
      pending_routes: 3,
      has_associated_routes: true
    }],
    dispatch: [
      {
        route_id: 1001,
        route_name: "TESTE1_AM1",
        dock_number: 10,
        process: "customs_in_progress",
        start_time: 120,
        total_elapsed_time: 300
      },
      {
        route_id: 1002,
        route_name: "TESTE2_AM1",
        dock_number: 20,
        process: "loading_packages",
        start_time: 60,
        total_elapsed_time: 240
      },
      {
        route_id: 1003,
        route_name: "TESTE3_AM1",
        process: "dispatched",
        start_time: 45,
        total_elapsed_time: 744
      }
    ],
    audits: [
      {
        id: "AUD-TESTE-1",
        status: "in_progress",
        driver: {
          route_id: 1001,
          cluster_id: "TESTE1_AM1",
          driver_id: "DRV-TESTE-1",
          vehicle_id: "VEH-TESTE-1",
          carrier_id: "CAR-TESTE-1"
        },
        operator: {
          operator_id: "REP-TESTE-1",
          name: emptyAuditPeople ? "" : "REP",
          last_name: emptyAuditPeople ? "" : "Ficticio"
        },
        transporter: {
          first_name: emptyAuditPeople ? "" : "Motorista",
          last_name: emptyAuditPeople ? "" : "Ficticio"
        },
        vehicle: { license_plate: emptyAuditPeople ? "" : "TST1A23" },
        carrier: { display_name: emptyAuditPeople ? "" : "Transportadora Ficticia" },
        units: [
          { entity_id: "UNIT-TESTE-1", status: "audited" },
          { entity_id: "UNIT-TESTE-2", status: "leftover" }
        ],
        leftover_count: 1,
        started_at: "2026-08-30T10:00:00Z"
      },
      {
        id: "AUD-TESTE-4",
        status: "in_progress",
        driver: { route_id: 1004, cluster_id: "TESTE4_AM1" },
        operator: { name: "REP", last_name: "Aduana" },
        created_at: "2026-08-30T10:05:00Z"
      }
    ]
  };
}

test("adaptador reutiliza os status e campos canônicos do painel", () => {
  const { window } = createBrowserHarness();
  const snapshot = window.PainelIntegracaoOperacional.buildOperationalSnapshot(fictionalPayload());
  const adapted = window.PainelIntegracaoAdaptador.adaptSnapshot(snapshot);
  const route1 = adapted.routes.find(route => route.routeId === 1001);
  const route2 = adapted.routes.find(route => route.routeId === 1002);
  const route3 = adapted.routes.find(route => route.routeId === 1003);
  const route4 = adapted.routes.find(route => route.routeId === 1004);

  assert.equal(route1.doca, "10");
  assert.equal(route1.processo, "Em aduana");
  assert.equal(route1.repLog, "REP Ficticio");
  assert.equal(route1.motorista, "Motorista Ficticio");
  assert.equal(route1.transportadora, "Transportadora Ficticia");
  assert.equal(route1.totalUnits, 2);
  assert.equal(route1.unitCounts.audited, 1);
  assert.equal(route2.processo, "Guardando");
  assert.equal(route3.processo, "Expedida");
  assert.equal(route3.tempoProcesso, "0m 45s");
  assert.equal(route3.tempoTotal, "12m 24s");
  assert.notEqual(route3.tempoProcesso, route3.tempoTotal);
  assert.equal(route4.rota, "TESTE4_AM1");
  assert.equal(route4.doca, "");
  assert.equal(route4.processo, "");
});

test("modo desabilitado ignora evento e modo habilitado reutiliza a estrutura atual", () => {
  const harness = createBrowserHarness();
  const manualData = {
    extracao: [{ onda: "Onda 1", idRota: "MANUAL-1", rota: "MANUAL_AM1", doca: "1" }],
    baseOperacional: [],
    baseAduana: [],
    base: []
  };
  const manualBefore = JSON.stringify(manualData);
  installIntegrationUi(harness, manualData);

  const bridge = harness.window.PainelIntegracaoBridge;
  const integrationUi = harness.window.PainelIntegracaoUI;
  assert.equal(integrationUi.isEnabled(), false);

  bridge.ingest(fictionalPayload());
  assert.equal(bridge.hasSnapshot(), true);
  assert.equal(integrationUi.getLastAppliedSnapshot(), null);
  assert.equal(harness.context.renderCount, 0);
  assert.equal(JSON.stringify(manualData), manualBefore);

  integrationUi.enable();
  bridge.ingest(fictionalPayload());
  assert.equal(integrationUi.isEnabled(), true);
  assert.equal(harness.context.renderCount, 2);

  const applied = integrationUi.getLastAppliedSnapshot();
  assert.equal(applied.routes.length, 4);
  assert.equal(applied.routes.find(route => route.routeId === 1004).doca, "");
  assert.equal(applied.routes.find(route => route.routeId === 1004).processo, "");

  const effectiveRows = vm.runInContext("effectiveExtractionRows()", harness.context);
  assert.equal(effectiveRows.length, 5);
  assert.equal(effectiveRows.find(route => route.routeId === 1001).doca, "10");
  assert.equal(JSON.stringify(manualData), manualBefore);

  integrationUi.disable();
  assert.equal(integrationUi.isEnabled(), false);
  assert.equal(vm.runInContext("effectiveExtractionRows().length", harness.context), 1);
  assert.equal(JSON.stringify(manualData), manualBefore);
});

test("disable invalida snapshot visual e exige novo ingest após reabilitar", () => {
  const harness = createBrowserHarness();
  const manualData = {
    extracao: [{ onda: "Onda 1", idRota: "MANUAL-1", rota: "MANUAL_AM1", doca: "1" }],
    baseOperacional: [],
    baseAduana: [],
    base: []
  };
  const manualBefore = JSON.stringify(manualData);
  installIntegrationUi(harness, manualData);

  const bridge = harness.window.PainelIntegracaoBridge;
  const integrationUi = harness.window.PainelIntegracaoUI;
  integrationUi.disable();
  integrationUi.enable();

  bridge.ingest(fictionalPayload());
  assert.ok(integrationUi.getLastAppliedSnapshot()?.routes.some(route => route.routeId === 1001));

  integrationUi.disable();
  assert.equal(integrationUi.getLastAppliedSnapshot(), null);
  assert.equal(vm.runInContext("effectiveExtractionRows().length", harness.context), 1);
  assert.equal(JSON.stringify(manualData), manualBefore);
  assert.equal(bridge.hasSnapshot(), true);

  integrationUi.enable();
  assert.equal(integrationUi.getLastAppliedSnapshot(), null);
  assert.equal(vm.runInContext("effectiveExtractionRows().length", harness.context), 1);

  const payloadB = fictionalPayload();
  payloadB.waves[0].planned_routes = 1;
  payloadB.waves[0].dispatched_routes = 0;
  payloadB.waves[0].pending_routes = 1;
  payloadB.dispatch = [{
    route_id: 2001,
    route_name: "TESTEB_AM1",
    dock_number: 30,
    process: "loading_packages"
  }];
  payloadB.audits = [];
  bridge.ingest(payloadB);

  const snapshotB = integrationUi.getLastAppliedSnapshot();
  assert.equal(snapshotB.routes.length, 1);
  assert.equal(snapshotB.routes[0].routeId, 2001);
  assert.equal(snapshotB.routes[0].processo, "Guardando");
  assert.equal(vm.runInContext("effectiveExtractionRows().length", harness.context), 2);
  assert.equal(JSON.stringify(manualData), manualBefore);
});

test("merge conservador preserva dados válidos e rotas ausentes na atualização seguinte", () => {
  const harness = createBrowserHarness();
  installIntegrationUi(harness, {
    extracao: [],
    baseOperacional: [],
    baseAduana: [],
    base: []
  });
  const bridge = harness.window.PainelIntegracaoBridge;
  const integrationUi = harness.window.PainelIntegracaoUI;
  integrationUi.enable();

  bridge.ingest(fictionalPayload());
  const first = integrationUi.getLastAppliedSnapshot();
  const firstRoute = first.routes.find(route => route.routeId === 1001);
  assert.equal(firstRoute.repLog, "REP Ficticio");
  assert.equal(firstRoute.motorista, "Motorista Ficticio");
  assert.equal(firstRoute.transportadora, "Transportadora Ficticia");

  const secondPayload = fictionalPayload({ emptyAuditPeople: true });
  secondPayload.audits = secondPayload.audits.filter(audit => audit.id === "AUD-TESTE-1");
  bridge.ingest(secondPayload);
  const second = integrationUi.getLastAppliedSnapshot();
  const secondRoute = second.routes.find(route => route.routeId === 1001);

  assert.equal(secondRoute.repLog, "REP Ficticio");
  assert.equal(secondRoute.motorista, "Motorista Ficticio");
  assert.equal(secondRoute.transportadora, "Transportadora Ficticia");
  assert.ok(second.routes.some(route => route.routeId === 1004));
  assert.equal(harness.warnings.length, 0);
});
