const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CENTRAL_MODE,
  DEFAULT_SNAPSHOT_REFRESH_MS,
  loadConfig
} = require("../backend/config");
const { createServer } = require("../backend/server");
const { createSnapshotManager } = require("../backend/snapshot-manager");
const {
  CENTRAL_NOT_CONFIGURED_MESSAGE,
  createCentralRuntime,
  startCentralServer
} = require("../backend/start-central");

const projectRoot = path.resolve(__dirname, "..");

function fictionalSnapshot(label) {
  return {
    waves: [{
      wave_id: `ONDA-FICTICIA-${label}`,
      wave_name: `Onda ${label}`,
      planned_routes: 1,
      dispatched_routes: 0,
      pending_routes: 1,
      has_associated_routes: true,
      internal_note: "NAO_REPASSAR"
    }],
    dispatch: [{
      route_id: `ROTA-FICTICIA-${label}`,
      route_name: `TESTE_${label}_AM1`,
      dock_number: 10,
      process: "loading_packages",
      start_time: 30,
      total_elapsed_time: 60,
      password: "SEGREDO_FICTICIO_NAO_REPASSAR"
    }],
    audits: [{
      id: `AUDITORIA-FICTICIA-${label}`,
      status: "in_progress",
      driver: {
        route_id: `ROTA-FICTICIA-${label}`,
        cluster_id: `TESTE_${label}_AM1`
      },
      cpf: "000.000.000-00",
      token: "TOKEN_FICTICIO_NAO_REPASSAR"
    }],
    internalMetadata: {
      source: "FICTICIA"
    }
  };
}

function centralConfig(overrides = {}) {
  return loadConfig({
    BACKEND_MODE: CENTRAL_MODE,
    ALLOWED_ORIGINS: "https://muriloliloo.github.io",
    ...overrides
  });
}

async function startCentralHttp(snapshotManager) {
  const server = createServer({
    config: centralConfig(),
    snapshotManager
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    server
  };
}

async function stopServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

test("Snapshot Manager sanitiza antes do cache e expõe status seguro", async () => {
  let receivedContext = null;
  const manager = createSnapshotManager({
    context: {
      facilityId: "TESTE",
      cycle: "CICLO_A",
      date: "2099-01-01",
      wave: 1,
      token: "IGNORAR"
    },
    loader: async context => {
      receivedContext = context;
      return fictionalSnapshot("A");
    }
  });

  assert.equal(manager.getStatus().ready, false);
  assert.equal(manager.getStatus().refreshIntervalMs, DEFAULT_SNAPSHOT_REFRESH_MS);
  assert.equal(manager.getSnapshot(), null);
  await manager.refreshNow();

  assert.deepEqual(receivedContext, {
    facilityId: "TESTE",
    cycle: "CICLO_A",
    date: "2099-01-01",
    wave: "1"
  });
  const snapshot = manager.getSnapshot();
  assert.deepEqual(Object.keys(snapshot).sort(), ["audits", "dispatch", "waves"]);
  const serialized = JSON.stringify(snapshot).toLowerCase();
  ["password", "token", "cpf", "internal_note", "internalmetadata"].forEach(field => {
    assert.equal(serialized.includes(field), false);
  });
  snapshot.dispatch[0].route_name = "ALTERADO_FORA";
  assert.equal(manager.getSnapshot().dispatch[0].route_name, "TESTE_A_AM1");

  const status = manager.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.ready, true);
  assert.equal(status.refreshing, false);
  assert.equal(status.successfulRefreshes, 1);
  assert.equal(status.failedRefreshes, 0);
  assert.equal(Object.hasOwn(status, "error"), false);
  assert.equal(Object.hasOwn(status, "snapshot"), false);

  assert.throws(
    () => createSnapshotManager({ loader: async () => fictionalSnapshot("X"), refreshIntervalMs: 9999 }),
    /SNAPSHOT_REFRESH_MS/
  );
  assert.throws(
    () => createSnapshotManager({ loader: async () => fictionalSnapshot("X"), refreshIntervalMs: 300001 }),
    /SNAPSHOT_REFRESH_MS/
  );
});

test("refreshNow concorrente reutiliza uma única Promise e chama o loader uma vez", async () => {
  let resolveLoader;
  let loaderCalls = 0;
  const manager = createSnapshotManager({
    loader: () => {
      loaderCalls += 1;
      return new Promise(resolve => {
        resolveLoader = resolve;
      });
    }
  });

  const first = manager.refreshNow();
  const second = manager.refreshNow();
  const third = manager.refreshNow();
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(loaderCalls, 1);
  assert.equal(manager.getStatus().refreshing, true);

  resolveLoader(fictionalSnapshot("UNICO"));
  const snapshots = await Promise.all([first, second, third]);
  assert.equal(loaderCalls, 1);
  snapshots.forEach(snapshot => {
    assert.equal(snapshot.dispatch[0].route_name, "TESTE_UNICO_AM1");
  });
});

