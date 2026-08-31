"use strict";

const { LOCAL_FIXTURE_MODE, loadConfig } = require("./config");
const { startServer } = require("./server");

function allowedOriginsFromArguments(args = []) {
  return args.map(argument => {
    const prefix = "--allow-origin=";
    if (typeof argument !== "string" || !argument.startsWith(prefix) || argument.length === prefix.length) {
      throw new TypeError("Argumento inválido. Use --allow-origin=https://origem.exata");
    }
    return argument.slice(prefix.length);
  });
}

function localFixtureConfig(env = process.env, args = []) {
  const argumentOrigins = allowedOriginsFromArguments(args);
  return loadConfig({
    ...env,
    BACKEND_MODE: LOCAL_FIXTURE_MODE,
    USE_FIXTURE: "true",
    ...(argumentOrigins.length ? { ALLOWED_ORIGINS: argumentOrigins.join(",") } : {})
  });
}

function startLocalServer(options = {}) {
  const config = localFixtureConfig(
    options.env || process.env,
    options.args || []
  );
  return startServer({
    config,
    logger: options.logger || console
  });
}

if (require.main === module) {
  try {
    const server = startLocalServer({ args: process.argv.slice(2) });
    server.once("error", () => {
      console.error("Backend local não iniciado. Verifique se a porta está disponível.");
      process.exitCode = 1;
    });
  } catch {
    console.error("Backend local não iniciado. Revise a origem permitida e tente novamente.");
    process.exitCode = 1;
  }
}

module.exports = {
  allowedOriginsFromArguments,
  localFixtureConfig,
  startLocalServer
};
