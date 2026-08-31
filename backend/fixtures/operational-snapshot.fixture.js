"use strict";

function loadFixtureSnapshot() {
  return {
    waves: [{
      wave_id: "WAVE-FICTICIA-1",
      wave_name: "Onda 1",
      start_time: "08:00",
      end_time: "09:00",
      planned_routes: 3,
      dispatched_routes: 1,
      pending_routes: 2,
      has_associated_routes: true,
      internal_note: "NAO_REPASSAR"
    }],
    dispatch: [
      {
        route_id: "ROTA-FICTICIA-1",
        route_name: "TESTE1_AM1",
        dock_number: 10,
        process: "customs_in_progress",
        start_time: 120,
        total_elapsed_time: 300,
        password: "SENHA_FICTICIA_NAO_USAR"
      },
      {
        route_id: "ROTA-FICTICIA-2",
        route_name: "TESTE2_AM1",
        dock_number: 20,
        process: "loading_packages",
        start_time: 60,
        total_elapsed_time: 240,
        token: "TOKEN_FICTICIO_NAO_USAR"
      },
      {
        route_id: "ROTA-FICTICIA-3",
        route_name: "TESTE3_AM1",
        dock_number: null,
        process: "dispatched",
        start_time: 45,
        total_elapsed_time: 744,
        authorization: "AUTORIZACAO_FICTICIA_NAO_USAR"
      }
    ],
    audits: [{
      id: "AUDITORIA-FICTICIA-1",
      facility_id: "FACILIDADE-FICTICIA",
      status: "in_progress",
      audit_type: "TESTE",
      operator_id: "OPERADOR-FICTICIO-1",
      created_at: "2099-01-01T08:10:00Z",
      started_at: "2099-01-01T08:11:00Z",
      finished_at: null,
      leftover_count: 0,
      cpf: "000.000.000-00",
      document_number: "DOCUMENTO_FICTICIO",
      email: "nao-usar@example.invalid",
      phone: "000000000",
      address: "ENDERECO_FICTICIO",
      access_token: "ACESSO_FICTICIO_NAO_USAR",
      refresh_token: "RENOVACAO_FICTICIA_NAO_USAR",
      cookie: "COOKIE_FICTICIO_NAO_USAR",
      csrf: "CSRF_FICTICIO_NAO_USAR",
      client_secret: "SEGREDO_FICTICIO_NAO_USAR",
      api_key: "CHAVE_FICTICIA_NAO_USAR",
      driver: {
        route_id: "ROTA-FICTICIA-1",
        driver_id: "MOTORISTA-FICTICIO-1",
        vehicle_id: "VEICULO-FICTICIO-1",
        carrier_id: "TRANSPORTADORA-FICTICIA-1",
        cluster_id: "TESTE1_AM1",
        document: "DOCUMENTO_FICTICIO_NAO_USAR"
      },
      operator: {
        name: "OPERADOR",
        last_name: "FICTICIO",
        email: "operador@example.invalid"
      },
      transporter: {
        first_name: "MOTORISTA",
        last_name: "FICTICIO",
        phone: "000000000"
      },
      vehicle: {
        license_plate: "PLACA_TESTE",
        internal_id: "NAO_REPASSAR"
      },
      carrier: {
        display_name: "TRANSPORTADORA_FICTICIA",
        api_key: "CHAVE_FICTICIA_NAO_USAR"
      },
      units: [{
        entity_id: "UNIDADE-FICTICIA-1",
        status: "audited",
        token: "TOKEN_FICTICIO_NAO_USAR"
      }],
      debug: {
        internal: "NAO_REPASSAR"
      }
    }],
    internalMetadata: {
      source: "FIXTURE_LOCAL"
    }
  };
}

module.exports = {
  loadFixtureSnapshot
};
