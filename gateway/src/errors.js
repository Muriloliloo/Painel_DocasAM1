"use strict";

class GatewayError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { GatewayError };
