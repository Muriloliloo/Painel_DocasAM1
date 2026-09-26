"use strict";

const { GatewayError } = require("../errors");

const MOCK_YMS_ROW = Object.freeze({
  facility_id: "SSP15",
  operation_date: "2026-09-02",
  cycle_name: "AM1",
  wave_number: 1,
  process_id: "PROCESSO-MOCK",
  executed_route_id: "434014897",
  planned_route_id: "503226595004",
  route_name: "VJ3_AM1",
  planned_route_name: "A3_AM1",
  route_changed_from_plan: true,
  route_resolution_status: "resolved",
  carrier_name: "UNICA TRANSPORTES",
  planned_carrier_name: "TRANSPORTADORA PLANEJADA",
  plate: "SDD-UEO6I01",
  loading_zone_name: "2",
  parking_area_name: "VAGAS DE EXPEDIÇÃO",
  yms_check_in_at: "2026-09-02 08:49:13",
  dock_in_at: "2026-09-02 09:02:48",
  customs_queue_at: "",
  customs_started_at: "",
  customs_last_activity_at: "",
  loading_started_at: "2026-09-02 09:03:37",
  dock_out_at: "2026-09-02 09:36:17",
  gate_out_at: "2026-09-02 09:36:26",
  latest_event_name: "gate-out",
  latest_status: "PROCESS_FINISHED",
  latest_purpose_status: "LOADING_PACKAGES_STARTED",
  latest_event_at: "2026-09-02 09:36:26"
});

function createYmsProvider(config) {
  if (config.ymsMode === "disabled") {
    return Object.freeze({
      mode: "disabled",
      inspectConfiguration() {
        return { configured: true, mode: "disabled" };
      },
      async query() {
        return [];
      }
    });
  }

  if (config.ymsMode === "mock") {
    return Object.freeze({
      mode: "mock",
      inspectConfiguration() {
        return { configured: true, mode: "mock" };
      },
      async query({ scenario }) {
        if (new Set(["empty-unconfirmed", "empty-confirmed"]).has(scenario)) return [];
        return [{ ...MOCK_YMS_ROW }];
      }
    });
  }

  return Object.freeze({
    mode: "provider",
    inspectConfiguration() {
      return {
        configured: false,
        mode: "provider",
        reason: "YMS_PROVIDER_NOT_CONFIGURED"
      };
    },
    async query() {
      throw new GatewayError(
        503,
        "YMS_PROVIDER_NOT_CONFIGURED",
        "Provider YMS/BigQuery ainda nao foi configurado pela infraestrutura."
      );
    }
  });
}

function isYmsProviderReady(config, provider) {
  if (config.ymsMode === "disabled" || config.ymsMode === "mock") return true;
  if (!provider || typeof provider.query !== "function") return false;
  if (typeof provider.inspectConfiguration !== "function") return true;
  return provider.inspectConfiguration()?.configured === true;
}

module.exports = {
  MOCK_YMS_ROW,
  createYmsProvider,
  isYmsProviderReady
};
