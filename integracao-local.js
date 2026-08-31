(function exposeLocalIntegrationHelper(global) {
  "use strict";

  const LOCAL_SNAPSHOT_ENDPOINT = "http://127.0.0.1:8787/operational-snapshot";
  let configured = false;

  function dependencies() {
    const providerApi = global.PainelIntegracaoHttpProvider;
    const source = global.PainelIntegracaoFonte;
    if (!providerApi || typeof providerApi.create !== "function") {
      throw new Error("O provider HTTP da integração não está disponível.");
    }
    if (!source || typeof source.setProvider !== "function") {
      throw new Error("A Fonte da integração não está disponível.");
    }
    return { providerApi, source };
  }

  function sourceStatus() {
    const source = global.PainelIntegracaoFonte;
    if (!source || typeof source.getStatus !== "function") {
      return { hasProvider: false, running: false };
    }
    return source.getStatus();
  }

  function getStatus() {
    const status = sourceStatus();
    const ui = global.PainelIntegracaoUI;
    return Object.freeze({
      configured: configured && Boolean(status.hasProvider),
      endpoint: configured ? LOCAL_SNAPSHOT_ENDPOINT : null,
      sourceRunning: Boolean(status.running),
      uiEnabled: Boolean(ui && typeof ui.isEnabled === "function" && ui.isEnabled())
    });
  }

  function configure() {
    const { providerApi, source } = dependencies();
    source.setProvider(providerApi.create({
      endpoint: LOCAL_SNAPSHOT_ENDPOINT
    }));
    configured = true;
    return getStatus();
  }

  function disconnect() {
    const source = global.PainelIntegracaoFonte;
    if (source && typeof source.clearProvider === "function") source.clearProvider();
    configured = false;
    return getStatus();
  }

  global.PainelIntegracaoLocal = Object.freeze({
    LOCAL_SNAPSHOT_ENDPOINT,
    configure,
    disconnect,
    getStatus
  });
})(typeof window !== "undefined" ? window : globalThis);
