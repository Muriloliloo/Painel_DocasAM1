"use strict";

const { loadFixtureSnapshot } = require("./fixtures/operational-snapshot.fixture");

async function loadOperationalSnapshot(context = {}, options = {}) {
  if (options.useFixture !== false) {
    return loadFixtureSnapshot(context);
  }
  throw new Error("Fonte operacional autorizada ainda não foi configurada.");
}

module.exports = {
  loadOperationalSnapshot
};