test("start atualiza imediatamente, mantém um timer e stop encerra o ciclo", async () => {
  const timers = new Map();
  let nextTimerId = 1;
  let loaderCalls = 0;
  const manager = createSnapshotManager({
    loader: async () => {
      loaderCalls += 1;
      if (loaderCalls === 2) throw new Error("Falha periódica fictícia");
      return fictionalSnapshot(`CICLO${loaderCalls}`);
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  });

  await manager.start();
  assert.equal(loaderCalls, 1);
  assert.equal(manager.getStatus().running, true);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 30000);

  await manager.start();
  assert.equal(loaderCalls, 1);
  assert.equal(timers.size, 1);

  const [timerId, timer] = [...timers.entries()][0];
  timers.delete(timerId);
  timer.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loaderCalls, 2);
  assert.equal(timers.size, 1);
  assert.equal(manager.getStatus().failedRefreshes, 1);
  assert.equal(manager.getSnapshot().dispatch[0].route_name, "TESTE_CICLO1_AM1");

  const [retryTimerId, retryTimer] = [...timers.entries()][0];
  timers.delete(retryTimerId);
  retryTimer.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loaderCalls, 3);
  assert.equal(timers.size, 1);
  assert.equal(manager.getSnapshot().dispatch[0].route_name, "TESTE_CICLO3_AM1");

  manager.stop();
  assert.equal(manager.getStatus().running, false);
  assert.equal(timers.size, 0);
});

test("falha preserva Snapshot A e sucesso posterior troca integralmente para B", async () => {
  const responses = [
    fictionalSnapshot("A"),
    new Error("Falha fictícia com detalhe que não deve ir ao status"),
    fictionalSnapshot("B")
  ];
  let loaderCalls = 0;
  const manager = createSnapshotManager({
    loader: async () => {
      const response = responses[loaderCalls++];
      if (response instanceof Error) throw response;
      return response;
    }
  });

  await manager.refreshNow();
  assert.equal(manager.getSnapshot().dispatch[0].route_name, "TESTE_A_AM1");
  await assert.rejects(() => manager.refreshNow(), /Falha fictícia/);
  assert.equal(manager.getStatus().ready, true);
  assert.equal(manager.getStatus().failedRefreshes, 1);
  assert.equal(manager.getSnapshot().dispatch[0].route_name, "TESTE_A_AM1");
  assert.equal(Object.hasOwn(manager.getStatus(), "lastError"), false);

  await manager.refreshNow();
  assert.equal(manager.getSnapshot().dispatch[0].route_name, "TESTE_B_AM1");
  assert.equal(manager.getStatus().successfulRefreshes, 2);
  assert.equal(loaderCalls, 3);
});

test("readiness fica 503 até a primeira carga válida e endpoint nunca chama o loader", async () => {
  let loaderCalls = 0;
  const manager = createSnapshotManager({
    loader: async () => {
      loaderCalls += 1;
      if (loaderCalls === 1) throw new Error("Primeira carga fictícia falhou");
      return fictionalSnapshot("READY");
    }
  });
  const runtime = await startCentralHttp(manager);
  try {
    await assert.rejects(() => manager.refreshNow(), /Primeira carga fictícia falhou/);
    const health = await fetch(`${runtime.baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const notReady = await fetch(`${runtime.baseUrl}/ready`);
    assert.equal(notReady.status, 503);
    assert.deepEqual(await notReady.json(), { status: "not_ready" });
    const unavailable = await fetch(`${runtime.baseUrl}/operational-snapshot`);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), {
      error: "Dados operacionais ainda não estão disponíveis."
    });
    assert.equal(loaderCalls, 1);

    await manager.refreshNow();
    const ready = await fetch(`${runtime.baseUrl}/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: "ready" });
    const available = await fetch(`${runtime.baseUrl}/operational-snapshot`);
    assert.equal(available.status, 200);
    assert.equal(available.headers.get("cache-control"), "no-store");
    assert.equal((await available.json()).dispatch[0].route_name, "TESTE_READY_AM1");
    assert.equal(loaderCalls, 2);
  } finally {
    await stopServer(runtime.server);
  }
});

