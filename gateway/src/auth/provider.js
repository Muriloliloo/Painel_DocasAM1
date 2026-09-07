"use strict";

const { ERROR_CODES, GatewayError } = require("../errors");

function createAuthProvider(config) {
  const mode = config?.authMode || "unconfigured";

  return Object.freeze({
    mode,
    async getAuthContext() {
      throw new GatewayError(
        503,
        ERROR_CODES.AUTH_NOT_CONFIGURED,
        "A autenticacao corporativa oficial ainda nao foi configurada."
      );
    }
  });
}

module.exports = { createAuthProvider };