test("troca de contexto invalida snapshot anterior e exige primeira carga do novo ciclo", async () => {
  let loaderCalls = 0;
  const manager = createSnapshotManager({
    context: { facilityId: "TESTE", cycle: "A" },
    loader: async context => {
      loaderCalls += 1;
      return fictionalSnapshot(context.cycle);
    }
  });
  await manager.refreshNow();
  const runtime = await startCentralHttp(manager);
  try {
    assert.equal(manager.getSnapshot().dispatch[0].route_name, "TESTE_A_AM1");
    manager.setContext({ facilityId: "TESTE", cycle: "B", token: "IGNORAR" });
    assert.deepEqual(manager.getContext(), { facilityId: "TESTE", cycle: "B" });
    assert.equal(manager.getStatus().ready, false);
    assert.equal(manager.getSnapshot(), null);

    const staleCycle = await fetch(`${runtime.baseUrl}/operational-snapshot`);
    assert.equal(staleCycle.status, 503);
    await manager.refreshNow();
    const newCycle = await fetch(`${runtime.baseUrl}/operational-snapshot`);
    assert.equal(newCycle.status, 200);
    assert.equal((await newCycle.json()).dispatch[0].route_name, "TESTE_B_AM1");
    assert.equal(loaderCalls, 2);
  } finally {
    await stopServer(runtime.server);
  }
});

test("resposta pendente do contexto antigo nunca substitui o contexto novo", async () => {
  let resolveContextA;
  let loaderCalls = 0;
  const manager = createSnapshotManager({
    context: { cycle: "A" },
    loader: context => {
      loaderCalls += 1;
      if (context.cycle === "A") {
        return new Promise(resolve => {
          resolveContextA = resolve;
        });
      }
      return Promise.resolve(fictionalSnapshot("B"));
    }
  });

  const pendingA = manager.refreshNow();
  manager.setContext({ cycle: "B" });
  const concurrentAfterChange = manager.refreshNow();
  assert.equal(concurrentAfterChange, pendingA);
  assert.equal(loaderCalls, 1);
  resolveContextA(fictionalSnapshot("A"));
  assert.equal(await pendingA, null);
  assert.equal(manager.getStatus().ready, false);
  assert.equal(manager.getSnapshot(), null);

  await manager.refreshNow();
  assert.equal(loaderCalls, 2);
  assert.equal(manager.getStatus().ready, true);
  assert.equal(manager.getSnapshot().dispatch[0].route_name, "TESTE_B_AM1");
});

test("vinte usuários compartilham A e depois B sem novas chamadas ao loader", async () => {
  let loaderCalls = 0;
  const manager = createSnapshotManager({
    loader: async () => {
      loaderCalls += 1;
      return fictionalSnapshot(loaderCalls === 1 ? "A" : "B");
    }
  });
  await manager.refreshNow();
  const runtime = await startCentralHttp(manager);
  try {
    const clientsA = await Promise.all(Array.from({ length: 20 }, async () => {
      const response = await fetch(`${runtime.baseUrl}/operational-snapshot`);
      assert.equal(response.status, 200);
      return response.json();
    }));
    assert.equal(loaderCalls, 1);
    assert.equal(new Set(clientsA.map(snapshot => snapshot.dispatch[0].route_name)).size, 1);
    assert.equal(clientsA[0].dispatch[0].route_name, "TESTE_A_AM1");

    await manager.refreshNow();
    const clientsB = await Promise.all(Array.from({ length: 20 }, async () => {
      const response = await fetch(`${runtime.baseUrl}/operational-snapshot`);
      assert.equal(response.status, 200);
      return response.json();
    }));
    assert.equal(loaderCalls, 2);
    assert.equal(new Set(clientsB.map(snapshot => snapshot.dispatch[0].route_name)).size, 1);
    assert.equal(clientsB[0].dispatch[0].route_name, "TESTE_B_AM1");
  } finally {
    await stopServer(runtime.server);
  }
});

test("modo central sem loader falha fechado, não usa fixture e não habilita bind externo", () => {
  const config = centralConfig({ USE_FIXTURE: "true" });
  assert.equal(config.backendMode, CENTRAL_MODE);
  assert.equal(config.useFixture, false);
  assert.throws(
    () => createCentralRuntime({ config }),
    new RegExp(CENTRAL_NOT_CONFIGURED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
  assert.throws(
    () => startCentralServer({
      config,
      host: "0.0.0.0",
      loader: async () => fictionalSnapshot("NAO_INICIAR")
    }),
    /Bind externo/
  );

  const directRun = spawnSync(process.execPath, [path.join("backend", "start-central.js")], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      BACKEND_MODE: CENTRAL_MODE,
      USE_FIXTURE: "true"
    }
  });
  assert.equal(directRun.status, 1);
  assert.equal(directRun.stderr.trim(), CENTRAL_NOT_CONFIGURED_MESSAGE);
  const entrypointSource = fs.readFileSync(path.join(projectRoot, "backend", "start-central.js"), "utf8");
  assert.equal(/operational-snapshot\.fixture|loadFixtureSnapshot/.test(entrypointSource), false);
});
